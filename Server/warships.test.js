const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerWarships, canRespond, formatDuration, resultSummary } = require('./warships');

const response = () => ({ code: 200, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } });

function setup(chatType = 'private', memberIds = ['a', 'b', 'g']) {
  const routes = {};
  const app = {
    post: (url, _auth, fn) => { routes[url] = fn; },
    get: (url, _auth, fn) => { routes['GET ' + url] = fn; },
  };
  const db = {
    chats: [{ id: 'c', type: chatType }],
    chatMembers: memberIds.map((userId) => ({ chatId: 'c', userId })),
    users: [{ id: 'a', username: 'alice' }, { id: 'b', firstName: 'Боб' }, { id: 'g', username: 'guest' }],
    messages: [],
  };
  const emitted = [];
  const io = { to: (room) => ({ emit: (ev, data) => emitted.push({ room, ev, data }) }) };
  registerWarships({ app, getDb: () => db, auth() {}, saveDb() {}, io });
  const call = (url, userId, params, body) => { const res = response(); routes[url]({ userId, params, body }, res); return res; };
  const card = (msg) => JSON.parse(msg.attachments[0].data);
  return { db, call, emitted, card };
}

test('canRespond и форматирование итога', () => {
  assert.equal(canRespond({ state: 'pending', inviteeId: 'b', creatorId: 'a' }, 'b'), true);
  assert.equal(canRespond({ state: 'pending', inviteeId: 'b', creatorId: 'a' }, 'g'), false);
  assert.equal(canRespond({ state: 'pending', inviteeId: null, creatorId: 'a' }, 'a'), false);
  assert.equal(canRespond({ state: 'pending', inviteeId: null, creatorId: 'a' }, 'g'), true);
  assert.equal(canRespond({ state: 'accepted', inviteeId: 'b', creatorId: 'a' }, 'b'), false);
  assert.equal(formatDuration(125400), '2:05');
  assert.equal(resultSummary({ winnerName: 'Боб', durationMs: 61000, shots: 42 }), '🏆 Боб победил · 1:01 · 42 выстрелов');
});

test('полный цикл против ИИ: create → accept → finish по messageId', () => {
  const { call, emitted, card } = setup('group');
  const created = call('/api/messages/:chatId/warship', 'a', { chatId: 'c' }, { inviteeId: 'b' });
  assert.equal(created.code, 201);
  assert.equal(card(created.data).mode, 'ai');
  assert.equal(created.data.attachments[0].mimeType, 'application/x-vera-warship');
  assert.equal(emitted.at(-1).ev, 'message:new');
  const messageId = created.data.id;
  const { sessionId } = card(created.data);
  assert.notEqual(sessionId, messageId);

  // По sessionId сессии нет — клиент обязан слать id сообщения.
  assert.equal(call('/api/warships/:messageId/accept', 'b', { messageId: sessionId }).code, 404);
  assert.equal(call('/api/warships/:messageId/accept', 'g', { messageId }).code, 403, 'не приглашённый');

  const accepted = call('/api/warships/:messageId/accept', 'b', { messageId });
  assert.equal(accepted.code, 200);
  assert.equal(card(accepted.data).state, 'accepted');
  assert.equal(card(accepted.data).acceptedById, 'b');
  assert.equal(emitted.at(-1).ev, 'message:edited');

  assert.equal(call('/api/warships/:messageId/finish', 'a', { messageId }, { winner: 'player' }).code, 403, 'финиширует только принявший');

  const finished = call('/api/warships/:messageId/finish', 'b', { messageId }, { winner: 'player', durationMs: 1e12, shots: 9999 });
  assert.equal(finished.code, 200);
  const r = card(finished.data).result;
  assert.deepEqual(r, { winner: 'player', winnerName: 'Боб', durationMs: 6 * 3600 * 1000, shots: 500 });
  assert.match(finished.data.content, /Боб победил/);

  assert.equal(call('/api/warships/:messageId/finish', 'b', { messageId }, { winner: 'player' }).code, 403, 'повторный финиш');
});

test('decline, группа без invitee, канал и чужой чат', () => {
  const { call, card } = setup('group');
  const created = call('/api/messages/:chatId/warship', 'a', { chatId: 'c' }, { inviteeId: null });
  const messageId = created.data.id;
  assert.equal(call('/api/warships/:messageId/decline', 'a', { messageId }).code, 403, 'автор сам не отвечает');
  const declined = call('/api/warships/:messageId/decline', 'g', { messageId });
  assert.equal(card(declined.data).state, 'declined');
  assert.equal(call('/api/warships/:messageId/accept', 'b', { messageId }).code, 403, 'после отклонения');

  assert.equal(call('/api/messages/:chatId/warship', 'stranger', { chatId: 'c' }, {}).code, 403);
  assert.equal(setup('channel').call('/api/messages/:chatId/warship', 'a', { chatId: 'c' }, {}).code, 400);
});

test('randomFleet: классический флот, корабли прямые и не касаются', () => {
  const { randomFleet, FLEET } = require('./warships');
  for (let i = 0; i < 50; i++) {
    const fleet = randomFleet();
    assert.deepEqual(fleet.map((s) => s.length), FLEET);
    const owner = new Map();
    fleet.forEach((cells, idx) => {
      const rows = new Set(cells.map(([r]) => r));
      const cols = new Set(cells.map(([, c]) => c));
      assert.ok(rows.size === 1 || cols.size === 1, 'корабль прямой');
      for (const [r, c] of cells) {
        assert.ok(r >= 0 && r < 10 && c >= 0 && c < 10, 'в пределах поля');
        owner.set(`${r},${c}`, idx);
      }
    });
    for (const [k, idx] of owner) {
      const [r, c] = k.split(',').map(Number);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const other = owner.get(`${r + dr},${c + dc}`);
          assert.ok(other === undefined || other === idx, 'корабли не соприкасаются');
        }
    }
  }
});

