const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Регистрация/вход по нику и паролю: проверяем привязку установки к аккаунту
// (bindInstallationForUser) и то, что /auth/device больше не создаёт аккаунты.
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function setup() {
  const context = vm.createContext({ crypto, uuidv4: crypto.randomUUID, Date,
    MAX_DEVICES_PER_ACCOUNT: 100, db: { devices: [], linkInvites: [], users: [], chats: [], chatMembers: [] },
    saveDb() {}, verifyAccessToken() { throw Error('unauthorized'); } });
  vm.runInContext(source.slice(source.indexOf('function normalizeDeviceId('), source.indexOf('function createSavedMessagesChat(')), context);
  return context;
}
function response() {
  return { statusCode: 200, cookies: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, cookie(name, value) { this.cookies[name] = value; } };
}

test('вход паролем на новом браузере создаёт устройство и cookie установки', () => {
  const c = setup(); const res = response();
  const device = c.bindInstallationForUser({ body: { deviceId: 'whatever' }, headers: {} }, res, { id: 'u1' }, 'Laptop');
  assert.ok(device);
  assert.equal(device.userId, 'u1');
  assert.equal(device.isPrimary, true);
  assert.match(res.cookies.vera_installation, /^[a-f0-9]{64}$/);
  // Публичный deviceId клиента не используется как идентификатор.
  assert.notEqual(device.deviceId, 'whatever');
  // Повторный вход с той же cookie — то же устройство, без дублей.
  const again = c.bindInstallationForUser({ body: {}, headers: {}, cookies: res.cookies }, response(), { id: 'u1' }, 'Laptop');
  assert.equal(again.id, device.id);
  assert.equal(c.db.devices.length, 1);
});

test('установка чужого аккаунта не переписывается: выдаётся новое устройство', () => {
  const c = setup(); const res = response();
  const first = c.bindInstallationForUser({ body: {}, headers: {} }, res, { id: 'alice' }, 'PC');
  const second = c.bindInstallationForUser({ body: {}, headers: {}, cookies: res.cookies }, response(), { id: 'bob' }, 'PC');
  assert.notEqual(second.id, first.id);
  assert.equal(first.userId, 'alice');
  assert.equal(second.userId, 'bob');
  assert.equal(c.db.devices.length, 2);
});

test('отвязанное устройство возвращается паролем с новой версией токенов', () => {
  const c = setup(); const res = response();
  const dev = c.bindInstallationForUser({ body: {}, headers: {} }, res, { id: 'u1' }, 'PC');
  dev.revoked = true; dev.loggedOut = true;
  const back = c.bindInstallationForUser({ body: {}, headers: {}, cookies: res.cookies }, response(), { id: 'u1' }, 'PC');
  assert.equal(back.id, dev.id);
  assert.equal(back.revoked, false);
  assert.equal(back.loggedOut, false);
  assert.equal(back.tokenVersion, 1);
});

test('забаненное устройство не может войти паролем', () => {
  const c = setup();
  c.db.moderationBans = [{ kind: 'account', userId: 'u1' }];
  const res = response();
  assert.equal(c.bindInstallationForUser({ body: {}, headers: {} }, res, { id: 'u1' }, 'PC'), null);
  assert.equal(res.statusCode, 403);
});

test('/auth/device больше не создаёт аккаунт без пароля', () => {
  const start = source.indexOf("app.post('/api/auth/device'");
  const route = source.slice(start, source.indexOf('// ─── Устаревшие маршруты', start));
  assert.doesNotMatch(route, /db\.users\.push/);
  assert.doesNotMatch(route, /createAccount/);
  assert.match(route, /unregistered_device/);
  // После выхода авто-вход по cookie установки запрещён.
  assert.match(route, /!existingDevice\.loggedOut/);
});

test('регистрация требует ник и пароль, почта необязательна, админские ники заняты', () => {
  const start = source.indexOf("app.post('/api/auth/register'");
  const route = source.slice(start, source.indexOf("app.post('/api/auth/login'", start));
  assert.match(route, /\[a-zA-Z0-9_\.\]\{3,32\}/);
  assert.match(route, /password\.length < 12/);
  assert.match(route, /email && !/);
  assert.match(route, /isAdminUsername\(username\)/);
});
