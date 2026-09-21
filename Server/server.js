/**
 * Vera Messenger Server
 * Express + Socket.io + JSON database (no native modules required)
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

// SEC: подгружаем Server/.env локально, чтобы не таскать секреты в PowerShell.
// В проде (Render) переменные приходят из панели — dotenv их не перезаписывает.
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch {}

// ─── resolve modules from Server/node_modules (fallback to root workspaces) ───
const rootModules = path.join(__dirname, 'node_modules');

function tryResolve(name) {
  try { return require.resolve(name, { paths: [path.join(__dirname)] }); } catch {}
  try { return require.resolve(name, { paths: [path.join(__dirname, '..')] }); } catch {}
  return name;
}
process.env.NODE_PATH = rootModules + path.delimiter + path.join(__dirname, '..', 'node_modules');
require('module').Module._initPaths();

const express = require(tryResolve('express'));
const cors = require(tryResolve('cors'));
const { Server: IOServer } = require(tryResolve('socket.io'));
const jwt = require(tryResolve('jsonwebtoken'));
const bcrypt = require(tryResolve('bcrypt'));
const multer = require(tryResolve('multer'));
const { v4: uuidv4 } = require(tryResolve('uuid'));
const cookieParser = require(tryResolve('cookie-parser'));
const crypto = require('crypto');
const moderation = require('./moderation');

// ─── paths ────────────────────────────────────────────────────────────────────
// В проде (Fly/Render) монтируем persistent-volume, путь передаём через env.
// Локально по умолчанию — ./Server/data и ./Server/uploads.
const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const DB_FILE     = process.env.DB_FILE     || path.join(DATA_DIR, 'vera.json');
const OLLAMA_URL = String(process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || 'llama3.2').trim();
const LLM_SYSTEM_PROMPT = 'Ты локальный русскоязычный ассистент Vera для администратора. Всегда отвечай на русском языке, если пользователь явно не попросил другой язык. Пиши содержательно и не возвращай пустой ответ. Не причиняй вред людям, системам или данным; не помогай с опасными или незаконными действиями. Защищай приватность, не запрашивай и не раскрывай секреты. Будь честен о неопределённости и опирайся на проверяемые знания. Если запрос опасен, откажись и предложи безопасную альтернативу.';
// SEC: JWT_SECRET обязателен в проде. В деве генерируем эфемерный (токены не переживут рестарт).
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (IS_PROD) {
    console.error('[FATAL] JWT_SECRET is missing or too short (<32 chars). Set env var JWT_SECRET.');
    process.exit(1);
  }
  const rnd = require('crypto').randomBytes(48).toString('hex');
  console.warn('[SEC] JWT_SECRET не задан — использую эфемерный dev-ключ. Все токены сбросятся при рестарте.');
  return rnd;
})();
// SEC: whitelist origin через env CORS_ORIGIN (CSV). Публичный URL (Render/PUBLIC_URL) добавляется автоматически.
const CORS_ALLOWED = String(process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const _pub = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
if (_pub) CORS_ALLOWED.push(_pub.replace(/\/+$/, ''));
function corsOriginFn(origin, cb) {
  // Same-origin / curl / server-to-server (нет Origin) — пропускаем.
  if (!origin) return cb(null, true);
  if (CORS_ALLOWED.length === 0) return cb(null, !IS_PROD); // в деве разрешаем всё, в проде запрещаем
  if (CORS_ALLOWED.includes(origin)) return cb(null, true);
  return cb(null, false);
}

for (const d of [DATA_DIR, UPLOADS_DIR,
  path.join(UPLOADS_DIR, 'music'),
  path.join(UPLOADS_DIR, 'avatars'),
  path.join(UPLOADS_DIR, 'files')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ─── JSON Database ────────────────────────────────────────────────────────────
let db = { users: [], chats: [], messages: [], tracks: [], chatMembers: [], playlists: [], favorites: [], devices: [], linkInvites: [], callLogs: [], bots: [], aiModels: [], aiSessions: [], walletOrders: [], refreshTokens: [], ipBans: [], moderationBans: [], moderationWarnings: [], deletedMessages: [], reports: [], moderationIps: {} };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
}
if (!Array.isArray(db.refreshTokens)) db.refreshTokens = [];
if (!Array.isArray(db.ipBans)) db.ipBans = [];
if (!Array.isArray(db.moderationBans)) db.moderationBans = [];
if (!Array.isArray(db.moderationWarnings)) db.moderationWarnings = [];
if (!Array.isArray(db.deletedMessages)) db.deletedMessages = [];
if (!Array.isArray(db.reports)) db.reports = [];
if (!db.moderationIps || typeof db.moderationIps !== 'object' || Array.isArray(db.moderationIps)) db.moderationIps = {};
if (!Array.isArray(db.customItems)) db.customItems = [];
if (!db.creatorProfiles || typeof db.creatorProfiles !== 'object') db.creatorProfiles = {};
if (typeof db.platformRevenueVp !== 'number') db.platformRevenueVp = 0;
if (!Array.isArray(db.admins)) db.admins = [];
if (!db.userStores || typeof db.userStores !== 'object') db.userStores = {};
if (!Array.isArray(db.marketListings)) db.marketListings = [];
if (Number(db.marketplaceMigrationVersion || 0) < 1) {
  // The previous local test marketplace created zero-price listings and free
  // case counters. Preserve opened packs and owned cosmetics, but remove the
  // test-only inventory/listing state before the real marketplace is enabled.
  for (const userStores of Object.values(db.userStores)) {
    const loot = userStores?.loot?.data;
    if (loot && typeof loot === 'object') {
      loot.cases = 0;
      loot.caseCounts = {};
    }
    const shop = userStores?.shop?.data;
    if (shop && typeof shop === 'object' && Array.isArray(shop.marketListings)) {
      for (const listing of shop.marketListings) {
        if (listing?.itemId && shop.owned && shop.owned[listing.itemId] === false) {
          shop.owned[listing.itemId] = true;
        }
      }
      shop.marketListings = [];
    }
  }
  db.marketListings = [];
  db.marketplaceMigrationVersion = 1;
  saveDb();
}

// При старте сервера все пользователи офлайн (сбрасываем stale-статус)
if (db.users) {
  db.users.forEach(u => { u.isOnline = false; });
}

function saveDb() {
  const temporary = DB_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(db, null, 2));
  fs.renameSync(temporary, DB_FILE);
}

function reloadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!db.users) db.users = [];
      if (!db.chats) db.chats = [];
      if (!db.messages) db.messages = [];
      if (!db.tracks) db.tracks = [];
      if (!db.chatMembers) db.chatMembers = [];
      if (!db.playlists) db.playlists = [];
      if (!db.favorites) db.favorites = [];
      if (!db.devices) db.devices = [];
      if (!db.linkInvites) db.linkInvites = [];
      if (!db.callLogs) db.callLogs = [];
      if (!db.bots) db.bots = [];
      if (!db.aiModels) db.aiModels = [];
      if (!db.aiSessions) db.aiSessions = [];
      if (!Array.isArray(db.ipBans)) db.ipBans = [];
      if (!Array.isArray(db.moderationBans)) db.moderationBans = [];
      if (!Array.isArray(db.moderationWarnings)) db.moderationWarnings = [];
      if (!Array.isArray(db.deletedMessages)) db.deletedMessages = [];
      if (!Array.isArray(db.reports)) db.reports = [];
      if (!db.moderationIps || typeof db.moderationIps !== 'object' || Array.isArray(db.moderationIps)) db.moderationIps = {};
      normalizeAllUsers();
      console.log('[DB] Reloaded from disk. Users:', db.users.length, 'Tracks:', db.tracks.length);
    } catch (e) { console.error('[DB] Reload failed:', e.message); }
  }
}

// ─── verification codes (in-memory) ──────────────────────────────────────────
const verificationCodes = new Map(); // identifier/phone/email -> { code, expiresAt }

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function safeLower(value) {
  return String(value || '').toLowerCase();
}

function normalizeUserRecord(user) {
  if (!user) return user;
  if (user.email === undefined) user.email = null;
  if (user.phone === undefined) user.phone = null;
  if (!user.username) user.username = 'user_' + String(user.id || Date.now()).slice(0, 8);
  if (user.firstName === undefined) user.firstName = null;
  if (user.lastName === undefined) user.lastName = null;
  if (user.avatarUrl === undefined) user.avatarUrl = null;
  if (user.bio === undefined) user.bio = null;
  return user;
}

// ─── DEV-режим по IP ─────────────────────────────────────────────────────────
// DEV_IPS: CSV список IP (v4/v6). Пользователь, зашедший с любого из них,
// получает в ответах auth флаг isDev:true. Клиент по нему открывает весь
// магазин и оверлей-инспектор (Ctrl+ПКМ).
const DEV_IPS = String(process.env.DEV_IPS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
function clientIp(req) {
  let ip = String(req.ip || '');
  // IPv4-mapped IPv6: ::ffff:1.2.3.4 → 1.2.3.4
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return net.isIP(ip) ? ip : '';
}
function requestIp(req) {
  return normalizeIp(clientIp(req)) || normalizeIp(req.socket?.remoteAddress) || '';
}
function recordModerationIp(userId, ip) {
  const normalized = normalizeIp(ip);
  if (!userId || !normalized) return false;
  db.moderationIps ||= {};
  const ips = db.moderationIps[userId] ||= [];
  if (ips.includes(normalized)) return false;
  ips.push(normalized);
  if (ips.length > 20) ips.splice(0, ips.length - 20);
  return true;
}
function isIpBanned(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const now = Date.now();
  const active = (db.ipBans || []).filter(ban => !ban.expiresAt || Number(ban.expiresAt) > now);
  if (active.length !== (db.ipBans || []).length) {
    db.ipBans = active;
    saveDb();
  }
  return active.some((ban) => normalizeIp(ban.ip) === normalized);
}

function isDevIp(req) {
  if (!DEV_IPS.length) return false;
  const ip = clientIp(req);
  return DEV_IPS.includes(ip);
}
function withDevFlag(req, user) {
  // Админы (ADMIN_USERNAMES / db.admins) получают полный dev-режим на клиенте:
  // весь магазин открыт и бесплатен, оверлей-инспектор включён.
  const admin = isAdminUsername(user?.username);
  const dev = isDevIp(req) || admin;
  return { ...user, isDev: dev, isAdmin: dev };
}

// ─── Админы по username ──────────────────────────────────────────────────────
// Источники: ENV ADMIN_USERNAMES (CSV, задаётся в панели Render) + db.admins
// (редактируется через консоль сервера командой `admin add/del`). Регистр
// не важен, символ '@' в начале игнорируется.
const ADMIN_ENV = (() => {
  const raw = String(process.env.ADMIN_USERNAMES || 'Vera_koto_a,Vera_koto_b');
  return raw.split(',').map(s => s.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean);
})();
function normAdminName(v) { return String(v || '').trim().replace(/^@+/, '').toLowerCase(); }
function isAdminUsername(username) {
  const n = normAdminName(username);
  if (!n) return false;
  if (ADMIN_ENV.includes(n)) return true;
  return (db.admins || []).map(normAdminName).includes(n);
}
function isAdminUser(req, user) {
  if (isDevIp(req)) return true;
  return isAdminUsername(user?.username);
}

function normalizeAllUsers() {
  if (!Array.isArray(db.users)) db.users = [];
  db.users.forEach(normalizeUserRecord);
}

normalizeAllUsers();

/* ─── Device management (правило «устройство 1 = 1, второе — через QR») ─────────
 * Каждый вход выполняется с конкретного устройства (deviceId). Правила:
 *  - новый пользователь автоматически получает «основное устройство» (primary);
 *  - второе устройство добавляется ТОЛЬКО через привязку по QR-коду/ссылке;
 *  - больше 2 устройств на один аккаунт нельзя.
 */
const MAX_DEVICES_PER_ACCOUNT = 100;
const LINK_INVITE_TTL_MS = 5 * 60 * 1000; // 5 минут

function normalizeDeviceId(raw) {
  const s = String(raw || '').trim();
  // Сохраняем читаемые символы: юзер-агент в перекодированном виде — ок.
  return s.slice(0, 160) || ('device-' + uuidv4());
}

// Public device IDs are labels, never credentials. The installation secret
// survives logout and is sent only in an HttpOnly cookie.
function moderationBanActive(ban) {
  return !!ban && (!ban.expiresAt || Number(ban.expiresAt) > Date.now());
}

// Kept local instead of calling the moderation module from this bootstrap
// section: device-link.test.js evaluates this section in isolation.
function moderationBlocked(db, userId, deviceId, hash) {
  return (db.moderationBans || []).some(ban => moderationBanActive(ban) && (
    (ban.kind === 'account' && ban.userId === userId) ||
    (ban.kind === 'device' && ((deviceId && ban.deviceId === deviceId) || (hash && ban.hash === hash)))
  ));
}

function resolveInstallation(req, res, allowRevoked = false) {
  const secret = req.cookies?.vera_installation;
  if (typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret)) {
    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    const device = (db.devices || []).find(d => d.installationHash === hash);
    if (moderationBlocked(db, device?.userId, device?.deviceId, hash)) {
      res.status(403).json({ message: 'Доступ заблокирован', code: 'ACCOUNT_BANNED' }); return null;
    }
    if (device) {
      if (device.revoked && !allowRevoked) { res.status(403).json({ message: 'Устройство отвязано. Создайте новую ссылку привязки на основном устройстве.' }); return null; }
      return { deviceId: device.deviceId, hash };
    }
  }
  const rawId = req.body?.deviceId;
  if (typeof rawId !== 'string' || !rawId.trim() || rawId.length > 160) {
    res.status(400).json({ message: 'Некорректный идентификатор устройства' }); return null;
  }
  const deviceId = normalizeDeviceId(rawId);
  if (moderationBlocked(db, null, deviceId)) { res.status(403).json({ message: 'Устройство заблокировано' }); return null; }
  const existing = (db.devices || []).find(d => d.deviceId === deviceId);
  if (existing) {
    let identity;
    try { identity = verifyAccessToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); } catch {}
    if (existing.installationHash || existing.revoked || identity?.deviceId !== deviceId || identity?.userId !== existing.userId) {
      res.status(403).json({ message: 'Не удалось подтвердить устройство. Используйте сохранённую сессию или новое приглашение.' }); return null;
    }
  }
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  res.cookie('vera_installation', raw, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', path: '/', maxAge: 400 * 24 * 60 * 60 * 1000 });
  return { deviceId, hash };
}

function getDeviceForUser(userId, deviceId) {
  if (!deviceId) return null;
  return (db.devices || []).find(d => d.userId === userId && d.deviceId === deviceId);
}

function countUserDevices(userId) {
  return (db.devices || []).filter(d => d.userId === userId && !d.revoked).length;
}

// Регистрирует устройство входа. Возвращает { ok, device, message }
// Правило: 1 аккаунт = 1 устройство. Новое (не первое) устройство разрешено
// ТОЛЬКО если оно уже привязано через QR/ссылку (acceptLinkInviteOnServer
// заранее добавляет его в db.devices).
function registerDevice(userId, deviceId, deviceName) {
  const cleanId = normalizeDeviceId(deviceId);
  const existing = getDeviceForUser(userId, cleanId);
  if (existing) {
    existing.lastSeenAt = Date.now();
    existing.name = (deviceName || existing.name || 'Моё устройство').slice(0, 80);
    return { ok: true, device: existing };
  }
  // Это новое устройство для аккаунта.
  const otherUserDevice = (db.devices || []).find(d => d.deviceId === cleanId && d.userId !== userId);
  if (otherUserDevice) {
    return { ok: false, message: 'Это устройство уже привязано к другому аккаунту.' };
  }
  const count = countUserDevices(userId);
  // Первое устройство — основное, разрешаем всегда (создание аккаунта).
  if (count === 0) {
    const device = {
      id: uuidv4(),
      userId,
      deviceId: cleanId,
      name: (deviceName || 'Моё устройство').slice(0, 80),
      isPrimary: true,
      linkedViaQr: false,
      createdAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
    };
    (db.devices || (db.devices = [])).push(device);
    saveDb();
    return { ok: true, device };
  }
  // Не первое устройство и не привязано — доступ запрещён.
  return {
    ok: false,
    message: 'Это устройство не привязано к аккаунту. Добавьте его через QR-код/ссылку со своего основного устройства (раздел «Устройства»).',
  };
}

// Привязка по QR-коду разрешает добавить устройство «не-первым».
function acceptLinkInviteOnServer(invite, newDeviceId, newDeviceName) {
  if (!invite) return { ok: false, message: 'Приглашение не найдено' };
  if (Date.now() > invite.expiresAt) return { ok: false, message: 'QR-код/ссылка истекли. Обновите страницу и попробуйте ещё раз.' };
  const cleanId = normalizeDeviceId(newDeviceId);
  const ownerId = invite.userId;

  const sameDevice = getDeviceForUser(ownerId, cleanId);
  if (sameDevice && !sameDevice.revoked) return { ok: false, message: 'Это устройство уже входит в этот аккаунт. Откройте ссылку на новом устройстве.' };

  const other = (db.devices || []).find(d => d.deviceId === cleanId && d.userId !== ownerId);
  if (other) return { ok: false, message: 'Это устройство уже привязано к другому аккаунту.' };
  const count = countUserDevices(ownerId);
  if (count >= MAX_DEVICES_PER_ACCOUNT) {
    return { ok: false, message: `Достигнут лимит устройств (${MAX_DEVICES_PER_ACCOUNT}).` };
  }

  const device = {
    id: uuidv4(),
    userId: ownerId,
    tokenVersion: Number(sameDevice?.tokenVersion || 0) + 1,
    deviceId: cleanId,
    name: (newDeviceName || 'Второе устройство').slice(0, 80),
    isPrimary: count === 0,
    linkedViaQr: true,
    createdAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
  };
  db.devices = db.devices.filter(d => !(d.deviceId === cleanId && d.revoked));
  (db.devices || (db.devices = [])).push(device);
  // Инвайт одноразовый
  db.linkInvites = (db.linkInvites || []).filter(i => i.id !== invite.id);
  saveDb();
  return { ok: true, device };
}

function createSavedMessagesChat(userId) {
  const savedChat = {
    id: uuidv4(),
    type: 'saved',
    name: 'Избранное',
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    pinnedMessageId: null,
  };
  db.chats.push(savedChat);
  db.chatMembers.push({ id: uuidv4(), chatId: savedChat.id, userId, role: 'owner', joinedAt: new Date().toISOString() });
}

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
// SEC: скрываем сигнатуру фреймворка (fingerprinting сервера).
app.disable('x-powered-by');
// SEC: helmet — базовые security-заголовки. CSP отключаем на уровне модуля,
// т.к. для /uploads уже поставлен кастомный `Content-Security-Policy: sandbox`.
try {
  const helmet = require(tryResolve('helmet'));
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // /uploads отдаём на web-origin
    crossOriginEmbedderPolicy: false,
  }));
} catch (e) {
  console.warn('[SEC] helmet не установлен — пропускаю security-заголовки. Запустите: npm i helmet (в Server/).');
}
// SEC: за прокси Render/Fly — доверяем ровно одному хопу, чтобы req.ip был реальным (для rate-limit).
// Only trust explicitly configured proxy addresses/subnets, never arbitrary XFF.
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',').map(s => s.trim()).filter(Boolean) : false);
const server = http.createServer(app);
// SEC/DoS: не держим соединения бесконечно и не позволяем slowloris-запросам
// занимать worker. Более строгие лимиты для тяжёлых маршрутов задаются ниже.
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 15000);
server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 5000);
server.maxRequestsPerSocket = Number(process.env.HTTP_MAX_REQUESTS_PER_SOCKET || 100);

app.use(cors({ origin: corsOriginFn, credentials: true }));
app.use(cookieParser());
// PERF: gzip-сжатие всех ответов. Особенно ускоряет JSON API (список сообщений,
// синхронизация store), а также раздачу собранного клиента через тот же порт.
try {
  const compression = require(tryResolve('compression'));
  app.use(compression({
    threshold: 1024,
    // Не жмём то, что уже сжато (jpeg/png/webp/mp3/mp4/webm/ogg — /uploads).
    filter: (req, res) => {
      const type = String(res.getHeader('Content-Type') || '');
      if (/^(image|audio|video)\//.test(type)) return false;
      return compression.filter(req, res);
    },
  }));
} catch {
  console.warn('[PERF] compression не установлен — npm i compression (в Server/).');
}
// SEC: лимит тела. Не '1mb', потому что голосовые/файлы отправляются как base64
// через /api/messages/:chatId/send (data URL). 30mb покрывает длинные ГС и фото.
// Reject floods before allocating/parsing request bodies (including GET floods).
app.use(makeRateLimit({ windowMs: 60_000, max: 600 }));
// Fail closed: synchronous ZIP extraction and external downloaders are not
// safe public workloads. Enable only after isolating them in a bounded worker.
app.use(['/api/music/import-zip', '/api/music/import-url'], (_req, res) => {
  res.status(503).json({ message: 'Импорт временно отключён для защиты сервера' });
});

// SEC/DoS: Content-Length проверяется до выполнения тяжёлых обработчиков.
// Chunked-запросы дополнительно ограничиваются parser'ом выше.
app.use((req, res, next) => {
  const length = Number(req.headers['content-length']);
  if (!req.is('multipart/form-data') && Number.isFinite(length) && length > 30 * 1024 * 1024) {
    return res.status(413).json({ message: 'Тело запроса слишком большое' });
  }
  next();
});
app.use(express.json({ limit: '30mb', inflate: false, verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100, inflate: false }));

// SEC: базовые security headers (без внешней зависимости).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=(self)');
  // Кэш API-ответов не хотим — токены/данные пользователей.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// SEC: IP-баны проверяются до rate-limit и всех API-маршрутов, включая вход.
app.use((req, res, next) => {
  const ip = requestIp(req);
  if (ip && isIpBanned(ip)) {
    return res.status(403).json({ message: 'Доступ с этого IP запрещён', code: 'IP_BANNED' });
  }
  next();
});

// SEC: примитивный in-memory rate-limit (без внешних зависимостей).
// В проде на нескольких инстансах — заменить на Redis/express-rate-limit.
function makeRateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, Math.max(windowMs, 60_000)).unref?.();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let rec = hits.get(k);
    // Bound limiter memory even during a distributed flood; never evict live
    // counters (eviction would allow an attacker to reset their own quota).
    if (!rec && hits.size >= 10000) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(503).json({ message: 'Сервер перегружен, попробуйте позже' });
    }
    if (!rec || rec.reset < now) rec = { count: 0, reset: now + windowMs };
    rec.count++;
    hits.set(k, rec);
    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((rec.reset - now) / 1000));
      return res.status(429).json({ message: 'Слишком много запросов, попробуйте позже' });
    }
    next();
  };
}
const authLimiter = makeRateLimit({ windowMs: 60_000, max: 20 }); // 20 auth-запросов/мин с IP
const searchLimiter = makeRateLimit({ windowMs: 60_000, max: 60 });
// SEC: лимиты на аутентифицированные действия. Ключ — userId, а не IP,
// иначе один злой юзер за NAT заблокирует всех остальных.
const byUserKey = (req) => {
  // authMiddleware ещё не отработал на app.use-уровне, поэтому декодируем JWT best-effort.
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const p = jwt.verify(auth.slice(7), JWT_SECRET);
      return 'u:' + p.sub;
    }
  } catch {}
  return 'ip:' + req.ip;
};
const messageLimiter = makeRateLimit({ windowMs: 60_000, max: 120, key: byUserKey }); // 120 сообщений/мин
const uploadLimiter  = makeRateLimit({ windowMs: 60_000, max: 30,  key: byUserKey }); // 30 загрузок/мин
const writeLimiter   = makeRateLimit({ windowMs: 60_000, max: 300, key: byUserKey }); // 300 mutating-запросов/мин
app.use(['/api/auth/device', '/api/auth/verify', '/api/auth/send-code', '/api/auth/verify-code', '/api/auth/logout', '/api/auth/refresh'], authLimiter);
app.use('/api/users/search', searchLimiter);
app.use(['/api/messages'], messageLimiter);
app.use(['/api/files', '/api/users/avatar', '/api/users/me/avatar', '/api/music', '/api/ai/models'], uploadLimiter);
// ZIP/yt-dlp требуют много RAM, CPU, диска и сетевого трафика.
// Общий лимитер на все mutating API (fallback).
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.path.startsWith('/api/')) return next();
  return writeLimiter(req, res, next);
});

// SEC: /uploads раздаём как attachment + nosniff, чтобы залитый .html/.svg не исполнялся в нашем домене.
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '30d',
  immutable: true,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // PERF: файлы в /uploads именуются с уникальным хэшем/timestamp и не
    // меняются — кэшируем агрессивно на 30 дней. Это резко сокращает объём
    // трафика (аватарки/фото при повторных заходах не тянутся заново).
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    const lower = filePath.toLowerCase();
    const inlineOk = /\.(png|jpe?g|gif|webp|svg|mp3|ogg|wav|m4a|mp4|webm|mov)$/i.test(lower);
    if (!inlineOk) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
    if (lower.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  },
}));

