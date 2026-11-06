// Прямой обмен между двумя пользователями: «мои предметы + ВП за твои
// предметы + ВП». Получатель принимает или отклоняет предложение.
//
// Доступ только у аккаунтов старше месяца с привязанным вторым устройством
// (через QR). Проверка идёт для обеих сторон при создании и ещё раз при принятии.
// Персональные данные для этого не нужны и не хранятся.
//
// Предметы не уходят в эскроу: при принятии сервер заново проверяет, что у
// каждой стороны всё ещё есть обещанное, и переносит всё одной операцией.
// Если чего-то уже нет (продано, обменяно), обмен не проходит.
//
// Запись: { id, fromId, toId, offer: { items, vp }, request: { items, vp },
//           status, createdAt, updatedAt }.
// status: pending | accepted | declined | cancelled | expired.

const crypto = require('node:crypto');

const MAX_ITEMS_PER_SIDE = 10;
const MAX_PENDING_OUTGOING = 20;
const TRADE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const FINISHED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_ALLOWED = 'Обмен недоступен для этого аккаунта';
const PARTNER_NOT_ALLOWED = 'Обмен с этим пользователем недоступен';

/** Обмен доступен любому живому (не-бот) аккаунту. */
function tradeEligible(user, devices = []) {
  if (!user || user.isBot) return false;
  return true;
}

function ensureCollections(db) {
  if (!Array.isArray(db.trades)) db.trades = [];
  return db;
}

/** Проверка одной стороны обмена из тела запроса. */
function parseSide(raw, { isTradable, normalize, maxVp }) {
  const side = raw && typeof raw === 'object' ? raw : {};
  const list = side.items === undefined ? [] : side.items;
  if (!Array.isArray(list) || list.length > MAX_ITEMS_PER_SIDE) {
    return { error: `Не больше ${MAX_ITEMS_PER_SIDE} предметов с каждой стороны` };
  }
  const items = [];
  for (const value of list) {
    if (typeof value !== 'string' || value.length > 128) return { error: 'Некорректный предмет' };
    const id = normalize(value);
    if (!isTradable(id)) return { error: 'Этот предмет нельзя обменять' };
    if (!items.includes(id)) items.push(id);
  }
  const vp = side.vp === undefined ? 0 : side.vp;
  if (!Number.isSafeInteger(vp) || vp < 0 || vp > maxVp) {
    return { error: `ВП должно быть целым числом от 0 до ${maxVp}` };
  }
  return { side: { items, vp } };
}

/** Состояние объектов до операции, чтобы откатить их при ошибке сохранения. */
function snapshot(objects) {
  return objects.map((obj) => (obj ? JSON.stringify(obj) : null));
}
function restore(objects, saved) {
  objects.forEach((obj, i) => {
    if (!obj || saved[i] === null) return;
    for (const key of Object.keys(obj)) delete obj[key];
    Object.assign(obj, JSON.parse(saved[i]));
  });
}


/**
 * @param {object} deps
 * @param {any} deps.app
 * @param {() => any} deps.getDb
 * @param {Function} deps.auth
 * @param {() => void} deps.saveDb
 * @param {(userId: string, event: string, data: any) => void} deps.emitToUser
 * @param {(user: any) => any} deps.ensureWallet
 * @param {(user: any) => void} deps.afterInventoryChange  сокеты кошелька/питомцев/образа
 * @param {(blockerId: string, blockedId: string) => boolean} deps.isBlocked
 * @param {object} deps.items  isTradable, normalize, owns, locked, grant, take, isPet
 * @param {number} deps.maxVp
 */
