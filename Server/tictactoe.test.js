const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerTicTacToe, evaluate, aiMove, canRespond, summary } = require('./tictactoe');

const response = () => ({ code: 200, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } });

/** Мини-приложение: маршруты в объекте, база в памяти, сокет пишет в массив. */
function setup(chatType = 'private', memberIds = ['a', 'b'], random = () => 0.1) {
  const routes = {};
  const app = { post: (url, _auth, fn) => { routes[url] = fn; } };
  const db = {
    chats: [{ id: 'c', type: chatType }],
    chatMembers: memberIds.map((userId) => ({ chatId: 'c', userId })),
    users: [{ id: 'a', username: 'alice' }, { id: 'b', firstName: 'Боб' }, { id: 'g', username: 'guest' }],
    messages: [],
  };
  const emitted = [];
  const io = { to: (room) => ({ emit: (ev, data) => emitted.push({ room, ev, data }) }) };
  registerTicTacToe({ app, getDb: () => db, auth() {}, saveDb() {}, io, random });
  const call = (url, userId, params, body) => { const res = response(); routes[url]({ userId, params, body }, res); return res; };
  const card = (msg) => JSON.parse(msg.attachments[0].data);
  const create = (userId = 'a') => call('/api/messages/:chatId/tictactoe', userId, { chatId: 'c' }, {});
  const accept = (userId, messageId) => call('/api/tictactoe/:messageId/accept', userId, { messageId });
  const move = (userId, messageId, cell) => call('/api/tictactoe/:messageId/move', userId, { messageId }, { cell });
  return { db, call, emitted, card, create, accept, move };
}

test('evaluate: ряды, столбцы, диагонали, ничья и незаконченная партия', () => {
  assert.deepEqual(evaluate(['X', 'X', 'X', '', 'O', 'O', '', '', '']), { winner: 'X', line: [0, 1, 2] });
  assert.deepEqual(evaluate(['O', 'X', '', 'O', 'X', '', 'O', '', '']), { winner: 'O', line: [0, 3, 6] });
  assert.deepEqual(evaluate(['', '', 'X', '', 'X', '', 'X', 'O', 'O']), { winner: 'X', line: [2, 4, 6] });
  assert.deepEqual(evaluate(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), { winner: 'draw', line: null });
  assert.equal(evaluate(Array(9).fill('')), null);
});

