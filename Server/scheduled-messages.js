/**
 * Отложенные сообщения: команда чата `/time ЧЧ:ММ:СС "текст"`.
 *
 * Очередь лежит в БД (db.scheduledMessages), а не в памяти и не у клиента:
 * сообщение обязано уйти, даже если отправитель закрыл вкладку или сервер
 * перезапустился между постановкой и сроком.
 *
 * Доставка идёт через тот же handleSendMessage, что и обычная отправка, —
 * поэтому в момент отправки заново проверяются членство в чате, блокировки
 * и права канала. Если за время ожидания человека исключили из чата,
 * сообщение не уйдёт.
 */
const crypto = require('crypto');

/** Самая долгая задержка: 99:59:59 из команды. */
const MAX_DELAY_MS = (99 * 3600 + 59 * 60 + 59) * 1000;
/** Ниже — уже не «отложенное», а обычная отправка. */
const MIN_DELAY_MS = 1000;
/** Сколько ожидающих сообщений может держать один пользователь. */
const MAX_PENDING_PER_USER = 50;
const MAX_TEXT = 10000;
const TICK_MS = 1000;

function ensureQueue(db) {
  if (!Array.isArray(db.scheduledMessages)) db.scheduledMessages = [];
  return db.scheduledMessages;
}

/** Публичный вид записи очереди. */
function view(item) {
  return { id: item.id, chatId: item.chatId, text: item.text, sendAt: item.sendAt, createdAt: item.createdAt };
}

/**
 * Проверка запроса на постановку в очередь. Возвращает { error } или
 * { text, delayMs } — отдельно от Express, чтобы покрыть тестами.
 */
function validateScheduleBody(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const delayMs = Number(body?.delayMs);
  if (!text) return { error: 'Пустое сообщение' };
  if (text.length > MAX_TEXT) return { error: 'Сообщение слишком длинное' };
  if (!Number.isInteger(delayMs)) return { error: 'Некорректная задержка' };
  if (delayMs < MIN_DELAY_MS) return { error: 'Задержка должна быть не меньше секунды' };
  if (delayMs > MAX_DELAY_MS) return { error: 'Максимальная задержка — 99:59:59' };
  return { text, delayMs };
}

/**
 * Доставить всё, чей срок наступил. Возвращает число обработанных записей.
 * Запись снимается с очереди и при успехе, и при отказе (нет доступа и т.п.):
 * иначе отклонённое сообщение пыталось бы уйти каждую секунду вечно.
 */
function deliverDue(db, now, deliver, log = console) {
  const queue = ensureQueue(db);
  const due = queue.filter((item) => item.sendAt <= now).sort((a, b) => a.sendAt - b.sendAt);
  if (!due.length) return 0;
  const dueIds = new Set(due.map((item) => item.id));
  db.scheduledMessages = queue.filter((item) => !dueIds.has(item.id));
  for (const item of due) {
    try {
      const result = deliver(item);
      if (result && result.code >= 400) {
        log.warn?.(`[scheduled] ${item.id} не доставлено (${result.code}): ${result.data?.message || ''}`);
      }
    } catch (e) {
      log.error?.(`[scheduled] ${item.id} ошибка доставки:`, e?.message || e);
    }
  }
  return due.length;
}

/** Заглушка вместо Express res: handleSendMessage пишет в неё результат. */
function memoryResponse() {
  return {
    code: 200,
    data: null,
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
  };
}

/**
 * @param {object} deps
 * @param {import('express').Express} deps.app
 * @param {() => any} deps.getDb       БД переприсваивается (reloadDb), поэтому — геттер.
 * @param {Function} deps.auth         authMiddleware
 * @param {() => void} deps.saveDb
 * @param {(chatId: string, userId: string, body: object, res: object) => void} deps.handleSendMessage
 * @param {boolean} [deps.startTimer=true]
 */
function registerScheduledMessages({ app, getDb, auth, saveDb, handleSendMessage, startTimer = true }) {
  const deliver = (item) => {
    const res = memoryResponse();
    handleSendMessage(item.chatId, item.senderId, { text: item.text }, res);
    return res;
  };

  const tick = () => {
    const count = deliverDue(getDb(), Date.now(), deliver);
    // handleSendMessage уже сохранил успешные; сохраняем ещё раз, чтобы с диска
    // ушли и отклонённые записи очереди.
    if (count) { try { saveDb(); } catch (e) { console.error('[scheduled] saveDb:', e?.message || e); } }
    return count;
  };

  // POST /api/messages/:chatId/schedule — поставить сообщение в очередь.
  app.post('/api/messages/:chatId/schedule', auth, (req, res) => {
    const db = getDb();
    const chatId = String(req.params.chatId || '');
    const member = (db.chatMembers || []).find((m) => m.chatId === chatId && m.userId === req.userId);
    if (!member) return res.status(403).json({ message: 'Нет доступа' });
    const chat = (db.chats || []).find((c) => c.id === chatId);
    if (chat?.type === 'channel' && !['owner', 'admin'].includes(member.role)) {
      return res.status(403).json({ message: 'Публиковать могут только администраторы канала' });
    }
    const parsed = validateScheduleBody(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const queue = ensureQueue(db);
    if (queue.filter((item) => item.senderId === req.userId).length >= MAX_PENDING_PER_USER) {
      return res.status(429).json({ message: `Не больше ${MAX_PENDING_PER_USER} отложенных сообщений` });
    }
    const now = Date.now();
    const item = {
      id: crypto.randomUUID(),
      chatId,
      senderId: req.userId,
      text: parsed.text,
      sendAt: now + parsed.delayMs,
      createdAt: now,
    };
    queue.push(item);
    try { saveDb(); } catch {
      db.scheduledMessages = ensureQueue(db).filter((x) => x !== item);
      return res.status(500).json({ message: 'Не удалось сохранить' });
    }
    res.status(201).json(view(item));
  });

  // GET /api/messages/:chatId/scheduled — мои ожидающие сообщения в этом чате.
  app.get('/api/messages/:chatId/scheduled', auth, (req, res) => {
    const chatId = String(req.params.chatId || '');
    res.json(ensureQueue(getDb())
      .filter((item) => item.chatId === chatId && item.senderId === req.userId)
      .sort((a, b) => a.sendAt - b.sendAt)
      .map(view));
  });

  // DELETE /api/messages/scheduled/:id — отменить своё отложенное сообщение.
  app.delete('/api/messages/scheduled/:id', auth, (req, res) => {
    const db = getDb();
    const queue = ensureQueue(db);
    const item = queue.find((x) => x.id === req.params.id && x.senderId === req.userId);
    if (!item) return res.status(404).json({ message: 'Не найдено' });
    db.scheduledMessages = queue.filter((x) => x !== item);
    try { saveDb(); } catch { /* в памяти запись уже снята */ }
    res.json({ ok: true });
  });

  let timer = null;
  if (startTimer) {
    // Сразу после старта: доставляем то, что «проспали» во время перезапуска.
    setImmediate(tick);
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }
  return { tick, stop: () => timer && clearInterval(timer) };
}

module.exports = {
  registerScheduledMessages,
  validateScheduleBody,
  deliverDue,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  MAX_PENDING_PER_USER,
};
