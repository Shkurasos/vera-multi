const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

function setup(type = 'direct') {
  const routes = {};
  let disk, sequence = 0;
  const context = {
    db: {
      chats: [{ id: 'source', type }, { id: 'target', type }],
      users: [{ id: 'alice', username: 'Alice' }], messages: [],
      chatMembers: ['source', 'target'].map(chatId => ({ chatId, userId: 'alice', role: 'member' })),
    },
    uuidv4: () => `message-${++sequence}`, MESSAGE_MAX_LEN: 10000, EDIT_WINDOW_MS: 172800000,
    authMiddleware() {}, io: { to: () => ({ emit() {} }) },
    saveDb() { disk = JSON.stringify(context.db); },
    app: Object.fromEntries(['post', 'get', 'put'].map(method => [method, (url, auth, fn) => { routes[method + ' ' + url] = fn; }])),
  };
  for (const [start, end] of [
    ['function messageSender(', '// POST /api/messages/:chatId  (base route)'],
    ['function getPinnedMessage(', '// Общий обработчик отправки сообщения'],
    ["app.post('/api/messages/:chatId/reaction'", '// DELETE /api/chats/:id  ('],
    ['function hasGroupRight(', "app.patch('/api/chats/:id/members"],
    ["app.put('/api/messages/:id'", '// DELETE /api/messages/:id'],
  ]) vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  const send = (chatId, body) => { const res = response(); context.handleSendMessage(chatId, 'alice', body, res); return res; };
  return { context, routes, response, send, reload() { context.db = JSON.parse(disk); } };
}

// Массивы из vm-контекста имеют другой прототип — сравниваем локальные копии.
const ids = (value) => [...value];

for (const type of ['direct', 'private', 'group', 'saved']) {
  test(`${type}: edits, reactions and pins survive storage reload`, () => {
    const { send, routes, response, reload, context } = setup(type);
    const msg = send('source', { text: 'original' }).data;
    const edit = response();
    routes['put /api/messages/:id']({ params: { id: msg.id }, userId: 'alice', body: { text: 'edited' } }, edit);
    assert.equal(edit.code, 200);
    routes['post /api/messages/:chatId/reaction']({ params: { chatId: 'source' }, userId: 'alice', body: { messageId: msg.id, emoji: '👍' } }, response());
    routes['post /api/messages/:id/pin']({ userId: 'alice', body: { chatId: 'source', messageId: msg.id } }, response());
    reload();
    assert.equal(context.db.messages[0].content, 'edited');
    assert.equal(context.db.messages[0].reactions[0].count, 1);
    assert.equal(context.db.chats[0].pinnedMessageId, msg.id);
  });

  test(`${type}: forwarding copies text and all files, not caller-supplied replacements`, () => {
    const { send, reload, context } = setup(type);
    const original = send('source', { text: 'caption', type: 'photo', attachments: [{ fileUrl: '/one.png' }, { fileUrl: '/two.png' }] }).data;
    const forwarded = send('target', { forwardFromId: original.id, text: 'forged', attachments: [{ fileUrl: '/wrong' }] });
    assert.equal(forwarded.code, 201);
    assert.equal(forwarded.data.content, 'caption');
    assert.equal(forwarded.data.type, 'photo');
    assert.equal(forwarded.data.attachments.length, 2);
    assert.equal(forwarded.data.attachments[0].fileUrl, '/one.png');
    reload();
    assert.equal(context.db.messages[1].forwardFromId, original.id);
    assert.equal(context.db.messages[1].forwardFromName, 'Alice');
  });
}

test('file-only forwarding works; missing source, forbidden access and failed save are rejected', () => {
  const { send, context } = setup();
  const original = send('source', { attachments: [{ fileUrl: '/file.pdf' }] }).data;
  assert.equal(send('target', { forwardFromId: original.id }).code, 201);
  assert.equal(send('target', { forwardFromId: 'missing' }).code, 404);
  assert.equal(send('target', { forwardFromId: original.id, replyToId: 'post' }).code, 400);
  context.saveDb = () => { throw Error('disk failure'); };
  assert.equal(send('target', { forwardFromId: original.id }).code, 500);
  assert.equal(context.db.messages.length, 2);
  context.db.chatMembers = context.db.chatMembers.filter(m => m.chatId !== 'source');
  assert.equal(send('target', { forwardFromId: original.id }).code, 403);
});

