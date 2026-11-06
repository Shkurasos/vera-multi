const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Анти-мультиаккаунтинг: лимит аккаунтов на устройство/сеть по НЕОБРАТИМЫМ
// HMAC-хэшам. Проверяем, что сырые IP/отпечатки не хранятся, что считаются
// только разные userId и что лимиты (устройство: 2, сеть: 3) срабатывают.
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function setup() {
  const context = vm.createContext({
    crypto,
    JWT_SECRET: 'test-secret-key-at-least-32-characters-long!!',
    db: { regLedger: [] },
    Date,
    // requestIp объявлен выше в server.js (вне нашего slice) — мокаем.
    requestIp: (req) => String(req.ip || '').trim().toLowerCase(),
  });
  // Слайсим ровно блок анти-мультиаккаунтинга.
  const start = source.indexOf('const MAX_ACCOUNTS_PER_DEVICE');
  const end = source.indexOf('function recordModerationIp(');
  vm.runInContext(source.slice(start, end), context);
  return context;
}

const reqWith = (ip, fpHash) => ({ ip, socket: {}, body: fpHash ? { fpHash } : {} });
const FP = 'a'.repeat(32);

test('regHmac необратим и не хранит сырое значение', () => {
  const c = setup();
  const h = c.regHmac('ip:203.0.113.5');
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.notEqual(h, '203.0.113.5');
  // Одинаковый вход → одинаковый хэш (можно сравнивать устройства).
  assert.equal(h, c.regHmac('ip:203.0.113.5'));
  assert.notEqual(h, c.regHmac('ip:203.0.113.6'));
});

test('некорректный fpHash игнорируется (device-лимит не применяется)', () => {
  const c = setup();
  assert.equal(c.deviceFingerprintHash({ body: { fpHash: 'not hex!' } }), null);
  assert.equal(c.deviceFingerprintHash({ body: {} }), null);
  assert.match(c.deviceFingerprintHash({ body: { fpHash: FP } }), /^[a-f0-9]{64}$/);
});

test('лимит устройства: 2 аккаунта проходят, 3-й отклоняется', () => {
  const c = setup();
  for (const uid of ['u1', 'u2']) {
    const check = c.checkRegistrationLimits(reqWith('10.0.0.1', FP));
    assert.equal(check.ok, true);
    c.recordRegistration(uid, check.deviceHash, check.ipHash);
  }
  // Третий с того же отпечатка, но ДРУГОЙ IP (чтобы сработал именно device-лимит).
  const third = c.checkRegistrationLimits(reqWith('10.0.0.99', FP));
  assert.equal(third.ok, false);
  assert.match(third.message, /устройства/);
});

test('лимит сети: 3 аккаунта проходят, 4-й отклоняется (разные устройства)', () => {
  const c = setup();
  for (let i = 0; i < 3; i++) {
    const check = c.checkRegistrationLimits(reqWith('198.51.100.7', 'b'.repeat(32 + i)));
    assert.equal(check.ok, true, 'аккаунт ' + i);
    c.recordRegistration('user' + i, check.deviceHash, check.ipHash);
  }
  const fourth = c.checkRegistrationLimits(reqWith('198.51.100.7', 'c'.repeat(40)));
  assert.equal(fourth.ok, false);
  assert.match(fourth.message, /сети/);
});

test('повторная регистрация того же userId не раздувает счётчик', () => {
  const c = setup();
  const check = c.checkRegistrationLimits(reqWith('10.0.0.2', FP));
  c.recordRegistration('same', check.deviceHash, check.ipHash);
  c.recordRegistration('same', check.deviceHash, check.ipHash);
  // Один и тот же userId — устройство ещё не исчерпано (учитываются разные id).
  assert.equal(c.countAccountsForHash('device', check.deviceHash), 1);
});

test('в реестре хранятся только хэши, без сырых IP и fpHash', () => {
  const c = setup();
  const check = c.checkRegistrationLimits(reqWith('203.0.113.200', FP));
  c.recordRegistration('u', check.deviceHash, check.ipHash);
  const dump = JSON.stringify(c.db.regLedger);
  assert.equal(dump.includes('203.0.113.200'), false);
  assert.equal(dump.includes(FP), false);
  for (const e of c.db.regLedger) assert.match(e.h, /^[a-f0-9]{64}$/);
});
