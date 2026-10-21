/**
 * Морской бой: команда чата `/warship`.
 *
 * Команда создаёт в чате системное сообщение со вложением-карточкой
 * (mimeType `application/x-vera-warship`). В payload карточки лежит состояние
 * сессии: pending → accepted → finished | declined.
 *
 * Принимает и отклоняет приглашение собеседник (в личке) или любой участник
 * (в группе). Режимы (payload.mode):
 *  - 'ai'  — одиночная игра против ИИ, целиком на клиенте; сервер хранит
 *            лишь состояние сессии и принимает итог через /finish;
 *  - 'pvp' — дуэль 1 на 1 в личном диалоге. Флоты и выстрелы хранятся только
 *            на сервере (db.warshipGames[messageId]), чтобы соперник не мог
 *            подсмотреть чужие корабли. Каждый игрок получает свой «вид»
 *            через GET /state, ходит через POST /fire; после хода в комнату
 *            чата уходит warship:update (без секретных данных).
 *            После accept идёт фаза 'placement': каждый игрок сам ставит
 *            свои корабли (POST /place, вертикально или горизонтально).
 *            Бой ('battle') начинается, когда флоты прислали оба.
 * Карточка обновляется у всех через message:edited и переживает перезагрузку.
 *
 * Финиш записывает в карточку и в текст сообщения итог: победителя, время
 * и число выстрелов.
 */
const crypto = require('crypto');

const CARD_MIME = 'application/x-vera-warship';
/** Типы личных диалогов (в базе встречаются оба названия). */
const DIRECT_TYPES = new Set(['direct', 'private']);
const MAX_SHOTS = 500;

// ── Логика дуэли (PvP). Зеркалит Web/src/utils/warship.ts ──
const BOARD = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const cellKey = (r, c) => `${r},${c}`;

/** Случайный флот: массив кораблей, корабль — массив клеток [r, c]. Корабли не касаются. */
function randomFleet(rand = Math.random) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ships = [];
    const blocked = new Set();
    let ok = true;
    for (const size of FLEET) {
      let placed = null;
      for (let t = 0; t < 200 && !placed; t++) {
        const horizontal = rand() < 0.5;
        const r = Math.floor(rand() * (horizontal ? BOARD : BOARD - size + 1));
        const c = Math.floor(rand() * (horizontal ? BOARD - size + 1 : BOARD));
        const cells = [];
        for (let i = 0; i < size; i++) cells.push(horizontal ? [r, c + i] : [r + i, c]);
        if (cells.every(([rr, cc]) => !blocked.has(cellKey(rr, cc)))) placed = cells;
      }
      if (!placed) { ok = false; break; }
      ships.push(placed);
      for (const [r, c] of placed)
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) blocked.add(cellKey(r + dr, c + dc));
    }
    if (ok) return ships;
  }
  throw new Error('Не удалось расставить флот');
}

const shipSunk = (cells, shots) => cells.every(([r, c]) => shots[cellKey(r, c)]);
const fleetSunk = (fleet, shots) => fleet.every((cells) => shipSunk(cells, shots));
const opponentOf = (game, userId) => game.players.find((id) => id !== userId);
const shotCount = (shots) => Object.keys(shots || {}).length;
/** Фаза дуэли. У игр, начатых до ручной расстановки, поля нет — они уже в бою. */
const phaseOf = (game) => game.phase || 'battle';

/**
 * Проверить флот, присланный игроком. Возвращает нормализованный флот
 * (клетки каждого корабля по порядку) или null, если расстановка нечестная:
 * состав не как в FLEET, корабль кривой или с разрывом, выходит за поле,
 * корабли пересекаются или касаются (даже углами).
 */
function normalizeFleet(raw) {
  if (!Array.isArray(raw) || raw.length !== FLEET.length) return null;
  const ships = [];
  for (const ship of raw) {
    if (!Array.isArray(ship) || ship.length < 1 || ship.length > BOARD) return null;
    const cells = [];
    for (const cell of ship) {
      if (!Array.isArray(cell) || cell.length !== 2) return null;
      const [r, c] = cell;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= BOARD || c < 0 || c >= BOARD) return null;
      cells.push([r, c]);
    }
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const horizontal = cells.every(([r]) => r === cells[0][0]);
    const vertical = cells.every(([, c]) => c === cells[0][1]);
    if (!horizontal && !vertical) return null;
    for (let i = 1; i < cells.length; i++) {
      const [pr, pc] = cells[i - 1];
      const [r, c] = cells[i];
      if (horizontal ? c !== pc + 1 : r !== pr + 1) return null;
    }
    ships.push(cells);
  }
  const sizes = ships.map((s) => s.length).sort((a, b) => b - a);
  const expected = [...FLEET].sort((a, b) => b - a);
  if (sizes.some((s, i) => s !== expected[i])) return null;
  const owner = new Map();
  ships.forEach((cells, idx) => { for (const [r, c] of cells) owner.set(cellKey(r, c), idx); });
  for (let idx = 0; idx < ships.length; idx++)
    for (const [r, c] of ships[idx])
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const other = owner.get(cellKey(r + dr, c + dc));
          if (other !== undefined && other !== idx) return null;
        }
  return ships;
}

