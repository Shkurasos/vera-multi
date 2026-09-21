const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
function setup() {
  const routes = {};
  let disk;
  const context = {
    db: { chats: [{ id: 'chat', type: 'direct' }], users: [{ id: 'one', username: 'Alice', walletBalance: 10 }], messages: [], chatMembers: [{ chatId: 'chat', userId: 'one' }] },
    uuidv4: () => 'saved-message', MESSAGE_MAX_LEN: 4096,
    adminRequest: req => req.admin === true, authMiddleware() {},
    pushWalletEmit() {}, io: { to: () => ({ emit() {} }) },
    saveDb() { disk = JSON.stringify(context.db); },
    app: { post: (path, auth, handler) => { routes[path] = handler; } },
  };
  vm.runInNewContext(source.slice(source.indexOf('function messageSender('), source.indexOf('// POST /api/messages/:chatId  (base route)')), context);
  vm.runInNewContext(source.slice(source.indexOf("app.post('/api/admin/wallet/grant'"), source.indexOf("app.get('/api/wallet'")), context);
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  return { context, response, routes, restore() { context.db = JSON.parse(disk); } };
}
test('saved messages survive database reload and retry is idempotent', () => {
  const { context, response, restore } = setup();
  const body = { text: 'Hello', clientTempId: 'temp-1' };
  const res = response();
  context.handleSendMessage('chat', 'one', body, res);
  assert.equal(res.code, 201);
  restore();
  assert.equal(context.db.messages[0].content, 'Hello');
  context.handleSendMessage('chat', 'one', body, response());
  assert.equal(context.db.messages.length, 1);
});
test('failed message save rolls back and non-members cannot send', () => {
  const { context, response } = setup();
  context.saveDb = () => { throw Error('disk'); };
  const res = response();
  context.handleSendMessage('chat', 'one', { text: 'Hello' }, res);
  assert.equal(res.code, 500);
  assert.equal(context.db.messages.length, 0);
  const denied = response();
  context.handleSendMessage('chat', 'other', { text: 'Hello' }, denied);
  assert.equal(denied.code, 403);
});
test('VP grants require admin, exact nickname and positive integer; save failure rolls back', () => {
  const { context, routes, response, restore } = setup();
  const grant = (admin, username, amount) => {
    const res = response();
    routes['/api/admin/wallet/grant']({ admin, body: { username, amount } }, res);
    return res;
  };
  assert.equal(grant(false, 'Alice', 20).code, 403);
  for (const n of [-1, 0, 1.5, '20', 1000001]) assert.equal(grant(true, 'Alice', n).code, 400);
  assert.equal(grant(true, 'Ali', 20).code, 404);
  assert.equal(grant(true, ' @ALICE ', 20).data.balance, 30);
  restore();
  assert.equal(context.db.users[0].walletBalance, 30);
  context.saveDb = () => { throw Error('disk'); };
  assert.equal(grant(true, 'Alice', 20).code, 500);
  assert.equal(context.db.users[0].walletBalance, 30);
});