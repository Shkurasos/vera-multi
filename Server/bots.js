/**
 * Боты Vera: аккаунты-боты, системный бот /hub и Bot API.
 *
 * Бот — обычная запись в db.users с флагом isBot, поэтому личка с ботом
 * создаётся тем же POST /api/chats/direct, что и с человеком. Служебные
 * данные бота (владелец, хэш токена, вебхук) лежат отдельно в db.bots и
 * клиенту не уходят.
 *
 * Код ботов на нашем сервере не выполняется: автор запускает его у себя и
 * обращается к Vera по HTTP, как к Telegram Bot API:
 *   GET|POST /bot<token>/getMe | getUpdates | sendMessage | sendSticker |
 *            setWebhook | deleteWebhook | getWebhookInfo | answerCallbackQuery |
 *            setMyCommands | getMyCommands | deleteMyCommands
 *
 * Токен показывается автору один раз, в базе хранится только его SHA-256.
 * Бот пишет только в личные чаты, где пользователь сам начал с ним диалог.
 *
 * /hub — встроенный бот (аналог @BotFather), ему отвечает сам сервер:
 * /newbot, /mybots, /token, /deletebot, /stickers, /api.
 */
const crypto = require('crypto');
const dns = require('dns');

const HUB_ID = 'bot-hub';
const HUB_USERNAME = 'hub';
/** Внутренний адрес мини-приложения стикеров: клиент открывает его без iframe. */
const STICKERS_APP_URL = 'vera://stickers';
const DIRECT_TYPES = new Set(['direct', 'private']);
/** 5–32 символа, с буквы, в конце «bot» — как у Telegram. */
const BOT_USERNAME_RE = /^[a-z][a-z0-9_]{1,28}bot$/i;
const MAX_BOTS_PER_OWNER = 20;
const MAX_TEXT = 4096;
const MAX_NAME = 64;
const MAX_QUEUE = 100;
const UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
const LONG_POLL_MAX_S = 25;
const HUB_STATE_TTL_MS = 15 * 60 * 1000;
/** Порты вебхука, как у Telegram. '' — порт по умолчанию (443). */
const WEBHOOK_PORTS = new Set(['', '443', '8443', '88']);
const WEBHOOK_RETRY_MS = [2000, 10000];

const lower = (v) => String(v || '').trim().toLowerCase();
const stripControl = (v) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = (botId) => `${botId}:${crypto.randomBytes(24).toString('base64url')}`;
const truthy = (v) => v === true || v === 1 || v === 'true' || v === '1';

function clampInt(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function cleanName(raw) {
  const name = stripControl(raw);
  if (!name) return { error: 'Имя не может быть пустым' };
  if (name.length > MAX_NAME) return { error: `Имя длиннее ${MAX_NAME} символов` };
  return { name };
}

function cleanBotUsername(raw) {
  const username = String(raw || '').trim().replace(/^[@/]+/, '');
  if (!BOT_USERNAME_RE.test(username)) {
    return { error: 'Ник бота: латиница, цифры и _, от 5 до 32 символов, с буквы и с «bot» на конце. Например: weather_bot' };
  }
  return { username };
}

function isHttpsUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch { return false; }
}

/**
 * Проверка reply_markup. Поддерживаем inline_keyboard с callback_data и
 * web_app { url }. allowInternal пускает внутренний адрес мини-приложения
 * стикеров — его ставит только /hub.
 */
function sanitizeReplyMarkup(raw, { allowInternal = false } = {}) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  let markup = raw;
  if (typeof markup === 'string') {
    try { markup = JSON.parse(markup); } catch { return { error: 'reply_markup: некорректный JSON' }; }
  }
  const rows = markup && markup.inline_keyboard;
  if (!Array.isArray(rows) || rows.length > 8) return { error: 'reply_markup: нужен inline_keyboard, не больше 8 рядов' };
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 1 || row.length > 4) return { error: 'reply_markup: в ряду от 1 до 4 кнопок' };
    const cleanRow = [];
    for (const button of row) {
      const text = stripControl(button && button.text);
      if (!text || text.length > 64) return { error: 'reply_markup: текст кнопки от 1 до 64 символов' };
      if (typeof button.callback_data === 'string') {
        if (!button.callback_data || Buffer.byteLength(button.callback_data) > 64) return { error: 'callback_data: от 1 до 64 байт' };
        cleanRow.push({ text, callback_data: button.callback_data });
      } else if (button.web_app && typeof button.web_app.url === 'string') {
        const url = button.web_app.url;
        if (!(allowInternal && url === STICKERS_APP_URL) && !isHttpsUrl(url)) return { error: 'web_app.url: нужна ссылка https://' };
        cleanRow.push({ text, web_app: { url } });
      } else {
        return { error: 'reply_markup: у кнопки нужен callback_data или web_app' };
      }
    }
    out.push(cleanRow);
  }
  return { value: out.length ? { inline_keyboard: out } : null };
}

/**
 * initData мини-приложения. Схема как у Telegram, но ключ строится от
 * SHA-256 токена (сам токен мы не храним):
 *   secret = HMAC_SHA256(key = "WebAppData", data = sha256_hex(token))
 *   hash   = HMAC_SHA256(key = secret, data = "k=v" по алфавиту через \n)
 */
function webAppSecret(tokenHash) {
  return crypto.createHmac('sha256', 'WebAppData').update(String(tokenHash)).digest();
}
function dataCheckString(fields) {
  return Object.keys(fields).filter((k) => k !== 'hash').sort().map((k) => `${k}=${fields[k]}`).join('\n');
}
function signWebAppData(tokenHash, fields) {
  const hash = crypto.createHmac('sha256', webAppSecret(tokenHash)).update(dataCheckString(fields)).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
/** Проверка initData на стороне автора бота (по исходному токену). */
function checkWebAppData(initData, token) {
  const params = Object.fromEntries(new URLSearchParams(String(initData || '')));
  if (!/^[0-9a-f]{64}$/.test(params.hash || '')) return false;
  const expected = crypto.createHmac('sha256', webAppSecret(hashToken(token))).update(dataCheckString(params)).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(params.hash, 'hex'));
}

/** Меню команд /hub: его же клиент показывает над полем ввода. */
const HUB_COMMANDS = [
  { command: 'newbot', description: 'создать бота' },
  { command: 'mybots', description: 'ваши боты' },
  { command: 'newapp', description: 'создать мини-приложение бота' },
  { command: 'myapps', description: 'ваши мини-приложения' },
  { command: 'setmenubutton', description: 'кнопка мини-приложения у поля ввода' },
  { command: 'deleteapp', description: 'удалить мини-приложение' },
  { command: 'token', description: 'новый токен бота (старый перестанет работать)' },
  { command: 'deletebot', description: 'удалить бота' },
  { command: 'stickers', description: 'мини-приложение стикеров' },
  { command: 'api', description: 'как подключить код бота' },
  { command: 'help', description: 'список команд' },
  { command: 'cancel', description: 'отменить текущее действие' },
];

