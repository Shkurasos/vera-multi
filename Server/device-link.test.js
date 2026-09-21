const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function setup() {
  const source = fs.readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
  const context = vm.createContext({ crypto, uuidv4: crypto.randomUUID, Date,
    MAX_DEVICES_PER_ACCOUNT: 100, db: { devices: [], linkInvites: [] },
    saveDb() {}, verifyAccessToken() { throw Error('unauthorized'); } });
  vm.runInContext(source.slice(source.indexOf('function normalizeDeviceId('), source.indexOf('function createSavedMessagesChat(')), context);
  return context;
}
function response() {
  return { statusCode: 200, cookies: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, cookie(name, value) { this.cookies[name] = value; } };
}
test('installation cookie restores the same identity; public ID alone cannot log in', () => {
  const c = setup(); const res = response();
  const identity = c.resolveInstallation({ body: { deviceId: 'new-device' }, headers: {} }, res);
  c.db.devices.push({ deviceId: identity.deviceId, installationHash: identity.hash, userId: 'owner' });
  const restored = c.resolveInstallation({ body: { deviceId: 'changed-local-storage' }, cookies: res.cookies, headers: {} }, response());
  assert.equal(restored.deviceId, 'new-device');
  const rejected = response();
  assert.equal(c.resolveInstallation({ body: { deviceId: 'new-device' }, headers: {} }, rejected), null);
  assert.equal(rejected.statusCode, 403);
});
test('invite adds one device, rejects duplicates and another account, expires and is consumed', () => {
  const c = setup();
  const invite = { id: 'invite', userId: 'owner', expiresAt: Date.now() + 60000 };
  c.db.linkInvites.push(invite);
  assert.equal(c.acceptLinkInviteOnServer(invite, 'device', 'Phone').ok, true);
  assert.equal(c.db.linkInvites.length, 0);
  assert.equal(c.acceptLinkInviteOnServer(invite, 'device', 'Phone').ok, false);
  assert.equal(c.acceptLinkInviteOnServer({ ...invite, userId: 'other' }, 'device', 'Phone').ok, false);
  assert.equal(c.acceptLinkInviteOnServer({ ...invite, expiresAt: 1 }, 'new', 'Phone').ok, false);
  assert.equal(c.db.devices.length, 1);
});
test('revoked installation cannot bootstrap but can be linked back to its owner', () => {
  const c = setup(); const res = response();
  const identity = c.resolveInstallation({ body: { deviceId: 'device' }, headers: {} }, res);
  c.db.devices.push({ deviceId: 'device', userId: 'owner', installationHash: identity.hash, revoked: true });
  const req = { body: { deviceId: 'device' }, headers: {}, cookies: res.cookies };
  assert.equal(c.resolveInstallation(req, response()), null);
  assert.equal(c.resolveInstallation(req, response(), true).deviceId, 'device');
  assert.equal(c.acceptLinkInviteOnServer({ id: 'new', userId: 'owner', expiresAt: Date.now() + 60000 }, 'device', 'Phone').ok, true);
  assert.equal(c.db.devices.length, 1);
  assert.equal(c.countUserDevices('owner'), 1);
});