/**
 * Выстрел shooter по флоту соперника. Возвращает 'miss' | 'hit' | 'sunk'
 * или null, если в клетку уже стреляли. При потоплении все клетки корабля
 * помечаются 'sunk' — как в клиентской логике.
 */
function applyShot(game, shooterId, r, c) {
  const shots = game.shots[shooterId];
  const k = cellKey(r, c);
  if (shots[k]) return null;
  const fleet = game.fleets[opponentOf(game, shooterId)];
  const ship = fleet.find((cells) => cells.some(([rr, cc]) => rr === r && cc === c));
  if (!ship) { shots[k] = 'miss'; return 'miss'; }
  shots[k] = 'hit';
  if (!shipSunk(ship, shots)) return 'hit';
  for (const [rr, cc] of ship) shots[cellKey(rr, cc)] = 'sunk';
  return 'sunk';
}

/** Что видит конкретный игрок: свой флот целиком, о чужом — только результаты своих выстрелов. */
function pvpView(game, userId, payload) {
  const opp = opponentOf(game, userId);
  const myShots = game.shots[userId];
  const enemyShots = game.shots[opp];
  const phase = phaseOf(game);
  // Во время расстановки флота может ещё не быть (null) — ни своего, ни чужого.
  const myFleet = game.fleets[userId];
  const oppFleet = game.fleets[opp];
  return {
    mode: 'pvp',
    phase,
    myReady: !!myFleet,
    opponentReady: !!oppFleet,
    myShips: (myFleet || []).map((cells) => ({ cells, sunk: shipSunk(cells, enemyShots) })),
    myShots,
    enemyShots,
    myTurn: phase === 'battle' && !game.winnerId && game.turn === userId,
    over: !!game.winnerId,
    winnerId: game.winnerId || null,
    opponentId: opp,
    opponentName: opp === payload.creatorId ? payload.creatorName : (payload.acceptedByName || 'Соперник'),
    enemyShipsLeft: oppFleet ? oppFleet.filter((cells) => !shipSunk(cells, myShots)).length : FLEET.length,
    myShipsLeft: myFleet ? myFleet.filter((cells) => !shipSunk(cells, enemyShots)).length : FLEET.length,
    myShotsCount: shotCount(myShots),
    enemyShotsCount: shotCount(enemyShots),
    startedAt: game.startedAt,
    finishedAt: game.finishedAt || null,
  };
}

function userName(u) {
  if (!u) return 'Игрок';
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id;
}

/** Payload карточки из вложения сообщения. */
function parsePayload(msg) {
  const att = (msg?.attachments || []).find((a) => a.mimeType === CARD_MIME);
  if (!att) return null;
  try {
    const data = typeof att.data === 'string' ? JSON.parse(att.data) : att.data;
    return data && data.type === 'vera-warship' ? data : null;
  } catch { return null; }
}

/** Найти сообщение-сессию по id. */
function findSession(db, messageId) {
  const msg = db.messages.find((m) => m.id === messageId && !m.isDeleted);
  if (!msg) return null;
  const payload = parsePayload(msg);
  return payload ? { msg, att: msg.attachments.find((a) => a.mimeType === CARD_MIME), payload } : null;
}

/** Членство в чате, где лежит сессия. */
function memberOf(db, chatId, userId) {
  return (db.chatMembers || []).find((m) => m.chatId === chatId && m.userId === userId);
}

/**
 * Кто может ответить на приглашение: в личке — указанный invitee, в группе —
 * любой участник, кроме автора вызова. Для «Избранного» (сам себе собеседник)
 * invitee указывается равным автору, и он же может принять.
 */
function canRespond(payload, userId) {
  if (payload.state !== 'pending') return false;
  if (payload.inviteeId) return payload.inviteeId === userId;
  return payload.creatorId !== userId;
}