// ─── Загрузка установщиков десктоп-приложения ────────────────────────────────
// Файлы кладём в Server/public/downloads/. Клиент читает /api/downloads,
// а бинарники раздаются по /downloads/<file>.
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');
try { fs.mkdirSync(DOWNLOADS_DIR, { recursive: true }); } catch {}
app.use('/downloads', express.static(DOWNLOADS_DIR, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // SEC: экранируем кавычки/CR/LF в имени, чтобы не разорвать заголовок.
    const safe = path.basename(filePath).replace(/[\r\n"\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// GET /api/downloads — список доступных установщиков с авто-детектом платформы.
// Поддерживает два источника:
//   1) downloads.json в DOWNLOADS_DIR — массив { platform, filename, size, url }.
//      Позволяет указывать внешние URL (например, GitHub Releases для файлов >100 МБ).
//   2) Иначе — сканирует файлы в DOWNLOADS_DIR (для маленьких установщиков в git).
app.get('/api/downloads', (req, res) => {
  // 1) manifest downloads.json
  const manifestPath = path.join(DOWNLOADS_DIR, 'downloads.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.files) ? raw.files : []);
      const files = arr.map((f) => ({
        platform: f.platform || 'other',
        filename: f.filename || f.name || 'download',
        size: Number(f.size) || 0,
        url: f.url,
      })).filter((f) => !!f.url);
      return res.json({ files });
    } catch (e) {
      console.warn('[downloads] bad downloads.json:', e.message);
    }
  }

  // 2) сканирование папки
  let entries = [];
  try { entries = fs.readdirSync(DOWNLOADS_DIR); } catch { entries = []; }
  const files = entries
    .filter((name) => {
      if (name.startsWith('.')) return false;
      if (/^readme($|\.)/i.test(name)) return false;
      // Служебные файлы (манифесты, шаблоны, документация) — не установщики.
      if (/\.(json|txt|md)$/i.test(name)) return false;
      return true;
    })
    .map((name) => {
      const full = path.join(DOWNLOADS_DIR, name);
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      const lower = name.toLowerCase();
      let platform = 'other';
      if (/\.(exe|msi)$/.test(lower)) platform = 'win';
      else if (/\.(dmg|pkg)$/.test(lower)) platform = 'mac';
      else if (/\.(appimage|deb|rpm|snap|tar\.gz|tgz)$/.test(lower)) platform = 'linux';
      return {
        platform,
        filename: name,
        size,
        url: `/downloads/${encodeURIComponent(name)}`,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
  res.json({ files });
});

// Serve built React app (Web/dist) — только статика, SPA fallback добавляется в конце
const CLIENT_DIST = path.join(__dirname, '..', 'Web', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
// SEC: JWT содержит { sub, deviceId, tv }. Проверяем:
//   1) подпись/срок;
//   2) устройство до сих пор привязано (удалённое = мгновенный logout);
//   3) tokenVersion пользователя совпадает (глобальный "revoke-all-sessions").
function verifyAccessToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  const user = db.users.find(u => u.id === payload.sub);
  if (!user) throw new Error('user_gone');
  if (moderation.blocked(db, user.id, payload.deviceId)) throw new Error('ACCOUNT_BANNED');
  const tv = Number(user.tokenVersion || 0);
  if (Number(payload.tv || 0) !== tv) throw new Error('token_revoked');
  if (payload.deviceId) {
    const dev = (db.devices || []).find(d => d.userId === user.id && d.deviceId === payload.deviceId);
    if (!dev || dev.revoked) throw new Error('device_revoked');
    if (Number(payload.dv || 0) !== Number(dev.tokenVersion || 0)) throw new Error('device_session_revoked');
  }
  return { userId: user.id, deviceId: payload.deviceId || null };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const { userId, deviceId } = verifyAccessToken(auth.slice(7));
    req.userId = userId;
    req.deviceId = deviceId;
    if (recordModerationIp(userId, requestIp(req))) saveDb();
    next();
  } catch (e) {
    res.status(401).json({ message: 'Invalid token', reason: e.message });
  }
}

// Единая точка выпуска access-токена — все /auth/* роуты используют её.
// SEC: expiresIn=15m. Клиент рефрешит через /auth/refresh (HttpOnly cookie).
// Существующие 30d-токены остаются валидны до истечения — обратной совместимости не ломаем.
function issueAccessToken(user, deviceId) {
  if (typeof user.tokenVersion !== 'number') user.tokenVersion = 0;
  return jwt.sign(
    { sub: user.id, deviceId: deviceId || null, tv: user.tokenVersion, dv: Number(getDeviceForUser(user.id, deviceId)?.tokenVersion || 0) },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
}

// ─── Refresh tokens (ротация + reuse-detection) ──────────────────────────────
// Схема:
//   - Refresh-токен = случайные 32 байта (не JWT), хранится захэшированным.
//   - На каждое /auth/refresh старый токен помечается used=true и выдаётся новый
//     из той же «семьи» (familyId). Если пришёл уже used-токен → reuse-attack:
//     инвалидируем всю семью и инкрементим tokenVersion (все сессии revoke).
//   - Refresh хранится 30 дней. Cookie: HttpOnly, Secure (в prod), SameSite=Strict.
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE = 'vera_refresh';
const CSRF_COOKIE    = 'vera_csrf';

function hashRefresh(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function issueRefreshToken(user, deviceId, familyId = null) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const rec = {
    id: uuidv4(),
    familyId: familyId || uuidv4(),
    userId: user.id,
    deviceId: deviceId || null,
    tokenHash: hashRefresh(raw),
    createdAt: Date.now(),
    expiresAt: Date.now() + REFRESH_TTL_MS,
    usedAt: null,
    revokedAt: null,
  };
  db.refreshTokens.push(rec);
  // Уборка мусора: старше TTL или использованных давно.
  const cutoff = Date.now() - REFRESH_TTL_MS;
  db.refreshTokens = db.refreshTokens.filter(t => t.expiresAt > cutoff);
  return { raw, rec };
}

function findRefreshByRaw(raw) {
  const h = hashRefresh(raw);
  return db.refreshTokens.find(t => t.tokenHash === h);
}

function revokeFamily(familyId, reason = 'revoked') {
  const now = Date.now();
  for (const t of db.refreshTokens) {
    if (t.familyId === familyId && !t.revokedAt) {
      t.revokedAt = now;
      t.revokeReason = reason;
    }
  }
}

function setAuthCookies(res, refreshRaw) {
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const common = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_TTL_MS,
  };
  res.cookie(REFRESH_COOKIE, refreshRaw, common);
  // CSRF-cookie не HttpOnly: JS должен прочитать и положить в X-CSRF-Token.
  res.cookie(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false });
  return csrfToken;
}

function clearAuthCookies(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE,    { path: '/' });
}

// SEC: double-submit CSRF — cookie должен совпасть с заголовком.
// Применяется к cookie-зависимым endpoint'ам (refresh, logout при cookie-auth).
function csrfCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const cookieTok = req.cookies?.[CSRF_COOKIE];
  const headerTok = req.headers['x-csrf-token'];
  if (!cookieTok || !headerTok || cookieTok !== headerTok) {
    return res.status(403).json({ message: 'CSRF token missing or mismatched' });
  }
  next();
}

// POST /api/auth/refresh — ротация. Cookie in, cookie out. Возвращает новый accessToken.
app.post('/api/auth/refresh', csrfCheck, (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) return res.status(401).json({ message: 'No refresh cookie', reason: 'no_refresh' });
  const rec = findRefreshByRaw(raw);
  if (!rec) {
    clearAuthCookies(res);
    return res.status(401).json({ message: 'Invalid refresh', reason: 'invalid_refresh' });
  }
  if (rec.expiresAt < Date.now() || rec.revokedAt) {
    clearAuthCookies(res);
    return res.status(401).json({ message: 'Refresh expired/revoked', reason: 'expired' });
  }
  if (rec.usedAt) {
    // SEC: reuse-attack — токен уже был использован. Инвалидируем всю семью
    // и глобально инкрементим tokenVersion юзера.
    revokeFamily(rec.familyId, 'reuse');
    const user = db.users.find(u => u.id === rec.userId);
    if (user) user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    saveDb();
    clearAuthCookies(res);
    return res.status(401).json({ message: 'Refresh reuse detected', reason: 'reuse' });
  }
  const user = db.users.find(u => u.id === rec.userId);
  if (moderation.blocked(db, rec.userId, rec.deviceId)) return res.status(403).json({ message: 'Доступ заблокирован', code: 'ACCOUNT_BANNED' });
  if (!user) {
    clearAuthCookies(res);
    return res.status(401).json({ message: 'User not found', reason: 'user_gone' });
  }
  // Устройство должно оставаться привязанным.
  if (rec.deviceId) {
    const dev = (db.devices || []).find(d => d.userId === user.id && d.deviceId === rec.deviceId);
    if (!dev || dev.revoked) {
      revokeFamily(rec.familyId, 'device_revoked');
      saveDb();
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Device revoked', reason: 'device_revoked' });
    }
  }
  // Ротация: помечаем старый, выдаём новый из той же семьи.
  rec.usedAt = Date.now();
  const { raw: newRaw } = issueRefreshToken(user, rec.deviceId, rec.familyId);
  saveDb();
  setAuthCookies(res, newRaw);
  const accessToken = issueAccessToken(user, rec.deviceId);
  res.json({ accessToken, user });
});

// ─── Multer storage ───────────────────────────────────────────────────────────
// SEC: белые списки MIME/расширений. UUID-имя файла, безопасное расширение.
const SAFE_EXT = /^\.[a-z0-9]{1,8}$/i;
function safeExt(name) {
  const e = path.extname(String(name || '')).toLowerCase();
  return SAFE_EXT.test(e) ? e : '';
}
function makeStorage(subfolder) {
  return multer.diskStorage({
    destination: path.join(UPLOADS_DIR, subfolder),
    filename: (req, file, cb) => {
      cb(null, uuidv4() + safeExt(file.originalname));
    },
  });
}
function mimeFilter(allowedPrefixes, allowedExact = []) {
  return (req, file, cb) => {
    const mt = String(file.mimetype || '').toLowerCase();
    // SVG запрещаем — может содержать <script>.
    if (mt === 'image/svg+xml') return cb(new Error('SVG запрещён'));
    const ok = allowedPrefixes.some(p => mt.startsWith(p)) || allowedExact.includes(mt);
    if (!ok) return cb(new Error('Тип файла не разрешён: ' + mt));
    cb(null, true);
  };
}
const uploadMusic   = multer({ storage: makeStorage('music'),   limits: { fileSize: 50 * 1024 * 1024 },  fileFilter: mimeFilter(['audio/']) });
const uploadAvatar  = multer({ storage: makeStorage('avatars'), limits: { fileSize: 5 * 1024 * 1024 },   fileFilter: mimeFilter(['image/'], []) });
const uploadFile    = multer({ storage: makeStorage('files'),   limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: mimeFilter(['image/', 'audio/', 'video/'], [
  'application/pdf',
  'application/zip', 'application/x-zip-compressed',
  'application/x-7z-compressed', 'application/x-rar-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/json',
  'application/octet-stream',
]) });

// SEC: обработчик ошибок Multer — возвращаем понятный 4xx вместо 500 с stack.
function handleUploadError(err, req, res, next) {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой' : (err.message || 'Ошибка загрузки');
  res.status(400).json({ message: msg });
}

// ─── AUTH: аккаунт = устройство (без email/кода) ─────────────────────────────
// POST /api/auth/device — единственный вход/регистрация.
// Клиент шлёт { deviceId, deviceName }. Если устройство привязано к аккаунту
// (сам первый или добавлен по QR через /devices/link/accept) — возвращаем токен.
// Если нет — создаём новый аккаунт и делаем это устройство primary.
app.post('/api/auth/device', (req, res) => {
  const installation = resolveInstallation(req, res);
  if (!installation) return;
  const rawDeviceId = req.body?.deviceId;
  const deviceName = (req.body?.deviceName || '').toString().slice(0, 80) || 'Моё устройство';
  if (!rawDeviceId || typeof rawDeviceId !== 'string') {
    return res.status(400).json({ message: 'deviceId обязателен' });
  }
  const deviceId = installation.deviceId;

  // 1) Устройство уже привязано (первое или добавленное по QR) — вход.
  const existingDevice = (db.devices || []).find(d => d.deviceId === deviceId);
  if (existingDevice) {
    existingDevice.installationHash = installation.hash;
    const user = db.users.find(u => u.id === existingDevice.userId);
    if (!user) return res.status(500).json({ message: 'Аккаунт не найден для устройства' });
    existingDevice.lastSeenAt = Date.now();
    if (deviceName) existingDevice.name = deviceName;
    user.isOnline = true;
    user.lastSeen = new Date().toISOString();
    recordModerationIp(user.id, requestIp(req));
    saveDb();
    const accessToken = issueAccessToken(user, deviceId);
    const { raw: refreshRaw } = issueRefreshToken(user, deviceId);
    saveDb();
    const csrfToken = setAuthCookies(res, refreshRaw);
    return res.json({ accessToken, csrfToken, deviceId, user: withDevFlag(req, user), isNewUser: false });
  }

  // 2) Новое устройство — создаём аккаунт, устройство помечаем primary.
  if (req.body?.createAccount !== true) {
    return res.status(409).json({ message: 'Откройте ссылку привязки или создайте новый аккаунт.', reason: 'unregistered_device' });
  }
  const shortId = deviceId.replace(/[^a-z0-9]/gi, '').slice(-8) || Date.now().toString(36);
  // Гарантируем уникальность username: если base занят — добавляем суффикс.
  const baseName = 'user_' + shortId;
  let uniqueName = baseName;
  let attempt = 0;
  while (db.users.some(u => normalizeIdentifier(u.username) === normalizeIdentifier(uniqueName))) {
    attempt += 1;
    uniqueName = baseName + '_' + attempt;
    if (attempt > 9999) { uniqueName = baseName + '_' + Date.now().toString(36); break; }
  }
  const user = {
    id: uuidv4(),
    email: null,
    phone: null,
    username: uniqueName,
    firstName: null, lastName: null, birthDate: null,
    country: null, region: null, city: null,
    avatarUrl: null, bio: null,
    isOnline: true,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);

  // Приветственный чат «Избранное».
  const savedChat = {
    id: uuidv4(), type: 'saved', name: 'Избранное', avatarUrl: null,
    createdAt: new Date().toISOString(), pinnedMessageId: null,
  };
  db.chats.push(savedChat);
  db.chatMembers.push({
    id: uuidv4(), chatId: savedChat.id, userId: user.id, role: 'owner',
    joinedAt: new Date().toISOString(),
  });

  const dev = registerDevice(user.id, deviceId, deviceName);
  if (dev.ok) dev.device.installationHash = installation.hash;
  if (!dev.ok) {
    // Не должно случаться (счётчик 0), но на всякий случай откатим создание.
    db.users = db.users.filter(u => u.id !== user.id);
    db.chats = db.chats.filter(c => c.id !== savedChat.id);
    db.chatMembers = db.chatMembers.filter(m => m.chatId !== savedChat.id);
    return res.status(500).json({ message: dev.message || 'Не удалось создать устройство' });
  }
  recordModerationIp(user.id, requestIp(req));
  saveDb();
  const accessToken = issueAccessToken(user, deviceId);
  const { raw: refreshRaw } = issueRefreshToken(user, deviceId);
  saveDb();
  const csrfToken = setAuthCookies(res, refreshRaw);
  res.json({ accessToken, csrfToken, deviceId, user: withDevFlag(req, user), isNewUser: true });
});

// ─── Устаревшие маршруты удалены: /auth/request-code, /auth/verify,
// /auth/send-code, /auth/verify-code. Оставлена одна точка /auth/device.
// Ниже следует /auth/logout и /auth/me.
/* removed
  const { mode = 'login', username, website } = req.body || {};
  const identifier = normalizeIdentifier(req.body?.identifier || req.body?.email || req.body?.username);
  const email = normalizeIdentifier(req.body?.email || (identifier.includes('@') ? identifier : ''));

  // Honeypot против простых ботов: поле скрыто в интерфейсе и должно быть пустым.
  if (website) return res.status(400).json({ message: 'Некорректный запрос' });
  if (!identifier) return res.status(400).json({ message: 'Введите почту или юзер' });

  if (mode === 'register') {
    if (!email) return res.status(400).json({ message: 'Введите почту' });
    if (!username || !/^[a-zA-Z0-9_.]{3,32}$/.test(String(username).trim())) {
      return res.status(400).json({ message: 'Юзер должен быть 3-32 символа: латиница, цифры, _, .' });
    }
    const cleanUsername = String(username).trim();
    const exists = db.users.find(u =>
      normalizeIdentifier(u.email) === email || normalizeIdentifier(u.username) === normalizeIdentifier(cleanUsername)
    );
    if (exists) return res.status(409).json({ message: 'Пользователь с такой почтой или юзером уже есть' });
  } else {
    const exists = db.users.find(u =>
      normalizeIdentifier(u.email) === identifier || normalizeIdentifier(u.username) === identifier || normalizeIdentifier(u.phone) === identifier
    );
    if (!exists) return res.status(404).json({ message: 'Пользователь не найден. Зарегистрируйтесь.' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes.set(identifier, {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
    mode,
    email,
    username: username ? String(username).trim() : undefined,
  });

  console.log('\n' + '═'.repeat(50));
  console.log(`📧 КОД VERA ДЛЯ ${identifier}`);
  console.log(`🔢 Код: ${code}`);
  console.log('═'.repeat(50) + '\n');

  // Для локальной разработки возвращаем код, чтобы можно было сразу войти.
  res.json({ success: true, devCode: code });
});

// POST /api/auth/verify — новый клиент: подтверждение кода по email/username
app.post('/api/auth/verify', (req, res) => {
  const identifier = normalizeIdentifier(req.body?.identifier || req.body?.email);
  const { code } = req.body || {};
  const deviceId = req.body?.deviceId;
  const deviceName = req.body?.deviceName;
  const stored = verificationCodes.get(identifier);

  if (!identifier) return res.status(400).json({ message: 'Введите почту или юзер' });
  if (!stored) return res.status(400).json({ message: 'Сначала запросите код' });
  if (Date.now() > stored.expiresAt) {
    verificationCodes.delete(identifier);
    return res.status(400).json({ message: 'Код истёк' });
  }
  if (stored.code !== String(code || '').trim()) return res.status(401).json({ message: 'Неверный код' });

  verificationCodes.delete(identifier);

  let user = db.users.find(u =>
    normalizeIdentifier(u.email) === identifier || normalizeIdentifier(u.username) === identifier || normalizeIdentifier(u.phone) === identifier
  );
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = {
      id: uuidv4(),
      email: stored.email || identifier,
      phone: null,
      username: stored.username || ('user_' + Date.now().toString(36)),
      firstName: null, lastName: null, birthDate: null,
      country: null, region: null, city: null,
      avatarUrl: null, bio: null,
      isOnline: true,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    createSavedMessagesChat(user.id);
  } else {
    user.isOnline = true;
    user.lastSeen = new Date().toISOString();
  }
  saveDb();

  // ── Правило устройств ─────────────────────────────────────────────────────
  // Для нового аккаунта первое устройство = основное (primary). Для повторного
  // входа с того же устройства — ок. Новое устройство без привязки — отказ.
  if (deviceId) {
    const dev = registerDevice(user.id, deviceId, deviceName);
    if (!dev.ok) {
      return res.status(403).json({ message: dev.message, deviceError: true });
    }
  }

  const accessToken = jwt.sign({ sub: user.id, email: user.email, username: user.username, deviceId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ accessToken, user, isNewUser });
});

// POST /api/auth/send-code
app.post('/api/auth/send-code', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: 'Укажите номер телефона' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  verificationCodes.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  
  // Красивый вывод кода в консоль
  console.log('\n' + '═'.repeat(50));
  console.log(`📱 КОД ВЕРИФИКАЦИИ ДЛЯ ${phone}`);
  console.log(`🔢 Код: ${code}`);
  console.log(`⏰ Действителен до: ${expiresAt.toLocaleTimeString('ru-RU')}`);
  console.log('═'.repeat(50) + '\n');
  
  res.json({ success: true, code }); // В реальном приложении code не отдаём, но для теста — ок
});

// POST /api/auth/verify-code
app.post('/api/auth/verify-code', (req, res) => {
  const { phone, code } = req.body;
  const deviceId = req.body?.deviceId;
  const deviceName = req.body?.deviceName;
  const stored = verificationCodes.get(phone);

  if (!stored) return res.status(400).json({ message: 'Сначала запросите код' });
  if (Date.now() > stored.expiresAt) {
    verificationCodes.delete(phone);
    return res.status(400).json({ message: 'Код истёк' });
  }
  if (stored.code !== code) return res.status(401).json({ message: 'Неверный код' });

  verificationCodes.delete(phone);

  let user = db.users.find(u => u.phone === phone);
  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    user = {
      id: uuidv4(),
      phone,
      username: 'user_' + Date.now().toString(36),
      firstName: null, lastName: null, birthDate: null,
      country: null, region: null, city: null,
      avatarUrl: null, bio: null,
      isOnline: true,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);

    // Create "Избранное" (Saved Messages) chat for new user
    const savedChat = {
      id: uuidv4(),
      type: 'saved',
      name: 'Избранное',
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      pinnedMessageId: null,
    };
    db.chats.push(savedChat);
    db.chatMembers.push({ id: uuidv4(), chatId: savedChat.id, userId: user.id, role: 'owner', joinedAt: new Date().toISOString() });
    saveDb();
  } else {
    user.isOnline = true;
  }
  saveDb();

  // ── Правило устройств (см. comment в /api/auth/verify) ────────────────────
  if (deviceId) {
    const dev = registerDevice(user.id, deviceId, deviceName);
    if (!dev.ok) {
      return res.status(403).json({ message: dev.message, deviceError: true });
    }
  }

  const accessToken = jwt.sign({ sub: user.id, phone: user.phone, deviceId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ accessToken, user, isNewUser });
});
*/

// POST /api/auth/logout
// SEC: инкрементим tokenVersion → все выданные JWT этому юзеру становятся невалидны.
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (user) {
    user.isOnline = false;
    user.lastSeen = new Date().toISOString();
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    saveDb();
  }
  // SEC: revoke все refresh-семьи для этого устройства (или всех, если deviceId неизвестен).
  const now = Date.now();
  for (const t of db.refreshTokens) {
    if (t.userId === req.userId && !t.revokedAt) {
      if (!req.deviceId || t.deviceId === req.deviceId) {
        t.revokedAt = now;
        t.revokeReason = 'logout';
      }
    }
  }
  saveDb();
  clearAuthCookies(res);
  // Разрываем все активные сокеты этого юзера — они должны переподключиться с новым токеном.
  try {
    const sockets = userSockets && userSockets.get && userSockets.get(req.userId);
    if (sockets) sockets.forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) s.disconnect(true);
    });
  } catch {}
  res.json({ success: true });
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  // Добавляем инфу об устройствах, чтобы клиент мог показать QR-экран
  const devices = (db.devices || []).filter(d => d.userId === user.id);
  res.json({ ...withDevFlag(req, user), devices: devices.map(d => ({
    id: d.id, deviceId: d.deviceId, name: d.name,
    isPrimary: !!d.isPrimary, linkedViaQr: !!d.linkedViaQr,
    createdAt: d.createdAt, lastSeenAt: d.lastSeenAt,
  })) });
});

// ─── ADMIN routes ─────────────────────────────────────────────────────────────

// POST /api/admin/reload-db  — перечитать БД с диска без перезапуска сервера
// SEC: требует auth + isAdminUsername.
app.post('/api/admin/reload-db', authMiddleware, (req, res) => {
  const me = db.users.find(u => u.id === req.userId);
  if (!me || !isAdminUsername(me.username)) return res.status(403).json({ message: 'Forbidden' });
  reloadDb();
  res.json({ success: true, users: db.users.length, tracks: db.tracks.length, chats: db.chats.length });
});

// POST /api/admin/grant  — назначить/снять админа по username.
// Аутентификация: заголовок X-Admin-Token со значением env ADMIN_BOOTSTRAP_TOKEN.
// Задумано для запуска из Render Shell:
//   curl -X POST $URL/api/admin/grant -H "X-Admin-Token: $T" \
//        -H "Content-Type: application/json" -d '{"username":"myname"}'
// Действие: add (по умолчанию) | remove. Возвращает актуальный список.
app.post('/api/admin/grant', (req, res) => {
  const token = String(req.headers['x-admin-token'] || '');
  const expected = String(process.env.ADMIN_BOOTSTRAP_TOKEN || '');
  if (!expected || token !== expected) return res.status(403).json({ message: 'Forbidden' });
  const username = normAdminName(req.body?.username);
  const action = String(req.body?.action || 'add').toLowerCase();
  if (!username) return res.status(400).json({ message: 'username обязателен' });
  if (!Array.isArray(db.admins)) db.admins = [];
  if (action === 'remove' || action === 'del') {
    db.admins = db.admins.filter(a => normAdminName(a) !== username);
  } else {
    if (!db.admins.map(normAdminName).includes(username)) db.admins.push(username);
  }
  saveDb();
  res.json({ ok: true, admins: db.admins, env: ADMIN_ENV });
});

function adminRequest(req) {
  const me = db.users.find(u => u.id === req.userId);
  return me && isAdminUser(req, me);
}

function disconnectBannedIp(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized || !io?.sockets?.sockets) return;
  for (const socket of io.sockets.sockets.values()) {
    if (normalizeIp(socket.ip) === normalized) socket.disconnect(true);
  }
}

function removeUploadFiles() {
  const preserved = new Set();
  for (const message of db.deletedMessages || []) {
    for (const attachment of message.attachments || []) {
      const rawUrl = String(attachment?.fileUrl || attachment?.url || '');
      if (!rawUrl.startsWith('/uploads/')) continue;
      const relative = rawUrl.slice('/uploads/'.length).split(/[?#]/, 1)[0];
      if (!relative || relative.includes('..')) continue;
      const normalized = path.normalize(relative);
      if (/^(music|avatars|files)[\\/][^\\/]+$/.test(normalized)) preserved.add(normalized);
    }
  }
  let removed = 0;
  const removeTree = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = path.normalize(path.join(relative, entry.name));
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        removeTree(target, childRelative);
        try { if (!fs.readdirSync(target).length) { fs.rmdirSync(target); removed += 1; } } catch {}
      } else if (!preserved.has(childRelative)) {
        fs.rmSync(target, { force: true });
        removed += 1;
      }
    }
  };
  removeTree(UPLOADS_DIR);
  for (const entry of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !['music', 'avatars', 'files'].includes(entry.name)) {
      try { fs.rmSync(path.join(UPLOADS_DIR, entry.name), { recursive: true, force: true }); removed += 1; } catch {}
    }
  }
  for (const dir of ['music', 'avatars', 'files']) fs.mkdirSync(path.join(UPLOADS_DIR, dir), { recursive: true });
  return removed;
}

function requirePurgeConfirmation(req, value) {
  return String(req.body?.confirmation || '') === value;
}

// Destructive admin actions require an exact confirmation phrase from the UI/API.
app.post('/api/admin/delete-all-chats', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Forbidden' });
  if (!requirePurgeConfirmation(req, 'DELETE_ALL_CHATS')) {
    return res.status(400).json({ message: 'Введите DELETE_ALL_CHATS для подтверждения' });
  }
  const counts = { chats: db.chats.length, messages: db.messages.length, members: db.chatMembers.length };
  moderation.archive(db, db.messages, req.userId, { uploadsDir: UPLOADS_DIR });
  db.chats = [];
  db.messages = [];
  db.chatMembers = [];
  db.favorites = [];
  db.callLogs = [];
  saveDb();
  io?.emit('admin:data-cleared', { type: 'chats' });
  res.json({ ok: true, counts });
});

app.post('/api/admin/delete-all-users', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Forbidden' });
  if (!requirePurgeConfirmation(req, 'DELETE_ALL_USERS')) {
    return res.status(400).json({ message: 'Введите DELETE_ALL_USERS для подтверждения' });
  }
  const adminId = req.userId;
  const keepUser = db.users.find(u => u.id === adminId);
  const removedUserIds = new Set(db.users.filter(u => u.id !== adminId).map(u => u.id));
  const counts = { users: removedUserIds.size, chats: db.chats.length, messages: db.messages.length };
  moderation.archive(db, db.messages, adminId, { uploadsDir: UPLOADS_DIR });
  db.users = keepUser ? [keepUser] : [];
  db.chats = [];
  db.messages = [];
  db.chatMembers = [];
  db.tracks = [];
  db.playlists = [];
  db.favorites = [];
  db.devices = keepUser ? db.devices.filter(d => d.userId === adminId) : [];
  db.linkInvites = [];
  db.callLogs = [];
  db.bots = [];
  db.aiModels = [];
  db.aiSessions = [];
  db.walletOrders = [];
  db.refreshTokens = keepUser ? db.refreshTokens.filter(t => t.userId === adminId) : [];
  db.customItems = [];
  db.creatorProfiles = {};
  db.userStores = keepUser && db.userStores?.[adminId] ? { [adminId]: db.userStores[adminId] } : {};
  db.userSettings = keepUser && db.userSettings?.[adminId] ? { [adminId]: db.userSettings[adminId] } : {};
  const removedFiles = removeUploadFiles();
  saveDb();
  for (const [userId, sockets] of userSockets.entries()) {
    if (userId !== adminId) sockets.forEach(socketId => io.sockets.sockets.get(socketId)?.disconnect(true));
  }
  res.json({ ok: true, counts: { ...counts, files: removedFiles } });
});

