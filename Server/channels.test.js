const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
function setup() {
  let sequence = 0;
  const routes = {};
  const context = {
    db: { users: ['owner', 'admin', 'member'].map(id => ({ id, username: id })), chats: [], chatMembers: [], messages: [] },
    uuidv4: () => String(++sequence), saveDb() {}, authMiddleware() {},
    accountOwnedSkinIds: user => new Set(user?.ownedItems || []),
    io: { to: () => ({ emit() {} }) }, MESSAGE_MAX_LEN: 10000, EDIT_WINDOW_MS: 1,
    app: Object.fromEntries(['post', 'get', 'put', 'patch', 'delete'].map(method => [method, (url, auth, fn) => { routes[method + ' ' + url] = fn; }])),
  };
  vm.runInNewContext(source.slice(source.indexOf('// POST /api/chats/group'), source.indexOf('// PATCH /api/chats/:id/archive')), context);
  vm.runInNewContext(source.slice(source.indexOf("app.get('/api/channels/search'"), source.indexOf("app.get('/api/chats/:id'")), context);
  vm.runInNewContext(source.slice(source.indexOf('function messageSender('), source.indexOf('// POST /api/messages/:chatId  (base route)')), context);
  vm.runInNewContext(source.slice(source.indexOf("app.post('/api/messages/:id/poll-vote'"), source.indexOf("// PUT /api/messages/:id  (edit)")), context);
  vm.runInNewContext(source.slice(source.indexOf('function hasGroupRight('), source.indexOf("app.patch('/api/chats/:id/members")), context);
  vm.runInNewContext(source.slice(source.indexOf('function channelOwnedSkinIds('), source.indexOf('// DELETE /api/chats/:id/leave')), context);
  vm.runInNewContext(source.slice(source.indexOf("app.put('/api/messages/:id'"), source.indexOf('// DELETE /api/messages/:id')), context);
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  const created = response();
  routes['post /api/chats/group']({ userId: 'owner', body: { name: '!News', memberIds: ['admin', 'member'] } }, created);
  const chat = created.data;
  context.db.chatMembers.find(m => m.userId === 'admin').role = 'admin';
  const send = (userId, body) => { const res = response(); context.handleSendMessage(chat.id, userId, body, res); return res; };
  return { context, routes, response, chat, send };
}
test('! creates a public searchable channel and joining is idempotent', () => {
  const { routes, response, chat, context } = setup();
  assert.equal(chat.type, 'channel');
  assert.equal(chat.ownerId, 'owner');
  for (const [q, count] of [['News', 0], ['!news', 1]]) {
    const res = response(); routes['get /api/channels/search']({ query: { q } }, res);
    assert.equal(res.data.length, count);
  }
  for (let i = 0; i < 2; i++) routes['post /api/channels/:id/join']({ params: { id: chat.id }, userId: 'new' }, response());
  assert.equal(context.db.chatMembers.filter(m => m.userId === 'new').length, 1);
});
test('channel skin choices and updates use the creator inventory, not the editing admin inventory', () => {
  const { routes, response, chat, context } = setup();
  context.db.users.find(u => u.id === 'owner').ownedItems = ['creator-ring'];
  context.db.users.find(u => u.id === 'admin').ownedItems = ['admin-ring'];
  const choices = response();
  routes['get /api/chats/:id/skins']({ params: { id: chat.id }, userId: 'admin' }, choices);
  assert.deepEqual(Array.from(choices.data), ['creator-ring']);
  for (const [value, code] of [['creator-ring', 200], ['admin-ring', 400], ['', 200]]) {
    const res = response();
    routes['patch /api/chats/:id']({ params: { id: chat.id }, userId: 'admin', body: { activeRing: value } }, res);
    assert.equal(res.code, code);
    const storedChat = context.db.chats.find(c => c.id === chat.id);
    if (code === 400) assert.equal(storedChat.activeRing, 'creator-ring');
    else assert.equal(storedChat.activeRing, value);
  }
  const denied = response();
  routes['get /api/chats/:id/skins']({ params: { id: chat.id }, userId: 'member' }, denied);
  assert.equal(denied.code, 403);
  context.db.users.find(u => u.id === 'owner').ownedItems = [];
  const removed = response();
  routes['patch /api/chats/:id']({ params: { id: chat.id }, userId: 'owner', body: { activeRing: 'creator-ring' } }, removed);
  assert.equal(removed.code, 400);
});
test('only admins publish, posts use channel identity, retries do not duplicate posts', () => {
  const { send, chat, context } = setup();
  assert.equal(send('member', { text: 'forbidden' }).code, 403);
  assert.equal(send('outsider', { text: 'forbidden' }).code, 403);
  const post = send('admin', { text: 'post', clientTempId: 'retry' });
  assert.equal(post.code, 201);
  assert.equal(post.data.senderId, chat.id);
  assert.equal(post.data.sender.firstName, '!News');
  send('admin', { text: 'post', clientTempId: 'retry' });
  assert.equal(context.db.messages.length, 1);
});
test('subscribers comment only on existing posts in their channel; admins can edit posts', () => {
  const { send, routes, response } = setup();
  const post = send('owner', { text: 'post' }).data;
  const comment = send('member', { text: 'comment', replyToId: post.id });
  assert.equal(comment.code, 201);
  assert.equal(comment.data.senderId, 'member');
  assert.equal(send('member', { text: 'bad', replyToId: 'missing' }).code, 400);
  assert.equal(send('member', { text: 'nested', replyToId: comment.data.id }).code, 400);
  for (const [userId, expected] of [['member', 403], ['admin', 200]]) {
    const res = response(); routes['put /api/messages/:id']({ params: { id: post.id }, userId, body: { text: 'edited' } }, res);
    assert.equal(res.code, expected);
  }
});

test('channel admins create polls and members can vote only once', () => {
  const { send, routes, response } = setup();
  const created = send('admin', { poll: { question: 'Выбор?', options: [{ id: 'a', text: 'Да' }, { id: 'b', text: 'Нет' }] } });
  assert.equal(created.code, 201);
  assert.equal(created.data.type, 'poll');
  const vote = response();
  routes['post /api/messages/:id/poll-vote']({ params: { id: created.data.id }, userId: 'member', body: { optionIds: ['a'] } }, vote);
  assert.equal(vote.code, 200);
  assert.equal(vote.data.poll.options[0].votes, 1);
  const duplicate = response();
  routes['post /api/messages/:id/poll-vote']({ params: { id: created.data.id }, userId: 'member', body: { optionIds: ['b'] } }, duplicate);
  assert.equal(duplicate.code, 409);
  assert.equal(send('member', { poll: { question: 'Nope', options: [{ text: '1' }, { text: '2' }] } }).code, 403);
});