/** Короткая сводка результата для текста сообщения. */
function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resultSummary(result) {
  const winner = result.winnerName || (result.winner === 'player' ? 'Игрок' : 'Компьютер');
  const dur = formatDuration(result.durationMs || 0);
  const shots = Number.isFinite(result.shots) ? result.shots : 0;
  const tail = result.surrendered ? ' · соперник сдался' : '';
  return `🏆 ${winner} победил · ${dur} · ${shots} выстрелов${tail}`;
}

/** Применить новое состояние к сообщению и обновить его текст. */
function applyState(db, msg, att, payload, saveDb, io) {
  att.data = JSON.stringify(payload);
  if (payload.state === 'declined') {
    msg.text = '⚔️ Морской бой — сессия отклонена';
  } else if (payload.state === 'accepted') {
    msg.text = payload.mode === 'pvp'
      ? `⚔️ Морской бой — ${payload.creatorName} против ${payload.acceptedByName || 'соперника'}`
      : '⚔️ Морской бой — идёт игра…';
  } else if (payload.state === 'finished' && payload.result) {
    msg.text = resultSummary(payload.result);
  }
  msg.content = msg.text;
  try { saveDb(); } catch { /* остаёмся в памяти */ }
  const sender = db.users.find((u) => u.id === msg.senderId) || null;
  io.to('chat:' + msg.chatId).emit('message:edited', { ...msg, content: msg.text, sender });
  return { ...msg, content: msg.text, sender };
}

/**
 * @param {object} deps
 * @param {import('express').Express} deps.app
 * @param {() => any} deps.getDb
 * @param {Function} deps.auth        authMiddleware
 * @param {() => void} deps.saveDb
 * @param {object} deps.io            socket.io server
 */