// IP-ban management. `expiresInMinutes` omitted/0 means permanent.
app.get('/api/admin/ip-bans', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Forbidden' });
  const now = Date.now();
  db.ipBans = (db.ipBans || []).filter(b => !b.expiresAt || Number(b.expiresAt) > now);
  saveDb();
  res.json({ bans: db.ipBans });
});

app.post('/api/admin/ip-bans', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Forbidden' });
  const ip = normalizeIp(req.body?.ip);
  if (!ip) return res.status(400).json({ message: 'Укажите корректный IPv4 или IPv6 адрес' });
  if (ip === requestIp(req)) return res.status(400).json({ message: 'Нельзя заблокировать текущий IP' });
  const minutes = Number(req.body?.expiresInMinutes || 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 525600) {
    return res.status(400).json({ message: 'Срок должен быть от 0 до 525600 минут' });
  }
  const ban = {
    ip,
    reason: String(req.body?.reason || '').trim().slice(0, 300) || null,
    createdAt: new Date().toISOString(),
    createdBy: req.userId,
    expiresAt: minutes ? Date.now() + minutes * 60 * 1000 : null,
  };
  db.ipBans = (db.ipBans || []).filter(b => normalizeIp(b.ip) !== ip);
  db.ipBans.push(ban);
  saveDb();
  disconnectBannedIp(ip);
  res.json({ ok: true, ban });
});

app.delete('/api/admin/ip-bans/:ip', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Forbidden' });
  const ip = normalizeIp(req.params.ip);
  if (!ip) return res.status(400).json({ message: 'Некорректный IP' });
  const before = (db.ipBans || []).length;
  db.ipBans = (db.ipBans || []).filter(b => normalizeIp(b.ip) !== ip);
  saveDb();
  res.json({ ok: true, removed: before !== db.ipBans.length });
});

// ─── USERS routes ─────────────────────────────────────────────────────────────
moderation.install({ app, getDb: () => db, saveDb, auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)), isAdminUsername, requestIp,
  notify: (from, to, text, reportId) => {
    const chat = ensureDirectChat(from, to);
    const message = { id: uuidv4(), chatId: chat.id, senderId: from, text, content: text,
      type: 'system', moderationReportId: reportId || null, readBy: [], attachments: [], createdAt: new Date().toISOString() };
    db.messages.push(message);
    for (const uid of [from, to]) for (const sid of userSockets.get(uid) || []) {
      io.to(sid).socketsJoin('chat:' + chat.id);
      io.to(sid).emit('message:new', { ...message, sender: db.users.find(u => u.id === from) });
    }
  },
  disconnect: (userId, ips) => {
    for (const socket of io.sockets.sockets.values()) if (socket.userId === userId || ips.includes(socket.ip)) socket.disconnect(true);
  },
});

// GET /api/users/search?q=...
app.get('/api/users/search', authMiddleware, (req, res) => {
  const rawQuery = String(req.query.q || '').trim().replace(/^@+/, '').slice(0, 50);
  const q = safeLower(rawQuery);
  const phoneQuery = rawQuery.replace(/\D/g, '');
  if (!q) return res.json([]);
  normalizeAllUsers();
  function getUserSearchRank(u) {
    const username = safeLower(u.username).replace(/^@+/, '');
    const email = safeLower(u.email);
    const phone = safeLower(u.phone);
    const fullName = safeLower(`${u.firstName || ''} ${u.lastName || ''}`.trim());
    const firstName = safeLower(u.firstName);
    const lastName = safeLower(u.lastName);
    const userPhone = String(u.phone || '').replace(/\D/g, '');

    if (username === q || email === q || phone === q || (!!phoneQuery && userPhone === phoneQuery)) return 0;
    if (username.startsWith(q) || email.startsWith(q) || firstName.startsWith(q) || lastName.startsWith(q) || fullName.startsWith(q) || (!!phoneQuery && userPhone.startsWith(phoneQuery))) return 1;
    if ([username, firstName, lastName, fullName, email, phone].some(value => value.includes(q)) || (!!phoneQuery && userPhone.includes(phoneQuery))) return 2;
    return 99;
  }

  const results = db.users
    .map(u => {
    normalizeUserRecord(u);
    return { user: u, rank: u.id === req.userId ? 99 : getUserSearchRank(u) };
  })
    .filter(item => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || safeLower(a.user.username).localeCompare(safeLower(b.user.username)))
    .slice(0, 20)
    .map(item => item.user);
  res.json(results);
});

// Publish only equipment IDs, never private account fields.
function publishEquipment(user) {
  const equipment = { id: user.id, activeRing: user.activeRing || '',
    activeSelfCard: user.activeSelfCard || '', activeBubble: user.activeBubble || '' };
  const rooms = db.chatMembers.filter(m => m.userId === user.id).map(m => 'chat:' + m.chatId);
  if (rooms.length) io.to(rooms).emit('user:equipment', equipment);
}

// GET /api/users/:id
// SEC: возвращаем только публичные поля. phone/email/tokenVersion/etc не отдаём.
app.get('/api/users/:id', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'Не найден' });
  const isSelf = user.id === req.userId;
  const publicFields = {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen,
    themeId: user.themeId,
    createdAt: user.createdAt,
    activeRing: user.activeRing || '',
    activeSelfCard: user.activeSelfCard || '',
    activeBubble: user.activeBubble || '',
    pinnedPlaylistId: user.pinnedPlaylistId || null,
    pinnedTrackId: user.pinnedTrackId || null,
  };
  // Себе можно вернуть больше (email/phone для настроек).
  if (isSelf) {
    publicFields.email = user.email;
    publicFields.phone = user.phone;
    publicFields.birthDate = user.birthDate;
    publicFields.country = user.country;
    publicFields.region = user.region;
    publicFields.city = user.city;
    publicFields.chatPhoto = user.chatPhoto;
  }
  res.json(publicFields);
});

// PATCH /api/users/me
app.patch('/api/users/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'Не найден' });
  const allowed = ['firstName', 'lastName', 'username', 'bio', 'birthDate', 'country', 'region', 'city', 'themeId', 'chatPhoto', 'pinnedPlaylistId', 'pinnedTrackId', 'activeRing', 'activeSelfCard', 'activeBubble'];
  for (const key of ['activeRing', 'activeSelfCard', 'activeBubble']) {
    if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > 128)) {
      return res.status(400).json({ message: 'Некорректный ID предмета' });
    }
  }

  // Валидация username: формат + уникальность (регистронезависимо).
  if (req.body.username !== undefined) {
    const raw = String(req.body.username || '').trim().replace(/^@+/, '');
    if (!/^[a-zA-Z0-9_.]{3,32}$/.test(raw)) {
      return res.status(400).json({ message: 'Юзернейм: 3–32 символа, латиница, цифры, _ и .' });
    }
    const low = raw.toLowerCase();
    const taken = db.users.some(u => u.id !== user.id && normalizeIdentifier(u.username) === low);
    if (taken) return res.status(409).json({ message: 'Этот юзернейм уже занят' });
    req.body.username = raw;
  }

  for (const k of allowed) {
    if (req.body[k] !== undefined) user[k] = req.body[k];
  }
  saveDb();
  res.json(withDevFlag(req, user));
  publishEquipment(user);
});

// GET /api/users/:id/customization — публичные поля кастомизации профиля
// (bannerUrl, bannerColor, cardAccent, showcase, aboutMediaUrl и т.п.),
// чтобы другие пользователи видели «шапку» и витрину собеседника.
app.get('/api/users/:id/customization', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  const store = db.userStores[req.params.id]?.['profile-customization'];
  const data = store?.data || null;
  if (!data) return res.json({ data: null });
  // Отдаём только визуальные поля — не служебные функции/приваты.
  const pick = (k) => (data[k] !== undefined ? data[k] : undefined);
  res.json({
    data: {
      bannerUrl: pick('bannerUrl') || '',
      bannerColor: pick('bannerColor') || '',
      cardAccent: pick('cardAccent') || '',
      cardOpacity: pick('cardOpacity'),
      showcase: pick('showcase') || '',
      activityKind: pick('activityKind'),
      activityText: pick('activityText') || '',
      aboutMediaUrl: pick('aboutMediaUrl') || '',
    },
  });
});

// GET /api/users/username-available?u=<name>
// Быстрая проверка занятости никнейма (используется формой редактирования).
app.get('/api/users/username-available', authMiddleware, (req, res) => {
  const raw = String(req.query.u || '').trim().replace(/^@+/, '');
  if (!/^[a-zA-Z0-9_.]{3,32}$/.test(raw)) {
    return res.json({ available: false, reason: 'format' });
  }
  const low = raw.toLowerCase();
  const taken = db.users.some(u => u.id !== req.userId && normalizeIdentifier(u.username) === low);
  res.json({ available: !taken });
});

// POST /api/users/avatar  (legacy)
app.post('/api/users/avatar', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'Не найден' });
  if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });
  user.avatarUrl = `/uploads/avatars/${req.file.filename}`;
  saveDb();
  res.json(user);
});

// PUT /api/users/me/avatar  (used by client)
app.put('/api/users/me/avatar', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'Не найден' });
  if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });
  user.avatarUrl = `/uploads/avatars/${req.file.filename}`;
  saveDb();
  res.json(user);
});

// ─── USER SETTINGS (layout / внешний вид / приватность) ──────────────────────
// Настройки хранятся per-user в db.userSettings[userId]. Клиент кладёт сюда
// весь снапшот стора (кроме action-функций) и подтягивает при логине.
// SEC: сохраняем только plain JSON, ограничиваем размер до 32 КБ.
app.get('/api/settings', authMiddleware, (req, res) => {
  if (!db.userSettings) db.userSettings = {};
  const data = db.userSettings[req.userId] || null;
  res.json({ settings: data, updatedAt: data?.__updatedAt || null });
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const body = req.body?.settings;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ message: 'settings обязателен и должен быть объектом' });
  }
  const serialized = JSON.stringify(body);
  if (serialized.length > 32 * 1024) {
    return res.status(413).json({ message: 'Слишком большой объект настроек' });
  }
  if (!db.userSettings) db.userSettings = {};
  const clean = JSON.parse(serialized);
  if (storeName === 'shop') {
    delete clean.owned;
    delete clean.balanceVp;
  }
  clean.__updatedAt = new Date().toISOString();
  db.userSettings[req.userId] = clean;
  saveDb();

  // Push другим устройствам пользователя. Клиент отсеет своё эхо по __clientId.
  try {
    const sockets = userSockets.get(req.userId);
    if (sockets) sockets.forEach(sid => io.to(sid).emit('settings:updated', {
      settings: clean, updatedAt: clean.__updatedAt,
    }));
  } catch {}

  res.json({ ok: true, updatedAt: clean.__updatedAt });
});

// ─── UNIVERSAL STORE SYNC (синхронизация любых Zustand stores) ────────────────
// Позволяет синхронизировать любой клиентский store между устройствами.
// Структура: db.userStores[userId][storeName] = { data, __updatedAt, __clientId }
// SEC: ограничиваем размер каждого store до 128 КБ, общий лимит на пользователя 1 МБ.

const MAX_STORE_SIZE = 128 * 1024; // 128 КБ на один store
const MAX_TOTAL_STORES_SIZE = 1024 * 1024; // 1 МБ на все stores пользователя

// GET /api/sync/stores — получить все stores пользователя
app.get('/api/sync/stores', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  const stores = db.userStores[req.userId] || {};
  res.json({ stores });
});

// GET /api/sync/stores/:name — получить конкретный store
app.get('/api/sync/stores/:name', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  if (!db.userStores[req.userId]) db.userStores[req.userId] = {};
  const store = db.userStores[req.userId][req.params.name] || null;
  res.json({ 
    data: store?.data || null, 
    updatedAt: store?.__updatedAt || null 
  });
});

// PUT /api/sync/stores/:name — сохранить/обновить store
app.put('/api/sync/stores/:name', authMiddleware, (req, res) => {
  const storeName = req.params.name;
  if (storeName === 'loot') return res.status(403).json({ message: 'Инвентарь изменяется только сервером' });
  const body = req.body?.data;
  const clientId = req.body?.clientId || null;

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ message: 'data обязателен и должен быть объектом' });
  }

  // Проверка размера этого store
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_STORE_SIZE) {
    return res.status(413).json({ 
      message: `Store слишком большой (${Math.round(serialized.length/1024)} КБ, макс ${MAX_STORE_SIZE/1024} КБ)` 
    });
  }

  if (!db.userStores) db.userStores = {};
  if (!db.userStores[req.userId]) db.userStores[req.userId] = {};

  // Проверка общего размера всех stores пользователя
  const otherStoresSize = Object.keys(db.userStores[req.userId])
    .filter(k => k !== storeName)
    .reduce((sum, k) => sum + JSON.stringify(db.userStores[req.userId][k]).length, 0);
  
  if (otherStoresSize + serialized.length > MAX_TOTAL_STORES_SIZE) {
    return res.status(413).json({ 
      message: `Превышен лимит хранилища (${Math.round((otherStoresSize + serialized.length)/1024)} КБ, макс ${MAX_TOTAL_STORES_SIZE/1024} КБ)` 
    });
  }

  const clean = JSON.parse(serialized);
  const updatedAt = new Date().toISOString();
  
  db.userStores[req.userId][storeName] = {
    data: clean,
    __updatedAt: updatedAt,
    __clientId: clientId,
  };
  // Store hydration, sales and clearing inventory must update the public outfit too.
  if (storeName === 'shop') {
    const user = db.users.find(u => u.id === req.userId);
    if (user) {
      for (const key of ['activeRing', 'activeSelfCard', 'activeBubble']) {
        if (typeof clean[key] === 'string' && clean[key].length <= 128) user[key] = clean[key];
      }
      publishEquipment(user);
    }
  }
  saveDb();

  // Push обновление на все устройства пользователя через WebSocket
  try {
    const sockets = userSockets.get(req.userId);
    if (sockets) {
      sockets.forEach(sid => io.to(sid).emit('store:updated', {
        storeName,
        data: clean,
        updatedAt,
        clientId,
      }));
    }
  } catch {}

  res.json({ ok: true, updatedAt });
});

// DELETE /api/sync/stores/:name — удалить store
app.delete('/api/sync/stores/:name', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  if (!db.userStores[req.userId]) db.userStores[req.userId] = {};
  
  delete db.userStores[req.userId][req.params.name];
  saveDb();

  // Уведомить другие устройства об удалении
  try {
    const sockets = userSockets.get(req.userId);
    if (sockets) {
      sockets.forEach(sid => io.to(sid).emit('store:deleted', {
        storeName: req.params.name,
      }));
    }
  } catch {}

  res.json({ ok: true });
});

// ─── DEVICE routes (правило «устройство 1 = 1, второе — по QR») ───────────────

// GET /api/devices — список устройств текущего пользователя
app.get('/api/devices', authMiddleware, (req, res) => {
  const devices = (db.devices || []).filter(d => d.userId === req.userId && !d.revoked).map(d => ({
    id: d.id,
    deviceId: d.deviceId,
    name: d.name,
    isPrimary: !!d.isPrimary,
    linkedViaQr: !!d.linkedViaQr,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
  }));
  res.json(devices);
});

// POST /api/devices/link/create — создать QR-код/ссылку для привязки второго устройства
app.post('/api/devices/link/create', authMiddleware, (req, res) => {
  const myCount = countUserDevices(req.userId);
  if (myCount >= MAX_DEVICES_PER_ACCOUNT) {
    return res.status(403).json({ message: `Уже привязано ${MAX_DEVICES_PER_ACCOUNT} устройства. Отвяжите одно, чтобы добавить новое.` });
  }
  const invite = {
    id: uuidv4(),
    userId: req.userId,
    token: 'vera-link-' + uuidv4().replace(/-/g, ''),
    expiresAt: Date.now() + LINK_INVITE_TTL_MS,
    createdAt: Date.now(),
  };
  if (!db.linkInvites) db.linkInvites = [];
  // Одно активное приглашение на пользователя
  db.linkInvites = db.linkInvites.filter(i => i.userId !== req.userId);
  db.linkInvites.push(invite);
  saveDb();

  const origin = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers.host || 'localhost:3000';
  const url = `vera://link?token=${invite.token}`;
  res.json({
    token: invite.token,
    url,
    deepLink: url,
    // Текстовая ссылка — чтобы вставить куда угодно
    textUrl: `${origin}://${host}/link?token=${invite.token}`,
    webUrl: `${origin}://${host}/link?token=${invite.token}`,
    expiresAt: invite.expiresAt,
    ttlSeconds: LINK_INVITE_TTL_MS / 1000,
  });
});

// POST /api/devices/link/accept — привязать устройство по токену QR/ссылки
app.post('/api/devices/link/accept', (req, res) => {
  const { token, deviceId, deviceName } = req.body || {};
  const t = String(token || '').trim();
  let parsedToken = t;
  // Могут вставить полную ссылку — вытаскиваем token из query/param
  const m = t.match(/[?&]token=([^&]+)/);
  try { if (m) parsedToken = decodeURIComponent(m[1]); }
  catch { return res.status(400).json({ message: 'Некорректная ссылка привязки' }); }
  if (!parsedToken.startsWith('vera-link-')) return res.status(400).json({ message: 'Некорректная ссылка привязки' });

  const invite = (db.linkInvites || []).find(i => i.token === parsedToken);
  if (!invite) return res.status(404).json({ message: 'Ссылка привязки не найдена или уже использована' });

  const installation = resolveInstallation(req, res, true);
  if (!installation) return;
  const resAccept = acceptLinkInviteOnServer(invite, installation.deviceId, String(deviceName || '').slice(0, 80));
  if (!resAccept.ok) return res.status(403).json({ message: resAccept.message });
  resAccept.device.installationHash = installation.hash;
  saveDb();
  const owner = db.users.find(u => u.id === invite.userId);
  if (!owner) return res.status(404).json({ message: 'Аккаунт владельца не найден' });
  recordModerationIp(owner.id, requestIp(req));
  const accessToken = issueAccessToken(owner, installation.deviceId);
  const { raw } = issueRefreshToken(owner, installation.deviceId);
  saveDb();
  const csrfToken = setAuthCookies(res, raw);
  res.json({ ok: true, accessToken, csrfToken, deviceId: installation.deviceId, user: withDevFlag(req, owner) });
});

// DELETE /api/devices/:id — отвязать устройство
app.delete('/api/devices/:id', authMiddleware, (req, res) => {
  const devices = (db.devices || []).filter(d => d.userId === req.userId);
  const target = devices.find(d => d.id === req.params.id);
  if (!target) return res.status(404).json({ message: 'Устройство не найдено' });
  if (target.isPrimary && devices.length === 1) {
    return res.status(400).json({ message: 'Нельзя отвязать единственное устройство аккаунта' });
  }
  target.revoked = true;
  for (const token of db.refreshTokens || []) {
    if (token.deviceId === target.deviceId) token.revokedAt = Date.now();
  }
  saveDb();
  res.json({ success: true });
});

// POST /api/devices/name — переименовать текущее устройство
app.post('/api/devices/name', authMiddleware, (req, res) => {
  const deviceId = req.body?.deviceId || jwt.decode(req.headers.authorization?.slice(7))?.deviceId;
  const device = (db.devices || []).find(d => d.userId === req.userId && d.deviceId === deviceId);
  if (device) {
    device.name = String(req.body?.name || device.name).slice(0, 80);
    saveDb();
  }
  res.json({ success: true });
});

// GET /link — показывает страницу SPA, дальше фронт сам читает ?token=
// (например /link?token=vera-link-xxx) и вызывает accept.

// ─── ВП / крипто-кошелёк (NOWPayments) ─────────────────────────────────────────────
// Без NOWPAYMENTS_API_KEY все пополнения работают в mock-режиме (тест потока).
// Ключи задаются через env: NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET.
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || '';
const NOWPAYMENTS_API = 'https://api.nowpayments.io';
// SEC: стартовый лог, чтобы сразу видеть, реальный шлюз или mock. Ключи не печатаем.
console.log(
  `[wallet] NOWPayments mode: ${NOWPAYMENTS_API_KEY ? 'live' : 'mock'} ` +
  `(IPN signature check: ${NOWPAYMENTS_IPN_SECRET ? 'on' : 'off'})`,
);
const VP_PER_RUB = 2;                    // 1 руб = 2 ВП (1 ВП = 0.5 руб)
const VP_MIN_TOPUP = 50;
const VP_MAX_TOPUP = 50000;
const VP_INVOICE_TTL_MS = 30 * 60 * 1000;

// Case prices are intentionally unset until the publisher supplies the price
// for every case. `null` is different from zero: an unset case cannot be
// purchased and can never become a free test reward by accident.
const CASE_PRICES = Object.fromEntries(require('../Web/src/store/cases.json').map(c => [c.id, c.price]));
const CASE_IDS = new Set(Object.keys(CASE_PRICES));
const MARKET_MIN_PRICE_VP = 6; // 3 RUB at 1 RUB = 2 VP
const MARKET_MAX_PRICE_VP = 100000000;
const MARKET_SELLER_SHARE = 85;

const RARITY_IDS = new Set([
  'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine',
  'transcendent', 'absolute', 'exclusive', 'crystal', 'plasma', 'digital',
  'relic', 'holo', 'mechanic', 'royal', 'anomaly', 'core', 'infinity', 'cult',
]);
const MARKET_PACK_KEYS = new Set([
  'neon', 'glass', 'shadow', 'gradient-sunset', 'gradient-ocean',
  'gradient-forest', 'minimal', 'rounded', 'sharp', 'retro', 'candy', 'mono',
  'aurora', 'cyber', 'gradient-lava', 'gradient-ice', 'gradient-gold',
  'neon-pink', 'holographic',
  'games-blocks', 'games-plumber', 'games-portal', 'games-bonfire', 'games-dragon',
  'games-racer', 'games-invader', 'games-dungeon', 'games-mech', 'games-crown',
  'corp-pass', 'corp-tower', 'corp-network', 'corp-contract', 'corp-director',
  'corp-terminal', 'corp-briefcase', 'corp-vault', 'corp-satellite', 'corp-citadel',
  'street-tag', 'street-spray', 'street-stencil', 'street-wildstyle', 'street-mural',
  'street-sticker', 'street-poster', 'street-skate', 'street-neon', 'street-crown',
  'culture-book', 'culture-jazz', 'culture-theatre', 'culture-cinema', 'culture-heritage',
  'culture-ink', 'culture-gallery', 'culture-ballet', 'culture-orchestra', 'culture-observatory',
  'myths-icarus', 'myths-medusa', 'myths-minotaur', 'myths-fenrir', 'myths-odyssey',
  'myths-valkyrie', 'myths-phoenix', 'myths-excalibur', 'myths-olympus', 'myths-grail',
  'nightmare-whisper', 'nightmare-mirror', 'nightmare-doll', 'nightmare-hall',
  'nightmare-sleepwalker', 'nightmare-mouth', 'nightmare-eyes', 'nightmare-crow',
  'nightmare-puppet', 'nightmare-abyss',
  'ashes-ember', 'ashes-cinder', 'ashes-smoke', 'ashes-forge', 'ashes-phoenix',
  'ashes-charcoal', 'ashes-ruins', 'ashes-volcano', 'ashes-scorch', 'ashes-afterglow',
]);
const MARKET_STATIC_SKINS = new Set([
  'ring-default', 'ring-rainbow', 'ring-glow', 'ring-pulse', 'ring-aurora',
  'ring-fire', 'ring-ocean', 'ring-holographic', 'ring-lava', 'ring-ice',
  'selfcard-default', 'selfcard-gradient', 'selfcard-badge', 'selfcard-gold',
  'selfcard-hologram', 'bubble-neon', 'bubble-glass', 'bubble-shadow',
  'bubble-gradient-sunset', 'bubble-gradient-ocean', 'bubble-gradient-forest',
  'bubble-minimal', 'bubble-rounded', 'bubble-sharp', 'bubble-retro',
  'bubble-candy', 'bubble-mono', 'bubble-aurora', 'bubble-cyber',
  'bubble-gradient-lava', 'bubble-gradient-ice', 'bubble-gradient-gold',
  'bubble-neon-pink', 'bubble-holographic',
]);

function isKnownSkinId(itemId) {
  if (MARKET_STATIC_SKINS.has(itemId)) return true;
  const rarity = String(itemId).match(/^(?:ring|selfcard|bubble)-r-(.+)$/)?.[1];
  if (rarity && RARITY_IDS.has(rarity)) return true;
  const pack = String(itemId).match(/^(?:ring|selfcard)-pack-(.+)$/)?.[1]
    || String(itemId).match(/^bubble-(.+)$/)?.[1];
  return !!pack && MARKET_PACK_KEYS.has(pack);
}

function emptyCaseInventory() {
  return Object.fromEntries([...CASE_IDS].map(id => [id, 0]));
}

function normalizeCaseInventory(value) {
  const result = emptyCaseInventory();
  if (!value || typeof value !== 'object') return result;
  for (const id of CASE_IDS) {
    const count = Math.floor(Number(value[id]));
    result[id] = Number.isSafeInteger(count) && count > 0 ? count : 0;
  }
  return result;
}

function activeListingsForSeller(userId) {
  return (db.marketListings || []).filter(listing => listing.sellerId === userId);
}

function lockedItemIdsForSeller(userId) {
  return new Set(activeListingsForSeller(userId).map(listing => listing.itemId));
}

function accountOwnedSkinIds(user) {
  const owned = new Set((user?.ownedItems || []).filter(isKnownSkinId));
  const synced = db.userStores?.[user?.id]?.shop?.data?.owned;
  if (synced && typeof synced === 'object') {
    for (const [itemId, value] of Object.entries(synced)) {
      if (value === true && isKnownSkinId(itemId)) owned.add(itemId);
    }
  }
  for (const itemId of lockedItemIdsForSeller(user?.id)) owned.delete(itemId);
  return owned;
}

function setSyncedShopOwnership(userId, itemId, value) {
  const shop = db.userStores?.[userId]?.shop?.data;
  if (!shop || typeof shop !== 'object') return;
  if (!shop.owned || typeof shop.owned !== 'object') shop.owned = {};
  shop.owned[itemId] = !!value;
}

function marketListingView(listing, viewerId = null) {
  const seller = db.users.find(user => user.id === listing.sellerId);
  return {
    id: listing.id,
    itemId: listing.itemId,
    sellerId: listing.sellerId,
    seller: seller?.username || 'Пользователь',
    price: listing.price,
    createdAt: listing.createdAt,
    isMine: listing.sellerId === viewerId,
  };
}

function marketListingViews(viewerId = null) {
  return (db.marketListings || []).map(listing => marketListingView(listing, viewerId));
}

function emitMarketUpdated() {
  if (typeof io === 'undefined' || !io) return;
  io.emit('market:updated', { listings: marketListingViews() });
}

