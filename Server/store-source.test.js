const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDataSource, resolvePaths } = require('./store');

const quiet = { warn() {}, log() {} };

function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-source-'));
  try { return run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('пути: база рядом с DB_FILE, драйвер по умолчанию — sqlite', () => {
  const p = resolvePaths({ DB_FILE: path.join('x', 'y', 'vera.json') }, 'base');
  assert.equal(p.driver, 'sqlite');
  assert.equal(p.storeFile, path.join('x', 'y', 'vera-store.db'));
  assert.equal(resolvePaths({ DATA_DIR: '/data' }).storeFile, path.join('/data', 'vera-store.db'));
  assert.equal(resolvePaths({ STORE_FILE: 's.db', DB_FILE: 'a/v.json' }).storeFile, 's.db');
  assert.throws(() => openDataSource({ env: { STORE_DRIVER: 'mongo' } }), /STORE_DRIVER/);
});

test('старый vera.json импортируется один раз и дальше не читается', () => {
  withDir((dir) => {
    const env = { DB_FILE: path.join(dir, 'vera.json'), VERA_KEK: crypto.randomBytes(32).toString('base64') };
    fs.writeFileSync(env.DB_FILE, JSON.stringify({ users: [{ id: 'u1', username: 'old' }] }));

    const first = openDataSource({ env, log: quiet });
    assert.deepEqual(first.load(), { users: [{ id: 'u1', username: 'old' }] });
    assert.equal(first.importedFrom, env.DB_FILE);
    first.save({ users: [{ id: 'u1', username: 'new' }] });
    first.close();

    // JSON остался как был — но сервер его больше не читает.
    fs.writeFileSync(env.DB_FILE, JSON.stringify({ users: [{ id: 'u1', username: 'IGNORED' }] }));
    const second = openDataSource({ env, log: quiet });
    try {
      assert.equal(second.load().users[0].username, 'new');
      assert.equal(second.importedFrom, null);
    } finally { second.close(); }
  });
});

test('пустая установка: база создаётся, dev-ключ рядом, повторный старт открывает её', () => {
  withDir((dir) => {
    const env = { DB_FILE: path.join(dir, 'vera.json') };
    const s1 = openDataSource({ env, log: quiet });
    assert.equal(s1.load(), null, 'данных ещё нет');
    s1.save({ users: [{ id: 'u1' }] });
    s1.close();
    assert.ok(fs.existsSync(path.join(dir, 'vera-dev.kek')));
    const s2 = openDataSource({ env, log: quiet });
    try { assert.deepEqual(s2.load(), { users: [{ id: 'u1' }] }); } finally { s2.close(); }

    // Ключ потерян — новый не генерируется молча поверх существующей базы.
    fs.rmSync(path.join(dir, 'vera-dev.kek'));
    assert.throws(() => openDataSource({ env, log: quiet }), /ключа/);
    assert.ok(!fs.existsSync(path.join(dir, 'vera-dev.kek')), 'новый ключ не создан');
  });
});

test('read-only режим утилит ничего не создаёт и читает старый JSON', () => {
  withDir((dir) => {
    const env = { DB_FILE: path.join(dir, 'vera.json') };
    assert.equal(openDataSource({ env, readOnly: true, log: quiet }), null);
    fs.writeFileSync(env.DB_FILE, JSON.stringify({ users: [] }));
    const ro = openDataSource({ env, readOnly: true, log: quiet });
    assert.deepEqual(ro.load(), { users: [] });
    assert.throws(() => ro.save({}), /read-only/);
    assert.deepEqual(fs.readdirSync(dir), ['vera.json'], 'ни базы, ни ключа');
  });
});

test('STORE_DRIVER=json — прежний открытый файл для отката', () => {
  withDir((dir) => {
    const env = { STORE_DRIVER: 'json', DB_FILE: path.join(dir, 'vera.json') };
    const s = openDataSource({ env });
    s.save({ users: [{ id: 'u1' }] });
    assert.deepEqual(JSON.parse(fs.readFileSync(env.DB_FILE, 'utf8')), { users: [{ id: 'u1' }] });
    assert.deepEqual(s.load(), { users: [{ id: 'u1' }] });
  });
});
