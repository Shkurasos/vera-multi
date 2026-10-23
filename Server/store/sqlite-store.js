'use strict';
/**
 * Зашифрованное хранилище на node:sqlite.
 *
 * Сервер, как и раньше, работает с объектом db в памяти. Хранилище умеет две
 * вещи: load() — собрать db из базы, и save(db) — записать ТОЛЬКО изменения.
 * Для этого на каждую запись хранится SHA-256 её JSON (в памяти, не на диске):
 * неизменившиеся записи не перешифровываются и не пишутся.
 *
 * Каждая запись — отдельный AES-256-GCM конверт с AAD «коллекция + id».
 * Сохранение идёт одной транзакцией: при сбое база остаётся в прежнем
 * согласованном состоянии, а кэш хэшей не меняется.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { encrypt, decrypt } = require('./crypto');

const SCHEMA_VERSION = '1';
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const KEY_CHECK_AAD = 'meta:key_check';
const KEY_CHECK_TEXT = 'vera-store-key-check';

const recordAad = (collection, id) => `record\0${collection}\0${id}`;
const valueAad = (collection) => `value\0${collection}`;
const digest = (json) => crypto.createHash('sha256').update(json).digest('base64');

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * list  — массив объектов с уникальными строковыми id (пишется построчно);
 * map   — объект-словарь (пишется по ключам);
 * value — всё прочее (массивы строк, числа) — одним конвертом.
 */
function classify(value) {
  if (Array.isArray(value)) {
    const ids = new Set();
    for (const item of value) {
      if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return 'value';
      ids.add(item.id);
    }
    return 'list';
  }
  return isPlainObject(value) ? 'map' : 'value';
}

function entriesOf(kind, value) {
  if (kind === 'list') return value.map((item) => [item.id, item]);
  return Object.entries(value).filter(([, item]) => item !== undefined);
}

function prepareWrites(sql) {
  return {
    insertCollection: sql.prepare('INSERT INTO collections (name, kind, seq, data) VALUES (?, ?, ?, ?)'),
    collectionSeq: sql.prepare('UPDATE collections SET seq = ? WHERE name = ?'),
    collectionData: sql.prepare('UPDATE collections SET data = ? WHERE name = ?'),
    deleteCollection: sql.prepare('DELETE FROM collections WHERE name = ?'),
    upsertRecord: sql.prepare(`INSERT INTO records (collection, id, seq, data) VALUES (?, ?, ?, ?)
      ON CONFLICT (collection, id) DO UPDATE SET seq = excluded.seq, data = excluded.data`),
    recordSeq: sql.prepare('UPDATE records SET seq = ? WHERE collection = ? AND id = ?'),
    deleteRecord: sql.prepare('DELETE FROM records WHERE collection = ? AND id = ?'),
  };
}

/** Проверяет ключ по контрольной записи или создаёт её в новой базе. */
function checkKey(sql, key, file, readOnly) {
  const row = sql.prepare('SELECT v FROM meta WHERE k = ?').get('key_check');
  if (row) {
    try { decrypt(key, Buffer.from(row.v, 'base64'), KEY_CHECK_AAD); return; } catch {
      throw new Error(`Неверный VERA_KEK: хранилище ${file} зашифровано другим ключом`);
    }
  }
  if (readOnly) throw new Error(`Хранилище ${file} не инициализировано`);
  const setMeta = sql.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)');
  setMeta.run('key_check', encrypt(key, Buffer.from(KEY_CHECK_TEXT), KEY_CHECK_AAD).toString('base64'));
  setMeta.run('schema_version', SCHEMA_VERSION);
  setMeta.run('created_at', new Date().toISOString());
}