// Серверный каталог цен — копия платных товаров из клиентского SHOP_CATALOG.
const SHOP_PRICES = {
  'wp-time': 120,
  'wp-parallax': 180,
  'wp-touch': 200,
  'chat-theme': 250,
  // ── Линейка редкостей (21×2, id = ring-r-<tier> / selfcard-r-<tier>) ──
  'ring-r-common': 40,        'selfcard-r-common': 40,
  'ring-r-uncommon': 90,      'selfcard-r-uncommon': 90,
  'ring-r-rare': 160,         'selfcard-r-rare': 160,
  'ring-r-epic': 260,         'selfcard-r-epic': 260,
  'ring-r-legendary': 400,    'selfcard-r-legendary': 400,
  'ring-r-mythic': 600,       'selfcard-r-mythic': 600,
  'ring-r-divine': 850,       'selfcard-r-divine': 850,
  'ring-r-transcendent': 1150,'selfcard-r-transcendent': 1150,
  'ring-r-absolute': 1500,    'selfcard-r-absolute': 1500,
  'ring-r-exclusive': 1900,   'selfcard-r-exclusive': 1900,
  'ring-r-crystal': 2350,     'selfcard-r-crystal': 2350,
  'ring-r-plasma': 2850,      'selfcard-r-plasma': 2850,
  'ring-r-digital': 3400,     'selfcard-r-digital': 3400,
  'ring-r-relic': 4000,       'selfcard-r-relic': 4000,
  'ring-r-holo': 4650,        'selfcard-r-holo': 4650,
  'ring-r-mechanic': 5350,    'selfcard-r-mechanic': 5350,
  'ring-r-royal': 6100,       'selfcard-r-royal': 6100,
  'ring-r-anomaly': 6900,     'selfcard-r-anomaly': 6900,
  'ring-r-core': 7750,        'selfcard-r-core': 7750,
  'ring-r-infinity': 8650,    'selfcard-r-infinity': 8650,
  'ring-r-cult': 12000,       'selfcard-r-cult': 12000,
  // ── Новые платные (bubble + доп. обои) ─────────────────────────────────
  'bubble-neon': 150, 'bubble-glass': 180, 'bubble-shadow': 120,
  'bubble-gradient-sunset': 200, 'bubble-gradient-ocean': 200, 'bubble-gradient-forest': 200,
  'bubble-minimal': 90, 'bubble-rounded': 100, 'bubble-sharp': 100,
  'bubble-retro': 130, 'bubble-candy': 160, 'bubble-mono': 110,
  'bubble-aurora': 220, 'bubble-cyber': 240,
  'wp-gradient-fire': 90, 'wp-gradient-ocean': 90, 'wp-gradient-forest': 90,
  'wp-gradient-cosmic': 110, 'wp-gradient-candy': 90,
  'wp-particles': 160, 'wp-waves': 140, 'wp-grid': 80, 'wp-dots-animate': 130,
  'wp-aurora': 250, 'wp-matrix': 200, 'wp-snow': 150, 'wp-rain': 150,
  'wp-stars': 180, 'wp-noise': 100, 'wp-blob': 170,
};
function getShopItemPrice(itemId) {
  return Object.prototype.hasOwnProperty.call(SHOP_PRICES, itemId) ? SHOP_PRICES[itemId] : undefined;
}
function ensureWallet(user) {
  if (!user) return user;
  if (typeof user.walletBalance !== 'number') user.walletBalance = 0;
  if (!Array.isArray(user.ownedItems)) user.ownedItems = [];
  if (!user.caseInventoryMigrated) {
    const previous = db.userStores?.[user.id];
    const owned = previous?.shop?.data?.owned || {};
    user.ownedItems = [...new Set([...user.ownedItems, ...Object.keys(owned).filter(id => owned[id] === true && isKnownSkinId(id))])];
    user.casePacks = user.casePacks || previous?.loot?.data?.packs || {};
    user.caseInventoryMigrated = true;
    saveDb();
  }
  return user;
}
function vpOrderId(order) { return 'vp_' + String(order.id).replace(/-/g, ''); }
function pushWalletEmit(user) {
  const sockets = userSockets.get(user.id);
  if (sockets) sockets.forEach(sid => {
    io.to(sid).emit('wallet:updated', { balance: user.walletBalance });
    io.to(sid).emit('shop:owned', { ownedItems: user.ownedItems });
  });
}

// Баланс + купленные товары
app.post('/api/admin/wallet/grant', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Нет прав администратора' });
  const username = String(req.body?.username || '').trim().replace(/^@+/, '').toLowerCase();
  const amount = req.body?.amount;
  if (!username || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ message: 'Укажите ник и целое количество ВП от 1 до 1 000 000' });
  }
  const matches = db.users.filter(u => String(u.username || '').replace(/^@+/, '').toLowerCase() === username);
  if (matches.length !== 1) return res.status(matches.length ? 409 : 404).json({ message: matches.length ? 'Ник неоднозначен' : 'Пользователь не найден' });
  const user = matches[0];
  const previous = user.walletBalance;
  const balance = Number.isFinite(previous) ? previous : 0;
  if (!Number.isSafeInteger(balance + amount)) return res.status(400).json({ message: 'Превышен предел баланса' });
  user.walletBalance = balance + amount;
  try { saveDb(); } catch {
    user.walletBalance = previous;
    return res.status(500).json({ message: 'Не удалось сохранить начисление' });
  }
  pushWalletEmit(user);
  res.json({ username: user.username, amount, balance: user.walletBalance });
});

app.get('/api/wallet', authMiddleware, (req, res) => {
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  res.json({ balance: user.walletBalance, ownedItems: user.ownedItems });
});

const CASE_CATALOG = require('./../Web/src/store/cases.json');
function caseState(user) {
  return {
    balance: user.walletBalance, ownedItems: user.ownedItems,
    caseCounts: normalizeCaseInventory(user.caseCounts),
    packs: user.casePacks || {}, lastDrop: user.lastCaseDrop || null,
    prices: CASE_PRICES,
  };
}
app.get('/api/cases', authMiddleware, (req, res) => {
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  res.json(caseState(user));
});
for (const action of ['buy', 'open']) {
  app.post(`/api/cases/${action}`, authMiddleware, (req, res) => {
    const definition = CASE_CATALOG.find(c => c.id === req.body?.caseId);
    if (!definition) return res.status(400).json({ message: 'Неизвестный кейс' });
    const user = ensureWallet(db.users.find(u => u.id === req.userId));
    const counts = normalizeCaseInventory(user.caseCounts);
    const price = CASE_PRICES[definition.id];
    if (action === 'buy' && (!Number.isSafeInteger(price) || price <= 0)) return res.status(409).json({ message: 'Цена кейса ещё не назначена' });
    if (action === 'buy' && user.walletBalance < price) return res.status(409).json({ message: 'Недостаточно ВП' });
    if (action === 'open' && counts[definition.id] < 1) return res.status(409).json({ message: 'Нет доступного кейса' });
    const previous = JSON.parse(JSON.stringify(user));
    let drop = null;
    if (action === 'buy') {
      user.walletBalance -= price;
      counts[definition.id]++;
    } else {
      let roll = crypto.randomInt(definition.rewards.reduce((sum, reward) => sum + reward.weight, 0));
      const reward = definition.rewards.find(reward => (roll -= reward.weight) < 0);
      const key = reward.key;
      drop = `pack-${key}`;
      const parts = key.startsWith('r-') ? [`ring-${key}`, `selfcard-${key}`, `bubble-${key}`] : [`ring-pack-${key}`, `selfcard-pack-${key}`, `bubble-${key}`];
      user.ownedItems = [...new Set([...user.ownedItems, ...parts])];
      user.casePacks = { ...user.casePacks, [drop]: (user.casePacks?.[drop] || 0) + 1 };
      user.lastCaseDrop = drop;
      counts[definition.id]--;
    }
    user.caseCounts = counts;
    try { saveDb(); } catch (error) {
      for (const key of Object.keys(user)) delete user[key];
      Object.assign(user, previous);
      return res.status(500).json({ message: 'Не удалось сохранить операцию' });
    }
    const state = caseState(user);
    const sockets = userSockets.get(user.id);
    if (sockets) sockets.forEach(sid => io.to(sid).emit('cases:updated', state));
    pushWalletEmit(user);
    res.json({ ...state, drop });
  });
}

const yoomoney = require('./yoomoney');
// Some isolated VM tests stub require() with the case catalog. Production has
// the real module; the guard keeps those focused tests independent of payment
// integration while preserving the normal registration path.
if (typeof yoomoney?.registerYoomoney === 'function') {
  yoomoney.registerYoomoney(app, { getDb: () => db, saveDb, authMiddleware, ensureWallet, pushWalletEmit });
}

// Создать инвойс на пополнение (amount в ВП)
app.post('/api/wallet/topup', authMiddleware, async (req, res) => {
  const amount = Math.floor(Number(req.body?.amount));
  if (!isFinite(amount) || amount < VP_MIN_TOPUP || amount > VP_MAX_TOPUP) {
    return res.status(400).json({ message: `Сумма пополнения — от ${VP_MIN_TOPUP} до ${VP_MAX_TOPUP} ВП` });
  }
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  if (!db.walletOrders) db.walletOrders = [];
  const order = {
    id: uuidv4(), userId: user.id,
    amountVs: amount,
    priceRub: Math.round((amount / VP_PER_RUB) * 100) / 100,
    status: 'waiting', createdAt: Date.now(),
  };
  db.walletOrders.push(order);
  // чистим старые (старше суток) — мусор не копим
  db.walletOrders = db.walletOrders.filter(o => o.provider === 'yoomoney' || Date.now() - (o.createdAt || 0) < 24 * 60 * 60 * 1000);
  saveDb();

  // Mock-режим: ключа NOWPAYMENTS ещё нет
  if (!NOWPAYMENTS_API_KEY) {
    return res.json({
      orderId: order.id, paymentId: order.id, mock: true,
      invoiceUrl: '', amountVs: order.amountVs, priceRub: order.priceRub,
      rate: VP_PER_RUB, expiresAt: order.createdAt + VP_INVOICE_TTL_MS,
    });
  }
  try {
    const proto = (req.headers['x-forwarded-proto'] === 'https' || req.secure) ? 'https' : 'http';
    const host = req.headers.host || 'localhost:3000';
    const base = `${proto}://${host}`;
    const call = await fetch(`${NOWPAYMENTS_API}/v1/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': NOWPAYMENTS_API_KEY },
      body: JSON.stringify({
        price_amount: order.priceRub,
        price_currency: 'rub',
        order_id: vpOrderId(order),
        order_description: `VERA — пополнение на ${order.amountVs} ВП`,
        ipn_callback_url: `${base}/api/wallet/webhook`,
        success_url: `${base}?topup=ok`,
        cancel_url: `${base}`,
      }),
    });
    const js = await call.json();
    if (!js?.id || !js?.invoice_url) throw new Error(js?.message || 'NOWPayments не вернул инвойс');
    order.paymentId = js.id;
    order.invoiceUrl = js.invoice_url;
    saveDb();
    return res.json({
      orderId: order.id, paymentId: js.id,
      mock: false, invoiceUrl: js.invoice_url,
      amountVs: order.amountVs, priceRub: order.priceRub,
      rate: VP_PER_RUB, expiresAt: order.createdAt + VP_INVOICE_TTL_MS,
    });
  } catch (e) {
    console.error('[wallet] NOWPayments invoice error:', e);
    db.walletOrders = db.walletOrders.filter(o => o.id !== order.id);
    saveDb();
    return res.status(502).json({ message: 'Не удалось создать инвойс. Попробуйте позже.' });
  }
});

// Статус заказа (клиент поллит каждые ~4с)
app.get('/api/wallet/orders/:orderId', authMiddleware, (req, res) => {
  const order = (db.walletOrders || []).find(o => o.id === req.params.orderId && o.userId === req.userId);
  if (!order) return res.status(404).json({ message: 'Заказ не найден' });
  res.json({ status: order.status, amountVs: order.amountVs, priceRub: order.priceRub });
});

// Webhook от NOWPayments (IPN) — публичный
app.post('/api/wallet/webhook', (req, res) => {
  if (!NOWPAYMENTS_IPN_SECRET) return res.sendStatus(503);
  if (NOWPAYMENTS_IPN_SECRET) {
    const sig = req.headers['x-nowpayments-sig'];
    const calc = require('crypto').createHmac('sha512', NOWPAYMENTS_IPN_SECRET).update(req.rawBody || '').digest('hex');
    if (!sig || String(sig).toLowerCase() !== calc) return res.status(401).json({ error: 'bad signature' });
  }
  const body = req.body || {};
  const order = (db.walletOrders || []).find(o => vpOrderId(o) === body.order_id);
  if (!order || order.provider === 'yoomoney') return res.json({ ok: true }); // не наш заказ — игнорируем
  if ((body.payment_status === 'finished' || body.payment_status === 'partially_paid') && order.status !== 'paid') {
    if (order.kind === 'creator-fee') {
      const prof = creatorProfile(order.userId);
      prof.feePaid = true; prof.feeOrderId = order.id; prof.joinedAt = Date.now();
      order.status = 'paid'; order.paidAt = Date.now();
      saveDb();
    } else {
      const user = ensureWallet(db.users.find(u => u.id === order.userId));
      if (user) {
        user.walletBalance = (user.walletBalance || 0) + order.amountVs;
        order.status = 'paid'; order.paidAt = Date.now();
        saveDb();
        pushWalletEmit(user);
      }
    }
  }
  res.json({ ok: true });
});

// МОК-оплата (только без NOWPAYMENTS_API_KEY) — для теста потока пополнения
app.post('/api/wallet/mock-pay', authMiddleware, (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.WALLET_ALLOW_MOCK !== 'true' || process.env.YOOMONEY_RECEIVER) return res.sendStatus(403);
  if (NOWPAYMENTS_API_KEY) return res.status(400).json({ message: 'Mock-оплата отключена (ключ NOWPAYMENTS задан)' });
  const order = (db.walletOrders || []).find(o => o.id === req.body?.orderId && o.userId === req.userId);
  if (!order) return res.status(404).json({ message: 'Заказ не найден' });
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  if (order.status !== 'paid') {
    user.walletBalance = (user.walletBalance || 0) + order.amountVs;
    order.status = 'paid'; order.paidAt = Date.now();
    saveDb();
    pushWalletEmit(user);
  }
  res.json({ ok: true, balance: user.walletBalance });
});

// Купить платный товар (списание с баланса ВП)
app.post('/api/shop/buy', authMiddleware, (req, res) => {
  const itemId = String(req.body?.itemId || '');
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  if (user.ownedItems.includes(itemId)) return res.json({ ok: true, already: true, balance: user.walletBalance, ownedItems: user.ownedItems });
  // Бесплатно: dev-IP и настроенные админы — режим проверки продукта.
  const devFree = isAdminReq(req);

  // Кастомные предметы от авторов: id вида "custom:<uuid>"
  if (itemId.startsWith('custom:')) {
    const cid = itemId.slice(7);
    const item = (db.customItems || []).find(i => i.id === cid);
    if (!item) return res.status(400).json({ message: 'Кастомный товар не найден' });
    if (item.status !== 'published') return res.status(400).json({ message: 'Товар недоступен' });
    const price = Number(item.price) || 0;
    if (!devFree && (user.walletBalance || 0) < price) {
      return res.status(400).json({ message: `Недостаточно ВП. Нужно ${price} ВП — пополните баланс.` });
    }
    if (!devFree) user.walletBalance -= price;
    user.ownedItems.push(itemId);
    // Разделение 85/15
    if (!devFree && price > 0) {
      const authorShare = Math.floor(price * 0.85);
      const platformShare = price - authorShare;
      db.platformRevenueVp = (db.platformRevenueVp || 0) + platformShare;
      if (item.authorId && item.authorId !== user.id) {
        const author = ensureWallet(db.users.find(u => u.id === item.authorId));
        if (author) {
          author.walletBalance = (author.walletBalance || 0) + authorShare;
          item.revenueVp = (item.revenueVp || 0) + authorShare;
          pushWalletEmit(author);
        }
      }
    }
    item.salesCount = (item.salesCount || 0) + 1;
    saveDb();
    pushWalletEmit(user);
    return res.json({ ok: true, balance: user.walletBalance, ownedItems: user.ownedItems });
  }

  // Обычный каталожный товар
  const price = getShopItemPrice(itemId);
  if (price === undefined) return res.status(400).json({ message: 'Товар не найден' });
  if (!devFree && (user.walletBalance || 0) < price) return res.status(400).json({ message: `Недостаточно ВП. Нужно ${price} ВП — пополните баланс.` });
  if (!devFree) user.walletBalance -= price;
  user.ownedItems.push(itemId);
  saveDb();
  pushWalletEmit(user);
  res.json({ ok: true, balance: user.walletBalance, ownedItems: user.ownedItems });
});


// ─── CREATOR / CUSTOM SHOP ITEMS ─────────────────────────────────────────────
// Shared skin marketplace. Listings hold the item in escrow until cancellation or sale.
app.get('/api/market', authMiddleware, (req, res) => {
  res.json({ listings: marketListingViews(req.userId) });
});

function commitMarket(res, mutate) {
  const before = JSON.stringify(db);
  try { mutate(); saveDb(); return true; } catch {
    db = JSON.parse(before);
    res.status(500).json({ message: 'Не удалось сохранить операцию' });
    return false;
  }
}

app.post('/api/market/list', authMiddleware, (req, res) => {
  const { itemId, price } = req.body || {};
  if (!Number.isSafeInteger(price) || price < MARKET_MIN_PRICE_VP || price > MARKET_MAX_PRICE_VP) {
    return res.status(400).json({ message: 'Цена должна быть целым числом от 6 до 100000000 ВП' });
  }
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  if (!isKnownSkinId(itemId) || !user.ownedItems.includes(itemId) || lockedItemIdsForSeller(user.id).has(itemId)) {
    return res.status(409).json({ message: 'Предмет недоступен для продажи' });
  }
  const listing = { id: uuidv4(), itemId, price, sellerId: user.id, createdAt: Date.now() };
  if (!commitMarket(res, () => {
    db.marketListings.push(listing);
    user.ownedItems = user.ownedItems.filter(id => id !== itemId);
    setSyncedShopOwnership(user.id, itemId, false);
    for (const slot of ['activeRing', 'activeSelfCard', 'activeBubble']) {
      if (user[slot] === itemId) user[slot] = '';
      const shop = db.userStores?.[user.id]?.shop?.data;
      if (shop?.[slot] === itemId) shop[slot] = '';
    }
  })) return;
  pushWalletEmit(user);
  emitMarketUpdated();
  res.json({ listing: marketListingView(listing, user.id), balance: user.walletBalance });
});

for (const action of ['cancel', 'buy']) {
  app.post(`/api/market/:id/${action}`, authMiddleware, (req, res) => {
    const listing = db.marketListings.find(l => l.id === req.params.id);
    if (!listing) return res.status(404).json({ message: 'Объявление уже снято или продано' });
    const user = ensureWallet(db.users.find(u => u.id === req.userId));
    const seller = ensureWallet(db.users.find(u => u.id === listing.sellerId));
    if (!user || !seller) return res.status(404).json({ message: 'Пользователь не найден' });
    if ((action === 'cancel') !== (user.id === seller.id)) return res.status(403).json({ message: 'Операция недоступна' });
    const share = Math.floor(listing.price * MARKET_SELLER_SHARE / 100);
    if (action === 'buy' && (user.ownedItems.includes(listing.itemId) || lockedItemIdsForSeller(user.id).has(listing.itemId))) {
      return res.status(409).json({ message: 'У вас уже есть этот предмет' });
    }
    if (action === 'buy' && (!Number.isSafeInteger(listing.price) || listing.price < MARKET_MIN_PRICE_VP || user.walletBalance < listing.price || !Number.isSafeInteger(seller.walletBalance + share))) {
      return res.status(409).json({ message: 'Недостаточно ВП или недопустимая цена' });
    }
    if (!commitMarket(res, () => {
      db.marketListings = db.marketListings.filter(l => l.id !== listing.id);
      user.ownedItems = [...new Set([...user.ownedItems, listing.itemId])];
      setSyncedShopOwnership(user.id, listing.itemId, true);
      if (action === 'buy') {
        user.walletBalance -= listing.price;
        seller.walletBalance += share;
        db.platformRevenueVp = (db.platformRevenueVp || 0) + listing.price - share;
      }
    })) return;
    pushWalletEmit(user);
    if (user !== seller) pushWalletEmit(seller);
    emitMarketUpdated();
    res.json({ ok: true, itemId: listing.itemId, balance: user.walletBalance, ownedItems: user.ownedItems });
  });
}

const CREATOR_FEE_RUB = 200;
const CUSTOM_CATEGORIES = new Set(['profile', 'selfcard', 'wallpaper', 'bubble']);
const CUSTOM_MIN_PRICE = 20;
const CUSTOM_MAX_PRICE = 20000;

function isAdminReq(req) {
  if (isDevIp(req)) return true;
  const u = db.users.find(x => x.id === req.userId);
  return isAdminUsername(u?.username);
}
function creatorProfile(userId) {
  if (!db.creatorProfiles[userId]) db.creatorProfiles[userId] = { feePaid: false };
  return db.creatorProfiles[userId];
}
function canCreate(req, userId) {
  if (isAdminReq(req)) return true;
  return !!creatorProfile(userId).feePaid;
}

/**
 * Санитайзер спецификации кастомного предмета.
 * Только типизированные поля — ни строк CSS, ни HTML, ни url().
 */
function sanitizeCustomSpec(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const hex = v => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : null;
  const num = (v, min, max, def) => {
    const n = Number(v);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');
  const bool = v => !!v;
  const one = (v, allowed, def) => allowed.includes(v) ? v : def;

  out.bg = {
    type: one(s.bg?.type, ['solid', 'linear', 'radial'], 'solid'),
    color1: hex(s.bg?.color1) || '#1e1e2e',
    color2: hex(s.bg?.color2) || '#7c6af7',
    angle: num(s.bg?.angle, 0, 360, 135),
  };
  out.border = {
    width: num(s.border?.width, 0, 12, 0),
    color: hex(s.border?.color) || '#7c6af7',
    style: one(s.border?.style, ['solid', 'dashed', 'dotted', 'double'], 'solid'),
    radius: num(s.border?.radius, 0, 64, 12),
  };
  out.glow = {
    enabled: bool(s.glow?.enabled),
    color: hex(s.glow?.color) || '#7c6af7',
    intensity: num(s.glow?.intensity, 0, 40, 12),
  };
  out.shadow = {
    enabled: bool(s.shadow?.enabled),
    x: num(s.shadow?.x, -40, 40, 0),
    y: num(s.shadow?.y, -40, 40, 6),
    blur: num(s.shadow?.blur, 0, 80, 18),
    color: hex(s.shadow?.color) || '#00000066',
  };
  out.text = {
    color: hex(s.text?.color) || '#ffffff',
    weight: one(String(s.text?.weight ?? '500'), ['300','400','500','600','700','800'], '500'),
  };
  out.animation = one(s.animation, ['none', 'pulse', 'shimmer', 'float'], 'none');
  out.opacity = num(s.opacity, 0.1, 1, 1);
  out.padding = num(s.padding, 0, 40, 12);
  out.emoji = str(s.emoji, 8);
  return out;
}
function sanitizeItem(input) {
  const category = CUSTOM_CATEGORIES.has(input?.category) ? input.category : 'profile';
  const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 60) : '';
  const description = typeof input?.description === 'string' ? input.description.trim().slice(0, 300) : '';
  let price = Math.floor(Number(input?.price));
  if (!isFinite(price)) price = CUSTOM_MIN_PRICE;
  price = Math.max(CUSTOM_MIN_PRICE, Math.min(CUSTOM_MAX_PRICE, price));
  return { category, name, description, price, spec: sanitizeCustomSpec(input?.spec) };
}


app.get('/api/creator/me', authMiddleware, (req, res) => {
  const prof = creatorProfile(req.userId);
  res.json({
    feePaid: !!prof.feePaid || isAdminReq(req),
    isAdmin: isAdminReq(req),
    feeRub: CREATOR_FEE_RUB,
    revenueVp: prof.revenueVp || 0,
  });
});

app.post('/api/creator/join-fee', authMiddleware, async (req, res) => {
  const prof = creatorProfile(req.userId);
  if (prof.feePaid || isAdminReq(req)) return res.json({ ok: true, already: true });
  if (!db.walletOrders) db.walletOrders = [];
  const order = {
    id: uuidv4(), userId: req.userId, kind: 'creator-fee',
    amountVs: 0, priceRub: CREATOR_FEE_RUB,
    status: 'waiting', createdAt: Date.now(),
  };
  db.walletOrders.push(order);
  saveDb();
  if (!NOWPAYMENTS_API_KEY) {
    return res.json({ orderId: order.id, mock: true, priceRub: CREATOR_FEE_RUB, invoiceUrl: '' });
  }
  try {
    const r = await fetch(`${NOWPAYMENTS_API}/v1/invoice`, {
      method: 'POST',
      headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_amount: CREATOR_FEE_RUB, price_currency: 'rub',
        order_id: vpOrderId(order),
        order_description: 'Vera Creator join fee',
        ipn_callback_url: `${(req.headers['x-forwarded-proto'] === 'https' || req.secure) ? 'https' : 'http'}://${req.headers.host || 'localhost:3000'}/api/wallet/webhook`,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || 'invoice failed');
    order.invoiceUrl = data.invoice_url || '';
    saveDb();
    res.json({ orderId: order.id, priceRub: CREATOR_FEE_RUB, invoiceUrl: order.invoiceUrl });
  } catch (e) {
    console.error('[creator-fee] invoice error:', e);
    db.walletOrders = db.walletOrders.filter(o => o.id !== order.id);
    saveDb();
    res.status(502).json({ message: 'Не удалось создать инвойс.' });
  }
});

app.post('/api/creator/mock-pay-fee', authMiddleware, (req, res) => {
  if (NOWPAYMENTS_API_KEY) return res.status(400).json({ message: 'Mock отключён' });
  const order = (db.walletOrders || []).find(o => o.id === req.body?.orderId && o.userId === req.userId && o.kind === 'creator-fee');
  if (!order) return res.status(404).json({ message: 'Заказ не найден' });
  const prof = creatorProfile(req.userId);
  prof.feePaid = true; prof.feeOrderId = order.id; prof.joinedAt = Date.now();
  order.status = 'paid'; order.paidAt = Date.now();
  saveDb();
  res.json({ ok: true, feePaid: true });
});

app.get('/api/creator/items', authMiddleware, (req, res) => {
  const list = (db.customItems || []).filter(i => i.authorId === req.userId);
  res.json({ items: list });
});

app.post('/api/creator/items', authMiddleware, (req, res) => {
  if (!canCreate(req, req.userId)) return res.status(402).json({ message: 'Сначала оплатите взнос автора (200₽).' });
  const clean = sanitizeItem(req.body);
  if (!clean.name) return res.status(400).json({ message: 'Название обязательно.' });
  const item = {
    id: uuidv4(), authorId: req.userId, ...clean,
    status: 'draft', createdAt: Date.now(),
    salesCount: 0, revenueVp: 0,
  };
  db.customItems.push(item);
  saveDb();
  res.json({ item });
});
app.patch('/api/creator/items/:id', authMiddleware, (req, res) => {
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Не найден' });
  if (item.authorId !== req.userId) return res.status(403).json({ message: 'Не ваш предмет' });
  if (item.status !== 'draft' && !isAdminReq(req)) return res.status(400).json({ message: 'Снимите с публикации перед редактированием.' });
  const clean = sanitizeItem({ ...item, ...req.body });
  Object.assign(item, clean);
  saveDb();
  res.json({ item });
});

app.post('/api/creator/items/:id/publish', authMiddleware, (req, res) => {
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Не найден' });
  if (item.authorId !== req.userId && !isAdminReq(req)) return res.status(403).json({ message: 'Не ваш предмет' });
  if (!canCreate(req, item.authorId)) return res.status(402).json({ message: 'Взнос автора не оплачен.' });
  if (!item.name) return res.status(400).json({ message: 'Название обязательно.' });
  item.status = 'published'; item.publishedAt = Date.now();
  saveDb();
  res.json({ item });
});

app.post('/api/creator/items/:id/unpublish', authMiddleware, (req, res) => {
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Не найден' });
  if (item.authorId !== req.userId && !isAdminReq(req)) return res.status(403).json({ message: 'Нет прав' });
  item.status = 'draft';
  saveDb();
  res.json({ item });
});

app.delete('/api/creator/items/:id', authMiddleware, (req, res) => {
  const idx = (db.customItems || []).findIndex(i => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'Не найден' });
  const item = db.customItems[idx];
  if (item.authorId !== req.userId && !isAdminReq(req)) return res.status(403).json({ message: 'Нет прав' });
  if (item.status === 'published' && !isAdminReq(req)) return res.status(400).json({ message: 'Сначала снимите с публикации.' });
  db.customItems.splice(idx, 1);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/creator/items/:id/hide', authMiddleware, (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'Только админ' });
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Не найден' });
  item.status = 'hidden'; item.hiddenAt = Date.now();
  saveDb();
  res.json({ item });
});
app.post('/api/creator/items/:id/restore', authMiddleware, (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'Только админ' });
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Не найден' });
  item.status = 'published';
  saveDb();
  res.json({ item });
});

