const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sc = require('./store/crypto');

const keyring = () => sc.createKeyring(crypto.randomBytes(32));

test('AES-GCM: round-trip и уникальный nonce', () => {
  const k = keyring();
  const a = sc.encrypt(k.records, Buffer.from('привет'), 'aad');
  const b = sc.encrypt(k.records, Buffer.from('привет'), 'aad');
  assert.notDeepEqual(a, b, 'одинаковый текст даёт разный шифротекст');
  assert.equal(sc.decrypt(k.records, a, 'aad').toString(), 'привет');
  assert.ok(!a.includes(Buffer.from('привет')), 'текста нет в открытом виде');
});

test('AES-GCM: чужой AAD, ключ или подмена байта отвергаются', () => {
  const k = keyring();
  const env = sc.encryptJson(k.records, { text: 'секрет' }, 'record\0messages\0m1');
  assert.throws(() => sc.decrypt(k.records, env, 'record\0messages\0m2'), 'перестановка записи');
  assert.throws(() => sc.decrypt(keyring().records, env, 'record\0messages\0m1'), 'другой ключ');
  const tampered = Buffer.from(env);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => sc.decrypt(k.records, tampered, 'record\0messages\0m1'), 'подмена шифротекста');
  assert.throws(() => sc.decrypt(k.records, Buffer.alloc(5), 'x'), /Повреждённый/);
  assert.deepEqual(sc.decryptJson(k.records, env, 'record\0messages\0m1'), { text: 'секрет' });
});

test('HKDF: подключи детерминированы и различаются по назначению', () => {
  const kek = crypto.randomBytes(32);
  const a = sc.createKeyring(kek);
  const b = sc.createKeyring(kek);
  assert.deepEqual(a.records, b.records);
  assert.notDeepEqual(a.records, a.files);
  assert.notDeepEqual(a.records, kek.subarray(0, 32));
  assert.throws(() => sc.createKeyring(crypto.randomBytes(16)), /не короче/);
});

test('KEK: base64/hex, REQUIRE_VERA_KEK, ключ-файл переживает рестарт', () => {
  const raw = crypto.randomBytes(32);
  assert.deepEqual(sc.resolveKek({ env: { VERA_KEK: raw.toString('base64') } }), raw);
  assert.deepEqual(sc.resolveKek({ env: { VERA_KEK: raw.toString('hex') } }), raw);
  assert.throws(() => sc.resolveKek({ env: { VERA_KEK: 'short' } }), /VERA_KEK/);
  assert.throws(() => sc.resolveKek({ env: { REQUIRE_VERA_KEK: '1' }, dataDir: os.tmpdir() }), /VERA_KEK/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-kek-'));
  try {
    const warnings = [];
    const log = { warn: (m) => warnings.push(m) };
    const first = sc.resolveKek({ env: {}, dataDir: dir, log });
    assert.equal(first.length, 32);
    assert.deepEqual(sc.resolveKek({ env: {}, dataDir: dir, log }), first, 'тот же ключ после рестарта');
    // Прод без ключа стартует (временный режим), но громко предупреждает.
    warnings.length = 0;
    assert.deepEqual(sc.resolveKek({ env: { NODE_ENV: 'production' }, dataDir: dir, log }), first);
    assert.ok(warnings.some((m) => /VERA_KEK не задан/.test(m)));
    assert.throws(() => sc.resolveKek({ env: {}, dataDir: path.join(dir, 'none'), log, allowCreate: false }), /Нет ключа/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
