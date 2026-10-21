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

/** Дуэль в личке a↔b: создать, принять, расставить флоты, вернуть хелперы. */
function startDuel({ place = true } = {}) {
  const { randomFleet } = require('./warships');
  const env = setup('direct', ['a', 'b']);
  // Клиент может прислать что угодно — сервер берёт собеседника из участников чата.
  const created = env.call('/api/messages/:chatId/warship', 'a', { chatId: 'c' }, { inviteeId: 'g' });
  const messageId = created.data.id;
  const accepted = env.call('/api/warships/:messageId/accept', 'b', { messageId });
  const game = env.db.warshipGames[messageId];
  const fire = (userId, r, c) => env.call('/api/warships/:messageId/fire', userId, { messageId }, { r, c });
  const state = (userId) => env.call('GET /api/warships/:messageId/state', userId, { messageId });
  const placeFleet = (userId, ships) => env.call('/api/warships/:messageId/place', userId, { messageId }, { ships });
  if (place) {
    assert.equal(placeFleet('a', randomFleet()).code, 200);
    assert.equal(placeFleet('b', randomFleet()).code, 200);
  }
  return { ...env, created, accepted, messageId, game, fire, state, placeFleet };
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

test('дуэль: после accept — расстановка, стрелять нельзя, чужой флот не виден', () => {
  const { randomFleet } = require('./warships');
  const { game, fire, state, placeFleet, emitted } = startDuel({ place: false });
  assert.equal(game.phase, 'placement');
  assert.equal(game.fleets.a, null);
  assert.equal(game.turn, null);
  let view = state('a').data;
  assert.equal(view.phase, 'placement');
  assert.equal(view.myReady, false);
  assert.equal(view.opponentReady, false);
  assert.deepEqual(view.myShips, []);
  assert.equal(view.myTurn, false);
  assert.equal(fire('a', 0, 0).code, 409, 'до боя не стреляют');

  // a расставился — ждёт b; b видит, что a готов, но не видит его клеток.
  const fleetA = randomFleet();
  assert.equal(placeFleet('a', fleetA).code, 200);
  assert.equal(emitted.at(-1).ev, 'warship:update');
  assert.equal(JSON.stringify(emitted.at(-1).data).includes('fleets'), false);
  assert.equal(game.phase, 'placement');
  assert.equal(placeFleet('a', randomFleet()).code, 409, 'перерасставить после «Готово» нельзя');
  view = state('b').data;
  assert.equal(view.opponentReady, true);
  assert.equal(view.myReady, false);
  assert.equal(JSON.stringify(view).includes(JSON.stringify(fleetA)), false);
  assert.equal(state('a').data.myShips.length, 10);

  // b расставился — бой.
  assert.equal(placeFleet('b', randomFleet()).code, 200);
  assert.equal(game.phase, 'battle');
  assert.ok(['a', 'b'].includes(game.turn));
  assert.ok(game.startedAt > 0);
  assert.equal(state(game.turn).data.myTurn, true);
  assert.equal(placeFleet('b', randomFleet()).code, 409, 'бой уже идёт');
});

test('дуэль: свой флот можно ставить и вертикально, и горизонтально', () => {
  const { game, placeFleet } = startDuel({ place: false });
  // Ручная раскладка: 4 и 3 вертикально, остальное горизонтально; клетки вразнобой.
  const ships = [
    [[3, 0], [0, 0], [2, 0], [1, 0]],   // 4, вертикально, перемешан
    [[0, 2], [1, 2], [2, 2]],           // 3, вертикально
    [[0, 4], [0, 5], [0, 6]],           // 3
    [[2, 4], [2, 5]],                   // 2
    [[0, 8], [0, 9]],                   // 2
    [[4, 4], [4, 5]],                   // 2
    [[9, 9]], [[9, 0]], [[6, 0]], [[9, 5]],
  ];
  assert.equal(placeFleet('a', ships).code, 200);
  assert.deepEqual(game.fleets.a[0], [[0, 0], [1, 0], [2, 0], [3, 0]], 'клетки упорядочены');
});

test('normalizeFleet отклоняет нечестную расстановку', () => {
  const { normalizeFleet, randomFleet } = require('./warships');
  const ok = [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 2], [1, 2], [2, 2]], [[0, 4], [0, 5], [0, 6]],
    [[2, 4], [2, 5]], [[0, 8], [0, 9]], [[4, 4], [4, 5]],
    [[9, 9]], [[9, 0]], [[6, 0]], [[9, 5]],
  ];
  assert.ok(normalizeFleet(ok));
  assert.ok(normalizeFleet(randomFleet()));
  const clone = () => JSON.parse(JSON.stringify(ok));
  const bad = {
    'не массив': 'x',
    'не хватает корабля': ok.slice(1),
    'лишний корабль': [...clone(), [[7, 7]]],
    'не тот состав (два 4-палубных)': (() => { const f = clone(); f[1] = [[0, 2], [1, 2], [2, 2], [3, 2]]; return f; })(),
    'изогнутый': (() => { const f = clone(); f[1] = [[0, 2], [1, 2], [1, 3]]; return f; })(),
    'с разрывом': (() => { const f = clone(); f[2] = [[0, 4], [0, 5], [0, 7]]; return f; })(),
    'за полем': (() => { const f = clone(); f[6] = [[10, 9]]; return f; })(),
    'дробная клетка': (() => { const f = clone(); f[6] = [[1.5, 9]]; return f; })(),
    'пересечение': (() => { const f = clone(); f[6] = [[0, 0]]; return f; })(),
    'касание бортом': (() => { const f = clone(); f[6] = [[0, 1]]; return f; })(),
    'касание углом': (() => { const f = clone(); f[6] = [[4, 1]]; return f; })(),
  };
  for (const [name, fleet] of Object.entries(bad)) assert.equal(normalizeFleet(fleet), null, name);
});

test('дуэль: сдача во время расстановки', () => {
  const { call, messageId, card, fire } = startDuel({ place: false });
  const res = call('/api/warships/:messageId/surrender', 'a', { messageId });
  assert.equal(res.code, 200);
  assert.equal(card(res.data).result.winnerId, 'b');
  assert.equal(card(res.data).result.durationMs, 0);
  assert.equal(fire('b', 0, 0).code, 409);
});

test('дуэль: старая игра без phase считается уже начатой', () => {
  const { game, fire, state } = startDuel({ place: false });
  // Так выглядели игры до ручной расстановки.
  const { randomFleet } = require('./warships');
  delete game.phase;
  game.fleets = { a: randomFleet(), b: randomFleet() };
  game.turn = 'a';
  game.startedAt = Date.now();
  assert.equal(state('a').data.phase, 'battle');
  assert.equal(fire('a', 0, 0).code, 200);
});