// Публичный список опубликованных кастомных предметов
app.get('/api/shop/custom', (req, res) => {
  const items = (db.customItems || [])
    .filter(i => i.status === 'published')
    .map(i => {
      const author = db.users.find(u => u.id === i.authorId);
      return {
        id: i.id, category: i.category,
        name: i.name, description: i.description,
        price: i.price, spec: i.spec,
        author: author ? { id: author.id, username: author.username, avatar: author.avatar } : null,
        salesCount: i.salesCount || 0, publishedAt: i.publishedAt,
      };
    });
  res.json({ items });
});




// ─── CHATS routes ─────────────────────────────────────────────────────────────

// GET /api/chats
app.get('/api/chats', authMiddleware, (req, res) => {
  const myMemberships = db.chatMembers.filter(m => m.userId === req.userId);
  const chats = myMemberships.map(m => {
    const chat = db.chats.find(c => c.id === m.chatId);
    if (!chat) return null;
    // Возвращаем members в формате ChatMember (с role и вложенным user)
    const members = db.chatMembers
      .filter(cm => cm.chatId === chat.id)
      .map(cm => ({
        id: cm.id,
        chatId: cm.chatId,
        userId: cm.userId,
        role: cm.role || 'member', permissions: cm.permissions, adminTitle: cm.adminTitle, promotedBy: cm.promotedBy,
        joinedAt: cm.joinedAt,
        isMuted: cm.muted || false,
        user: db.users.find(u => u.id === cm.userId) || null,
      }));
    const lastMsg = db.messages
      .filter(msg => msg.chatId === chat.id && (chat.type !== 'channel' || !msg.replyToId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
    const unreadCount = db.messages.filter(msg =>
      msg.chatId === chat.id && !msg.readBy?.includes(req.userId) && msg.senderId !== req.userId
    ).length;
    return { ...chat, pinnedMessage: getPinnedMessage(chat), type: chat.type || 'direct', members, lastMessage: lastMsg, unreadCount };
  }).filter(Boolean);

  chats.sort((a, b) => {
    // 1) закреплённые выше
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    // 2) с непрочитанными — выше прочитанных
    const au = (a.unreadCount || 0) > 0 ? 1 : 0;
    const bu = (b.unreadCount || 0) > 0 ? 1 : 0;
    if (au !== bu) return bu - au;
    // 3) чем новее входящее — тем выше
    const ta = a.lastMessage?.createdAt || a.createdAt;
    const tb = b.lastMessage?.createdAt || b.createdAt;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
  res.json(chats);
});

// POST /api/chats/direct
app.post('/api/chats/direct', authMiddleware, (req, res) => {
  const { targetUserId } = req.body;
  const targetUser = db.users.find(u => u.id === targetUserId);
  if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });

  // Check if direct chat already exists
  const myChats = db.chatMembers.filter(m => m.userId === req.userId).map(m => m.chatId);
  const targetChats = db.chatMembers.filter(m => m.userId === targetUserId).map(m => m.chatId);
  const commonChats = myChats.filter(id => targetChats.includes(id));
  const existing = commonChats.find(id => {
    const chat = db.chats.find(c => c.id === id);
    return chat && chat.type === 'direct';
  });
  if (existing) {
    const chat = db.chats.find(c => c.id === existing);
    const members = db.chatMembers.filter(m => m.chatId === existing).map(m => ({
      id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'member', permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
      joinedAt: m.joinedAt, isMuted: m.muted || false,
      user: db.users.find(u => u.id === m.userId) || null,
    }));
    return res.json({ ...chat, type: chat.type || 'direct', members });
  }

  const chat = {
    id: uuidv4(),
    type: 'direct',
    name: null,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    pinnedMessageId: null,
  };
  db.chats.push(chat);
  db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: req.userId, role: 'member', joinedAt: new Date().toISOString() });
  db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: targetUserId, role: 'member', joinedAt: new Date().toISOString() });
  saveDb();

  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'member', permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
    joinedAt: m.joinedAt, isMuted: false,
    user: db.users.find(u => u.id === m.userId) || null,
  }));
  res.json({ ...chat, members });
});

// POST /api/chats/group
app.post('/api/chats/group', authMiddleware, (req, res) => {
  const { name, memberIds } = req.body;
  const chat = {
    id: uuidv4(),
    type: String(name || '').trim().startsWith('!') ? 'channel' : 'group',
    name: String(name || 'Группа').trim(),
    ownerId: req.userId,
    isPublic: String(name || '').trim().startsWith('!'),
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    pinnedMessageId: null,
  };
  db.chats.push(chat);
  const allMembers = [req.userId, ...(memberIds || [])].filter((v, i, a) => a.indexOf(v) === i);
  for (const uid of allMembers) {
    // Создатель получает роль 'owner', остальные — 'member'
    db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: uid, role: uid === req.userId ? 'owner' : 'member', joinedAt: new Date().toISOString() });
  }
  saveDb();
  // Возвращаем members с ролями (формат ChatMember)
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role, permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
    joinedAt: m.joinedAt,
    user: db.users.find(u => u.id === m.userId) || null,
  }));
  res.json({ ...chat, members });
});

// POST /api/chats/channel
app.post('/api/chats/channel', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  const chat = {
    id: uuidv4(),
    type: 'channel',
    name: '!' + String(name || 'Канал').trim().replace(/^!+/, ''),
    ownerId: req.userId,
    isPublic: true,
    description: description || '',
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    pinnedMessageId: null,
  };
  db.chats.push(chat);
  db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: req.userId, role: 'owner', joinedAt: new Date().toISOString() });
  saveDb();
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'owner',
    joinedAt: m.joinedAt, isMuted: false,
    user: db.users.find(u => u.id === m.userId) || null,
  }));
  res.json({ ...chat, members });
});

// PATCH /api/chats/:id/archive
app.patch('/api/chats/:id/archive', authMiddleware, (req, res) => {
  const member = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа' });
  member.archived = req.body.archived !== false;
  saveDb();
  res.json({ success: true, archived: member.archived });
});

// PATCH /api/chats/:id/pin
app.patch('/api/chats/:id/pin', authMiddleware, (req, res) => {
  const member = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа' });
  member.pinned = req.body.pinned !== false;
  saveDb();
  res.json({ success: true, pinned: member.pinned });
});

// PATCH /api/chats/:id/mute
app.patch('/api/chats/:id/mute', authMiddleware, (req, res) => {
  const member = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа' });
  member.muted = req.body.muted !== false;
  saveDb();
  res.json({ success: true, muted: member.muted });
});

// GET /api/chats/:id
app.get('/api/channels/search', authMiddleware, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q.startsWith('!') || q.length < 2) return res.json([]);
  res.json(db.chats.filter(c => c.type === 'channel' && c.isPublic && c.name.toLowerCase().includes(q))
    .slice(0, 30).map(c => ({ id: c.id, name: c.name, avatarUrl: c.avatarUrl, description: c.description })));
});

app.post('/api/channels/:id/join', authMiddleware, (req, res) => {
  const chat = db.chats.find(c => c.id === req.params.id && c.type === 'channel' && c.isPublic);
  if (!chat) return res.status(404).json({ message: 'Канал не найден' });
  if (!db.chatMembers.some(m => m.chatId === chat.id && m.userId === req.userId)) {
    db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: req.userId, role: 'member', joinedAt: new Date().toISOString() });
    saveDb();
  }
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({ ...m, user: db.users.find(u => u.id === m.userId) }));
  io.to(`chat:${chat.id}`).emit('chat:updated', { ...chat, members });
  res.json({ ...chat, members });
});

app.get('/api/chats/:id', authMiddleware, (req, res) => {
  const isMember = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!isMember) return res.status(403).json({ message: 'Нет доступа' });
  const chat = db.chats.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ message: 'Чат не найден' });
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'member', permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
    joinedAt: m.joinedAt, isMuted: m.muted || false,
    user: db.users.find(u => u.id === m.userId) || null,
  }));
  const lastMsg = db.messages
    .filter(msg => msg.chatId === chat.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  const unreadCount = db.messages.filter(msg =>
    msg.chatId === chat.id && !msg.readBy?.includes(req.userId) && msg.senderId !== req.userId
  ).length;
  res.json({ ...chat, type: chat.type || 'direct', members, lastMessage: lastMsg, unreadCount });
});

const ADMIN_RIGHTS = ['changeInfo', 'inviteMembers', 'deleteMessages', 'editMessages', 'manageAdmins'];
function hasGroupRight(member, right) {
  return !!member && (member.role === 'owner' || (member.role === 'admin' &&
    (member.permissions ? member.permissions[right] === true : true)));
}

app.patch('/api/chats/:id/members/:userId/admin', authMiddleware, (req, res) => {
  const chat = db.chats.find(c => c.id === req.params.id);
  if (!chat || !['group', 'channel'].includes(chat.type)) return res.status(404).json({ message: 'Группа не найдена' });
  const actor = db.chatMembers.find(m => m.chatId === chat.id && m.userId === req.userId);
  const target = db.chatMembers.find(m => m.chatId === chat.id && m.userId === req.params.userId);
  if (!hasGroupRight(actor, 'manageAdmins')) return res.status(403).json({ message: 'Нет права назначать администраторов' });
  if (!target) return res.status(404).json({ message: 'Участник не найден' });
  if (target.role === 'owner' || target.userId === req.userId ||
      (actor.role !== 'owner' && target.role === 'admin' && target.promotedBy !== req.userId)) {
    return res.status(403).json({ message: 'Нельзя изменять этого администратора' });
  }
  const { role, permissions, adminTitle } = req.body;
  if (!['admin', 'member'].includes(role) || typeof adminTitle !== 'string' || adminTitle.trim().length > 32 ||
      !permissions || typeof permissions !== 'object' || Array.isArray(permissions) ||
      Object.entries(permissions).some(([key, value]) => !ADMIN_RIGHTS.includes(key) || typeof value !== 'boolean')) {
    return res.status(400).json({ message: 'Некорректные права или звание (до 32 символов)' });
  }
  if (actor.role !== 'owner' && ADMIN_RIGHTS.some(right =>
    (permissions[right] || (target.role === 'admin' && hasGroupRight(target, right))) && !hasGroupRight(actor, right))) {
    return res.status(403).json({ message: 'Нельзя управлять правами выше собственных' });
  }
  target.role = role;
  target.permissions = Object.fromEntries(ADMIN_RIGHTS.map(right => [right, role === 'admin' && permissions[right] === true]));
  target.adminTitle = role === 'admin' ? adminTitle.trim() : '';
  target.promotedBy = role === 'admin' ? (target.promotedBy || req.userId) : null;
  saveDb();
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({ ...m, user: db.users.find(u => u.id === m.userId) || null }));
  io.to(`chat:${chat.id}`).emit('chat:updated', { ...chat, members });
  res.json({ ...chat, members });
});

// PATCH /api/chats/:id
function channelOwnedSkinIds(chat) {
  const ownerId = chat.ownerId || db.chatMembers.find(m => m.chatId === chat.id && m.role === 'owner')?.userId;
  const owner = db.users.find(u => u.id === ownerId);
  return owner ? accountOwnedSkinIds(owner) : new Set();
}

app.get('/api/chats/:id/skins', authMiddleware, (req, res) => {
  const chat = db.chats.find(c => c.id === req.params.id && c.type === 'channel');
  if (!chat) return res.status(404).json({ message: 'Канал не найден' });
  const member = db.chatMembers.find(m => m.chatId === chat.id && m.userId === req.userId);
  if (!hasGroupRight(member, 'changeInfo')) return res.status(403).json({ message: 'Нет права изменять оформление канала' });
  res.json([...channelOwnedSkinIds(chat)]);
});

app.patch('/api/chats/:id', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа к чату' });
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Чат не найден' });

  // Для групп/каналов — только admin/owner могут редактировать
  if ((chat.type === 'group' || chat.type === 'channel') && !hasGroupRight(member, 'changeInfo')) {
    return res.status(403).json({ message: 'Только администраторы могут редактировать группу' });
  }

  const { name, description, avatarUrl, wallpaper } = req.body;
  for (const key of ['activeRing', 'activeSelfCard', 'activeBubble']) {
    if (req.body[key] === undefined) continue;
    const value = req.body[key];
    if (chat.type !== 'channel' || typeof value !== 'string' ||
        (value && !channelOwnedSkinIds(chat).has(value))) {
      return res.status(400).json({ message: 'Выберите скин из инвентаря создателя канала' });
    }
  }
  for (const key of ['activeRing', 'activeSelfCard', 'activeBubble']) {
    if (req.body[key] !== undefined) chat[key] = req.body[key];
  }
  if (name !== undefined) chat.name = chat.type === 'channel' ? '!' + String(name).trim().replace(/^!+/, '') : name;
  if (description !== undefined) chat.description = description;
  if (avatarUrl !== undefined) chat.avatarUrl = avatarUrl;
  if (wallpaper !== undefined) {
    if (wallpaper === null) chat.wallpaper = null;
    else if (wallpaper && ['photo', 'live', 'stock'].includes(wallpaper.type) && typeof wallpaper.value === 'string') chat.wallpaper = wallpaper;
    else return res.status(400).json({ message: 'Некорректная обложка чата' });
  }
  saveDb();

  // Возвращаем с members (в формате ChatMember с role)
  const members = db.chatMembers.filter(m => m.chatId === chatId).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role, permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
    joinedAt: m.joinedAt,
    user: db.users.find(u => u.id === m.userId) || null,
  }));
  io.to(`chat:${chatId}`).emit('chat:updated', { ...chat, members });
  res.json({ ...chat, members });
});

// DELETE /api/chats/:id/leave  (покинуть чат)
app.delete('/api/chats/:id/leave', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const idx = db.chatMembers.findIndex(m => m.chatId === chatId && m.userId === req.userId);
  if (idx === -1) return res.status(404).json({ message: 'Вы не являетесь участником этого чата' });
  db.chatMembers.splice(idx, 1);
  saveDb();
  // Уведомляем остальных участников
  io.to(`chat:${chatId}`).emit('chat:member_left', { chatId, userId: req.userId });
  res.json({ success: true });
});

// POST /api/chats/:id/members  (добавить участника — любой участник группы)
app.post('/api/chats/:id/members', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const requesterMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!requesterMember) {
    return res.status(403).json({ message: 'Вы не являетесь участником этого чата' });
  }
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Чат не найден' });
  // В группах — любой участник может добавлять других
  // В direct/saved чатах — нельзя добавлять участников
  if (chat.type === 'direct' || chat.type === 'saved') {
    return res.status(403).json({ message: 'Нельзя добавлять участников в этот тип чата' });
  }
  const { userId } = req.body;
  if (!hasGroupRight(requesterMember, 'inviteMembers')) return res.status(403).json({ message: 'Нет права приглашать участников' });
  if (!userId) return res.status(400).json({ message: 'Укажите userId' });
  const targetUser = db.users.find(u => u.id === userId);
  if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });
  const exists = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
  if (exists) {
    // Уже в чате — вернём данные
    const user = db.users.find(u => u.id === exists.userId) || null;
    return res.json({ ...exists, user });
  }
  const newMember = { id: uuidv4(), chatId, userId, role: 'member', joinedAt: new Date().toISOString() };
  db.chatMembers.push(newMember);
  saveDb();
  // Уведомляем всех в чате
  io.to(`chat:${chatId}`).emit('chat:member_joined', { chatId, member: { ...newMember, user: targetUser } });
  // Добавленный участник теперь тоже джойнится в комнату
  const targetSockets = userSockets.get(userId);
  if (targetSockets) targetSockets.forEach(sid => io.to(sid).socketsJoin(`chat:${chatId}`));
  res.json({ ...newMember, user: targetUser });
});


// ─── Приглашения в группы (через личный чат) ──────────────────────────────────
function ensureDirectChat(a, b) {
  const myChats = db.chatMembers.filter((m) => m.userId === a).map((m) => m.chatId);
  const targetChats = db.chatMembers.filter((m) => m.userId === b).map((m) => m.chatId);
  const common = myChats.filter((id) => targetChats.includes(id));
  const existing = common.find((id) => {
    const chat = db.chats.find((c) => c.id === id);
    return chat && chat.type === 'direct';
  });
  if (existing) return db.chats.find((c) => c.id === existing);
  const chat = {
    id: uuidv4(), type: 'direct', name: null, avatarUrl: null,
    createdAt: new Date().toISOString(), pinnedMessageId: null,
  };
  db.chats.push(chat);
  db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: a, role: 'member', joinedAt: new Date().toISOString() });
  db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: b, role: 'member', joinedAt: new Date().toISOString() });
  return chat;
}

function inviteUserName(u) {
  if (!u) return 'Пользователь';
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id;
}

function findInviteMessageByToken(token) {
  for (const m of db.messages) {
    const att = (m.attachments || []).find((a) => a.mimeType === 'application/x-vera-group-invite');
    if (!att) continue;
    try {
      const data = typeof att.data === 'string' ? JSON.parse(att.data) : att.data;
      if (data && data.token === token) return { message: m, attachment: att, data };
    } catch {}
  }
  return null;
}

// POST /api/chats/:id/invite — отправить приглашение в группу в личный чат
app.post('/api/chats/:id/invite', authMiddleware, (req, res) => {
  const groupId = req.params.id;
  const { userId: inviteeId } = req.body;
  if (!inviteeId) return res.status(400).json({ message: 'Укажите userId' });
  if (inviteeId === req.userId) return res.status(400).json({ message: 'Нельзя пригласить себя' });
  const group = db.chats.find((c) => c.id === groupId);
  if (!group || (group.type !== 'group' && group.type !== 'channel')) {
    return res.status(404).json({ message: 'Группа не найдена' });
  }
  const inviterMember = db.chatMembers.find((m) => m.chatId === groupId && m.userId === req.userId);
  if (!inviterMember) return res.status(403).json({ message: 'Вы не участник группы' });
  if (!hasGroupRight(inviterMember, 'inviteMembers')) return res.status(403).json({ message: 'Нет права приглашать участников' });
  const inviter = db.users.find((u) => u.id === req.userId);
  const invitee = db.users.find((u) => u.id === inviteeId);
  if (!invitee) return res.status(404).json({ message: 'Пользователь не найден' });
  if (db.chatMembers.some((m) => m.chatId === groupId && m.userId === inviteeId)) {
    return res.status(400).json({ message: 'Пользователь уже в группе' });
  }

  const direct = ensureDirectChat(req.userId, inviteeId);
  const payload = {
    type: 'vera-group-invite',
    token: uuidv4(),
    groupId,
    groupName: group.name || 'Группа',
    inviterId: req.userId,
    inviterName: inviteUserName(inviter),
    inviteeId,
    state: 'pending',
  };

  const existingInvite = db.messages.find((m) => {
    if (m.chatId !== direct.id) return false;
    const att = (m.attachments || []).find((a) => a.mimeType === 'application/x-vera-group-invite');
    if (!att) return false;
    try {
      const d = typeof att.data === 'string' ? JSON.parse(att.data) : att.data;
      return d && d.groupId === groupId && d.state === 'pending';
    } catch { return false; }
  });
  if (existingInvite) return res.json({ alreadyPending: true });
  const message = {
    id: uuidv4(), chatId: direct.id, senderId: req.userId,
    text: 'Приглашение в группу «' + (group.name || 'Группа') + '»',
    content: 'Приглашение в группу «' + (group.name || 'Группа') + '»',
    replyToId: null,
    attachments: [{
      id: uuidv4(), fileUrl: '', fileName: '', fileSize: 0,
      mimeType: 'application/x-vera-group-invite',
      data: JSON.stringify(payload),
    }],
    type: 'system',
    readBy: [req.userId],
    editedAt: null, isEdited: false, isPinned: false, isDeleted: false,
    createdAt: new Date().toISOString(),
  };
  db.messages.push(message);
  saveDb();
  const sender = db.users.find((u) => u.id === req.userId) || null;
  const result = { ...message, sender };
  io.to('chat:' + direct.id).emit('message:new', result);
  const targetSockets = userSockets.get(inviteeId);
  if (targetSockets) targetSockets.forEach((sid) => io.to(sid).socketsJoin('chat:' + direct.id));
  return res.status(201).json(result);
});

// POST /api/group-invites/:token/accept
app.post('/api/group-invites/:token/accept', authMiddleware, (req, res) => {
  const found = findInviteMessageByToken(req.params.token);
  if (!found) return res.status(404).json({ message: 'Приглашение не найдено' });
  const { message: msg, attachment, data } = found;
  if (data.inviteeId !== req.userId) return res.status(403).json({ message: 'Приглашение адресовано другому' });
  const group = db.chats.find((c) => c.id === data.groupId);
  if (!group) return res.status(404).json({ message: 'Группа не найдена' });
  data.state = 'accepted';
  attachment.data = JSON.stringify(data);
  if (!db.chatMembers.some((m) => m.chatId === data.groupId && m.userId === req.userId)) {
    db.chatMembers.push({ id: uuidv4(), chatId: data.groupId, userId: req.userId, role: 'member', joinedAt: new Date().toISOString() });
    const joiner = db.users.find((u) => u.id === req.userId) || null;
    const joinMsg = {
      id: uuidv4(), chatId: data.groupId, senderId: req.userId,
      text: inviteUserName(joiner) + ' присоединился(ась) к группе',
      content: inviteUserName(joiner) + ' присоединился(ась) к группе',
      replyToId: null, attachments: [], type: 'system', readBy: [req.userId],
      editedAt: null, isEdited: false, isPinned: false, isDeleted: false,
      createdAt: new Date().toISOString(),
    };
    db.messages.push(joinMsg);
    const ts = userSockets.get(req.userId);
    if (ts) ts.forEach((sid) => io.to(sid).socketsJoin('chat:' + data.groupId));
    const members = db.chatMembers.filter((m) => m.chatId === data.groupId).map((m) => ({
      id: m.id, chatId: m.chatId, userId: m.userId, role: m.role, permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy, joinedAt: m.joinedAt,
      isMuted: m.muted || false, user: db.users.find((u) => u.id === m.userId) || null,
    }));
    io.to('chat:' + data.groupId).emit('chat:updated', { ...group, members });
    io.to('chat:' + data.groupId).emit('message:new', { ...joinMsg, sender: joiner });
  }
  saveDb();
  const sender = db.users.find((u) => u.id === msg.senderId) || null;
  io.to('chat:' + msg.chatId).emit('message:edited', { ...msg, sender });
  res.json({ success: true, chatId: data.groupId });
});

// POST /api/group-invites/:token/decline
app.post('/api/group-invites/:token/decline', authMiddleware, (req, res) => {
  const found = findInviteMessageByToken(req.params.token);
  if (!found) return res.status(404).json({ message: 'Приглашение не найдено' });
  const { message: msg, attachment, data } = found;
  if (data.inviteeId !== req.userId) return res.status(403).json({ message: 'Приглашение адресовано другому' });
  data.state = 'declined';
  attachment.data = JSON.stringify(data);
  saveDb();
  const sender = db.users.find((u) => u.id === msg.senderId) || null;
  io.to('chat:' + msg.chatId).emit('message:edited', { ...msg, sender });
  res.json({ success: true });
});


// POST /api/messages/:chatId/reaction  (добавить/убрать реакцию)
app.post('/api/messages/:chatId/reaction', authMiddleware, (req, res) => {
  const { messageId, emoji } = req.body;
  const msg = db.messages.find(m => m.id === messageId && m.chatId === req.params.chatId);
  if (!msg) return res.status(404).json({ message: 'Сообщение не найдено' });

  if (!msg.reactions) msg.reactions = [];
  const rIdx = msg.reactions.findIndex(r => r.emoji === emoji);
  if (rIdx >= 0) {
    const r = msg.reactions[rIdx];
    if (r.userIds.includes(req.userId)) {
      // Убрать реакцию
      r.userIds = r.userIds.filter(id => id !== req.userId);
      r.count = r.userIds.length;
      if (r.count === 0) msg.reactions.splice(rIdx, 1);
    } else {
      // Добавить
      r.userIds.push(req.userId);
      r.count = r.userIds.length;
    }
  } else {
    msg.reactions.push({ emoji, count: 1, userIds: [req.userId] });
  }
  saveDb();

  // Уведомляем всех в комнате
  io.to(`chat:${msg.chatId}`).emit('message:reaction', {
    messageId: msg.id,
    chatId: msg.chatId,
    reactions: msg.reactions,
  });
  res.json({ reactions: msg.reactions });
});