function registerTrades({
  app, getDb, auth, saveDb, emitToUser = () => {}, ensureWallet = (u) => u,
  afterInventoryChange = () => {}, isBlocked = () => false, items, maxVp,
  now = () => Date.now(), newId = () => crypto.randomUUID(),
}) {
  const db0 = () => ensureCollections(getDb());
  const eligible = (user) => tradeEligible(user, db0().devices || []);
  const findUser = (db, id) => (db.users || []).find((u) => u.id === id) || null;
  const publicUser = (user, id) => ({ id: user?.id || id, username: user?.username || 'Пользователь' });

  function expireOld(db) {
    const t = now();
    let changed = false;
    for (const trade of db.trades) {
      if (trade.status === 'pending' && t - trade.createdAt > TRADE_TTL_MS) {
        trade.status = 'expired';
        trade.updatedAt = t;
        changed = true;
      }
    }
    const before = db.trades.length;
    db.trades = db.trades.filter((trade) => trade.status === 'pending' || t - (trade.updatedAt || trade.createdAt) < FINISHED_KEEP_MS);
    return changed || db.trades.length !== before;
  }

  function view(db, trade, viewerId) {
    return {
      id: trade.id,
      from: publicUser(findUser(db, trade.fromId), trade.fromId),
      to: publicUser(findUser(db, trade.toId), trade.toId),
      offer: trade.offer,
      request: trade.request,
      status: trade.status,
      createdAt: trade.createdAt,
      updatedAt: trade.updatedAt,
      outgoing: trade.fromId === viewerId,
    };
  }

  /** Предметы пользователя, которые сейчас можно отдать в обмен. */
  function tradableInventory(user) {
    const locked = items.locked(user.id);
    const result = [];
    for (const id of new Set((user.ownedItems || []).filter(items.isTradable))) {
      if (!locked.has(id)) result.push({ id, count: 1 });
    }
    for (const id of new Set((user.ownedPets || []).map(items.normalize))) {
      if (!items.isPet(id) || locked.has(id)) continue;
      const stored = Math.floor(Number(user.petCounts?.[id]));
      result.push({ id, count: Number.isSafeInteger(stored) && stored > 1 ? stored : 1 });
    }
    return result;
  }

  /** Почему сторона не может отдать предметы и ВП (null — может). */
  function sideProblem(user, side, receiver) {
    const locked = items.locked(user.id);
    for (const id of side.items) {
      if (!items.owns(user, id) || locked.has(id)) return `У @${user.username} больше нет предмета из обмена`;
      // Скин хранится одним экземпляром: второй такой же пропал бы впустую.
      if (!items.isPet(id) && items.owns(receiver, id)) return `У @${receiver.username} уже есть один из предметов`;
    }
    if (side.vp > 0 && !(Number(user.walletBalance) >= side.vp)) return `У @${user.username} не хватает ВП`;
    return null;
  }

  /** Обе стороны должны иметь доступ к обмену; me — тот, кто делает запрос. */
  function accessError(me, partner) {
    if (!eligible(me)) return NOT_ALLOWED;
    if (partner && partner.id !== me.id && !eligible(partner)) return PARTNER_NOT_ALLOWED;
    return null;
  }

  function notify(trade) {
    emitToUser(trade.fromId, 'trades:updated', { id: trade.id, status: trade.status });
    emitToUser(trade.toId, 'trades:updated', { id: trade.id, status: trade.status });
  }

  app.get('/api/trades', auth, (req, res) => {
    const db = db0();
    if (expireOld(db)) saveDb();
    const me = findUser(db, req.userId);
    if (!me) return res.status(404).json({ message: 'Пользователь не найден' });
    const trades = db.trades
      .filter((t) => t.fromId === me.id || t.toId === me.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((t) => view(db, t, me.id));
    res.json({ eligible: eligible(me), trades });
  });

  // Свой инвентарь для обмена (с балансом) или инвентарь собеседника.
  app.get('/api/trades/inventory/:userId', auth, (req, res) => {
    const db = db0();
    const me = ensureWallet(findUser(db, req.userId));
    const target = ensureWallet(findUser(db, String(req.params.userId || '')));
    if (!me || !target || target.isBot) return res.status(404).json({ message: 'Пользователь не найден' });
    const error = accessError(me, target);
    if (error) return res.status(403).json({ message: error, code: 'TRADE_NOT_ALLOWED' });
    const out = { items: tradableInventory(target) };
    if (target.id === me.id) out.balance = me.walletBalance;
    res.json(out);
  });

  app.post('/api/trades', auth, (req, res) => {
    const db = db0();
    expireOld(db);
    const me = ensureWallet(findUser(db, req.userId));
    const partner = ensureWallet(findUser(db, String(req.body?.toUserId || '')));
    if (!me) return res.status(404).json({ message: 'Пользователь не найден' });
    if (!partner || partner.isBot) return res.status(404).json({ message: 'Получатель не найден' });
    if (partner.id === me.id) return res.status(400).json({ message: 'Нельзя обменяться с самим собой' });
    const error = accessError(me, partner);
    if (error) return res.status(403).json({ message: error, code: 'TRADE_NOT_ALLOWED' });
    if (isBlocked(partner.id, me.id) || isBlocked(me.id, partner.id)) {
      return res.status(403).json({ message: 'Обмен с этим пользователем недоступен' });
    }
    const opts = { isTradable: items.isTradable, normalize: items.normalize, maxVp };
    const offer = parseSide(req.body?.offer, opts);
    if (offer.error) return res.status(400).json({ message: offer.error });
    const request = parseSide(req.body?.request, opts);
    if (request.error) return res.status(400).json({ message: request.error });
    if (!offer.side.items.length && !request.side.items.length) {
      return res.status(400).json({ message: 'Добавьте в обмен хотя бы один предмет' });
    }
    if (offer.side.items.some((id) => request.side.items.includes(id))) {
      return res.status(400).json({ message: 'Один и тот же предмет не может быть с обеих сторон' });
    }
    const pending = db.trades.filter((t) => t.fromId === me.id && t.status === 'pending').length;
    if (pending >= MAX_PENDING_OUTGOING) {
      return res.status(429).json({ message: `Не больше ${MAX_PENDING_OUTGOING} ожидающих предложений` });
    }
    // Баланс получателя проверяется только при принятии: заранее его не раскрываем.
    const problem = sideProblem(me, offer.side, partner) || sideProblem(partner, { ...request.side, vp: 0 }, me);
    if (problem) return res.status(409).json({ message: problem });
    const t = now();
    const trade = { id: newId(), fromId: me.id, toId: partner.id, offer: offer.side, request: request.side, status: 'pending', createdAt: t, updatedAt: t };
    db.trades.push(trade);
    saveDb();
    notify(trade);
    res.status(201).json({ trade: view(db, trade, me.id) });
  });


  app.post('/api/trades/:id/:action', auth, (req, res) => {
    const action = String(req.params.action || '');
    if (!['accept', 'decline', 'cancel'].includes(action)) return res.status(404).json({ message: 'Не найдено' });
    const db = db0();
    expireOld(db);
    const trade = db.trades.find((t) => t.id === String(req.params.id || ''));
    if (!trade || (trade.fromId !== req.userId && trade.toId !== req.userId)) {
      return res.status(404).json({ message: 'Предложение не найдено' });
    }
    if (trade.status !== 'pending') return res.status(409).json({ message: 'Предложение уже закрыто' });
    const isSender = trade.fromId === req.userId;
    // Отменяет только отправитель, принимает и отклоняет только получатель.
    if (action === 'cancel' ? !isSender : isSender) return res.status(403).json({ message: 'Операция недоступна' });

    if (action !== 'accept') {
      trade.status = action === 'cancel' ? 'cancelled' : 'declined';
      trade.updatedAt = now();
      saveDb();
      notify(trade);
      return res.json({ trade: view(db, trade, req.userId) });
    }

    const from = ensureWallet(findUser(db, trade.fromId));
    const to = ensureWallet(findUser(db, trade.toId));
    if (!from || !to) return res.status(404).json({ message: 'Пользователь не найден' });
    const error = accessError(to, from);
    if (error) return res.status(403).json({ message: error, code: 'TRADE_NOT_ALLOWED' });
    const problem = sideProblem(from, trade.offer, to) || sideProblem(to, trade.request, from);
    if (problem) return res.status(409).json({ message: problem });
    const fromBalance = from.walletBalance - trade.offer.vp + trade.request.vp;
    const toBalance = to.walletBalance - trade.request.vp + trade.offer.vp;
    if (!Number.isSafeInteger(fromBalance) || !Number.isSafeInteger(toBalance)) {
      return res.status(409).json({ message: 'Недопустимая сумма ВП' });
    }

    const stores = db.userStores || {};
    const touched = [from, to, trade, stores[from.id], stores[to.id]];
    const saved = snapshot(touched);
    try {
      for (const id of trade.offer.items) { items.take(from, id); items.grant(to, id); }
      for (const id of trade.request.items) { items.take(to, id); items.grant(from, id); }
      from.walletBalance = fromBalance;
      to.walletBalance = toBalance;
      trade.status = 'accepted';
      trade.updatedAt = now();
      saveDb();
    } catch {
      restore(touched, saved);
      return res.status(500).json({ message: 'Не удалось сохранить обмен' });
    }
    afterInventoryChange(from);
    afterInventoryChange(to);
    notify(trade);
    res.json({ trade: view(db, trade, req.userId) });
  });

  return { tradableInventory };
}

module.exports = { registerTrades, tradeEligible, MAX_ITEMS_PER_SIDE, TRADE_TTL_MS };