for (const type of ['direct', 'group']) {
  test(`${type}: old server messages can be pinned; unavailable copies do not replace the pin`, () => {
    const { send, context, routes, response, reload } = setup(type);
    const msg = send('source', { text: 'old message' }).data;
    context.db.messages[0].createdAt = '2020-01-01T00:00:00.000Z';
    const pin = (messageId, userId = 'alice') => {
      const res = response();
      routes['post /api/messages/:id/pin']({ userId, body: { chatId: 'source', messageId } }, res);
      return res;
    };
    assert.equal(pin(msg.id).code, 200);
    reload();
    assert.equal(context.db.chats[0].pinnedMessageId, msg.id);
    const other = send('target', { text: 'different chat' }).data;
    const deleted = send('source', { text: 'deleted' }).data;
    context.db.messages.find(m => m.id === deleted.id).isDeleted = true;
    for (const id of ['archive-only', other.id, deleted.id]) {
      const res = pin(id);
      assert.equal(res.code, 404);
      assert.equal(res.data.code, 'PIN_MESSAGE_UNAVAILABLE');
      assert.match(res.data.message, /локальная архивная копия/);
      assert.equal(context.db.chats[0].pinnedMessageId, msg.id);
    }
    for (const id of [msg.id, 'archive-only']) {
      const res = pin(id, 'outsider');
      assert.equal(res.code, 403);
      assert.equal(res.data.code, 'CHAT_ACCESS_DENIED');
    }
    assert.equal(pin(undefined).code, 400);
    assert.equal(context.db.chats[0].pinnedMessageId, msg.id);
    assert.equal(pin(null).code, 200);
    reload();
    assert.equal(context.db.chats[0].pinnedMessageId, null);
  });
for (const type of ['direct', 'group']) {
  test(`${type}: several pins are kept newest-first and unpinned one by one`, () => {
    const { send, context, routes, response, reload } = setup(type);
    const first = send('source', { text: 'one' }).data;
    const second = send('source', { text: 'two' }).data;
    const pin = (messageId, userId = 'alice') => {
      const res = response();
      routes['post /api/messages/:id/pin']({ userId, body: { chatId: 'source', messageId } }, res);
      return res;
    };
    const unpin = (messageId, userId = 'alice') => {
      const res = response();
      routes['post /api/messages/:id/unpin']({ userId, body: { chatId: 'source', messageId } }, res);
      return res;
    };

    assert.equal(pin(first.id).code, 200);
    const both = pin(second.id);
    assert.deepEqual(ids(both.data.pinnedMessageIds), [second.id, first.id]);
    assert.equal(both.data.pinnedMessageId, second.id);
    assert.equal(both.data.pinnedMessages.length, 2);
    assert.equal(both.data.pinnedMessage.id, second.id);
    // Повторное закрепление поднимает сообщение наверх, но не дублирует его.
    assert.deepEqual(ids(pin(first.id).data.pinnedMessageIds), [first.id, second.id]);
    reload();
    assert.deepEqual(ids(context.db.chats[0].pinnedMessageIds), [first.id, second.id]);

    // Открепляем одно — второе остаётся закреплённым.
    const one = unpin(first.id);
    assert.equal(one.code, 200);
    assert.deepEqual(ids(one.data.pinnedMessageIds), [second.id]);
    assert.equal(one.data.pinnedMessageId, second.id);
    reload();
    assert.deepEqual(ids(context.db.chats[0].pinnedMessageIds), [second.id]);
    assert.equal(context.db.chats[0].pinnedMessageId, second.id);

    // Неизвестный id не ломает список, пустой id отклоняется, чужой — 403.
    assert.deepEqual(ids(unpin('archive-only').data.pinnedMessageIds), [second.id]);
    assert.equal(unpin(undefined).code, 400);
    assert.equal(unpin(second.id, 'outsider').code, 403);
    assert.equal(pin(second.id, 'outsider').code, 403);

    // Снятие всех закреплений очищает список.
    assert.deepEqual(ids(pin(null).data.pinnedMessageIds), []);
    assert.equal(context.db.chats[0].pinnedMessageId, null);
  });

  test(`${type}: isPinned flag marks every pinned message in history`, () => {
    const { send, routes, response } = setup(type);
    const first = send('source', { text: 'one' }).data;
    const second = send('source', { text: 'two' }).data;
    const pin = (messageId) => routes['post /api/messages/:id/pin']({ userId: 'alice', body: { chatId: 'source', messageId } }, response());
    pin(first.id);
    pin(second.id);
    const list = response();
    routes['get /api/messages/:chatId']({ params: { chatId: 'source' }, userId: 'alice', query: {} }, list);
    assert.deepEqual(ids(list.data.filter(m => m.isPinned).map(m => m.id)), [first.id, second.id]);
  });
}

test('deleted pinned message leaves the list on the next sync', () => {
  const { send, context, routes, response } = setup('group');
  const a = send('source', { text: 'a' }).data;
  const b = send('source', { text: 'b' }).data;
  const pin = (messageId) => routes['post /api/messages/:id/pin']({ userId: 'alice', body: { chatId: 'source', messageId } }, response());
  pin(a.id);
  pin(b.id);
  context.db.messages.find(m => m.id === a.id).isDeleted = true;
  const chat = context.db.chats.find(c => c.id === 'source');
  context.syncPinnedMessages(chat);
  assert.deepEqual(ids(chat.pinnedMessageIds), [b.id]);
  assert.equal(chat.pinnedMessageId, b.id);
  assert.deepEqual(ids(context.pinnedMessageIds(chat)), [b.id]);
});

}