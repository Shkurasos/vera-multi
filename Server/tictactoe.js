/**
 * Крестики-нолики: команда чата `/tic-tac-toe`.
 *
 * Команда создаёт в чате системное сообщение с карточкой-вложением
 * (mimeType `application/x-vera-tictactoe`). Секретов в игре нет, поэтому
 * всё состояние партии лежит прямо в payload карточки:
 * pending → accepted → finished | declined.
 *
 * Правила: поле 3×3, крестики ходят первыми, ходы по очереди. Побеждает тот,
 * кто первым выставит три своих знака в ряд (горизонталь, вертикаль или
 * диагональ). Если поле заполнено, а ряда нет — ничья.
 *
 * Режимы (payload.mode):
 *  - 'pvp' — 1 на 1. В личке приглашён собеседник, в группе вызов принимает
 *            любой участник, кроме автора. Кто играет крестиками, решает
 *            жребий при принятии.
 *  - 'ai'  — в «Избранном» (собеседника нет) игра против компьютера.
 *            Игрок всегда за крестики, компьютер ходит сразу после него.
 *
 * Каждый ход проверяет сервер. Карточка обновляется у всех участников через
 * message:edited и переживает перезагрузку.
 */
const crypto = require('crypto');

const CARD_MIME = 'application/x-vera-tictactoe';
const DIRECT_TYPES = new Set(['direct', 'private']);
const AI_ID = 'computer';
const AI_NAME = 'Компьютер';

/** Все выигрышные линии: 3 строки, 3 столбца, 2 диагонали. */
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const emptyBoard = () => Array(9).fill('');

/** Итог позиции: { winner: 'X' | 'O', line }, { winner: 'draw' } или null (игра идёт). */
function evaluate(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every(Boolean)) return { winner: 'draw', line: null };
  return null;
}

/**
 * Ход компьютера: выиграть, если можно; иначе помешать выиграть сопернику;
 * иначе центр, угол, сторона. Обыграть его можно, «поддаться» он не станет.
 */
function aiMove(board, me, rand = Math.random) {
  const them = me === 'X' ? 'O' : 'X';
  const free = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return -1;
  const winningFor = (mark) => free.find((i) => {
    const next = board.slice();
    next[i] = mark;
    return evaluate(next)?.winner === mark;
  });
  const win = winningFor(me);
  if (win !== undefined) return win;
  const block = winningFor(them);
  if (block !== undefined) return block;
  if (!board[4]) return 4;
  const pick = (cells) => {
    const open = cells.filter((i) => !board[i]);
    return open.length ? open[Math.floor(rand() * open.length)] : undefined;
  };
  const corner = pick([0, 2, 6, 8]);
  if (corner !== undefined) return corner;
  return pick([1, 3, 5, 7]);
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
    return data && data.type === 'vera-tictactoe' ? data : null;
  } catch { return null; }
}

function findSession(db, messageId) {
  const msg = (db.messages || []).find((m) => m.id === messageId && !m.isDeleted);
  if (!msg) return null;
  const payload = parsePayload(msg);
  return payload ? { msg, att: msg.attachments.find((a) => a.mimeType === CARD_MIME), payload } : null;
}

function memberOf(db, chatId, userId) {
  return (db.chatMembers || []).find((m) => m.chatId === chatId && m.userId === userId);
}

/** Ответить на вызов: в личке — приглашённый, в группе — любой, кроме автора. */
function canRespond(payload, userId) {
  if (payload.state !== 'pending') return false;
  if (payload.inviteeId) return payload.inviteeId === userId;
  return payload.creatorId !== userId;
}

/** Знак игрока ('X' | 'O') или null, если он не участвует в партии. */
function markOf(payload, userId) {
  if (payload.players?.X?.id === userId) return 'X';
  if (payload.players?.O?.id === userId) return 'O';
  return null;
}