function openStore({ file, keyring, readOnly = false }) {
  if (!keyring?.records) throw new Error('openStore: нужен keyring');
  if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const sql = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  const key = keyring.records;
  try {
    sql.exec('PRAGMA busy_timeout = 5000');
    if (!readOnly) {
      sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
      sql.exec(SCHEMA_SQL);
    }
    checkKey(sql, key, file, readOnly);
  } catch (error) {
    sql.close();
    throw error;
  }

  const q = {
    collections: sql.prepare('SELECT name, kind, seq, data FROM collections ORDER BY seq'),
    records: sql.prepare('SELECT id, seq, data FROM records WHERE collection = ? ORDER BY seq'),
    count: sql.prepare('SELECT COUNT(*) AS n FROM collections'),
  };
  const w = readOnly ? null : prepareWrites(sql);

  // name → { kind, seq, digest, records: Map<id, { seq, digest }> }
  let state = new Map();
  let closed = false;

  function load() {
    const result = {};
    const next = new Map();
    for (const row of q.collections.all()) {
      const col = { kind: row.kind, seq: row.seq, digest: null, records: new Map() };
      if (row.kind === 'value') {
        const json = decrypt(key, row.data, valueAad(row.name)).toString('utf8');
        result[row.name] = JSON.parse(json);
        col.digest = digest(json);
      } else {
        const out = row.kind === 'list' ? [] : {};
        for (const rec of q.records.all(row.name)) {
          const json = decrypt(key, rec.data, recordAad(row.name, rec.id)).toString('utf8');
          const item = JSON.parse(json);
          if (row.kind === 'list') out.push(item);
          // defineProperty: ключ «__proto__» не должен подменить прототип.
          else Object.defineProperty(out, rec.id, { value: item, enumerable: true, writable: true, configurable: true });
          col.records.set(rec.id, { seq: rec.seq, digest: digest(json) });
        }
        result[row.name] = out;
      }
      next.set(row.name, col);
    }
    state = next;
    return result;
  }

  /** Собирает список операций для одной коллекции и её новое состояние. */
  function diffCollection(name, value, seq, ops) {
    const kind = classify(value);
    const prev = state.get(name);
    const col = { kind, seq, digest: null, records: new Map() };
    const fresh = !prev || prev.kind !== kind;
    if (prev && fresh) ops.push(() => w.deleteCollection.run(name));
    if (fresh) ops.push(() => w.insertCollection.run(name, kind, seq, null));
    else if (prev.seq !== seq) ops.push(() => w.collectionSeq.run(seq, name));

    if (kind === 'value') {
      const json = JSON.stringify(value) ?? 'null';
      col.digest = digest(json);
      if (fresh || prev.digest !== col.digest) {
        ops.push(() => w.collectionData.run(encrypt(key, Buffer.from(json), valueAad(name)), name));
      }
      return col;
    }
    const oldRecords = fresh ? new Map() : prev.records;
    entriesOf(kind, value).forEach(([id, item], index) => {
      const json = JSON.stringify(item) ?? 'null';
      const d = digest(json);
      const old = oldRecords.get(id);
      if (!old || old.digest !== d) {
        ops.push(() => w.upsertRecord.run(name, id, index, encrypt(key, Buffer.from(json), recordAad(name, id))));
      } else if (old.seq !== index) {
        ops.push(() => w.recordSeq.run(index, name, id));
      }
      col.records.set(id, { seq: index, digest: d });
    });
    for (const id of oldRecords.keys()) {
      if (!col.records.has(id)) ops.push(() => w.deleteRecord.run(name, id));
    }
    return col;
  }

  /** Записывает изменения db. Возвращает число выполненных SQL-операций. */
  function save(db) {
    if (readOnly) throw new Error('Хранилище открыто только для чтения');
    if (!isPlainObject(db)) throw new Error('save: ожидается объект db');
    const ops = [];
    const next = new Map();
    Object.keys(db)
      .filter((name) => db[name] !== undefined && typeof db[name] !== 'function')
      .forEach((name, seq) => next.set(name, diffCollection(name, db[name], seq, ops)));
    for (const name of state.keys()) {
      if (!next.has(name)) ops.push(() => w.deleteCollection.run(name));
    }
    if (ops.length) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        for (const op of ops) op();
        sql.exec('COMMIT');
      } catch (error) {
        try { sql.exec('ROLLBACK'); } catch {}
        throw error;
      }
    }
    state = next;
    return ops.length;
  }

  function isEmpty() {
    return q.count.get().n === 0;
  }

  /** Консистентная копия базы (остаётся зашифрованной тем же ключом). */
  function backupTo(target) {
    if (fs.existsSync(target)) throw new Error(`Файл уже существует: ${target}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    sql.prepare('VACUUM INTO ?').run(target);
  }

  function close() {
    if (closed) return;
    closed = true;
    sql.close();
  }

  return { file, load, save, isEmpty, backupTo, close };
}

module.exports = { openStore, classify, SCHEMA_VERSION };
