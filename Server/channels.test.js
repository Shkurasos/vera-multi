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
  require('./privacy-test-context')(context);
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
  assert.equal(chat.name, 'News', '«!» задаёт вид при создании и в название не попадает');
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
test('prefixes set the chat kind once and renaming never changes it', () => {
  const { routes, response, chat, context } = setup();
  const make = (name) => { const r = response(); routes['post /api/chats/group']({ userId: 'owner', body: { name, memberIds: [] } }, r); return r.data; };
  const desk = make('/desk Дело');
  assert.equal(desk.type, 'group'); assert.equal(desk.kind, 'desk'); assert.equal(desk.name, 'Дело');
  const wb = make('/canvas Рисунки');
  assert.equal(wb.kind, 'whiteboard'); assert.equal(wb.name, 'Рисунки');
  const plain = make('Работа | в отделе');
  assert.equal(plain.kind, undefined); assert.equal(plain.name, 'Работа | в отделе');
  assert.equal(make('/desk').name, 'Доска', 'пустое имя после команды получает имя по виду');
  assert.equal(make('/холст').kind, undefined, 'не команда — обычная группа');

  const rename = (id, name) => { const r = response(); routes['patch /api/chats/:id']({ params: { id }, userId: 'owner', body: { name } }, r); return r; };
  // Обычную группу нельзя превратить в канал/доску переименованием.
  const renamedPlain = rename(plain.id, '!Канал');
  assert.equal(renamedPlain.code, 200);
  const storedPlain = context.db.chats.find(c => c.id === plain.id);
  assert.equal(storedPlain.type, 'group'); assert.equal(storedPlain.kind, undefined);
  // Доска остаётся доской при любом имени.
  rename(desk.id, 'Просто чат');
  assert.equal(context.db.chats.find(c => c.id === desk.id).kind, 'desk');
  // Канал остаётся каналом, «!» в имя больше не дописывается.
  rename(chat.id, 'Новости');
  const storedChannel = context.db.chats.find(c => c.id === chat.id);
  assert.equal(storedChannel.type, 'channel'); assert.equal(storedChannel.name, 'Новости');
  assert.equal(rename(chat.id, '   ').code, 400);
});

test('migration moves legacy name prefixes into kind once', () => {
  const { context } = setup();
  context.db.chatKindMigrationVersion = 0;
  context.db.chats = [
    { id: 'a', type: 'channel', name: '!Новости' },
    { id: 'b', type: 'group', name: '| Дело' },
    { id: 'c', type: 'group', name: '/Холст' },
    { id: 'd', type: 'group', name: '!не канал' },
    { id: 'e', type: 'private', name: '| личный' },
    { id: 'g', type: 'group', name: '/canvas Рисунки' },
  ];
  assert.equal(context.migrateChatKinds(), true);
  const by = id => context.db.chats.find(c => c.id === id);
  assert.equal(by('a').name, 'Новости');
  assert.equal(by('b').kind, 'desk'); assert.equal(by('b').name, 'Дело');
  assert.equal(by('c').kind, 'whiteboard'); assert.equal(by('c').name, 'Холст');
  assert.equal(by('d').name, '!не канал', 'группу с «!» не трогаем — она не канал');
  assert.equal(by('e').name, '| личный');
  assert.equal(by('g').kind, 'whiteboard'); assert.equal(by('g').name, 'Рисунки');
  // Повторно не срабатывает: новые «| x» после миграции уже не доски.
  context.db.chats.push({ id: 'f', type: 'group', name: '| позже' });
  assert.equal(context.migrateChatKinds(), false);
  assert.equal(by('f').kind, undefined);
});

test('only admins publish, posts use channel identity, retries do not duplicate posts', () => {
  const { send, chat, context } = setup();
  assert.equal(send('member', { text: 'forbidden' }).code, 403);
  assert.equal(send('outsider', { text: 'forbidden' }).code, 403);
  const post = send('admin', { text: 'post', clientTempId: 'retry' });
  assert.equal(post.code, 201);
  assert.equal(post.data.senderId, chat.id);
  assert.equal(post.data.sender.firstName, 'News');
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