/** Текст сообщения для текущего состояния (видно в списке чатов и уведомлениях). */
function summary(payload) {
  if (payload.state === 'declined') return '❌⭕ Крестики-нолики — вызов отклонён';
  if (payload.state === 'pending') return '❌⭕ Крестики-нолики — вызов';
  const x = payload.players?.X?.name || 'Крестики';
  const o = payload.players?.O?.name || 'Нолики';
  if (payload.state === 'finished') {
    if (payload.winner === 'draw') return `❌⭕ Крестики-нолики — ничья: ${x} и ${o}`;
    const winner = payload.players?.[payload.winner]?.name || payload.winner;
    return `🏆 ${winner} победил в крестики-нолики`;
  }
  return `❌⭕ Крестики-нолики — ${x} против ${o}`;
}

/** Записать новое состояние в сообщение, сохранить и разослать участникам чата. */
function applyState(db, msg, att, payload, saveDb, io) {
  att.data = JSON.stringify(payload);
  msg.text = summary(payload);
  msg.content = msg.text;
  try { saveDb(); } catch { /* остаёмся в памяти */ }
  const sender = (db.users || []).find((u) => u.id === msg.senderId) || null;
  const result = { ...msg, content: msg.text, sender };
  io.to('chat:' + msg.chatId).emit('message:edited', result);
  return result;
}

/** Поставить знак и, если партия закончилась, записать итог. Возвращает новый payload. */
function placeMark(payload, cell, mark) {
  const board = payload.board.slice();
  board[cell] = mark;
  const next = { ...payload, board, turn: mark === 'X' ? 'O' : 'X', moves: (payload.moves || 0) + 1 };
  const result = evaluate(board);
  if (result) {
    next.state = 'finished';
    next.winner = result.winner;
    next.winLine = result.line;
    next.turn = null;
    next.finishedAt = new Date().toISOString();
  }
  return next;
}

/**
 * @param {object} deps
 * @param {import('express').Express} deps.app
 * @param {() => any} deps.getDb
 * @param {Function} deps.auth         authMiddleware
 * @param {() => void} deps.saveDb
 * @param {object} deps.io             socket.io server
 * @param {() => number} [deps.random] источник случайности (для тестов)
 */
