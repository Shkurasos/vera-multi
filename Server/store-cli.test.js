const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDataSource } = require('./store');
const { run } = require('./store-cli');

const quiet = { warn() {}, log() {} };

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-cli-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
}

function seed(env, db) {
  const s = openDataSource({ env, log: quiet });
  s.load();
  s.save(db);
  s.close();
}

test('key печатает ключ из файла, export расшифровывает базу', () => {
  withDir((dir) => {
    const env = { DB_FILE: path.join(dir, 'vera.json') };
    seed(env, { users: [{ id: 'u1', username: 'анна', passwordHash: '$argon2id$v=19$x' }] });

    const lines = [];
    run(['key'], { env, out: (l) => lines.push(l) });
    assert.equal(lines[0], fs.readFileSync(path.join(dir, 'vera-dev.kek'), 'utf8').trim());

    const out = path.join(dir, 'export.json');
    run(['export', '--out', out], { env, out() {} });
    const db = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(db.users[0].username, 'анна');
    assert.equal(db.users[0].passwordHash, '$argon2id$v=19$x', 'пароль остаётся хэшем');
    assert.throws(() => run(['export', '--out', out], { env, out() {} }), /уже существует/);
  });
});

test('rekey перешифровывает базу: открывается только новым ключом', () => {
  withDir((dir) => {
    const env = { DB_FILE: path.join(dir, 'vera.json') };
    seed(env, { users: [{ id: 'u1', username: 'боб' }], counter: 7 });
    const newKek = crypto.randomBytes(32).toString('base64');

    assert.throws(() => run(['rekey'], { env, out() {} }), /NEW_VERA_KEK/);
    run(['rekey'], { env: { ...env, NEW_VERA_KEK: newKek }, out() {}, now: 1 });

    const withNew = openDataSource({ env: { ...env, VERA_KEK: newKek }, log: quiet });
    try {
      assert.deepEqual(withNew.load(), { users: [{ id: 'u1', username: 'боб' }], counter: 7 });
    } finally { withNew.close(); }
    // Старый ключ (vera-dev.kek) к новой базе не подходит.
    assert.throws(() => openDataSource({ env, log: quiet }), /Неверный VERA_KEK/);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('vera-store.db.bak-')), 'старая копия сохранена');
  });
});

test('неизвестная команда и отсутствующая база дают понятную ошибку', () => {
  withDir((dir) => {
    const env = { DB_FILE: path.join(dir, 'vera.json') };
    assert.throws(() => run(['oops'], { env }), /Команды/);
    assert.throws(() => run(['key'], { env, out() {} }), /не найдено/);
  });
});
