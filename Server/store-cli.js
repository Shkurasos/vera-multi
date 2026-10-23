#!/usr/bin/env node
'use strict';
/**
 * Обслуживание зашифрованного хранилища (vera-store.db). Сервер должен быть
 * остановлен: команды читают и пишут базу напрямую.
 *
 *   node store-cli.js key
 *       Печатает текущий ключ (VERA_KEK или data/vera-dev.kek) в base64.
 *       Сохраните его вне сервера: без ключа база не расшифровывается.
 *
 *   node store-cli.js export --out <file.json>
 *       Расшифровывает базу в JSON (например, для выдачи данных по запросу).
 *       Пароли в выгрузке остаются хэшами Argon2id: их нельзя расшифровать.
 *
 *   NEW_VERA_KEK=<base64> node store-cli.js rekey
 *       Перешифровывает базу новым ключом. Старый файл остаётся рядом как
 *       vera-store.db.bak-<время>. После проверки задайте VERA_KEK=<новый ключ>.
 *
 * Пути берутся из тех же переменных, что у сервера (DATA_DIR, DB_FILE, STORE_FILE).
 */
const fs = require('node:fs');
const path = require('node:path');
const { createKeyring, resolveKek, decodeKey, MIN_KEK_BYTES } = require('./store/crypto');
const { openStore } = require('./store/sqlite-store');
const { resolvePaths } = require('./store');

const quiet = { warn() {}, log() {} };

function currentKek(env, paths) {
  if (!fs.existsSync(paths.storeFile)) throw new Error(`Хранилище не найдено: ${paths.storeFile}`);
  return resolveKek({ env, dataDir: paths.keyDir, log: quiet, allowCreate: false, isProd: false });
}

function cmdKey({ env, paths, out }) {
  out(currentKek(env, paths).toString('base64'));
}

function cmdExport({ env, paths, args, out }) {
  const target = args.out;
  if (!target) throw new Error('Укажите --out <file.json>');
  if (fs.existsSync(target)) throw new Error(`Файл уже существует: ${target}`);
  const store = openStore({ file: paths.storeFile, keyring: createKeyring(currentKek(env, paths)), readOnly: true });
  try {
    const db = store.load();
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(db, null, 2), { mode: 0o600 });
    out(`Выгружено коллекций: ${Object.keys(db).length} → ${target}`);
  } finally {
    store.close();
  }
}

function cmdRekey({ env, paths, out, now = Date.now() }) {
  const next = decodeKey(env.NEW_VERA_KEK);
  if (!next || next.length < MIN_KEK_BYTES) throw new Error(`NEW_VERA_KEK: нужен ключ base64/hex не короче ${MIN_KEK_BYTES} байт`);
  const oldKek = currentKek(env, paths);
  if (oldKek.equals(next)) throw new Error('Новый ключ совпадает с текущим');

  const source = openStore({ file: paths.storeFile, keyring: createKeyring(oldKek), readOnly: true });
  let db;
  try { db = source.load(); } finally { source.close(); }

  const fresh = `${paths.storeFile}.rekey-${now}`;
  const target = openStore({ file: fresh, keyring: createKeyring(next) });
  try {
    target.save(db);
  } catch (error) {
    target.close();
    fs.rmSync(fresh, { force: true });
    throw error;
  }
  target.close();
  for (const suffix of ['-wal', '-shm']) fs.rmSync(fresh + suffix, { force: true });

  const backup = `${paths.storeFile}.bak-${now}`;
  fs.renameSync(paths.storeFile, backup);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(paths.storeFile + suffix)) fs.renameSync(paths.storeFile + suffix, backup + suffix);
  }
  fs.renameSync(fresh, paths.storeFile);
  out(`База перешифрована. Старая копия: ${backup}`);
  out('Теперь задайте VERA_KEK=<новый ключ> и запустите сервер. Файл vera-dev.kek после проверки можно удалить.');
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--out') args.out = rest[++i];
  }
  return { command, args };
}

const COMMANDS = { key: cmdKey, export: cmdExport, rekey: cmdRekey };

function run(argv, { env = process.env, out = console.log } = {}) {
  const { command, args } = parseArgs(argv);
  const handler = COMMANDS[command];
  if (!handler) throw new Error('Команды: key | export --out <file.json> | rekey (с NEW_VERA_KEK)');
  const paths = resolvePaths(env);
  if (paths.driver !== 'sqlite') throw new Error('store-cli работает только с STORE_DRIVER=sqlite');
  return handler({ env, paths, args, out });
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { run };
