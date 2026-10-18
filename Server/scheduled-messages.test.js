const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateScheduleBody, deliverDue, registerScheduledMessages, MAX_DELAY_MS, MAX_PENDING_PER_USER,
} = require('./scheduled-messages');

const quiet = { warn() {}, error() {} };
const response = () => ({ code: 200, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } });

test('validateScheduleBody', () => {
  assert.deepEqual(validateScheduleBody({ text: ' hi ', delayMs: 5000 }), { text: 'hi', delayMs: 5000 });
  assert.ok(validateScheduleBody({ text: '', delayMs: 5000 }).error);
  assert.ok(validateScheduleBody({ text: 'x', delayMs: 999 }).error);
  assert.ok(validateScheduleBody({ text: 'x', delayMs: MAX_DELAY_MS + 1 }).error);
  assert.ok(validateScheduleBody({ text: 'x', delayMs: 1.5e3 + 0.5 }).error);
  assert.ok(validateScheduleBody(null).error);
});

test('deliverDue доставляет по сроку и снимает даже отклонённые', () => {
  const db = { scheduledMessages: [
    { id: 'late', sendAt: 300 }, { id: 'early', sendAt: 100 }, { id: 'future', sendAt: 900 },
  ] };
  const sent = [];
  const count = deliverDue(db, 500, (item) => { sent.push(item.id); return item.id === 'late' ? { code: 403, data: {} } : { code: 201 }; }, quiet);
  assert.equal(count, 2);
  assert.deepEqual(sent, ['early', 'late']);
  assert.deepEqual(db.scheduledMessages.map((i) => i.id), ['future']);
  assert.equal(deliverDue(db, 500, () => { throw new Error('nope'); }, quiet), 0);
});

function setup(chatType = 'group', role = 'member') {
  const routes = {};
  const app = Object.fromEntries(['post', 'get', 'delete'].map((m) => [m, (url, _auth, fn) => { routes[`${m} ${url}`] = fn; }]));
  const db = { chats: [{ id: 'c', type: chatType }], chatMembers: [{ chatId: 'c', userId: 'u', role }] };
  const delivered = [];
  const api = registerScheduledMessages({
    app, getDb: () => db, auth() {}, saveDb() {}, startTimer: false,
    handleSendMessage: (chatId, userId, body, res) => { delivered.push({ chatId, userId, ...body }); res.status(201).json({}); },
  });
  const call = (key, userId, params, body) => { const res = response(); routes[key]({ userId, params, body }, res); return res; };
  return { db, api, call, delivered };
}

test('постановка, список, отмена и доставка через handleSendMessage', () => {
  const { db, api, call, delivered } = setup();
  const created = call('post /api/messages/:chatId/schedule', 'u', { chatId: 'c' }, { text: 'hi', delayMs: 1000 });
  assert.equal(created.code, 201);
  assert.equal(call('get /api/messages/:chatId/scheduled', 'u', { chatId: 'c' }).data.length, 1);
  assert.equal(call('get /api/messages/:chatId/scheduled', 'other', { chatId: 'c' }).data.length, 0, 'чужие не видны');
  assert.equal(call('delete /api/messages/scheduled/:id', 'other', { id: created.data.id }).code, 404, 'чужое не отменить');

  db.scheduledMessages[0].sendAt = 0;
  assert.equal(api.tick(), 1);
  assert.deepEqual(delivered, [{ chatId: 'c', userId: 'u', text: 'hi' }]);
  assert.equal(db.scheduledMessages.length, 0);

  const second = call('post /api/messages/:chatId/schedule', 'u', { chatId: 'c' }, { text: 'x', delayMs: 5000 });
  assert.equal(call('delete /api/messages/scheduled/:id', 'u', { id: second.data.id }).code, 200);
  assert.equal(db.scheduledMessages.length, 0);
});

test('права и лимиты', () => {
  const { call } = setup();
  assert.equal(call('post /api/messages/:chatId/schedule', 'stranger', { chatId: 'c' }, { text: 'x', delayMs: 1000 }).code, 403);
  assert.equal(call('post /api/messages/:chatId/schedule', 'u', { chatId: 'c' }, { text: 'x', delayMs: 10 }).code, 400);
  for (let i = 0; i < MAX_PENDING_PER_USER; i++) call('post /api/messages/:chatId/schedule', 'u', { chatId: 'c' }, { text: 'x', delayMs: 1000 });
  assert.equal(call('post /api/messages/:chatId/schedule', 'u', { chatId: 'c' }, { text: 'x', delayMs: 1000 }).code, 429);

  const channel = setup('channel', 'member');
  assert.equal(channel.call('post /api/messages/:chatId/schedule', 'u', { chatId: 'c' }, { text: 'x', delayMs: 1000 }).code, 403);
});