test('aiMove: выигрывает, блокирует, иначе центр', () => {
  assert.equal(aiMove(['O', 'O', '', 'X', 'X', '', '', '', ''], 'O'), 2, 'свой выигрыш важнее блока');
  assert.equal(aiMove(['X', 'X', '', '', 'O', '', '', '', ''], 'O'), 2, 'блок');
  assert.equal(aiMove(['X', '', '', '', '', '', '', '', ''], 'O'), 4, 'центр');
  assert.equal(aiMove(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'], 'O'), -1, 'поле заполнено');
});

test('canRespond и текст сообщения', () => {
  assert.equal(canRespond({ state: 'pending', inviteeId: 'b', creatorId: 'a' }, 'b'), true);
  assert.equal(canRespond({ state: 'pending', inviteeId: 'b', creatorId: 'a' }, 'g'), false);
  assert.equal(canRespond({ state: 'pending', inviteeId: null, creatorId: 'a' }, 'a'), false);
  assert.equal(canRespond({ state: 'accepted', inviteeId: 'b', creatorId: 'a' }, 'b'), false);
  const players = { X: { name: 'Алиса' }, O: { name: 'Боб' } };
  assert.match(summary({ state: 'finished', winner: 'O', players }), /Боб победил/);
  assert.match(summary({ state: 'finished', winner: 'draw', players }), /ничья/);
});

test('личка: вызов → accept (жребий) → ходы по очереди → победа', () => {
  const { create, accept, move, card, emitted } = setup('private');
  const created = create('a');
  assert.equal(created.code, 201);
  assert.equal(created.data.attachments[0].mimeType, 'application/x-vera-tictactoe');
  assert.equal(card(created.data).state, 'pending');
  assert.equal(card(created.data).inviteeId, 'b', 'собеседник из участников чата');
  assert.equal(emitted.at(-1).ev, 'message:new');
  const id = created.data.id;

  assert.equal(move('a', id, 0).code, 409, 'до принятия ходить нельзя');
  assert.equal(accept('a', id).code, 403, 'автор сам не принимает');

  // random() = 0.1 < 0.5 → автор играет крестиками.
  const accepted = accept('b', id);
  assert.equal(accepted.code, 200);
  const p = card(accepted.data);
  assert.equal(p.players.X.id, 'a');
  assert.equal(p.players.O.id, 'b');
  assert.equal(p.turn, 'X');
  assert.equal(emitted.at(-1).ev, 'message:edited');

  assert.equal(move('b', id, 0).code, 409, 'нолики не ходят первыми');
  assert.equal(move('a', id, 0).code, 200);
  assert.equal(move('a', id, 1).code, 409, 'два хода подряд нельзя');
  assert.equal(move('b', id, 0).code, 409, 'занятая клетка');
  assert.equal(move('b', id, 9).code, 400, 'вне поля');
  assert.equal(move('b', id, 1.5).code, 400, 'нецелая клетка');
  assert.equal(move('b', id, 3).code, 200);
  assert.equal(move('a', id, 1).code, 200);
  assert.equal(move('b', id, 4).code, 200);
  const win = move('a', id, 2);
  const done = card(win.data);
  assert.equal(done.state, 'finished');
  assert.equal(done.winner, 'X');
  assert.deepEqual(done.winLine, [0, 1, 2]);
  assert.match(win.data.content, /alice победил/);
  assert.equal(move('b', id, 5).code, 409, 'после конца партии');
});

test('ничья при заполненном поле без тройки', () => {
  const { create, accept, move, card } = setup('private');
  const id = create('a').data.id;
  accept('b', id);
  // X: 0 2 3 7 8, O: 1 4 5 6.
  let last;
  for (const [u, cell] of [['a', 0], ['b', 1], ['a', 2], ['b', 4], ['a', 3], ['b', 5], ['a', 7], ['b', 6], ['a', 8]]) {
    last = move(u, id, cell);
    assert.equal(last.code, 200, `ход ${u} в ${cell}`);
  }
  const p = card(last.data);
  assert.equal(p.state, 'finished');
  assert.equal(p.winner, 'draw');
  assert.equal(p.winLine, null);
  assert.match(last.data.content, /ничья/);
});

test('отклонение и права доступа', () => {
  const { create, call, accept } = setup('private');
  const id = create('a').data.id;
  assert.equal(call('/api/tictactoe/:messageId/decline', 'b', { messageId: id }).code, 200);
  assert.equal(accept('b', id).code, 403, 'после отклонения');
  assert.equal(create('stranger').code, 403, 'не участник чата');
  assert.equal(accept('b', 'nope').code, 404);
  assert.equal(setup('channel').create('a').code, 400, 'в канале нельзя');
});

test('группа: принимает любой участник, зритель ходить не может', () => {
  const { create, accept, move, card } = setup('group', ['a', 'b', 'g'], () => 0.9);
  const created = create('a');
  assert.equal(card(created.data).inviteeId, null);
  const id = created.data.id;
  // random() = 0.9 → принявший играет крестиками.
  assert.equal(card(accept('g', id).data).players.X.id, 'g');
  assert.equal(move('b', id, 4).code, 403, 'зритель не играет');
  assert.equal(move('g', id, 4).code, 200);
});

test('«Избранное»: сразу игра с компьютером, он отвечает тем же запросом', () => {
  const { create, move, card } = setup('saved', ['a']);
  const created = create('a');
  const p = card(created.data);
  assert.equal(p.mode, 'ai');
  assert.equal(p.state, 'accepted');
  assert.equal(p.players.O.id, 'computer');
  const after = card(move('a', created.data.id, 0).data);
  assert.equal(after.board.filter(Boolean).length, 2, 'ход игрока и ответ компьютера');
  assert.equal(after.board[4], 'O', 'компьютер занял центр');
  assert.equal(after.turn, 'X');
});