// DELETE /api/chats/:id  (удалить чат — только owner/admin. Обычный участник → /leave)
app.delete('/api/chats/:id', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа к чату' });
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Чат не найден' });
  // Direct/saved — удалять может любой участник (это их личный чат).
  // Group/channel — только owner/admin.
  const isDirect = chat.type === 'direct' || chat.type === 'saved' || chat.type === 'private';
  if (!isDirect && member.role !== 'owner') {
    return res.status(403).json({ message: 'Удалять чат может только владелец. Используйте «Покинуть чат».' });
  }

  const chatIdx = db.chats.findIndex(c => c.id === chatId);
  if (chatIdx === -1) return res.status(404).json({ message: 'Чат не найден' });

  const chatMessages = db.messages.filter(m => m.chatId === chatId);
  const removedMessages = chatMessages.length;
  const removedMembers  = db.chatMembers.filter(m => m.chatId === chatId).length;

  moderation.archive(db, chatMessages, req.userId, { uploadsDir: UPLOADS_DIR });
  db.messages    = db.messages.filter(m => m.chatId !== chatId);
  db.chatMembers = db.chatMembers.filter(m => m.chatId !== chatId);
  if (db.favorites) db.favorites = db.favorites.filter(f => f.chatId !== chatId);
  db.chats.splice(chatIdx, 1);
  saveDb();

  // Уведомляем всех участников через сокет
  io.to(`chat:${chatId}`).emit('chat:deleted', { chatId });

  res.json({ success: true, message: `Чат удалён`, removedMessages, removedMembers });
});

// ─── MESSAGES routes ──────────────────────────────────────────────────────────
// SEC: лимиты содержимого — используются в POST/PUT/WS.
const MESSAGE_MAX_LEN = 10000;
const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

function getPinnedMessage(chat) {
  const msg = db.messages.find(m => m.chatId === chat.id && m.id === chat.pinnedMessageId && !m.isDeleted);
  return msg ? { ...msg, content: msg.text || msg.content || '', isPinned: true } : null;
}

app.post('/api/messages/:id/pin', authMiddleware, (req, res) => {
  const { chatId, messageId } = req.body || {};
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ code: 'CHAT_ACCESS_DENIED', message: 'Нет доступа к чату. Закрепление доступно только его участникам.' });
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Чат не найден' });
  if (messageId !== null) {
    if (typeof messageId !== 'string' || !messageId) {
      return res.status(400).json({ code: 'INVALID_MESSAGE_ID', message: 'Не указано сообщение для закрепления' });
    }
    if (!db.messages.some(m => m.id === messageId && m.chatId === chatId && !m.isDeleted)) {
      return res.status(404).json({
        code: 'PIN_MESSAGE_UNAVAILABLE',
        message: 'Нельзя закрепить: сообщение отсутствует на сервере в этом чате. Если оно видно в истории, это может быть локальная архивная копия. Можно отправить его содержимое новым сообщением и закрепить новое.',
      });
    }
  }
  chat.pinnedMessageId = messageId;
  saveDb();
  const pinnedMessage = getPinnedMessage(chat);
  io.to(`chat:${chatId}`).emit('message:pinned', { chatId, messageId, pinnedMessage });
  res.json(pinnedMessage);
});

// GET /api/messages/:chatId
app.get('/api/messages/:chatId/comments/:postId', authMiddleware, (req, res) => {
  const { chatId, postId } = req.params;
  if (!db.chatMembers.some(m => m.chatId === chatId && m.userId === req.userId)) return res.status(403).json({ message: 'Нет доступа' });
  res.json(db.messages.filter(m => m.chatId === chatId && m.replyToId === postId && !m.isDeleted)
    .map(m => ({ ...m, sender: messageSender(m) })));
});

app.get('/api/messages/:chatId', authMiddleware, (req, res) => {
  const isMember = db.chatMembers.find(m => m.chatId === req.params.chatId && m.userId === req.userId);
  if (!isMember) return res.status(403).json({ message: 'Нет доступа' });

  const { limit = 50, before } = req.query;
  let msgs = db.messages.filter(m => m.chatId === req.params.chatId);
  if (db.chats.some(c => c.id === req.params.chatId && c.type === 'channel')) msgs = msgs.filter(m => !m.replyToId);
  if (before) msgs = msgs.filter(m => new Date(m.createdAt) < new Date(before));
  msgs = msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-parseInt(limit));

  // Normalize fields for client (text→content, url→fileUrl)
  const result = msgs.map(m => {
    const sender = messageSender(m);
    const attachments = (m.attachments || []).map(a => ({
      id: a.id || m.id,
      fileUrl: a.url || a.fileUrl || '',
      fileName: a.originalName || a.fileName || '',
      fileSize: a.size || a.fileSize || 0,
      mimeType: a.mimeType || '',
      data: a.data || null,
    }));
    return {
      ...m,
      content: m.text || m.content || '',
      attachments,
      sender,
      isEdited: !!(m.editedAt),
      isPinned: db.chats.find(c => c.id === m.chatId)?.pinnedMessageId === m.id,
      isDeleted: false,
      type: m.type || (attachments.length > 0 ? 'document' : 'text'),
    };
  });
  res.json(result);
});

// Общий обработчик отправки сообщения
function messageSender(message) {
  const chat = db.chats.find(c => c.id === message.chatId);
  if (chat?.type === 'channel' && !message.replyToId) {
    return { id: chat.id, firstName: chat.name, username: chat.name, avatarUrl: chat.avatarUrl,
      activeRing: chat.activeRing, activeSelfCard: chat.activeSelfCard, activeBubble: chat.activeBubble };
  }
  return db.users.find(u => u.id === message.senderId) || null;
}

function handleSendMessage(chatId, userId, body, res) {
  const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
  if (!isMember) return res.status(403).json({ message: 'Нет доступа' });

  let { text, content, replyToId, attachments, type, commentReplyToId, poll, forwardFromId } = body;
  if (forwardFromId != null && replyToId) return res.status(400).json({ message: 'Пересылка не может быть ответом' });
  const chat = db.chats.find(c => c.id === chatId);
  if (chat?.type === 'channel') {
    if (replyToId) {
      const post = db.messages.find(m => m.id === replyToId && m.chatId === chatId && !m.replyToId && !m.isDeleted);
      if (!post) return res.status(400).json({ message: 'Публикация не найдена' });
      if (commentReplyToId && !db.messages.some(m => m.id === commentReplyToId && m.chatId === chatId && m.replyToId === post.id && !m.isDeleted)) {
        return res.status(400).json({ message: 'Комментарий для ответа не найден' });
      }
    } else if (!['owner', 'admin'].includes(isMember.role)) {
      return res.status(403).json({ message: 'Публиковать могут только администраторы канала' });
    }
  }
  let forwardedMessage = null;
  let forwardedMessageName = null;
  if (forwardFromId !== undefined && forwardFromId !== null) {
    if (typeof forwardFromId !== 'string' || !forwardFromId.trim()) {
      return res.status(400).json({ message: 'Некорректный источник пересылки' });
    }
    forwardedMessage = db.messages.find(m => m.id === forwardFromId && !m.isDeleted);
    if (!forwardedMessage) return res.status(404).json({ message: 'Исходное сообщение не найдено' });
    const sourceMember = db.chatMembers.find(m => m.chatId === forwardedMessage.chatId && m.userId === userId);
    if (!sourceMember) return res.status(403).json({ message: 'Нет доступа к исходному сообщению' });
    const sourceChat = db.chats.find(c => c.id === forwardedMessage.chatId);
    const sourceSender = messageSender(forwardedMessage);
    forwardedMessageName = sourceChat?.type === 'channel'
      ? sourceChat.name
      : [sourceSender?.firstName, sourceSender?.lastName].filter(Boolean).join(' ') || sourceSender?.username || 'Пользователь';
    content = forwardedMessage.content ?? forwardedMessage.text ?? '';
    text = content;
    attachments = forwardedMessage.attachments || [];
    type = forwardedMessage.type;
    replyToId = undefined;
    poll = undefined;
    // A forwarded poll is a readable snapshot, not a new vote in another chat.
    if (forwardedMessage.poll) {
      content = [forwardedMessage.poll.question, ...forwardedMessage.poll.options.map(o => `• ${o.text}`)].join('\n');
      type = 'text';
    }
  }
  const clientTempId = typeof body.clientTempId === 'string' ? body.clientTempId.slice(0, 160) : null;
  const existing = clientTempId && db.messages.find(m => m.chatId === chatId && (m.authorId || m.senderId) === userId && m.clientTempId === clientTempId);
  if (existing) return res.json({ ...existing, sender: messageSender(existing) });
  const msgContent = String(content || text || '');
  if (msgContent.length > MESSAGE_MAX_LEN) {
    return res.status(400).json({ message: 'Сообщение слишком длинное' });
  }
  if (!msgContent && (!attachments || attachments.length === 0)) {
    if (!poll) return res.status(400).json({ message: 'Пустое сообщение' });
  }
  if (type === 'poll' && !poll) return res.status(400).json({ message: 'Укажите данные опроса' });
  if (poll) {
    if (chat?.type !== 'channel' || replyToId || !['owner', 'admin'].includes(isMember.role)) {
      return res.status(403).json({ message: 'Опросы могут создавать только администраторы канала' });
    }
    if (typeof poll.question !== 'string' || !poll.question.trim() || !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 10) {
      return res.status(400).json({ message: 'Опрос должен содержать вопрос и от 2 до 10 вариантов' });
    }
    if (poll.question.trim().length > 500 || (poll.multiple !== undefined && typeof poll.multiple !== 'boolean') ||
        poll.options.some(o => !o || typeof o.text !== 'string' || !o.text.trim() || o.text.trim().length > 200) ||
        new Set(poll.options.map((o, i) => String(o.id || i + 1))).size !== poll.options.length) {
      return res.status(400).json({ message: 'Некорректные варианты опроса' });
    }
  }
  // SEC: не даём клиенту прицепить >20 файлов одним сообщением.
  // Для пересылки берём вложения из исходного сообщения на сервере. Клиенту
  // не нужно повторно загружать файл, а подмена чужого URL невозможна.
  const attachmentsToStore = forwardedMessage
    ? forwardedMessage.attachments
    : attachments;
  const safeAttachments = Array.isArray(attachmentsToStore) ? attachmentsToStore.slice(0, 20) : [];

  const normAttachments = safeAttachments.map(a => ({
    id: a.id || uuidv4(),
    fileUrl: a.url || a.fileUrl || '',
    fileName: a.originalName || a.fileName || '',
    fileSize: a.size || a.fileSize || 0,
    mimeType: a.mimeType || '',
    data: a.data || null,
  }));

  const message = {
    id: uuidv4(),
    chatId,
    senderId: userId,
    text: msgContent,
    content: msgContent,
    replyToId: replyToId || null,
    ...(chat?.type === 'channel' && replyToId && commentReplyToId ? { commentReplyToId } : {}),
    clientTempId,
    ...(forwardedMessage ? { forwardFromId: forwardedMessage.id, forwardFromName: forwardedMessageName } : {}),
    ...(chat?.type === 'channel' && !replyToId ? { senderId: chatId, authorId: userId } : {}),
    attachments: normAttachments,
    type: type || (normAttachments.length > 0 ? 'document' : 'text'),
    ...(poll ? { type: 'poll', poll: { question: poll.question.trim().slice(0, 500), multiple: Boolean(poll.multiple), options: poll.options.map((option, index) => ({ id: String(option.id || index + 1), text: String(option.text || '').trim().slice(0, 200), votes: 0, voterIds: [] })).filter(option => option.text).slice(0, 10) } } : {}),
    readBy: [userId],
    editedAt: null,
    isEdited: false,
    isPinned: false,
    isDeleted: false,
    createdAt: new Date().toISOString(),
  };
  db.messages.push(message);
  try { saveDb(); } catch {
    db.messages = db.messages.filter(m => m !== message);
    return res.status(500).json({ message: 'Не удалось сохранить сообщение' });
  }

  const sender = messageSender(message);
  const result = { ...message, sender };

  io.to(`chat:${chatId}`).emit('message:new', result);
  res.status(201).json(result);
}

// POST /api/messages/:chatId  (base route)
app.post('/api/messages/:chatId', authMiddleware, (req, res) => {
  handleSendMessage(req.params.chatId, req.userId, req.body, res);
});

// POST /api/messages/:chatId/send  (route used by client)
app.post('/api/messages/:chatId/send', authMiddleware, (req, res) => {
  handleSendMessage(req.params.chatId, req.userId, req.body, res);
});

// POST /api/messages/:id/poll-vote — голосование в опросе канала.
app.post('/api/messages/:id/poll-vote', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id && !m.isDeleted);
  if (!msg || msg.type !== 'poll' || !msg.poll) return res.status(404).json({ message: 'Опрос не найден' });
  const member = db.chatMembers.find(m => m.chatId === msg.chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа' });
  if (!db.chats.some(c => c.id === msg.chatId && c.type === 'channel')) return res.status(400).json({ message: 'Опрос доступен только в канале' });
  const selected = req.body?.optionIds;
  if (!Array.isArray(selected) || selected.length > msg.poll.options.length || new Set(selected).size !== selected.length ||
      selected.some(id => typeof id !== 'string' || !msg.poll.options.some(o => o.id === id))) {
    return res.status(400).json({ message: 'Некорректные варианты ответа' });
  }
  if (!selected.length || (!msg.poll.multiple && selected.length > 1)) return res.status(400).json({ message: 'Выберите вариант ответа' });
  const alreadyVoted = msg.poll.options.some(o => (o.voterIds || []).includes(req.userId));
  if (alreadyVoted) return res.status(409).json({ message: 'Вы уже голосовали' });
  const previousPoll = msg.poll;
  msg.poll = { ...previousPoll, options: previousPoll.options.map(o => ({ ...o, voterIds: [...(o.voterIds || [])] })) };
  selected.forEach(id => {
    const option = msg.poll.options.find(o => o.id === id);
    option.voterIds = option.voterIds || [];
    option.voterIds.push(req.userId);
    option.votes = option.voterIds.length;
  });
  try { saveDb(); } catch { msg.poll = previousPoll; return res.status(500).json({ message: 'Не удалось сохранить голос' }); }
  const result = { ...msg, sender: messageSender(msg) };
  io.to(`chat:${msg.chatId}`).emit('message:edited', result);
  res.json(result);
});


// PUT /api/messages/:id  (edit)
// SEC: только автор, окно 48ч, длина ≤ 4096.
app.put('/api/messages/:id', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ message: 'Не найдено' });
  const member = db.chatMembers.find(m => m.chatId === msg.chatId && m.userId === req.userId);
  const canModerate = hasGroupRight(member, 'editMessages');
  if (!member || (msg.senderId !== req.userId && !canModerate)) return res.status(403).json({ message: 'Нет прав' });
  if (msg.isDeleted) return res.status(400).json({ message: 'Сообщение удалено' });
  const age = Date.now() - new Date(msg.createdAt).getTime();
  if (!canModerate && age > EDIT_WINDOW_MS) return res.status(403).json({ message: 'Окно редактирования истекло' });
  const text = String(req.body?.text ?? '');
  if (text.length > MESSAGE_MAX_LEN) return res.status(400).json({ message: 'Сообщение слишком длинное' });
  msg.text = text;
  msg.content = msg.text;
  msg.editedAt = new Date().toISOString();
  msg.isEdited = true;
  saveDb();
  const sender = messageSender(msg);
  // Нормализуем так же, как в GET /api/messages/:chatId (клиент читает content)
  const result = {
    ...msg,
    content: msg.text,
  };
  result.sender = sender;
  io.to(`chat:${msg.chatId}`).emit('message:edited', result);
  res.json(result);
});

// DELETE /api/messages/:id
app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  const idx = db.messages.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: 'Не найдено' });
  const membership = db.chatMembers.find(m => m.chatId === db.messages[idx].chatId && m.userId === req.userId);
  if (!membership || (db.messages[idx].senderId !== req.userId && !hasGroupRight(membership, 'deleteMessages'))) return res.status(403).json({ message: 'Нет прав' });
  const msg = db.messages[idx];
  moderation.archive(db, [msg], req.userId, { uploadsDir: UPLOADS_DIR });
  db.messages.splice(idx, 1);
  const chat = db.chats.find(c => c.id === msg.chatId);
  if (chat?.pinnedMessageId === msg.id) {
    chat.pinnedMessageId = null;
    io.to(`chat:${msg.chatId}`).emit('message:pinned', { chatId: msg.chatId, messageId: null, pinnedMessage: null });
  }
  if (chat?.type === 'channel' && !msg.replyToId) {
    const comments = db.messages.filter(m => m.chatId === chat.id && m.replyToId === msg.id);
    moderation.archive(db, comments, req.userId, { uploadsDir: UPLOADS_DIR });
    db.messages = db.messages.filter(m => !comments.includes(m));
    comments.forEach(m => io.to(`chat:${chat.id}`).emit('message:deleted', { id: m.id, chatId: chat.id }));
  }
  saveDb();
  io.to(`chat:${msg.chatId}`).emit('message:deleted', { id: msg.id, chatId: msg.chatId });
  res.json({ success: true });
});

// POST /api/messages/:id/read
// Отмечает прочитанными ВСЕ сообщения чата ДО указанного включительно.
// Раньше помечалось только одно сообщение → unreadCount считался неправильно
// и после перезагрузки весь бэклог снова был «непрочитан».
app.post('/api/messages/:id/read', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ message: 'Не найдено' });
  const cutoff = new Date(msg.createdAt).getTime();
  let changed = false;
  for (const m of db.messages) {
    if (m.chatId !== msg.chatId) continue;
    if (new Date(m.createdAt).getTime() > cutoff) continue;
    if (!Array.isArray(m.readBy)) m.readBy = [];
    if (!m.readBy.includes(req.userId)) {
      m.readBy.push(req.userId);
      changed = true;
    }
  }
  if (changed) saveDb();
  io.to(`chat:${msg.chatId}`).emit('message:read', { messageId: msg.id, userId: req.userId });
  res.json({ success: true });
});

// ─── FILES routes ──────────────────────────────────────────────────────────────

// GET /api/call-log — история звонков
app.get('/api/call-log', authMiddleware, (req, res) => {
  const logs = (db.callLogs || []).filter(e => e.userId === req.userId)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 200)
    .map(e => ({
      ...e,
      peer: db.users.find(u => u.id === e.peerId)
        ? { id: e.peerId, name: `${db.users.find(u => u.id === e.peerId).firstName || ''} ${db.users.find(u => u.id === e.peerId).lastName || ''}`.trim() || db.users.find(u => u.id === e.peerId).username }
        : e.peerId,
    }));
  res.json(logs);
});

app.post('/api/files/upload', authMiddleware, uploadFile.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });
  res.json({
    url: `/uploads/files/${req.file.filename}`,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
});

// POST /api/files/upload-base64  — сохранить base64-картинку как файл
app.post('/api/files/upload-base64', authMiddleware, (req, res) => {
  const { data, fileName, mimeType } = req.body;
  if (typeof data !== 'string' || data.length > 8 * 1024 * 1024) {
    return res.status(400).json({ message: 'Некорректные или слишком большие данные' });
  }

  // Принимаем только безопасные растровые изображения. MIME от клиента сам по
  // себе не является доказательством типа файла, поэтому проверяем и сигнатуру.
  const match = data.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return res.status(400).json({ message: 'Разрешены только PNG, JPEG, GIF и WebP' });
  const actualMime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');
  if (!base64 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return res.status(400).json({ message: 'Некорректная base64-строка' });
  }
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length || buf.length > 5 * 1024 * 1024) {
    return res.status(413).json({ message: 'Изображение слишком большое' });
  }
  const isPng = actualMime === 'image/png' && buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpeg = actualMime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  const isGif = actualMime === 'image/gif' && (buf.subarray(0, 6).toString() === 'GIF87a' || buf.subarray(0, 6).toString() === 'GIF89a');
  const isWebp = actualMime === 'image/webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!(isPng || isJpeg || isGif || isWebp)) {
    return res.status(400).json({ message: 'Содержимое файла не соответствует типу изображения' });
  }
  const ext = actualMime === 'image/jpeg' ? 'jpg' : actualMime.split('/')[1];
  const filename = uuidv4() + '.' + ext;
  const subfolder = 'avatars';
  const dest = path.join(UPLOADS_DIR, subfolder, filename);
  fs.writeFileSync(dest, buf);
  res.json({
    url: `/uploads/${subfolder}/${filename}`,
    originalName: fileName || filename,
    size: buf.length,
    mimeType: actualMime,
  });
});

// ─── MUSIC routes ─────────────────────────────────────────────────────────────

// GET /api/music
app.get('/api/music', authMiddleware, (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const tracks = db.tracks.slice().reverse();
  const total = tracks.length;
  const paged = tracks.slice((page - 1) * limit, page * limit);
  const result = paged.map(t => ({ ...t, uploadedBy: db.users.find(u => u.id === t.uploadedById) || null }));
  res.json({ tracks: result, total });
});

// GET /api/music/search?q=...
app.get('/api/music/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = db.tracks.filter(t =>
    t.title.toLowerCase().includes(q) ||
    (t.artist || '').toLowerCase().includes(q) ||
    (t.album || '').toLowerCase().includes(q)
  ).slice(0, 50);
  res.json(results);
});

// GET /api/music/my
app.get('/api/music/my', authMiddleware, (req, res) => {
  const tracks = db.tracks.filter(t => t.uploadedById === req.userId);
  res.json(tracks);
});

// GET /api/music/:id  — получить один трек (для отображения закреплённого трека на профиле).
app.get('/api/music/:id', authMiddleware, (req, res) => {
  const track = db.tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ message: 'Трек не найден' });
  const uploadedBy = db.users.find(u => u.id === track.uploadedById) || null;
  res.json({ ...track, uploadedBy });
});

// POST /api/music/upload
app.post('/api/music/upload', authMiddleware, uploadMusic.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });

  const { title, artist, album, duration } = req.body;
  const track = {
    id: uuidv4(),
    title: title || req.file.originalname.replace(/\.[^.]+$/, ''),
    artist: artist || 'Неизвестный',
    album: album || null,
    duration: duration ? parseInt(duration) : 0,
    fileUrl: `/uploads/music/${req.file.filename}`,
    coverUrl: null,
    uploadedById: req.userId,
    playsCount: 0,
    createdAt: new Date().toISOString(),
  };
  db.tracks.push(track);
  saveDb();

  const uploadedBy = db.users.find(u => u.id === req.userId);
  res.status(201).json({ ...track, uploadedBy });
});

// POST /api/music/:id/play
app.post('/api/music/:id/play', authMiddleware, (req, res) => {
  const track = db.tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ message: 'Трек не найден' });
  track.playsCount = (track.playsCount || 0) + 1;
  saveDb();
  res.json({ success: true });
});

// PATCH /api/music/:id  (edit track metadata / cover)
app.patch('/api/music/:id', authMiddleware, uploadMusic.single('cover'), (req, res) => {
  const track = db.tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ message: 'Трек не найден' });
  if (track.uploadedById !== req.userId) return res.status(403).json({ message: 'Нет прав' });

  const { title, artist, album, description } = req.body;
  if (title !== undefined) track.title = String(title).trim() || track.title;
  if (artist !== undefined) track.artist = String(artist).trim() || 'Неизвестный';
  if (album !== undefined) track.album = String(album).trim() || null;
  if (description !== undefined) track.description = String(description).trim() || null;
  if (req.file) track.coverUrl = `/uploads/music/${req.file.filename}`;

  track.updatedAt = new Date().toISOString();
  saveDb();

  const uploadedBy = db.users.find(u => u.id === track.uploadedById) || null;
  res.json({ ...track, uploadedBy });
});

// DELETE /api/music/:id
app.delete('/api/music/:id', authMiddleware, (req, res) => {
  const idx = db.tracks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: 'Не найдено' });
  if (db.tracks[idx].uploadedById !== req.userId) return res.status(403).json({ message: 'Нет прав' });
  const [track] = db.tracks.splice(idx, 1);
  // Optionally delete file
  const filePath = path.join(UPLOADS_DIR, 'music', path.basename(track.fileUrl));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  saveDb();
  res.json({ success: true });
});

// ─── MUSIC: import from URL / import ZIP / playlist zip ─────────────────────

const archiver = require('archiver');
const { spawn } = require('child_process');

// ZIP import is rejected by the early middleware; no archive parser is loaded.

// POST /api/music/import-url — скачать аудио по ссылке через yt-dlp.
// Требует yt-dlp и ffmpeg в PATH. Лимит — 6 минут.
app.post('/api/music/import-url', authMiddleware, express.json(), async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ message: 'Некорректный URL' });

  const run = (cmd, args) => new Promise((resolve) => {
    let stdout = '', stderr = '';
    let proc;
    try { proc = spawn(cmd, args, { windowsHide: true }); }
    catch (e) { return resolve({ code: -1, stdout: '', stderr: String(e && e.message || e) }); }
    proc.stdout && proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr && proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + '\n' + String(e && e.message || e) }));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  const meta = await run('yt-dlp', ['-J', '--no-warnings', '--no-playlist', url]);
  if (meta.code !== 0) {
    const isNotFound = meta.stderr.includes('not found') || meta.stderr.includes('не является') || meta.code === -1;
    return res.status(500).json({
      message: isNotFound 
        ? '❌ yt-dlp не установлен. Установите: npm install -g yt-dlp или скачайте с github.com/yt-dlp/yt-dlp'
        : 'Ссылка не поддерживается или недоступна',
      detail: (meta.stderr || '').slice(0, 500),
      help: isNotFound ? 'Windows: scoop install yt-dlp ffmpeg | Linux: sudo apt install yt-dlp ffmpeg' : undefined,
    });
  }
  let info;
  try { info = JSON.parse(meta.stdout); }
  catch { return res.status(500).json({ message: 'Не удалось разобрать метаданные' }); }
  const duration = Number(info.duration) || 0;
  if (duration <= 0) return res.status(400).json({ message: 'Не удалось определить длительность' });
  if (duration > 360) return res.status(400).json({ message: 'Длительность более 6 минут — импорт запрещён' });

  const title = String(info.title || 'Импорт').slice(0, 200);
  const artist = String(info.uploader || info.channel || 'Неизвестный').slice(0, 200);

  const musicDir = path.join(UPLOADS_DIR, 'music');
  if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
  const baseName = `url_${Date.now()}_${uuidv4().slice(0, 8)}`;
  const outTemplate = path.join(musicDir, baseName + '.%(ext)s');

  const dl = await run('yt-dlp', [
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '--no-playlist', '--no-warnings',
    '-o', outTemplate, url,
  ]);
  if (dl.code !== 0) {
    const isNotFound = dl.stderr.includes('not found') || dl.stderr.includes('не является') || dl.code === -1;
    return res.status(500).json({
      message: isNotFound
        ? '❌ ffmpeg не установлен. Установите: scoop install ffmpeg (Windows) или sudo apt install ffmpeg (Linux)'
        : 'Не удалось скачать аудио. Проверьте ссылку или попробуйте другую.',
      detail: (dl.stderr || '').slice(0, 500),
    });
  }
  const filename = baseName + '.mp3';
  const finalPath = path.join(musicDir, filename);
  if (!fs.existsSync(finalPath)) {
    const alt = fs.readdirSync(musicDir).find(f => f.startsWith(baseName + '.'));
    if (!alt) return res.status(500).json({ message: 'Файл не появился на диске' });
    fs.renameSync(path.join(musicDir, alt), finalPath);
  }
  const track = {
    id: uuidv4(),
    title, artist, album: null,
    duration: Math.round(duration),
    fileUrl: `/uploads/music/${filename}`,
    coverUrl: null,
    uploadedById: req.userId,
    playsCount: 0,
    createdAt: new Date().toISOString(),
    sourceUrl: url,
  };
  db.tracks.push(track);
  saveDb();
  const uploadedBy = db.users.find(u => u.id === req.userId) || null;
  res.status(201).json({ ...track, uploadedBy });
});