/** Дуэль в личке a↔b: создать, принять, вернуть хелперы. */
function startDuel() {
  const env = setup('direct', ['a', 'b']);
  // Клиент может прислать что угодно — сервер берёт собеседника из участников чата.
  const created = env.call('/api/messages/:chatId/warship', 'a', { chatId: 'c' }, { inviteeId: 'g' });
  const messageId = created.data.id;
  const accepted = env.call('/api/warships/:messageId/accept', 'b', { messageId });
  const game = env.db.warshipGames[messageId];
  const fire = (userId, r, c) => env.call('/api/warships/:messageId/fire', userId, { messageId }, { r, c });
  const state = (userId) => env.call('GET /api/warships/:messageId/state', userId, { messageId });
  return { ...env, created, accepted, messageId, game, fire, state };
}

test('дуэль: режим pvp в личке, приглашённый — собеседник', () => {
  const { created, accepted, card, game } = startDuel();
  assert.equal(card(created.data).mode, 'pvp');
  assert.equal(card(created.data).inviteeId, 'b');
  assert.equal(accepted.code, 200);
  assert.match(accepted.data.content, /alice против Боб/);
  assert.deepEqual(game.players, ['a', 'b']);
  assert.ok(['a', 'b'].includes(game.turn));
  // В группе и «Избранном» — по-прежнему против ИИ.
  for (const type of ['group', 'saved']) {
    const env = setup(type, ['a', 'b']);
    const res = env.call('/api/messages/:chatId/warship', 'a', { chatId: 'c' }, {});
    assert.equal(env.card(res.data).mode, 'ai', type);
  }
});

test('дуэль: вид игрока не раскрывает чужой флот', () => {
  const { state, game } = startDuel();
  const view = state('a').data;
  assert.deepEqual(view.myShips.map((s) => s.cells), game.fleets.a);
  assert.equal(JSON.stringify(view).includes(JSON.stringify(game.fleets.b)), false);
  assert.equal(view.opponentName, 'Боб');
  assert.equal(view.enemyShipsLeft, 10);
  assert.equal(state('g').code, 403, 'посторонний не видит игру');
});

test('дуэль: очерёдность ходов, промах передаёт ход, повтор и мусор отклоняются', () => {
  const { fire, game, emitted } = startDuel();
  const first = game.turn;
  const second = first === 'a' ? 'b' : 'a';
  assert.equal(fire(second, 0, 0).code, 409, 'не твой ход');
  assert.equal(fire(first, 10, 0).code, 400, 'вне поля');
  assert.equal(fire(first, 'x', 1).code, 400, 'не число');

  // Ищем пустую клетку у соперника — промах.
  const occupied = new Set(game.fleets[second].flat().map(([r, c]) => `${r},${c}`));
  let miss = null;
  for (let r = 0; r < 10 && !miss; r++) for (let c = 0; c < 10 && !miss; c++) if (!occupied.has(`${r},${c}`)) miss = [r, c];
  const res = fire(first, ...miss);
  assert.equal(res.data.outcome, 'miss');
  assert.equal(game.turn, second, 'ход перешёл');
  assert.equal(emitted.at(-1).ev, 'warship:update');
  assert.equal(JSON.stringify(emitted.at(-1).data).includes('fleets'), false);

  // Попадание оставляет ход у стреляющего.
  const [hr, hc] = game.fleets[first][0][0];
  const hit = fire(second, hr, hc);
  assert.equal(hit.data.outcome, 'hit');
  assert.equal(game.turn, second);
  assert.equal(fire(second, hr, hc).code, 409, 'повторный выстрел');
});

test('дуэль: потопить весь флот → победа, итог в сообщении', () => {
  const { fire, game, call, messageId, card, db } = startDuel();
  game.turn = 'a';
  let last;
  for (const cells of game.fleets.b) for (const [r, c] of cells) last = fire('a', r, c);
  assert.equal(last.data.outcome, 'sunk');
  assert.equal(last.data.view.over, true);
  assert.equal(last.data.view.winnerId, 'a');
  const msg = db.messages.find((m) => m.id === messageId);
  const p = card(msg);
  assert.equal(p.state, 'finished');
  assert.equal(p.result.winnerId, 'a');
  assert.equal(p.result.winnerName, 'alice');
  assert.equal(p.result.shots, 20);
  assert.match(msg.text, /alice победил · \d+:\d\d · 20 выстрелов/);
  assert.equal(fire('a', 9, 9).code, 409, 'после конца не стреляют');
  assert.equal(call('/api/warships/:messageId/finish', 'b', { messageId }, { winner: 'player' }).code, 400, 'итог дуэли не подделать');
});

test('дуэль: сдача отдаёт победу сопернику', () => {
  const { call, messageId, card } = startDuel();
  const res = call('/api/warships/:messageId/surrender', 'b', { messageId });
  assert.equal(res.code, 200);
  assert.equal(card(res.data).result.winnerId, 'a');
  assert.match(res.data.content, /alice победил .* соперник сдался/);
  assert.equal(call('/api/warships/:messageId/surrender', 'a', { messageId }).code, 409);
});
