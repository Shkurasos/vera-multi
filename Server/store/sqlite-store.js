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
const { encrypt, decrypt, encryptJson, decryptJson } = require('./crypto');

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

/**
 * node:sqlite принимает только null, number, bigint, string и Buffer/Uint8Array.
 * undefined (отсутствующее поле), boolean и объекты приводим к допустимым значениям,
 * иначе одно пустое поле роняет всю транзакцию сохранения.
 */
function toSqlValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  try { return JSON.stringify(value); } catch { return null; }
}

function withSafeBinding(statements) {
  for (const name of Object.keys(statements)) {
    const stmt = statements[name];
    if (!/^(upsert|delete)/.test(name)) continue;
    const run = stmt.run.bind(stmt);
    statements[name] = { run: (...args) => run(...args.map(toSqlValue)) };
  }
  return statements;
}

function prepareExplicitWrites(sql, key) {
  return withSafeBinding({
    // users
    upsertUser: sql.prepare(`INSERT INTO users (id, username, email, password_hash, password_hash_version, avatar_url, display_name, is_bot, token_version, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, email=excluded.email, password_hash=excluded.password_hash,
        password_hash_version=excluded.password_hash_version, avatar_url=excluded.avatar_url, display_name=excluded.display_name,
        is_bot=excluded.is_bot, token_version=excluded.token_version, role=excluded.role, status=excluded.status,
        updated_at=excluded.updated_at`),
    deleteUser: sql.prepare('DELETE FROM users WHERE id = ?'),
    getUser: sql.prepare('SELECT * FROM users WHERE id = ?'),
    allUsers: sql.prepare('SELECT * FROM users'),

    // chats
    upsertChat: sql.prepare(`INSERT INTO chats (id, type, name, is_public, owner_id, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, is_public=excluded.is_public,
        owner_id=excluded.owner_id, avatar_url=excluded.avatar_url, updated_at=excluded.updated_at`),
    deleteChat: sql.prepare('DELETE FROM chats WHERE id = ?'),
    allChats: sql.prepare('SELECT * FROM chats'),

    // chat_members
    upsertChatMember: sql.prepare(`INSERT INTO chat_members (id, chat_id, user_id, role, joined_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id, user_id=excluded.user_id, role=excluded.role,
        joined_at=excluded.joined_at, is_deleted=excluded.is_deleted`),
    deleteChatMember: sql.prepare('DELETE FROM chat_members WHERE id = ?'),
    allChatMembers: sql.prepare('SELECT * FROM chat_members'),

    // messages
    upsertMessage: sql.prepare(`INSERT INTO messages (id, chat_id, sender_id, type, text, attachments, poll, reply_to_id, forward_from_id, created_at, edited_at, is_deleted, read_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id, sender_id=excluded.sender_id, type=excluded.type,
        text=excluded.text, attachments=excluded.attachments, poll=excluded.poll, reply_to_id=excluded.reply_to_id,
        forward_from_id=excluded.forward_from_id, edited_at=excluded.edited_at, is_deleted=excluded.is_deleted,
        read_by=excluded.read_by`),
    deleteMessage: sql.prepare('DELETE FROM messages WHERE id = ?'),
    allMessages: sql.prepare('SELECT * FROM messages'),

    // devices
    upsertDevice: sql.prepare(`INSERT INTO devices (id, user_id, device_id, name, token_version, is_primary, revoked, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, device_id=excluded.device_id, name=excluded.name,
        token_version=excluded.token_version, is_primary=excluded.is_primary, revoked=excluded.revoked,
        last_seen_at=excluded.last_seen_at`),
    deleteDevice: sql.prepare('DELETE FROM devices WHERE id = ?'),
    allDevices: sql.prepare('SELECT * FROM devices'),

    // bots
    upsertBot: sql.prepare(`INSERT INTO bots (id, owner_id, username, name, token_hash, webhook_url, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, username=excluded.username, name=excluded.name,
        token_hash=excluded.token_hash, webhook_url=excluded.webhook_url, is_active=excluded.is_active`),
    deleteBot: sql.prepare('DELETE FROM bots WHERE id = ?'),
    allBots: sql.prepare('SELECT * FROM bots'),

    // refresh_tokens
    upsertRefreshToken: sql.prepare(`INSERT INTO refresh_tokens (id, user_id, device_id, token_hash, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, device_id=excluded.device_id, token_hash=excluded.token_hash,
        expires_at=excluded.expires_at, revoked_at=excluded.revoked_at`),
    deleteRefreshToken: sql.prepare('DELETE FROM refresh_tokens WHERE id = ?'),
    allRefreshTokens: sql.prepare('SELECT * FROM refresh_tokens'),

    // user_stores
    upsertUserStore: sql.prepare(`INSERT INTO user_stores (user_id, store_name, data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, store_name) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`),
    deleteUserStore: sql.prepare('DELETE FROM user_stores WHERE user_id = ? AND store_name = ?'),
    allUserStores: sql.prepare('SELECT * FROM user_stores'),

    // ip_bans
    upsertIpBan: sql.prepare(`INSERT INTO ip_bans (id, ip_hash, reason, banned_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ip_hash=excluded.ip_hash, reason=excluded.reason, banned_at=excluded.banned_at, expires_at=excluded.expires_at`),
    deleteIpBan: sql.prepare('DELETE FROM ip_bans WHERE id = ?'),
    allIpBans: sql.prepare('SELECT * FROM ip_bans'),

    // moderation_bans
    upsertModerationBan: sql.prepare(`INSERT INTO moderation_bans (id, user_id, device_id, reason, banned_by, banned_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, device_id=excluded.device_id, reason=excluded.reason,
        banned_by=excluded.banned_by, banned_at=excluded.banned_at, expires_at=excluded.expires_at`),
    deleteModerationBan: sql.prepare('DELETE FROM moderation_bans WHERE id = ?'),
    allModerationBans: sql.prepare('SELECT * FROM moderation_bans'),
  });
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

const piiAad = (table, column, id) => `pii\0${table}\0${column}\0${id}`;
const sha256 = (data) => crypto.createHash('sha256').update(String(data)).digest('hex');

function encryptPiiField(key, table, column, id, value) {
  if (value === undefined || value === null) return null;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
  return encrypt(key, buffer, piiAad(table, column, id));
}

function decryptPiiField(key, table, column, id, envelope) {
  if (!envelope) return null;
  const buf = Buffer.from(envelope, 'base64');
  return decryptJson(key, buf, piiAad(table, column, id));
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
  const ew = readOnly ? null : prepareExplicitWrites(sql, key);

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

  /**
   * Загружает явные таблицы в объект db (дополнительно к коллекциям).
   * Добавляет только записи, которых в db ещё нет по id: коллекции уже
   * содержат полные объекты, а явные таблицы — их урезанные копии. Раньше
   * копии дописывались поверх, в db.users появлялся второй «тот же»
   * пользователь без имени, а в db.messages — дубли без content.
   */
  function loadExplicitTables(db) {
    if (ew === null) throw new Error('Хранилище открыто только для чтения');
    const seen = new Map();
    const pushMissing = (list, record) => {
      let ids = seen.get(list);
      if (!ids) {
        ids = new Set(list.map(item => item && item.id));
        seen.set(list, ids);
      }
      if (record.id == null || ids.has(record.id)) return;
      ids.add(record.id);
      list.push(record);
    };
    db.users = db.users || [];
    for (const row of ew.allUsers.all()) {
      pushMissing(db.users, {
        id: row.id, username: row.username,
        email: decryptPiiField(key, 'users', 'email', row.id, row.email),
        passwordHash: row.password_hash,
        passwordHashVersion: row.password_hash_version,
        avatarUrl: row.avatar_url, displayName: row.display_name,
        isBot: Boolean(row.is_bot), tokenVersion: row.token_version,
        role: row.role, status: row.status,
        createdAt: row.created_at, updatedAt: row.updated_at,
      });
    }
    db.chats = db.chats || [];
    for (const row of ew.allChats.all()) {
      pushMissing(db.chats, {
        id: row.id, type: row.type, name: row.name,
        isPublic: Boolean(row.is_public), ownerId: row.owner_id,
        avatarUrl: row.avatar_url, createdAt: row.created_at, updatedAt: row.updated_at,
      });
    }
    db.chatMembers = db.chatMembers || [];
    for (const row of ew.allChatMembers.all()) {
      pushMissing(db.chatMembers, {
        id: row.id, chatId: row.chat_id, userId: row.user_id,
        role: row.role, joinedAt: row.joined_at, isDeleted: Boolean(row.is_deleted),
      });
    }
    db.messages = db.messages || [];
    for (const row of ew.allMessages.all()) {
      pushMissing(db.messages, {
        id: row.id, chatId: row.chat_id, senderId: row.sender_id, type: row.type,
        text: decryptPiiField(key, 'messages', 'text', row.id, row.text),
        attachments: decryptPiiField(key, 'messages', 'attachments', row.id, row.attachments),
        poll: decryptPiiField(key, 'messages', 'poll', row.id, row.poll),
        replyToId: row.reply_to_id, forwardFromId: row.forward_from_id,
        createdAt: row.created_at, editedAt: row.edited_at,
        isDeleted: Boolean(row.is_deleted),
        readBy: row.read_by ? JSON.parse(row.read_by) : [],
      });
    }
    db.devices = db.devices || [];
    for (const row of ew.allDevices.all()) {
      pushMissing(db.devices, {
        id: row.id, userId: row.user_id, deviceId: row.device_id, name: row.name,
        tokenVersion: row.token_version, isPrimary: Boolean(row.is_primary),
        revoked: Boolean(row.revoked), createdAt: row.created_at, lastSeenAt: row.last_seen_at,
      });
    }
    db.bots = db.bots || [];
    for (const row of ew.allBots.all()) {
      pushMissing(db.bots, {
        id: row.id, userId: row.owner_id, username: row.username, name: row.name,
        tokenHash: row.token_hash,
        webhookUrl: decryptPiiField(key, 'bots', 'webhook_url', row.id, row.webhook_url),
        isActive: Boolean(row.is_active), createdAt: row.created_at,
      });
    }
    db.refreshTokens = db.refreshTokens || [];
    for (const row of ew.allRefreshTokens.all()) {
      pushMissing(db.refreshTokens, {
        id: row.id, userId: row.user_id, deviceId: row.device_id,
        tokenHash: row.token_hash, expiresAt: row.expires_at, revokedAt: row.revoked_at,
      });
    }
    db.userStores = db.userStores || {};
    for (const row of ew.allUserStores.all()) {
      if (!db.userStores[row.user_id]) db.userStores[row.user_id] = {};
      db.userStores[row.user_id][row.store_name] = {
        data: decryptPiiField(key, 'user_stores', 'data', row.user_id, row.data),
        __updatedAt: row.updated_at,
      };
    }
    db.ipBans = db.ipBans || [];
    for (const row of ew.allIpBans.all()) {
      pushMissing(db.ipBans, {
        id: row.id, ip: row.ip_hash, reason: row.reason,
        createdAt: row.banned_at, expiresAt: row.expires_at,
      });
    }
    db.moderationBans = db.moderationBans || [];
    for (const row of ew.allModerationBans.all()) {
      pushMissing(db.moderationBans, {
        id: row.id, userId: row.user_id, deviceId: row.device_id,
        reason: row.reason, bannedBy: row.banned_by,
        bannedAt: row.banned_at, expiresAt: row.expires_at,
      });
    }
  }

  /** Сохраняет явные таблицы из объекта db (PII шифруется, хеши как есть). */
  function saveExplicitTables(db) {
    if (ew === null) throw new Error('Хранилище открыто только для чтения');
    sql.exec('BEGIN IMMEDIATE');
    try {
      if (Array.isArray(db.users)) {
        for (const u of db.users) {
          if (!u.passwordHash) continue; // без пароля нечего сохранять в явную таблицу
          ew.upsertUser.run(
            u.id, u.username,
            encryptPiiField(key, 'users', 'email', u.id, u.email),
            u.passwordHash, u.passwordHashVersion || 2,
            u.avatarUrl, u.displayName, u.isBot ? 1 : 0,
            u.tokenVersion || 0, u.role || 'user', u.status || null,
            u.createdAt || new Date().toISOString(), u.updatedAt || new Date().toISOString()
          );
        }
      }
      if (Array.isArray(db.chats)) {
        for (const c of db.chats) {
          ew.upsertChat.run(
            c.id, c.type || 'direct', c.name || null, c.isPublic ? 1 : 0,
            c.ownerId || null, c.avatarUrl || null,
            c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()
          );
        }
      }
      if (Array.isArray(db.chatMembers)) {
        for (const m of db.chatMembers) {
          ew.upsertChatMember.run(
            m.id, m.chatId, m.userId, m.role || 'member',
            m.joinedAt || new Date().toISOString(), m.isDeleted ? 1 : 0
          );
        }
      }
      if (Array.isArray(db.messages)) {
        for (const m of db.messages) {
          ew.upsertMessage.run(
            m.id, m.chatId, m.senderId, m.type || 'text',
            encryptPiiField(key, 'messages', 'text', m.id, m.text),
            encryptPiiField(key, 'messages', 'attachments', m.id, m.attachments),
            encryptPiiField(key, 'messages', 'poll', m.id, m.poll),
            m.replyToId || null, m.forwardFromId || null,
            m.createdAt || new Date().toISOString(), m.editedAt || null, m.isDeleted ? 1 : 0,
            m.readBy ? JSON.stringify(m.readBy) : '[]'
          );
        }
      }
      if (Array.isArray(db.devices)) {
        for (const d of db.devices) {
          ew.upsertDevice.run(
            d.id, d.userId, d.deviceId, d.name || null,
            d.tokenVersion || 0, d.isPrimary ? 1 : 0, d.revoked ? 1 : 0,
            d.createdAt || new Date().toISOString(), d.lastSeenAt || null
          );
        }
      }
      if (Array.isArray(db.bots)) {
        for (const b of db.bots) {
          ew.upsertBot.run(
            b.id, b.userId, b.username, b.name || null,
            b.tokenHash,
            encryptPiiField(key, 'bots', 'webhook_url', b.id, b.webhookUrl),
            b.isActive ? 1 : 0,
            b.createdAt || new Date().toISOString()
          );
        }
      }
      if (Array.isArray(db.refreshTokens)) {
        for (const t of db.refreshTokens) {
          ew.upsertRefreshToken.run(
            t.id, t.userId, t.deviceId, t.tokenHash,
            t.expiresAt, t.revokedAt || null
          );
        }
      }
      if (db.userStores && typeof db.userStores === 'object') {
        for (const userId of Object.keys(db.userStores)) {
          const stores = db.userStores[userId];
          for (const storeName of Object.keys(stores)) {
            const store = stores[storeName];
            ew.upsertUserStore.run(
              userId, storeName,
              encryptPiiField(key, 'user_stores', 'data', userId, store?.data),
              store.__updatedAt || new Date().toISOString()
            );
          }
        }
      }
      if (Array.isArray(db.ipBans)) {
        for (const b of db.ipBans) {
          ew.upsertIpBan.run(
            b.id, sha256(b.ip || b.ipHash || ''), b.reason || null,
            b.bannedAt || b.createdAt || new Date().toISOString(), b.expiresAt || null
          );
        }
      }
      if (Array.isArray(db.moderationBans)) {
        for (const b of db.moderationBans) {
          ew.upsertModerationBan.run(
            b.id, b.userId, b.deviceId || null, b.reason || null,
            b.bannedBy || null, b.bannedAt || new Date().toISOString(), b.expiresAt || null
          );
        }
      }
      sql.exec('COMMIT');
    } catch (error) {
      try { sql.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  return { file, load, save, isEmpty, backupTo, close, loadExplicitTables, saveExplicitTables };
}

module.exports = { openStore, classify, SCHEMA_VERSION };