/** Мини-приложения ботов: ссылка vera://app/<ник_бота>/<имя>. */
const MAX_APPS_PER_BOT = 10;
const MAX_APP_DESCRIPTION = 512;
const APP_SHORT_RE = /^[A-Za-z0-9_]{3,30}$/;
const APP_LINK_RE = /^vera:\/\/app\/([A-Za-z0-9_]{1,32})\/([A-Za-z0-9_]{3,30})$/;
const appLink = (bot, app) => `vera://app/${bot.username}/${app.shortName}`;
/** Шаги диалога /hub, где слово-команда — это ответ, а не новая команда. */
const STEP_WORDS = { newapp_description: '/skip', menu_url: '/empty' };

const HUB_HELP = [
  'Привет! Я Hub: создаю ботов и открываю стикеры.',
  '',
  ...HUB_COMMANDS.filter((c) => c.command !== 'help').map((c) => `/${c.command} — ${c.description}`),
].join('\n');

const MAX_COMMANDS = 100;
const COMMAND_RE = /^[a-z0-9_]{1,32}$/;
const MAX_COMMAND_DESCRIPTION = 256;

/** Проверка списка команд для setMyCommands, как у Telegram. */
function sanitizeCommands(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return { error: 'commands: некорректный JSON' }; }
  }
  if (!Array.isArray(list)) return { error: 'commands: нужен массив' };
  if (list.length > MAX_COMMANDS) return { error: `commands: не больше ${MAX_COMMANDS} команд` };
  const seen = new Set();
  const value = [];
  for (const item of list) {
    const command = String(item?.command || '').trim().replace(/^\//, '').toLowerCase();
    const description = stripControl(item?.description);
    if (!COMMAND_RE.test(command)) return { error: `команда «${command}»: 1–32 символа a-z, 0-9 и _` };
    if (!description || description.length > MAX_COMMAND_DESCRIPTION) {
      return { error: `описание /${command}: от 1 до ${MAX_COMMAND_DESCRIPTION} символов` };
    }
    if (seen.has(command)) return { error: `команда /${command} повторяется` };
    seen.add(command);
    value.push({ command, description });
  }
  return { value };
}

const API_HELP = [
  'Bot API Vera устроен как Telegram Bot API.',
  'Адрес: <сайт Vera>/bot<токен>/<метод>. Параметры — JSON в теле POST или query-строка. Ответ: { ok, result } или { ok: false, description }.',
  '',
  'Методы:',
  '• getMe — данные бота',
  '• getUpdates { offset, limit, timeout } — новые события, long polling до 25 с',
  '• sendMessage { chat_id, text, reply_markup?, reply_to_message_id? }',
  '• sendSticker { chat_id, sticker } — стикер по id (file_id из события)',
  '• setWebhook { url, secret_token? } — события POST-запросом на https; секрет придёт в заголовке X-Vera-Bot-Api-Secret-Token',
  '• setMyCommands { commands: [{ command, description }] } — меню команд над полем ввода; getMyCommands, deleteMyCommands',
  '• setChatMenuButton { menu_button: { type: "web_app", text, web_app: { url } } } — кнопка мини-приложения у поля ввода; { type: "default" } убирает её; getChatMenuButton',
  '• deleteWebhook, getWebhookInfo, answerCallbackQuery',
  '',
  'Мини-приложения создаются в /hub командой /newapp. Ссылка на приложение — vera://app/<ник_бота>/<имя>.',
  '',
  'Бот пишет только в личные чаты, где с ним уже начали диалог. Кнопки: reply_markup.inline_keyboard с callback_data или web_app { url: "https://..." }.',
  '',
  'Мини-приложение получает initData в адресе после #vgWebAppData=. Проверка подписи:',
  'secret = HMAC_SHA256(key="WebAppData", data=sha256_hex(токен)); hash = HMAC_SHA256(key=secret, data=поля key=value по алфавиту через \\n).',
].join('\n');

/**
 * @param {object} deps
 * @param {import('express').Express} deps.app
 * @param {() => any} deps.getDb            БД переприсваивается (reloadDb), поэтому — геттер.
 * @param {Function} deps.auth              authMiddleware
 * @param {() => void} deps.saveDb
 * @param {any} deps.io                     socket.io сервер
 * @param {Map<string, Set<string>>} [deps.userSockets]
 * @param {(host: string) => boolean} deps.isPrivateHost
 * @param {Function} [deps.makeRateLimit]
 * @param {(id: string) => any} [deps.resolveSticker]  стикер по id (модуль stickers.js)
 */