function registerTicTacToe({ app, getDb, auth, saveDb, io, random = Math.random }) {
  // POST /api/messages/:chatId/tictactoe — создать сессию.
  app.post('/api/messages/:chatId/tictactoe', auth, (req, res) => {
    const db = getDb();
    const chatId = String(req.params.chatId || '');
    if (!memberOf(db, chatId, req.userId)) return res.status(403).json({ message: 'Нет доступа' });
    const chat = (db.chats || []).find((c) => c.id === chatId);
    if (!chat) return res.status(404).json({ message: 'Чат не найден' });
    if (chat.type === 'channel') {
      return res.status(400).json({ message: 'В канале крестики-нолики недоступны' });
    }

    const creator = (db.users || []).find((u) => u.id === req.userId);
    const creatorName = userName(creator);
    // Собеседника берём из участников чата, а не из тела запроса:
    // так нельзя «пригласить» постороннего.
    const others = (db.chatMembers || []).filter((m) => m.chatId === chatId && m.userId !== req.userId);
    const solo = others.length === 0;
    const inviteeId = DIRECT_TYPES.has(chat.type) && others.length ? others[0].userId : null;

    const now = new Date().toISOString();
    const payload = {
      type: 'vera-tictactoe',
      sessionId: crypto.randomUUID(),
      chatId,
      mode: solo ? 'ai' : 'pvp',
      creatorId: req.userId,
      creatorName,
      inviteeId,
      // Без собеседника сразу играем с компьютером: игрок за крестики.
      state: solo ? 'accepted' : 'pending',
      players: solo
        ? { X: { id: req.userId, name: creatorName }, O: { id: AI_ID, name: AI_NAME } }
        : null,
      board: emptyBoard(),
      turn: solo ? 'X' : null,
      moves: 0,
      winner: null,
      winLine: null,
      declinedBy: null,
      startedAt: solo ? now : null,
      finishedAt: null,
      createdAt: now,
    };

    const message = {
      id: crypto.randomUUID(),
      chatId,
      senderId: req.userId,
      text: summary(payload),
      content: summary(payload),
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
      createdAt: now,
    };
    db.messages.push(message);
    try { saveDb(); } catch {
      db.messages = db.messages.filter((m) => m !== message);
      return res.status(500).json({ message: 'Не удалось сохранить сессию' });
    }
    const sender = (db.users || []).find((u) => u.id === req.userId) || null;
    const result = { ...message, sender };
    io.to('chat:' + chatId).emit('message:new', result);
    return res.status(201).json(result);
  });

  /** Общая проверка: сессия существует, пользователь — участник чата. */
  function context(req, res) {
    const db = getDb();
    const found = findSession(db, req.params.messageId);
    if (!found) { res.status(404).json({ message: 'Сессия не найдена' }); return null; }
    if (!memberOf(db, found.msg.chatId, req.userId)) { res.status(403).json({ message: 'Нет доступа' }); return null; }
    return { db, ...found };
  }

  // POST /api/tictactoe/:messageId/accept — принять вызов; жребий решает, кто за крестики.
  app.post('/api/tictactoe/:messageId/accept', auth, (req, res) => {
    const ctx = context(req, res);
    if (!ctx) return;
    const { db, msg, att, payload } = ctx;
    if (!canRespond(payload, req.userId)) {
      return res.status(403).json({ message: 'Принять вызов может только приглашённый' });
    }
    const me = { id: req.userId, name: userName((db.users || []).find((u) => u.id === req.userId)) };
    const creator = { id: payload.creatorId, name: payload.creatorName };
    const creatorIsX = random() < 0.5;
    const next = {
      ...payload,
      state: 'accepted',
      players: creatorIsX ? { X: creator, O: me } : { X: me, O: creator },
      board: emptyBoard(),
      turn: 'X',
      startedAt: new Date().toISOString(),
    };
    res.json(applyState(db, msg, att, next, saveDb, io));
  });

  // POST /api/tictactoe/:messageId/decline — отклонить вызов.
  app.post('/api/tictactoe/:messageId/decline', auth, (req, res) => {
    const ctx = context(req, res);
    if (!ctx) return;
    const { db, msg, att, payload } = ctx;
    if (!canRespond(payload, req.userId)) {
      return res.status(403).json({ message: 'Отклонить вызов может только приглашённый' });
    }
    res.json(applyState(db, msg, att, { ...payload, state: 'declined', declinedBy: req.userId }, saveDb, io));
  });

  // POST /api/tictactoe/:messageId/move { cell } — ход в клетку 0..8.
  app.post('/api/tictactoe/:messageId/move', auth, (req, res) => {
    const ctx = context(req, res);
    if (!ctx) return;
    const { db, msg, att, payload } = ctx;
    if (payload.state === 'finished') return res.status(409).json({ message: 'Партия уже закончена' });
    if (payload.state !== 'accepted') return res.status(409).json({ message: 'Партия ещё не началась' });
    const mark = markOf(payload, req.userId);
    if (!mark) return res.status(403).json({ message: 'Вы не участник этой партии' });
    if (payload.turn !== mark) return res.status(409).json({ message: 'Сейчас ход соперника' });
    const cell = Number(req.body?.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
      return res.status(400).json({ message: 'Некорректная клетка' });
    }
    if (!Array.isArray(payload.board) || payload.board[cell]) {
      return res.status(409).json({ message: 'Клетка уже занята' });
    }

    let next = placeMark(payload, cell, mark);
    // Против компьютера он отвечает сразу, тем же запросом.
    if (next.mode === 'ai' && next.state === 'accepted') {
      const aiMark = mark === 'X' ? 'O' : 'X';
      const aiCell = aiMove(next.board, aiMark, random);
      if (aiCell >= 0) next = placeMark(next, aiCell, aiMark);
    }
    res.json(applyState(db, msg, att, next, saveDb, io));
  });
}

module.exports = {
  registerTicTacToe,
  evaluate,
  aiMove,
  canRespond,
  markOf,
  summary,
  LINES,
  CARD_MIME,
  AI_ID,
};
