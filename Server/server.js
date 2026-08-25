/**
 * Vera Messenger Server
 * Express + Socket.io + JSON database (no native modules required)
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

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

// ─── paths ────────────────────────────────────────────────────────────────────
// В проде (Fly/Render) монтируем persistent-volume, путь передаём через env.
// Локально по умолчанию — ./Server/data и ./Server/uploads.
const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const DB_FILE     = process.env.DB_FILE     || path.join(DATA_DIR, 'vera.json');
const JWT_SECRET  = process.env.JWT_SECRET  || 'vera_multi_secret_key_2026';

for (const d of [DATA_DIR, UPLOADS_DIR,
  path.join(UPLOADS_DIR, 'music'),
  path.join(UPLOADS_DIR, 'avatars'),
  path.join(UPLOADS_DIR, 'files')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ─── JSON Database ────────────────────────────────────────────────────────────
let db = { users: [], chats: [], messages: [], tracks: [], chatMembers: [], playlists: [], favorites: [], devices: [], linkInvites: [], callLogs: [], bots: [], aiModels: [], aiSessions: [] };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
}

// При старте сервера все пользователи офлайн (сбрасываем stale-статус)
if (db.users) {
  db.users.forEach(u => { u.isOnline = false; });
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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
const MAX_DEVICES_PER_ACCOUNT = 2;
const LINK_INVITE_TTL_MS = 5 * 60 * 1000; // 5 минут

function normalizeDeviceId(raw) {
  const s = String(raw || '').trim();
  // Сохраняем читаемые символы: юзер-агент в перекодированном виде — ок.
  return s.slice(0, 160) || ('device-' + uuidv4());
}

function getDeviceForUser(userId, deviceId) {
  if (!deviceId) return null;
  return (db.devices || []).find(d => d.userId === userId && d.deviceId === deviceId);
}

function countUserDevices(userId) {
  return (db.devices || []).filter(d => d.userId === userId).length;
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

  const other = (db.devices || []).find(d => d.deviceId === cleanId && d.userId !== ownerId);
  if (other) return { ok: false, message: 'Это устройство уже привязано к другому аккаунту.' };
  const count = countUserDevices(ownerId);
  if (count >= MAX_DEVICES_PER_ACCOUNT) {
    return { ok: false, message: `Достигнут лимит устройств (${MAX_DEVICES_PER_ACCOUNT}).` };
  }

  const device = {
    id: uuidv4(),
    userId: ownerId,
    deviceId: cleanId,
    name: (newDeviceName || 'Второе устройство').slice(0, 80),
    isPrimary: count === 0,
    linkedViaQr: true,
    createdAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
  };
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
const server = http.createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Загрузка установщиков десктоп-приложения ────────────────────────────────
// Файлы кладём в Server/public/downloads/. Клиент читает /api/downloads,
// а бинарники раздаются по /downloads/<file>.
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');
try { fs.mkdirSync(DOWNLOADS_DIR, { recursive: true }); } catch {}
app.use('/downloads', express.static(DOWNLOADS_DIR, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  },
}));

// GET /api/downloads — список доступных установщиков с авто-детектом платформы.
app.get('/api/downloads', (req, res) => {
  let entries = [];
  try { entries = fs.readdirSync(DOWNLOADS_DIR); } catch { entries = []; }
  const files = entries
    .filter((name) => !name.startsWith('.') && !/^readme($|\.)/i.test(name))
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
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// ─── Multer storage ───────────────────────────────────────────────────────────
function makeStorage(subfolder) {
  return multer.diskStorage({
    destination: path.join(UPLOADS_DIR, subfolder),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, uuidv4() + ext);
    },
  });
}
const uploadMusic   = multer({ storage: makeStorage('music'),   limits: { fileSize: 50 * 1024 * 1024 } });
const uploadAvatar  = multer({ storage: makeStorage('avatars'), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadFile    = multer({ storage: makeStorage('files'),   limits: { fileSize: 100 * 1024 * 1024 } });

// ─── AUTH: аккаунт = устройство (без email/кода) ─────────────────────────────
// POST /api/auth/device — единственный вход/регистрация.
// Клиент шлёт { deviceId, deviceName }. Если устройство привязано к аккаунту
// (сам первый или добавлен по QR через /devices/link/accept) — возвращаем токен.
// Если нет — создаём новый аккаунт и делаем это устройство primary.
app.post('/api/auth/device', (req, res) => {
  const rawDeviceId = req.body?.deviceId;
  const deviceName = (req.body?.deviceName || '').toString().slice(0, 80) || 'Моё устройство';
  if (!rawDeviceId || typeof rawDeviceId !== 'string') {
    return res.status(400).json({ message: 'deviceId обязателен' });
  }
  const deviceId = normalizeDeviceId(rawDeviceId);

  // 1) Устройство уже привязано (первое или добавленное по QR) — вход.
  const existingDevice = (db.devices || []).find(d => d.deviceId === deviceId);
  if (existingDevice) {
    const user = db.users.find(u => u.id === existingDevice.userId);
    if (!user) return res.status(500).json({ message: 'Аккаунт не найден для устройства' });
    existingDevice.lastSeenAt = Date.now();
    if (deviceName) existingDevice.name = deviceName;
    user.isOnline = true;
    user.lastSeen = new Date().toISOString();
    saveDb();
    const accessToken = jwt.sign(
      { sub: user.id, username: user.username, deviceId },
      JWT_SECRET,
      { expiresIn: '365d' },
    );
    return res.json({ accessToken, user, isNewUser: false });
  }

  // 2) Новое устройство — создаём аккаунт, устройство помечаем primary.
  const shortId = deviceId.replace(/[^a-z0-9]/gi, '').slice(-8) || Date.now().toString(36);
  const user = {
    id: uuidv4(),
    email: null,
    phone: null,
    username: 'user_' + shortId,
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
  if (!dev.ok) {
    // Не должно случаться (счётчик 0), но на всякий случай откатим создание.
    db.users = db.users.filter(u => u.id !== user.id);
    db.chats = db.chats.filter(c => c.id !== savedChat.id);
    db.chatMembers = db.chatMembers.filter(m => m.chatId !== savedChat.id);
    return res.status(500).json({ message: dev.message || 'Не удалось создать устройство' });
  }
  saveDb();
  const accessToken = jwt.sign(
    { sub: user.id, username: user.username, deviceId },
    JWT_SECRET,
    { expiresIn: '365d' },
  );
  res.json({ accessToken, user, isNewUser: true });
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
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (user) { user.isOnline = false; user.lastSeen = new Date().toISOString(); saveDb(); }
  res.json({ success: true });
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  // Добавляем инфу об устройствах, чтобы клиент мог показать QR-экран
  const devices = (db.devices || []).filter(d => d.userId === user.id);
  res.json({ ...user, devices: devices.map(d => ({
    id: d.id, deviceId: d.deviceId, name: d.name,
    isPrimary: !!d.isPrimary, linkedViaQr: !!d.linkedViaQr,
    createdAt: d.createdAt, lastSeenAt: d.lastSeenAt,
  })) });
});

// ─── ADMIN routes ─────────────────────────────────────────────────────────────

// POST /api/admin/reload-db  — перечитать БД с диска без перезапуска сервера
app.post('/api/admin/reload-db', (req, res) => {
  reloadDb();
  res.json({ success: true, users: db.users.length, tracks: db.tracks.length, chats: db.chats.length });
});

// ─── USERS routes ─────────────────────────────────────────────────────────────

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

// GET /api/users/:id
app.get('/api/users/:id', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'Не найден' });
  res.json(user);
});

// PATCH /api/users/me
app.patch('/api/users/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'Не найден' });
  const allowed = ['firstName', 'lastName', 'username', 'bio', 'birthDate', 'country', 'region', 'city', 'themeId', 'chatPhoto'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) user[k] = req.body[k];
  }
  // username обязательно строка если задан
  if (req.body.username) user.username = req.body.username.trim();
  saveDb();
  res.json(user);
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

// ─── DEVICE routes (правило «устройство 1 = 1, второе — по QR») ───────────────

// GET /api/devices — список устройств текущего пользователя
app.get('/api/devices', authMiddleware, (req, res) => {
  const devices = (db.devices || []).filter(d => d.userId === req.userId).map(d => ({
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
  if (m) parsedToken = decodeURIComponent(m[1]);
  if (!parsedToken.startsWith('vera-link-')) return res.status(400).json({ message: 'Некорректная ссылка привязки' });

  const invite = (db.linkInvites || []).find(i => i.token === parsedToken);
  if (!invite) return res.status(404).json({ message: 'Ссылка привязки не найдена или уже использована' });

  const resAccept = acceptLinkInviteOnServer(invite, deviceId, deviceName);
  if (!resAccept.ok) return res.status(403).json({ message: resAccept.message });
  saveDb();
  const owner = db.users.find(u => u.id === invite.userId);
  res.json({ ok: true, device: resAccept.device, accountUser: owner });
});

// DELETE /api/devices/:id — отвязать устройство
app.delete('/api/devices/:id', authMiddleware, (req, res) => {
  const devices = (db.devices || []).filter(d => d.userId === req.userId);
  const target = devices.find(d => d.id === req.params.id);
  if (!target) return res.status(404).json({ message: 'Устройство не найдено' });
  if (target.isPrimary && devices.length === 1) {
    return res.status(400).json({ message: 'Нельзя отвязать единственное устройство аккаунта' });
  }
  db.devices = db.devices.filter(d => d.id !== target.id);
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
        role: cm.role || 'member',
        joinedAt: cm.joinedAt,
        isMuted: cm.muted || false,
        user: db.users.find(u => u.id === cm.userId) || null,
      }));
    const lastMsg = db.messages
      .filter(msg => msg.chatId === chat.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
    const unreadCount = db.messages.filter(msg =>
      msg.chatId === chat.id && !msg.readBy?.includes(req.userId) && msg.senderId !== req.userId
    ).length;
    return { ...chat, type: chat.type || 'direct', members, lastMessage: lastMsg, unreadCount };
  }).filter(Boolean);

  chats.sort((a, b) => {
    const ta = a.lastMessage?.createdAt || a.createdAt;
    const tb = b.lastMessage?.createdAt || b.createdAt;
    return new Date(tb) - new Date(ta);
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
      id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'member',
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
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'member',
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
    type: 'group',
    name: name || 'Группа',
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
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role,
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
    name: name || 'Канал',
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
app.get('/api/chats/:id', authMiddleware, (req, res) => {
  const isMember = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!isMember) return res.status(403).json({ message: 'Нет доступа' });
  const chat = db.chats.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ message: 'Чат не найден' });
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'member',
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

// PATCH /api/chats/:id  (обновить название/описание/аватар — только owner/admin)
app.patch('/api/chats/:id', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа к чату' });
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Чат не найден' });

  // Для групп/каналов — только admin/owner могут редактировать
  if ((chat.type === 'group' || chat.type === 'channel') && member.role === 'member') {
    return res.status(403).json({ message: 'Только администраторы могут редактировать группу' });
  }

  const { name, description, avatarUrl } = req.body;
  if (name !== undefined) chat.name = name;
  if (description !== undefined) chat.description = description;
  if (avatarUrl !== undefined) chat.avatarUrl = avatarUrl;
  saveDb();

  // Возвращаем с members (в формате ChatMember с role)
  const members = db.chatMembers.filter(m => m.chatId === chatId).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role,
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

// DELETE /api/chats/:id  (удалить чат — любой участник)
app.delete('/api/chats/:id', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'Нет доступа к чату' });
  // Любой участник может удалить чат (для себя это означает "покинуть и удалить свои сообщения")
  // Полное удаление чата делает любой участник

  const chatIdx = db.chats.findIndex(c => c.id === chatId);
  if (chatIdx === -1) return res.status(404).json({ message: 'Чат не найден' });

  const removedMessages = db.messages.filter(m => m.chatId === chatId).length;
  const removedMembers  = db.chatMembers.filter(m => m.chatId === chatId).length;

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

// GET /api/messages/:chatId
app.get('/api/messages/:chatId', authMiddleware, (req, res) => {
  const isMember = db.chatMembers.find(m => m.chatId === req.params.chatId && m.userId === req.userId);
  if (!isMember) return res.status(403).json({ message: 'Нет доступа' });

  const { limit = 50, before } = req.query;
  let msgs = db.messages.filter(m => m.chatId === req.params.chatId);
  if (before) msgs = msgs.filter(m => new Date(m.createdAt) < new Date(before));
  msgs = msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-parseInt(limit));

  // Normalize fields for client (text→content, url→fileUrl)
  const result = msgs.map(m => {
    const sender = db.users.find(u => u.id === m.senderId) || null;
    const attachments = (m.attachments || []).map(a => ({
      id: a.id || m.id,
      fileUrl: a.url || a.fileUrl || '',
      fileName: a.originalName || a.fileName || '',
      fileSize: a.size || a.fileSize || 0,
      mimeType: a.mimeType || '',
    }));
    return {
      ...m,
      content: m.text || m.content || '',
      attachments,
      sender,
      isEdited: !!(m.editedAt),
      isPinned: false,
      isDeleted: false,
      type: m.type || (attachments.length > 0 ? 'document' : 'text'),
    };
  });
  res.json(result);
});

// Общий обработчик отправки сообщения
function handleSendMessage(chatId, userId, body, res) {
  const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
  if (!isMember) return res.status(403).json({ message: 'Нет доступа' });

  const { text, content, replyToId, attachments, type } = body;
  const msgContent = content || text || '';
  if (!msgContent && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ message: 'Пустое сообщение' });
  }

  const normAttachments = (attachments || []).map(a => ({
    id: a.id || uuidv4(),
    fileUrl: a.url || a.fileUrl || '',
    fileName: a.originalName || a.fileName || '',
    fileSize: a.size || a.fileSize || 0,
    mimeType: a.mimeType || '',
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

  const sender = db.users.find(u => u.id === userId);
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


// PUT /api/messages/:id  (edit)
app.put('/api/messages/:id', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ message: 'Не найдено' });
  if (msg.senderId !== req.userId) return res.status(403).json({ message: 'Нет прав' });
  msg.text = req.body.text;
  msg.editedAt = new Date().toISOString();
  saveDb();
  io.to(`chat:${msg.chatId}`).emit('message:edited', msg);
  res.json(msg);
});

// DELETE /api/messages/:id
app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  const idx = db.messages.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: 'Не найдено' });
  if (db.messages[idx].senderId !== req.userId) return res.status(403).json({ message: 'Нет прав' });
  const msg = db.messages[idx];
  db.messages.splice(idx, 1);
  saveDb();
  io.to(`chat:${msg.chatId}`).emit('message:deleted', { id: msg.id, chatId: msg.chatId });
  res.json({ success: true });
});

// POST /api/messages/:id/read
app.post('/api/messages/:id/read', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ message: 'Не найдено' });
  if (!msg.readBy) msg.readBy = [];
  if (!msg.readBy.includes(req.userId)) msg.readBy.push(req.userId);
  saveDb();
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
  if (!data) return res.status(400).json({ message: 'Нет данных' });
  // data должен быть строкой base64 (без префикса data:...)
  const base64 = data.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  const ext = (mimeType || 'image/jpeg').split('/')[1]?.replace('jpeg','jpg') || 'jpg';
  const filename = uuidv4() + '.' + ext;
  const subfolder = (mimeType || '').startsWith('image') ? 'avatars' : 'files';
  const dest = path.join(UPLOADS_DIR, subfolder, filename);
  fs.writeFileSync(dest, buf);
  res.json({
    url: `/uploads/${subfolder}/${filename}`,
    originalName: fileName || filename,
    size: buf.length,
    mimeType: mimeType || 'image/jpeg',
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
app.get('/api/ai-lmm/health', authMiddleware, (req, res) => {
  res.json({ status: 'ok', engine: 'lmm-simple' });
});
app.post('/api/ai-lmm/chat', authMiddleware, (req, res) => {
  const text = String(req.body?.message || '');
  res.json({ reply: `[LMM] Эхо: ${text.slice(0, 100)}` });
});

// Voice: транскрибация (заглушка, сохранение состояния)
app.post('/api/voice/transcribe/:attachmentId', authMiddleware, (req, res) => {
  res.json({ text: '', status: 'unavailable', message: 'Распознавание речи доступно в версии с ai-engine' });
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
  cors: { origin: true, credentials: true },
});

const userSockets = new Map(); // userId -> Set<socketId>

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  if (!token) return next(new Error('Unauthorized'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.sub;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
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

  // Send message via socket
  socket.on('message:send', async (data, callback) => {
    const { chatId, text, content, replyToId, attachments, type } = data;
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return callback && callback({ error: 'Нет доступа' });

    const msgContent = content || text || '';
    const normAttachments = (attachments || []).map(a => ({
      id: a.id || uuidv4(),
      fileUrl: a.url || a.fileUrl || '',
      fileName: a.originalName || a.fileName || '',
      fileSize: a.size || a.fileSize || 0,
      mimeType: a.mimeType || '',
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
    socket.to(`chat:${chatId}`).emit('typing:start', { userId, chatId });
  });
  socket.on('typing:stop', (chatId) => {
    socket.to(`chat:${chatId}`).emit('typing:stop', { userId, chatId });
  });

  // Read message
  socket.on('message:read', ({ chatId, messageId }) => {
    const msg = db.messages.find(m => m.id === messageId);
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

  // Звонок: сохраняем в журнал
  socket.on('call:offer', (data) => {
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
    sendToUser(data.targetUserId, 'call:answered', {
      answer: data.answer,
      fromUserId: userId,
    });
  });

  // ICE кандидат
  socket.on('call:ice-candidate', (data) => {
    sendToUser(data.targetUserId, 'call:ice-candidate', {
      candidate: data.candidate,
      fromUserId: userId,
    });
  });

  // Завершить / отклонить звонок
  socket.on('call:end', (data) => {
    const reason = data.reason || 'ended';
    sendToUser(data.targetUserId, 'call:ended', {
      fromUserId: userId,
      reason,
    });

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

  socket.on('disconnect', () => {
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
      const msgCount = db.messages.filter(m => m.chatId === chat.id).length;
      const memberCount = db.chatMembers.filter(m => m.chatId === chat.id).length;
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