// GET /api/music/playlists/:id/zip — скачать плейлист архивом.
app.get('/api/music/playlists/:id/zip', authMiddleware, (req, res) => {
  const playlist = (db.playlists || []).find(p =>
    p.id === req.params.id && (p.userId === req.userId || p.isPublic));
  if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
  const trackIds = playlist.trackIds || [];
  const tracks = trackIds.map(id => db.tracks.find(t => t.id === id)).filter(Boolean);
  if (!tracks.length) return res.status(400).json({ message: 'Плейлист пуст' });

  const safeName = String(playlist.name || 'playlist').replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'playlist';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (err) => {
    console.error('[playlist zip] archiver error:', err);
    try { res.status(500).end(); } catch {}
  });
  archive.pipe(res);

  const used = new Set();
  tracks.forEach((t, idx) => {
    const file = path.join(UPLOADS_DIR, 'music', path.basename(t.fileUrl || ''));
    if (!fs.existsSync(file)) return;
    const ext = path.extname(file) || '.mp3';
    let name = `${String(idx + 1).padStart(2, '0')}. ${(t.artist ? t.artist + ' - ' : '') + (t.title || 'track')}`;
    name = name.replace(/[^\w\-. ()]+/g, '_').slice(0, 100) + ext;
    let uniq = name, n = 1;
    while (used.has(uniq)) { uniq = name.replace(ext, `_${n++}${ext}`); }
    used.add(uniq);
    archive.file(file, { name: uniq });
  });
  archive.finalize();
});




// ─── PLAYLISTS routes ─────────────────────────────────────────────────────────

function playlistWithTracks(playlist) {
  const ids = playlist.trackIds || [];
  return {
    ...playlist,
    description: playlist.description || '',
    isPublic: !!playlist.isPublic,
    tracks: ids
      .map((id, index) => {
        const track = db.tracks.find(t => t.id === id);
        return track ? { id: `${playlist.id}-${id}`, playlistId: playlist.id, trackId: id, position: index, track } : null;
      })
      .filter(Boolean),
  };
}

// GET /api/music/playlists
function getPlaylists(req, res) {
  const playlists = (db.playlists || [])
    .filter(p => p.userId === req.userId)
    .map(playlistWithTracks);
  res.json(playlists);
}
app.get('/api/music/playlists', authMiddleware, getPlaylists);
app.get('/api/playlists', authMiddleware, getPlaylists);

// POST /api/music/playlists
function createPlaylist(req, res) {
  const { name, description, isPublic } = req.body;
  if (!name) return res.status(400).json({ message: 'Укажите название' });
  const playlist = {
    id: uuidv4(),
    userId: req.userId,
    name,
    description: description || '',
    isPublic: !!isPublic,
    trackIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!db.playlists) db.playlists = [];
  db.playlists.push(playlist);
  saveDb();
  res.status(201).json(playlistWithTracks(playlist));
}
app.post('/api/music/playlists', authMiddleware, createPlaylist);
app.post('/api/playlists', authMiddleware, createPlaylist);

function updatePlaylist(req, res) {
  const playlist = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.userId);
  if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
  const { name, description, isPublic } = req.body;
  if (name !== undefined) playlist.name = name;
  if (description !== undefined) playlist.description = description;
  if (isPublic !== undefined) playlist.isPublic = !!isPublic;
  playlist.updatedAt = new Date().toISOString();
  saveDb();
  res.json(playlistWithTracks(playlist));
}
app.patch('/api/music/playlists/:id', authMiddleware, updatePlaylist);
app.patch('/api/playlists/:id', authMiddleware, updatePlaylist);

// GET /api/playlists/:id — читать одиночный плейлист.
// Свой — всегда, чужой — только если isPublic.
function getPlaylistOne(req, res) {
  const p = (db.playlists || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ message: 'Не найден' });
  if (p.userId !== req.userId && !p.isPublic) return res.status(403).json({ message: 'Нет доступа' });
  res.json(playlistWithTracks(p));
}
app.get('/api/music/playlists/:id', authMiddleware, getPlaylistOne);
app.get('/api/playlists/:id', authMiddleware, getPlaylistOne);


// POST /api/music/playlists/:id/tracks
function addTrackToPlaylist(req, res) {
  const playlist = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.userId);
  if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
  const { trackId } = req.body;
  if (!trackId) return res.status(400).json({ message: 'Укажите trackId' });
  const track = db.tracks.find(t => t.id === trackId);
  if (!track) return res.status(404).json({ message: 'Трек не найден' });
  if (!playlist.trackIds) playlist.trackIds = [];
  if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId);
  playlist.updatedAt = new Date().toISOString();
  saveDb();
  res.json(playlistWithTracks(playlist));
}
app.post('/api/music/playlists/:id/tracks', authMiddleware, addTrackToPlaylist);
app.post('/api/playlists/:id/tracks', authMiddleware, addTrackToPlaylist);

// DELETE /api/music/playlists/:id/tracks/:trackId
function removeTrackFromPlaylist(req, res) {
  const playlist = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.userId);
  if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
  playlist.trackIds = playlist.trackIds.filter(id => id !== req.params.trackId);
  playlist.updatedAt = new Date().toISOString();
  saveDb();
  res.json(playlistWithTracks(playlist));
}
app.delete('/api/music/playlists/:id/tracks/:trackId', authMiddleware, removeTrackFromPlaylist);
app.delete('/api/playlists/:id/tracks/:trackId', authMiddleware, removeTrackFromPlaylist);

function reorderPlaylist(req, res) {
  const playlist = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.userId);
  if (!playlist) return res.status(404).json({ message: 'Плейлист не найден' });
  const trackIds = Array.isArray(req.body.trackIds) ? req.body.trackIds : [];
  const existing = new Set(playlist.trackIds || []);
  playlist.trackIds = trackIds.filter(id => existing.has(id));
  playlist.updatedAt = new Date().toISOString();
  saveDb();
  res.json(playlistWithTracks(playlist));
}
app.patch('/api/music/playlists/:id/reorder', authMiddleware, reorderPlaylist);
app.patch('/api/playlists/:id/reorder', authMiddleware, reorderPlaylist);

// DELETE /api/music/playlists/:id
function deletePlaylist(req, res) {
  if (!db.playlists) db.playlists = [];
  const idx = db.playlists.findIndex(p => p.id === req.params.id && p.userId === req.userId);
  if (idx === -1) return res.status(404).json({ message: 'Не найден' });
  db.playlists.splice(idx, 1);
  saveDb();
  res.json({ success: true });
}
app.delete('/api/music/playlists/:id', authMiddleware, deletePlaylist);
app.delete('/api/playlists/:id', authMiddleware, deletePlaylist);

// ─── BOTS / AI / VOICE routes (примитивные, но рабочие) ───────────────────────

// Bots: пользователь создаёт бота, бот может отвечать по правилам
app.get('/api/bots/my', authMiddleware, (req, res) => {
  res.json((db.bots || []).filter(b => b.ownerId === req.userId));
});
app.post('/api/bots/create', authMiddleware, (req, res) => {
  const { name, username } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Укажите имя бота' });
  const bot = {
    id: uuidv4(),
    ownerId: req.userId,
    name,
    username: username || ('bot_' + uuidv4().slice(0, 8)),
    createdAt: new Date().toISOString(),
    rules: [],
    token: uuidv4().replace(/-/g, ''),
  };
  if (!db.bots) db.bots = [];
  db.bots.push(bot);
  saveDb();
  res.status(201).json(bot);
});
app.get('/api/bots/:username', authMiddleware, (req, res) => {
  const bot = (db.bots || []).find(b => b.username === req.params.username);
  if (!bot) return res.status(404).json({ message: 'Бот не найден' });
  res.json(bot);
});
app.post('/api/bots/:id/rule', authMiddleware, (req, res) => {
  const bot = (db.bots || []).find(b => b.id === req.params.id && b.ownerId === req.userId);
  if (!bot) return res.status(404).json({ message: 'Бот не найден' });
  bot.rules = bot.rules || [];
  bot.rules.push(req.body || {});
  saveDb();
  res.json(bot);
});

// AI: простой текстовый чат (без внешних нейросетей, но рабочий)
app.get('/api/ai/models', authMiddleware, (req, res) => {
  res.json((db.aiModels || []).filter(m => m.ownerId === req.userId));
});
app.post('/api/ai/models', authMiddleware, (req, res) => {
  const { name, description } = req.body || {};
  const model = {
    id: uuidv4(),
    ownerId: req.userId,
    name: name || 'Модель',
    description: description || '',
    createdAt: new Date().toISOString(),
  };
  if (!db.aiModels) db.aiModels = [];
  db.aiModels.push(model);
  saveDb();
  res.status(201).json(model);
});
app.post('/api/ai/models/:id/files', authMiddleware, uploadFile.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });
  res.json({ message: 'Файл принят', fileName: req.file.filename });
});
app.post('/api/ai/models/:id/train', authMiddleware, (req, res) => {
  res.json({ message: 'Обучение запущено' });
});
app.post('/api/ai/chat', authMiddleware, (req, res) => {
  const text = String(req.body?.message || '');
  res.json({
    reply: `Привет! Я упрощённый ИИ VERA. Ты написал(а): «${text.slice(0, 100)}». Полная нейросеть подключается в Server/ai-engine.`,
  });
});
app.get('/api/ai/stats', authMiddleware, (req, res) => {
  res.json({ models: (db.aiModels || []).length, sessions: (db.aiSessions || []).length });
});

// ─── AI Theme Generator ──────────────────────────────────────────────────────
// Стоимость: 50₽ / 10 тем = 5₽ за тему = 10 ВП (VP_PER_RUB=2).
const AI_THEME_COST_VP = 10;

// Простой локальный генератор темы по описанию: разбирает ключевые слова
// (цветовые/настроенческие) и собирает согласованную палитру. Работает без
// внешних сервисов и гарантирует валидный Theme на выходе.
function generateThemeLocal(desc) {
  const s = String(desc || '').toLowerCase();
  // Базовые палитры по ключевым словам (порядок = приоритет; s в lowercase)
  const palettes = [
    { keys: ['неон', 'киберпанк', 'cyberpunk', 'neon'], bg:'#0a0016', accent:'#ff2ec4', accent2:'#00e5ff', dark:true },
    { keys: ['красн', 'алый', 'багр', 'вишн', 'гранат', 'red', 'crimson', 'scarlet'], bg:'#1c0a0a', accent:'#ff4d5e', accent2:'#ff9a5c', dark:true },
    { keys: ['оранж', 'мандарин', 'янтар', 'апельсин', 'orange', 'amber'], bg:'#1a0f05', accent:'#ff8a3d', accent2:'#ffd23d', dark:true },
    { keys: ['жёлт', 'желт', 'лимон', 'солнц', 'yellow', 'lemon'], bg:'#171204', accent:'#ffd83d', accent2:'#a3e635', dark:true },
    { keys: ['зелён', 'зелен', 'трав', 'мят', 'лайм', 'изумруд', 'green', 'emerald', 'mint', 'lime'], bg:'#0a1610', accent:'#4ade80', accent2:'#a3e635', dark:true },
    { keys: ['бирюз', 'аква', 'teal', 'turquoise', 'aqua'], bg:'#04161a', accent:'#2dd4bf', accent2:'#7dffb2', dark:true },
    { keys: ['голуб', 'небес', 'неба', 'azure', 'sky', 'cyan'], bg:'#061624', accent:'#38bdf8', accent2:'#7dffe3', dark:true },
    { keys: ['син', 'blue', 'indigo', 'индиго'], bg:'#081226', accent:'#4d7cff', accent2:'#38bdf8', dark:true },
    { keys: ['океан', 'море', 'вода', 'ocean', 'water', 'морск'], bg:'#001a2c', accent:'#00c2ff', accent2:'#7dffb2', dark:true },
    { keys: ['фиолет', 'лаванд', 'сирен', 'аметист', 'purple', 'violet', 'lavender', 'lilac'], bg:'#12081f', accent:'#9b6bff', accent2:'#e879f9', dark:true },
    { keys: ['космос', 'галактика', 'space', 'galaxy', 'вселенн'], bg:'#05061a', accent:'#8a5cff', accent2:'#ff5cf0', dark:true },
    { keys: ['розов', 'малин', 'pink', 'rose'], bg:'#1c0a14', accent:'#ff6fae', accent2:'#c084fc', dark:true },
    { keys: ['закат', 'рассвет', 'sunset', 'dawn'], bg:'#1a0810', accent:'#ff6b3d', accent2:'#ffd23d', dark:true },
    { keys: ['огонь', 'пламя', 'fire', 'flame', 'лава'], bg:'#160505', accent:'#ff5a2e', accent2:'#ffcf3d', dark:true },
    { keys: ['лес', 'природ', 'forest', 'nature'], bg:'#0d1a0f', accent:'#7dff8a', accent2:'#c8ff7d', dark:true },
    { keys: ['весн', 'spring'], bg:'#0f1a12', accent:'#86efac', accent2:'#fda4af', dark:true },
    { keys: ['осен', 'autumn', 'fall'], bg:'#171008', accent:'#e8a94b', accent2:'#d97706', dark:true },
    { keys: ['зимн', 'winter', 'лёд', 'лед'], bg:'#0a1220', accent:'#93c5fd', accent2:'#e0f2fe', dark:true },
    { keys: ['корич', 'кофе', 'шоколад', 'корица', 'brown', 'coffee', 'chocolate'], bg:'#161009', accent:'#c08552', accent2:'#e8c39e', dark:true },
    { keys: ['ретро', 'винтаж', 'retro', 'vintage'], bg:'#1c1410', accent:'#e8a94b', accent2:'#c96f4a', dark:true },
    { keys: ['готик', 'мрачн', 'gothic', 'noir'], bg:'#050208', accent:'#a020f0', accent2:'#ff2050', dark:true },
    { keys: ['чёрн', 'черн', 'black', 'уголь'], bg:'#0c0c12', accent:'#8a9bff', accent2:'#5cf0d0', dark:true },
    { keys: ['серый', 'серая', 'серые', 'сталь', 'silver', 'steel', 'grey', 'gray'], bg:'#10141a', accent:'#9aa8bd', accent2:'#c3cddb', dark:true },
    { keys: ['пастел', 'нежн', 'pastel', 'soft'], bg:'#fdf6f9', accent:'#ff8fb7', accent2:'#a0c8ff', dark:false },
    { keys: ['минимал', 'чист', 'minimal', 'clean'], bg:'#f7f8fb', accent:'#5b7cff', accent2:'#a97dff', dark:false },
    { keys: ['светл', 'бел', 'light', 'white', 'снеж'], bg:'#f5f7fb', accent:'#3b82f6', accent2:'#8b5cf6', dark:false },
    { keys: ['золот', 'роскош', 'gold', 'royal', 'люкс', 'премиум'], bg:'#12100a', accent:'#f5c94b', accent2:'#c9a44a', dark:true },
    { keys: ['радуг', 'rainbow', 'разноцв'], bg:'#0d0d18', accent:'#f43f5e', accent2:'#38bdf8', dark:true },
  ];
  const hit = palettes.find(p => p.keys.some(k => s.includes(k)));
  // Настроение: слова «светлый/тёмный» переопределяют режим
  const wantsLight = /светл|бел|дневн|light|white/.test(s);
  const wantsDark = /тёмн|темн|ноч|мрачн|dark|black/.test(s);
  const withAlpha = (hex, a) => {
    const n = parseInt(hex.replace('#',''), 16);
    const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
    return `rgba(${r},${g},${b},${a})`;
  };
  const shift = (hex, amt) => {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.max(0, Math.min(255, ((n>>16)&255) + amt));
    const g = Math.max(0, Math.min(255, ((n>>8)&255) + amt));
    const b = Math.max(0, Math.min(255, (n&255) + amt));
    return '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
  };
  const hueOf = (hex) => {
    const n = parseInt(hex.replace('#',''), 16);
    const r = ((n>>16)&255)/255, g = ((n>>8)&255)/255, b = (n&255)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    if (!d) return 0;
    let h;
    if (max === r) h = ((g-b)/d + 6) % 6;
    else if (max === g) h = (b-r)/d + 2;
    else h = (r-g)/d + 4;
    return (h*60) % 360;
  };
  const hslToHex = (h, sat, light) => {
    const a = sat * Math.min(light, 1 - light);
    const f = (k) => {
      const kk = (k + h/30) % 12;
      const c = light - a * Math.max(-1, Math.min(kk-3, 9-kk, 1));
      return Math.round(255*c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  };
  // Прямой hex-код в описании («сделай тему #34bf5e»)
  const hexMatch = s.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i);

  let bg, accent, accent2, isDark;
  if (hexMatch) {
    accent = hexMatch[0].toLowerCase();
    if (accent.length === 4) accent = '#' + accent.slice(1).split('').map(c => c + c).join('');
    const h = hueOf(accent);
    isDark = !wantsLight;
    bg = isDark ? hslToHex(h, 0.32, 0.07) : hslToHex(h, 0.35, 0.96);
    accent2 = hslToHex((h + 40) % 360, 0.80, 0.60);
  } else if (hit) {
    bg = hit.bg; accent = hit.accent; accent2 = hit.accent2;
    isDark = hit.dark;
    if (wantsLight && isDark) {
      isDark = false;
      bg = hslToHex(hueOf(accent), 0.30, 0.96);
    } else if (wantsDark && !isDark) {
      isDark = true;
      bg = hslToHex(hueOf(accent), 0.32, 0.08);
    }
  } else {
    // Фолбэк: детерминированный хеш описания → уникальный оттенок.
    // Разные описания дают разные темы — дефолтного «розового» больше нет.
    let hash = 2166136261;
    for (let i = 0; i < s.length; i++) { hash ^= s.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    const h = Math.abs(hash) % 360;
    isDark = !wantsLight;
    bg = isDark ? hslToHex(h, 0.30, 0.075) : hslToHex(h, 0.32, 0.96);
    accent = hslToHex(h, 0.82, 0.62);
    accent2 = hslToHex((h + 42) % 360, 0.78, 0.60);
  }
  const text = isDark ? '#f4f6ff' : '#181a20';
  const textSec = isDark ? '#a0a7bd' : '#5a6172';
  const border = withAlpha(accent, 0.15);
  const bgSidebar = isDark ? shift(bg, 8) : shift(bg, -6);
  const bgChat = bg;
  const bgHeader = isDark ? shift(bg, -6) : shift(bg, -10);
  const bgInput = isDark ? shift(bg, 18) : shift(bg, -14);
  const bgHover = withAlpha(accent, 0.10);
  const bgActive = withAlpha(accent, 0.22);
  const bubbleOwnGradient = `linear-gradient(135deg, ${accent} 0%, ${accent2} 100%)`;
  const bubbleOwnShadow = `0 8px 28px ${withAlpha(accent, 0.30)}, 0 0 0 1px rgba(255,255,255,0.10) inset`;
  const sidebarGradient = `linear-gradient(180deg, ${shift(bg, isDark?14:-4)} 0%, ${bg} 100%)`;
  const headerGradient = `linear-gradient(90deg, ${shift(bg,-8)} 0%, ${withAlpha(accent,0.10)} 50%, ${shift(bg,-8)} 100%)`;
  const name = String(desc || 'AI Theme').slice(0, 40) || 'AI Theme';
  return {
    id: 0, // клиент подставит свой
    name: 'AI: ' + name,
    bg, text, accent,
    bgSidebar, bgChat, bgHeader, bgInput,
    bgBubbleOwn: accent,
    bgBubbleOther: isDark ? shift(bg, 22) : shift(bg, -12),
    bgHover, bgActive, textSec, border,
    online: accent2,
    bubbleOwnGradient, bubbleOwnShadow,
    bubbleOtherShadow: isDark ? '0 6px 18px rgba(0,0,0,0.35)' : '0 6px 18px rgba(0,0,0,0.08)',
    sidebarGradient, headerGradient,
    bubbleOwnText: isDark ? '#0a0812' : '#ffffff',
  };
}

app.post('/api/ai/theme', authMiddleware, async (req, res) => {
  const description = String(req.body?.description || '').trim().slice(0, 500);
  if (!description) return res.status(400).json({ message: 'Опишите тему' });
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  const devFree = isAdminReq(req);
  if (!devFree && (user.walletBalance || 0) < AI_THEME_COST_VP) {
    return res.status(400).json({ message: `Недостаточно ВП. Нужно ${AI_THEME_COST_VP} ВП.` });
  }
  const theme = generateThemeLocal(description);
  if (!devFree) {
    user.walletBalance -= AI_THEME_COST_VP;
    saveDb();
    pushWalletEmit(user);
  }
  res.json({ ok: true, theme, cost: devFree ? 0 : AI_THEME_COST_VP, balance: user.walletBalance });
});
app.get('/api/ai-lmm/health', authMiddleware, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'Только для администратора' });
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const data = await r.json();
    res.json({ status: 'ok', engine: 'ollama', model: OLLAMA_MODEL, model_loaded: (data.models || []).some(m => String(m.name || '').split(':')[0] === OLLAMA_MODEL.split(':')[0]) });
  } catch (e) { res.json({ status: 'offline', engine: 'ollama', model: OLLAMA_MODEL, error: e.message }); }
});
app.post('/api/ai-lmm/chat', authMiddleware, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'Только для администратора' });
  const text = String(req.body?.message || '').trim().slice(0, 8000);
  if (!text) return res.status(400).json({ message: 'Введите сообщение' });
  try {
    const knowledge = (db.aiKnowledge || []).map(k => `Источник: ${k.url}\n${k.text}`).join('\n\n').slice(0, 100000);
    const systemPrompt = knowledge ? `${LLM_SYSTEM_PROMPT}\n\nДополнительные материалы администратора:\n${knowledge}` : LLM_SYSTEM_PROMPT;
    const r = await fetch(`${OLLAMA_URL}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }] }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Ollama HTTP ${r.status}`);
    const answer = String(data.message?.content || '').trim();
    if (!answer) throw new Error('Ollama вернула пустой ответ');
    res.json({ answer, model: OLLAMA_MODEL });
  } catch (e) { res.status(503).json({ message: `Локальная LLM недоступна: ${e.message}` }); }
});

app.post('/api/ai-lmm/learn-url', authMiddleware, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'Только для администратора' });
  let parsed;
  try { parsed = new URL(String(req.body?.url || '').trim()); } catch { return res.status(400).json({ message: 'Укажите корректную ссылку' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ message: 'Разрешены только http и https' });
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname) || parsed.hostname.endsWith('.local')) return res.status(400).json({ message: 'Локальные адреса запрещены' });
  try {
    const r = await fetch(parsed.href, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Vera-AI-Learning/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = (await r.text()).slice(0, 200000);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
    if (!Array.isArray(db.aiKnowledge)) db.aiKnowledge = [];
    db.aiKnowledge = [...db.aiKnowledge.filter(k => k.url !== parsed.href), { url: parsed.href, text, updatedAt: new Date().toISOString() }].slice(-20);
    saveDb();
    res.json({ ok: true, url: parsed.href, text });
  } catch (e) { res.status(502).json({ message: `Не удалось прочитать сайт: ${e.message}` }); }
});

// Local Whisper; access is checked before reading an attachment from disk.
app.post('/api/voice/transcribe/:attachmentId', authMiddleware,
  require('./transcription').createTranscriptionHandler({ getDb: () => db, uploadsDir: UPLOADS_DIR }));

// ─── PROFILE COMMENTS (Steam-style стена) ────────────────────────────────────
// Хранятся на сервере, чтобы владелец профиля видел записи от других.
// Модель: { id, targetUserId, authorId, text, createdAt }. Автор+текст —
// подтягиваются на клиенте по authorId (актуальный ник/аватар).
if (!Array.isArray(db.profileComments)) db.profileComments = [];

app.get('/api/users/:id/comments', authMiddleware, (req, res) => {
  const targetUserId = req.params.id;
  const items = (db.profileComments || [])
    .filter(c => c.targetUserId === targetUserId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 200)
    .map(c => {
      const author = db.users.find(u => u.id === c.authorId);
      return {
        id: c.id,
        targetUserId: c.targetUserId,
        authorId: c.authorId,
        authorName: author
          ? ([author.firstName, author.lastName].filter(Boolean).join(' ') || author.username)
          : 'Пользователь',
        authorAvatar: author?.avatarUrl || null,
        text: c.text,
        ts: new Date(c.createdAt).getTime(),
      };
    });
  res.json(items);
});

app.post('/api/users/:id/comments', authMiddleware, (req, res) => {
  const targetUserId = req.params.id;
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ message: 'Пустой комментарий' });
  const target = db.users.find(u => u.id === targetUserId);
  if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
  const record = {
    id: uuidv4(),
    targetUserId,
    authorId: req.userId,
    text,
    createdAt: new Date().toISOString(),
  };
  db.profileComments.push(record);
  saveDb();
  const author = db.users.find(u => u.id === req.userId);
  const payload = {
    id: record.id,
    targetUserId,
    authorId: record.authorId,
    authorName: author
      ? ([author.firstName, author.lastName].filter(Boolean).join(' ') || author.username)
      : 'Пользователь',
    authorAvatar: author?.avatarUrl || null,
    text,
    ts: new Date(record.createdAt).getTime(),
  };
  try { io.emit('profileComment:new', payload); } catch {}
  res.json(payload);
});

app.delete('/api/users/:id/comments/:commentId', authMiddleware, (req, res) => {
  const { id: targetUserId, commentId } = req.params;
  const idx = (db.profileComments || []).findIndex(c => c.id === commentId && c.targetUserId === targetUserId);
  if (idx === -1) return res.status(404).json({ message: 'Не найден' });
  const c = db.profileComments[idx];
  // Удалять может: автор комментария, владелец стены, админ.
  const isOwner = c.authorId === req.userId || c.targetUserId === req.userId;
  if (!isOwner && !isAdminReq(req)) return res.status(403).json({ message: 'Нет прав' });
  db.profileComments.splice(idx, 1);
  saveDb();
  try { io.emit('profileComment:deleted', { id: commentId, targetUserId }); } catch {}
  res.json({ ok: true });
});

// ─── FAVORITES routes ─────────────────────────────────────────────────────────

// GET /api/favorites
app.get('/api/favorites', authMiddleware, (req, res) => {
  if (!db.favorites) db.favorites = [];
  const favChatIds = db.favorites
    .filter(f => f.userId === req.userId)
    .map(f => f.chatId);
  const chats = favChatIds
    .map(chatId => {
      const chat = db.chats.find(c => c.id === chatId);
      if (!chat) return null;
      const members = db.chatMembers
        .filter(m => m.chatId === chatId)
        .map(m => ({ ...m, user: db.users.find(u => u.id === m.userId) || null }));
      const lastMsg = db.messages
        .filter(m => m.chatId === chatId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
      return { ...chat, members, lastMessage: lastMsg, unreadCount: 0 };
    })
    .filter(Boolean);
  res.json(chats);
});

// POST /api/favorites
app.post('/api/favorites', authMiddleware, (req, res) => {
  if (!db.favorites) db.favorites = [];
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ message: 'Укажите chatId' });
  const exists = db.favorites.find(f => f.userId === req.userId && f.chatId === chatId);
  if (!exists) {
    db.favorites.push({ id: uuidv4(), userId: req.userId, chatId, createdAt: new Date().toISOString() });
    saveDb();
  }
  res.json({ success: true });
});

