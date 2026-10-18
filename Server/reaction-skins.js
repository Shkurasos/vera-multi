'use strict';

/**
 * Скины реакций: владение (выпадают из кейса «Скины реакций»), 10 слотов
 * быстрых реакций пользователя и проверка, может ли он поставить реакцию.
 *
 * Каталог общий с клиентом (Web/src/store/reactionSkins.json). Скин хранится
 * в сообщении своим id (`rx-<пак>-<реакция>`), поэтому другие участники чата
 * видят именно его, а стоковые реакции остаются обычными эмодзи.
 */
const catalog = require('../Web/src/store/reactionSkins.json');

const SLOT_COUNT = 10;
const STOCK = Object.freeze([...catalog.stock]);
const STOCK_SET = new Set(STOCK);
const SKINS = new Map(catalog.packs.flatMap(pack => pack.reactions.map(reaction => [reaction.id, { ...reaction, pack: pack.id }])));
// Реакции — короткие эмодзи; длинные строки в сообщениях не храним.
const MAX_REACTION_CHARS = 16;

function isSkinId(id) {
  return typeof id === 'string' && SKINS.has(id);
}

/** Нормализованный счётчик копий скинов: только известные id, целые > 0. */
function ownedSkins(user) {
  const result = {};
  const raw = user?.reactionSkins;
  if (!raw || typeof raw !== 'object') return result;
  for (const [id, value] of Object.entries(raw)) {
    const count = Math.floor(Number(value));
    if (isSkinId(id) && Number.isSafeInteger(count) && count > 0) result[id] = count;
  }
  return result;
}

function ownsSkin(user, id) {
  return isSkinId(id) && (ownedSkins(user)[id] || 0) > 0;
}

/** Выдать копию скина (дубликат увеличивает счётчик, как у паков/питомцев). */
function grant(user, id) {
  if (!isSkinId(id)) throw new Error(`Unknown reaction skin: ${id}`);
  const owned = ownedSkins(user);
  user.reactionSkins = { ...owned, [id]: (owned[id] || 0) + 1 };
}

const isSlotValue = (user, value) => STOCK_SET.has(value) || ownsSkin(user, value);

/**
 * Текущие слоты: сохранённые значения, если они всё ещё валидны, иначе —
 * стоковая реакция этой позиции (например, если скин больше не во владении).
 */
function slots(user) {
  const saved = Array.isArray(user?.reactionSlots) ? user.reactionSlots : [];
  const result = [];
  for (let index = 0; index < SLOT_COUNT; index++) {
    const value = saved[index];
    result.push(isSlotValue(user, value) && !result.includes(value) ? value : STOCK[index]);
  }
  // Подстановка стока могла совпасть с уже стоящим в другом слоте значением.
  for (let index = 0; index < SLOT_COUNT; index++) {
    if (result.indexOf(result[index]) !== index) result[index] = STOCK.find(glyph => !result.includes(glyph));
  }
  return result;
}

/** Проверка присланных слотов: ровно 10 уникальных значений из стока или своих скинов. */
function validateSlots(user, value) {
  if (!Array.isArray(value) || value.length !== SLOT_COUNT) return { error: `Нужно ровно ${SLOT_COUNT} реакций` };
  if (!value.every(item => typeof item === 'string')) return { error: 'Некорректная реакция' };
  if (new Set(value).size !== SLOT_COUNT) return { error: 'Реакции в слотах не должны повторяться' };
  const foreign = value.find(item => !isSlotValue(user, item));
  if (foreign) return { error: isSkinId(foreign) ? 'Скин реакции не найден в инвентаре' : 'Неизвестная реакция' };
  return { slots: [...value] };
}

/**
 * Можно ли поставить реакцию: скин — только свой, обычный эмодзи — короткая
 * непустая строка (старые клиенты шлют любые эмодзи, их не ломаем).
 */
function canReact(user, emoji) {
  if (typeof emoji !== 'string' || !emoji || emoji.length > MAX_REACTION_CHARS) return false;
  if (emoji.startsWith('rx-')) return ownsSkin(user, emoji);
  return true;
}

function state(user) {
  return { reactionSkins: ownedSkins(user), reactionSlots: slots(user) };
}

function install({ app, getDb, saveDb, authMiddleware, emitToUser }) {
  const findUser = req => getDb().users.find(u => u.id === req.userId);
  app.get('/api/reactions', authMiddleware, (req, res) => {
    const user = findUser(req);
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    res.json(state(user));
  });
  app.put('/api/reactions/slots', authMiddleware, (req, res) => {
    const user = findUser(req);
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    const checked = validateSlots(user, req.body?.slots);
    if (checked.error) return res.status(400).json({ message: checked.error });
    const previous = user.reactionSlots;
    user.reactionSlots = checked.slots;
    try { saveDb(); } catch {
      user.reactionSlots = previous;
      return res.status(500).json({ message: 'Не удалось сохранить реакции' });
    }
    const result = state(user);
    emitToUser(user, 'reactions:updated', result);
    res.json(result);
  });
}

module.exports = { SLOT_COUNT, STOCK, isSkinId, ownedSkins, ownsSkin, grant, slots, validateSlots, canReact, state, install };
