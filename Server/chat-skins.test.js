const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

function setup() {
  let sequence = 0;
  const routes = {};
  const events = [];
  const context = {
    db: {
      users: [
        { id: 'owner', username: 'owner', ownedItems: ['ring-gold', 'bubble-neon'] },
        { id: 'member', username: 'member', ownedItems: [] },
      ],
      chats: [{ id: 'chat-1', type: 'group', name: 'G', ownerId: 'owner' }],
      chatMembers: [
        { id: 'm1', chatId: 'chat-1', userId: 'owner', role: 'owner' },
        { id: 'm2', chatId: 'chat-1', userId: 'member', role: 'member' },
      ],
      messages: [],
    },
    uuidv4: () => String(++sequence),
    saveDb() {},
    authMiddleware() {},
    accountOwnedSkinIds: user => new Set(user?.ownedItems || []),
    hasGroupRight: (member, right) => !!member && (member.role === 'owner' || member.role === 'admin' || member.permissions?.[right]),
    io: { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) },
    MESSAGE_MAX_LEN: 10000, EDIT_WINDOW_MS: 1,
    app: Object.fromEntries(['post', 'get', 'put', 'patch', 'delete'].map(method =>
      [method, (url, auth, fn) => { routes[method + ' ' + url] = fn; }])),
  };
  vm.runInNewContext(source.slice(source.indexOf('function hasGroupRight('), source.indexOf("app.patch('/api/chats/:id/members")), context);
  vm.runInNewContext(source.slice(source.indexOf('function channelOwnedSkinIds('), source.indexOf('// DELETE /api/chats/:id/leave')), context);
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  const member = userId => context.db.chatMembers.find(m => m.chatId === 'chat-1' && m.userId === userId);
  return { context, routes, response, events, member };
}

test('участник ставит свои скины: сохраняются и рассылаются с chatId', () => {
  const { routes, response, events, member } = setup();
  const res = response();
  routes['put /api/chats/:id/my-skins']({ params: { id: 'chat-1' }, userId: 'owner', body: { ring: 'ring-gold', bubble: '' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual({ ...res.data.skins }, { ring: 'ring-gold', bubble: '' });
  assert.deepEqual({ ...member('owner').skins }, { ring: 'ring-gold', bubble: '' });
  assert.equal(events.length, 1);
  assert.equal(events[0].room, 'chat:chat-1');
  assert.equal(events[0].event, 'user:equipment');
  assert.equal(events[0].payload.chatId, 'chat-1');
  assert.deepEqual({ ...events[0].payload.skins }, { ring: 'ring-gold', bubble: '' });
});

test('null убирает слот, пустой набор удаляет переопределения целиком', () => {
  const { routes, response, member } = setup();
  routes['put /api/chats/:id/my-skins']({ params: { id: 'chat-1' }, userId: 'owner', body: { ring: 'ring-gold' } }, response());
  routes['put /api/chats/:id/my-skins']({ params: { id: 'chat-1' }, userId: 'owner', body: { ring: null } }, response());
  assert.equal(member('owner').skins, undefined);
});

test('нельзя поставить скин не из своего инвентаря', () => {
  const { routes, response, events, member } = setup();
  const res = response();
  routes['put /api/chats/:id/my-skins']({ params: { id: 'chat-1' }, userId: 'member', body: { bubble: 'bubble-neon' } }, res);
  assert.equal(res.code, 400);
  assert.equal(member('member').skins, undefined);
  assert.equal(events.length, 0);
});

test('посторонний не может менять скины чата', () => {
  const { routes, response } = setup();
  const res = response();
  routes['put /api/chats/:id/my-skins']({ params: { id: 'chat-1' }, userId: 'outsider', body: { ring: 'ring-gold' } }, res);
  assert.equal(res.code, 403);
});