// DELETE /api/favorites/:chatId
app.delete('/api/favorites/:chatId', authMiddleware, (req, res) => {
  if (!db.favorites) db.favorites = [];
  const idx = db.favorites.findIndex(f => f.userId === req.userId && f.chatId === req.params.chatId);
  if (idx !== -1) { db.favorites.splice(idx, 1); saveDb(); }
  res.json({ success: true });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new IOServer(server, {
  cors: { origin: corsOriginFn, credentials: true },
  // Keep signalling/messages bounded; large files must use HTTP upload.
  maxHttpBufferSize: Number(process.env.WS_MAX_BUFFER_BYTES || 12 * 1024 * 1024),
});

const userSockets = new Map(); // userId -> Set<socketId>
const socketIpCounts = new Map();
const socketIpHits = new Map();
const wsEventHits = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, hits] of socketIpHits) if (!hits.length || hits[hits.length - 1] < cutoff) socketIpHits.delete(ip);
  for (const [id, rec] of wsEventHits) if (rec.reset <= Date.now()) wsEventHits.delete(id);
  for (const [id, hits] of wsSendHits) if (!hits.length || hits[hits.length - 1] < cutoff) wsSendHits.delete(id);
}, 60_000).unref();
// SEC: per-user WS message rate-limit state.
const wsSendHits = new Map();
// ─── Discord-style voice rooms (in-memory) ─────────────────────────────────
// chatId -> Map<userId, { socketId, kind, joinedAt, mic, cam, screen, deaf }>
const callRooms = new Map();

function publicPeerState(_uid, st) {
  return {
    kind: st.kind, mic: !!st.mic, cam: !!st.cam, screen: !!st.screen, deaf: !!st.deaf,
    joinedAt: st.joinedAt,
  };
}

// Socket.IO bypasses Express' request middleware, so resolve its client IP
// against the same explicitly configured proxy trust function as HTTP.
function socketRequestIp(request) {
  const direct = normalizeIp(request?.socket?.remoteAddress);
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '')
    .split(',').map(normalizeIp).filter(Boolean);
  if (!direct || !forwarded.length) return direct;
  const trustProxy = app.get('trust proxy fn');
  if (typeof trustProxy !== 'function' || !trustProxy(direct, 0)) return direct;
  const chain = [direct, ...forwarded.reverse()];
  for (let index = 0; index < chain.length - 1; index += 1) {
    if (!trustProxy(chain[index], index)) return chain[index];
  }
  return chain[chain.length - 1] || direct;
}

function doLeaveRoom(chatId, userId, _socketId) {
  const room = callRooms.get(chatId);
  if (!room || !room.has(userId)) return;
  room.delete(userId);
  io.to(`callroom:${chatId}`).emit('callroom:peer-left', { chatId, userId });
  if (room.size === 0) {
    callRooms.delete(chatId);
    io.to(`chat:${chatId}`).emit('callroom:ended', { chatId });
  }
  // Убираем всех сокетов юзера из socket-room этой комнаты.
  const sockets = userSockets.get(userId);
  if (sockets) sockets.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) s.leave(`callroom:${chatId}`);
  });
}

function leaveAllCallRooms(userId, _socketId) {
  for (const [chatId, room] of callRooms.entries()) {
    if (room.has(userId)) doLeaveRoom(chatId, userId);
  }
}
io.use((socket, next) => {
  // Engine.IO requests are not Express requests. Use the transport peer
  // address here; trusting an arbitrary X-Forwarded-For would bypass limits.
  socket.ip = socketRequestIp(socket.request);
  if (socket.ip && isIpBanned(socket.ip)) return next(new Error('IP_BANNED'));
  const now = Date.now();
  if (!socketIpHits.has(socket.ip) && socketIpHits.size >= 10000) return next(new Error('SERVER_BUSY'));
  const hits = socketIpHits.get(socket.ip) || [];
  while (hits.length && hits[0] < now - 60_000) hits.shift();
  if (hits.length >= 30) return next(new Error('RATE_LIMITED'));
  hits.push(now);
  socketIpHits.set(socket.ip, hits);
  if ((socketIpCounts.get(socket.ip) || 0) >= 20) return next(new Error('TOO_MANY_CONNECTIONS'));
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  if (!token) return next(new Error('Unauthorized'));
  try {
    const { userId, deviceId } = verifyAccessToken(token);
    socket.userId = userId;
    socket.deviceId = deviceId;
    if (recordModerationIp(userId, socket.ip)) saveDb();
    next();
  } catch (e) {
    next(new Error('Invalid token: ' + e.message));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  if ((userSockets.get(userId)?.size || 0) >= 8 || (socketIpCounts.get(socket.ip) || 0) >= 20) {
    socket.disconnect(true);
    return;
  }
  socket.use((_packet, next) => {
    const now = Date.now();
    let rec = wsEventHits.get(userId);
    if (!rec || rec.reset <= now) {
      if (!rec && wsEventHits.size >= 10000) { socket.disconnect(true); return; }
      rec = { count: 0, reset: now + 60_000 };
      wsEventHits.set(userId, rec);
    }
    if (++rec.count > 600) { socket.disconnect(true); return; }
    next();
  });
  socketIpCounts.set(socket.ip, (socketIpCounts.get(socket.ip) || 0) + 1);
  console.log(`✅ Подключился: ${userId} (${socket.id})`);

  // Track socket
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);

  // Mark online
  const user = db.users.find(u => u.id === userId);
  if (user) { user.isOnline = true; saveDb(); }
  io.emit('user:online', { userId });

  // Join all user's chats automatically
  const myChatIds = db.chatMembers.filter(m => m.userId === userId).map(m => m.chatId);
  for (const chatId of myChatIds) socket.join(`chat:${chatId}`);

  socket.on('chat:join', (chatId) => {
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (isMember) socket.join(`chat:${chatId}`);
  });

  socket.on('chat:leave', (chatId) => {
    socket.leave(`chat:${chatId}`);
  });

  socket.on('chat:settings_offer', (data) => {
    const { chatId, settings } = data || {};
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember || !settings || typeof settings !== 'object') return;
    let size;
    try { size = Buffer.byteLength(JSON.stringify(settings), 'utf8'); } catch { return; }
    if (size > 512 * 1024) return;
    socket.to(`chat:${chatId}`).emit('chat:settings_offer', {
      chatId,
      settings,
      senderId: userId,
      sender: db.users.find(u => u.id === userId) || null,
    });
  });

  socket.on('chat:settings_offer_response', (data) => {
    const { chatId, accepted, senderId } = data || {};
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember || !senderId) return;
    const targetSockets = userSockets.get(senderId);
    if (!targetSockets) return;
    targetSockets.forEach(sid => {
      io.to(sid).emit('chat:settings_offer_response', { chatId, accepted: !!accepted, userId });
    });
  });

  // Send message via socket
  socket.on('message:send', async (data, callback) => {
    if (db.chats.some(c => c.id === data?.chatId && c.type === 'channel')) {
      let status = 200;
      return handleSendMessage(data.chatId, userId, data, {
        status(code) { status = code; return this; },
        json(value) { if (callback) callback(status >= 400 ? { error: value.message } : value); },
      });
    }
    const { chatId, text, content, replyToId, attachments, type } = data || {};
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return callback && callback({ error: 'Нет доступа' });

    const msgContent = String(content || text || '');
    if (msgContent.length > MESSAGE_MAX_LEN) {
      return callback && callback({ error: 'Сообщение слишком длинное' });
    }
    // SEC: rate-limit per-user на WS message:send.
    if (!wsSendHits.has(userId)) wsSendHits.set(userId, []);
    const hits = wsSendHits.get(userId);
    const now = Date.now();
    while (hits.length && hits[0] < now - 60_000) hits.shift();
    if (hits.length >= 120) {
      return callback && callback({ error: 'Слишком быстро. Подождите минуту.' });
    }
    hits.push(now);
    const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 20) : [];
    if (!msgContent && safeAttachments.length === 0) {
      return callback && callback({ error: 'Пустое сообщение' });
    }
    const normAttachments = safeAttachments.map(a => ({
      id: a.id || uuidv4(),
      fileUrl: a.url || a.fileUrl || '',
      fileName: a.originalName || a.fileName || '',
      fileSize: a.size || a.fileSize || 0,
      mimeType: a.mimeType || '',
      data: a.data || null,
    }));

    const message = {
      id: uuidv4(),
      chatId,
      senderId: userId,
      text: msgContent,
      content: msgContent,
      replyToId: replyToId || null,
      attachments: normAttachments,
      type: type || (normAttachments.length > 0 ? 'document' : 'text'),
      readBy: [userId],
      editedAt: null,
      isEdited: false,
      isPinned: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
    };
    db.messages.push(message);
    saveDb();

    const result = { ...message, sender: db.users.find(u => u.id === userId) };
    io.to(`chat:${chatId}`).emit('message:new', result);
    callback && callback(result);
  });

  // Typing indicators
  socket.on('typing:start', (chatId) => {
    // SEC: не даём эмитить typing в чужие чаты.
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return;
    socket.to(`chat:${chatId}`).emit('typing:start', { userId, chatId });
  });
  socket.on('typing:stop', (chatId) => {
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return;
    socket.to(`chat:${chatId}`).emit('typing:stop', { userId, chatId });
  });

  // Read message
  socket.on('message:read', ({ chatId, messageId }) => {
    // SEC: проверяем членство в чате и совпадение chatId с сообщением.
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return;
    const msg = db.messages.find(m => m.id === messageId);
    if (!msg || msg.chatId !== chatId) return;
    if (msg && !msg.readBy?.includes(userId)) {
      if (!msg.readBy) msg.readBy = [];
      msg.readBy.push(userId);
      saveDb();
    }
    socket.to(`chat:${chatId}`).emit('message:read', { messageId, userId });
  });

  // ── WebRTC Звонки ─────────────────────────────────────────────────────────

  // Утилита: отправить конкретному пользователю (по всем его сокетам)
  function sendToUser(targetUserId, event, data) {
    const sockets = userSockets.get(targetUserId);
    if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
  }

  // SEC: проверка «эти двое состоят в общем direct/group чате» — иначе можно
  // спамить произвольным юзерам поддельные call-события.
  function shareChat(a, b) {
    if (!a || !b || a === b) return false;
    const aChats = new Set(db.chatMembers.filter(m => m.userId === a).map(m => m.chatId));
    return db.chatMembers.some(m => m.userId === b && aChats.has(m.chatId));
  }

  // Звонок: сохраняем в журнал
  socket.on('call:offer', (data) => {
    if (!data || !data.targetUserId || !shareChat(userId, data.targetUserId)) return;
    const caller = db.users.find(u => u.id === userId);
    const callLogEntry = {
      id: uuidv4(),
      userId,
      peerId: data.targetUserId,
      direction: 'out',
      type: data.type || 'audio',
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: data.status || 'completed',
    };
    if (!db.callLogs) db.callLogs = [];
    db.callLogs.push(callLogEntry);
    saveDb();

    sendToUser(data.targetUserId, 'call:incoming', {
      callerId: userId,
      callerName: caller ? `${caller.firstName || ''} ${caller.lastName || ''}`.trim() || caller.username : 'Неизвестный',
      callerAvatar: caller?.avatarUrl || null,
      offer: data.offer,
      type: data.type || 'audio',
      callLogId: callLogEntry.id,
    });
  });

  // Ответить на звонок
  socket.on('call:answer', (data) => {
    if (!data || !data.targetUserId || !shareChat(userId, data.targetUserId)) return;
    sendToUser(data.targetUserId, 'call:answered', {
      answer: data.answer,
      fromUserId: userId,
    });
  });

  // ICE кандидат
  socket.on('call:ice-candidate', (data) => {
    if (!data || !data.targetUserId || !shareChat(userId, data.targetUserId)) return;
    sendToUser(data.targetUserId, 'call:ice-candidate', {
      candidate: data.candidate,
      fromUserId: userId,
    });
  });

  // Завершить / отклонить звонок
  socket.on('call:end', (data) => {
    if (!data) return;
    if (data.targetUserId && shareChat(userId, data.targetUserId)) {
      const reason = data.reason || 'ended';
      sendToUser(data.targetUserId, 'call:ended', { fromUserId: userId, reason });
    }
    const reason = data.reason || 'ended';
    // Отмечаем завершение в журнале звонков
    if (data.callLogId) {
      const entry = (db.callLogs || []).find(e => e.id === data.callLogId);
      if (entry) {
        entry.endedAt = new Date().toISOString();
        entry.status = reason === 'declined' || reason === 'missed' ? reason : 'completed';
        saveDb();
      }
    } else {
      // нет id — завершаем последнюю незаконченную запись для этого юзера
      const entries = (db.callLogs || []).filter(e => e.userId === userId && !e.endedAt);
      const last = entries[entries.length - 1];
      if (last) {
        last.endedAt = new Date().toISOString();
        last.status = reason === 'declined' || reason === 'missed' ? reason : 'completed';
        saveDb();
      }
    }

    // Если звонок был пропущен — сохраняем системное сообщение в чате
    if (reason === 'declined' || reason === 'missed') {
      // Найти общий direct чат между двумя пользователями
      const myChats = db.chatMembers.filter(m => m.userId === userId).map(m => m.chatId);
      const targetChats = db.chatMembers.filter(m => m.userId === data.targetUserId).map(m => m.chatId);
      const commonChatId = myChats.find(id => targetChats.includes(id) && db.chats.find(c => c.id === id && c.type === 'direct'));
      if (commonChatId) {
        const systemMsg = {
          id: uuidv4(),
          chatId: commonChatId,
          senderId: userId,
          text: `📞 Пропущенный ${data.type === 'video' ? 'видео' : 'аудио'}звонок`,
          content: `📞 Пропущенный ${data.type === 'video' ? 'видео' : 'аудио'}звонок`,
          type: 'system',
          replyToId: null,
          attachments: [],
          readBy: [userId],
          isEdited: false,
          isPinned: false,
          isDeleted: false,
          createdAt: new Date().toISOString(),
        };
        db.messages.push(systemMsg);
        saveDb();
        const sender = db.users.find(u => u.id === userId);
        io.to(`chat:${commonChatId}`).emit('message:new', { ...systemMsg, sender });
      }
    }
  });

  // ─── Discord-style групповые/1:1 звонки (voice rooms) ──────────────────────
  // Схема: одна «комната» на chatId. Клиенты обмениваются offer/answer/ICE
  // ЧЕРЕЗ сервер, но media идёт напрямую peer-to-peer (mesh). Сервер знает
  // только СПИСОК участников и ретранслирует сигналинг.
  //
  // Хранилище (in-memory, живёт до рестарта сервера):
  //   callRooms.get(chatId) = Map<userId, {
  //     socketId, kind: 'audio'|'video', joinedAt,
  //     mic: bool, cam: bool, screen: bool, deaf: bool
  //   }>

  socket.on('callroom:join', ({ chatId, kind }) => {
    if (!chatId) return;
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return;

    if (!callRooms.has(chatId)) callRooms.set(chatId, new Map());
    const room = callRooms.get(chatId);

    // Список уже присутствующих участников (без нас) — вернём инициатору.
    const peers = Array.from(room.entries())
      .filter(([uid]) => uid !== userId)
      .map(([uid, st]) => ({ userId: uid, ...publicPeerState(uid, st) }));

    const wasEmpty = room.size === 0;
    room.set(userId, {
      socketId: socket.id,
      kind: kind === 'video' ? 'video' : 'audio',
      joinedAt: Date.now(),
      mic: true, cam: kind === 'video', screen: false, deaf: false,
    });
    socket.join(`callroom:${chatId}`);

    // Ответ инициатору: кто уже в комнате.
    socket.emit('callroom:peers', { chatId, peers, kind: kind === 'video' ? 'video' : 'audio' });

    // Уведомляем остальных участников комнаты (те, кто уже сидят) — появился новичок.
    const meUser = db.users.find(u => u.id === userId);
    const joinedPayload = {
      chatId,
      userId,
      user: meUser ? {
        id: meUser.id,
        firstName: meUser.firstName, lastName: meUser.lastName,
        username: meUser.username, avatarUrl: meUser.avatarUrl,
      } : { id: userId },
      state: publicPeerState(userId, room.get(userId)),
    };
    socket.to(`callroom:${chatId}`).emit('callroom:peer-joined', joinedPayload);

    // Уведомляем всех участников чата (включая тех, кто не в комнате) —
    // чтобы у них появилась «плашка идёт звонок» / входящий рингтон.
    const chat = db.chats.find(c => c.id === chatId);
    if (wasEmpty && chat) {
      // Direct = входящий вызов конкретному второму участнику (ring).
      if (chat.type === 'direct') {
        const others = db.chatMembers.filter(m => m.chatId === chatId && m.userId !== userId);
        others.forEach(m => sendToUser(m.userId, 'callroom:ring', {
          chatId, callerId: userId,
          callerName: meUser ? `${meUser.firstName || ''} ${meUser.lastName || ''}`.trim() || meUser.username : 'Неизвестный',
          callerAvatar: meUser?.avatarUrl || null,
          kind: kind === 'video' ? 'video' : 'audio',
        }));
      } else {
        // Group/channel — просто оповещаем «в чате начался звонок».
        io.to(`chat:${chatId}`).emit('callroom:started', {
          chatId, starterId: userId, kind: kind === 'video' ? 'video' : 'audio',
        });
      }
    }
  });

  socket.on('callroom:leave', ({ chatId }) => {
    doLeaveRoom(chatId, userId, socket.id);
  });

  // Сигналинг: SDP offer/answer/ICE между двумя конкретными пирами в комнате.
  socket.on('callroom:signal', ({ chatId, toUserId, data }) => {
    if (!chatId || !toUserId) return;
    const room = callRooms.get(chatId);
    if (!room || !room.has(userId) || !room.has(toUserId)) return;
    const target = room.get(toUserId);
    io.to(target.socketId).emit('callroom:signal', {
      chatId, fromUserId: userId, data,
    });
  });

  // Изменение локального состояния (mic/cam/screen/deaf/speaking).
  socket.on('callroom:state', ({ chatId, patch }) => {
    const room = callRooms.get(chatId);
    if (!room || !room.has(userId)) return;
    const st = room.get(userId);
    if (patch && typeof patch === 'object') {
      if (typeof patch.mic === 'boolean') st.mic = patch.mic;
      if (typeof patch.cam === 'boolean') st.cam = patch.cam;
      if (typeof patch.screen === 'boolean') st.screen = patch.screen;
      if (typeof patch.deaf === 'boolean') st.deaf = patch.deaf;
    }
    socket.to(`callroom:${chatId}`).emit('callroom:peer-state', {
      chatId, userId, state: publicPeerState(userId, st),
    });
  });

  socket.on('disconnect', () => {
    const count = (socketIpCounts.get(socket.ip) || 1) - 1;
    if (count > 0) socketIpCounts.set(socket.ip, count); else socketIpCounts.delete(socket.ip);
    // Автовыход из всех голосовых комнат (см. ниже блок callRooms)
    try { leaveAllCallRooms(userId, socket.id); } catch {}
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSockets.delete(userId);
        const u = db.users.find(u => u.id === userId);
        if (u) { u.isOnline = false; u.lastSeen = new Date().toISOString(); saveDb(); }
        io.emit('user:offline', { userId, lastSeen: new Date().toISOString() });
      }
    }
    console.log(`❌ Отключился: ${userId}`);
  });
});

// ─── Console commands ─────────────────────────────────────────────────────────
// Интерактивная консоль работает только когда есть TTY (локальный запуск).
// В продакшне (Docker/Render) stdin не TTY — readline получит close сразу и
// уронит процесс. Поэтому включаем её условно.
if (process.stdin.isTTY) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'vera> ' });

function printHelp() {
  console.log(`
📟 Консольные команды Vera:
  help              — показать эту справку
  users             — список всех пользователей
  chats             — список всех чатов
  msgs <chatId>     — последние 10 сообщений в чате
  delchat <chatId>  — удалить чат и все его сообщения
  kick <userId>     — удалить пользователя
  stats             — статистика базы данных
  admins             — список админов (env + db)
  admin add <user>   — назначить пользователя админом (по username)
  admin del <user>   — снять админа
  clear             — очистить консоль
  exit              — остановить сервер
`);
}

rl.on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case 'help': printHelp(); break;
    case 'users':
      console.log('👥 Пользователи:');
      db.users.forEach(u => console.log(`  ${u.id.slice(0,8)} | ${u.phone} | ${u.firstName || ''} ${u.lastName || ''} | online:${u.isOnline}`));
      break;
    case 'chats':
      console.log('💬 Чаты:');
      db.chats.forEach(c => {
        const mCount = db.chatMembers.filter(m => m.chatId === c.id).length;
        const mCount2 = db.messages.filter(m => m.chatId === c.id).length;
        console.log(`  ${c.id.slice(0,8)} | [${c.type}] ${c.name || '(direct)'} | участников:${mCount} сообщений:${mCount2}`);
      });
      break;
    case 'msgs': {
      const chatId = args[0];
      if (!chatId) { console.log('Укажите chatId'); break; }
      const msgs = db.messages.filter(m => m.chatId === chatId).slice(-10);
      if (!msgs.length) { console.log('Нет сообщений'); break; }
      msgs.forEach(m => {
        const sender = db.users.find(u => u.id === m.senderId);
        console.log(`  [${m.createdAt.slice(11,16)}] ${sender?.phone || m.senderId}: ${m.content || m.text || '(файл)'}`);
      });
      break;
    }
    case 'delchat': {
      const chatId = args[0];
      if (!chatId) { console.log('Укажите chatId. Используйте команду "chats" чтобы увидеть список.'); break; }
      const chatIdx = db.chats.findIndex(c => c.id === chatId || c.id.startsWith(chatId));
      if (chatIdx === -1) { console.log(`Чат "${chatId}" не найден`); break; }
      const chat = db.chats[chatIdx];
      const chatMessages = db.messages.filter(m => m.chatId === chat.id);
      const msgCount = chatMessages.length;
      const memberCount = db.chatMembers.filter(m => m.chatId === chat.id).length;
      moderation.archive(db, chatMessages, 'console', { uploadsDir: UPLOADS_DIR });
      db.messages    = db.messages.filter(m => m.chatId !== chat.id);
      db.chatMembers = db.chatMembers.filter(m => m.chatId !== chat.id);
      if (db.favorites) db.favorites = db.favorites.filter(f => f.chatId !== chat.id);
      db.chats.splice(chatIdx, 1);
      saveDb();
      io.to(`chat:${chat.id}`).emit('chat:deleted', { chatId: chat.id });
      console.log(`✅ Чат [${chat.type}] "${chat.name || '(direct)'}" удалён`);
      console.log(`   Удалено сообщений: ${msgCount}, участников: ${memberCount}`);
      break;
    }
    case 'kick': {
      const userId = args[0];
      if (!userId) { console.log('Укажите userId'); break; }
      const idx = db.users.findIndex(u => u.id === userId);
      if (idx === -1) { console.log('Пользователь не найден'); break; }
      db.users.splice(idx, 1);
      db.chatMembers = db.chatMembers.filter(m => m.userId !== userId);
      saveDb();
      console.log(`✅ Пользователь ${userId} удалён`);
      break;
    }
    case 'stats':
      console.log(`📊 Статистика:`);
      console.log(`  Пользователей: ${db.users.length}`);
      console.log(`  Чатов: ${db.chats.length}`);
      console.log(`  Сообщений: ${db.messages.length}`);
      console.log(`  Треков: ${db.tracks.length}`);
      console.log(`  Плейлистов: ${(db.playlists||[]).length}`);
      console.log(`  Онлайн: ${db.users.filter(u=>u.isOnline).length}`);
      break;
    case 'admins': {
      const envList = ADMIN_ENV.length ? ADMIN_ENV.join(', ') : '(пусто)';
      const dbList = (db.admins || []).length ? db.admins.join(', ') : '(пусто)';
      console.log(`👑 Админы:\n  ENV (ADMIN_USERNAMES): ${envList}\n  DB:                    ${dbList}`);
      break;
    }
    case 'admin': {
      const sub = args[0];
      const name = normAdminName(args[1]);
      if (!sub || !name) { console.log('Использование: admin add <username> | admin del <username>'); break; }
      if (!Array.isArray(db.admins)) db.admins = [];
      if (sub === 'add') {
        if (db.admins.map(normAdminName).includes(name)) { console.log(`Уже админ: ${name}`); break; }
        const u = db.users.find(x => normAdminName(x.username) === name);
        if (!u) console.log(`⚠ Пользователь @${name} не найден в базе — запись всё равно добавлена, сработает при регистрации.`);
        db.admins.push(name);
        saveDb();
        console.log(`✅ @${name} назначен админом`);
      } else if (sub === 'del' || sub === 'remove' || sub === 'rm') {
        const before = db.admins.length;
        db.admins = db.admins.filter(a => normAdminName(a) !== name);
        saveDb();
        console.log(db.admins.length < before ? `✅ @${name} больше не админ` : `Не найден в db-списке: ${name}`);
      } else {
        console.log('Неизвестный подкоманд. add | del');
      }
      break;
    }
    case 'clear':
      console.clear(); break;
    case 'exit':
      console.log('Остановка сервера...');
      process.exit(0);
      break;
    case '': break;
    default:
      console.log(`Неизвестная команда: ${cmd}. Введите help.`);
  }
  rl.prompt();
});

rl.on('close', () => process.exit(0));
} // end if (process.stdin.isTTY)

// ─── Self-ping (keep-alive для Render Free / любого хостинга со сном) ─────────
// Каждые KEEPALIVE_INTERVAL_MS сервер делает GET на самого себя, чтобы не уснуть
// после 15 минут неактивности. Запускается только если задан PUBLIC_URL, иначе
// это бессмысленно (локально сервер и так не засыпает).
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
if (PUBLIC_URL) {
  const KEEPALIVE_MS = Number(process.env.KEEPALIVE_INTERVAL_MS) || 10 * 60 * 1000;
  const pingUrl = PUBLIC_URL.replace(/\/+$/, '') + '/api/downloads';
  setInterval(() => {
    // Используем global fetch (Node 18+). Ошибки игнорируем — это некритично.
    fetch(pingUrl).catch(() => {});
  }, KEEPALIVE_MS);
  console.log(`💓 Keep-alive: пингую ${pingUrl} каждые ${Math.round(KEEPALIVE_MS/60000)} мин`);
}

// ─── SPA fallback — должен быть ПОСЛЕ всех API маршрутов ─────────────────────
if (fs.existsSync(CLIENT_DIST)) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Vera Server запущен на http://0.0.0.0:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Uploads:   http://localhost:${PORT}/uploads`);
  console.log(`   Введите 'help' для списка команд\n`);
  if (process.stdin.isTTY && typeof rl !== 'undefined') rl.prompt();
});