function registerBots({
  app, getDb, auth, saveDb, io, userSockets = null, isPrivateHost, makeRateLimit = null,
  resolveSticker = () => null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  lookup = (host) => dns.promises.lookup(host, { all: true }),
  now = () => Date.now(),
}) {
  /** botId → { nextId, items, waiters }. Очередь событий живёт в памяти. */
  const queues = new Map();
  /** userId → шаг диалога с /hub. */
  const hubState = new Map();
  const iso = () => new Date(now()).toISOString();

  function ensureCollections(db) {
    if (!Array.isArray(db.bots)) db.bots = [];
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.messages)) db.messages = [];
  }

  function ensureHub(db) {
    ensureCollections(db);
    if (db.users.some((u) => u.id === HUB_ID)) return false;
    // Ник «hub» мог занять человек ещё до появления бота: тогда не дублируем ник.
    const taken = db.users.some((u) => lower(u.username) === HUB_USERNAME);
    if (taken) console.warn(`[hub] ник «${HUB_USERNAME}» занят пользователем, системный бот получит ник hub_bot`);
    db.users.push({
      id: HUB_ID, username: taken ? 'hub_bot' : HUB_USERNAME, firstName: 'Hub', lastName: null,
      email: null, phone: null, avatarUrl: null,
      bio: 'Создаёт ботов и открывает стикеры. Команды: /help',
      isBot: true, isSystemBot: true, isOnline: false, lastSeen: iso(), createdAt: iso(),
    });
    return true;
  }

  /** Записи старой заглушки /api/bots: токен лежал открытым текстом. */
  function migrateLegacy(db) {
    let changed = false;
    for (const bot of db.bots) {
      if (!bot || bot.userId) continue;
      if (!bot.legacy) { bot.legacy = true; changed = true; }
      if ('token' in bot) { delete bot.token; changed = true; }
    }
    return changed;
  }

  {
    const db = getDb();
    const hubCreated = ensureHub(db);
    const migrated = migrateLegacy(db);
    if (hubCreated || migrated) saveDb();
  }

  const activeBots = (db) => (db.bots || []).filter((b) => b && !b.legacy && b.userId);
  const botByUserId = (db, userId) => activeBots(db).find((b) => b.userId === userId) || null;
  const isBotUserId = (db, userId) => userId === HUB_ID || !!botByUserId(db, userId);
  const ownBots = (db, ownerId) => activeBots(db).filter((b) => b.ownerId === ownerId);

  function botByToken(db, token) {
    const raw = String(token || '');
    const sep = raw.indexOf(':');
    if (sep <= 0 || raw.length > 200) return null;
    const bot = activeBots(db).find((b) => b.id === raw.slice(0, sep));
    if (!bot || typeof bot.tokenHash !== 'string' || bot.tokenHash.length !== 64) return null;
    const given = Buffer.from(hashToken(raw), 'hex');
    return crypto.timingSafeEqual(given, Buffer.from(bot.tokenHash, 'hex')) ? bot : null;
  }

  function findOwnBot(db, ownerId, raw) {
    const name = lower(String(raw || '').replace(/^[@/]+/, ''));
    return ownBots(db, ownerId).find((b) => lower(b.username) === name) || null;
  }

  function createBot(db, ownerId, rawName, rawUsername) {
    const owner = db.users.find((u) => u.id === ownerId);
    if (!owner || owner.isBot) return { error: 'Создавать ботов могут только пользователи', status: 403 };
    if (ownBots(db, ownerId).length >= MAX_BOTS_PER_OWNER) {
      return { error: `Не больше ${MAX_BOTS_PER_OWNER} ботов на аккаунт`, status: 429 };
    }
    const n = cleanName(rawName);
    if (n.error) return { error: n.error, status: 400 };
    const u = cleanBotUsername(rawUsername);
    if (u.error) return { error: u.error, status: 400 };
    if (db.users.some((x) => lower(x.username) === lower(u.username))) return { error: 'Этот ник уже занят', status: 409 };
    const stamp = iso();
    const user = {
      id: crypto.randomUUID(), username: u.username, firstName: n.name, lastName: null,
      email: null, phone: null, avatarUrl: null, bio: null,
      isBot: true, botOwnerId: ownerId, isOnline: false, lastSeen: stamp, createdAt: stamp,
    };
    const bot = {
      id: crypto.randomUUID(), userId: user.id, ownerId, username: u.username, name: n.name,
      tokenHash: '', tokenIssuedAt: stamp, webhook: null, createdAt: stamp,
    };
    const token = newToken(bot.id);
    bot.tokenHash = hashToken(token);
    db.users.push(user);
    db.bots.push(bot);
    saveDb();
    return { bot, user, token };
  }

  function reissueToken(bot) {
    const token = newToken(bot.id);
    bot.tokenHash = hashToken(token);
    bot.tokenIssuedAt = iso();
    saveDb();
    return token;
  }

  /**
   * Удаление: запись бота исчезает, а аккаунт остаётся — на него ссылаются
   * старые сообщения. Ник освобождается, бот пропадает из поиска.
   */
  function deleteBot(db, bot) {
    db.bots = db.bots.filter((b) => b !== bot);
    const user = db.users.find((u) => u.id === bot.userId);
    if (user) {
      user.username = `deleted_${String(user.id).replace(/-/g, '').slice(0, 12)}`;
      user.firstName = 'Удалённый бот';
      user.bio = null;
      user.botDeleted = true;
    }
    queues.delete(bot.id);
    saveDb();
  }

  const publicView = (bot) => ({ id: bot.id, userId: bot.userId, username: bot.username, name: bot.name, createdAt: bot.createdAt });
  const ownerView = (bot) => ({ ...publicView(bot), tokenIssuedAt: bot.tokenIssuedAt || null, hasWebhook: !!(bot.webhook && bot.webhook.url) });

  function toBotUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      is_bot: !!user.isBot,
      first_name: user.firstName || user.username || 'Пользователь',
      ...(user.lastName ? { last_name: user.lastName } : {}),
      ...(user.username ? { username: user.username } : {}),
    };
  }

  function toBotMessage(db, message) {
    const from = db.users.find((u) => u.id === message.senderId);
    const out = {
      message_id: message.id,
      from: toBotUser(from),
      chat: { id: message.chatId, type: 'private' },
      date: Math.floor((Date.parse(message.createdAt) || now()) / 1000),
    };
    const text = message.content ?? message.text;
    if (text) out.text = text;
    if (message.sticker) out.sticker = { file_id: message.sticker.id, emoji: message.sticker.emoji, set_name: message.sticker.packName };
    if (message.replyToId) out.reply_to_message_id = message.replyToId;
    if (message.replyMarkup) out.reply_markup = message.replyMarkup;
    return out;
  }

  /** Сообщение от имени бота в личный чат, где бот — участник. */
  function postBotMessage(chatId, botUserId, { text = '', replyMarkup = null, attachments = [], type = 'text', sticker = null, replyToId = null } = {}) {
    const db = getDb();
    const chat = (db.chats || []).find((c) => c.id === chatId);
    const members = (db.chatMembers || []).filter((m) => m.chatId === chatId);
    if (!chat || !members.some((m) => m.userId === botUserId)) return { error: 'бот не состоит в этом чате', status: 403 };
    if (!DIRECT_TYPES.has(chat.type || 'direct')) return { error: 'боты пока пишут только в личные чаты', status: 400 };
    const blocked = members.some((m) => m.userId !== botUserId
      && (db.userBlocks || []).some((b) => b && b.blockerId === m.userId && b.blockedId === botUserId));
    if (blocked) return { error: 'пользователь заблокировал бота', status: 403 };
    const message = {
      id: crypto.randomUUID(), chatId, senderId: botUserId, text, content: text,
      replyToId: replyToId || null, attachments, type,
      ...(sticker ? { sticker } : {}),
      ...(replyMarkup ? { replyMarkup } : {}),
      readBy: [botUserId], editedAt: null, isEdited: false, isPinned: false, isDeleted: false,
      createdAt: iso(),
    };
    db.messages.push(message);
    try { saveDb(); } catch { /* остаётся в памяти, допишется таймером */ }
    const sender = db.users.find((u) => u.id === botUserId) || null;
    const result = { ...message, sender };
    if (userSockets) {
      for (const m of members) {
        for (const sid of userSockets.get(m.userId) || []) io.to(sid).socketsJoin?.(`chat:${chatId}`);
      }
    }
    io.to(`chat:${chatId}`).emit('message:new', result);
    return { message: result };
  }

  // ─── Очередь событий и вебхуки ──────────────────────────────────────────────
  function queueOf(botId) {
    let q = queues.get(botId);
    if (!q) { q = { nextId: 1, items: [], waiters: new Set() }; queues.set(botId, q); }
    return q;
  }
  function pruneQueue(q) {
    const cutoff = now() - UPDATE_TTL_MS;
    while (q.items.length && (q.items[0]._at < cutoff || q.items.length > MAX_QUEUE)) q.items.shift();
  }
  function publicUpdate(item) {
    const { _at, ...rest } = item;
    return rest;
  }

  async function assertPublicWebhook(raw) {
    let url;
    try { url = new URL(String(raw)); } catch { throw new Error('некорректная ссылка'); }
    if (url.protocol !== 'https:') throw new Error('вебхук принимает только https://');
    if (url.username || url.password) throw new Error('логин и пароль в ссылке запрещены');
    if (!WEBHOOK_PORTS.has(url.port)) throw new Error('порт вебхука: 443, 8443 или 88');
    if (isPrivateHost(url.hostname)) throw new Error('локальные и внутренние адреса запрещены');
    // Имя может указывать на внутренний адрес через DNS — проверяем, куда оно ведёт.
    const resolved = await lookup(url.hostname);
    const list = Array.isArray(resolved) ? resolved : [resolved];
    if (!list.length || list.some((a) => !a || isPrivateHost(a.address))) throw new Error('адрес вебхука ведёт во внутреннюю сеть');
    return url;
  }

  async function deliverWebhook(botId, update, attempt) {
    const bot = activeBots(getDb()).find((b) => b.id === botId);
    const hook = bot && bot.webhook;
    if (!hook || !hook.url) return false;
    try {
      await assertPublicWebhook(hook.url);
      const response = await fetchImpl(hook.url, {
        method: 'POST',
        // Без redirect: 'manual' внешний сервер увёл бы запрос редиректом во внутреннюю сеть.
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          ...(hook.secret ? { 'X-Vera-Bot-Api-Secret-Token': hook.secret } : {}),
        },
        body: JSON.stringify(update),
      });
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      hook.lastError = null;
      hook.lastErrorAt = null;
      return true;
    } catch (e) {
      hook.lastError = String((e && e.message) || e).slice(0, 200);
      hook.lastErrorAt = now();
      const delay = WEBHOOK_RETRY_MS[attempt];
      if (delay !== undefined) {
        const timer = setTimeout(() => { void deliverWebhook(botId, update, attempt + 1); }, delay);
        timer.unref?.();
      }
      return false;
    }
  }

  function pushUpdate(bot, payload) {
    const q = queueOf(bot.id);
    const item = { update_id: q.nextId++, ...payload, _at: now() };
    if (bot.webhook && bot.webhook.url) {
      void deliverWebhook(bot.id, publicUpdate(item), 0);
      return item;
    }
    q.items.push(item);
    pruneQueue(q);
    for (const wake of [...q.waiters]) wake();
    return item;
  }

  // ─── /hub ───────────────────────────────────────────────────────────────────
  const hubMenu = {
    inline_keyboard: [
      [{ text: '➕ Новый бот', callback_data: '/newbot' }, { text: '🤖 Мои боты', callback_data: '/mybots' }],
      [{ text: '🧩 Мини-приложение', callback_data: '/newapp' }, { text: '📱 Мои приложения', callback_data: '/myapps' }],
      [{ text: '🎨 Стикеры', web_app: { url: STICKERS_APP_URL } }],
    ],
  };
  const stickersButton = { inline_keyboard: [[{ text: '🎨 Открыть стикеры', web_app: { url: STICKERS_APP_URL } }]] };

  const hubReply = (chatId, text, replyMarkup = null) => postBotMessage(chatId, HUB_ID, { text, replyMarkup });

  function stateOf(userId) {
    const state = hubState.get(userId);
    if (!state || now() - state.at > HUB_STATE_TTL_MS) { hubState.delete(userId); return null; }
    return state;
  }
  const setState = (userId, step, data = {}) => hubState.set(userId, { step, data, at: now() });

  const listBots = (db, userId) => ownBots(db, userId).map((b) => `• /${b.username} — ${b.name}`).join('\n');

  function doToken(chatId, userId, raw) {
    const bot = findOwnBot(getDb(), userId, raw);
    if (!bot) return hubReply(chatId, `Не нашёл вашего бота «${stripControl(raw).slice(0, 40)}». Список: /mybots`);
    const token = reissueToken(bot);
    return hubReply(chatId, `Новый токен для /${bot.username}:\n${token}\n\nСтарый токен больше не работает.`);
  }

  function askDelete(chatId, userId, raw) {
    const bot = findOwnBot(getDb(), userId, raw);
    if (!bot) return hubReply(chatId, `Не нашёл вашего бота «${stripControl(raw).slice(0, 40)}». Список: /mybots`);
    setState(userId, 'delete_confirm', { botId: bot.id });
    return hubReply(chatId, `Удалить /${bot.username}? Восстановить бота будет нельзя, токен перестанет работать.\n\nЧтобы подтвердить, отправьте: Да, удалить\nОтмена — /cancel`);
  }

  // ─── Мини-приложения ────────────────────────────────────────────────────────
  const notMyBot = (chatId, raw) => hubReply(chatId, `Не нашёл вашего бота «${stripControl(raw).slice(0, 40)}». Список: /mybots`);
  const appsOf = (bot) => (Array.isArray(bot.apps) ? bot.apps : []);
  const myApps = (db, userId) => ownBots(db, userId).flatMap((bot) => appsOf(bot).map((app) => ({ bot, app })));

  /** Сайт мини-приложения: только публичный https. Открывает его браузер пользователя. */
  function cleanAppUrl(raw) {
    const url = String(raw || '').trim();
    if (!isHttpsUrl(url)) return { error: 'Нужна ссылка https:// до 512 символов, без логина и пароля' };
    if (isPrivateHost(new URL(url).hostname)) return { error: 'Ссылка ведёт во внутреннюю сеть' };
    return { url };
  }

  function addApp(bot, { title, description, url, shortName: rawShort }) {
    const shortName = String(rawShort || '').trim();
    if (!APP_SHORT_RE.test(shortName)) return { error: 'Короткое имя: латиница, цифры и _, от 3 до 30 символов' };
    if (appsOf(bot).length >= MAX_APPS_PER_BOT) return { error: `У бота уже ${MAX_APPS_PER_BOT} мини-приложений, это максимум`, final: true };
    if (appsOf(bot).some((a) => lower(a.shortName) === lower(shortName))) return { error: 'У этого бота уже есть приложение с таким именем' };
    const app = { shortName, title, description, url, createdAt: iso() };
    bot.apps = [...appsOf(bot), app];
    saveDb();
    return { app };
  }

  function startNewApp(chatId, userId, raw) {
    const bot = findOwnBot(getDb(), userId, raw);
    if (!bot) return notMyBot(chatId, raw);
    if (appsOf(bot).length >= MAX_APPS_PER_BOT) {
      return hubReply(chatId, `У /${bot.username} уже ${MAX_APPS_PER_BOT} мини-приложений, это максимум. Удалить лишнее: /deleteapp`);
    }
    setState(userId, 'newapp_title', { botId: bot.id });
    return hubReply(chatId, `Мини-приложение для /${bot.username}. Как оно называется? Название увидят пользователи.\n\nОтмена — /cancel`);
  }

  function doDeleteApp(chatId, userId, raw) {
    const [botName = '', shortName = ''] = String(raw || '').trim().split(/[/\s]+/).filter(Boolean);
    const bot = findOwnBot(getDb(), userId, botName);
    if (!bot) return notMyBot(chatId, botName);
    const app = appsOf(bot).find((a) => lower(a.shortName) === lower(shortName));
    if (!app) return hubReply(chatId, `У /${bot.username} нет приложения «${stripControl(shortName).slice(0, 30)}». Список: /myapps`);
    bot.apps = appsOf(bot).filter((a) => a !== app);
    // Кнопка у поля ввода вела на это приложение — убираем и её.
    if (bot.menuButton && bot.menuButton.url === app.url) bot.menuButton = null;
    saveDb();
    return hubReply(chatId, `Мини-приложение «${app.title}» удалено. Ссылка ${appLink(bot, app)} больше не открывается.`);
  }

  function startMenuButton(chatId, userId, raw) {
    const bot = findOwnBot(getDb(), userId, raw);
    if (!bot) return notMyBot(chatId, raw);
    setState(userId, 'menu_url', { botId: bot.id });
    const current = bot.menuButton ? `Сейчас: «${bot.menuButton.text}» → ${bot.menuButton.url}\n\n` : '';
    const apps = appsOf(bot).map((a) => a.shortName).join(', ');
    return hubReply(chatId, [
      `${current}Кнопка слева от поля ввода в чате с /${bot.username} откроет мини-приложение.`,
      '',
      `Пришлите ссылку https://…${apps ? ` или короткое имя приложения бота (${apps})` : ''}.`,
      'Убрать кнопку — /empty, отмена — /cancel',
    ].join('\n'));
  }

  function handleCommand(chatId, userId, text) {
    const db = getDb();
    const [head, ...rest] = text.split(/\s+/);
    const cmd = head.toLowerCase().replace(/@[a-z0-9_]+$/, '');
    const arg = rest.join(' ').trim();
    hubState.delete(userId);
    switch (cmd) {
      case '/start':
      case '/help':
        return hubReply(chatId, HUB_HELP, hubMenu);
      case '/cancel':
        return hubReply(chatId, 'Хорошо, отменил.');
      case '/newbot':
        if (ownBots(db, userId).length >= MAX_BOTS_PER_OWNER) {
          return hubReply(chatId, `У вас уже ${MAX_BOTS_PER_OWNER} ботов, это максимум. Удалить лишнего: /deletebot`);
        }
        setState(userId, 'newbot_name');
        return hubReply(chatId, 'Новый бот. Как его назовём? Это имя увидят пользователи.\n\nОтмена — /cancel');
      case '/mybots': {
        const list = listBots(db, userId);
        return hubReply(chatId, list ? `Ваши боты:\n${list}\n\nНовый токен — /token, удалить — /deletebot` : 'У вас пока нет ботов. Создать — /newbot');
      }
      case '/token':
      case '/revoke': {
        if (arg) return doToken(chatId, userId, arg);
        const list = listBots(db, userId);
        if (!list) return hubReply(chatId, 'У вас пока нет ботов. Создать — /newbot');
        setState(userId, 'token_pick');
        return hubReply(chatId, `Какому боту выпустить новый токен? Пришлите ник.\n\n${list}\n\nСтарый токен перестанет работать сразу.`);
      }
      case '/deletebot': {
        if (arg) return askDelete(chatId, userId, arg);
        const list = listBots(db, userId);
        if (!list) return hubReply(chatId, 'У вас пока нет ботов.');
        setState(userId, 'delete_pick');
        return hubReply(chatId, `Какого бота удалить? Пришлите ник.\n\n${list}`);
      }
      case '/stickers':
        return hubReply(chatId, 'Стикеры: создавайте свои наборы, загружайте картинки, добавляйте чужие наборы и скачивайте их.', stickersButton);
      case '/newapp': {
        if (arg) return startNewApp(chatId, userId, arg);
        const list = listBots(db, userId);
        if (!list) return hubReply(chatId, 'Мини-приложение принадлежит боту, а у вас пока нет ботов. Сначала создайте бота: /newbot');
        setState(userId, 'newapp_bot');
        return hubReply(chatId, `Для какого бота мини-приложение? Пришлите ник.\n\n${list}`);
      }
      case '/myapps': {
        const items = myApps(db, userId);
        if (!items.length) {
          return hubReply(chatId, ownBots(db, userId).length ? 'Мини-приложений пока нет. Создать — /newapp' : 'У вас пока нет ботов. Создать — /newbot');
        }
        const lines = items.map(({ bot, app }) => `• ${app.title} — /${bot.username}\n  ${app.url}\n  ${appLink(bot, app)}`);
        const keyboard = items.slice(0, 8).map(({ bot, app }) => [{ text: `🧩 ${app.title}`.slice(0, 64), web_app: { url: appLink(bot, app) } }]);
        return hubReply(chatId, `Ваши мини-приложения:\n${lines.join('\n')}\n\nКнопка у поля ввода — /setmenubutton, удалить — /deleteapp`, { inline_keyboard: keyboard });
      }
      case '/deleteapp': {
        if (arg) return doDeleteApp(chatId, userId, arg);
        const items = myApps(db, userId);
        if (!items.length) return hubReply(chatId, 'Мини-приложений пока нет.');
        setState(userId, 'deleteapp_pick');
        const list = items.map(({ bot, app }) => `• ${bot.username}/${app.shortName} — ${app.title}`).join('\n');
        return hubReply(chatId, `Какое мини-приложение удалить? Пришлите «ник_бота/имя».\n\n${list}`);
      }
      case '/setmenubutton': {
        if (arg) return startMenuButton(chatId, userId, arg);
        const list = listBots(db, userId);
        if (!list) return hubReply(chatId, 'У вас пока нет ботов. Создать — /newbot');
        setState(userId, 'menu_bot');
        return hubReply(chatId, `Какому боту настроить кнопку у поля ввода? Пришлите ник.\n\n${list}`);
      }
      case '/api':
        return hubReply(chatId, API_HELP);
      default:
        return hubReply(chatId, 'Не знаю такой команды. Список команд: /help');
    }
  }

  function handleHub(chatId, userId, rawText) {
    const text = String(rawText || '').trim();
    if (!text) return hubReply(chatId, 'Я понимаю только текст и команды. Список: /help');
    const state = stateOf(userId);
    // «/skip» и «/empty» на своём шаге — ответ на вопрос, а не новая команда.
    const stepWord = !!state && STEP_WORDS[state.step] === text.toLowerCase();
    if (text.startsWith('/') && !stepWord) return handleCommand(chatId, userId, text);
    if (!state) return hubReply(chatId, 'Я понимаю команды. Список: /help', hubMenu);
    const stepBot = () => ownBots(getDb(), userId).find((b) => b.id === state.data.botId) || null;
    switch (state.step) {
      case 'newapp_bot':
        hubState.delete(userId);
        return startNewApp(chatId, userId, text);
      case 'newapp_title': {
        const n = cleanName(text);
        if (n.error) return hubReply(chatId, `${n.error.replace('Имя', 'Название')}. Попробуйте ещё раз.`);
        setState(userId, 'newapp_description', { ...state.data, title: n.name });
        return hubReply(chatId, `«${n.name}». Теперь короткое описание: что умеет приложение, до ${MAX_APP_DESCRIPTION} символов.\n\nПропустить — /skip`);
      }
      case 'newapp_description': {
        const description = stepWord ? '' : stripControl(text);
        if (description.length > MAX_APP_DESCRIPTION) return hubReply(chatId, `Описание длиннее ${MAX_APP_DESCRIPTION} символов. Сократите или /skip.`);
        setState(userId, 'newapp_url', { ...state.data, description });
        return hubReply(chatId, 'Пришлите ссылку на сайт приложения: https://…\n\nVera откроет его в окне поверх чата и передаст подписанные данные пользователя. Как их проверить — /api');
      }
      case 'newapp_url': {
        const url = cleanAppUrl(text);
        if (url.error) return hubReply(chatId, `${url.error}. Пришлите другую ссылку или /cancel.`);
        setState(userId, 'newapp_short', { ...state.data, url: url.url });
        return hubReply(chatId, 'Последний шаг: короткое имя для ссылки. Латиница, цифры и _, от 3 до 30 символов. Например: shop');
      }
      case 'newapp_short': {
        const bot = stepBot();
        if (!bot) { hubState.delete(userId); return hubReply(chatId, 'Этого бота уже нет.'); }
        const result = addApp(bot, { ...state.data, shortName: text });
        if (result.error) {
          if (result.final) hubState.delete(userId);
          return hubReply(chatId, result.final ? result.error : `${result.error}. Пришлите другое имя или /cancel.`);
        }
        hubState.delete(userId);
        const link = appLink(bot, result.app);
        return hubReply(chatId, [
          `Готово! Мини-приложение «${result.app.title}» создано.`,
          '',
          `Ссылка: ${link}`,
          '',
          `Чтобы оно открывалось кнопкой у поля ввода в чате с ботом: /setmenubutton ${bot.username}`,
        ].join('\n'), { inline_keyboard: [[{ text: '🧩 Открыть', web_app: { url: link } }]] });
      }
      case 'deleteapp_pick':
        hubState.delete(userId);
        return doDeleteApp(chatId, userId, text);
      case 'menu_bot':
        hubState.delete(userId);
        return startMenuButton(chatId, userId, text);
      case 'menu_url': {
        const bot = stepBot();
        if (!bot) { hubState.delete(userId); return hubReply(chatId, 'Этого бота уже нет.'); }
        if (stepWord) {
          hubState.delete(userId);
          bot.menuButton = null;
          saveDb();
          return hubReply(chatId, `Кнопка у /${bot.username} убрана.`);
        }
        const app = appsOf(bot).find((a) => lower(a.shortName) === lower(text));
        const url = app ? { url: app.url } : cleanAppUrl(text);
        if (url.error) return hubReply(chatId, `${url.error}. Пришлите другую ссылку, /empty или /cancel.`);
        setState(userId, 'menu_text', { botId: bot.id, url: url.url });
        return hubReply(chatId, 'Как подписать кнопку? До 64 символов, например «Открыть».');
      }
      case 'menu_text': {
        const bot = stepBot();
        if (!bot) { hubState.delete(userId); return hubReply(chatId, 'Этого бота уже нет.'); }
        const n = cleanName(text);
        if (n.error) return hubReply(chatId, `${n.error.replace('Имя', 'Подпись')}. Попробуйте ещё раз.`);
        hubState.delete(userId);
        bot.menuButton = { text: n.name, url: state.data.url };
        saveDb();
        return hubReply(chatId, `Готово. В чате с /${bot.username} слева от поля ввода появилась кнопка «${n.name}».`);
      }
      case 'newbot_name': {
        const n = cleanName(text);
        if (n.error) return hubReply(chatId, `${n.error}. Попробуйте ещё раз.`);
        setState(userId, 'newbot_username', { name: n.name });
        return hubReply(chatId, `Отлично, «${n.name}». Теперь ник бота: латиница, цифры и _, от 5 до 32 символов, с «bot» на конце. Например: weather_bot.\n\nПо нику бота найдут в поиске: /weather_bot`);
      }
      case 'newbot_username': {
        const result = createBot(getDb(), userId, state.data.name, text);
        if (result.error) {
          if (result.status === 400 || result.status === 409) {
            setState(userId, 'newbot_username', state.data);
            return hubReply(chatId, `${result.error}. Пришлите другой ник или /cancel.`);
          }
          hubState.delete(userId);
          return hubReply(chatId, result.error);
        }
        hubState.delete(userId);
        const { bot, token } = result;
        return hubReply(chatId, [
          `Готово! Бот «${bot.name}» создан. Найти его в поиске: /${bot.username}`,
          '',
          'Токен для Bot API:',
          token,
          '',
          `Храните токен в секрете: с ним кто угодно может писать от имени бота. Если он утёк, выпустите новый: /token ${bot.username}`,
          '',
          'Как подключить код бота — /api',
        ].join('\n'));
      }
      case 'token_pick':
        hubState.delete(userId);
        return doToken(chatId, userId, text);
      case 'delete_pick':
        hubState.delete(userId);
        return askDelete(chatId, userId, text);
      case 'delete_confirm': {
        hubState.delete(userId);
        const db = getDb();
        const bot = ownBots(db, userId).find((b) => b.id === state.data.botId);
        if (!bot) return hubReply(chatId, 'Этого бота уже нет.');
        if (lower(text) !== 'да, удалить') return hubReply(chatId, 'Удаление отменено.');
        deleteBot(db, bot);
        return hubReply(chatId, `Бот /${bot.username} удалён. Токен больше не работает, ник свободен.`);
      }
      default:
        hubState.delete(userId);
        return hubReply(chatId, HUB_HELP, hubMenu);
    }
  }

  /** Хук из handleSendMessage: новое сообщение в личке с ботом. */
  function onMessage(message) {
    try {
      if (!message || message.isDeleted) return;
      const db = getDb();
      const chat = (db.chats || []).find((c) => c.id === message.chatId);
      if (!chat || !DIRECT_TYPES.has(chat.type || 'direct')) return;
      const senderId = message.senderId;
      if (isBotUserId(db, senderId)) return;
      const other = (db.chatMembers || []).find((m) => m.chatId === chat.id && m.userId !== senderId);
      if (!other) return;
      if (other.userId === HUB_ID) {
        // Отвечаем после того, как сообщение пользователя ушло клиентам.
        setImmediate(() => {
          try { handleHub(chat.id, senderId, message.content ?? message.text); } catch (e) { console.error('[hub]', (e && e.message) || e); }
        });
        return;
      }
      const bot = botByUserId(db, other.userId);
      if (bot) pushUpdate(bot, { message: toBotMessage(db, message) });
    } catch (e) {
      console.error('[bots] onMessage:', (e && e.message) || e);
    }
  }

  // ─── REST для клиента Vera ─────────────────────────────────────────────────
  app.get('/api/bots/my', auth, (req, res) => {
    res.json(ownBots(getDb(), req.userId).map(ownerView));
  });

  // Токен в ответе — единственный раз, когда его можно увидеть.
  app.post('/api/bots/create', auth, (req, res) => {
    const result = createBot(getDb(), req.userId, req.body?.name, req.body?.username);
    if (result.error) return res.status(result.status).json({ message: result.error });
    res.status(201).json({ bot: ownerView(result.bot), token: result.token });
  });

  app.post('/api/bots/:id/token', auth, (req, res) => {
    const bot = ownBots(getDb(), req.userId).find((b) => b.id === req.params.id);
    if (!bot) return res.status(404).json({ message: 'Бот не найден' });
    res.json({ token: reissueToken(bot), bot: ownerView(bot) });
  });

  app.delete('/api/bots/:id', auth, (req, res) => {
    const db = getDb();
    const bot = ownBots(db, req.userId).find((b) => b.id === req.params.id);
    if (!bot) return res.status(404).json({ message: 'Бот не найден' });
    deleteBot(db, bot);
    res.json({ ok: true });
  });

  /** Сообщение бота, под которым есть кнопка; проверка доступа пользователя. */
  function buttonMessage(db, req, res) {
    const msg = db.messages.find((m) => m.id === String(req.body?.messageId || '') && !m.isDeleted);
    if (!msg) { res.status(404).json({ message: 'Сообщение не найдено' }); return null; }
    if (!(db.chatMembers || []).some((m) => m.chatId === msg.chatId && m.userId === req.userId)) {
      res.status(403).json({ message: 'Нет доступа' });
      return null;
    }
    return msg;
  }
  const buttonsOf = (msg) => ((msg.replyMarkup && msg.replyMarkup.inline_keyboard) || []).flat();

  // Нажатие inline-кнопки с callback_data под сообщением бота.
  app.post('/api/bots/callback', auth, (req, res) => {
    const db = getDb();
    const data = req.body?.data;
    if (typeof data !== 'string' || !data || Buffer.byteLength(data) > 64) return res.status(400).json({ message: 'Некорректная кнопка' });
    const msg = buttonMessage(db, req, res);
    if (!msg) return undefined;
    if (!isBotUserId(db, msg.senderId) || !buttonsOf(msg).some((b) => b.callback_data === data)) {
      return res.status(400).json({ message: 'Кнопка не найдена' });
    }
    if (msg.senderId === HUB_ID) {
      setImmediate(() => {
        try { handleHub(msg.chatId, req.userId, data); } catch (e) { console.error('[hub]', (e && e.message) || e); }
      });
      return res.json({ ok: true });
    }
    const bot = botByUserId(db, msg.senderId);
    const user = db.users.find((u) => u.id === req.userId);
    pushUpdate(bot, {
      callback_query: { id: crypto.randomUUID(), from: toBotUser(user), message: toBotMessage(db, msg), chat_instance: msg.chatId, data },
    });
    return res.json({ ok: true });
  });

  // initData для мини-приложения внешнего бота. Подписываем только адрес,
  // который бот сам поставил в кнопку своего сообщения в чате пользователя:
  // иначе подписанные данные можно было бы отдать произвольному сайту.
  app.post('/api/bots/webapp-init', auth, (req, res) => {
    const db = getDb();
    const url = String(req.body?.url || '');
    const msg = buttonMessage(db, req, res);
    if (!msg) return undefined;
    const bot = botByUserId(db, msg.senderId);
    if (!bot || !buttonsOf(msg).some((b) => b.web_app && b.web_app.url === url)) {
      return res.status(400).json({ message: 'Кнопка мини-приложения не найдена' });
    }
    if (!isHttpsUrl(url) || isPrivateHost(new URL(url).hostname)) {
      return res.status(400).json({ message: 'Мини-приложение должно открываться по https' });
    }
    const user = db.users.find((u) => u.id === req.userId);
    const fields = {
      query_id: crypto.randomUUID(),
      user: JSON.stringify(toBotUser(user)),
      chat_instance: msg.chatId,
      auth_date: String(Math.floor(now() / 1000)),
    };
    return res.json({ initData: signWebAppData(bot.tokenHash, fields), bot: publicView(bot) });
  });

  // Открыть мини-приложение бота по ссылке vera://app/<бот>/<имя> или кнопкой
  // у поля ввода (без app). Подписываем только адрес, который владелец бота
  // сам сохранил через /hub или setChatMenuButton.
  app.post('/api/bots/app-init', auth, (req, res) => {
    const db = getDb();
    const name = lower(String(req.body?.username || '').replace(/^[@/]+/, ''));
    const shortName = req.body?.app == null ? null : String(req.body.app);
    const bot = activeBots(db).find((b) => lower(b.username) === name);
    if (!bot) return res.status(404).json({ message: 'Бот не найден' });
    let target;
    if (shortName !== null) {
      const found = appsOf(bot).find((a) => lower(a.shortName) === lower(shortName));
      if (found) target = { url: found.url, title: found.title };
    } else if (bot.menuButton && bot.menuButton.url) {
      target = { url: bot.menuButton.url, title: bot.name };
    }
    if (!target) return res.status(404).json({ message: 'Мини-приложение не найдено' });
    if (!isHttpsUrl(target.url) || isPrivateHost(new URL(target.url).hostname)) {
      return res.status(400).json({ message: 'Мини-приложение должно открываться по https' });
    }
    const user = db.users.find((u) => u.id === req.userId);
    const fields = {
      query_id: crypto.randomUUID(),
      user: JSON.stringify(toBotUser(user)),
      auth_date: String(Math.floor(now() / 1000)),
    };
    return res.json({ url: target.url, title: target.title, initData: signWebAppData(bot.tokenHash, fields), bot: publicView(bot) });
  });

  // SEC: раньше этот маршрут отдавал запись целиком, вместе с токеном.
  app.get('/api/bots/:username', auth, (req, res) => {
    const db = getDb();
    const name = lower(String(req.params.username || '').replace(/^[@/]+/, ''));
    const hub = db.users.find((u) => u.id === HUB_ID);
    if (hub && name === lower(hub.username)) {
      return res.json({ id: HUB_ID, userId: HUB_ID, username: hub.username, name: 'Hub', createdAt: hub.createdAt || null, commands: HUB_COMMANDS });
    }
    const bot = activeBots(db).find((b) => lower(b.username) === name);
    if (!bot) return res.status(404).json({ message: 'Бот не найден' });
    // Команды и кнопка у поля ввода публичны: их видит любой, кто открыл чат с ботом.
    return res.json({
      ...publicView(bot),
      commands: Array.isArray(bot.commands) ? bot.commands : [],
      menuButton: bot.menuButton && bot.menuButton.url ? { text: bot.menuButton.text } : null,
    });
  });

  // ─── Bot API ───────────────────────────────────────────────────────────────
  const ok = (res, result) => res.json({ ok: true, result });
  const fail = (res, code, description) => res.status(code).json({ ok: false, error_code: code, description });
  const botLimiter = makeRateLimit
    ? makeRateLimit({ windowMs: 60_000, max: 180, key: (req) => 'bot:' + String(req.params?.token || '').split(':')[0].slice(0, 64) })
    : (_req, _res, next) => next();
  const apiError = (res, result) => fail(res, result.status, (result.status === 403 ? 'Forbidden: ' : 'Bad Request: ') + result.error);

  function resolveReply(db, chatId, raw) {
    if (raw === undefined || raw === null || raw === '') return { id: null };
    const id = String(raw);
    const exists = db.messages.some((m) => m.id === id && m.chatId === chatId && !m.isDeleted);
    return exists ? { id } : { error: 'reply_to_message_id: сообщение не найдено в этом чате' };
  }

  async function longPoll(q, take, timeout, res) {
    await new Promise((resolve) => {
      let timer = null;
      const done = () => { clearTimeout(timer); q.waiters.delete(done); resolve(); };
      timer = setTimeout(done, timeout * 1000);
      q.waiters.add(done);
      res.on?.('close', done);
    });
    if (res.writableEnded || res.destroyed) return undefined;
    return ok(res, take());
  }

  async function botApi(req, res) {
    const db = getDb();
    const bot = botByToken(db, req.params.token);
    if (!bot) return fail(res, 401, 'Unauthorized');
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const p = { ...(req.query || {}), ...body };
    const chatId = String(p.chat_id || '');

    switch (req.params.method) {
      case 'getMe':
        return ok(res, { id: bot.userId, is_bot: true, first_name: bot.name, username: bot.username, can_join_groups: false });

      case 'getUpdates': {
        if (bot.webhook && bot.webhook.url) return fail(res, 409, 'Conflict: пока задан вебхук, getUpdates не работает. Вызовите deleteWebhook.');
        const q = queueOf(bot.id);
        const offset = clampInt(p.offset, 0, Number.MAX_SAFE_INTEGER, 0);
        const limit = clampInt(p.limit, 1, 100, 100);
        const timeout = clampInt(p.timeout, 0, LONG_POLL_MAX_S, 0);
        const take = () => {
          // offset подтверждает всё, что меньше него: эти события больше не отдаём.
          if (offset > 0) q.items = q.items.filter((i) => i.update_id >= offset);
          pruneQueue(q);
          return q.items.slice(0, limit).map(publicUpdate);
        };
        const items = take();
        if (items.length || !timeout) return ok(res, items);
        return longPoll(q, take, timeout, res);
      }

      case 'sendMessage': {
        const text = p.text == null ? '' : String(p.text);
        if (!text.trim()) return fail(res, 400, 'Bad Request: пустой text');
        if (text.length > MAX_TEXT) return fail(res, 400, `Bad Request: text длиннее ${MAX_TEXT} символов`);
        const markup = sanitizeReplyMarkup(p.reply_markup);
        if (markup.error) return fail(res, 400, 'Bad Request: ' + markup.error);
        const reply = resolveReply(db, chatId, p.reply_to_message_id);
        if (reply.error) return fail(res, 400, 'Bad Request: ' + reply.error);
        const result = postBotMessage(chatId, bot.userId, { text, replyMarkup: markup.value, replyToId: reply.id });
        if (result.error) return apiError(res, result);
        return ok(res, toBotMessage(getDb(), result.message));
      }

      case 'sendSticker': {
        const meta = resolveSticker(String(p.sticker || ''));
        if (!meta) return fail(res, 400, 'Bad Request: стикер не найден');
        const markup = sanitizeReplyMarkup(p.reply_markup);
        if (markup.error) return fail(res, 400, 'Bad Request: ' + markup.error);
        const result = postBotMessage(chatId, bot.userId, {
          type: 'sticker', attachments: [meta.attachment], sticker: meta.ref, replyMarkup: markup.value,
        });
        if (result.error) return apiError(res, result);
        return ok(res, toBotMessage(getDb(), result.message));
      }

      case 'setWebhook': {
        const url = String(p.url || '');
        if (!url) { bot.webhook = null; saveDb(); return ok(res, true); }
        try { await assertPublicWebhook(url); } catch (e) { return fail(res, 400, 'Bad Request: ' + e.message); }
        const secret = p.secret_token == null ? '' : String(p.secret_token);
        if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) return fail(res, 400, 'Bad Request: secret_token — 1–256 символов A-Z, a-z, 0-9, _ и -');
        bot.webhook = { url, secret, setAt: now(), lastError: null, lastErrorAt: null };
        const q = queueOf(bot.id);
        const pending = q.items.splice(0).map(publicUpdate);
        for (const wake of [...q.waiters]) wake();
        if (!truthy(p.drop_pending_updates)) for (const update of pending) void deliverWebhook(bot.id, update, 0);
        saveDb();
        return ok(res, true);
      }

      case 'deleteWebhook':
        bot.webhook = null;
        if (truthy(p.drop_pending_updates)) queueOf(bot.id).items = [];
        saveDb();
        return ok(res, true);

      case 'getWebhookInfo': {
        const hook = bot.webhook || {};
        return ok(res, {
          url: hook.url || '',
          has_custom_certificate: false,
          pending_update_count: queueOf(bot.id).items.length,
          ...(hook.lastErrorAt ? { last_error_date: Math.floor(hook.lastErrorAt / 1000), last_error_message: hook.lastError } : {}),
        });
      }

      case 'answerCallbackQuery':
        return ok(res, true);

      case 'setMyCommands': {
        const commands = sanitizeCommands(p.commands);
        if (commands.error) return fail(res, 400, 'Bad Request: ' + commands.error);
        bot.commands = commands.value;
        saveDb();
        return ok(res, true);
      }

      case 'getMyCommands':
        return ok(res, Array.isArray(bot.commands) ? bot.commands : []);

      case 'deleteMyCommands':
        bot.commands = [];
        saveDb();
        return ok(res, true);

      case 'setChatMenuButton': {
        let mb = p.menu_button;
        if (typeof mb === 'string') { try { mb = JSON.parse(mb); } catch { return fail(res, 400, 'Bad Request: menu_button — некорректный JSON'); } }
        if (!mb || mb.type === 'default' || mb.type === 'commands') { bot.menuButton = null; saveDb(); return ok(res, true); }
        if (mb.type !== 'web_app') return fail(res, 400, 'Bad Request: menu_button.type — web_app, commands или default');
        const n = cleanName(mb.text);
        if (n.error || n.name.length > 64) return fail(res, 400, 'Bad Request: menu_button.text — от 1 до 64 символов');
        const url = cleanAppUrl(mb.web_app && mb.web_app.url);
        if (url.error) return fail(res, 400, 'Bad Request: menu_button.web_app.url — ' + url.error);
        bot.menuButton = { text: n.name, url: url.url };
        saveDb();
        return ok(res, true);
      }

      case 'getChatMenuButton':
        return ok(res, bot.menuButton
          ? { type: 'web_app', text: bot.menuButton.text, web_app: { url: bot.menuButton.url } }
          : { type: 'default' });

      default:
        return fail(res, 404, 'Not Found: такого метода нет');
    }
  }

  // Путь /bot<token>/<method>, как у Telegram. Параметр сразу после литерала
  // «bot» Express не разбирает, поэтому путь ловим регуляркой.
  app.all(/^\/bot([^/]{1,200})\/([A-Za-z]{1,40})$/, (req, _res, next) => {
    req.params = { token: req.params[0], method: req.params[1] };
    next();
  }, botLimiter, (req, res) => botApi(req, res).catch((e) => {
    console.error('[bot-api]', (e && e.message) || e);
    if (!res.headersSent) fail(res, 500, 'Internal Server Error');
  }));

  return {
    onMessage,
    handleHub,
    postBotMessage,
    isBotUserId: (userId) => isBotUserId(getDb(), userId),
    ensureHub: () => ensureHub(getDb()),
    _queues: queues,
  };
}

module.exports = {
  registerBots,
  sanitizeReplyMarkup,
  sanitizeCommands,
  HUB_COMMANDS,
  APP_LINK_RE,
  cleanBotUsername,
  signWebAppData,
  checkWebAppData,
  hashToken,
  HUB_ID,
  HUB_USERNAME,
  STICKERS_APP_URL,
  BOT_USERNAME_RE,
};