function registerWarships({ app, getDb, auth, saveDb, io }) {
  // POST /api/messages/:chatId/warship — создать сессию морского боя.
  app.post('/api/messages/:chatId/warship', auth, (req, res) => {
    const db = getDb();
    const chatId = String(req.params.chatId || '');
    const member = memberOf(db, chatId, req.userId);
    if (!member) return res.status(403).json({ message: 'Нет доступа' });
    const chat = (db.chats || []).find((c) => c.id === chatId);
    if (!chat) return res.status(404).json({ message: 'Чат не найден' });
    if (chat.type === 'channel') {
      return res.status(400).json({ message: 'В канале сессии морского боя недоступны' });
    }

    // invitee: в личке — собеседник, в «Избранном» — сам автор, в группе — null.
    let inviteeId = req.body?.inviteeId;
    if (inviteeId !== undefined && inviteeId !== null) inviteeId = String(inviteeId);

    // Личный диалог с живым собеседником → дуэль 1 на 1. Собеседника берём из
    // участников чата, а не из тела запроса: так нельзя «пригласить» постороннего.
    let mode = 'ai';
    if (DIRECT_TYPES.has(chat.type)) {
      const partner = (db.chatMembers || []).find((m) => m.chatId === chatId && m.userId !== req.userId);
      if (partner) { mode = 'pvp'; inviteeId = partner.userId; }
    }

    const creator = db.users.find((u) => u.id === req.userId);
    const payload = {
      type: 'vera-warship',
      sessionId: crypto.randomUUID(),
      chatId,
      mode,
      creatorId: req.userId,
      creatorName: userName(creator),
      inviteeId: inviteeId || null,
      state: 'pending',
      startedAt: null,
      finishedAt: null,
      result: null,
      createdAt: new Date().toISOString(),
    };

    const message = {
      id: crypto.randomUUID(),
      chatId,
      senderId: req.userId,
      text: '⚔️ Сессия морского боя',
      content: '⚔️ Сессия морского боя',
      replyToId: null,
      attachments: [{
        id: crypto.randomUUID(),
        fileUrl: '',
        fileName: '',
        fileSize: 0,
        mimeType: CARD_MIME,
        data: JSON.stringify(payload),
      }],
      type: 'system',
      readBy: [req.userId],
      editedAt: null, isEdited: false, isPinned: false, isDeleted: false,
      createdAt: new Date().toISOString(),
    };
    db.messages.push(message);
    try { saveDb(); } catch {
      db.messages = db.messages.filter((m) => m !== message);
      return res.status(500).json({ message: 'Не удалось сохранить сессию' });
    }
    const sender = db.users.find((u) => u.id === req.userId) || null;
    const result = { ...message, sender };
    io.to('chat:' + chatId).emit('message:new', result);
    return res.status(201).json(result);
  });

  // POST /api/warships/:messageId/accept
  app.post('/api/warships/:messageId/accept', auth, (req, res) => {
    const db = getDb();
    const found = findSession(db, req.params.messageId);
    if (!found) return res.status(404).json({ message: 'Сессия не найдена' });
    const { msg, att, payload } = found;
    if (!memberOf(db, msg.chatId, req.userId)) return res.status(403).json({ message: 'Нет доступа' });
    if (!canRespond(payload, req.userId)) {
      return res.status(403).json({ message: 'Принять сессию может только приглашённый' });
    }
    const player = db.users.find((u) => u.id === req.userId);
    const next = {
      ...payload,
      state: 'accepted',
      acceptedById: req.userId,
      acceptedByName: userName(player),
      startedAt: new Date().toISOString(),
    };
    if (payload.mode === 'pvp') {
      // Флоты игроки расставляют сами (POST /place). Первый ход и старт
      // таймера — когда готовы оба.
      const players = [payload.creatorId, req.userId];
      if (!db.warshipGames || typeof db.warshipGames !== 'object') db.warshipGames = {};
      db.warshipGames[msg.id] = {
        players,
        phase: 'placement',
        fleets: { [players[0]]: null, [players[1]]: null },
        shots: { [players[0]]: {}, [players[1]]: {} },
        turn: null,
        winnerId: null,
        startedAt: null,
        finishedAt: null,
      };
    }
    res.json(applyState(db, msg, att, next, saveDb, io));
  });

  /** Общая проверка для маршрутов дуэли: сессия, членство, режим, игрок. */
  function pvpContext(req, res) {
    const db = getDb();
    const found = findSession(db, req.params.messageId);
    if (!found) { res.status(404).json({ message: 'Сессия не найдена' }); return null; }
    if (!memberOf(db, found.msg.chatId, req.userId)) { res.status(403).json({ message: 'Нет доступа' }); return null; }
    if (found.payload.mode !== 'pvp') { res.status(400).json({ message: 'Это игра против компьютера' }); return null; }
    const game = db.warshipGames?.[found.msg.id];
    if (!game) { res.status(409).json({ message: 'Игра ещё не началась' }); return null; }
    if (!game.players.includes(req.userId)) { res.status(403).json({ message: 'Вы не участник этой дуэли' }); return null; }
    return { db, ...found, game };
  }

  /** Завершить дуэль: итог в карточку и в текст сообщения. */
  function finishPvp(ctx, winnerId, surrendered) {
    const { db, msg, att, payload, game } = ctx;
    game.winnerId = winnerId;
    game.finishedAt = Date.now();
    const winnerName = winnerId === payload.creatorId ? payload.creatorName : (payload.acceptedByName || 'Соперник');
    const next = {
      ...payload,
      state: 'finished',
      finishedAt: new Date(game.finishedAt).toISOString(),
      result: {
        winner: 'player', winnerId, winnerName,
        // Сдача во время расстановки — бой не начинался.
        durationMs: game.startedAt ? game.finishedAt - game.startedAt : 0,
        shots: shotCount(game.shots[winnerId]),
        ...(surrendered ? { surrendered: true } : {}),
      },
    };
    return applyState(db, msg, att, next, saveDb, io);
  }

  /** Сигнал обоим игрокам перечитать своё состояние (секретов не содержит). */
  function notifyPvp(msg, game) {
    io.to('chat:' + msg.chatId).emit('warship:update', {
      messageId: msg.id, turn: game.turn, over: !!game.winnerId,
    });
  }

  // GET /api/warships/:messageId/state — вид дуэли для текущего игрока.
  app.get('/api/warships/:messageId/state', auth, (req, res) => {
    const ctx = pvpContext(req, res);
    if (!ctx) return;
    res.json(pvpView(ctx.game, req.userId, ctx.payload));
  });

  // POST /api/warships/:messageId/place { ships } — своя расстановка флота.
  // ships — массив кораблей, корабль — массив клеток [r, c]. После отправки
  // флот зафиксирован; когда готовы оба, начинается бой.
  app.post('/api/warships/:messageId/place', auth, (req, res) => {
    const ctx = pvpContext(req, res);
    if (!ctx) return;
    const { game, msg } = ctx;
    if (game.winnerId) return res.status(409).json({ message: 'Игра уже закончена' });
    if (phaseOf(game) !== 'placement') return res.status(409).json({ message: 'Бой уже идёт' });
    if (game.fleets[req.userId]) return res.status(409).json({ message: 'Флот уже расставлен' });
    const fleet = normalizeFleet(req.body?.ships);
    if (!fleet) {
      return res.status(400).json({ message: 'Неверная расстановка: нужен полный флот, корабли не должны касаться' });
    }
    game.fleets[req.userId] = fleet;
    if (game.players.every((id) => game.fleets[id])) {
      game.phase = 'battle';
      game.turn = game.players[Math.random() < 0.5 ? 0 : 1];
      game.startedAt = Date.now();
    }
    try { saveDb(); } catch { /* остаёмся в памяти */ }
    notifyPvp(msg, game);
    res.json(pvpView(game, req.userId, ctx.payload));
  });

  // POST /api/warships/:messageId/fire { r, c } — выстрел в дуэли.
  app.post('/api/warships/:messageId/fire', auth, (req, res) => {
    const ctx = pvpContext(req, res);
    if (!ctx) return;
    const { game, msg } = ctx;
    if (game.winnerId) return res.status(409).json({ message: 'Игра уже закончена' });
    if (phaseOf(game) !== 'battle') return res.status(409).json({ message: 'Корабли ещё расставляются' });
    if (game.turn !== req.userId) return res.status(409).json({ message: 'Сейчас ход соперника' });
    const r = Number(req.body?.r);
    const c = Number(req.body?.c);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= BOARD || c < 0 || c >= BOARD) {
      return res.status(400).json({ message: 'Некорректная клетка' });
    }
    const outcome = applyShot(game, req.userId, r, c);
    if (!outcome) return res.status(409).json({ message: 'Сюда уже стреляли' });
    const opp = opponentOf(game, req.userId);
    if (fleetSunk(game.fleets[opp], game.shots[req.userId])) {
      finishPvp(ctx, req.userId, false);
    } else {
      // Промах — ход переходит, попадание — стреляем ещё.
      if (outcome === 'miss') game.turn = opp;
      try { saveDb(); } catch { /* остаёмся в памяти */ }
    }
    notifyPvp(msg, game);
    res.json({ outcome, view: pvpView(game, req.userId, ctx.payload) });
  });

  // POST /api/warships/:messageId/surrender — сдаться, победа сопернику.
  app.post('/api/warships/:messageId/surrender', auth, (req, res) => {
    const ctx = pvpContext(req, res);
    if (!ctx) return;
    if (ctx.game.winnerId) return res.status(409).json({ message: 'Игра уже закончена' });
    const message = finishPvp(ctx, opponentOf(ctx.game, req.userId), true);
    notifyPvp(ctx.msg, ctx.game);
    res.json(message);
  });

  // POST /api/warships/:messageId/decline
  app.post('/api/warships/:messageId/decline', auth, (req, res) => {
    const db = getDb();
    const found = findSession(db, req.params.messageId);
    if (!found) return res.status(404).json({ message: 'Сессия не найдена' });
    const { msg, att, payload } = found;
    if (!memberOf(db, msg.chatId, req.userId)) return res.status(403).json({ message: 'Нет доступа' });
    if (!canRespond(payload, req.userId)) {
      return res.status(403).json({ message: 'Отклонить сессию может только приглашённый' });
    }
    const next = { ...payload, state: 'declined', declinedBy: req.userId };
    res.json(applyState(db, msg, att, next, saveDb, io));
  });

  // POST /api/warships/:messageId/finish — итог игры (только начавший игрок).
  app.post('/api/warships/:messageId/finish', auth, (req, res) => {
    const db = getDb();
    const found = findSession(db, req.params.messageId);
    if (!found) return res.status(404).json({ message: 'Сессия не найдена' });
    const { msg, att, payload } = found;
    if (!memberOf(db, msg.chatId, req.userId)) return res.status(403).json({ message: 'Нет доступа' });
    if (payload.mode === 'pvp') {
      return res.status(400).json({ message: 'Итог дуэли считает сервер' });
    }
    if (payload.state !== 'accepted' || payload.acceptedById !== req.userId) {
      return res.status(403).json({ message: 'Завершить игру может только начавший её игрок' });
    }
    const winner = req.body?.winner === 'player' ? 'player' : 'computer';
    const durationMs = Math.max(0, Math.min(Number(req.body?.durationMs) || 0, 6 * 3600 * 1000));
    const shots = Math.max(0, Math.min(Number(req.body?.shots) || 0, MAX_SHOTS));
    const winnerName = winner === 'player'
      ? (payload.acceptedByName || 'Игрок')
      : 'Компьютер';
    const next = {
      ...payload,
      state: 'finished',
      finishedAt: new Date().toISOString(),
      result: { winner, winnerName, durationMs, shots },
    };
    res.json(applyState(db, msg, att, next, saveDb, io));
  });
}

module.exports = {
  registerWarships,
  parsePayload,
  canRespond,
  formatDuration,
  resultSummary,
  randomFleet,
  normalizeFleet,
  applyShot,
  pvpView,
  FLEET,
  CARD_MIME,
};