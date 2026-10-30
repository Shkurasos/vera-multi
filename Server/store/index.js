'use strict';
/**
 * Источник данных сервера: один интерфейс для двух драйверов.
 *
 *   STORE_DRIVER=sqlite (по умолчанию) — зашифрованный node:sqlite (vera-store.db).
 *   STORE_DRIVER=json                  — старый открытый vera.json (откат/отладка).
 *
 * Оба драйвера отдают { kind, file, load(), save(db), close() }.
 *
 * Переезд: если база SQLite ещё пустая, а рядом лежит vera.json, данные
 * импортируются из него один раз. Сам vera.json не трогаем (его можно
 * удалить вручную после проверки — в нём всё открытым текстом).
 */
const fs = require('node:fs');
const path = require('node:path');
const { createKeyring, resolveKek } = require('./crypto');
const { openStore } = require('./sqlite-store');

function resolvePaths(env = process.env, baseDir = path.join(__dirname, '..')) {
  const dataDir = env.DATA_DIR || path.join(baseDir, 'data');
  const jsonFile = env.DB_FILE || path.join(dataDir, 'vera.json');
  // По умолчанию база лежит рядом с vera.json: тесты и утилиты, задающие свой
  // DB_FILE, не должны случайно писать в общий Server/data.
  const storeFile = env.STORE_FILE || path.join(env.DB_FILE ? path.dirname(jsonFile) : dataDir, 'vera-store.db');
  return {
    driver: String(env.STORE_DRIVER || 'sqlite').trim().toLowerCase(),
    jsonFile,
    storeFile,
    keyDir: path.dirname(storeFile),
  };
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, db) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(db, null, 2));
  fs.renameSync(temporary, file);
}

function openJsonSource(file) {
  return {
    kind: 'json',
    file,
    exists: () => fs.existsSync(file),
    load: () => (fs.existsSync(file) ? readJsonFile(file) : null),
    save: (db) => writeJsonFile(file, db),
    close() {},
  };
}

function openSqliteSource({ storeFile, jsonFile, keyDir, env, log, readOnly = false }) {
  if (readOnly && !fs.existsSync(storeFile)) {
    // Переезд ещё не случился: читаем старый JSON, ничего не создавая.
    return fs.existsSync(jsonFile) ? { ...openJsonSource(jsonFile), save() { throw new Error('read-only'); } } : null;
  }
  // Новый ключ разрешено создать только для новой базы: для существующей он бесполезен.
  const keyring = createKeyring(resolveKek({ env, dataDir: keyDir, log, allowCreate: !fs.existsSync(storeFile) }));
  const store = openStore({ file: storeFile, keyring, readOnly });
  let importedFrom = null;
  return {
    kind: 'sqlite',
    file: storeFile,
    keyring,
    exists: () => true,
    get importedFrom() { return importedFrom; },
    load() {
      if (!readOnly && store.isEmpty() && fs.existsSync(jsonFile)) {
        const legacy = readJsonFile(jsonFile);
        store.save(legacy);
        importedFrom = jsonFile;
        log.warn(`[store] данные импортированы из ${jsonFile} в зашифрованное хранилище ${storeFile}. `
          + 'Старый vera.json хранит всё открытым текстом — удалите его после проверки.');
      }
      return store.isEmpty() ? null : store.load();
    },
    loadExplicitTables: (db) => store.loadExplicitTables(db),
    saveExplicitTables: (db) => store.saveExplicitTables(db),
    save: (db) => store.save(db),
    backupTo: (target) => store.backupTo(target),
    close: () => store.close(),
  };
}

/**
 * Открывает источник данных по окружению.
 * readOnly — для CLI-утилит, которые только читают (sqlite-база не создаётся).
 */
function openDataSource({ env = process.env, baseDir, log = console, readOnly = false } = {}) {
  const paths = resolvePaths(env, baseDir);
  if (paths.driver === 'json') {
    if (readOnly && !fs.existsSync(paths.jsonFile)) return null;
    return openJsonSource(paths.jsonFile);
  }
  if (paths.driver !== 'sqlite') throw new Error(`Неизвестный STORE_DRIVER=${paths.driver} (ожидается sqlite или json)`);
  return openSqliteSource({ ...paths, env, log, readOnly });
}

module.exports = { openDataSource, resolvePaths, readJsonFile, writeJsonFile };
