const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('equipment is public, persisted and broadcast; clearing and invalid IDs are handled', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const routes = {};
  const events = [];
  const user = { id: 'owner', username: 'owner', email: 'private@example.com' };
  const context = vm.createContext({
    db: { users: [user], chatMembers: [{ userId: 'owner', chatId: 'shared' }] },
    app: { get(route, middleware, handler) { routes['GET ' + route] = handler; },
      patch(route, middleware, handler) { routes['PATCH ' + route] = handler; } },
    authMiddleware() {}, saveDb() {}, withDevFlag: (_req, value) => value,
    io: { to(rooms) { return { emit(event, payload) { events.push({ rooms, event, payload }); } }; } },
  });
  vm.runInContext(source.slice(source.indexOf('// Publish only equipment IDs'),
    source.indexOf('// GET /api/users/:id/customization')), context);
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } });
  const outfit = { activeRing: 'ring-games-mech', activeSelfCard: 'selfcard-games-mech', activeBubble: 'bubble-games-mech' };
  routes['PATCH /api/users/me']({ userId: 'owner', body: outfit }, response());
  for (const key of Object.keys(outfit)) assert.equal(user[key], outfit[key]);
  assert.equal(events[0].event, 'user:equipment');
  assert.equal(events[0].rooms[0], 'chat:shared');
  assert.equal(events[0].payload.email, undefined);
  const publicResponse = response();
  routes['GET /api/users/:id']({ userId: 'viewer', params: { id: 'owner' } }, publicResponse);
  for (const key of Object.keys(outfit)) assert.equal(publicResponse.body[key], outfit[key]);
  assert.equal(publicResponse.body.email, undefined);
  routes['PATCH /api/users/me']({ userId: 'owner', body: { activeRing: '', activeSelfCard: '', activeBubble: '' } }, response());
  assert.equal(events[1].payload.activeBubble, '');
  assert.equal(events[1].payload.activeSelfCard, '');
  assert.equal(events[1].payload.activeRing, '');
  const invalid = response();
  routes['PATCH /api/users/me']({ userId: 'owner', body: { activeBubble: {} } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(events.length, 2);
});