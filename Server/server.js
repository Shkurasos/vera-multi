/**
 * Vera Messenger Server
 * Express + Socket.io + JSON database (no native modules required)
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

// SEC: РїРѕРґРіСЂСѓР¶Р°РµРј Server/.env Р»РѕРєР°Р»СЊРЅРѕ, С‡С‚РѕР±С‹ РЅРµ С‚Р°СЃРєР°С‚СЊ СЃРµРєСЂРµС‚С‹ РІ PowerShell.
// Р’ РїСЂРѕРґРµ (Render) РїРµСЂРµРјРµРЅРЅС‹Рµ РїСЂРёС…РѕРґСЏС‚ РёР· РїР°РЅРµР»Рё вЂ” dotenv РёС… РЅРµ РїРµСЂРµР·Р°РїРёСЃС‹РІР°РµС‚.
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch {}

// в”Ђв”Ђв”Ђ resolve modules from Server/node_modules (fallback to root workspaces) в”Ђв”Ђв”Ђ
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
const { hashPassword, verifyAndMigrate } = require('./auth-crypto');
const multer = require(tryResolve('multer'));
const { v4: uuidv4 } = require(tryResolve('uuid'));
const cookieParser = require(tryResolve('cookie-parser'));
const crypto = require('crypto');
const moderation = require('./moderation');
const { createMediaAuth } = require('./media-auth');
const { createDownloadStamper } = require('./download-stamp');
const blocks = require('./blocks');
const themes = require('./themes');
const adminWallpapers = require('./admin-wallpapers');
const adminFonts = require('./admin-fonts');
const musicShare = require('./music-share');
const protoBoard = require('./proto-board');
const communityThemes = require('./community-themes');
const communityIconPacks = require('./community-icon-packs');
const reactionSkins = require('./reaction-skins');

const { stripImageMetadata, imageType } = require('./image-privacy');
const { compressStoredUpload, wantsCompression } = require('./media-compress');

function sanitizeStoredImage(filePath, mimeType, originalName = filePath) {
  try {
    const original = fs.readFileSync(filePath);
    const clean = stripImageMetadata(original, mimeType, originalName);
    if (!clean.equals(original)) fs.writeFileSync(filePath, clean);
    return { sha256: crypto.createHash('sha256').update(clean).digest('hex'), size: clean.length,
      mimetype: imageType(clean) || mimeType };
  } catch { return null; }
}

function sanitizeImageDataUrl(value) {
  if (typeof value !== 'string' || !/^data:/i.test(value)) return value;
  const match = value.match(/^data:((?:image|audio|video)\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return '';
  try {
    const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const encoded = match[2].replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) return '';
    const decoded = Buffer.from(encoded, 'base64');
    if (!decoded.length || decoded.toString('base64') !== encoded) return '';
    const clean = stripImageMetadata(decoded, mime);
    return `data:${imageType(clean) || mime};base64,${clean.toString('base64')}`;
  } catch { return ''; }
}

function messageIntegrityHash(message) {
  const payload = {
    id: message.id, chatId: message.chatId, senderId: message.senderId, text: message.text || '',
    replyToId: message.replyToId || null, forwardFromId: message.forwardFromId || null,
    poll: message.poll ? { question: message.poll.question, multiple: message.poll.multiple,
      options: message.poll.options.map(o => ({ id: o.id, text: o.text })) } : null,
    type: message.type || 'text', attachments: (message.attachments || []).map(a => ({
      id: a.id, fileUrl: a.fileUrl, fileName: a.fileName, fileSize: a.fileSize, mimeType: a.mimeType, sha256: a.sha256 || null,
    })), createdAt: message.createdAt,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function attachmentIntegrityHash(attachment) {
  const url = String(attachment?.fileUrl || attachment?.url || '');
  if (/^\/uploads\/[A-Za-z0-9._\-/]+$/.test(url) && !url.includes('..')) {
    const filePath = path.join(UPLOADS_DIR, ...url.slice('/uploads/'.length).split('/'));
    if (path.relative(UPLOADS_DIR, filePath).startsWith('..')) return null;
    try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); } catch { return null; }
  }
  if (url.startsWith('data:')) {
    const clean = sanitizeImageDataUrl(url);
    if (clean) return crypto.createHash('sha256').update(Buffer.from(clean.slice(clean.indexOf(',') + 1), 'base64')).digest('hex');
  }
  return null;
}

function sanitizeProfileMediaStore(store) {
  if (!store || typeof store !== 'object') return store;
  for (const key of Object.keys(store)) {
    if (typeof store[key] === 'string' && /^data:(?:image|audio|video)\//i.test(store[key])) {
      store[key] = sanitizeImageDataUrl(store[key]);
    } else if (store[key] && typeof store[key] === 'object') sanitizeProfileMediaStore(store[key]);
  }
  for (const key of ['bannerUrl', 'aboutMediaUrl']) {
    if (Object.hasOwn(store, key)) store[`${key}Sha256`] = attachmentIntegrityHash({ fileUrl: store[key] });
  }
  return store;
}

// в”Ђв”Ђв”Ђ paths в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р’ РїСЂРѕРґРµ (Fly/Render) РјРѕРЅС‚РёСЂСѓРµРј persistent-volume, РїСѓС‚СЊ РїРµСЂРµРґР°С‘Рј С‡РµСЂРµР· env.
// Р›РѕРєР°Р»СЊРЅРѕ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ вЂ” ./Server/data Рё ./Server/uploads.
const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const DB_FILE     = process.env.DB_FILE     || path.join(DATA_DIR, 'vera.json');
const OLLAMA_URL = String(process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || 'llama3.2').trim();
const LLM_SYSTEM_PROMPT = 'РўС‹ Р»РѕРєР°Р»СЊРЅС‹Р№ СЂСѓСЃСЃРєРѕСЏР·С‹С‡РЅС‹Р№ Р°СЃСЃРёСЃС‚РµРЅС‚ Vera РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°. Р’СЃРµРіРґР° РѕС‚РІРµС‡Р°Р№ РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ, РµСЃР»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЏРІРЅРѕ РЅРµ РїРѕРїСЂРѕСЃРёР» РґСЂСѓРіРѕР№ СЏР·С‹Рє. РџРёС€Рё СЃРѕРґРµСЂР¶Р°С‚РµР»СЊРЅРѕ Рё РЅРµ РІРѕР·РІСЂР°С‰Р°Р№ РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚. РќРµ РїСЂРёС‡РёРЅСЏР№ РІСЂРµРґ Р»СЋРґСЏРј, СЃРёСЃС‚РµРјР°Рј РёР»Рё РґР°РЅРЅС‹Рј; РЅРµ РїРѕРјРѕРіР°Р№ СЃ РѕРїР°СЃРЅС‹РјРё РёР»Рё РЅРµР·Р°РєРѕРЅРЅС‹РјРё РґРµР№СЃС‚РІРёСЏРјРё. Р—Р°С‰РёС‰Р°Р№ РїСЂРёРІР°С‚РЅРѕСЃС‚СЊ, РЅРµ Р·Р°РїСЂР°С€РёРІР°Р№ Рё РЅРµ СЂР°СЃРєСЂС‹РІР°Р№ СЃРµРєСЂРµС‚С‹. Р‘СѓРґСЊ С‡РµСЃС‚РµРЅ Рѕ РЅРµРѕРїСЂРµРґРµР»С‘РЅРЅРѕСЃС‚Рё Рё РѕРїРёСЂР°Р№СЃСЏ РЅР° РїСЂРѕРІРµСЂСЏРµРјС‹Рµ Р·РЅР°РЅРёСЏ. Р•СЃР»Рё Р·Р°РїСЂРѕСЃ РѕРїР°СЃРµРЅ, РѕС‚РєР°Р¶РёСЃСЊ Рё РїСЂРµРґР»РѕР¶Рё Р±РµР·РѕРїР°СЃРЅСѓСЋ Р°Р»СЊС‚РµСЂРЅР°С‚РёРІСѓ.';
// SEC: JWT_SECRET РѕР±СЏР·Р°С‚РµР»РµРЅ РІ РїСЂРѕРґРµ. Р’ РґРµРІРµ РіРµРЅРµСЂРёСЂСѓРµРј СЌС„РµРјРµСЂРЅС‹Р№ (С‚РѕРєРµРЅС‹ РЅРµ РїРµСЂРµР¶РёРІСѓС‚ СЂРµСЃС‚Р°СЂС‚).
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (IS_PROD) {
    console.error('[FATAL] JWT_SECRET is missing or too short (<32 chars). Set env var JWT_SECRET.');
    process.exit(1);
  }
  const rnd = require('crypto').randomBytes(48).toString('hex');
  console.warn('[SEC] JWT_SECRET РЅРµ Р·Р°РґР°РЅ вЂ” РёСЃРїРѕР»СЊР·СѓСЋ СЌС„РµРјРµСЂРЅС‹Р№ dev-РєР»СЋС‡. Р’СЃРµ С‚РѕРєРµРЅС‹ СЃР±СЂРѕСЃСЏС‚СЃСЏ РїСЂРё СЂРµСЃС‚Р°СЂС‚Рµ.');
  return rnd;
})();
// SEC: whitelist origin С‡РµСЂРµР· env CORS_ORIGIN (CSV). РџСѓР±Р»РёС‡РЅС‹Р№ URL (Render/PUBLIC_URL) РґРѕР±Р°РІР»СЏРµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.
const CORS_ALLOWED = String(process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const _pub = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
if (_pub) CORS_ALLOWED.push(_pub.replace(/\/+$/, ''));
function corsOriginFn(origin, cb) {
  // Same-origin / curl / server-to-server (РЅРµС‚ Origin) вЂ” РїСЂРѕРїСѓСЃРєР°РµРј.
  if (!origin) return cb(null, true);
  if (CORS_ALLOWED.length === 0) {
    // Р’ СЂР°Р·СЂР°Р±РѕС‚РєРµ СЂР°Р·СЂРµС€Р°РµРј С‚РѕР»СЊРєРѕ Р»РѕРєР°Р»СЊРЅС‹Р№ РєР»РёРµРЅС‚ Vite, Р° РЅРµ Р»СЋР±РѕР№ origen
    return cb(null, origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173');
  }
  if (CORS_ALLOWED.includes(origin)) return cb(null, true);
  return cb(null, false);
}

for (const d of [DATA_DIR, UPLOADS_DIR,
  path.join(UPLOADS_DIR, 'music'),
  path.join(UPLOADS_DIR, 'avatars'),
  path.join(UPLOADS_DIR, 'files'),
  path.join(UPLOADS_DIR, 'proto')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// в”Ђв”Ђв”Ђ Database в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р Р°Р±РѕС‡Р°СЏ РєРѕРїРёСЏ РґР°РЅРЅС‹С… Р¶РёРІС‘С‚ РІ РїР°РјСЏС‚Рё (db), РЅР° РґРёСЃРє СѓС…РѕРґРёС‚ С‡РµСЂРµР· store/:
// РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ вЂ” Р·Р°С€РёС„СЂРѕРІР°РЅРЅС‹Р№ SQLite (vera-store.db, AES-256-GCM РЅР° Р·Р°РїРёСЃСЊ,
// РєР»СЋС‡ VERA_KEK), STORE_DRIVER=json вЂ” СЃС‚Р°СЂС‹Р№ РѕС‚РєСЂС‹С‚С‹Р№ vera.json РґР»СЏ РѕС‚РєР°С‚Р°.
// РџРёС€СѓС‚СЃСЏ С‚РѕР»СЊРєРѕ РёР·РјРµРЅРёРІС€РёРµСЃСЏ Р·Р°РїРёСЃРё. РЎС‚Р°СЂС‹Р№ vera.json РїСЂРё РїРµСЂРІРѕРј СЃС‚Р°СЂС‚Рµ
// РёРјРїРѕСЂС‚РёСЂСѓРµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё (СЃРј. store/index.js).
const dataSource = require('./store').openDataSource();
console.log(`[DB] С…СЂР°РЅРёР»РёС‰Рµ: ${dataSource.kind} (${dataSource.file})`);
let db = { users: [], chats: [], messages: [], tracks: [], chatMembers: [], playlists: [], favorites: [], devices: [], linkInvites: [], callLogs: [], bots: [], aiModels: [], aiSessions: [], walletOrders: [], refreshTokens: [], ipBans: [], moderationBans: [], moderationWarnings: [], deletedMessages: [], reports: [], moderationIps: {} };
{
  const stored = dataSource.load();
  if (stored) {
    db = stored;
    if (dataSource.loadExplicitTables) dataSource.loadExplicitTables(db);
  }
}
// SEC/ops: РІРѕР·РІСЂР°С‰Р°РµРј РєР°С‚Р°Р»РѕРі С‚РµРј Рё РѕР±РѕРµРІ РёР· СЂРµРїРѕР·РёС‚РѕСЂРёСЏ, РµСЃР»Рё РІ Р‘Р” РµРіРѕ РЅРµС‚.
// РќР° Р°СЂРµРЅРґРѕРІР°РЅРЅРѕРј СЃРµСЂРІРµСЂРµ РґРёСЃРє РѕР±С‹С‡РЅРѕ СЌС„РµРјРµСЂРЅС‹Р№: РїРѕСЃР»Рµ СЂРµСЃС‚Р°СЂС‚Р°/СЂРµРґРµРїР»РѕСЏ
// Р±Р°Р·Р° РѕР±РЅСѓР»СЏРµС‚СЃСЏ, Рё РІСЃРµ РїСЂР°РІРєРё Р°РґРјРёРЅР° РјРѕР»С‡Р° РїСЂРѕРїР°РґР°СЋС‚ вЂ” РїРѕР»СЊР·РѕРІР°С‚РµР»Рё
// РІРѕР·РІСЂР°С‰Р°СЋС‚СЃСЏ Рє Р·Р°РІРѕРґСЃРєРёРј С‚РµРјР°Рј. Server/content/ Р»РµР¶РёС‚ РІ СЂРµРїРѕР·РёС‚РѕСЂРёРё,
// РїРѕСЌС‚РѕРјСѓ РїСЂРё СЃС‚Р°СЂС‚Рµ РєР°С‚Р°Р»РѕРі РїРѕРґРЅРёРјР°РµС‚СЃСЏ СЃР°Рј. РќРµ Р·Р°С‚РёСЂР°РµС‚ Р¶РёРІС‹Рµ РїСЂР°РІРєРё:
// СЃСЂР°Р±Р°С‚С‹РІР°РµС‚ С‚РѕР»СЊРєРѕ РєРѕРіРґР° РєР°С‚Р°Р»РѕРіР° РІ Р‘Р” РґРµР№СЃС‚РІРёС‚РµР»СЊРЅРѕ РЅРµС‚.
let contentSeeded = false;
try { contentSeeded = require('./backup-content').seedOnBoot(db); } catch (e) {
  console.warn(`[content] Р°РІС‚РѕРІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ РєР°С‚Р°Р»РѕРіР° РЅРµ СѓРґР°Р»РѕСЃСЊ: ${e.message}`);
}
require('./backup-content').attachLiveDb(() => db);

// PERF/DoS: СЂР°РЅСЊС€Рµ РљРђР–Р”Р«Р™ РІС‹Р·РѕРІ (РІРєР»СЋС‡Р°СЏ read-receipt РЅР° РєР°Р¶РґРѕРµ РїСЂРѕС‡РёС‚Р°РЅРЅРѕРµ
// СЃРѕРѕР±С‰РµРЅРёРµ) СЃРёРЅС…СЂРѕРЅРЅРѕ СЃРµСЂРёР°Р»РёР·РѕРІР°Р» Рё РїРёСЃР°Р» РІСЃСЋ Р‘Р” РЅР° РґРёСЃРє. РўРµРїРµСЂСЊ Р·Р°РїРёСЃРё
// РєРѕР°Р»РµСЃС†РёСЂСѓСЋС‚СЃСЏ РЅРµ С‡Р°С‰Рµ SAVE_DEBOUNCE_MS + РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅС‹Р№ СЃР±СЂРѕСЃ РЅР° exit/СЃРёРіРЅР°Р»С‹.
// РћС€РёР±РєРё Р·Р°РїРёСЃРё Р±РѕР»СЊС€Рµ РЅРµ Р»РѕРІСЏС‚СЃСЏ С…РµРЅРґР»РµСЂР°РјРё РєР°Рє В«РѕС‚РєР°С‚Рё РѕРїРµСЂР°С†РёСЋВ» вЂ” СЃРѕСЃС‚РѕСЏРЅРёРµ
// Р¶РёРІС‘С‚ РІ РїР°РјСЏС‚Рё Рё РґРѕРїРёС€РµС‚СЃСЏ С‚Р°Р№РјРµСЂРѕРј; vm-С‚РµСЃС‚С‹ РїРѕРґРјРµРЅСЏСЋС‚ saveDb СЃР°РјРё.
//
// РћР±СЉСЏРІР»РµРЅРѕ Р”Рћ РјРёРіСЂР°С†РёР№ РЅРёР¶Рµ: РјРёРіСЂР°С†РёСЏ РјР°СЂРєРµС‚РїР»РµР№СЃР° СЃР°РјР° Р·РѕРІС‘С‚ saveDb(), Рё РїСЂРё
// РѕР±СЂР°С‚РЅРѕРј РїРѕСЂСЏРґРєРµ СЌС‚Рѕ Р±С‹Р» Р±С‹ ReferenceError (let РІ TDZ) РЅР° Р»СЋР±РѕР№ Р‘Р”, РіРґРµ
// РјРёРіСЂР°С†РёСЏ РµС‰С‘ РЅРµ РїСЂРѕС…РѕРґРёР»Р°.
const SAVE_DEBOUNCE_MS = Number(process.env.DB_SAVE_DEBOUNCE_MS) || 300;
let saveDbTimer = null;
let saveDbDirty = false;
// РњРѕРґСѓР»СЊ Р±РѕС‚РѕРІ (bots.js), СЂРµРіРёСЃС‚СЂРёСЂСѓРµС‚СЃСЏ РїРѕСЃР»Рµ СЃРѕР·РґР°РЅРёСЏ io. РћР±СЉСЏРІР»РµРЅ Р·РґРµСЃСЊ,
// РІ РЅР°С‡Р°Р»Рµ С„Р°Р№Р»Р°: handleSendMessage, СЃРѕРєРµС‚-РѕС‚РїСЂР°РІРєР° Рё reloadDb РѕР±СЂР°С‰Р°СЋС‚СЃСЏ Рє
// РЅРµРјСѓ, Рё РѕР±СЂР°С‰РµРЅРёРµ Рє let РґРѕ РѕР±СЉСЏРІР»РµРЅРёСЏ Р±С‹Р»Рѕ Р±С‹ ReferenceError.
let botsModule = null;
if (!Array.isArray(db.refreshTokens)) db.refreshTokens = [];
if (!Array.isArray(db.loginEvents)) db.loginEvents = [];
if (!Array.isArray(db.authChallenges)) db.authChallenges = [];
if (!Array.isArray(db.ipBans)) db.ipBans = [];
if (!Array.isArray(db.moderationBans)) db.moderationBans = [];
if (!Array.isArray(db.moderationWarnings)) db.moderationWarnings = [];
if (!Array.isArray(db.deletedMessages)) db.deletedMessages = [];
if (!Array.isArray(db.reports)) db.reports = [];
// Р›РёС‡РЅС‹Рµ Р±Р»РѕРєРёСЂРѕРІРєРё (userBlocks) Рё Р°РїРµР»Р»СЏС†РёРё (appeals).
if (!Array.isArray(db.userBlocks)) db.userBlocks = [];
if (!Array.isArray(db.appeals)) db.appeals = [];
// РћС‚Р·С‹РІС‹, РёРґРµРё Рё Р±Р°РіРё РёР· /feedback РІ /hub.
if (!Array.isArray(db.feedback)) db.feedback = [];
if (!db.moderationIps || typeof db.moderationIps !== 'object' || Array.isArray(db.moderationIps)) db.moderationIps = {};
// РђРЅС‚Рё-РјСѓР»СЊС‚РёР°РєРєР°СѓРЅС‚РёРЅРі: С‚РѕР»СЊРєРѕ РЅРµРѕР±СЂР°С‚РёРјС‹Рµ HMAC-С…СЌС€Рё IP Рё РѕС‚РїРµС‡Р°С‚РєР° СѓСЃС‚СЂРѕР№СЃС‚РІР°.
// РЎС‹СЂС‹Рµ IP/С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё РЅРµ С…СЂР°РЅСЏС‚СЃСЏ вЂ” РёР· С…СЌС€Р° Р»РёС‡РЅРѕСЃС‚СЊ РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РЅРµР»СЊР·СЏ.
if (!Array.isArray(db.regLedger)) db.regLedger = [];
if (!Array.isArray(db.customItems)) db.customItems = [];
if (!db.creatorProfiles || typeof db.creatorProfiles !== 'object') db.creatorProfiles = {};
if (typeof db.platformRevenueVp !== 'number') db.platformRevenueVp = 0;
if (!Array.isArray(db.admins)) db.admins = [];
if (!db.userStores || typeof db.userStores !== 'object') db.userStores = {};
// РљР°С‚Р°Р»РѕРі РІСЃС‚СЂРѕРµРЅРЅС‹С… С‚РµРј, РєРѕС‚РѕСЂС‹Рј СѓРїСЂР°РІР»СЏРµС‚ Р°РґРјРёРЅ: РїСЂР°РІРєРё РІРёРґРЅС‹ Р’РЎР•Рњ
// РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРј (РІ РѕС‚Р»РёС‡РёРµ РѕС‚ userStores СЌС‚Рѕ РЅРµ РїРµСЂСЃРѕРЅР°Р»СЊРЅРѕРµ С…СЂР°РЅРёР»РёС‰Рµ).
if (!db.builtinThemes || typeof db.builtinThemes !== 'object') {
  db.builtinThemes = { overrides: {}, removed: [], added: [], updatedAt: null };
}
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

if (!Array.isArray(db.chats)) db.chats = [];
if (migrateChatKinds() || contentSeeded) saveDb();

// РџСЂРё СЃС‚Р°СЂС‚Рµ СЃРµСЂРІРµСЂР° РІСЃРµ РїРѕР»СЊР·РѕРІР°С‚РµР»Рё РѕС„Р»Р°Р№РЅ (СЃР±СЂР°СЃС‹РІР°РµРј stale-СЃС‚Р°С‚СѓСЃ)
if (db.users) {
  db.users.forEach(u => { u.isOnline = false; });
}

// PERF/DoS: Р·Р°РїРёСЃРё РєРѕР°Р»РµСЃС†РёСЂСѓСЋС‚СЃСЏ (СЃРј. saveDb РІС‹С€Рµ, РѕР±СЉСЏРІР»РµРЅ РґРѕ РјРёРіСЂР°С†РёР№).
// РҐСЂР°РЅРёР»РёС‰Рµ СЃР°РјРѕ РїРёС€РµС‚ С‚РѕР»СЊРєРѕ РёР·РјРµРЅРёРІС€РёРµСЃСЏ Р·Р°РїРёСЃРё РѕРґРЅРѕР№ С‚СЂР°РЅР·Р°РєС†РёРµР№.
function saveDbNow() {
  if (dataSource.saveExplicitTables) dataSource.saveExplicitTables(db);
  dataSource.save(db);
}

function saveDb() {
  saveDbDirty = true;
  if (saveDbTimer) return;
  saveDbTimer = setTimeout(() => {
    saveDbTimer = null;
    if (!saveDbDirty) return;
    saveDbDirty = false;
    try { saveDbNow(); } catch (e) { console.error('[db] save failed:', e); }
  }, SAVE_DEBOUNCE_MS);
}

function flushDb() {
  if (saveDbTimer) { clearTimeout(saveDbTimer); saveDbTimer = null; }
  if (!saveDbDirty) return;
  saveDbDirty = false;
  try { saveDbNow(); } catch (e) { console.error('[db] flush failed:', e); }
}

// setTimeout РЅРµ СЃСЂР°Р±Р°С‚С‹РІР°РµС‚ РїРѕСЃР»Рµ РІС‹С…РѕРґР° РёР· С†РёРєР»Р° СЃРѕР±С‹С‚РёР№ вЂ” РїРёС€РµРј СЃРёРЅС…СЂРѕРЅРЅРѕ.
process.on('exit', () => {
  if (saveDbDirty) {
    saveDbDirty = false;
    try { saveDbNow(); } catch {}
  }
  try { dataSource.close(); } catch {}
});
// beforeExit: РїРѕСЃР»РµРґРЅРёР№ С€Р°РЅСЃ СЃРёРЅС…СЂРѕРЅРЅРѕ СЃР±СЂРѕСЃРёС‚СЊ РѕС‚Р»РѕР¶РµРЅРЅСѓСЋ Р·Р°РїРёСЃСЊ, РїРѕРєР° С†РёРєР»
// СЃРѕР±С‹С‚РёР№ РµС‰С‘ Р¶РёРІ (СЃСЋРґР° РјС‹ РќР• РїРѕРїР°РґР°РµРј РїСЂРё СЏРІРЅРѕРј process.exit() Рё СЃРёРіРЅР°Р»Р°С… вЂ”
// РёС… Р»РѕРІРёРј РЅРёР¶Рµ РѕС‚РґРµР»СЊРЅРѕ).
process.on('beforeExit', () => { flushDb(); });
// SIGBREAK вЂ” СЌС‚Рѕ Ctrl+Break РІ РєРѕРЅСЃРѕР»Рё Windows; SIGHUP вЂ” Р·Р°РєСЂС‹С‚РёРµ С‚РµСЂРјРёРЅР°Р»Р°.
// Р‘РµР· РЅРёС… РѕС‚Р»РѕР¶РµРЅРЅР°СЏ Р·Р°РїРёСЃСЊ (РІ С‚.С‡. СѓРґР°Р»РµРЅРёРµ С‡Р°С‚Р°) С‚РµСЂСЏР»Р°СЃСЊ РїСЂРё С‚Р°РєРёС…
// РїРµСЂРµР·Р°РїСѓСЃРєР°С…, Рё РґР°РЅРЅС‹Рµ В«РІРѕР·РІСЂР°С‰Р°Р»РёСЃСЊВ» РїРѕСЃР»Рµ СЂРµСЃС‚Р°СЂС‚Р°.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => { flushDb(); process.exit(0); });
}

function reloadDb() {
  // РћС‚РјРµРЅСЏРµРј РѕС‚Р»РѕР¶РµРЅРЅСѓСЋ Р·Р°РїРёСЃСЊ: pending-СЃРѕС…СЂР°РЅРµРЅРёРµ РїРµСЂРµР·Р°РїРёСЃР°Р»Рѕ Р±С‹ Р·Р°РЅРѕРІРѕ
  // Р·Р°РіСЂСѓР¶РµРЅРЅСѓСЋ СЃ РґРёСЃРєР° Р‘Р” СЃС‚Р°СЂС‹Рј СЃРѕРґРµСЂР¶РёРјС‹Рј РїР°РјСЏС‚Рё.
  if (saveDbTimer) { clearTimeout(saveDbTimer); saveDbTimer = null; }
  saveDbDirty = false;
  {
    try {
      const stored = dataSource.load();
      if (!stored) return;
      db = stored;
      if (!db.users) db.users = [];
      if (!db.chats) db.chats = [];
      if (!db.messages) db.messages = [];
      if (!db.tracks) db.tracks = [];
      if (!db.chatMembers) db.chatMembers = [];
  if (!db.protoBoards) db.protoBoards = [];
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
      if (!Array.isArray(db.scheduledMessages)) db.scheduledMessages = [];
      if (!db.moderationIps || typeof db.moderationIps !== 'object' || Array.isArray(db.moderationIps)) db.moderationIps = {};
      if (!Array.isArray(db.regLedger)) db.regLedger = [];
      normalizeAllUsers();
      if (migrateChatKinds()) saveDb();
      // РќРѕРІР°СЏ Р±Р°Р·Р° СЃ РґРёСЃРєР° РјРѕРіР»Р° РїСЂРёР№С‚Рё Р±РµР· СЃРёСЃС‚РµРјРЅРѕРіРѕ Р±РѕС‚Р° /hub.
      if (botsModule && botsModule.ensureHub()) saveDb();
      console.log('[DB] Reloaded from disk. Users:', db.users.length, 'Tracks:', db.tracks.length);
    } catch (e) { console.error('[DB] Reload failed:', e.message); }
  }
}

// ─── verification codes (in-memory) ─────────────────────────────────────────
const passwordFailures = new Map();
const PASSWORD_FAILURE_LIMIT = 5;
const PASSWORD_LOCK_MS = 15 * 60 * 1000;

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
  if (user.passwordHashVersion === undefined && user.passwordHash) user.passwordHashVersion = /^\$argon2id\$/.test(user.passwordHash) ? 2 : 1;
  return user;
}

// в”Ђв”Ђв”Ђ DEV-СЂРµР¶РёРј РїРѕ IP в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// DEV_IPS: CSV СЃРїРёСЃРѕРє IP (v4/v6). РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ, Р·Р°С€РµРґС€РёР№ СЃ Р»СЋР±РѕРіРѕ РёР· РЅРёС…,
// РїРѕР»СѓС‡Р°РµС‚ РІ РѕС‚РІРµС‚Р°С… auth С„Р»Р°Рі isDev:true. РљР»РёРµРЅС‚ РїРѕ РЅРµРјСѓ РѕС‚РєСЂС‹РІР°РµС‚ РІРµСЃСЊ
// РјР°РіР°Р·РёРЅ Рё РѕРІРµСЂР»РµР№-РёРЅСЃРїРµРєС‚РѕСЂ (Ctrl+РџРљРњ).
const DEV_IPS = String(process.env.DEV_IPS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
function clientIp(req) {
  let ip = String(req.ip || '');
  // IPv4-mapped IPv6: ::ffff:1.2.3.4 в†’ 1.2.3.4
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
// в”Ђв”Ђв”Ђ РђРЅС‚Рё-РјСѓР»СЊС‚РёР°РєРєР°СѓРЅС‚РёРЅРі (152-Р¤Р—: С…СЂР°РЅРёРј С‚РѕР»СЊРєРѕ РЅРµРѕР±СЂР°С‚РёРјС‹Рµ HMAC-С…СЌС€Рё) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РњС‹ РќР• СЃРѕС…СЂР°РЅСЏРµРј СЃС‹СЂС‹Рµ IP Рё С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё Р±СЂР°СѓР·РµСЂР°. РР· HMAC-С…СЌС€Р° РЅРµР»СЊР·СЏ
// РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РЅРё IP, РЅРё Р»РёС‡РЅРѕСЃС‚СЊ вЂ” РјРѕР¶РЅРѕ Р»РёС€СЊ СЃСЂР°РІРЅРёС‚СЊ В«СЌС‚Рѕ Р¶Рµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ/СЃРµС‚СЊ,
// С‡С‚Рѕ Рё СЂР°РЅСЊС€Рµ?В». РџРѕСЌС‚РѕРјСѓ СЌС‚Рѕ РѕР±РµР·Р»РёС‡РµРЅРЅС‹Рµ С‚РµС…РЅРёС‡РµСЃРєРёРµ РґР°РЅРЅС‹Рµ, Р° РЅРµ РџР”, Рё
// СЂРµРіРёСЃС‚СЂР°С†РёРё РѕРїРµСЂР°С‚РѕСЂРѕРј РџР” РІ Р РљРќ РЅРµ С‚СЂРµР±СѓРµС‚СЃСЏ. Canvas/WebRTC РЅРµ РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ.
const MAX_ACCOUNTS_PER_DEVICE = 2;
const MAX_ACCOUNTS_PER_IP = 3;
// РЎС‚Р°СЂС‹Рµ Р·Р°РїРёСЃРё СЂРµРµСЃС‚СЂР° РЅРµ РІР»РёСЏСЋС‚ РЅР° Р»РёРјРёС‚ Рё С‡РёСЃС‚СЏС‚СЃСЏ (СѓСЃС‚СЂРѕР№СЃС‚РІРѕ/СЃРµС‚СЊ РјРѕРіР»Рё
// СЃРјРµРЅРёС‚СЊСЃСЏ Сѓ РЅРѕРІРѕРіРѕ РІР»Р°РґРµР»СЊС†Р°). РћРєРЅРѕ вЂ” 180 РґРЅРµР№.
const REG_LEDGER_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const REG_LEDGER_MAX = 50000;

// HMAC-РєР»СЋС‡ РїСЂРёРІСЏР·Р°РЅ Рє JWT_SECRET: РїСЂРё СѓС‚РµС‡РєРµ РґР°РјРїР° Р±Р°Р·С‹ С…СЌС€Рё Р±РµСЃРїРѕР»РµР·РЅС‹ Р±РµР· РєР»СЋС‡Р°.
function regHmac(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  return crypto.createHmac('sha256', 'reg:' + JWT_SECRET).update(v).digest('hex');
}
// РћС‚РїРµС‡Р°С‚РѕРє СѓСЃС‚СЂРѕР№СЃС‚РІР° РїСЂРёС…РѕРґРёС‚ РѕС‚ РєР»РёРµРЅС‚Р° СѓР¶Рµ РєР°Рє С…СЌС€ (hex). РџСЂРѕРїСѓСЃРєР°РµРј С‚РѕР»СЊРєРѕ
// РєРѕСЂСЂРµРєС‚РЅС‹Р№ С„РѕСЂРјР°С‚ Рё РїРѕРІС‚РѕСЂРЅРѕ В«РїРѕРґСЃР°Р»РёРІР°РµРјВ» HMAC вЂ” СЃРµСЂРІРµСЂ РЅРµ РІРёРґРёС‚ РєРѕРјРїРѕРЅРµРЅС‚С‹.
function deviceFingerprintHash(req) {
  const raw = req.body?.fpHash;
  if (typeof raw !== 'string' || !/^[a-f0-9]{16,128}$/i.test(raw)) return null;
  return regHmac('fp:' + raw.toLowerCase());
}
function pruneRegLedger() {
  const since = Date.now() - REG_LEDGER_TTL_MS;
  const list = (db.regLedger || []).filter(e => Number(e.at) >= since);
  if (list.length > REG_LEDGER_MAX) list.splice(0, list.length - REG_LEDGER_MAX);
  db.regLedger = list;
  return list;
}
// РЎРєРѕР»СЊРєРѕ Р РђР—РќР«РҐ Р°РєРєР°СѓРЅС‚РѕРІ СѓР¶Рµ СЃРІСЏР·Р°РЅРѕ СЃ РґР°РЅРЅС‹Рј С…СЌС€РµРј (СѓСЃС‚СЂРѕР№СЃС‚РІР° РёР»Рё СЃРµС‚Рё).
function countAccountsForHash(kind, hash) {
  if (!hash) return 0;
  const since = Date.now() - REG_LEDGER_TTL_MS;
  const ids = new Set();
  for (const e of db.regLedger || []) {
    if (e.kind === kind && e.h === hash && Number(e.at) >= since) ids.add(e.userId);
  }
  return ids.size;
}
// РџСЂРѕРІРµСЂРєР° Р»РёРјРёС‚РѕРІ Р”Рћ СЃРѕР·РґР°РЅРёСЏ Р°РєРєР°СѓРЅС‚Р°. Р’РѕР·РІСЂР°С‰Р°РµС‚ { ok } РёР»Рё { ok:false, message }.
function checkRegistrationLimits(req) {
  const deviceHash = deviceFingerprintHash(req);
  const ipHash = regHmac('ip:' + requestIp(req));
  if (deviceHash && countAccountsForHash('device', deviceHash) >= MAX_ACCOUNTS_PER_DEVICE) {
    return { ok: false, message: 'РЎ СЌС‚РѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР° СѓР¶Рµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРѕ РјР°РєСЃРёРјР°Р»СЊРЅРѕРµ С‡РёСЃР»Рѕ Р°РєРєР°СѓРЅС‚РѕРІ.' };
  }
  if (ipHash && countAccountsForHash('ip', ipHash) >= MAX_ACCOUNTS_PER_IP) {
    return { ok: false, message: 'РЎ СЌС‚РѕР№ СЃРµС‚Рё СѓР¶Рµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРѕ РјР°РєСЃРёРјР°Р»СЊРЅРѕРµ С‡РёСЃР»Рѕ Р°РєРєР°СѓРЅС‚РѕРІ.' };
  }
  return { ok: true, deviceHash, ipHash };
}
// Р¤РёРєСЃРёСЂСѓРµРј СЂРµРіРёСЃС‚СЂР°С†РёСЋ РІ СЂРµРµСЃС‚СЂРµ (РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕРіРѕ СЃРѕР·РґР°РЅРёСЏ Р°РєРєР°СѓРЅС‚Р°).
function recordRegistration(userId, deviceHash, ipHash) {
  if (!userId) return;
  pruneRegLedger();
  const at = Date.now();
  if (deviceHash) db.regLedger.push({ kind: 'device', h: deviceHash, userId, at });
  if (ipHash) db.regLedger.push({ kind: 'ip', h: ipHash, userId, at });
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
// SEC: РїРѕР»СЏ СѓС‡С‘С‚РЅРѕР№ Р·Р°РїРёСЃРё, РєРѕС‚РѕСЂС‹Рµ РЅРёРєРѕРіРґР° РЅРµ СѓС…РѕРґСЏС‚ РєР»РёРµРЅС‚Сѓ (РґР°Р¶Рµ РІР»Р°РґРµР»СЊС†Сѓ).
// РџР»СЋСЃ Р»СЋР±С‹Рµ РїРѕР»СЏ, РїРѕС…РѕР¶РёРµ РЅР° СЃРµРєСЂРµС‚, вЂ” РЅР° СЃР»СѓС‡Р°Р№ РЅРѕРІС‹С… РїРѕР»РµР№ РІ Р±СѓРґСѓС‰РµРј.
const PRIVATE_USER_FIELDS = new Set([
  'passwordHash', 'passwordHashVersion', 'tokenVersion', 'refreshTokens',
  // РџРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РЅРµ СЃРѕР±РёСЂР°СЋС‚СЃСЏ Рё РЅРµ РѕС‚РґР°СЋС‚СЃСЏ РЅРёРєРѕРјСѓ, РІРєР»СЋС‡Р°СЏ РІР»Р°РґРµР»СЊС†Р°.
  'email', 'phone', 'firstName', 'lastName', 'birthDate', 'country', 'region', 'city',
]);
const PRIVATE_USER_FIELD_RE = /hash|secret|salt|token|otp|recovery/i;
function safeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const out = {};
  for (const [key, value] of Object.entries(user)) {
    if (PRIVATE_USER_FIELDS.has(key) || PRIVATE_USER_FIELD_RE.test(key)) continue;
    out[key] = value;
  }
  return out;
}
function withDevFlag(req, user) {
  // РђРґРјРёРЅС‹ (ADMIN_USERNAMES / db.admins) РїРѕР»СѓС‡Р°СЋС‚ РїРѕР»РЅС‹Р№ dev-СЂРµР¶РёРј РЅР° РєР»РёРµРЅС‚Рµ:
  // РІРµСЃСЊ РјР°РіР°Р·РёРЅ РѕС‚РєСЂС‹С‚ Рё Р±РµСЃРїР»Р°С‚РµРЅ, РѕРІРµСЂР»РµР№-РёРЅСЃРїРµРєС‚РѕСЂ РІРєР»СЋС‡С‘РЅ.
  const admin = isAdminUsername(user?.username);
  const dev = isDevIp(req) || admin;
  return { ...safeUser(user), isDev: dev, isAdmin: dev };
}

// в”Ђв”Ђв”Ђ РђРґРјРёРЅС‹ РїРѕ username в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РСЃС‚РѕС‡РЅРёРєРё: ENV ADMIN_USERNAMES (CSV, Р·Р°РґР°С‘С‚СЃСЏ РІ РїР°РЅРµР»Рё Render) + db.admins
// (СЂРµРґР°РєС‚РёСЂСѓРµС‚СЃСЏ С‡РµСЂРµР· РєРѕРЅСЃРѕР»СЊ СЃРµСЂРІРµСЂР° РєРѕРјР°РЅРґРѕР№ `admin add/del`). Р РµРіРёСЃС‚СЂ
// РЅРµ РІР°Р¶РµРЅ, СЃРёРјРІРѕР» '@' РІ РЅР°С‡Р°Р»Рµ РёРіРЅРѕСЂРёСЂСѓРµС‚СЃСЏ.
const ADMIN_ENV = (() => {
  // SEC: РІ РїСЂРѕРґРµ РґРµС„РѕР»С‚РЅС‹Рµ РёРјРµРЅР° РѕРїР°СЃРЅС‹ вЂ” РЅР° РїСѓСЃС‚РѕР№ Р‘Р” Р»СЋР±РѕР№ РјРѕР¶РµС‚
  // Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°С‚СЊ В«Vera_koto_aВ» Рё СЃС‚Р°С‚СЊ Р°РґРјРёРЅРѕРј. РўСЂРµР±СѓРµРј СЏРІРЅС‹Р№ ENV.
  if (process.env.NODE_ENV === 'production' && !String(process.env.ADMIN_USERNAMES || '').trim()) {
    throw new Error('[FATAL] ADMIN_USERNAMES is not set. Set it explicitly in production (fly secrets set ADMIN_USERNAMES=...).');
  }
  const raw = String(process.env.ADMIN_USERNAMES || '');
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

// РџРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РЅРµ С…СЂР°РЅРёРј. Р Р°Р·РѕРІР°СЏ РѕС‡РёСЃС‚РєР° СѓР¶Рµ Р·Р°РїРёСЃР°РЅРЅС‹С… Р·РЅР°С‡РµРЅРёР№
// (С‚РµР»РµС„РѕРЅ, РїРѕС‡С‚Р°, Р¤РРћ, РґР°С‚Р° СЂРѕР¶РґРµРЅРёСЏ, РјРµСЃС‚РѕРїРѕР»РѕР¶РµРЅРёРµ) РїСЂРё СЃС‚Р°СЂС‚Рµ Рё РїСЂРё
// РїРµСЂРµС‡РёС‚С‹РІР°РЅРёРё Р±Р°Р·С‹ СЃ РґРёСЃРєР°. РћРїРёСЃР°РЅРёСЏ (bio) РЅРµ С‚СЂРѕРіР°РµРј: СЌС‚Рѕ СЃРІРѕР±РѕРґРЅС‹Р№ С‚РµРєСЃС‚,
// Р° РЅРµ РѕС‚РґРµР»СЊРЅРѕРµ РїРѕР»Рµ РџР”.
const PERSONAL_DATA_FIELDS = ['email', 'phone', 'firstName', 'lastName', 'birthDate', 'country', 'region', 'city'];
function stripPersonalData(user) {
  // РЈ Р±РѕС‚РѕРІ РёРјСЏ Р·Р°РґР°С‘С‚ РІР»Р°РґРµР»РµС† Р±РѕС‚Р°, СЌС‚Рѕ РЅРµ РїРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ С‡РµР»РѕРІРµРєР°.
  if (!user || user.isBot) return false;
  let changed = false;
  for (const key of PERSONAL_DATA_FIELDS) {
    if (user[key]) { user[key] = null; changed = true; }
  }
  return changed;
}

function normalizeAllUsers() {
  if (!Array.isArray(db.users)) db.users = [];
  db.users.forEach(normalizeUserRecord);
  if (db.users.filter(stripPersonalData).length) saveDb();
}

normalizeAllUsers();

/* в”Ђв”Ђв”Ђ Device management (РїСЂР°РІРёР»Рѕ В«СѓСЃС‚СЂРѕР№СЃС‚РІРѕ 1 = 1, РІС‚РѕСЂРѕРµ вЂ” С‡РµСЂРµР· QRВ») в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
 * РљР°Р¶РґС‹Р№ РІС…РѕРґ РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ СЃ РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР° (deviceId). РџСЂР°РІРёР»Р°:
 *  - РЅРѕРІС‹Р№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕР»СѓС‡Р°РµС‚ В«РѕСЃРЅРѕРІРЅРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕВ» (primary);
 *  - РІС‚РѕСЂРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РґРѕР±Р°РІР»СЏРµС‚СЃСЏ РўРћР›Р¬РљРћ С‡РµСЂРµР· РїСЂРёРІСЏР·РєСѓ РїРѕ QR-РєРѕРґСѓ/СЃСЃС‹Р»РєРµ;
 *  - Р±РѕР»СЊС€Рµ 2 СѓСЃС‚СЂРѕР№СЃС‚РІ РЅР° РѕРґРёРЅ Р°РєРєР°СѓРЅС‚ РЅРµР»СЊР·СЏ.
 */
const MAX_DEVICES_PER_ACCOUNT = 100;
const LINK_INVITE_TTL_MS = 5 * 60 * 1000; // 5 РјРёРЅСѓС‚

function normalizeDeviceId(raw) {
  const s = String(raw || '').trim();
  // РЎРѕС…СЂР°РЅСЏРµРј С‡РёС‚Р°РµРјС‹Рµ СЃРёРјРІРѕР»С‹: СЋР·РµСЂ-Р°РіРµРЅС‚ РІ РїРµСЂРµРєРѕРґРёСЂРѕРІР°РЅРЅРѕРј РІРёРґРµ вЂ” РѕРє.
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
      res.status(403).json({ message: 'Р”РѕСЃС‚СѓРї Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ', code: 'ACCOUNT_BANNED' }); return null;
    }
    if (device) {
      if (device.revoked && !allowRevoked) { res.status(403).json({ message: 'РЈСЃС‚СЂРѕР№СЃС‚РІРѕ РѕС‚РІСЏР·Р°РЅРѕ. РЎРѕР·РґР°Р№С‚Рµ РЅРѕРІСѓСЋ СЃСЃС‹Р»РєСѓ РїСЂРёРІСЏР·РєРё РЅР° РѕСЃРЅРѕРІРЅРѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ.' }); return null; }
      return { deviceId: device.deviceId, hash };
    }
  }
  const rawId = req.body?.deviceId;
  if (typeof rawId !== 'string' || !rawId.trim() || rawId.length > 160) {
    res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ СѓСЃС‚СЂРѕР№СЃС‚РІР°' }); return null;
  }
  const deviceId = normalizeDeviceId(rawId);
  if (moderationBlocked(db, null, deviceId)) { res.status(403).json({ message: 'РЈСЃС‚СЂРѕР№СЃС‚РІРѕ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅРѕ' }); return null; }
  const existing = (db.devices || []).find(d => d.deviceId === deviceId);
  if (existing) {
    let identity;
    try { identity = verifyAccessToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); } catch {}
    if (existing.installationHash || existing.revoked || identity?.deviceId !== deviceId || identity?.userId !== existing.userId) {
      res.status(403).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґС‚РІРµСЂРґРёС‚СЊ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ. РСЃРїРѕР»СЊР·СѓР№С‚Рµ СЃРѕС…СЂР°РЅС‘РЅРЅСѓСЋ СЃРµСЃСЃРёСЋ РёР»Рё РЅРѕРІРѕРµ РїСЂРёРіР»Р°С€РµРЅРёРµ.' }); return null;
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

// Р РµРіРёСЃС‚СЂРёСЂСѓРµС‚ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РІС…РѕРґР°. Р’РѕР·РІСЂР°С‰Р°РµС‚ { ok, device, message }
// РџСЂР°РІРёР»Рѕ: 1 Р°РєРєР°СѓРЅС‚ = 1 СѓСЃС‚СЂРѕР№СЃС‚РІРѕ. РќРѕРІРѕРµ (РЅРµ РїРµСЂРІРѕРµ) СѓСЃС‚СЂРѕР№СЃС‚РІРѕ СЂР°Р·СЂРµС€РµРЅРѕ
// РўРћР›Р¬РљРћ РµСЃР»Рё РѕРЅРѕ СѓР¶Рµ РїСЂРёРІСЏР·Р°РЅРѕ С‡РµСЂРµР· QR/СЃСЃС‹Р»РєСѓ (acceptLinkInviteOnServer
// Р·Р°СЂР°РЅРµРµ РґРѕР±Р°РІР»СЏРµС‚ РµРіРѕ РІ db.devices).
function registerDevice(userId, deviceId, deviceName) {
  const cleanId = normalizeDeviceId(deviceId);
  const existing = getDeviceForUser(userId, cleanId);
  if (existing) {
    existing.lastSeenAt = Date.now();
    existing.name = (deviceName || existing.name || 'РњРѕС‘ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ').slice(0, 80);
    return { ok: true, device: existing };
  }
  // Р­С‚Рѕ РЅРѕРІРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РґР»СЏ Р°РєРєР°СѓРЅС‚Р°.
  const otherUserDevice = (db.devices || []).find(d => d.deviceId === cleanId && d.userId !== userId);
  if (otherUserDevice) {
    return { ok: false, message: 'Р­С‚Рѕ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ СѓР¶Рµ РїСЂРёРІСЏР·Р°РЅРѕ Рє РґСЂСѓРіРѕРјСѓ Р°РєРєР°СѓРЅС‚Сѓ.' };
  }
  const count = countUserDevices(userId);
  // РџРµСЂРІРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ вЂ” РѕСЃРЅРѕРІРЅРѕРµ, СЂР°Р·СЂРµС€Р°РµРј РІСЃРµРіРґР° (СЃРѕР·РґР°РЅРёРµ Р°РєРєР°СѓРЅС‚Р°).
  if (count === 0) {
    const device = {
      id: uuidv4(),
      userId,
      deviceId: cleanId,
      name: (deviceName || 'РњРѕС‘ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ').slice(0, 80),
      isPrimary: true,
      linkedViaQr: false,
      createdAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
    };
    (db.devices || (db.devices = [])).push(device);
    saveDb();
    return { ok: true, device };
  }
  // РќРµ РїРµСЂРІРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ Рё РЅРµ РїСЂРёРІСЏР·Р°РЅРѕ вЂ” РґРѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ.
  return {
    ok: false,
    message: 'Р­С‚Рѕ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РЅРµ РїСЂРёРІСЏР·Р°РЅРѕ Рє Р°РєРєР°СѓРЅС‚Сѓ. Р”РѕР±Р°РІСЊС‚Рµ РµРіРѕ С‡РµСЂРµР· QR-РєРѕРґ/СЃСЃС‹Р»РєСѓ СЃРѕ СЃРІРѕРµРіРѕ РѕСЃРЅРѕРІРЅРѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР° (СЂР°Р·РґРµР» В«РЈСЃС‚СЂРѕР№СЃС‚РІР°В»).',
  };
}

// РџСЂРёРІСЏР·РєР° РїРѕ QR-РєРѕРґСѓ СЂР°Р·СЂРµС€Р°РµС‚ РґРѕР±Р°РІРёС‚СЊ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ В«РЅРµ-РїРµСЂРІС‹РјВ».
function acceptLinkInviteOnServer(invite, newDeviceId, newDeviceName) {
  if (!invite) return { ok: false, message: 'РџСЂРёРіР»Р°С€РµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' };
  if (Date.now() > invite.expiresAt) return { ok: false, message: 'QR-РєРѕРґ/СЃСЃС‹Р»РєР° РёСЃС‚РµРєР»Рё. РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·.' };
  const cleanId = normalizeDeviceId(newDeviceId);
  const ownerId = invite.userId;

  const sameDevice = getDeviceForUser(ownerId, cleanId);
  if (sameDevice && !sameDevice.revoked) {
    if (!sameDevice.loggedOut) return { ok: false, message: 'Р­С‚Рѕ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ СѓР¶Рµ РІС…РѕРґРёС‚ РІ СЌС‚РѕС‚ Р°РєРєР°СѓРЅС‚. РћС‚РєСЂРѕР№С‚Рµ СЃСЃС‹Р»РєСѓ РЅР° РЅРѕРІРѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ.' };
    // РЈСЃС‚СЂРѕР№СЃС‚РІРѕ РІС‹С€Р»Рѕ РёР· Р°РєРєР°СѓРЅС‚Р° Рё РІРѕР·РІСЂР°С‰Р°РµС‚СЃСЏ РїРѕ СЃСЃС‹Р»РєРµ РІР»Р°РґРµР»СЊС†Р°.
    sameDevice.loggedOut = false;
    sameDevice.lastSeenAt = Date.now();
    db.linkInvites = (db.linkInvites || []).filter(i => i.id !== invite.id);
    saveDb();
    return { ok: true, device: sameDevice };
  }

  const other = (db.devices || []).find(d => d.deviceId === cleanId && d.userId !== ownerId);
  if (other) return { ok: false, message: 'Р­С‚Рѕ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ СѓР¶Рµ РїСЂРёРІСЏР·Р°РЅРѕ Рє РґСЂСѓРіРѕРјСѓ Р°РєРєР°СѓРЅС‚Сѓ.' };
  const count = countUserDevices(ownerId);
  if (count >= MAX_DEVICES_PER_ACCOUNT) {
    return { ok: false, message: `Р”РѕСЃС‚РёРіРЅСѓС‚ Р»РёРјРёС‚ СѓСЃС‚СЂРѕР№СЃС‚РІ (${MAX_DEVICES_PER_ACCOUNT}).` };
  }

  const device = {
    id: uuidv4(),
    userId: ownerId,
    tokenVersion: Number(sameDevice?.tokenVersion || 0) + 1,
    deviceId: cleanId,
    name: (newDeviceName || 'Р’С‚РѕСЂРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ').slice(0, 80),
    isPrimary: count === 0,
    linkedViaQr: true,
    createdAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
  };
  db.devices = db.devices.filter(d => !(d.deviceId === cleanId && d.revoked));
  (db.devices || (db.devices = [])).push(device);
  // РРЅРІР°Р№С‚ РѕРґРЅРѕСЂР°Р·РѕРІС‹Р№
  db.linkInvites = (db.linkInvites || []).filter(i => i.id !== invite.id);
  saveDb();
  return { ok: true, device };
}

// РџСЂРёР·РЅР°РєРё РЅР°РґС‘Р¶РЅРѕСЃС‚Рё Р±РµР· РїРµСЂСЃРѕРЅР°Р»СЊРЅС‹С… РґР°РЅРЅС‹С….
// РђРєРєР°СѓРЅС‚ СЃС‚Р°СЂС€Рµ РјРµСЃСЏС†Р° Рё Рє РЅРµРјСѓ РїСЂРёРІСЏР·Р°РЅРѕ РІС‚РѕСЂРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ С‡РµСЂРµР· QR.
const ACCOUNT_AGE_TRUST_MS = 30 * 24 * 60 * 60 * 1000;
function accountIsMature(user) {
  const created = Date.parse(user?.createdAt || '');
  return Number.isFinite(created) && Date.now() - created >= ACCOUNT_AGE_TRUST_MS;
}
function hasQrLinkedDevice(userId) {
  return (db.devices || []).some(d => d.userId === userId && d.linkedViaQr && !d.revoked);
}

function setInstallationCookie(req, res, raw) {
  res.cookie('vera_installation', raw, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', path: '/', maxAge: 400 * 24 * 60 * 60 * 1000 });
}

// Р’С…РѕРґ/СЂРµРіРёСЃС‚СЂР°С†РёСЏ РїРѕ РїР°СЂРѕР»СЋ: РїР°СЂРѕР»СЊ СЃР°Рј РґРѕРєР°Р·С‹РІР°РµС‚ РІР»Р°РґРµРЅРёРµ Р°РєРєР°СѓРЅС‚РѕРј,
// РїРѕСЌС‚РѕРјСѓ РЅРѕРІРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РїСЂРёРІСЏР·С‹РІР°РµС‚СЃСЏ Р±РµР· QR. РџСѓР±Р»РёС‡РЅС‹Р№ deviceId РёР· С‚РµР»Р°
// Р·Р°РїСЂРѕСЃР° РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ вЂ” С‚РѕР»СЊРєРѕ СЃРµРєСЂРµС‚ СѓСЃС‚Р°РЅРѕРІРєРё РёР· HttpOnly-cookie.
// Р•СЃР»Рё СЌС‚Р° СѓСЃС‚Р°РЅРѕРІРєР° СѓР¶Рµ РїСЂРёРЅР°РґР»РµР¶РёС‚ РґСЂСѓРіРѕРјСѓ Р°РєРєР°СѓРЅС‚Сѓ (РЅР° Р±СЂР°СѓР·РµСЂРµ Р±С‹Р» РґСЂСѓРіРѕР№
// РІС…РѕРґ), РµР№ РІС‹РґР°С‘С‚СЃСЏ РЅРѕРІС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ: С‡СѓР¶РѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РЅРµ РїРµСЂРµРїРёСЃС‹РІР°РµРј.
// Р’РѕР·РІСЂР°С‰Р°РµС‚ Р·Р°РїРёСЃСЊ СѓСЃС‚СЂРѕР№СЃС‚РІР° РёР»Рё null (РѕС‚РІРµС‚ СЃ РѕС€РёР±РєРѕР№ СѓР¶Рµ РѕС‚РїСЂР°РІР»РµРЅ).
function bindInstallationForUser(req, res, user, deviceName) {
  const secret = req.cookies?.vera_installation;
  let hash = null;
  let current = null;
  if (typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret)) {
    hash = crypto.createHash('sha256').update(secret).digest('hex');
    current = (db.devices || []).find(d => d.installationHash === hash) || null;
  }
  const claimedId = typeof req.body?.deviceId === 'string' ? normalizeDeviceId(req.body.deviceId) : null;
  if (moderationBlocked(db, user.id, current?.deviceId, hash) || (claimedId && moderationBlocked(db, null, claimedId))) {
    res.status(403).json({ message: 'Р”РѕСЃС‚СѓРї Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ', code: 'ACCOUNT_BANNED' });
    return null;
  }
  const name = String(deviceName || 'РњРѕС‘ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ').slice(0, 80);
  let device = current && current.userId === user.id ? current : null;
  if (!device) {
    if (countUserDevices(user.id) >= MAX_DEVICES_PER_ACCOUNT) {
      res.status(403).json({ message: `Р”РѕСЃС‚РёРіРЅСѓС‚ Р»РёРјРёС‚ СѓСЃС‚СЂРѕР№СЃС‚РІ (${MAX_DEVICES_PER_ACCOUNT}).` });
      return null;
    }
    const raw = crypto.randomBytes(32).toString('hex');
    hash = crypto.createHash('sha256').update(raw).digest('hex');
    setInstallationCookie(req, res, raw);
    device = {
      id: uuidv4(),
      userId: user.id,
      deviceId: 'dev_' + crypto.randomBytes(24).toString('hex'),
      name,
      isPrimary: countUserDevices(user.id) === 0,
      linkedViaQr: false,
      linkedViaPassword: true,
      createdAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
    };
    (db.devices || (db.devices = [])).push(device);
  } else if (device.revoked) {
    // РћС‚РІСЏР·Р°РЅРЅРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РІРµСЂРЅСѓР»РѕСЃСЊ СЃ РїР°СЂРѕР»РµРј: СЃС‚Р°СЂС‹Рµ С‚РѕРєРµРЅС‹ РѕСЃС‚Р°СЋС‚СЃСЏ РЅРµРґРµР№СЃС‚РІРёС‚РµР»СЊРЅС‹.
    device.revoked = false;
    device.tokenVersion = Number(device.tokenVersion || 0) + 1;
  }
  device.installationHash = hash;
  device.loggedOut = false;
  device.lastSeenAt = Date.now();
  device.name = name;
  return device;
}
function createSavedMessagesChat(userId) {
  const savedChat = {
    id: uuidv4(),
    type: 'saved',
    name: 'РР·Р±СЂР°РЅРЅРѕРµ',
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    pinnedMessageId: null,
  };
  db.chats.push(savedChat);
  db.chatMembers.push({ id: uuidv4(), chatId: savedChat.id, userId, role: 'owner', joinedAt: new Date().toISOString() });
}

// Р”РѕР±Р°РІР»СЏРµС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РІ РіР»РѕР±Р°Р»СЊРЅС‹Р№ С‡Р°С‚ РѕР±СЂР°С‚РЅРѕР№ СЃРІСЏР·Рё
function addUserToFeedbackChat(userId) {
  const feedbackChatId = 'feedback-global';
  const chatMember = (db.chatMembers || []).find(m => m.chatId === feedbackChatId && m.userId === userId);
  if (!chatMember) {
    (db.chatMembers || []).push({
      id: uuidv4(),
      chatId: feedbackChatId,
      userId,
      role: 'member',
      joinedAt: new Date().toISOString(),
    });
  }
}

// в”Ђв”Ђв”Ђ Express app в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const app = express();
// SEC: СЃРєСЂС‹РІР°РµРј СЃРёРіРЅР°С‚СѓСЂСѓ С„СЂРµР№РјРІРѕСЂРєР° (fingerprinting СЃРµСЂРІРµСЂР°).
app.disable('x-powered-by');
// SEC: helmet вЂ” Р±Р°Р·РѕРІС‹Рµ security-Р·Р°РіРѕР»РѕРІРєРё. CSP РѕС‚РєР»СЋС‡Р°РµРј РЅР° СѓСЂРѕРІРЅРµ РјРѕРґСѓР»СЏ,
// С‚.Рє. РґР»СЏ /uploads СѓР¶Рµ РїРѕСЃС‚Р°РІР»РµРЅ РєР°СЃС‚РѕРјРЅС‹Р№ `Content-Security-Policy: sandbox`.
try {
  const helmet = require(tryResolve('helmet'));
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // /uploads РѕС‚РґР°С‘Рј РЅР° web-origin
    crossOriginEmbedderPolicy: false,
  }));
} catch (e) {
  console.warn('[SEC] helmet РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ вЂ” РїСЂРѕРїСѓСЃРєР°СЋ security-Р·Р°РіРѕР»РѕРІРєРё. Р—Р°РїСѓСЃС‚РёС‚Рµ: npm i helmet (РІ Server/).');
}
// SEC: Р·Р° РїСЂРѕРєСЃРё Render/Fly вЂ” РґРѕРІРµСЂСЏРµРј СЂРѕРІРЅРѕ РѕРґРЅРѕРјСѓ С…РѕРїСѓ, С‡С‚РѕР±С‹ req.ip Р±С‹Р» СЂРµР°Р»СЊРЅС‹Рј (РґР»СЏ rate-limit).
// Only trust explicitly configured proxy addresses/subnets, never arbitrary XFF.
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',').map(s => s.trim()).filter(Boolean) : false);
const server = http.createServer(app);
// SEC/DoS: РЅРµ РґРµСЂР¶РёРј СЃРѕРµРґРёРЅРµРЅРёСЏ Р±РµСЃРєРѕРЅРµС‡РЅРѕ Рё РЅРµ РїРѕР·РІРѕР»СЏРµРј slowloris-Р·Р°РїСЂРѕСЃР°Рј
// Р·Р°РЅРёРјР°С‚СЊ worker. Р‘РѕР»РµРµ СЃС‚СЂРѕРіРёРµ Р»РёРјРёС‚С‹ РґР»СЏ С‚СЏР¶С‘Р»С‹С… РјР°СЂС€СЂСѓС‚РѕРІ Р·Р°РґР°СЋС‚СЃСЏ РЅРёР¶Рµ.
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 15000);
server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 5000);
server.maxRequestsPerSocket = Number(process.env.HTTP_MAX_REQUESTS_PER_SOCKET || 100);

app.use(cors({ origin: corsOriginFn, credentials: true }));
app.use(cookieParser());
// PERF: gzip-СЃР¶Р°С‚РёРµ РІСЃРµС… РѕС‚РІРµС‚РѕРІ. РћСЃРѕР±РµРЅРЅРѕ СѓСЃРєРѕСЂСЏРµС‚ JSON API (СЃРїРёСЃРѕРє СЃРѕРѕР±С‰РµРЅРёР№,
// СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ store), Р° С‚Р°РєР¶Рµ СЂР°Р·РґР°С‡Сѓ СЃРѕР±СЂР°РЅРЅРѕРіРѕ РєР»РёРµРЅС‚Р° С‡РµСЂРµР· С‚РѕС‚ Р¶Рµ РїРѕСЂС‚.
try {
  const compression = require(tryResolve('compression'));
  app.use(compression({
    threshold: 1024,
    // РќРµ Р¶РјС‘Рј С‚Рѕ, С‡С‚Рѕ СѓР¶Рµ СЃР¶Р°С‚Рѕ (jpeg/png/webp/mp3/mp4/webm/ogg вЂ” /uploads).
    filter: (req, res) => {
      const type = String(res.getHeader('Content-Type') || '');
      if (/^(image|audio|video)\//.test(type)) return false;
      return compression.filter(req, res);
    },
  }));
} catch {
  console.warn('[PERF] compression РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ вЂ” npm i compression (РІ Server/).');
}
// SEC: Р»РёРјРёС‚ С‚РµР»Р°. РќРµ '1mb', РїРѕС‚РѕРјСѓ С‡С‚Рѕ РіРѕР»РѕСЃРѕРІС‹Рµ/С„Р°Р№Р»С‹ РѕС‚РїСЂР°РІР»СЏСЋС‚СЃСЏ РєР°Рє base64
// С‡РµСЂРµР· /api/messages/:chatId/send (data URL). 30mb РїРѕРєСЂС‹РІР°РµС‚ РґР»РёРЅРЅС‹Рµ Р“РЎ Рё С„РѕС‚Рѕ.
// Reject floods before allocating/parsing request bodies (including GET floods).
app.use(makeRateLimit({ windowMs: 60_000, max: 600 }));
// Fail closed: synchronous ZIP extraction and external downloaders are not
// safe public workloads. Enable only after isolating them in a bounded worker.
app.use(['/api/music/import-zip', '/api/music/import-url'], (_req, res) => {
  res.status(503).json({ message: 'РРјРїРѕСЂС‚ РІСЂРµРјРµРЅРЅРѕ РѕС‚РєР»СЋС‡С‘РЅ РґР»СЏ Р·Р°С‰РёС‚С‹ СЃРµСЂРІРµСЂР°' });
});

// SEC/DoS: Content-Length РїСЂРѕРІРµСЂСЏРµС‚СЃСЏ РґРѕ РІС‹РїРѕР»РЅРµРЅРёСЏ С‚СЏР¶С‘Р»С‹С… РѕР±СЂР°Р±РѕС‚С‡РёРєРѕРІ.
// Chunked-Р·Р°РїСЂРѕСЃС‹ РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ РѕРіСЂР°РЅРёС‡РёРІР°СЋС‚СЃСЏ parser'РѕРј РІС‹С€Рµ.
app.use((req, res, next) => {
  const length = Number(req.headers['content-length']);
  if (!req.is('multipart/form-data') && Number.isFinite(length) && length > 30 * 1024 * 1024) {
    return res.status(413).json({ message: 'РўРµР»Рѕ Р·Р°РїСЂРѕСЃР° СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕРµ' });
  }
  next();
});
app.use(express.json({ limit: '30mb', inflate: false, verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100, inflate: false }));

// SEC: Р±Р°Р·РѕРІС‹Рµ security headers (Р±РµР· РІРЅРµС€РЅРµР№ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=(self)');
  // РљСЌС€ API-РѕС‚РІРµС‚РѕРІ РЅРµ С…РѕС‚РёРј вЂ” С‚РѕРєРµРЅС‹/РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// SEC: IP-Р±Р°РЅС‹ РїСЂРѕРІРµСЂСЏСЋС‚СЃСЏ РґРѕ rate-limit Рё РІСЃРµС… API-РјР°СЂС€СЂСѓС‚РѕРІ, РІРєР»СЋС‡Р°СЏ РІС…РѕРґ.
app.use((req, res, next) => {
  const ip = requestIp(req);
  if (ip && isIpBanned(ip)) {
    return res.status(403).json({ message: 'Р”РѕСЃС‚СѓРї СЃ СЌС‚РѕРіРѕ IP Р·Р°РїСЂРµС‰С‘РЅ', code: 'IP_BANNED' });
  }
  next();
});

// SEC: РїСЂРёРјРёС‚РёРІРЅС‹Р№ in-memory rate-limit (Р±РµР· РІРЅРµС€РЅРёС… Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№).
// Р’ РїСЂРѕРґРµ РЅР° РЅРµСЃРєРѕР»СЊРєРёС… РёРЅСЃС‚Р°РЅСЃР°С… вЂ” Р·Р°РјРµРЅРёС‚СЊ РЅР° Redis/express-rate-limit.
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
      return res.status(503).json({ message: 'РЎРµСЂРІРµСЂ РїРµСЂРµРіСЂСѓР¶РµРЅ, РїРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ' });
    }
    if (!rec || rec.reset < now) rec = { count: 0, reset: now + windowMs };
    rec.count++;
    hits.set(k, rec);
    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((rec.reset - now) / 1000));
      return res.status(429).json({ message: 'РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ Р·Р°РїСЂРѕСЃРѕРІ, РїРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ' });
    }
    next();
  };
}
const authLimiter = makeRateLimit({ windowMs: 60_000, max: 20 }); // 20 auth-Р·Р°РїСЂРѕСЃРѕРІ/РјРёРЅ СЃ IP
const searchLimiter = makeRateLimit({ windowMs: 60_000, max: 60 });
// SEC: Р»РёРјРёС‚С‹ РЅР° Р°СѓС‚РµРЅС‚РёС„РёС†РёСЂРѕРІР°РЅРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ. РљР»СЋС‡ вЂ” userId, Р° РЅРµ IP,
// РёРЅР°С‡Рµ РѕРґРёРЅ Р·Р»РѕР№ СЋР·РµСЂ Р·Р° NAT Р·Р°Р±Р»РѕРєРёСЂСѓРµС‚ РІСЃРµС… РѕСЃС‚Р°Р»СЊРЅС‹С….
const byUserKey = (req) => {
  // authMiddleware РµС‰С‘ РЅРµ РѕС‚СЂР°Р±РѕС‚Р°Р» РЅР° app.use-СѓСЂРѕРІРЅРµ, РїРѕСЌС‚РѕРјСѓ РґРµРєРѕРґРёСЂСѓРµРј JWT best-effort.
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const p = jwt.verify(auth.slice(7), JWT_SECRET);
      return 'u:' + p.sub;
    }
  } catch {}
  return 'ip:' + req.ip;
};
const messageLimiter = makeRateLimit({ windowMs: 60_000, max: 120, key: byUserKey }); // 120 СЃРѕРѕР±С‰РµРЅРёР№/РјРёРЅ
const uploadLimiter  = makeRateLimit({ windowMs: 60_000, max: 30,  key: byUserKey }); // 30 Р·Р°РіСЂСѓР·РѕРє/РјРёРЅ
const writeLimiter   = makeRateLimit({ windowMs: 60_000, max: 300, key: byUserKey }); // 300 mutating-Р·Р°РїСЂРѕСЃРѕРІ/РјРёРЅ
const languageCorrectionLimiter = makeRateLimit({ windowMs: 60_000, max: 20, key: byUserKey });
app.use(['/api/auth/device', '/api/auth/register', '/api/auth/login', '/api/auth/password', '/api/auth/passkey', '/api/auth/logout', '/api/auth/refresh'], authLimiter);
app.use('/api/users/search', searchLimiter);
// SEC: РєРѕРјРјРµРЅС‚Р°СЂРёРё СЃС‚РµРЅС‹ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ Рё РїСЂРѕРІРµСЂРєР° Р·Р°РЅСЏС‚РЅРѕСЃС‚Рё РЅРёРєР° вЂ” GET-РјР°СЂС€СЂСѓС‚С‹,
// РєРѕС‚РѕСЂС‹Рµ Р»РµРіРєРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РґР»СЏ СЃРєСЂРµР№РїРёРЅРіР°/РїРµСЂРµР±РѕСЂР°. РќР°Р·РЅР°С‡Р°РµРј СЃРІРѕР№ Р»РёРјРёС‚РµСЂ.
app.use('/api/users/:id/comments', searchLimiter);
app.use('/api/users/username-available', searchLimiter);
app.use(['/api/messages'], messageLimiter);
app.use(['/api/files', '/api/users/avatar', '/api/users/me/avatar', '/api/music', '/api/ai/models'], uploadLimiter);
app.use('/api/chats/:id/language-correction', languageCorrectionLimiter);
// Р¤РѕС‚Рѕ РїСЂРѕС‚Рѕ РґРѕСЃРєРё вЂ” С‚РѕР¶Рµ Р·Р°РіСЂСѓР·РєР°; РѕС‚РґРµР»СЊРЅР°СЏ С‚РѕС‡РєР°, С‡С‚РѕР±С‹ РѕР±С‹С‡РЅРѕРµ СЃРѕС…СЂР°РЅРµРЅРёРµ
// РєР°СЂС‚РѕС‡РµРє (PUT) РЅРµ СЃСЉРµРґР°Р»Рѕ Р»РёРјРёС‚ Р·Р°РіСЂСѓР·РѕРє.
app.use('/api/proto-boards/photo', uploadLimiter);
app.use('/api/proto-boards', writeLimiter);
// ZIP/yt-dlp С‚СЂРµР±СѓСЋС‚ РјРЅРѕРіРѕ RAM, CPU, РґРёСЃРєР° Рё СЃРµС‚РµРІРѕРіРѕ С‚СЂР°С„РёРєР°.
// РћР±С‰РёР№ Р»РёРјРёС‚РµСЂ РЅР° РІСЃРµ mutating API (fallback).
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.path.startsWith('/api/')) return next();
  return writeLimiter(req, res, next);
});

// SEC: /uploads РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ СЃ Р¶РёРІРѕР№ СЃРµСЃСЃРёРµР№. <img>/<audio> РЅРµ СѓРјРµСЋС‚ СЃР»Р°С‚СЊ
// Bearer, РїРѕСЌС‚РѕРјСѓ РїСЂРё РІС…РѕРґРµ СЃС‚Р°РІРёС‚СЃСЏ HttpOnly-cookie vera_media (path=/uploads),
// Р° Р·РґРµСЃСЊ РїСЂРѕРІРµСЂСЏРµС‚СЃСЏ РµС‘ РїРѕРґРїРёСЃСЊ Рё С‡С‚Рѕ СЃРµСЃСЃРёСЏ РЅРµ РѕС‚РѕР·РІР°РЅР°: logout, РѕС‚РІСЏР·РєР°
// СѓСЃС‚СЂРѕР№СЃС‚РІР° Рё Р±Р°РЅ СЃСЂР°Р·Сѓ Р·Р°РєСЂС‹РІР°СЋС‚ РґРѕСЃС‚СѓРї Рє С„Р°Р№Р»Р°Рј.
function mediaSessionValid(session) {
  const user = db.users.find(u => u.id === session.u);
  if (!user) return false;
  if (moderation.blocked(db, user.id, session.d)) return false;
  if (Number(session.tv || 0) !== Number(user.tokenVersion || 0)) return false;
  if (session.d) {
    const dev = (db.devices || []).find(d => d.userId === user.id && d.deviceId === session.d);
    if (!dev || dev.revoked) return false;
    if (Number(session.dv || 0) !== Number(dev.tokenVersion || 0)) return false;
  }
  return true;
}
const mediaAuth = createMediaAuth({
  secret: JWT_SECRET,
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  secure: IS_PROD,
  isSessionValid: mediaSessionValid,
});
app.use('/uploads', mediaAuth.middleware);

// SEC: /uploads СЂР°Р·РґР°С‘Рј РєР°Рє attachment + nosniff, С‡С‚РѕР±С‹ Р·Р°Р»РёС‚С‹Р№ .html/.svg РЅРµ РёСЃРїРѕР»РЅСЏР»СЃСЏ РІ РЅР°С€РµРј РґРѕРјРµРЅРµ.
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '30d',
  immutable: true,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // PERF: С„Р°Р№Р»С‹ РІ /uploads РёРјРµРЅСѓСЋС‚СЃСЏ СЃ СѓРЅРёРєР°Р»СЊРЅС‹Рј С…СЌС€РµРј/timestamp Рё РЅРµ
    // РјРµРЅСЏСЋС‚СЃСЏ вЂ” РєСЌС€РёСЂСѓРµРј Р°РіСЂРµСЃСЃРёРІРЅРѕ РЅР° 30 РґРЅРµР№. Р­С‚Рѕ СЂРµР·РєРѕ СЃРѕРєСЂР°С‰Р°РµС‚ РѕР±СЉС‘Рј
    // С‚СЂР°С„РёРєР° (Р°РІР°С‚Р°СЂРєРё/С„РѕС‚Рѕ РїСЂРё РїРѕРІС‚РѕСЂРЅС‹С… Р·Р°С…РѕРґР°С… РЅРµ С‚СЏРЅСѓС‚СЃСЏ Р·Р°РЅРѕРІРѕ).
    // private: С„Р°Р№Р»С‹ РІС‹РґР°СЋС‚СЃСЏ С‚РѕР»СЊРєРѕ РїРѕ cookie, РѕР±С‰РёРј РєСЌС€Р°Рј (CDN/РїСЂРѕРєСЃРё) РёС… С…СЂР°РЅРёС‚СЊ РЅРµР»СЊР·СЏ.
    res.setHeader('Cache-Control', 'private, max-age=2592000, immutable');
    const lower = filePath.toLowerCase();
    // SVG РЅР°РјРµСЂРµРЅРЅРѕ РЅРµ СЂР°Р·РґР°С‘Рј inline: РІ РЅС‘Рј РјРѕР¶РµС‚ Р±С‹С‚СЊ <script>. Р—Р°РіСЂСѓР·РєР° SVG
    // Рё С‚Р°Рє Р·Р°РїСЂРµС‰РµРЅР° (СЃРј. mimeFilter), С‚Р°Рє С‡С‚Рѕ СЌС‚Рѕ Р»РёС€СЊ СЃС‚СЂР°С…РѕРІРєР°.
    const inlineOk = /\.(png|jpe?g|gif|webp|mp3|ogg|wav|m4a|mp4|webm|mov)$/i.test(lower);
    if (!inlineOk) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  },
}));

// в”Ђв”Ђв”Ђ Р—Р°РіСЂСѓР·РєР° СѓСЃС‚Р°РЅРѕРІС‰РёРєРѕРІ РґРµСЃРєС‚РѕРї-РїСЂРёР»РѕР¶РµРЅРёСЏ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р¤Р°Р№Р»С‹ РєР»Р°РґС‘Рј РІ Server/public/downloads/. РљР»РёРµРЅС‚ С‡РёС‚Р°РµС‚ /api/downloads,
// Р° Р±РёРЅР°СЂРЅРёРєРё СЂР°Р·РґР°СЋС‚СЃСЏ РїРѕ /downloads/<file>.
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');
try { fs.mkdirSync(DOWNLOADS_DIR, { recursive: true }); } catch {}
// .apk/.exe are served with the address of the server the site was opened from
// (Cloudflare tunnel, localhost...), so the downloaded app connects to the same place.
app.use('/downloads', createDownloadStamper({ dir: DOWNLOADS_DIR }));
app.use('/downloads', express.static(DOWNLOADS_DIR, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // SEC: СЌРєСЂР°РЅРёСЂСѓРµРј РєР°РІС‹С‡РєРё/CR/LF РІ РёРјРµРЅРё, С‡С‚РѕР±С‹ РЅРµ СЂР°Р·РѕСЂРІР°С‚СЊ Р·Р°РіРѕР»РѕРІРѕРє.
    const safe = path.basename(filePath).replace(/[\r\n"\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// GET /api/downloads вЂ” СЃРїРёСЃРѕРє РґРѕСЃС‚СѓРїРЅС‹С… СѓСЃС‚Р°РЅРѕРІС‰РёРєРѕРІ СЃ Р°РІС‚Рѕ-РґРµС‚РµРєС‚РѕРј РїР»Р°С‚С„РѕСЂРјС‹.
// РџРѕРґРґРµСЂР¶РёРІР°РµС‚ РґРІР° РёСЃС‚РѕС‡РЅРёРєР°:
//   1) downloads.json РІ DOWNLOADS_DIR вЂ” РјР°СЃСЃРёРІ { platform, filename, size, url }.
//      РџРѕР·РІРѕР»СЏРµС‚ СѓРєР°Р·С‹РІР°С‚СЊ РІРЅРµС€РЅРёРµ URL (РЅР°РїСЂРёРјРµСЂ, GitHub Releases РґР»СЏ С„Р°Р№Р»РѕРІ >100 РњР‘).
//   2) РРЅР°С‡Рµ вЂ” СЃРєР°РЅРёСЂСѓРµС‚ С„Р°Р№Р»С‹ РІ DOWNLOADS_DIR (РґР»СЏ РјР°Р»РµРЅСЊРєРёС… СѓСЃС‚Р°РЅРѕРІС‰РёРєРѕРІ РІ git).
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

  // 2) СЃРєР°РЅРёСЂРѕРІР°РЅРёРµ РїР°РїРєРё
  let entries = [];
  try { entries = fs.readdirSync(DOWNLOADS_DIR); } catch { entries = []; }
  const files = entries
    .filter((name) => {
      if (name.startsWith('.')) return false;
      if (/^readme($|\.)/i.test(name)) return false;
      // РЎР»СѓР¶РµР±РЅС‹Рµ С„Р°Р№Р»С‹ (РјР°РЅРёС„РµСЃС‚С‹, С€Р°Р±Р»РѕРЅС‹, РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ) вЂ” РЅРµ СѓСЃС‚Р°РЅРѕРІС‰РёРєРё.
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
      else if (/\.(apk|aab)$/.test(lower)) platform = 'android';
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

// Serve built React app (Web/dist) вЂ” С‚РѕР»СЊРєРѕ СЃС‚Р°С‚РёРєР°, SPA fallback РґРѕР±Р°РІР»СЏРµС‚СЃСЏ РІ РєРѕРЅС†Рµ
const CLIENT_DIST = path.join(__dirname, '..', 'Web', 'dist');
// index.html Рё version.json РЅРµ РєСЌС€РёСЂСѓРµРј: РїРѕСЃР»Рµ РІС‹РєР»Р°РґРєРё РЅРѕРІРѕР№ СЃР±РѕСЂРєРё РєР»РёРµРЅС‚
// РґРѕР»Р¶РµРЅ СѓРІРёРґРµС‚СЊ РЅРѕРІС‹Р№ buildId Рё РїСЂРё РїРµСЂРµР·Р°РіСЂСѓР·РєРµ РїРѕР»СѓС‡РёС‚СЊ РЅРѕРІС‹Рµ СЃСЃС‹Р»РєРё РЅР°
// Р°СЃСЃРµС‚С‹. РЎР°РјРё Р°СЃСЃРµС‚С‹ СЃ С…РµС€РµРј РІ РёРјРµРЅРё РєСЌС€РёСЂСѓСЋС‚СЃСЏ РєР°Рє РѕР±С‹С‡РЅРѕ.
const NO_CACHE_CLIENT_FILES = new Set(['index.html', 'version.json', 'sw.js']);
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, {
    setHeaders(res, filePath) {
      if (NO_CACHE_CLIENT_FILES.has(path.basename(filePath))) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
}

// Р’РµСЂСЃРёСЏ РІРµР±-РєР»РёРµРЅС‚Р°, РєРѕС‚РѕСЂС‹Р№ СЃРµР№С‡Р°СЃ СЂР°Р·РґР°С‘С‚ СЃРµСЂРІРµСЂ. РџСѓР±Р»РёС‡РЅР°СЏ: buildId РЅРµ
// СЃРµРєСЂРµС‚, Р° РїСЂРѕРІРµСЂРєР° РѕР±РЅРѕРІР»РµРЅРёР№ РёРґС‘С‚ Рё РґРѕ РІС…РѕРґР°. Р¤Р°Р№Р» С‡РёС‚Р°РµС‚СЃСЏ РїСЂРё РєР°Р¶РґРѕРј
// Р·Р°РїСЂРѕСЃРµ, РїРѕСЌС‚РѕРјСѓ РЅРѕРІР°СЏ СЃР±РѕСЂРєР° РІРёРґРЅР° Р±РµР· РїРµСЂРµР·Р°РїСѓСЃРєР° СЃРµСЂРІРµСЂР°.
app.get('/api/client-version', (req, res) => {
  fs.readFile(path.join(CLIENT_DIST, 'version.json'), 'utf8', (err, raw) => {
    if (err) return res.status(404).json({ message: 'Р’РµСЂСЃРёСЏ РєР»РёРµРЅС‚Р° РЅРµРґРѕСЃС‚СѓРїРЅР°' });
    try {
      const { buildId } = JSON.parse(raw);
      if (typeof buildId !== 'string' || !buildId) throw new Error('bad buildId');
      res.json({ buildId });
    } catch {
      res.status(500).json({ message: 'РџРѕРІСЂРµР¶РґС‘РЅ version.json' });
    }
  });
});

// в”Ђв”Ђв”Ђ Auth middleware в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// SEC: JWT СЃРѕРґРµСЂР¶РёС‚ { sub, deviceId, tv }. РџСЂРѕРІРµСЂСЏРµРј:
//   1) РїРѕРґРїРёСЃСЊ/СЃСЂРѕРє;
//   2) СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РґРѕ СЃРёС… РїРѕСЂ РїСЂРёРІСЏР·Р°РЅРѕ (СѓРґР°Р»С‘РЅРЅРѕРµ = РјРіРЅРѕРІРµРЅРЅС‹Р№ logout);
//   3) tokenVersion РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃРѕРІРїР°РґР°РµС‚ (РіР»РѕР±Р°Р»СЊРЅС‹Р№ "revoke-all-sessions").
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
    // Р РµР¶РёРј В«С‚РѕР»СЊРєРѕ С‡С‚РµРЅРёРµВ»: С‡РёС‚Р°С‚СЊ Рё РїРѕРґР°РІР°С‚СЊ Р°РїРµР»Р»СЏС†РёСЋ РјРѕР¶РЅРѕ, РјРµРЅСЏС‚СЊ вЂ” РЅРµС‚.
    if (moderation.readOnly(db, userId) &&
      !moderation.readOnlyAllows(req.method, String(req.originalUrl || req.url || '').split('?')[0])) {
      return res.status(403).json({ message: 'РђРєРєР°СѓРЅС‚ РІ СЂРµР¶РёРјРµ С‚РѕР»СЊРєРѕ С‡С‚РµРЅРёСЏ', code: 'READ_ONLY' });
    }
    next();
  } catch (e) {
    res.status(401).json({ message: 'Invalid token', reason: e.message });
  }
}

// Р•РґРёРЅР°СЏ С‚РѕС‡РєР° РІС‹РїСѓСЃРєР° access-С‚РѕРєРµРЅР° вЂ” РІСЃРµ /auth/* СЂРѕСѓС‚С‹ РёСЃРїРѕР»СЊР·СѓСЋС‚ РµС‘.
// SEC: expiresIn=15m. РљР»РёРµРЅС‚ СЂРµС„СЂРµС€РёС‚ С‡РµСЂРµР· /auth/refresh (HttpOnly cookie).
// РЎСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ 30d-С‚РѕРєРµРЅС‹ РѕСЃС‚Р°СЋС‚СЃСЏ РІР°Р»РёРґРЅС‹ РґРѕ РёСЃС‚РµС‡РµРЅРёСЏ вЂ” РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё РЅРµ Р»РѕРјР°РµРј.
function issueAccessToken(user, deviceId) {
  if (typeof user.tokenVersion !== 'number') user.tokenVersion = 0;
  return jwt.sign(
    { sub: user.id, deviceId: deviceId || null, tv: user.tokenVersion, dv: Number(getDeviceForUser(user.id, deviceId)?.tokenVersion || 0) },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
}

// в”Ђв”Ђв”Ђ CAPTCHA РїСЂРѕРІРµСЂРєР° РїСЂРё СЂРµРіРёСЃС‚СЂР°С†РёРё в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р’ СЂРµР¶РёРјРµ СЂР°Р·СЂР°Р±РѕС‚РєРё РїСЂРёРЅРёРјР°РµС‚ Р»СЋР±РѕР№ РЅРµРїСѓСЃС‚РѕР№ С‚РѕРєРµРЅ РґР»РёРЅРѕР№ >= 10 СЃРёРјРІРѕР»РѕРІ.
// Р”Р»СЏ РїСЂРѕРґР°РєС€РµРЅР°: Р·Р°РґР°Р№С‚Рµ CAPTCHA_PROVIDER (hcaptcha|recaptcha|turnstile) Рё
// CAPTCHA_SECRET_KEY РІ РїРµСЂРµРјРµРЅРЅС‹С… РѕРєСЂСѓР¶РµРЅРёСЏ, С‚РѕРіРґР° С‚РѕРєРµРЅ Р±СѓРґРµС‚ РїСЂРѕРІРµСЂСЏС‚СЊСЃСЏ
// С‡РµСЂРµР· API РїСЂРѕРІР°Р№РґРµСЂР° (siteverify) РїРµСЂРµРґ СЃРѕР·РґР°РЅРёРµРј Р°РєРєР°СѓРЅС‚Р°.
async function verifyCaptchaToken(token) {
  if (!token || typeof token !== 'string' || token.length < 10) return false;

  const provider = process.env.CAPTCHA_PROVIDER;
  const secret = process.env.CAPTCHA_SECRET_KEY;

  // Р РµР¶РёРј СЂР°Р·СЂР°Р±РѕС‚РєРё вЂ” РјРѕРє, Р±РµР· СЂРµР°Р»СЊРЅРѕР№ РїСЂРѕРІРµСЂРєРё РїСЂРѕРІР°Р№РґРµСЂР°.
  if (!provider || !secret) return true;

  try {
    const fetchFn = globalThis.fetch;
    if (!fetchFn) return false;
    let verifyUrl;
    let body;

    if (provider === 'hcaptcha') {
      verifyUrl = 'https://hcaptcha.com/siteverify';
      body = new URLSearchParams({ secret, response: token });
    } else if (provider === 'recaptcha') {
      verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
      body = new URLSearchParams({ secret, response: token });
    } else if (provider === 'turnstile') {
      verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
      body = JSON.stringify({ secret, response: token });
    } else {
      return true; // РЅРµРёР·РІРµСЃС‚РЅС‹Р№ РїСЂРѕРІР°Р№РґРµСЂ вЂ” РїСЂРѕРїСѓСЃРєР°РµРј (fail open РґР»СЏ РґРµР±Р°РіР°)
    }

    const res = await fetchFn(verifyUrl, {
      method: 'POST',
      headers: provider === 'turnstile' ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    return json.success === true;
  } catch {
    // РџСЂРё РѕС€РёР±РєРµ СЃРµС‚Рё Рє РїСЂРѕРІР°Р№РґРµСЂСѓ вЂ”fail closed: РЅРµ СЃРѕР·РґР°С‘Рј Р°РєРєР°СѓРЅС‚.
    return false;
  }
}

// в”Ђв”Ђв”Ђ Refresh tokens (СЂРѕС‚Р°С†РёСЏ + reuse-detection) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РЎС…РµРјР°:
//   - Refresh-С‚РѕРєРµРЅ = СЃР»СѓС‡Р°Р№РЅС‹Рµ 32 Р±Р°Р№С‚Р° (РЅРµ JWT), С…СЂР°РЅРёС‚СЃСЏ Р·Р°С…СЌС€РёСЂРѕРІР°РЅРЅС‹Рј.
//   - РќР° РєР°Р¶РґРѕРµ /auth/refresh СЃС‚Р°СЂС‹Р№ С‚РѕРєРµРЅ РїРѕРјРµС‡Р°РµС‚СЃСЏ used=true Рё РІС‹РґР°С‘С‚СЃСЏ РЅРѕРІС‹Р№
//     РёР· С‚РѕР№ Р¶Рµ В«СЃРµРјСЊРёВ» (familyId). Р•СЃР»Рё РїСЂРёС€С‘Р» СѓР¶Рµ used-С‚РѕРєРµРЅ в†’ reuse-attack:
//     РёРЅРІР°Р»РёРґРёСЂСѓРµРј РІСЃСЋ СЃРµРјСЊСЋ Рё РёРЅРєСЂРµРјРµРЅС‚РёРј tokenVersion (РІСЃРµ СЃРµСЃСЃРёРё revoke).
//   - Refresh С…СЂР°РЅРёС‚СЃСЏ 30 РґРЅРµР№. Cookie: HttpOnly, Secure (РІ prod), SameSite=Strict.
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
  // РЈР±РѕСЂРєР° РјСѓСЃРѕСЂР°: СЃС‚Р°СЂС€Рµ TTL РёР»Рё РёСЃРїРѕР»СЊР·РѕРІР°РЅРЅС‹С… РґР°РІРЅРѕ.
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

// user/deviceId РЅСѓР¶РЅС‹ РґР»СЏ cookie РґРѕСЃС‚СѓРїР° Рє /uploads (СЃРј. mediaAuth).
function setAuthCookies(res, refreshRaw, user, deviceId) {
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  if (user) {
    mediaAuth.setCookie(res, {
      userId: user.id,
      deviceId: deviceId || null,
      tv: Number(user.tokenVersion || 0),
      dv: Number(getDeviceForUser(user.id, deviceId)?.tokenVersion || 0),
    });
  }
  const common = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_TTL_MS,
  };
  res.cookie(REFRESH_COOKIE, refreshRaw, common);
  // CSRF-cookie РЅРµ HttpOnly: JS РґРѕР»Р¶РµРЅ РїСЂРѕС‡РёС‚Р°С‚СЊ Рё РїРѕР»РѕР¶РёС‚СЊ РІ X-CSRF-Token.
  res.cookie(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false });
  return csrfToken;
}

function clearAuthCookies(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE,    { path: '/' });
  mediaAuth.clearCookie(res);
}

// SEC: double-submit CSRF вЂ” cookie РґРѕР»Р¶РµРЅ СЃРѕРІРїР°СЃС‚СЊ СЃ Р·Р°РіРѕР»РѕРІРєРѕРј.
// РџСЂРёРјРµРЅСЏРµС‚СЃСЏ Рє cookie-Р·Р°РІРёСЃРёРјС‹Рј endpoint'Р°Рј (refresh, logout РїСЂРё cookie-auth).
function csrfCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const cookieTok = req.cookies?.[CSRF_COOKIE];
  const headerTok = req.headers['x-csrf-token'];
  if (!cookieTok || !headerTok || cookieTok !== headerTok) {
    return res.status(403).json({ message: 'CSRF token missing or mismatched' });
  }
  next();
}

// POST /api/auth/refresh вЂ” СЂРѕС‚Р°С†РёСЏ. Cookie in, cookie out. Р’РѕР·РІСЂР°С‰Р°РµС‚ РЅРѕРІС‹Р№ accessToken.
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
    // SEC: reuse-attack вЂ” С‚РѕРєРµРЅ СѓР¶Рµ Р±С‹Р» РёСЃРїРѕР»СЊР·РѕРІР°РЅ. РРЅРІР°Р»РёРґРёСЂСѓРµРј РІСЃСЋ СЃРµРјСЊСЋ
    // Рё РіР»РѕР±Р°Р»СЊРЅРѕ РёРЅРєСЂРµРјРµРЅС‚РёРј tokenVersion СЋР·РµСЂР°.
    revokeFamily(rec.familyId, 'reuse');
    const user = db.users.find(u => u.id === rec.userId);
    if (user) user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    saveDb();
    clearAuthCookies(res);
    return res.status(401).json({ message: 'Refresh reuse detected', reason: 'reuse' });
  }
  const user = db.users.find(u => u.id === rec.userId);
  if (moderation.blocked(db, rec.userId, rec.deviceId)) return res.status(403).json({ message: 'Р”РѕСЃС‚СѓРї Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ', code: 'ACCOUNT_BANNED' });
  if (!user) {
    clearAuthCookies(res);
    return res.status(401).json({ message: 'User not found', reason: 'user_gone' });
  }
  // РЈСЃС‚СЂРѕР№СЃС‚РІРѕ РґРѕР»Р¶РЅРѕ РѕСЃС‚Р°РІР°С‚СЊСЃСЏ РїСЂРёРІСЏР·Р°РЅРЅС‹Рј.
  if (rec.deviceId) {
    const dev = (db.devices || []).find(d => d.userId === user.id && d.deviceId === rec.deviceId);
    if (!dev || dev.revoked) {
      revokeFamily(rec.familyId, 'device_revoked');
      saveDb();
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Device revoked', reason: 'device_revoked' });
    }
  }
  // Р РѕС‚Р°С†РёСЏ: РїРѕРјРµС‡Р°РµРј СЃС‚Р°СЂС‹Р№, РІС‹РґР°С‘Рј РЅРѕРІС‹Р№ РёР· С‚РѕР№ Р¶Рµ СЃРµРјСЊРё.
  rec.usedAt = Date.now();
  const { raw: newRaw } = issueRefreshToken(user, rec.deviceId, rec.familyId);
  saveDb();
  setAuthCookies(res, newRaw, user, rec.deviceId);
  const accessToken = issueAccessToken(user, rec.deviceId);
  res.json({ accessToken, user });
});

// в”Ђв”Ђв”Ђ Multer storage в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// SEC: Р±РµР»С‹Рµ СЃРїРёСЃРєРё MIME/СЂР°СЃС€РёСЂРµРЅРёР№. UUID-РёРјСЏ С„Р°Р№Р»Р°, Р±РµР·РѕРїР°СЃРЅРѕРµ СЂР°СЃС€РёСЂРµРЅРёРµ.
//
// Р Р°СЃС€РёСЂРµРЅРёРµ Р±РµСЂС‘С‚СЃСЏ РёР· РёРјРµРЅРё, РїСЂРёС…РѕРґСЏС‰РµРіРѕ РѕС‚ РєР»РёРµРЅС‚Р°, РїРѕСЌС‚РѕРјСѓ СЂР°РЅСЊС€Рµ РјРѕР¶РЅРѕ
// Р±С‹Р»Рѕ РїРѕР»РѕР¶РёС‚СЊ РЅР° РґРёСЃРє С‡С‚Рѕ СѓРіРѕРґРЅРѕ: evil.html, x.js, x.xhtml, x.mht... MIME
// РїСЂРё СЌС‚РѕРј РїРѕРґРґРµР»С‹РІР°РµС‚СЃСЏ С‚СЂРёРІРёР°Р»СЊРЅРѕ (СЌС‚Рѕ РїСЂРѕСЃС‚Рѕ Р·Р°РіРѕР»РѕРІРѕРє РєР»РёРµРЅС‚Р°). РЎРїРёСЃРѕРє
// СЂР°СЃС€РёСЂРµРЅРёР№ С‚РµРїРµСЂСЊ Р—РђРљР Р«РўР«Р™: РЅРµРёР·РІРµСЃС‚РЅРѕРµ РѕС‚Р±СЂР°СЃС‹РІР°РµС‚СЃСЏ, С„Р°Р№Р» СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ
// РІРѕРѕР±С‰Рµ Р±РµР· СЂР°СЃС€РёСЂРµРЅРёСЏ. Р›РёС€РЅРёРµ РїСЂРѕРІРµСЂРєРё РЅР° СЃРµСЂРІРµСЂРµ СЂР°Р·РґР°С‡Рё (attachment +
// nosniff + CSP sandbox) РѕСЃС‚Р°СЋС‚СЃСЏ РІС‚РѕСЂС‹Рј СЌС€РµР»РѕРЅРѕРј.
const SAFE_EXTENSIONS = new Set([
  // РёР·РѕР±СЂР°Р¶РµРЅРёСЏ
  '.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.avif', '.bmp', '.heic', '.heif', '.tiff',
  // Р°СѓРґРёРѕ
  '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.weba', '.aiff',
  // РІРёРґРµРѕ
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv', '.avi',
  // РґРѕРєСѓРјРµРЅС‚С‹
  '.pdf', '.txt', '.csv', '.md', '.log', '.json', '.rtf', '.epub', '.ics',
  // С€СЂРёС„С‚С‹ (РѕР±С‰РёРµ СЃС‚РѕРєРѕРІС‹Рµ РѕС‚ Р°РґРјРёРЅР°): СЂР°СЃС€РёСЂРµРЅРёРµ РЅСѓР¶РЅРѕ СЃРѕС…СЂР°РЅРёС‚СЊ, РїРѕ РЅРµРјСѓ
  // Р±СЂР°СѓР·РµСЂ РїРѕРЅРёРјР°РµС‚ С„РѕСЂРјР°С‚ вЂ” Р±РµР· .woff2 С„Р°Р№Р» РѕС‚РґР°С‘С‚СЃСЏ В«РЅРµРїРѕРЅСЏС‚РЅС‹РјВ» Рё РјРѕР¶РµС‚
  // РЅРµ РїСЂРёРјРµРЅРёС‚СЊСЃСЏ (СЃРј. adminFontFaceRule).
  '.ttf', '.otf', '.woff', '.woff2',
  '.zip', '.7z', '.rar', '.gz', '.tar', '.bz2',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
]);

function safeExt(name) {
  const e = path.extname(String(name || '')).toLowerCase();
  return SAFE_EXTENSIONS.has(e) ? e : '';
}
function makeStorage(subfolder) {
  return multer.diskStorage({
    destination: path.join(UPLOADS_DIR, subfolder),
    filename: (req, file, cb) => {
      cb(null, uuidv4() + safeExt(file.originalname));
    },
  });
}

// SEC: СЃРёРіРЅР°С‚СѓСЂР° Р°РєС‚РёРІРЅРѕРіРѕ РєРѕРЅС‚РµРЅС‚Р°. РџСЂРѕРІРµСЂСЏРµРј РЅР°С‡Р°Р»Рѕ С„Р°Р№Р»Р°, РїРѕС‚РѕРјСѓ С‡С‚Рѕ С‚РёРї
// Рё РёРјСЏ РїСЂРёС…РѕРґСЏС‚ РѕС‚ РєР»РёРµРЅС‚Р°. HTML/SVG/XML РЅРµ РґРѕР»Р¶РЅС‹ РѕСЃРµРґР°С‚СЊ РЅР° РґРёСЃРєРµ РґР°Р¶Рµ РїРѕРґ
// РІРёРґРѕРј В«РєР°СЂС‚РёРЅРєРёВ» вЂ” РёРЅР°С‡Рµ СЌС‚Рѕ РіРѕС‚РѕРІС‹Р№ payload РґР»СЏ СЃСЃС‹Р»РѕРє РІРёРґР° В«РѕС‚РєСЂС‹С‚СЊВ».
const ACTIVE_CONTENT_RE = /^\s*(?:<\?xml|<!doctype\s+html|<html|<head|<body|<script|<svg|<iframe|<object|<embed|<meta)/i;
function sniffActiveContent(filePath) {
  let fd;
  try { fd = fs.openSync(filePath, 'r'); } catch { return false; }
  try {
    const buf = Buffer.alloc(512);
    const read = fs.readSync(fd, buf, 0, 512, 0);
    return read > 0 && ACTIVE_CONTENT_RE.test(buf.subarray(0, read).toString('utf8'));
  } catch { return false; } finally {
    try { fs.closeSync(fd); } catch {}
  }
}
/** РЈРґР°Р»СЏРµС‚ СЃРІРµР¶РµР·Р°РіСЂСѓР¶РµРЅРЅС‹Р№ С„Р°Р№Р» Рё РѕС‚РІРµС‡Р°РµС‚ 400, РµСЃР»Рё СЌС‚Рѕ Р°РєС‚РёРІРЅС‹Р№ РєРѕРЅС‚РµРЅС‚. */
function dropIfActiveContent(req, res) {
  if (!req.file || !req.file.path) return false;
  if (!sniffActiveContent(req.file.path)) {
    const info = sanitizeStoredImage(req.file.path, req.file.mimetype, req.file.originalname);
    if (!info) {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(400).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ С„Р°Р№Р»' });
      return true;
    }
    Object.assign(req.file, info);
    return false;
  }
  try { fs.unlinkSync(req.file.path); } catch {}
  res.status(400).json({ message: 'Р¤Р°Р№Р» СЃРѕРґРµСЂР¶РёС‚ Р·Р°РїСЂРµС‰С‘РЅРЅС‹Р№ Р°РєС‚РёРІРЅС‹Р№ РєРѕРЅС‚РµРЅС‚ (HTML/SVG/XML)' });
  return true;
}
function mimeFilter(allowedPrefixes, allowedExact = []) {
  return (req, file, cb) => {
    let mt = String(file.mimetype || '').toLowerCase();
    // Р¤Р°Р№Р» Р±РµР· MIME-С‚РёРїР° вЂ” РѕР±С‹С‡РЅРѕРµ РґРµР»Рѕ РґР»СЏ HEIC/RAW СЃ С‚РµР»РµС„РѕРЅР° Рё РєР°РјРµСЂС‹, Р°
    // Р±СЂР°СѓР·РµСЂ РёРЅРѕРіРґР° РЅРµ РѕРїСЂРµРґРµР»СЏРµС‚ С‚РёРї РІРѕРІСЃРµ. РћС‚РєР»РѕРЅСЏС‚СЊ С‚Р°РєРѕРµ РїРѕ В«РЅРµРёР·РІРµСЃС‚РЅРѕРјСѓ
    // С‚РёРїСѓВ» РЅРµР»СЊР·СЏ: Р°РґРјРёРЅ РЅРµ Р·Р°РіСЂСѓР·РёС‚ С„РѕС‚Рѕ, СЃРЅСЏС‚РѕРµ РЅР° Р°Р№С„РѕРЅ. РўРёРї СѓРіР°РґС‹РІР°РµРј РїРѕ
    // СЂР°СЃС€РёСЂРµРЅРёСЋ РёР· SAFE_EXTENSIONS вЂ” Р»РёС€РЅРёРµ СЂР°СЃС€РёСЂРµРЅРёСЏ С‚Р°Рє РЅРµ РїСЂРѕР№РґСѓС‚.
    if (!mt || mt === 'application/octet-stream') {
      const ext = path.extname(String(file.originalname || '')).toLowerCase();
      mt = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
        '.heic': 'image/heic', '.heif': 'image/heif', '.tiff': 'image/tiff',
      }[ext] || mt;
    }
    // SVG Р·Р°РїСЂРµС‰Р°РµРј вЂ” РјРѕР¶РµС‚ СЃРѕРґРµСЂР¶Р°С‚СЊ <script>.
    if (mt === 'image/svg+xml') return cb(new Error('SVG Р·Р°РїСЂРµС‰С‘РЅ'));
    const ok = allowedPrefixes.some(p => mt.startsWith(p)) || allowedExact.includes(mt);
    if (!ok) return cb(new Error('РўРёРї С„Р°Р№Р»Р° РЅРµ СЂР°Р·СЂРµС€С‘РЅ: ' + mt));
    cb(null, true);
  };
}
const uploadMusic   = multer({ storage: makeStorage('music'),   limits: { fileSize: 50 * 1024 * 1024 },  fileFilter: mimeFilter(['audio/']) });
// РћР±Р»РѕР¶РєРё С‚СЂРµРєРѕРІ/Р°Р»СЊР±РѕРјРѕРІ: РєР°СЂС‚РёРЅРєР°, РЅРѕ РѕС‚РґРµР»СЊРЅС‹Рј Р»РёРјРёС‚РѕРј. РћС‚РґРµР»СЊРЅС‹Р№ РёРЅСЃС‚Р°РЅСЃ
// РЅСѓР¶РµРЅ РїРѕС‚РѕРјСѓ, С‡С‚Рѕ fileFilter Сѓ uploadMusic РїСЂРѕРїСѓСЃРєР°РµС‚ РўРћР›Р¬РљРћ audio/ вЂ” РѕР±Р»РѕР¶РєР°
// С‡РµСЂРµР· РЅРµРіРѕ РЅРµ РїСЂРѕС€Р»Р° Р±С‹ РЅРёРєРѕРіРґР°.
const uploadCover  = multer({ storage: makeStorage('music'),   limits: { fileSize: 8 * 1024 * 1024 },   fileFilter: mimeFilter(['image/'], []) });
const uploadAvatar  = multer({ storage: makeStorage('avatars'), limits: { fileSize: 5 * 1024 * 1024 },   fileFilter: mimeFilter(['image/'], []) });
// Р¤РѕРЅС‹ РѕР±РѕРµРІ: РѕС‚РґРµР»СЊРЅР°СЏ РїР°РїРєР°, С‡С‚РѕР±С‹ СѓРґР°Р»РµРЅРёРµ С„РѕРЅР° СЃРЅРѕСЃРёР»Рѕ Рё С„Р°Р№Р» (СЃРј. admin-wallpapers.js),
// Рё РєР°СЂС‚РёРЅРѕРє РїРѕР±РѕР»СЊС€Рµ, С‡РµРј Сѓ Р°РІР°С‚Р°СЂРѕРє: РѕР±РѕРё РІРµС€Р°СЋС‚СЃСЏ РЅР° РІРµСЃСЊ С‡Р°С‚.
const uploadWallpaper = multer({ storage: makeStorage('wallpapers'), limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: mimeFilter(['image/'], []) });
// Р¤РѕС‚Рѕ РїСЂРѕС‚Рѕ РґРѕСЃРєРё: СЃРІРѕСЏ РїР°РїРєР°, С‡С‚РѕР±С‹ СѓРґР°Р»РµРЅРёРµ РєР°СЂС‚РѕС‡РєРё СЃРЅРѕСЃРёР»Рѕ Рё С„Р°Р№Р».
const uploadProtoPhoto = multer({ storage: makeStorage('proto'), limits: { fileSize: 12 * 1024 * 1024 }, fileFilter: mimeFilter(['image/'], []) });
// РћР±С‰РёРµ С€СЂРёС„С‚С‹ Р°РґРјРёРЅР°: MIME Сѓ С€СЂРёС„С‚РѕРІ РЅРµРЅР°РґС‘Р¶РµРЅ (РѕР±С‹С‡РЅРѕ application/octet-stream),
// РїРѕСЌС‚РѕРјСѓ С„РёР»СЊС‚СЂСѓРµРј РїРѕ СЂР°СЃС€РёСЂРµРЅРёСЋ С„Р°Р№Р»Р°.
const uploadFont = multer({
  storage: makeStorage('fonts'),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.woff', '.woff2', '.ttf', '.otf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('РќРµРґРѕРїСѓСЃС‚РёРјРѕРµ СЂР°СЃС€РёСЂРµРЅРёРµ С€СЂРёС„С‚Р°'));
    cb(null, true);
  },
});
const uploadCommunityTheme = multer({
  storage: makeStorage('community-themes'),
  limits: { fileSize: 12 * 1024 * 1024, files: 3, fields: 6 },
});
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

// SEC: РѕР±СЂР°Р±РѕС‚С‡РёРє РѕС€РёР±РѕРє Multer вЂ” РІРѕР·РІСЂР°С‰Р°РµРј РїРѕРЅСЏС‚РЅС‹Р№ 4xx РІРјРµСЃС‚Рѕ 500 СЃ stack.
function handleUploadError(err, req, res, next) {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Р¤Р°Р№Р» СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№' : (err.message || 'РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё');
  res.status(400).json({ message: msg });
}

// в”Ђв”Ђв”Ђ AUTH: Р°РєРєР°СѓРЅС‚ = СѓСЃС‚СЂРѕР№СЃС‚РІРѕ (Р±РµР· email/РєРѕРґР°) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// POST /api/auth/device вЂ” РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ РІС…РѕРґ/СЂРµРіРёСЃС‚СЂР°С†РёСЏ.
// РљР»РёРµРЅС‚ С€Р»С‘С‚ { deviceId, deviceName }. Р•СЃР»Рё СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РїСЂРёРІСЏР·Р°РЅРѕ Рє Р°РєРєР°СѓРЅС‚Сѓ
// (СЃР°Рј РїРµСЂРІС‹Р№ РёР»Рё РґРѕР±Р°РІР»РµРЅ РїРѕ QR С‡РµСЂРµР· /devices/link/accept) вЂ” РІРѕР·РІСЂР°С‰Р°РµРј С‚РѕРєРµРЅ.
// Р•СЃР»Рё РЅРµС‚ вЂ” СЃРѕР·РґР°С‘Рј РЅРѕРІС‹Р№ Р°РєРєР°СѓРЅС‚ Рё РґРµР»Р°РµРј СЌС‚Рѕ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ primary.
app.post('/api/auth/device', (req, res) => {
  const installation = resolveInstallation(req, res);
  if (!installation) return;
  const rawDeviceId = req.body?.deviceId;
  const deviceName = (req.body?.deviceName || '').toString().slice(0, 80) || 'РњРѕС‘ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ';
  if (!rawDeviceId || typeof rawDeviceId !== 'string') {
    return res.status(400).json({ message: 'deviceId РѕР±СЏР·Р°С‚РµР»РµРЅ' });
  }
  const deviceId = installation.deviceId;

  // 1) РЈСЃС‚СЂРѕР№СЃС‚РІРѕ СѓР¶Рµ РїСЂРёРІСЏР·Р°РЅРѕ (РїРµСЂРІРѕРµ РёР»Рё РґРѕР±Р°РІР»РµРЅРЅРѕРµ РїРѕ QR) вЂ” РІС…РѕРґ.
  const existingDevice = (db.devices || []).find(d => d.deviceId === deviceId);
  if (existingDevice && !existingDevice.loggedOut) {
    existingDevice.installationHash = installation.hash;
    const user = db.users.find(u => u.id === existingDevice.userId);
    if (!user) return res.status(500).json({ message: 'РђРєРєР°СѓРЅС‚ РЅРµ РЅР°Р№РґРµРЅ РґР»СЏ СѓСЃС‚СЂРѕР№СЃС‚РІР°' });
    existingDevice.lastSeenAt = Date.now();
    if (deviceName) existingDevice.name = deviceName;
    user.isOnline = true;
    user.lastSeen = new Date().toISOString();
    recordModerationIp(user.id, requestIp(req));
    saveDb();
    const accessToken = issueAccessToken(user, deviceId);
    const { raw: refreshRaw } = issueRefreshToken(user, deviceId);
    saveDb();
    const csrfToken = setAuthCookies(res, refreshRaw, user, deviceId);
    return res.json({ accessToken, csrfToken, deviceId, user: withDevFlag(req, user), isNewUser: false });
  }

  // 2) РЈСЃС‚СЂРѕР№СЃС‚РІРѕ РЅРµ РїСЂРёРІСЏР·Р°РЅРѕ. РђРєРєР°СѓРЅС‚С‹ Р±РµР· РїР°СЂРѕР»СЏ Р±РѕР»СЊС€Рµ РЅРµ СЃРѕР·РґР°СЋС‚СЃСЏ:
  // РЅРѕРІС‹Р№ Р°РєРєР°СѓРЅС‚ вЂ” С‚РѕР»СЊРєРѕ С‡РµСЂРµР· /auth/register (РЅРёРє + РїР°СЂРѕР»СЊ), РІС…РѕРґ РЅР° РЅРѕРІРѕРј
  // СѓСЃС‚СЂРѕР№СЃС‚РІРµ вЂ” РїР°СЂРѕР»РµРј (/auth/login) РёР»Рё СЃСЃС‹Р»РєРѕР№ РїСЂРёРІСЏР·РєРё.
  return res.status(409).json({ message: 'Р’РѕР№РґРёС‚Рµ РїРѕ РЅРёРєСѓ Рё РїР°СЂРѕР»СЋ, Р·Р°СЂРµРіРёСЃС‚СЂРёСЂСѓР№С‚РµСЃСЊ РёР»Рё РѕС‚РєСЂРѕР№С‚Рµ СЃСЃС‹Р»РєСѓ РїСЂРёРІСЏР·РєРё.', reason: 'unregistered_device' });
});

// в”Ђв”Ђв”Ђ РЈСЃС‚Р°СЂРµРІС€РёРµ РјР°СЂС€СЂСѓС‚С‹ СѓРґР°Р»РµРЅС‹: /auth/request-code, /auth/verify,
// /auth/send-code, /auth/verify-code. РћСЃС‚Р°РІР»РµРЅР° РѕРґРЅР° С‚РѕС‡РєР° /auth/device.
// РќРёР¶Рµ СЃР»РµРґСѓРµС‚ /auth/logout Рё /auth/me.

// Password fallback. Passwords are never logged or returned to the client.
// Existing bcrypt hashes are upgraded to Argon2id after the first successful login.
function authUserResponse(req, res, user, device, isNewUser = false) {
  const deviceId = device.deviceId;
  user.isOnline = true;
  user.lastSeen = new Date().toISOString();
  markActiveDay(user); // СѓС‡С‘С‚ Р°РєС‚РёРІРЅС‹С… РґРЅРµР№ (СЂРµС„РµСЂР°Р»СЊРЅР°СЏ РїСЂРѕРіСЂР°РјРјР°)
  recordModerationIp(user.id, requestIp(req));
  db.loginEvents.push({ id: uuidv4(), userId: user.id, deviceId, method: 'password', ip: requestIp(req), createdAt: Date.now() });
  db.loginEvents = db.loginEvents.slice(-5000);
  const accessToken = issueAccessToken(user, deviceId);
  const { raw } = issueRefreshToken(user, deviceId);
  const csrfToken = setAuthCookies(res, raw, user, deviceId);
  saveDb();
  return res.json({ accessToken, csrfToken, deviceId, user: withDevFlag(req, user), isNewUser });
}

function getDeviceNameForRequest(req) {
  return String(req.body?.deviceName || 'РњРѕС‘ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ').slice(0, 80);
}

function passwordAttemptKey(req, identifier) {
  return `${requestIp(req)}:${identifier}`;
}

function passwordAttemptBlocked(key) {
  const attempt = passwordFailures.get(key);
  if (!attempt) return false;
  if (attempt.lockedUntil > Date.now()) return true;
  if (attempt.lockedUntil && attempt.lockedUntil <= Date.now()) passwordFailures.delete(key);
  return false;
}

function recordPasswordFailure(key) {
  const current = passwordFailures.get(key) || { count: 0, lockedUntil: 0 };
  current.count += 1;
  if (current.count >= PASSWORD_FAILURE_LIMIT) current.lockedUntil = Date.now() + PASSWORD_LOCK_MS;
  passwordFailures.set(key, current);
  return current;
}

// РџСЂРёРІРµС‚СЃС‚РІРµРЅРЅС‹Р№ Р±РѕРЅСѓСЃ РЅРѕРІРѕРјСѓ Р°РєРєР°СѓРЅС‚Сѓ (РІ Р’Рџ).
const REGISTRATION_BONUS_VP = 200;
// POST /api/auth/register вЂ” СЂРµРіРёСЃС‚СЂР°С†РёСЏ РїРѕ РЅРёРєСѓ Рё РїР°СЂРѕР»СЋ.
// РўРµР»РµС„РѕРЅ Рё РїРѕС‡С‚Р° РЅРµ РїСЂРёРЅРёРјР°СЋС‚СЃСЏ: РїРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РЅРµ СЃРѕР±РёСЂР°СЋС‚СЃСЏ.
app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body?.username || '').trim().replace(/^@+/, '');
  const password = req.body?.password;
  if (!/^[a-zA-Z0-9_.]{3,32}$/.test(username)) return res.status(400).json({ message: 'РќРёРє: 3вЂ“32 СЃРёРјРІРѕР»Р°, Р»Р°С‚РёРЅРёС†Р°, С†РёС„СЂС‹, _ Рё .' });
  if (typeof password !== 'string' || password.length < 12) return res.status(400).json({ message: 'РџР°СЂРѕР»СЊ РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ РЅРµ РјРµРЅРµРµ 12 СЃРёРјРІРѕР»РѕРІ' });
  if (password.length > 256) return res.status(400).json({ message: 'РџР°СЂРѕР»СЊ СЃР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№' });
  // SEC: CAPTCHA РѕР±СЏР·Р°С‚РµР»СЊРЅР° РїСЂРё СЂРµРіРёСЃС‚СЂР°С†РёРё (Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРіРѕ СЃРѕР·РґР°РЅРёСЏ Р°РєРєР°СѓРЅС‚РѕРІ).
  const captchaToken = req.body?.captchaToken;
  const captchaOk = await verifyCaptchaToken(captchaToken);
  if (!captchaOk) {
    return res.status(400).json({ message: 'РўСЂРµР±СѓРµС‚СЃСЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ CAPTCHA', code: 'CAPTCHA_REQUIRED' });
  }
  // SEC: РїСЂР°РІР° Р°РґРјРёРЅР° РІС‹РґР°СЋС‚СЃСЏ РїРѕ РёРјРµРЅРё вЂ” Р·Р°СЂРµР·РµСЂРІРёСЂРѕРІР°РЅРЅС‹Рµ РЅРёРєРё Р·Р°РЅСЏС‚СЊ РЅРµР»СЊР·СЏ.
  if (isAdminUsername(username)) return res.status(403).json({ message: 'Р­С‚РѕС‚ РЅРёРє Р·Р°СЂРµР·РµСЂРІРёСЂРѕРІР°РЅ' });
  // РђРЅС‚Рё-РјСѓР»СЊС‚РёР°РєРєР°СѓРЅС‚РёРЅРі: Р»РёРјРёС‚ Р°РєРєР°СѓРЅС‚РѕРІ РЅР° СѓСЃС‚СЂРѕР№СЃС‚РІРѕ/СЃРµС‚СЊ (РїРѕ HMAC-С…СЌС€Р°Рј).
  const regLimit = checkRegistrationLimits(req);
  if (!regLimit.ok) return res.status(429).json({ message: regLimit.message, code: 'REG_LIMIT' });
  const taken = () => db.users.some(u => normalizeIdentifier(u.username) === normalizeIdentifier(username));
  if (taken()) return res.status(409).json({ message: 'Р­С‚РѕС‚ РЅРёРє СѓР¶Рµ Р·Р°РЅСЏС‚' });
  const passwordHash = await hashPassword(password);
  // РџРѕРєР° СЃС‡РёС‚Р°Р»СЃСЏ С…СЌС€, РЅРёРє РјРѕРіР»Рё Р·Р°РЅСЏС‚СЊ РїР°СЂР°Р»Р»РµР»СЊРЅС‹Рј Р·Р°РїСЂРѕСЃРѕРј.
  if (taken()) return res.status(409).json({ message: 'Р­С‚РѕС‚ РЅРёРє СѓР¶Рµ Р·Р°РЅСЏС‚' });
  const user = { id: uuidv4(), username, passwordHash, passwordHashVersion: 2,
    walletBalance: REGISTRATION_BONUS_VP,
    avatarUrl: null, bio: null, isOnline: true, lastSeen: new Date().toISOString(), createdAt: new Date().toISOString() };
  db.users.push(user);
  const device = bindInstallationForUser(req, res, user, getDeviceNameForRequest(req));
  if (!device) {
    db.users = db.users.filter(u => u.id !== user.id);
    return;
  }
  // РђРєРєР°СѓРЅС‚ СЃРѕР·РґР°РЅ вЂ” С„РёРєСЃРёСЂСѓРµРј РІ Р°РЅС‚Рё-РјСѓР»СЊС‚РёР°РєРєР°СѓРЅС‚ СЂРµРµСЃС‚СЂРµ (С‚РѕР»СЊРєРѕ С…СЌС€Рё).
  recordRegistration(user.id, regLimit.deviceHash, regLimit.ipHash);
  // Р РµС„РµСЂР°Р»СЊРЅР°СЏ РїСЂРёРІСЏР·РєР°: С‚РѕР»СЊРєРѕ РґР»СЏ РќРћР’РћР“Рћ СѓСЃС‚СЂРѕР№СЃС‚РІР°/СЃРµС‚Рё. Р•СЃР»Рё РЅР° СЌС‚РѕРј
  // СѓСЃС‚СЂРѕР№СЃС‚РІРµ РёР»Рё РІ СЌС‚РѕР№ СЃРµС‚Рё СѓР¶Рµ Р±С‹Р» Р°РєРєР°СѓРЅС‚ вЂ” В«РґР»СЏ Р·Р°СЂРµРіР°РЅРЅС‹С… РЅРµ СЂР°Р±РѕС‚Р°РµС‚В».
  linkReferralOnRegister(user, req.body?.ref, regLimit);
  createSavedMessagesChat(user.id);
  addUserToFeedbackChat(user.id);
  return authUserResponse(req, res, user, device, true);
});

// POST /api/auth/login вЂ” РІС…РѕРґ РїРѕ РЅРёРєСѓ Рё РїР°СЂРѕР»СЋ РЅР° Р»СЋР±РѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ.
app.post('/api/auth/login', async (req, res) => {
  const identifier = normalizeIdentifier(req.body?.identifier).replace(/^@+/, '');
  const password = req.body?.password;
  const attemptKey = passwordAttemptKey(req, identifier);
  if (passwordAttemptBlocked(attemptKey)) {
    res.setHeader('Retry-After', String(Math.ceil(PASSWORD_LOCK_MS / 1000)));
    return res.status(429).json({ message: 'РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ РЅРµСѓРґР°С‡РЅС‹С… РїРѕРїС‹С‚РѕРє. РџРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ.' });
  }
  const user = identifier && db.users.find(u => normalizeIdentifier(u.username) === identifier);
  if (!user || typeof password !== 'string' || password.length > 256) {
    recordPasswordFailure(attemptKey);
    return res.status(401).json({ message: 'РќРµРІРµСЂРЅС‹Р№ РЅРёРє РёР»Рё РїР°СЂРѕР»СЊ' });
  }
  const result = await verifyAndMigrate(password, user);
  if (!result.ok) {
    recordPasswordFailure(attemptKey);
    return res.status(401).json({ message: 'РќРµРІРµСЂРЅС‹Р№ РЅРёРє РёР»Рё РїР°СЂРѕР»СЊ' });
  }
  passwordFailures.delete(attemptKey);
  if (moderation.blocked(db, user.id)) return res.status(403).json({ message: 'Р”РѕСЃС‚СѓРї Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ', code: 'ACCOUNT_BANNED' });
  const device = bindInstallationForUser(req, res, user, getDeviceNameForRequest(req));
  if (!device) return;
  addUserToFeedbackChat(user.id);
  return authUserResponse(req, res, user, device);
});

// POST /api/auth/password вЂ” Р·Р°РґР°С‚СЊ РїР°СЂРѕР»СЊ Р°РєРєР°СѓРЅС‚Сѓ, СЃРѕР·РґР°РЅРЅРѕРјСѓ СЂР°РЅСЊС€Рµ Р±РµР· РЅРµРіРѕ
// (СЃС‚Р°СЂС‹Рµ Р°РєРєР°СѓРЅС‚С‹ В«РїРѕ СѓСЃС‚СЂРѕР№СЃС‚РІСѓВ»), РёР»Рё СЃРјРµРЅРёС‚СЊ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№.
app.post('/api/auth/password', authMiddleware, async (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 12) return res.status(400).json({ message: 'РџР°СЂРѕР»СЊ РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ РЅРµ РјРµРЅРµРµ 12 СЃРёРјРІРѕР»РѕРІ' });
  if (newPassword.length > 256) return res.status(400).json({ message: 'РџР°СЂРѕР»СЊ СЃР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№' });
  if (user.passwordHash) {
    const ok = typeof currentPassword === 'string' && (await verifyAndMigrate(currentPassword, user)).ok;
    if (!ok) return res.status(401).json({ message: 'РўРµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ РЅРµРІРµСЂРµРЅ' });
  }
  user.passwordHash = await hashPassword(newPassword);
  user.passwordHashVersion = 2;
  saveDb();
  res.json({ success: true });
});

// WebAuthn must be implemented with a maintained verifier and an origin/RP policy.
// Do not accept client-provided credential assertions without that verification.
app.post('/api/auth/passkey/register/options', authMiddleware, (_req, res) => res.status(501).json({ code: 'WEBAUTHN_NOT_CONFIGURED', message: 'WebAuthn verifier is not configured' }));
app.post('/api/auth/passkey/register/verify', authMiddleware, (_req, res) => res.status(501).json({ code: 'WEBAUTHN_NOT_CONFIGURED', message: 'WebAuthn verifier is not configured' }));
app.post('/api/auth/passkey/login/options', (_req, res) => res.status(501).json({ code: 'WEBAUTHN_NOT_CONFIGURED', message: 'WebAuthn verifier is not configured' }));
app.post('/api/auth/passkey/login/verify', (_req, res) => res.status(501).json({ code: 'WEBAUTHN_NOT_CONFIGURED', message: 'WebAuthn verifier is not configured' }));
app.get('/api/auth/login-events', authMiddleware, (req, res) => {
  const events = (db.loginEvents || []).filter(event => event.userId === req.userId).slice(-50).reverse();
  res.json({ events });
});

// POST /api/auth/logout
// SEC: РёРЅРєСЂРµРјРµРЅС‚РёРј tokenVersion в†’ РІСЃРµ РІС‹РґР°РЅРЅС‹Рµ JWT СЌС‚РѕРјСѓ СЋР·РµСЂСѓ СЃС‚Р°РЅРѕРІСЏС‚СЃСЏ РЅРµРІР°Р»РёРґРЅС‹.
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (user) {
    user.isOnline = false;
    user.lastSeen = new Date().toISOString();
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    saveDb();
  }
  // SEC: revoke РІСЃРµ refresh-СЃРµРјСЊРё РґР»СЏ СЌС‚РѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР° (РёР»Рё РІСЃРµС…, РµСЃР»Рё deviceId РЅРµРёР·РІРµСЃС‚РµРЅ).
  const now = Date.now();
  for (const t of db.refreshTokens) {
    if (t.userId === req.userId && !t.revokedAt) {
      if (!req.deviceId || t.deviceId === req.deviceId) {
        t.revokedAt = now;
        t.revokeReason = 'logout';
      }
    }
  }
  // РЈСЃС‚СЂРѕР№СЃС‚РІРѕ РѕСЃС‚Р°С‘С‚СЃСЏ РІ СЃРїРёСЃРєРµ, РЅРѕ Р°РІС‚Рѕ-РІС…РѕРґ РїРѕ cookie СѓСЃС‚Р°РЅРѕРІРєРё РїРѕСЃР»Рµ
  // РІС‹С…РѕРґР° Р·Р°РїСЂРµС‰С‘РЅ: РІРµСЂРЅСѓС‚СЊСЃСЏ РјРѕР¶РЅРѕ С‚РѕР»СЊРєРѕ РїР°СЂРѕР»РµРј РёР»Рё СЃСЃС‹Р»РєРѕР№ РїСЂРёРІСЏР·РєРё.
  const loggedOutDevice = req.deviceId && (db.devices || []).find(d => d.userId === req.userId && d.deviceId === req.deviceId);
  if (loggedOutDevice) loggedOutDevice.loggedOut = true;
  saveDb();
  clearAuthCookies(res);
  // Р Р°Р·СЂС‹РІР°РµРј РІСЃРµ Р°РєС‚РёРІРЅС‹Рµ СЃРѕРєРµС‚С‹ СЌС‚РѕРіРѕ СЋР·РµСЂР° вЂ” РѕРЅРё РґРѕР»Р¶РЅС‹ РїРµСЂРµРїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ СЃ РЅРѕРІС‹Рј С‚РѕРєРµРЅРѕРј.
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
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  // Р”РѕР±Р°РІР»СЏРµРј РёРЅС„Сѓ РѕР± СѓСЃС‚СЂРѕР№СЃС‚РІР°С…, С‡С‚РѕР±С‹ РєР»РёРµРЅС‚ РјРѕРі РїРѕРєР°Р·Р°С‚СЊ QR-СЌРєСЂР°РЅ
  const devices = (db.devices || []).filter(d => d.userId === user.id);
  res.json({ ...withDevFlag(req, user), hasPassword: !!user.passwordHash,
    // РљР»РёРµРЅС‚Сѓ РЅСѓР¶РЅРѕ Р·РЅР°С‚СЊ РѕР± РѕРіСЂР°РЅРёС‡РµРЅРёСЏС…, С‡С‚РѕР±С‹ Р·Р°РєСЂС‹С‚СЊ РїРѕР»Рµ РІРІРѕРґР° Р·Р°СЂР°РЅРµРµ.
    moderation: { readOnly: moderation.readOnly(db, user.id), creationBanned: moderation.creationBanned(db, user.id) },
    devices: devices.map(d => ({
    id: d.id, deviceId: d.deviceId, name: d.name,
    isPrimary: !!d.isPrimary, linkedViaQr: !!d.linkedViaQr,
    createdAt: d.createdAt, lastSeenAt: d.lastSeenAt,
  })) });
});

// в”Ђв”Ђв”Ђ ADMIN routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// POST /api/admin/reload-db  вЂ” РїРµСЂРµС‡РёС‚Р°С‚СЊ Р‘Р” СЃ РґРёСЃРєР° Р±РµР· РїРµСЂРµР·Р°РїСѓСЃРєР° СЃРµСЂРІРµСЂР°
// SEC: С‚СЂРµР±СѓРµС‚ auth + isAdminUsername.
app.post('/api/admin/reload-db', authMiddleware, (req, res) => {
  const me = db.users.find(u => u.id === req.userId);
  if (!me || !isAdminUsername(me.username)) return res.status(403).json({ message: 'Forbidden' });
  reloadDb();
  res.json({ success: true, users: db.users.length, tracks: db.tracks.length, chats: db.chats.length });
});

// POST /api/admin/grant  вЂ” РЅР°Р·РЅР°С‡РёС‚СЊ/СЃРЅСЏС‚СЊ Р°РґРјРёРЅР° РїРѕ username.
// РђСѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ: Р·Р°РіРѕР»РѕРІРѕРє X-Admin-Token СЃРѕ Р·РЅР°С‡РµРЅРёРµРј env ADMIN_BOOTSTRAP_TOKEN.
// Р—Р°РґСѓРјР°РЅРѕ РґР»СЏ Р·Р°РїСѓСЃРєР° РёР· Render Shell:
//   curl -X POST $URL/api/admin/grant -H "X-Admin-Token: $T" \
//        -H "Content-Type: application/json" -d '{"username":"myname"}'
// Р”РµР№СЃС‚РІРёРµ: add (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ) | remove. Р’РѕР·РІСЂР°С‰Р°РµС‚ Р°РєС‚СѓР°Р»СЊРЅС‹Р№ СЃРїРёСЃРѕРє.
app.post('/api/admin/grant', (req, res) => {
  const token = String(req.headers['x-admin-token'] || '');
  const expected = String(process.env.ADMIN_BOOTSTRAP_TOKEN || '');
  if (!expected || token !== expected) return res.status(403).json({ message: 'Forbidden' });
  const username = normAdminName(req.body?.username);
  const action = String(req.body?.action || 'add').toLowerCase();
  if (!username) return res.status(400).json({ message: 'username РѕР±СЏР·Р°С‚РµР»РµРЅ' });
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
    // 'wallpapers' Рё 'fonts' вЂ” РѕР±С‰РёРµ С„РѕРЅС‹ Рё С€СЂРёС„С‚С‹ Р°РґРјРёРЅР°: РёС… С„Р°Р№Р»С‹
    // РїРµСЂРµРёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ С‚РµРјР°РјРё, Рё Р±РµР· РЅРёС… С„РѕРЅ/С€СЂРёС„С‚ РїСЂРѕСЃС‚Рѕ РёСЃС‡РµР· Р±С‹ Сѓ РІСЃРµС….
    if (entry.isDirectory() && !['music', 'avatars', 'files', 'wallpapers', 'fonts'].includes(entry.name)) {
      try { fs.rmSync(path.join(UPLOADS_DIR, entry.name), { recursive: true, force: true }); removed += 1; } catch {}
    }
  }
  for (const dir of ['music', 'avatars', 'files', 'wallpapers', 'fonts']) fs.mkdirSync(path.join(UPLOADS_DIR, dir), { recursive: true });
  return removed;
}

function requirePurgeConfirmation(req, value) {
  return String(req.body?.confirmation || '') === value;
}

// Destructive admin actions require an exact confirmation phrase from the UI/API.
app.post('/api/admin/delete-all-chats', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Forbidden' });
  if (!requirePurgeConfirmation(req, 'DELETE_ALL_CHATS')) {
    return res.status(400).json({ message: 'Р’РІРµРґРёС‚Рµ DELETE_ALL_CHATS РґР»СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ' });
  }
  const counts = { chats: db.chats.length, messages: db.messages.length, members: db.chatMembers.length };
  moderation.archive(db, db.messages, req.userId, { uploadsDir: UPLOADS_DIR });
  db.chats = [];
  db.messages = [];
  db.chatMembers = [];
  db.favorites = [];
  db.callLogs = [];
  saveDb();
  flushDb(); // РјР°СЃСЃРѕРІРѕРµ СѓРґР°Р»РµРЅРёРµ вЂ” РїРёС€РµРј РЅР° РґРёСЃРє РЅРµРјРµРґР»РµРЅРЅРѕ
  io?.emit('admin:data-cleared', { type: 'chats' });
  res.json({ ok: true, counts });
});

app.post('/api/admin/delete-all-users', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'Forbidden' });
  if (!requirePurgeConfirmation(req, 'DELETE_ALL_USERS')) {
    return res.status(400).json({ message: 'Р’РІРµРґРёС‚Рµ DELETE_ALL_USERS РґР»СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ' });
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
  if (!ip) return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ IPv4 РёР»Рё IPv6 Р°РґСЂРµСЃ' });
  if (ip === requestIp(req)) return res.status(400).json({ message: 'РќРµР»СЊР·СЏ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ С‚РµРєСѓС‰РёР№ IP' });
  const minutes = Number(req.body?.expiresInMinutes || 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 525600) {
    return res.status(400).json({ message: 'РЎСЂРѕРє РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РѕС‚ 0 РґРѕ 525600 РјРёРЅСѓС‚' });
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
  if (!ip) return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ IP' });
  const before = (db.ipBans || []).length;
  db.ipBans = (db.ipBans || []).filter(b => normalizeIp(b.ip) !== ip);
  saveDb();
  res.json({ ok: true, removed: before !== db.ipBans.length });
});

// в”Ђв”Ђв”Ђ USERS routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
moderation.install({ app, getDb: () => db, saveDb, auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)), isAdminUsername, requestIp,
  // extra.appealReportId вЂ” СЂРµС€РµРЅРёРµ, РєРѕС‚РѕСЂРѕРµ РїРѕР»СѓС‡Р°С‚РµР»СЊ РјРѕР¶РµС‚ РѕР±Р¶Р°Р»РѕРІР°С‚СЊ РєРЅРѕРїРєРѕР№.
  notify: (from, to, text, reportId, extra) => {
    const chat = ensureDirectChat(from, to);
    const message = { id: uuidv4(), chatId: chat.id, senderId: from, text, content: text,
      type: 'system', moderationReportId: reportId || null, appealReportId: extra?.appealReportId || null,
      readBy: [], attachments: [], createdAt: new Date().toISOString() };
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

// Р›РёС‡РЅС‹Рµ Р±Р»РѕРєРёСЂРѕРІРєРё Рё Р°РїРµР»Р»СЏС†РёРё. РЈРІРµРґРѕРјР»РµРЅРёРµ Р°РїРµР»Р»СЏС†РёРё вЂ” С‚Рѕ Р¶Рµ СЃРёСЃС‚РµРјРЅРѕРµ
// СЃРѕРѕР±С‰РµРЅРёРµ РІ Р»РёС‡РєСѓ, С‡С‚Рѕ Рё Сѓ Р¶Р°Р»РѕР±С‹: Р°РґРјРёРЅ РІРёРґРёС‚ С‚РµРєСЃС‚ СЃСЂР°Р·Сѓ.
blocks.install({ app, getDb: () => db, saveDb, auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)), isAdminUsername,
  notify: (from, to, text) => {
    const chat = ensureDirectChat(from, to);
    const message = { id: uuidv4(), chatId: chat.id, senderId: from, text, content: text,
      type: 'system', moderationReportId: null, readBy: [], attachments: [], createdAt: new Date().toISOString() };
    db.messages.push(message);
    for (const uid of [from, to]) for (const sid of userSockets.get(uid) || []) {
      io.to(sid).socketsJoin('chat:' + chat.id);
      io.to(sid).emit('message:new', { ...message, sender: db.users.find(u => u.id === from) });
    }
  },
  blocked: (userId) => moderation.blocked(db, userId),
  // РђРїРµР»Р»СЏС†РёСЏ РЅР° РєРѕРЅРєСЂРµС‚РЅРѕРµ СЂРµС€РµРЅРёРµ Р°РґРјРёРЅРёСЃС‚СЂР°С†РёРё (Р±Р°РЅ, РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ,
  // СѓРґР°Р»РµРЅРёРµ Р±РѕС‚Р° РёР»Рё РїСЂРёР»РѕР¶РµРЅРёСЏ) Рё РѕС‚РјРµРЅР° СЌС‚РѕРіРѕ СЂРµС€РµРЅРёСЏ.
  appealTarget: (userId, reportId) => moderation.decisionForAppeal(db, userId, reportId),
  overturnReport: (reportId, by) => {
    const report = (db.reports || []).find((r) => r.id === reportId);
    return report ? moderation.overturnDecision(db, report, by) : { ok: false, restored: null };
  },
  // Р­РєСЂР°РЅ Р±Р°РЅР° РїРѕРґР°С‘С‚ Р°РїРµР»Р»СЏС†РёСЋ Р±РµР· СЃСЃС‹Р»РєРё РЅР° СЂРµС€РµРЅРёРµ: Р±РµСЂС‘Рј РґРµР№СЃС‚РІСѓСЋС‰РёР№ Р±Р°РЅ.
  banReportId: (userId) => (db.moderationBans || [])
    .filter((ban) => ban.userId === userId && ban.kind === 'account' && ban.reportId && moderation.isActiveBan(ban))
    .map((ban) => ban.reportId).at(-1) || null,
  // РљС‚Рѕ Р·Р° СѓСЃС‚Р°РЅРѕРІРєРѕР№ РїРѕ РµС‘ cookie: СЌС‚РёРј РїСѓС‚С‘Рј РїРѕРґР°СЋС‚ Р°РїРµР»Р»СЏС†РёСЋ Р·Р°Р±Р°РЅРµРЅРЅС‹Рµ,
  // РєРѕС‚РѕСЂС‹Рј РѕР±С‹С‡РЅС‹Р№ /api/appeals СЃ auth РЅРµРґРѕСЃС‚СѓРїРµРЅ (verifyAccessToken Р±СЂРѕСЃР°РµС‚
  // ACCOUNT_BANNED). Cookie вЂ” С‚РѕС‚ Р¶Рµ СЃРµРєСЂРµС‚, С‡С‚Рѕ Рё Сѓ /auth/device.
  resolveInstallationUser: (req) => {
    const secret = req.cookies?.vera_installation;
    if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return null;
    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    const device = (db.devices || []).find((d) => d.installationHash === hash);
    return device?.userId || null;
  },
});

// GET /api/users/search?q=...&kind=people|bots
// kind=bots вЂ” С‚РѕР»СЊРєРѕ Р±РѕС‚С‹ (РїРѕРёСЃРє В«/РЅРёРєВ» РІ РєР»РёРµРЅС‚Рµ), kind=people вЂ” С‚РѕР»СЊРєРѕ Р»СЋРґРё
// (В«@РЅРёРєВ»). Р‘РµР· kind вЂ” РІСЃРµ, РєСЂРѕРјРµ СѓРґР°Р»С‘РЅРЅС‹С… Р±РѕС‚РѕРІ.
app.get('/api/users/search', authMiddleware, (req, res) => {
  const rawQuery = String(req.query.q || '').trim().replace(/^[@/]+/, '').slice(0, 50);
  const kind = req.query.kind === 'bots' || req.query.kind === 'people' ? req.query.kind : null;
  const q = safeLower(rawQuery);
  if (!q) return res.json([]);
  normalizeAllUsers();
  function getUserSearchRank(u) {
    // РџРѕРёСЃРє С‚РѕР»СЊРєРѕ РїРѕ РЅРёРєСѓ: РїРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РЅРµ С…СЂР°РЅСЏС‚СЃСЏ.
    // РРјСЏ Р±РѕС‚Р° вЂ” РЅРµ РџР”, РїРѕ РЅРµРјСѓ Р±РѕС‚РѕРІ РїРѕ-РїСЂРµР¶РЅРµРјСѓ РјРѕР¶РЅРѕ РЅР°Р№С‚Рё.
    const username = safeLower(u.username).replace(/^@+/, '');
    const botName = u.isBot ? safeLower(u.firstName) : '';

    if (username === q) return 0;
    if (username.startsWith(q) || (botName && botName.startsWith(q))) return 1;
    if (username.includes(q) || (botName && botName.includes(q))) return 2;
    return 99;
  }

  const results = db.users
    .filter(u => !u.botDeleted && (!kind || (kind === 'bots') === !!u.isBot))
    .map(u => {
    normalizeUserRecord(u);
    return { user: u, rank: u.id === req.userId ? 99 : getUserSearchRank(u) };
  })
    .filter(item => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || safeLower(a.user.username).localeCompare(safeLower(b.user.username)))
    .slice(0, 20)
    .map(item => publicUserFields(item.user));
  res.json(results);
});

// Publish only equipment IDs, never private account fields.
function publishEquipment(user) {
  const equipment = { id: user.id, activeRing: user.activeRing || '',
    activeSelfCard: user.activeSelfCard || '', activeBubble: user.activeBubble || '' };
  const rooms = db.chatMembers.filter(m => m.userId === user.id).map(m => 'chat:' + m.chatId);
  // РЎРІРѕРё СѓСЃС‚СЂРѕР№СЃС‚РІР° РїРѕР»СѓС‡Р°СЋС‚ РѕР±СЂР°Р· РґР°Р¶Рµ Р±РµР· РѕР±С‰РёС… С‡Р°С‚РѕРІ (socket.io РЅРµ
  // РґСѓР±Р»РёСЂСѓРµС‚ СЃРѕР±С‹С‚РёРµ СЃРѕРєРµС‚Сѓ, РєРѕС‚РѕСЂС‹Р№ РµСЃС‚СЊ Рё РІ РєРѕРјРЅР°С‚Рµ, Рё РІ СЃРїРёСЃРєРµ).
  const targets = [...rooms, ...(userSockets.get(user.id) || [])];
  if (targets.length) io.to(targets).emit('user:equipment', equipment);
}

// Search results are visible to any authenticated user. Keep this projection
// separate from the stored record so credentials, session state, moderation
// data and admin flags cannot leak through user search.
function publicUserFields(user) {
  return {
    id: user.id,
    username: user.username,
    // РРјСЏ РїРѕРєР°Р·С‹РІР°РµРј С‚РѕР»СЊРєРѕ Сѓ Р±РѕС‚РѕРІ: Сѓ Р»СЋРґРµР№ Р¤РРћ РЅРµ С…СЂР°РЅРёС‚СЃСЏ.
    firstName: user.isBot ? user.firstName : null,
    lastName: null,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen,
    themeId: user.themeId,
    createdAt: user.createdAt,
    activeRing: user.activeRing || '',
    activeSelfCard: user.activeSelfCard || '',
    activeBubble: user.activeBubble || '',
    equippedPet: sanitizedEquippedPet(user.equippedPet),
    pinnedPlaylistId: user.pinnedPlaylistId || null,
    pinnedTrackId: user.pinnedTrackId || null,
    isBot: !!user.isBot,
    // false вЂ” РІР»Р°РґРµР»РµС† СЃРєСЂС‹Р» РёРЅРІРµРЅС‚Р°СЂСЊ; СЃР°Рј СЃРїРёСЃРѕРє РїСЂРё СЌС‚РѕРј РЅРµ РѕС‚РґР°С‘Рј.
    inventoryVisible: inventoryVisibleToOthers(user),
  };
}

// Р‘СѓР»РµРІС‹ РїСЂРёР·РЅР°РєРё РґР»СЏ РїРѕР»РѕСЃРѕРє Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё РІ РїСЂРѕС„РёР»Рµ. РџРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ
// РЅРµ РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ: РІРѕР·СЂР°СЃС‚ Р°РєРєР°СѓРЅС‚Р° Рё РїСЂРёРІСЏР·РєР° РІС‚РѕСЂРѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР° РїРѕ QR.
// РџСЂРµРґСѓРїСЂРµР¶РґРµРЅРёСЏ, Р¶Р°Р»РѕР±С‹ Рё Р±Р°РЅС‹ РІРёРґРЅС‹ Р»РёС€СЊ РєР°Рє В«РµСЃС‚СЊ/РЅРµС‚В».
function securityFlags(user) {
  const hasActiveBan = !!user.isBot && (db.moderationBans || []).some(ban => {
    if (ban.userId !== user.id) return false;
    return moderation.isActiveBan(ban);
  });
  const hasComplaints = !!user.isBot && (db.reports || []).some(r => 
    r.targetId === user.id && r.status !== 'resolved'
  );
  return {
    isAdminAccount: isAdminUsername(user.username),
    accountMature: accountIsMature(user),
    hasLinkedDevice: hasQrLinkedDevice(user.id),
    hasAdminWarnings: (db.moderationWarnings || []).some(w => w.userId === user.id),
    hasComplaints,
    hasActiveBan,
  };
}

// GET /api/users/:id
// SEC: РІРѕР·РІСЂР°С‰Р°РµРј С‚РѕР»СЊРєРѕ РїСѓР±Р»РёС‡РЅС‹Рµ РїРѕР»СЏ. РџРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РЅРµ С…СЂР°РЅСЏС‚СЃСЏ Рё РЅРµ РѕС‚РґР°СЋС‚СЃСЏ.
app.get('/api/users/:id', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  const isSelf = user.id === req.userId;
  const publicFields = { ...publicUserFields(user), ...securityFlags(user) };
  // РРЅРІРµРЅС‚Р°СЂСЊ вЂ” С‚РѕР»СЊРєРѕ СЃ СЂР°Р·СЂРµС€РµРЅРёСЏ РІР»Р°РґРµР»СЊС†Р°. РЎРµР±Рµ РѕС‚РґР°С‘Рј РІСЃРµРіРґР°.
  if (isSelf || publicFields.inventoryVisible) {
    publicFields.inventory = publicInventory(user);
  }
  if (isSelf) publicFields.chatPhoto = user.chatPhoto;
  res.json(publicFields);
});

const PET_CATALOG = {
  'pet-cat': { name: 'РќРѕС‡РЅРѕР№ РєРѕС‚', rarity: 'legendary', cases: ['case-pets', 'case-base'] },
  'pet-fox': { name: 'Р›РµРЅРёРІР°СЏ Р»РёСЃР°', rarity: 'common', cases: ['case-pets', 'case-elements'] },
  'pet-bunny': { name: 'РќРµРѕРЅРѕРІС‹Р№ Р·Р°СЏС†', rarity: 'uncommon', cases: ['case-pets', 'case-signal'] },
  'pet-pixel': { name: 'РџРёРєСЃРµР»СЊРЅС‹Р№ РєРѕС‚', rarity: 'epic', cases: ['case-pets', 'case-games'] },
  'pet-phoenix': { name: 'Р¤РµРЅРёРєСЃ', rarity: 'rare', cases: ['case-pets', 'case-eclipse'] },
  // Р­РєСЃРєР»СЋР·РёРІРЅС‹Рµ Р·РІРµСЂРё РєРµР№СЃР° В«Р‘РµСЃС‚РёР°СЂРёР№В» (2000 Р’Рџ).
  'pet-spider': { name: 'РџСѓС€РёСЃС‚С‹Р№ РїР°СѓРє', rarity: 'common', cases: ['case-pets-bestiary'] },
  'pet-bear': { name: 'РњСЏРіРєРёР№ РјРµРґРІРµР¶РѕРЅРѕРє', rarity: 'uncommon', cases: ['case-pets-bestiary'] },
  'pet-snake': { name: 'Р—РµР»С‘РЅР°СЏ Р·РјРµСЏ', rarity: 'rare', cases: ['case-pets-bestiary'] },
  'pet-pumpkin': { name: 'РЎРІРµС‚СЏС‰РёР№СЃСЏ Р”Р¶РµРє', rarity: 'epic', cases: ['case-pets-bestiary'] },
  'pet-jellyfish': { name: 'РЎРёСЏСЋС‰Р°СЏ РјРµРґСѓР·Р°', rarity: 'legendary', cases: ['case-pets-bestiary'] },
  // Р­РєСЃРєР»СЋР·РёРІРЅС‹Рµ РїРёС‚РѕРјС†С‹ РєРµР№СЃР° В«РњРёС„РёС‡РµСЃРєРёРµ РїРёС‚РѕРјС†С‹В» (2000 Р’Рџ).
  'pet-panda': { name: 'РњСЏРіРєР°СЏ РїР°РЅРґР°', rarity: 'common', cases: ['case-pets-mythical'] },
  'pet-hedgehog': { name: 'Р СѓРјСЏРЅС‹Р№ С‘Р¶РёРє', rarity: 'uncommon', cases: ['case-pets-mythical'] },
  'pet-squirrel': { name: 'РћСЂРµС…РѕРІР°СЏ Р±РµР»РєР°', rarity: 'rare', cases: ['case-pets-mythical'] },
  'pet-pixel-dragon': { name: 'РџРёРєСЃРµР»СЊРЅС‹Р№ РґСЂР°РєРѕРЅ', rarity: 'epic', cases: ['case-pets-mythical'] },
  'pet-bat': { name: 'Р›РµС‚СѓС‡Р°СЏ РјС‹С€СЊ', rarity: 'legendary', cases: ['case-pets-mythical'] },
};
// РЎС‚Р°СЂС‹Рµ id РїРёС‚РѕРјС†РµРІ (РґРѕ СЂРµРґРёР·Р°Р№РЅР°) РјРёРіСЂРёСЂСѓРµРј РЅР° РЅРѕРІС‹Рµ: СЃС‚Р°СЂС‹Р№ РёРЅРІРµРЅС‚Р°СЂСЊ
// Рё РЅР°РґРµС‚С‹Р№ РїРёС‚РѕРјРµС† РЅРµ РґРѕР»Р¶РЅС‹ РїСЂРѕРїР°РґР°С‚СЊ.
const LEGACY_PET_IDS = { 'pet-owl': 'pet-bunny', 'pet-dragon': 'pet-pixel' };
const normalizePetId = id => LEGACY_PET_IDS[id] || id;
const DEFAULT_PET_SETTINGS = { x: 78, y: 76, size: 72, name: '', font: 'inherit' };
function sanitizedEquippedPet(raw) {
  if (!raw || !raw.id) return null;
  const id = normalizePetId(raw.id);
  if (!PET_CATALOG[id]) return null;
  return { id, settings: { ...DEFAULT_PET_SETTINGS, ...raw.settings } };
}
function petState(user) {
  const ownedPets = [...new Set((Array.isArray(user.ownedPets) ? user.ownedPets : []).map(normalizePetId).filter(id => PET_CATALOG[id]))];
  const equippedPet = sanitizedEquippedPet(user.equippedPet);
  // РЎС‡С‘С‚С‡РёРє РєРѕРїРёР№: СЃРєРѕР»СЊРєРѕ СЂР°Р· РїРёС‚РѕРјРµС† РІС‹РїР°РґР°Р» РёР· РєРµР№СЃРѕРІ/РїРѕСЃС‚СѓРїР°Р» СЃ РїР»РѕС‰Р°РґРєРё.
  // Р”СѓР±Р»РёРєР°С‚С‹ РЅРµ СЃРѕР·РґР°СЋС‚ РІС‚РѕСЂРѕРіРѕ РїРёС‚РѕРјС†Р°, РЅРѕ РёС… РєРѕР»РёС‡РµСЃС‚РІРѕ РЅРµ С‚РµСЂСЏРµС‚СЃСЏ.
  const petCounts = {};
  for (const id of ownedPets) {
    const count = Math.floor(Number(user.petCounts?.[id]));
    petCounts[id] = Number.isSafeInteger(count) && count > 1 ? count : 1;
  }
  return { ownedPets, equippedPet, petCounts };
}
app.get('/api/pets', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  res.json(petState(user));
});
app.put('/api/pets/equipment', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  const rawPetId = req.body?.petId;
  if (rawPetId !== null && typeof rawPetId !== 'string') return res.status(400).json({ message: 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ РїРёС‚РѕРјРµС†' });
  const petId = rawPetId === null ? null : normalizePetId(rawPetId);
  if (petId !== null && !PET_CATALOG[petId]) return res.status(400).json({ message: 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ РїРёС‚РѕРјРµС†' });
  // РџРµСЂСЃРёСЃС‚РёРј РјРёРіСЂР°С†РёСЋ СЃС‚Р°СЂС‹С… id РІРјРµСЃС‚Рµ СЃ Р»СЋР±РѕР№ СЃРјРµРЅРµР№ СЌРєРёРїРёСЂРѕРІРєРё.
  const owned = new Set((Array.isArray(user.ownedPets) ? user.ownedPets : []).map(normalizePetId).filter(id => PET_CATALOG[id]));
  user.ownedPets = [...owned];
  if (petId !== null && !owned.has(petId)) return res.status(403).json({ message: 'РџРёС‚РѕРјРµС† РЅРµ РЅР°Р№РґРµРЅ РІ РёРЅРІРµРЅС‚Р°СЂРµ' });
  // РќР°СЃС‚СЂРѕР№РєРё РєР°Р¶РґРѕРіРѕ РїРёС‚РѕРјС†Р° Р¶РёРІСѓС‚ РѕС‚РґРµР»СЊРЅРѕ: СЃРјРµРЅР° РїРёС‚РѕРјС†Р° РЅРµ СЃС‚РёСЂР°РµС‚ СЂР°Р·РјРµСЂ,
  // РёРјСЏ Рё С€СЂРёС„С‚ СѓС…РѕРґСЏС‰РµРіРѕ, Р° РЅРѕРІС‹Р№ РїРёС‚РѕРјРµС† РЅР°СЃР»РµРґСѓРµС‚ РёС…, РїРѕРєР° РЅРµ РЅР°СЃС‚СЂРѕРµРЅ СЃР°Рј.
  const savedPetSettings = user.petSettings && typeof user.petSettings === 'object' ? { ...user.petSettings } : {};
  const outgoing = sanitizedEquippedPet(user.equippedPet);
  if (outgoing && outgoing.id !== petId) savedPetSettings[outgoing.id] = outgoing.settings;
  if (petId === null) user.equippedPet = null;
  else {
    const raw = req.body?.settings || {};
    const current = outgoing?.id === petId ? outgoing.settings : (savedPetSettings[petId] || outgoing?.settings || {});
    const settings = { ...DEFAULT_PET_SETTINGS, ...current };
    // РЎР°РЅРёСЂСѓРµРј СѓРЅР°СЃР»РµРґРѕРІР°РЅРЅСѓСЋ/СЃРѕС…СЂР°РЅС‘РЅРЅСѓСЋ Р±Р°Р·Сѓ: СЃС‚Р°СЂС‹Рµ РґР°РЅРЅС‹Рµ РјРѕРіР»Рё Р»РµР¶Р°С‚СЊ СЃС‹СЂС‹РјРё.
    for (const key of ['x', 'y']) {
      const value = Number(settings[key]);
      settings[key] = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : DEFAULT_PET_SETTINGS[key];
    }
    const baseSize = Number(settings.size);
    settings.size = Number.isFinite(baseSize) ? Math.max(36, baseSize) : DEFAULT_PET_SETTINGS.size;
    settings.name = String(settings.name ?? '').trim().slice(0, 32);
    const savedFont = typeof settings.font === 'string' ? settings.font.trim().slice(0, 64) : '';
    settings.font = savedFont || 'inherit';
    for (const key of ['x', 'y']) if (raw[key] !== undefined) settings[key] = Math.max(0, Math.min(100, Number(raw[key])));
    // The client caps the rendered size to one fifth of its viewport.
    // Keep the preferred pixel size across devices without a fixed monitor limit.
    if (raw.size !== undefined) settings.size = Math.max(36, Number(raw.size));
    if (raw.name !== undefined) settings.name = String(raw.name).trim().slice(0, 32);
    if (raw.font !== undefined) {
      // Р›СЋР±Р°СЏ РєРѕСЂСЂРµРєС‚РЅР°СЏ CSS font-family СЃС‚СЂРѕРєР° РёР· РїСЂРµСЃРµС‚РѕРІ РєР»РёРµРЅС‚Р°
      // (В«Georgia, serifВ», В«'Comic Sans MS', cursiveВ» вЂ¦), Р° РЅРµ С‚РѕР»СЊРєРѕ
      // СЃРёСЃС‚РµРјРЅС‹Рµ РєР»СЋС‡РµРІС‹Рµ СЃР»РѕРІР° вЂ” РёРЅР°С‡Рµ РІС‹Р±РѕСЂ С€СЂРёС„С‚Р° РІ РїСЂРѕС„РёР»Рµ РЅРµ РїСЂРёРјРµРЅСЏР»СЃСЏ.
      const font = typeof raw.font === 'string' ? raw.font.trim().slice(0, 64) : '';
      settings.font = font || 'inherit';
    }
    if (![settings.x, settings.y, settings.size].every(Number.isFinite)) return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё РїРёС‚РѕРјС†Р°' });
    user.equippedPet = { id: petId, settings };
    savedPetSettings[petId] = settings;
  }
  user.petSettings = savedPetSettings;
  saveDb();
  const state = petState(user);
  for (const sid of userSockets.get(user.id) || []) io.to(sid).emit('pets:updated', state);
  res.json(state);
});

// PATCH /api/users/me
app.patch('/api/users/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  // РџРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РїРѕР»СЏ (Р¤РРћ, РґР°С‚Р° СЂРѕР¶РґРµРЅРёСЏ, РјРµСЃС‚РѕРїРѕР»РѕР¶РµРЅРёРµ) Р±РѕР»СЊС€Рµ РЅРµ РїСЂРёРЅРёРјР°СЋС‚СЃСЏ.
  const allowed = ['username', 'bio', 'themeId', 'chatPhoto', 'pinnedPlaylistId', 'pinnedTrackId', 'activeRing', 'activeSelfCard', 'activeBubble'];
  for (const key of ['activeRing', 'activeSelfCard', 'activeBubble']) {
    if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > 128)) {
      return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID РїСЂРµРґРјРµС‚Р°' });
    }
  }

  // Р’Р°Р»РёРґР°С†РёСЏ username: С„РѕСЂРјР°С‚ + СѓРЅРёРєР°Р»СЊРЅРѕСЃС‚СЊ (СЂРµРіРёСЃС‚СЂРѕРЅРµР·Р°РІРёСЃРёРјРѕ).
  if (req.body.username !== undefined) {
    const raw = String(req.body.username || '').trim().replace(/^@+/, '');
    if (!/^[a-zA-Z0-9_.]{3,32}$/.test(raw)) {
      return res.status(400).json({ message: 'Р®Р·РµСЂРЅРµР№Рј: 3вЂ“32 СЃРёРјРІРѕР»Р°, Р»Р°С‚РёРЅРёС†Р°, С†РёС„СЂС‹, _ Рё .' });
    }
    const low = raw.toLowerCase();
    const taken = db.users.some(u => u.id !== user.id && normalizeIdentifier(u.username) === low);
    if (taken) return res.status(409).json({ message: 'Р­С‚РѕС‚ СЋР·РµСЂРЅРµР№Рј СѓР¶Рµ Р·Р°РЅСЏС‚' });
    // SEC: РїСЂР°РІР° Р°РґРјРёРЅР° РѕРїСЂРµРґРµР»СЏСЋС‚СЃСЏ РџРћ РРњР•РќР, Р° РёРјСЏ РјРµРЅСЏРµС‚ СЃР°Рј РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ.
    // Р‘РµР· СЌС‚РѕР№ РїСЂРѕРІРµСЂРєРё Р»СЋР±РѕР№ РїСЂРѕСЃС‚Рѕ РїРµСЂРµРёРјРµРЅРѕРІС‹РІР°Р»СЃСЏ РІ Vera_koto_a Рё РїРѕР»СѓС‡Р°Р»
    // РІСЃРµ /api/admin/* РІРјРµСЃС‚Рµ СЃ СѓРґР°Р»РµРЅРёРµРј С‡Р°С‚РѕРІ Рё РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№. РРјРµРЅР° Р°РґРјРёРЅРѕРІ
    // РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ Р·Р°С€РёС‚С‹ РІ РєРѕРґ Рё РІРёРґРЅС‹ Р»СЋР±РѕРјСѓ, РєС‚Рѕ РїСЂРѕС‡РёС‚Р°РµС‚ СЂРµРїРѕР·РёС‚РѕСЂРёР№,
    // РїРѕСЌС‚РѕРјСѓ РїСЂРѕРІРµСЂСЏС‚СЊ РїСЂРёС…РѕРґРёС‚СЃСЏ РёРјРµРЅРЅРѕ РЅР° СЃРјРµРЅРµ РёРјРµРЅРё вЂ” РїСЂРё СЂРµРіРёСЃС‚СЂР°С†РёРё
    // РЅРѕРІС‹Р№ Р°РєРєР°СѓРЅС‚ РїРѕР»СѓС‡Р°РµС‚ СЃРіРµРЅРµСЂРёСЂРѕРІР°РЅРЅРѕРµ РёРјСЏ, Р° РЅРµ РІС‹Р±СЂР°РЅРЅРѕРµ.
    if (normAdminName(raw) !== normAdminName(user.username) && isAdminUsername(raw)) {
      return res.status(403).json({ message: 'Р­С‚Рѕ РёРјСЏ Р·Р°СЂРµР·РµСЂРІРёСЂРѕРІР°РЅРѕ' });
    }
    req.body.username = raw;
  }

  for (const k of allowed) {
    if (req.body[k] !== undefined) user[k] = req.body[k];
  }
  saveDb();
  res.json(withDevFlag(req, user));
  publishEquipment(user);
});

// GET /api/users/:id/customization вЂ” РїСѓР±Р»РёС‡РЅС‹Рµ РїРѕР»СЏ РєР°СЃС‚РѕРјРёР·Р°С†РёРё РїСЂРѕС„РёР»СЏ
// (bannerUrl, bannerColor, cardAccent, showcase, aboutMediaUrl Рё С‚.Рї.),
// С‡С‚РѕР±С‹ РґСЂСѓРіРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»Рё РІРёРґРµР»Рё В«С€Р°РїРєСѓВ» Рё РІРёС‚СЂРёРЅСѓ СЃРѕР±РµСЃРµРґРЅРёРєР°.
app.get('/api/users/:id/customization', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  const store = db.userStores[req.params.id]?.['profile-customization'];
  const data = store?.data || null;
  if (!data) return res.json({ data: null });
  // РћС‚РґР°С‘Рј С‚РѕР»СЊРєРѕ РІРёР·СѓР°Р»СЊРЅС‹Рµ РїРѕР»СЏ вЂ” РЅРµ СЃР»СѓР¶РµР±РЅС‹Рµ С„СѓРЅРєС†РёРё/РїСЂРёРІР°С‚С‹.
  const pick = (k) => (data[k] !== undefined ? data[k] : undefined);
  res.json({
    data: {
      bannerUrl: pick('bannerUrl') || '',
      bannerUrlSha256: pick('bannerUrlSha256') || null,
      bannerColor: pick('bannerColor') || '',
      cardAccent: pick('cardAccent') || '',
      cardOpacity: pick('cardOpacity'),
      showcase: pick('showcase') || '',
      activityKind: pick('activityKind'),
      activityText: pick('activityText') || '',
      aboutMediaUrl: pick('aboutMediaUrl') || '',
      aboutMediaUrlSha256: pick('aboutMediaUrlSha256') || null,
    },
  });
});

// GET /api/users/username-available?u=<name>
// Р‘С‹СЃС‚СЂР°СЏ РїСЂРѕРІРµСЂРєР° Р·Р°РЅСЏС‚РѕСЃС‚Рё РЅРёРєРЅРµР№РјР° (РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ С„РѕСЂРјРѕР№ СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёСЏ).
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
  if (!user) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  if (!req.file) return res.status(400).json({ message: 'Р¤Р°Р№Р» РЅРµ Р·Р°РіСЂСѓР¶РµРЅ' });
  if (dropIfActiveContent(req, res)) return;
  user.avatarUrl = `/uploads/avatars/${req.file.filename}`;
  user.avatarSha256 = req.file.sha256;
  saveDb();
  res.json(user);
});

// PUT /api/users/me/avatar  (used by client)
app.put('/api/users/me/avatar', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  if (!req.file) return res.status(400).json({ message: 'Р¤Р°Р№Р» РЅРµ Р·Р°РіСЂСѓР¶РµРЅ' });
  if (dropIfActiveContent(req, res)) return;
  user.avatarUrl = `/uploads/avatars/${req.file.filename}`;
  user.avatarSha256 = req.file.sha256;
  saveDb();
  res.json(user);
});

// в”Ђв”Ђв”Ђ USER SETTINGS (layout / РІРЅРµС€РЅРёР№ РІРёРґ / РїСЂРёРІР°С‚РЅРѕСЃС‚СЊ) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РќР°СЃС‚СЂРѕР№РєРё С…СЂР°РЅСЏС‚СЃСЏ per-user РІ db.userSettings[userId]. РљР»РёРµРЅС‚ РєР»Р°РґС‘С‚ СЃСЋРґР°
// РІРµСЃСЊ СЃРЅР°РїС€РѕС‚ СЃС‚РѕСЂР° (РєСЂРѕРјРµ action-С„СѓРЅРєС†РёР№) Рё РїРѕРґС‚СЏРіРёРІР°РµС‚ РїСЂРё Р»РѕРіРёРЅРµ.
// SEC: СЃРѕС…СЂР°РЅСЏРµРј С‚РѕР»СЊРєРѕ plain JSON, РѕРіСЂР°РЅРёС‡РёРІР°РµРј СЂР°Р·РјРµСЂ РґРѕ 32 РљР‘.
app.get('/api/settings', authMiddleware, (req, res) => {
  if (!db.userSettings) db.userSettings = {};
  const data = db.userSettings[req.userId] || null;
  res.json({ settings: data, updatedAt: data?.__updatedAt || null });
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const body = req.body?.settings;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ message: 'settings РѕР±СЏР·Р°С‚РµР»РµРЅ Рё РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РѕР±СЉРµРєС‚РѕРј' });
  }
  const serialized = JSON.stringify(body);
  if (serialized.length > 32 * 1024) {
    return res.status(413).json({ message: 'РЎР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№ РѕР±СЉРµРєС‚ РЅР°СЃС‚СЂРѕРµРє' });
  }
  if (!db.userSettings) db.userSettings = {};
  const clean = JSON.parse(serialized);
  delete clean.owned;
  sanitizeProfileMediaStore(clean);
  delete clean.balanceVp;
  clean.__updatedAt = new Date().toISOString();
  db.userSettings[req.userId] = clean;
  saveDb();

  // Push РґСЂСѓРіРёРј СѓСЃС‚СЂРѕР№СЃС‚РІР°Рј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ. РљР»РёРµРЅС‚ РѕС‚СЃРµРµС‚ СЃРІРѕС‘ СЌС…Рѕ РїРѕ __clientId.
  try {
    const sockets = userSockets.get(req.userId);
    if (sockets) sockets.forEach(sid => io.to(sid).emit('settings:updated', {
      settings: clean, updatedAt: clean.__updatedAt,
    }));
  } catch {}

  res.json({ ok: true, updatedAt: clean.__updatedAt });
});

// в”Ђв”Ђв”Ђ UNIVERSAL STORE SYNC (СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ Р»СЋР±С‹С… Zustand stores) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РџРѕР·РІРѕР»СЏРµС‚ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°С‚СЊ Р»СЋР±РѕР№ РєР»РёРµРЅС‚СЃРєРёР№ store РјРµР¶РґСѓ СѓСЃС‚СЂРѕР№СЃС‚РІР°РјРё.
// РЎС‚СЂСѓРєС‚СѓСЂР°: db.userStores[userId][storeName] = { data, __updatedAt, __clientId }
// SEC: РѕРіСЂР°РЅРёС‡РёРІР°РµРј СЂР°Р·РјРµСЂ РєР°Р¶РґРѕРіРѕ store РґРѕ 128 РљР‘, РѕР±С‰РёР№ Р»РёРјРёС‚ РЅР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ 1 РњР‘.

const MAX_STORE_SIZE = 128 * 1024; // 128 РљР‘ РЅР° РѕРґРёРЅ store
const MAX_TOTAL_STORES_SIZE = 1024 * 1024; // 1 РњР‘ РЅР° РІСЃРµ stores РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ

// GET /api/sync/stores вЂ” РїРѕР»СѓС‡РёС‚СЊ РІСЃРµ stores РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
app.get('/api/sync/stores', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  const stores = db.userStores[req.userId] || {};
  res.json({ stores });
});

// GET /api/sync/stores/:name вЂ” РїРѕР»СѓС‡РёС‚СЊ РєРѕРЅРєСЂРµС‚РЅС‹Р№ store
app.get('/api/sync/stores/:name', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  if (!db.userStores[req.userId]) db.userStores[req.userId] = {};
  const store = db.userStores[req.userId][req.params.name] || null;
  res.json({ 
    data: store?.data || null, 
    updatedAt: store?.__updatedAt || null 
  });
});

// PUT /api/sync/stores/:name вЂ” СЃРѕС…СЂР°РЅРёС‚СЊ/РѕР±РЅРѕРІРёС‚СЊ store
app.put('/api/sync/stores/:name', authMiddleware, (req, res) => {
  const storeName = req.params.name;
  // SEC: РёРјСЏ вЂ” С‚РѕР»СЊРєРѕ В«Р±РµР·РѕРїР°СЃРЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂВ», РёРЅР°С‡Рµ СЃРїР°Рј-РєР»СЋС‡Рё СЃРєСѓС€Р°СЋС‚
  // РїР°РјСЏС‚СЊ/Р‘Р” (РєР°Р¶РґС‹Р№ PUT РµС‰С‘ Рё O(РІСЃРµ stores) РїРѕ JSON.stringify РїСЂРё РїРѕРґСЃС‡С‘С‚Рµ).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeName)) {
    return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅРѕРµ РёРјСЏ store' });
  }
  if (storeName === 'loot') return res.status(403).json({ message: 'РРЅРІРµРЅС‚Р°СЂСЊ РёР·РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЃРµСЂРІРµСЂРѕРј' });
  const body = req.body?.data;
  const clientId = req.body?.clientId || null;

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ message: 'data РѕР±СЏР·Р°С‚РµР»РµРЅ Рё РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РѕР±СЉРµРєС‚РѕРј' });
  }

  if (!db.userStores) db.userStores = {};
  if (!db.userStores[req.userId]) db.userStores[req.userId] = {};
  const existingStores = Object.keys(db.userStores[req.userId]);
  // SEC: РѕРіСЂР°РЅРёС‡РёРІР°РµРј РєРѕР»РёС‡РµСЃС‚РІРѕ store'РѕРІ РЅР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (Р·Р°С‰РёС‚Р° РѕС‚ СЃРїР°Рј-РєР»СЋС‡РµР№).
  if (existingStores.length >= 100 && !existingStores.includes(storeName)) {
    return res.status(413).json({ message: 'РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ С…СЂР°РЅРёР»РёС‰ (РјР°РєСЃРёРјСѓРј 100)' });
  }

  // РџСЂРѕРІРµСЂРєР° СЂР°Р·РјРµСЂР° СЌС‚РѕРіРѕ store
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_STORE_SIZE) {
    return res.status(413).json({ 
      message: `Store СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№ (${Math.round(serialized.length/1024)} РљР‘, РјР°РєСЃ ${MAX_STORE_SIZE/1024} РљР‘)` 
    });
  }

  if (!db.userStores) db.userStores = {};
  if (!db.userStores[req.userId]) db.userStores[req.userId] = {};

  // РџСЂРѕРІРµСЂРєР° РѕР±С‰РµРіРѕ СЂР°Р·РјРµСЂР° РІСЃРµС… stores РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
  const otherStoresSize = Object.keys(db.userStores[req.userId])
    .filter(k => k !== storeName)
    .reduce((sum, k) => sum + JSON.stringify(db.userStores[req.userId][k]).length, 0);
  
  if (otherStoresSize + serialized.length > MAX_TOTAL_STORES_SIZE) {
    return res.status(413).json({ 
      message: `РџСЂРµРІС‹С€РµРЅ Р»РёРјРёС‚ С…СЂР°РЅРёР»РёС‰Р° (${Math.round((otherStoresSize + serialized.length)/1024)} РљР‘, РјР°РєСЃ ${MAX_TOTAL_STORES_SIZE/1024} РљР‘)` 
    });
  }

  const clean = JSON.parse(serialized);
  const updatedAt = new Date().toISOString();
  sanitizeProfileMediaStore(clean);
  
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

  // Push РѕР±РЅРѕРІР»РµРЅРёРµ РЅР° РІСЃРµ СѓСЃС‚СЂРѕР№СЃС‚РІР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ С‡РµСЂРµР· WebSocket
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

// DELETE /api/sync/stores/:name вЂ” СѓРґР°Р»РёС‚СЊ store
app.delete('/api/sync/stores/:name', authMiddleware, (req, res) => {
  if (!db.userStores) db.userStores = {};
  if (!db.userStores[req.userId]) db.userStores[req.userId] = {};
  
  delete db.userStores[req.userId][req.params.name];
  saveDb();

  // РЈРІРµРґРѕРјРёС‚СЊ РґСЂСѓРіРёРµ СѓСЃС‚СЂРѕР№СЃС‚РІР° РѕР± СѓРґР°Р»РµРЅРёРё
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

// в”Ђв”Ђв”Ђ Р’СЃС‚СЂРѕРµРЅРЅС‹Рµ С‚РµРјС‹: Р°РґРјРёРЅСЃРєРёР№ СЂРµРґР°РєС‚РѕСЂ РєР°С‚Р°Р»РѕРіР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РњР°СЂС€СЂСѓС‚С‹ Р¶РёРІСѓС‚ РІ themes.js (РєР°Рє blocks.js) вЂ” РёС… РјРѕР¶РЅРѕ РїРѕРєСЂС‹С‚СЊ С‚РµСЃС‚Р°РјРё Р±РµР·
// РїРѕРґРЅСЏС‚РёСЏ РІСЃРµРіРѕ СЃРµСЂРІРµСЂР°. РљР°С‚Р°Р»РѕРі РѕР±С‰РёР№ РґР»СЏ РІСЃРµС…: РїСЂР°РІРєРё Р°РґРјРёРЅР° СЂР°Р·РґР°СЋС‚СЃСЏ
// РєР»РёРµРЅС‚Р°Рј Рё СЂР°СЃСЃС‹Р»Р°СЋС‚СЃСЏ СЃРѕР±С‹С‚РёРµРј `themes:updated`.
themes.install({
  app,
  getDb: () => db,
  saveDb,
  auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)),
  notify: (catalog) => { try { io.emit('themes:updated', { themes: catalog }); } catch {} },
});

communityThemes.install({
  app,
  getDb: () => db,
  saveDb,
  auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)),
  uploadsDir: UPLOADS_DIR,
  upload: uploadCommunityTheme,
  onUploadError: handleUploadError,
  notify: catalog => { try { io.emit('community:themes:updated', { themes: catalog }); } catch {} },
});

// РџР°РєРё РёРєРѕРЅРѕРє СЃРѕРѕР±С‰РµСЃС‚РІР° (СЂРµРґР°РєС‚РѕСЂ С‚РµРј в†’ В«РРєРѕРЅРєРё Рё СЃС‚РёР»СЊВ» в†’ СЃРІРѕРё РїР°РєРё).
communityIconPacks.install({
  app,
  getDb: () => db,
  saveDb,
  auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)),
  dataDir: DATA_DIR,
  // РЎРІРѕРё РїР°РєРё Р°РєРєР°СѓРЅС‚Р° РёР·РјРµРЅРёР»РёСЃСЊ вЂ” РѕСЃС‚Р°Р»СЊРЅС‹Рµ СѓСЃС‚СЂРѕР№СЃС‚РІР° РґРѕРєР°С‡Р°СЋС‚ РёС… СЃР°РјРё.
  // userSockets РѕР±СЉСЏРІР»РµРЅ РЅРёР¶Рµ (СЂСЏРґРѕРј СЃ io), РЅРѕ Рє РјРѕРјРµРЅС‚Сѓ Р·Р°РїСЂРѕСЃР° РѕРЅ СѓР¶Рµ РµСЃС‚СЊ.
  notify: (userId, payload) => {
    try {
      const sockets = userSockets.get(userId);
      if (sockets) sockets.forEach(sid => io.to(sid).emit('icon-packs:updated', payload));
    } catch {}
  },
});

// РЎРєРёРЅС‹ СЂРµР°РєС†РёР№: 10 СЃР»РѕС‚РѕРІ Р±С‹СЃС‚СЂС‹С… СЂРµР°РєС†РёР№ (РєР°СЃС‚РѕРјРёР·Р°С†РёСЏ РїСЂРѕС„РёР»СЏ).
reactionSkins.install({
  app,
  getDb: () => db,
  saveDb,
  authMiddleware,
  emitToUser: (user, event, payload) => { for (const sid of userSockets.get(user.id) || []) io.to(sid).emit(event, payload); },
});

// в”Ђв”Ђв”Ђ РћР±С‰Р°СЏ Р±РёР±Р»РёРѕС‚РµРєР° РјСѓР·С‹РєРё в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
//
// РўСЂРµРєРё Рё Р°Р»СЊР±РѕРјС‹, РІС‹Р»РѕР¶РµРЅРЅС‹Рµ РІСЃРµРјРё: РїРѕРёСЃРє, СЃРѕСЂС‚РёСЂРѕРІРєР°, РїСѓР±Р»РёРєР°С†РёСЏ РїРѕ РѕР±Р»РѕР¶РєРµ Рё
// СЃРѕС…СЂР°РЅРµРЅРёРµ С‡СѓР¶РѕРіРѕ СЃРµР±Рµ. РћС‚РґРµР»СЊРЅС‹Р№ РјРѕРґСѓР»СЊ вЂ” С‚Р°Рј Р¶Рµ РїСЂР°РІРёР»Р° Рё РїСЂРѕРІРµСЂРєРё РїРѕР»РµР№.
musicShare.install({
  app,
  getDb: () => db,
  saveDb,
  auth: authMiddleware,
  guardContent: dropIfActiveContent,
  notify: (event, payload) => { try { io.emit(event, payload); } catch {} },
});

// в”Ђв”Ђв”Ђ РџСЂРѕС‚Рѕ РґРѕСЃРєР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
//
// РЎРѕРІРјРµСЃС‚РЅС‹Р№ С…РѕР»СЃС‚ РіСЂСѓРїРїС‹: РєР°СЂС‚РѕС‡РєРё, РЅРёС‚Рё, С„РѕС‚Рѕ Рё РїСЂР°РІР° СѓС‡Р°СЃС‚РЅРёРєРѕРІ. Р”РѕСЃРєР°
// С…СЂР°РЅРёС‚СЃСЏ РЅР° СЃРµСЂРІРµСЂРµ вЂ” РёРЅР°С‡Рµ РїСЂРёРіР»Р°СЃРёС‚СЊ РЅР° РЅРµС‘ Р±С‹Р»Рѕ Р±С‹ РЅРµС‡РµРј, РїРѕС‚РѕРјСѓ С‡С‚Рѕ
// РґР°РЅРЅС‹Рµ Р»РµР¶Р°Р»Рё Р±С‹ РІ IndexedDB РѕРґРЅРѕРіРѕ Р±СЂР°СѓР·РµСЂР°.
protoBoard.install({
  app,
  getDb: () => db,
  saveDb,
  auth: authMiddleware,
  uploadPhoto: uploadProtoPhoto,
  guardContent: dropIfActiveContent,
  notify: (event, payload) => { try { io.emit(event, payload); } catch {} },
  // РЈРґР°Р»СЏРµРј С„Р°Р№Р»С‹ СЃРЅСЏС‚С‹С… РєР°СЂС‚РѕС‡РµРє. РўРѕР»СЊРєРѕ РёР· СЃРІРѕРµР№ РїР°РїРєРё: РёРјСЏ РїСЂРёС…РѕРґРёС‚ РёР·
  // Р‘Р”, РЅРѕ Р·Р°С‰РёС‚Р° РѕС‚ РїРѕРґСЃС‚Р°РЅРѕРІРєРё С‡СѓР¶РѕРіРѕ РїСѓС‚Рё РІСЃС‘ СЂР°РІРЅРѕ РЅСѓР¶РЅР°.
  prunePhotos: (urls) => {
    for (const url of urls || []) {
      const name = String(url).replace(/^\/uploads\/proto\//, '');
      if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
      try { fs.unlinkSync(path.join(UPLOADS_DIR, 'proto', name)); } catch { /* СѓР¶Рµ СѓРґР°Р»С‘РЅ */ }
    }
  },
});

// POST /api/music/cover вЂ” Р·Р°РіСЂСѓР·РёС‚СЊ РѕР±Р»РѕР¶РєСѓ С‚СЂРµРєР° РёР»Рё Р°Р»СЊР±РѕРјР°.
// РћС‚РґРµР»СЊРЅР°СЏ С‚РѕС‡РєР° РѕС‚ `/upload`: РѕР±Р»РѕР¶РєР° РЅРµ С‚СЏРЅРµС‚ Р·Р° СЃРѕР±РѕР№ РїРµСЂРµР·Р°Р»РёРІРєСѓ Р°СѓРґРёРѕ,
// Рё РјСѓР·С‹РєСѓ РЅРµ РЅСѓР¶РЅРѕ РіСЂСѓР·РёС‚СЊ Р·Р°РЅРѕРІРѕ СЂР°РґРё СЃРјРµРЅС‹ РєР°СЂС‚РёРЅРєРё.
app.post('/api/music/cover', authMiddleware, uploadCover.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'РћР±Р»РѕР¶РєР° РЅРµ Р·Р°РіСЂСѓР¶РµРЅР°' });
  if (dropIfActiveContent(req, res)) return;
  res.status(201).json({ coverUrl: `/uploads/music/${req.file.filename}` });
});

// Р’СЃС‚СЂРѕРµРЅРЅС‹Рµ С„РѕС‚Рѕ/С„РѕРЅС‹ РѕР±РѕРµРІ: Р°РґРјРёРЅ Р·Р°Р»РёРІР°РµС‚ С„Р°Р№Р»С‹ Рё РіСЂР°РґРёРµРЅС‚С‹, РѕРЅРё РїРѕСЏРІР»СЏСЋС‚СЃСЏ
// РІ РѕР±С‰РµР№ РіР°Р»РµСЂРµРµ РѕР±РѕРµРІ Сѓ РІСЃРµС…. РћС‚РґРµР»СЊРЅС‹Р№ РјРѕРґСѓР»СЊ вЂ” С‚Р°Рј Р¶Рµ СЃР°РЅРёС‚Р°Р№Р·РµСЂ css.
adminWallpapers.install({
  app,
  getDb: () => db,
  saveDb,
  auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)),
  notify: (catalog) => { try { io.emit('wallpapers:updated', { wallpapers: catalog }); } catch {} },
  upload: uploadWallpaper,
  uploadsDir: UPLOADS_DIR,
  // Р‘РµР· СЌС‚РѕРіРѕ РѕС‚РєР°Р· multer (С„Р°Р№Р» Р±РµР· MIME, СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№) СѓС€С‘Р» Р±С‹ РІ
  // СЃС‚Р°РЅРґР°СЂС‚РЅС‹Р№ РѕР±СЂР°Р±РѕС‚С‡РёРє express Рё РІРµСЂРЅСѓР» 500 СЃ HTML РІРјРµСЃС‚Рѕ 400 СЃ С‚РµРєСЃС‚РѕРј.
  onUploadError: handleUploadError,
});

// РћР±С‰РёРµ СЃС‚РѕРєРѕРІС‹Рµ С€СЂРёС„С‚С‹ Р°РґРјРёРЅР°: Р·Р°Р»РёР» С„Р°Р№Р» вЂ” РѕРЅ РїРѕСЏРІРёР»СЃСЏ РІ РІС‹Р±РѕСЂРµ С€СЂРёС„С‚Р° Сѓ РІСЃРµС….
adminFonts.install({
  app,
  getDb: () => db,
  saveDb,
  auth: authMiddleware,
  isAdmin: req => isAdminUser(req, db.users.find(u => u.id === req.userId)),
  notify: (catalog) => { try { io.emit('fonts:updated', { fonts: catalog }); } catch {} },
  upload: uploadFont,
  uploadsDir: UPLOADS_DIR,
  onUploadError: handleUploadError,
});

// в”Ђв”Ђв”Ђ DEVICE routes (РїСЂР°РІРёР»Рѕ В«СѓСЃС‚СЂРѕР№СЃС‚РІРѕ 1 = 1, РІС‚РѕСЂРѕРµ вЂ” РїРѕ QRВ») в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// GET /api/devices вЂ” СЃРїРёСЃРѕРє СѓСЃС‚СЂРѕР№СЃС‚РІ С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
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

// POST /api/devices/link/create вЂ” СЃРѕР·РґР°С‚СЊ QR-РєРѕРґ/СЃСЃС‹Р»РєСѓ РґР»СЏ РїСЂРёРІСЏР·РєРё РІС‚РѕСЂРѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР°
app.post('/api/devices/link/create', authMiddleware, (req, res) => {
  const myCount = countUserDevices(req.userId);
  if (myCount >= MAX_DEVICES_PER_ACCOUNT) {
    return res.status(403).json({ message: `РЈР¶Рµ РїСЂРёРІСЏР·Р°РЅРѕ ${MAX_DEVICES_PER_ACCOUNT} СѓСЃС‚СЂРѕР№СЃС‚РІР°. РћС‚РІСЏР¶РёС‚Рµ РѕРґРЅРѕ, С‡С‚РѕР±С‹ РґРѕР±Р°РІРёС‚СЊ РЅРѕРІРѕРµ.` });
  }
  const invite = {
    id: uuidv4(),
    userId: req.userId,
    token: 'vera-link-' + uuidv4().replace(/-/g, ''),
    expiresAt: Date.now() + LINK_INVITE_TTL_MS,
    createdAt: Date.now(),
  };
  if (!db.linkInvites) db.linkInvites = [];
  // РћРґРЅРѕ Р°РєС‚РёРІРЅРѕРµ РїСЂРёРіР»Р°С€РµРЅРёРµ РЅР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
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
    // РўРµРєСЃС‚РѕРІР°СЏ СЃСЃС‹Р»РєР° вЂ” С‡С‚РѕР±С‹ РІСЃС‚Р°РІРёС‚СЊ РєСѓРґР° СѓРіРѕРґРЅРѕ
    textUrl: `${origin}://${host}/link?token=${invite.token}`,
    webUrl: `${origin}://${host}/link?token=${invite.token}`,
    expiresAt: invite.expiresAt,
    ttlSeconds: LINK_INVITE_TTL_MS / 1000,
  });
});

// POST /api/devices/link/accept вЂ” РїСЂРёРІСЏР·Р°С‚СЊ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РїРѕ С‚РѕРєРµРЅСѓ QR/СЃСЃС‹Р»РєРё
app.post('/api/devices/link/accept', (req, res) => {
  const { token, deviceId, deviceName } = req.body || {};
  const t = String(token || '').trim();
  let parsedToken = t;
  // РњРѕРіСѓС‚ РІСЃС‚Р°РІРёС‚СЊ РїРѕР»РЅСѓСЋ СЃСЃС‹Р»РєСѓ вЂ” РІС‹С‚Р°СЃРєРёРІР°РµРј token РёР· query/param
  const m = t.match(/[?&]token=([^&]+)/);
  try { if (m) parsedToken = decodeURIComponent(m[1]); }
  catch { return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ СЃСЃС‹Р»РєР° РїСЂРёРІСЏР·РєРё' }); }
  if (!parsedToken.startsWith('vera-link-')) return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ СЃСЃС‹Р»РєР° РїСЂРёРІСЏР·РєРё' });

  const invite = (db.linkInvites || []).find(i => i.token === parsedToken);
  if (!invite) return res.status(404).json({ message: 'РЎСЃС‹Р»РєР° РїСЂРёРІСЏР·РєРё РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё СѓР¶Рµ РёСЃРїРѕР»СЊР·РѕРІР°РЅР°' });

  const installation = resolveInstallation(req, res, true);
  if (!installation) return;
  const resAccept = acceptLinkInviteOnServer(invite, installation.deviceId, String(deviceName || '').slice(0, 80));
  if (!resAccept.ok) return res.status(403).json({ message: resAccept.message });
  resAccept.device.installationHash = installation.hash;
  saveDb();
  const owner = db.users.find(u => u.id === invite.userId);
  if (!owner) return res.status(404).json({ message: 'РђРєРєР°СѓРЅС‚ РІР»Р°РґРµР»СЊС†Р° РЅРµ РЅР°Р№РґРµРЅ' });
  recordModerationIp(owner.id, requestIp(req));
  const accessToken = issueAccessToken(owner, installation.deviceId);
  const { raw } = issueRefreshToken(owner, installation.deviceId);
  saveDb();
  const csrfToken = setAuthCookies(res, raw, owner, installation.deviceId);
  res.json({ ok: true, accessToken, csrfToken, deviceId: installation.deviceId, user: withDevFlag(req, owner) });
});

// DELETE /api/devices/:id вЂ” РѕС‚РІСЏР·Р°С‚СЊ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ
app.delete('/api/devices/:id', authMiddleware, (req, res) => {
  const devices = (db.devices || []).filter(d => d.userId === req.userId);
  const target = devices.find(d => d.id === req.params.id);
  if (!target) return res.status(404).json({ message: 'РЈСЃС‚СЂРѕР№СЃС‚РІРѕ РЅРµ РЅР°Р№РґРµРЅРѕ' });
  if (target.isPrimary && devices.length === 1) {
    return res.status(400).json({ message: 'РќРµР»СЊР·СЏ РѕС‚РІСЏР·Р°С‚СЊ РµРґРёРЅСЃС‚РІРµРЅРЅРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ Р°РєРєР°СѓРЅС‚Р°' });
  }
  target.revoked = true;
  for (const token of db.refreshTokens || []) {
    if (token.deviceId === target.deviceId) token.revokedAt = Date.now();
  }
  saveDb();
  res.json({ success: true });
});

// POST /api/devices/name вЂ” РїРµСЂРµРёРјРµРЅРѕРІР°С‚СЊ С‚РµРєСѓС‰РµРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ
app.post('/api/devices/name', authMiddleware, (req, res) => {
  const deviceId = req.body?.deviceId || jwt.decode(req.headers.authorization?.slice(7))?.deviceId;
  const device = (db.devices || []).find(d => d.userId === req.userId && d.deviceId === deviceId);
  if (device) {
    device.name = String(req.body?.name || device.name).slice(0, 80);
    saveDb();
  }
  res.json({ success: true });
});

// GET /link вЂ” РїРѕРєР°Р·С‹РІР°РµС‚ СЃС‚СЂР°РЅРёС†Сѓ SPA, РґР°Р»СЊС€Рµ С„СЂРѕРЅС‚ СЃР°Рј С‡РёС‚Р°РµС‚ ?token=
// (РЅР°РїСЂРёРјРµСЂ /link?token=vera-link-xxx) Рё РІС‹Р·С‹РІР°РµС‚ accept.

// в”Ђв”Ђв”Ђ Р’Рџ / РєСЂРёРїС‚Рѕ-РєРѕС€РµР»С‘Рє (NOWPayments) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р‘РµР· NOWPAYMENTS_API_KEY РІСЃРµ РїРѕРїРѕР»РЅРµРЅРёСЏ СЂР°Р±РѕС‚Р°СЋС‚ РІ mock-СЂРµР¶РёРјРµ (С‚РµСЃС‚ РїРѕС‚РѕРєР°).
// РљР»СЋС‡Рё Р·Р°РґР°СЋС‚СЃСЏ С‡РµСЂРµР· env: NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET.
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || '';
const NOWPAYMENTS_API = 'https://api.nowpayments.io';
// SEC: СЃС‚Р°СЂС‚РѕРІС‹Р№ Р»РѕРі, С‡С‚РѕР±С‹ СЃСЂР°Р·Сѓ РІРёРґРµС‚СЊ, СЂРµР°Р»СЊРЅС‹Р№ С€Р»СЋР· РёР»Рё mock. РљР»СЋС‡Рё РЅРµ РїРµС‡Р°С‚Р°РµРј.
console.log(
  `[wallet] NOWPayments mode: ${NOWPAYMENTS_API_KEY ? 'live' : 'mock'} ` +
  `(IPN signature check: ${NOWPAYMENTS_IPN_SECRET ? 'on' : 'off'})`,
);
const VP_PER_RUB = 2;                    // 1 СЂСѓР± = 2 Р’Рџ (1 Р’Рџ = 0.5 СЂСѓР±)
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
  // РџР°РєРё, РєРѕС‚РѕСЂС‹Рµ СЂРµР°Р»СЊРЅРѕ РІС‹РґР°СЋС‚ РєРµР№СЃС‹. РљР°С‚Р°Р»РѕРі РєРµР№СЃРѕРІ РѕР±С‰РёР№ СЃ РєР»РёРµРЅС‚РѕРј,
  // РїРѕСЌС‚РѕРјСѓ РЅРѕРІС‹Рµ/РїРµСЂРµРёРјРµРЅРѕРІР°РЅРЅС‹Рµ РїР°РєРё РЅРµ РЅСѓР¶РЅРѕ РґРѕРїРёСЃС‹РІР°С‚СЊ СЃСЋРґР° РІСЂСѓС‡РЅСѓСЋ:
  // РёРЅР°С‡Рµ РёС… СЃРєРёРЅС‹ СЃС‡РёС‚Р°Р»РёСЃСЊ В«РЅРµРёР·РІРµСЃС‚РЅС‹РјРёВ» Рё РЅРµ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°Р»РёСЃСЊ.
  ...require('../Web/src/store/cases.json')
    .flatMap(c => Array.isArray(c.packs) ? c.packs : [])
    .filter(key => typeof key === 'string' && !key.startsWith('r-')),
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

// РџРёС‚РѕРјС†С‹ С…СЂР°РЅСЏС‚СЃСЏ РѕС‚РґРµР»СЊРЅРѕ РѕС‚ СЃРєРёРЅРѕРІ (user.ownedPets), РЅРѕ С‚РѕСЂРіСѓСЋС‚СЃСЏ РЅР° С‚РѕР№ Р¶Рµ РїР»РѕС‰Р°РґРєРµ.
function isPetId(itemId) {
  return String(itemId).startsWith('pet-') && !!PET_CATALOG[normalizePetId(itemId)];
}
function isTradableItemId(itemId) {
  return isKnownSkinId(itemId) || isPetId(itemId);
}
function userOwnsItem(user, itemId) {
  if (isPetId(itemId)) {
    const id = normalizePetId(itemId);
    return Array.isArray(user?.ownedPets) && (user.ownedPets.includes(id) || user.ownedPets.includes(itemId));
  }
  return !!user?.ownedItems?.includes(itemId);
}
function grantItemToUser(user, itemId) {
  if (isPetId(itemId)) {
    const id = normalizePetId(itemId);
    user.ownedPets = [...new Set([...(user.ownedPets || []), id])];
    // Р’РѕР·РІСЂР°С‚ РєРѕРїРёРё РёР· СЌСЃРєСЂРѕСѓ СѓРІРµР»РёС‡РёРІР°РµС‚ СЃС‡С‘С‚С‡РёРє (С€С‚.), Р° РЅРµ РґСѓР±Р»РёСЂСѓРµС‚ РїРёС‚РѕРјС†Р°.
    const stored = Math.floor(Number(user.petCounts?.[id]));
    const previous = Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
    user.petCounts = { ...user.petCounts, [id]: previous + 1 };
  } else {
    user.ownedItems = [...new Set([...user.ownedItems, itemId])];
    setSyncedShopOwnership(user.id, itemId, true);
  }
}
function removeItemFromUser(user, itemId) {
  if (isPetId(itemId)) {
    const id = normalizePetId(itemId);
    const stored = Math.floor(Number(user.petCounts?.[id]));
    const copies = Number.isSafeInteger(stored) && stored > 0 ? stored : ((user.ownedPets || []).includes(id) || (user.ownedPets || []).includes(itemId)) ? 1 : 0;
    if (copies > 1) {
      // Р’ СЌСЃРєСЂРѕСѓ СѓС…РѕРґРёС‚ РѕРґРЅР° РєРѕРїРёСЏ, РѕСЃС‚Р°Р»СЊРЅС‹Рµ (Рё РЅР°РґРµС‚С‹Р№ РїРёС‚РѕРјРµС†) РѕСЃС‚Р°СЋС‚СЃСЏ.
      user.petCounts = { ...user.petCounts, [id]: copies - 1 };
      return;
    }
    user.ownedPets = (user.ownedPets || []).filter(pid => pid !== id && pid !== itemId);
    user.petCounts = { ...user.petCounts, [id]: 0 };
    if (user.equippedPet && (user.equippedPet.id === id || user.equippedPet.id === itemId)) user.equippedPet = null;
  } else {
    user.ownedItems = user.ownedItems.filter(id => id !== itemId);
    setSyncedShopOwnership(user.id, itemId, false);
  }
}
function emitPetsUpdated(user) {
  if (typeof io === 'undefined' || !io) return;
  for (const sid of userSockets.get(user.id) || []) io.to(sid).emit('pets:updated', petState(user));
}

// Р’Р»Р°РґРµР»РµС† СЃРєСЂС‹Р» РёРЅРІРµРЅС‚Р°СЂСЊ РІ РЅР°СЃС‚СЂРѕР№РєР°С… вЂ” РґСЂСѓРіРёРј РµРіРѕ РЅРµ РѕС‚РґР°С‘Рј РІРѕРІСЃРµ.
function inventoryVisibleToOthers(user) {
  const settings = db.userSettings?.[user?.id];
  return !settings || settings.showInventoryToOthers !== false;
}

// РџСѓР±Р»РёС‡РЅР°СЏ РїСЂРѕРµРєС†РёСЏ РёРЅРІРµРЅС‚Р°СЂСЏ: С‚РѕР»СЊРєРѕ РёР·РІРµСЃС‚РЅС‹Рµ id Рё РєРѕР»РёС‡РµСЃС‚РІР°, Р±РµР· С†РµРЅ,
// Р±Р°Р»Р°РЅСЃР° Рё РёСЃС‚РѕСЂРёРё РІС‹РїР°РґРµРЅРёР№. Р’С‹Р»РѕР¶РµРЅРЅРѕРµ РЅР° РїР»РѕС‰Р°РґРєСѓ СѓР¶Рµ РІС‹С‡С‚РµРЅРѕ.
function publicInventory(user) {
  const skins = [...accountOwnedSkinIds(user)];
  const pets = petState(user);
  const cases = normalizeCaseInventory(user?.caseCounts);
  const caseCounts = {};
  for (const [id, count] of Object.entries(cases)) {
    if (count > 0) caseCounts[id] = count;
  }
  return {
    skins,
    pets: pets.ownedPets,
    petCounts: pets.petCounts,
    equippedPetId: pets.equippedPet?.id || '',
    cases: caseCounts,
  };
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
    seller: seller?.username || 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ',
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

// РЎРµСЂРІРµСЂРЅС‹Р№ РєР°С‚Р°Р»РѕРі С†РµРЅ вЂ” РєРѕРїРёСЏ РїР»Р°С‚РЅС‹С… С‚РѕРІР°СЂРѕРІ РёР· РєР»РёРµРЅС‚СЃРєРѕРіРѕ SHOP_CATALOG.
const SHOP_PRICES = {
  'wp-time': 120,
  'wp-parallax': 180,
  'wp-touch': 200,
  'chat-theme': 250,
  // в”Ђв”Ђ Р›РёРЅРµР№РєР° СЂРµРґРєРѕСЃС‚РµР№ (21Г—2, id = ring-r-<tier> / selfcard-r-<tier>) в”Ђв”Ђ
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
  // в”Ђв”Ђ РќРѕРІС‹Рµ РїР»Р°С‚РЅС‹Рµ (bubble + РґРѕРї. РѕР±РѕРё) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

// в”Ђв”Ђв”Ђ Р РµС„РµСЂР°Р»СЊРЅР°СЏ РїСЂРѕРіСЂР°РјРјР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р”СЂСѓРі РїРµСЂРµС…РѕРґРёС‚ РїРѕ СЃСЃС‹Р»РєРµ Рё Р Р•Р“РРЎРўР РР РЈР•Рў РЅРѕРІС‹Р№ Р°РєРєР°СѓРЅС‚. РќР°РіСЂР°РґС‹ РїСЂРёРіР»Р°СЃРёРІС€РµРјСѓ:
//  вЂў 5% РѕС‚ РєР°Р¶РґРѕРіРѕ РїРѕРїРѕР»РЅРµРЅРёСЏ РґСЂСѓРіР° вЂ” РЅРѕ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ С‚РѕРіРѕ, РєР°Рє РґСЂСѓРі
//    РїРѕР»СЊР·РѕРІР°Р»СЃСЏ РјРµСЃСЃРµРЅРґР¶РµСЂРѕРј РЅРµ РјРµРЅРµРµ REFERRAL_CASHBACK_MIN_DAYS РґРЅРµР№;
//  вЂў РµРґРёРЅРѕСЂР°Р·РѕРІС‹Р№ Р±РѕРЅСѓСЃ REFERRAL_TENURE_BONUS_VP Р’Рџ, РєРѕРіРґР° РґСЂСѓРі РѕС‚СЂР°Р±РѕС‚Р°Р»
//    REFERRAL_TENURE_DAYS Р°РєС‚РёРІРЅС‹С… РґРЅРµР№.
// В«Р”Р»СЏ Р·Р°СЂРµРіР°РЅРЅС‹С… Р°РєРєРѕРІ РЅРµ СЂР°Р±РѕС‚Р°РµС‚В»: РµСЃР»Рё РЅР° СѓСЃС‚СЂРѕР№СЃС‚РІРµ/РІ СЃРµС‚Рё СѓР¶Рµ РµСЃС‚СЊ
// Р°РєРєР°СѓРЅС‚ (Р°РЅС‚Рё-РјСѓР»СЊС‚РёР°РєРєР°СѓРЅС‚ СЂРµРµСЃС‚СЂ), СЂРµС„РµСЂР°Р»СЊРЅР°СЏ РїСЂРёРІСЏР·РєР° РЅРµ СЃРѕР·РґР°С‘С‚СЃСЏ.
const REFERRAL_CASHBACK_PERCENT = 5;       // % РѕС‚ РїРѕРїРѕР»РЅРµРЅРёР№ РґСЂСѓРіР° РїСЂРёРіР»Р°СЃРёРІС€РµРјСѓ
const REFERRAL_CASHBACK_MIN_DAYS = 3;      // РґСЂСѓРі РґРѕР»Р¶РµРЅ РїРѕР»СЊР·РѕРІР°С‚СЊСЃСЏ в‰Ґ 3 РґРЅРµР№
const REFERRAL_TENURE_DAYS = 7;            // 7 Р°РєС‚РёРІРЅС‹С… РґРЅРµР№ в†’ СЂР°Р·РѕРІС‹Р№ Р±РѕРЅСѓСЃ
const REFERRAL_TENURE_BONUS_VP = 50;       // СЂР°Р·РјРµСЂ СЂР°Р·РѕРІРѕРіРѕ Р±РѕРЅСѓСЃР°, Р’Рџ

// РљРѕРґ РїСЂРёРіР»Р°С€РµРЅРёСЏ СЃС‚Р°Р±РёР»РµРЅ РґР»СЏ Р°РєРєР°СѓРЅС‚Р°. Р“РµРЅРµСЂРёСЂСѓРµРј Р»РµРЅРёРІРѕ РёР· id (Р±РµР· РџР”).
function referralCodeFor(user) {
  if (!user) return '';
  if (!user.referralCode) {
    user.referralCode = 'r' + require('crypto').createHash('sha256')
      .update('referral:' + user.id).digest('hex').slice(0, 11);
    saveDb();
  }
  return user.referralCode;
}
function findUserByReferralCode(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!/^r[a-f0-9]{11}$/.test(c)) return null;
  return db.users.find(u => (u.referralCode || referralCodeFor(u)) === c) || null;
}
// РЎС‡С‘С‚С‡РёРє Р РђР—РќР«РҐ Р°РєС‚РёРІРЅС‹С… РґРЅРµР№ Р°РєРєР°СѓРЅС‚Р° (UTC-РґР°С‚С‹). РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ Рё РґР»СЏ
// 3-РґРЅРµРІРЅРѕРіРѕ РїРѕСЂРѕРіР° РєСЌС€Р±СЌРєР°, Рё РґР»СЏ 7-РґРЅРµРІРЅРѕРіРѕ СЂР°Р·РѕРІРѕРіРѕ Р±РѕРЅСѓСЃР°.
function markActiveDay(user) {
  if (!user) return;
  if (!Array.isArray(user.activeDays)) user.activeDays = [];
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (!user.activeDays.includes(today)) {
    user.activeDays.push(today);
    if (user.activeDays.length > 400) user.activeDays = user.activeDays.slice(-400);
    saveDb();
    maybeGrantReferralTenureBonus(user);
  }
}
function referralActiveDays(user) {
  return Array.isArray(user?.activeDays) ? user.activeDays.length : 0;
}
// Р Р°Р·РѕРІС‹Р№ Р±РѕРЅСѓСЃ РїСЂРёРіР»Р°СЃРёРІС€РµРјСѓ Р·Р° 7 Р°РєС‚РёРІРЅС‹С… РґРЅРµР№ РґСЂСѓРіР°.
function maybeGrantReferralTenureBonus(friend) {
  if (!friend || !friend.referredBy || friend.referralTenureBonusPaid) return;
  if (referralActiveDays(friend) < REFERRAL_TENURE_DAYS) return;
  const referrer = ensureWallet(db.users.find(u => u.id === friend.referredBy));
  if (!referrer || referrer.id === friend.id) { friend.referralTenureBonusPaid = true; saveDb(); return; }
  const prev = referrer.walletBalance || 0;
  if (!Number.isSafeInteger(prev + REFERRAL_TENURE_BONUS_VP)) return;
  referrer.walletBalance = prev + REFERRAL_TENURE_BONUS_VP;
  friend.referralTenureBonusPaid = true;
  referrer.referralEarnedVp = (referrer.referralEarnedVp || 0) + REFERRAL_TENURE_BONUS_VP;
  try { saveDb(); } catch { referrer.walletBalance = prev; friend.referralTenureBonusPaid = false; return; }
  pushWalletEmit(referrer);
}
// 5%-РєСЌС€Р±СЌРє РїСЂРёРіР»Р°СЃРёРІС€РµРјСѓ СЃ РѕРїР»Р°С‡РµРЅРЅРѕРіРѕ РїРѕРїРѕР»РЅРµРЅРёСЏ РґСЂСѓРіР°.
// Р’С‹Р·С‹РІР°РµС‚СЃСЏ РёР· РѕР±РѕРёС… webhook'РѕРІ РїРѕСЃР»Рµ Р·Р°С‡РёСЃР»РµРЅРёСЏ Р’Рџ РґСЂСѓРіСѓ.
function grantReferralCashback(friend, topupVp) {
  if (!friend || !friend.referredBy) return;
  if (!Number.isSafeInteger(topupVp) || topupVp <= 0) return;
  // Р”СЂСѓРі РґРѕР»Р¶РµРЅ РїРѕР»СЊР·РѕРІР°С‚СЊСЃСЏ РјРµСЃСЃРµРЅРґР¶РµСЂРѕРј РЅРµ РјРµРЅСЊС€Рµ 3 РґРЅРµР№.
  if (referralActiveDays(friend) < REFERRAL_CASHBACK_MIN_DAYS) return;
  const referrer = ensureWallet(db.users.find(u => u.id === friend.referredBy));
  if (!referrer || referrer.id === friend.id) return;
  const reward = Math.floor(topupVp * REFERRAL_CASHBACK_PERCENT / 100);
  if (reward <= 0) return;
  const prev = referrer.walletBalance || 0;
  if (!Number.isSafeInteger(prev + reward)) return;
  referrer.walletBalance = prev + reward;
  referrer.referralEarnedVp = (referrer.referralEarnedVp || 0) + reward;
  try { saveDb(); } catch { referrer.walletBalance = prev; return; }
  pushWalletEmit(referrer);
}

// РџСЂРёРІСЏР·РєР° СЂРµС„РµСЂР°Р»Р° РїСЂРё Р Р•Р“РРЎРўР РђР¦РР РЅРѕРІРѕРіРѕ Р°РєРєР°СѓРЅС‚Р°.
// РЈСЃР»РѕРІРёСЏ: РІР°Р»РёРґРЅС‹Р№ РєРѕРґ, РЅРµ СЃР°РјРѕРїСЂРёРіР»Р°С€РµРЅРёРµ, Рё СЌС‚Рѕ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ/СЃРµС‚СЊ СЂР°РЅСЊС€Рµ
// РЅРµ СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°Р»Рё Р°РєРєР°СѓРЅС‚РѕРІ (РєСЂРѕРјРµ С‚РѕР»СЊРєРѕ С‡С‚Рѕ СЃРѕР·РґР°РЅРЅРѕРіРѕ) вЂ” РёРЅР°С‡Рµ Р±РѕРЅСѓСЃ РЅРµ
// РЅР°С‡РёСЃР»СЏРµРј (В«РґР»СЏ Р·Р°СЂРµРіР°РЅРЅС‹С… Р°РєРєРѕРІ РЅРµ СЂР°Р±РѕС‚Р°РµС‚В»). РџСЂРёРІСЏР·РєР° РѕРґРЅРѕСЃС‚РѕСЂРѕРЅРЅСЏСЏ Рё
// РЅРµРёР·РјРµРЅСЏРµРјР°СЏ.
function linkReferralOnRegister(newUser, rawCode, regLimit) {
  try {
    if (!newUser || newUser.referredBy) return;
    const code = String(rawCode || '').trim();
    if (!code) return;
    const referrer = findUserByReferralCode(code);
    if (!referrer || referrer.id === newUser.id) return;
    // РЎРєРѕР»СЊРєРѕ Р РђР—РќР«РҐ Р°РєРєР°СѓРЅС‚РѕРІ СѓР¶Рµ РЅР° СЌС‚РѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ/РІ СЃРµС‚Рё, РЅРµ СЃС‡РёС‚Р°СЏ РЅРѕРІРѕРіРѕ.
    const deviceCount = countAccountsForHashExcluding('device', regLimit?.deviceHash, newUser.id);
    const ipCount = countAccountsForHashExcluding('ip', regLimit?.ipHash, newUser.id);
    if (deviceCount > 0 || ipCount > 0) return; // СѓСЃС‚СЂРѕР№СЃС‚РІРѕ/СЃРµС‚СЊ СѓР¶Рµ В«Р·Р°СЂРµРіР°РЅС‹В»
    newUser.referredBy = referrer.id;
    newUser.referredAt = Date.now();
    newUser.referralTenureBonusPaid = false;
    markActiveDay(newUser); // РґРµРЅСЊ СЂРµРіРёСЃС‚СЂР°С†РёРё вЂ” РїРµСЂРІС‹Р№ Р°РєС‚РёРІРЅС‹Р№ РґРµРЅСЊ
    saveDb();
  } catch (e) { console.error('[referral] link failed:', e?.message); }
}
// РљР°Рє countAccountsForHash, РЅРѕ РёСЃРєР»СЋС‡Р°РµС‚ Р·Р°РґР°РЅРЅС‹Р№ userId РёР· РїРѕРґСЃС‡С‘С‚Р°.
function countAccountsForHashExcluding(kind, hash, excludeUserId) {
  if (!hash) return 0;
  const since = Date.now() - REG_LEDGER_TTL_MS;
  const ids = new Set();
  for (const e of db.regLedger || []) {
    if (e.kind === kind && e.h === hash && Number(e.at) >= since && e.userId !== excludeUserId) ids.add(e.userId);
  }
  return ids.size;
}

// РњРѕСЏ СЂРµС„РµСЂР°Р»СЊРЅР°СЏ СЃСЃС‹Р»РєР° Рё СЃС‚Р°С‚РёСЃС‚РёРєР°.
app.get('/api/referral', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  const code = referralCodeFor(user);
  const proto = (req.headers['x-forwarded-proto'] === 'https' || req.secure) ? 'https' : 'http';
  const host = req.headers.host || 'localhost:3000';
  const invited = db.users.filter(u => u.referredBy === user.id);
  res.json({
    code,
    link: `${proto}://${host}/?ref=${code}`,
    invitedCount: invited.length,
    activeCount: invited.filter(u => referralActiveDays(u) >= REFERRAL_CASHBACK_MIN_DAYS).length,
    earnedVp: user.referralEarnedVp || 0,
    cashbackPercent: REFERRAL_CASHBACK_PERCENT,
    cashbackMinDays: REFERRAL_CASHBACK_MIN_DAYS,
    tenureDays: REFERRAL_TENURE_DAYS,
    tenureBonusVp: REFERRAL_TENURE_BONUS_VP,
  });
});

// Р‘Р°Р»Р°РЅСЃ + РєСѓРїР»РµРЅРЅС‹Рµ С‚РѕРІР°СЂС‹
app.post('/api/admin/wallet/grant', authMiddleware, (req, res) => {
  if (!adminRequest(req)) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°' });
  const username = String(req.body?.username || '').trim().replace(/^@+/, '').toLowerCase();
  const amount = req.body?.amount;
  if (!username || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ РЅРёРє Рё С†РµР»РѕРµ РєРѕР»РёС‡РµСЃС‚РІРѕ Р’Рџ РѕС‚ 1 РґРѕ 1 000 000' });
  }
  const matches = db.users.filter(u => String(u.username || '').replace(/^@+/, '').toLowerCase() === username);
  if (matches.length !== 1) return res.status(matches.length ? 409 : 404).json({ message: matches.length ? 'РќРёРє РЅРµРѕРґРЅРѕР·РЅР°С‡РµРЅ' : 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  const user = matches[0];
  const previous = user.walletBalance;
  const balance = Number.isFinite(previous) ? previous : 0;
  if (!Number.isSafeInteger(balance + amount)) return res.status(400).json({ message: 'РџСЂРµРІС‹С€РµРЅ РїСЂРµРґРµР» Р±Р°Р»Р°РЅСЃР°' });
  user.walletBalance = balance + amount;
  try { saveDb(); } catch {
    user.walletBalance = previous;
    return res.status(500).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РЅР°С‡РёСЃР»РµРЅРёРµ' });
  }
  pushWalletEmit(user);
  res.json({ username: user.username, amount, balance: user.walletBalance });
});

app.get('/api/wallet', authMiddleware, (req, res) => {
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  res.json({ balance: user.walletBalance, ownedItems: user.ownedItems });
});

const CASE_CATALOG = require('./../Web/src/store/cases.json');
function caseState(user) {
  return {
    balance: user.walletBalance, ownedItems: user.ownedItems,
    caseCounts: normalizeCaseInventory(user.caseCounts),
    packs: user.casePacks || {}, lastDrop: user.lastCaseDrop || null,
    // РћР±Рµ С‡Р°СЃС‚Рё СЃРѕСЃС‚РѕСЏРЅРёСЏ СЂРµР°РєС†РёР№ РІРјРµСЃС‚Рµ: 
    // СЃРѕР±С‹С‚РёРµ cases:updated РґРµСЂР¶РёС‚ С‚РѕР»СЊРєРѕ РІР»Р°РґРµРЅРёРµ, Рё Р±РµР· reactionSlots
    // РєР»РёРµРЅС‚ Р·Р°С‚РёСЂР°Р» РІС‹Р±СЂР°РЅРЅС‹Рµ 10 СЃР»РѕС‚РѕРІ Р±С‹СЃС‚СЂС‹С… СЂРµР°РєС†РёР№ РІ СЃС‚РѕРє.
    reactionSkins: reactionSkins.ownedSkins(user),
    reactionSlots: reactionSkins.slots(user),
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
    if (!definition) return res.status(400).json({ message: 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ РєРµР№СЃ' });
    // РЎРєСЂС‹С‚С‹Р№ РєРµР№СЃ (hidden: true) СЃРЅСЏС‚ СЃ РїСЂРѕРґР°Р¶Рё вЂ” РєСѓРїРёС‚СЊ РЅРµР»СЊР·СЏ, РЅРѕ РѕС‚РєСЂС‹С‚С‹Р№
    // СЂР°РЅРµРµ Р·Р°РїР°СЃ РїРѕР·РІРѕР»СЏРµС‚ РѕС‚РєСЂС‹С‚СЊ РµРіРѕ РёР· РёРЅРІРµРЅС‚Р°СЂСЏ.
    if (action === 'buy' && definition.hidden) return res.status(403).json({ message: 'РљРµР№СЃ РІСЂРµРјРµРЅРЅРѕ СЃРЅСЏС‚ СЃ РїСЂРѕРґР°Р¶Рё' });
    const user = ensureWallet(db.users.find(u => u.id === req.userId));
    const counts = normalizeCaseInventory(user.caseCounts);
    const price = CASE_PRICES[definition.id];
    if (action === 'buy' && (!Number.isSafeInteger(price) || price <= 0)) return res.status(409).json({ message: 'Р¦РµРЅР° РєРµР№СЃР° РµС‰С‘ РЅРµ РЅР°Р·РЅР°С‡РµРЅР°' });
    if (action === 'buy' && user.walletBalance < price) return res.status(409).json({ message: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р’Рџ' });
    if (action === 'open' && counts[definition.id] < 1) return res.status(409).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїРЅРѕРіРѕ РєРµР№СЃР°' });
    const previous = JSON.parse(JSON.stringify(user));
    let drop = null;
    if (action === 'buy') {
      user.walletBalance -= price;
      counts[definition.id]++;
    } else {
      // Р’РµСЃР° РјРѕРіСѓС‚ Р±С‹С‚СЊ РґСЂРѕР±РЅС‹РјРё (РќРѕС‡РЅРѕР№ РєРѕС‚ РІ В«Р‘Р°Р·РµВ» вЂ” 0.001%). randomInt РїСЂРёРЅРёРјР°РµС‚
      // С‚РѕР»СЊРєРѕ С†РµР»С‹Рµ Рё С‚РѕР»СЊРєРѕ РґРѕ 2^48в€’1, РїРѕСЌС‚РѕРјСѓ РґРѕР»Рё РїРµСЂРµРІРѕРґРёРј РІ С†РµР»С‹Рµ СЃ РѕР±С‰РёРј
      // РјР°СЃС€С‚Р°Р±РѕРј, Р° РґРёР°РїР°Р·РѕРЅ Р±РѕР»СЊС€Рµ РїСЂРµРґРµР»Р° СЂРµР¶РµРј РЅР° С‡Р°СЃС‚Рё: СЃСѓРјРјР° РІРµСЃРѕРІ РєРµР№СЃР°
      // В«РљРѕСЃРјРѕСЃВ» (672) РїРѕСЃР»Рµ РјР°СЃС€С‚Р°Р±Р° РґР°С‘С‚ 672В·10^12 Рё СЂРѕРЅСЏР»Р° РѕС‚РєСЂС‹С‚РёРµ
      // СЃ ERR_OUT_OF_RANGE.
      const weights = definition.rewards.map(reward => BigInt(Math.round(Number(reward.weight) * 1e12)));
      const total = weights.reduce((sum, weight) => sum + weight, 0n);
      if (total < 1n) return res.status(500).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РІРµСЃР° РєРµР№СЃР°' });
      // РЎР»СѓС‡Р°Р№РЅРѕРµ С‡РёСЃР»Рѕ РѕС‚ 0 РґРѕ totalв€’1. РџРѕРєР° РґРёР°РїР°Р·РѕРЅ Р±РѕР»СЊС€Рµ РїРѕС‚РѕР»РєР° randomInt,
      // Р±РµСЂС‘Рј СЃР»СѓС‡Р°Р№РЅС‹Р№ В«РєСѓСЃРѕРєВ» Рё РґРѕР±РёРІР°РµРј РѕСЃС‚Р°С‚РѕРє вЂ” РєР°Р¶РґС‹Р№ РєСѓСЃРѕРє СЂР°РІРЅРѕРІРµСЂРѕСЏС‚РµРЅ,
      // РїРѕСЌС‚РѕРјСѓ СЂР°СЃРїСЂРµРґРµР»РµРЅРёРµ РЅРµ СЃРјРµС‰Р°РµС‚СЃСЏ.
      const LIMIT = 281474976710655n; // 2^48 в€’ 1
      let roll = 0n;
      let span = total;
      while (span > LIMIT) {
        const parts = (span + LIMIT - 1n) / LIMIT;
        roll += BigInt(crypto.randomInt(Number(parts))) * (span / parts);
        span = span / parts;
      }
      roll += BigInt(crypto.randomInt(Number(span)));
      const reward = definition.rewards[weights.findIndex(weight => (roll -= weight) < 0n)];
      const key = reward.key;
      if (key.startsWith('rx-')) {
        // РЎРєРёРЅ СЂРµР°РєС†РёРё: РєРѕРїРёСЏ РёРґС‘С‚ РІ СЃС‡С‘С‚С‡РёРє, СЃР»РѕС‚С‹ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅР°СЃС‚СЂР°РёРІР°РµС‚ СЃР°Рј.
        drop = key;
        reactionSkins.grant(user, key);
      } else if (key.startsWith('pet-')) {
        drop = key;
        // Р”СѓР±Р»РёРєР°С‚ РЅРµ РїР»РѕРґРёС‚ РІС‚РѕСЂРѕРіРѕ РїРёС‚РѕРјС†Р° вЂ” РѕРЅ РёРґС‘С‚ РІ СЃС‡С‘С‚С‡РёРє РєРѕРїРёР№ (С€С‚.).
        // РЎС‚Р°СЂС‹Рµ id (pet-owl Рё С‚.Рї.) СЃС‡РёС‚Р°РµРј СѓР¶Рµ РЅРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅС‹РјРё.
        const alreadyOwned = (user.ownedPets || []).some(pid => normalizePetId(pid) === key);
        const stored = Math.floor(Number(user.petCounts?.[key]));
        const previous = Number.isSafeInteger(stored) && stored > 0 ? stored : (alreadyOwned ? 1 : 0);
        user.ownedPets = [...new Set([...(user.ownedPets || []), key])];
        user.petCounts = { ...user.petCounts, [key]: previous + 1 };
      } else {
        drop = `pack-${key}`;
        const parts = key.startsWith('r-') ? [`ring-${key}`, `selfcard-${key}`, `bubble-${key}`] : [`ring-pack-${key}`, `selfcard-pack-${key}`, `bubble-${key}`];
        user.ownedItems = [...new Set([...user.ownedItems, ...parts])];
        user.casePacks = { ...user.casePacks, [drop]: (user.casePacks?.[drop] || 0) + 1 };
      }
      user.lastCaseDrop = drop;
      counts[definition.id]--;
    }
    user.caseCounts = counts;
    try { saveDb(); } catch (error) {
      for (const key of Object.keys(user)) delete user[key];
      Object.assign(user, previous);
      return res.status(500).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РѕРїРµСЂР°С†РёСЋ' });
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
  yoomoney.registerYoomoney(app, { getDb: () => db, saveDb, authMiddleware, ensureWallet, pushWalletEmit, onTopupPaid: (user, amountVs) => grantReferralCashback(user, amountVs) });
}

// РЎРѕР·РґР°С‚СЊ РёРЅРІРѕР№СЃ РЅР° РїРѕРїРѕР»РЅРµРЅРёРµ (amount РІ Р’Рџ)
app.post('/api/wallet/topup', authMiddleware, async (req, res) => {
  const amount = Math.floor(Number(req.body?.amount));
  if (!isFinite(amount) || amount < VP_MIN_TOPUP || amount > VP_MAX_TOPUP) {
    return res.status(400).json({ message: `РЎСѓРјРјР° РїРѕРїРѕР»РЅРµРЅРёСЏ вЂ” РѕС‚ ${VP_MIN_TOPUP} РґРѕ ${VP_MAX_TOPUP} Р’Рџ` });
  }
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  if (!db.walletOrders) db.walletOrders = [];
  const order = {
    id: uuidv4(), userId: user.id,
    amountVs: amount,
    priceRub: Math.round((amount / VP_PER_RUB) * 100) / 100,
    status: 'waiting', createdAt: Date.now(),
  };
  db.walletOrders.push(order);
  // С‡РёСЃС‚РёРј СЃС‚Р°СЂС‹Рµ (СЃС‚Р°СЂС€Рµ СЃСѓС‚РѕРє) вЂ” РјСѓСЃРѕСЂ РЅРµ РєРѕРїРёРј
  db.walletOrders = db.walletOrders.filter(o => o.provider === 'yoomoney' || Date.now() - (o.createdAt || 0) < 24 * 60 * 60 * 1000);
  saveDb();

  // Mock-СЂРµР¶РёРј: РєР»СЋС‡Р° NOWPAYMENTS РµС‰С‘ РЅРµС‚
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
        order_description: `VERA вЂ” РїРѕРїРѕР»РЅРµРЅРёРµ РЅР° ${order.amountVs} Р’Рџ`,
        ipn_callback_url: `${base}/api/wallet/webhook`,
        success_url: `${base}?topup=ok`,
        cancel_url: `${base}`,
      }),
    });
    const js = await call.json();
    if (!js?.id || !js?.invoice_url) throw new Error(js?.message || 'NOWPayments РЅРµ РІРµСЂРЅСѓР» РёРЅРІРѕР№СЃ');
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
    return res.status(502).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РёРЅРІРѕР№СЃ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ.' });
  }
});

// РЎС‚Р°С‚СѓСЃ Р·Р°РєР°Р·Р° (РєР»РёРµРЅС‚ РїРѕР»Р»РёС‚ РєР°Р¶РґС‹Рµ ~4СЃ)
app.get('/api/wallet/orders/:orderId', authMiddleware, (req, res) => {
  const order = (db.walletOrders || []).find(o => o.id === req.params.orderId && o.userId === req.userId);
  if (!order) return res.status(404).json({ message: 'Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ' });
  res.json({ status: order.status, amountVs: order.amountVs, priceRub: order.priceRub });
});

// Webhook РѕС‚ NOWPayments (IPN) вЂ” РїСѓР±Р»РёС‡РЅС‹Р№
app.post('/api/wallet/webhook', (req, res) => {
  if (!NOWPAYMENTS_IPN_SECRET) return res.sendStatus(503);
  if (NOWPAYMENTS_IPN_SECRET) {
    const sig = req.headers['x-nowpayments-sig'];
    const calc = require('crypto').createHmac('sha512', NOWPAYMENTS_IPN_SECRET).update(req.rawBody || '').digest('hex');
    if (!sig || String(sig).toLowerCase() !== calc) return res.status(401).json({ error: 'bad signature' });
  }
  const body = req.body || {};
  const order = (db.walletOrders || []).find(o => vpOrderId(o) === body.order_id);
  if (!order || order.provider === 'yoomoney') return res.json({ ok: true }); // РЅРµ РЅР°С€ Р·Р°РєР°Р· вЂ” РёРіРЅРѕСЂРёСЂСѓРµРј
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
        grantReferralCashback(user, order.amountVs);
      }
    }
  }
  res.json({ ok: true });
});

// РњРћРљ-РѕРїР»Р°С‚Р° (С‚РѕР»СЊРєРѕ Р±РµР· NOWPAYMENTS_API_KEY) вЂ” РґР»СЏ С‚РµСЃС‚Р° РїРѕС‚РѕРєР° РїРѕРїРѕР»РЅРµРЅРёСЏ
app.post('/api/wallet/mock-pay', authMiddleware, (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.WALLET_ALLOW_MOCK !== 'true' || process.env.YOOMONEY_RECEIVER) return res.sendStatus(403);
  if (NOWPAYMENTS_API_KEY) return res.status(400).json({ message: 'Mock-РѕРїР»Р°С‚Р° РѕС‚РєР»СЋС‡РµРЅР° (РєР»СЋС‡ NOWPAYMENTS Р·Р°РґР°РЅ)' });
  const order = (db.walletOrders || []).find(o => o.id === req.body?.orderId && o.userId === req.userId);
  if (!order) return res.status(404).json({ message: 'Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ' });
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  if (order.status !== 'paid') {
    user.walletBalance = (user.walletBalance || 0) + order.amountVs;
    order.status = 'paid'; order.paidAt = Date.now();
    saveDb();
    pushWalletEmit(user);
    grantReferralCashback(user, order.amountVs);
  }
  res.json({ ok: true, balance: user.walletBalance });
});

// РљСѓРїРёС‚СЊ РїР»Р°С‚РЅС‹Р№ С‚РѕРІР°СЂ (СЃРїРёСЃР°РЅРёРµ СЃ Р±Р°Р»Р°РЅСЃР° Р’Рџ)
app.post('/api/shop/buy', authMiddleware, (req, res) => {
  const itemId = String(req.body?.itemId || '');
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  if (user.ownedItems.includes(itemId)) return res.json({ ok: true, already: true, balance: user.walletBalance, ownedItems: user.ownedItems });
  // Р‘РµСЃРїР»Р°С‚РЅРѕ: dev-IP Рё РЅР°СЃС‚СЂРѕРµРЅРЅС‹Рµ Р°РґРјРёРЅС‹ вЂ” СЂРµР¶РёРј РїСЂРѕРІРµСЂРєРё РїСЂРѕРґСѓРєС‚Р°.
  const devFree = isAdminReq(req);

  // РљР°СЃС‚РѕРјРЅС‹Рµ РїСЂРµРґРјРµС‚С‹ РѕС‚ Р°РІС‚РѕСЂРѕРІ: id РІРёРґР° "custom:<uuid>"
  if (itemId.startsWith('custom:')) {
    const cid = itemId.slice(7);
    const item = (db.customItems || []).find(i => i.id === cid);
    if (!item) return res.status(400).json({ message: 'РљР°СЃС‚РѕРјРЅС‹Р№ С‚РѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ' });
    if (item.status !== 'published') return res.status(400).json({ message: 'РўРѕРІР°СЂ РЅРµРґРѕСЃС‚СѓРїРµРЅ' });
    const price = Number(item.price) || 0;
    if (!devFree && (user.walletBalance || 0) < price) {
      return res.status(400).json({ message: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р’Рџ. РќСѓР¶РЅРѕ ${price} Р’Рџ вЂ” РїРѕРїРѕР»РЅРёС‚Рµ Р±Р°Р»Р°РЅСЃ.` });
    }
    if (!devFree) user.walletBalance -= price;
    user.ownedItems.push(itemId);
    // Р Р°Р·РґРµР»РµРЅРёРµ 85/15
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

  // РћР±С‹С‡РЅС‹Р№ РєР°С‚Р°Р»РѕР¶РЅС‹Р№ С‚РѕРІР°СЂ
  const price = getShopItemPrice(itemId);
  if (price === undefined) return res.status(400).json({ message: 'РўРѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ' });
  if (!devFree && (user.walletBalance || 0) < price) return res.status(400).json({ message: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р’Рџ. РќСѓР¶РЅРѕ ${price} Р’Рџ вЂ” РїРѕРїРѕР»РЅРёС‚Рµ Р±Р°Р»Р°РЅСЃ.` });
  if (!devFree) user.walletBalance -= price;
  user.ownedItems.push(itemId);
  saveDb();
  pushWalletEmit(user);
  res.json({ ok: true, balance: user.walletBalance, ownedItems: user.ownedItems });
});


// в”Ђв”Ђв”Ђ CREATOR / CUSTOM SHOP ITEMS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Shared skin marketplace. Listings hold the item in escrow until cancellation or sale.
app.get('/api/market', authMiddleware, (req, res) => {
  res.json({ listings: marketListingViews(req.userId) });
});

function commitMarket(res, mutate) {
  const before = JSON.stringify(db);
  try { mutate(); saveDb(); return true; } catch {
    db = JSON.parse(before);
    res.status(500).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РѕРїРµСЂР°С†РёСЋ' });
    return false;
  }
}

app.post('/api/market/list', authMiddleware, (req, res) => {
  const { itemId, price } = req.body || {};
  if (!Number.isSafeInteger(price) || price < MARKET_MIN_PRICE_VP || price > MARKET_MAX_PRICE_VP) {
    return res.status(400).json({ message: 'Р¦РµРЅР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ С†РµР»С‹Рј С‡РёСЃР»РѕРј РѕС‚ 6 РґРѕ 100000000 Р’Рџ' });
  }
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  if (!isTradableItemId(itemId) || !userOwnsItem(user, itemId) || lockedItemIdsForSeller(user.id).has(itemId)) {
    return res.status(409).json({ message: 'РџСЂРµРґРјРµС‚ РЅРµРґРѕСЃС‚СѓРїРµРЅ РґР»СЏ РїСЂРѕРґР°Р¶Рё' });
  }
  const listing = { id: uuidv4(), itemId, price, sellerId: user.id, createdAt: Date.now() };
  if (!commitMarket(res, () => {
    db.marketListings.push(listing);
    removeItemFromUser(user, itemId);
    if (!isPetId(itemId)) {
      for (const slot of ['activeRing', 'activeSelfCard', 'activeBubble']) {
        if (user[slot] === itemId) user[slot] = '';
        const shop = db.userStores?.[user.id]?.shop?.data;
        if (shop?.[slot] === itemId) shop[slot] = '';
      }
    }
  })) return;
  pushWalletEmit(user);
  emitPetsUpdated(user);
  emitMarketUpdated();
  res.json({ listing: marketListingView(listing, user.id), balance: user.walletBalance });
});

for (const action of ['cancel', 'buy']) {
  app.post(`/api/market/:id/${action}`, authMiddleware, (req, res) => {
    const listing = db.marketListings.find(l => l.id === req.params.id);
    if (!listing) return res.status(404).json({ message: 'РћР±СЉСЏРІР»РµРЅРёРµ СѓР¶Рµ СЃРЅСЏС‚Рѕ РёР»Рё РїСЂРѕРґР°РЅРѕ' });
    const user = ensureWallet(db.users.find(u => u.id === req.userId));
    const seller = ensureWallet(db.users.find(u => u.id === listing.sellerId));
    if (!user || !seller) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
    if ((action === 'cancel') !== (user.id === seller.id)) return res.status(403).json({ message: 'РћРїРµСЂР°С†РёСЏ РЅРµРґРѕСЃС‚СѓРїРЅР°' });
    const share = Math.floor(listing.price * MARKET_SELLER_SHARE / 100);
    if (action === 'buy' && (userOwnsItem(user, listing.itemId) || lockedItemIdsForSeller(user.id).has(listing.itemId))) {
      return res.status(409).json({ message: 'РЈ РІР°СЃ СѓР¶Рµ РµСЃС‚СЊ СЌС‚РѕС‚ РїСЂРµРґРјРµС‚' });
    }
    if (action === 'buy' && (!Number.isSafeInteger(listing.price) || listing.price < MARKET_MIN_PRICE_VP || user.walletBalance < listing.price || !Number.isSafeInteger(seller.walletBalance + share))) {
      return res.status(409).json({ message: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р’Рџ РёР»Рё РЅРµРґРѕРїСѓСЃС‚РёРјР°СЏ С†РµРЅР°' });
    }
    if (!commitMarket(res, () => {
      db.marketListings = db.marketListings.filter(l => l.id !== listing.id);
      grantItemToUser(user, listing.itemId);
      if (action === 'buy') {
        user.walletBalance -= listing.price;
        seller.walletBalance += share;
        db.platformRevenueVp = (db.platformRevenueVp || 0) + listing.price - share;
      }
    })) return;
    pushWalletEmit(user);
    if (user !== seller) pushWalletEmit(seller);
    emitPetsUpdated(user);
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
 * РЎР°РЅРёС‚Р°Р№Р·РµСЂ СЃРїРµС†РёС„РёРєР°С†РёРё РєР°СЃС‚РѕРјРЅРѕРіРѕ РїСЂРµРґРјРµС‚Р°.
 * РўРѕР»СЊРєРѕ С‚РёРїРёР·РёСЂРѕРІР°РЅРЅС‹Рµ РїРѕР»СЏ вЂ” РЅРё СЃС‚СЂРѕРє CSS, РЅРё HTML, РЅРё url().
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
    res.status(502).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РёРЅРІРѕР№СЃ.' });
  }
});

app.post('/api/creator/mock-pay-fee', authMiddleware, (req, res) => {
  if (NOWPAYMENTS_API_KEY) return res.status(400).json({ message: 'Mock РѕС‚РєР»СЋС‡С‘РЅ' });
  const order = (db.walletOrders || []).find(o => o.id === req.body?.orderId && o.userId === req.userId && o.kind === 'creator-fee');
  if (!order) return res.status(404).json({ message: 'Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ' });
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
  if (!canCreate(req, req.userId)) return res.status(402).json({ message: 'РЎРЅР°С‡Р°Р»Р° РѕРїР»Р°С‚РёС‚Рµ РІР·РЅРѕСЃ Р°РІС‚РѕСЂР° (200в‚Ѕ).' });
  const clean = sanitizeItem(req.body);
  if (!clean.name) return res.status(400).json({ message: 'РќР°Р·РІР°РЅРёРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ.' });
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
  if (!item) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  if (item.authorId !== req.userId) return res.status(403).json({ message: 'РќРµ РІР°С€ РїСЂРµРґРјРµС‚' });
  if (item.status !== 'draft' && !isAdminReq(req)) return res.status(400).json({ message: 'РЎРЅРёРјРёС‚Рµ СЃ РїСѓР±Р»РёРєР°С†РёРё РїРµСЂРµРґ СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёРµРј.' });
  const clean = sanitizeItem({ ...item, ...req.body });
  Object.assign(item, clean);
  saveDb();
  res.json({ item });
});

app.post('/api/creator/items/:id/publish', authMiddleware, (req, res) => {
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  if (item.authorId !== req.userId && !isAdminReq(req)) return res.status(403).json({ message: 'РќРµ РІР°С€ РїСЂРµРґРјРµС‚' });
  if (!canCreate(req, item.authorId)) return res.status(402).json({ message: 'Р’Р·РЅРѕСЃ Р°РІС‚РѕСЂР° РЅРµ РѕРїР»Р°С‡РµРЅ.' });
  if (!item.name) return res.status(400).json({ message: 'РќР°Р·РІР°РЅРёРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ.' });
  item.status = 'published'; item.publishedAt = Date.now();
  saveDb();
  res.json({ item });
});

app.post('/api/creator/items/:id/unpublish', authMiddleware, (req, res) => {
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  if (item.authorId !== req.userId && !isAdminReq(req)) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ' });
  item.status = 'draft';
  saveDb();
  res.json({ item });
});

app.delete('/api/creator/items/:id', authMiddleware, (req, res) => {
  const idx = (db.customItems || []).findIndex(i => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  const item = db.customItems[idx];
  if (item.authorId !== req.userId && !isAdminReq(req)) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ' });
  if (item.status === 'published' && !isAdminReq(req)) return res.status(400).json({ message: 'РЎРЅР°С‡Р°Р»Р° СЃРЅРёРјРёС‚Рµ СЃ РїСѓР±Р»РёРєР°С†РёРё.' });
  db.customItems.splice(idx, 1);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/creator/items/:id/hide', authMiddleware, (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'РўРѕР»СЊРєРѕ Р°РґРјРёРЅ' });
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  item.status = 'hidden'; item.hiddenAt = Date.now();
  saveDb();
  res.json({ item });
});
app.post('/api/creator/items/:id/restore', authMiddleware, (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'РўРѕР»СЊРєРѕ Р°РґРјРёРЅ' });
  const item = (db.customItems || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  item.status = 'published';
  saveDb();
  res.json({ item });
});

// РџСѓР±Р»РёС‡РЅС‹Р№ СЃРїРёСЃРѕРє РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅС‹С… РєР°СЃС‚РѕРјРЅС‹С… РїСЂРµРґРјРµС‚РѕРІ
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




// в”Ђв”Ђв”Ђ CHATS routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// GET /api/chats
// PERF: РїРѕСЃР»РµРґРЅРµРµ СЃРѕРѕР±С‰РµРЅРёРµ С‡Р°С‚Р° Р±РµР· СЃРѕСЂС‚РёСЂРѕРІРєРё РІСЃРµР№ РёСЃС‚РѕСЂРёРё.
// Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ СЃС‚РѕСЏР»Рѕ db.messages.filter(...).sort(...)[0] вЂ” СЌС‚Рѕ O(m log m) РЅР°
// РєР°Р¶РґС‹Р№ РІС‹Р·РѕРІ. РћРґРёРЅ РїСЂРѕС…РѕРґ СЃ СЃСЂР°РІРЅРµРЅРёРµРј РјРµС‚РѕРє РІСЂРµРјРµРЅРё РґР°С‘С‚ С‚РѕС‚ Р¶Рµ СЂРµР·СѓР»СЊС‚Р°С‚
// (РїСЂРё СЂР°РІРЅС‹С… РјРµС‚РєР°С… РїРѕР±РµР¶РґР°РµС‚ РїРµСЂРІРѕРµ, РєР°Рє РїСЂРё СЃС‚Р°Р±РёР»СЊРЅРѕР№ СЃРѕСЂС‚РёСЂРѕРІРєРµ).
function lastMessageOf(chatId, isChannel) {
  let best = null;
  let bestTs = -Infinity;
  for (const msg of db.messages) {
    if (msg.chatId !== chatId) continue;
    if (isChannel && msg.replyToId) continue;
    const ts = Date.parse(msg.createdAt) || 0;
    if (!best || ts > bestTs) { best = msg; bestTs = ts; }
  }
  return best;
}

app.get('/api/chats', authMiddleware, (req, res) => {
  const myMemberships = db.chatMembers.filter(m => m.userId === req.userId);
  const myChatIds = new Set(myMemberships.map(m => m.chatId));

  // PERF: СЂР°РЅСЊС€Рµ РґР»СЏ РљРђР–Р”РћР“Рћ С‡Р°С‚Р° РІС‹РїРѕР»РЅСЏР»РѕСЃСЊ РїРѕ РґРІР° РїРѕР»РЅС‹С… РїСЂРѕС…РѕРґР° РїРѕ РІСЃРµРј
  // СЃРѕРѕР±С‰РµРЅРёСЏРј, Р° РїРѕСЃР»РµРґРЅРµРµ СЃРѕРѕР±С‰РµРЅРёРµ РµС‰С‘ Рё СЃРѕСЂС‚РёСЂРѕРІР°Р»РѕСЃСЊ С†РµР»РёРєРѕРј. РќР° 50 С‡Р°С‚Р°С…
  // Рё 50k СЃРѕРѕР±С‰РµРЅРёР№ СЌС‚Рѕ РјРёР»Р»РёРѕРЅС‹ РёС‚РµСЂР°С†РёР№ РЅР° РєР°Р¶РґС‹Р№ Р·Р°РїСЂРѕСЃ СЃРїРёСЃРєР° С‡Р°С‚РѕРІ.
  // РўРµРїРµСЂСЊ РѕРґРёРЅ РїСЂРѕС…РѕРґ СЃС‡РёС‚Р°РµС‚ lastMessage Рё unreadCount СЃСЂР°Р·Сѓ РґР»СЏ РІСЃРµС… С‡Р°С‚РѕРІ,
  // Р° СѓС‡Р°СЃС‚РЅРёРєРё/РїРѕР»СЊР·РѕРІР°С‚РµР»Рё Р±РµСЂСѓС‚СЃСЏ РёР· Map РІРјРµСЃС‚Рѕ find() РїРѕ РјР°СЃСЃРёРІСѓ.
  const chatsById = new Map(db.chats.map(c => [c.id, c]));
  const lastByChat = new Map();
  const unreadByChat = new Map();
  for (const msg of db.messages) {
    const chatId = msg.chatId;
    if (!myChatIds.has(chatId)) continue;
    if (!msg.replyToId || chatsById.get(chatId)?.type !== 'channel') {
      const ts = Date.parse(msg.createdAt) || 0;
      const current = lastByChat.get(chatId);
      if (!current || ts > current.ts) lastByChat.set(chatId, { ts, msg });
    }
    if (!msg.readBy?.includes(req.userId) && msg.senderId !== req.userId) {
      unreadByChat.set(chatId, (unreadByChat.get(chatId) || 0) + 1);
    }
  }
  const membersByChat = new Map();
  for (const cm of db.chatMembers) {
    const list = membersByChat.get(cm.chatId);
    if (list) list.push(cm); else membersByChat.set(cm.chatId, [cm]);
  }
  const usersById = new Map(db.users.map(u => [u.id, u]));

  const chats = myMemberships.map(m => {
    const chat = chatsById.get(m.chatId);
    if (!chat) return null;
    // Р’РѕР·РІСЂР°С‰Р°РµРј members РІ С„РѕСЂРјР°С‚Рµ ChatMember (СЃ role Рё РІР»РѕР¶РµРЅРЅС‹Рј user)
    const members = (membersByChat.get(chat.id) || []).map(cm => ({
      id: cm.id, chatId: cm.chatId, userId: cm.userId,
      role: cm.role || 'member', permissions: cm.permissions, adminTitle: cm.adminTitle, promotedBy: cm.promotedBy,
      joinedAt: cm.joinedAt, isMuted: cm.muted || false,
      user: usersById.get(cm.userId) || null, skins: cm.skins,
    }));
    return {
      ...chat,
      pinnedMessageIds: pinnedMessageIds(chat),
      pinnedMessage: getPinnedMessage(chat),
      pinnedMessages: pinnedMessageList(chat),
      type: chat.type || 'direct',
      members,
      lastMessage: lastByChat.get(chat.id)?.msg || null,
      unreadCount: unreadByChat.get(chat.id) || 0,
    };
  }).filter(Boolean);

  chats.sort((a, b) => {
    // 1) Р·Р°РєСЂРµРїР»С‘РЅРЅС‹Рµ РІС‹С€Рµ
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    // 2) СЃ РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹РјРё вЂ” РІС‹С€Рµ РїСЂРѕС‡РёС‚Р°РЅРЅС‹С…
    const au = (a.unreadCount || 0) > 0 ? 1 : 0;
    const bu = (b.unreadCount || 0) > 0 ? 1 : 0;
    if (au !== bu) return bu - au;
    // 3) С‡РµРј РЅРѕРІРµРµ Р°РєС‚РёРІРЅРѕСЃС‚СЊ РіСЂСѓРїРїС‹ вЂ” С‚РµРј РІС‹С€Рµ.
    // РџСЂР°РІРєР° РґРѕСЃРєРё Рё С…РѕР»СЃС‚Р° РїРѕРґРЅРёРјР°РµС‚ chat.updatedAt, РЅРѕ РЅРµ СЃРѕР·РґР°С‘С‚ СЃРѕРѕР±С‰РµРЅРёРµ: Р±РµР· РјР°РєСЃРёРјСѓРјР°
    // РѕРЅРѕ РЅРµ РїРѕРґРЅСЏР»Рѕ Р±С‹ РѕР±С‹С‡РЅС‹Р№ С‡Р°С‚ СЃРѕ СЃРІРµР¶РёРј СЃРѕРѕР±С‰РµРЅРёРµРј РІРЅРёР·Сѓ.
    const ta = Math.max(Date.parse(a.lastMessage?.createdAt) || 0, Date.parse(a.updatedAt) || 0, Date.parse(a.createdAt) || 0);
    const tb = Math.max(Date.parse(b.lastMessage?.createdAt) || 0, Date.parse(b.updatedAt) || 0, Date.parse(b.createdAt) || 0);
    return tb - ta;
  });
  res.json(chats);
});

// POST /api/chats/direct
app.post('/api/chats/direct', authMiddleware, (req, res) => {
  const { targetUserId } = req.body;
  const targetUser = db.users.find(u => u.id === targetUserId);
  if (!targetUser) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });

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
      user: db.users.find(u => u.id === m.userId) || null, skins: m.skins,
    }));
    // РЎР°РјРѕРёСЃС†РµР»РµРЅРёРµ: СѓС‡Р°СЃС‚РЅРёРєРё РјРѕРіР»Рё РѕС‚РєСЂС‹С‚СЊ РїСЂРёР»РѕР¶РµРЅРёРµ Р”Рћ СЃРѕР·РґР°РЅРёСЏ С‡Р°С‚Р° вЂ”
    // С‚РѕРіРґР° РёС… СЃРѕРєРµС‚С‹ РЅРµ СЃРѕСЃС‚РѕСЏР»Рё РІ socket-РєРѕРјРЅР°С‚Рµ `chat:<id>`. РЎР°Р¶Р°РµРј
    // СЃРѕРєРµС‚С‹ РІ РєРѕРјРЅР°С‚Сѓ Рё С€Р»С‘Рј СЃРѕР±С‹С‚РёРµ Р»РёС‡РЅРѕ РєР°Р¶РґРѕРјСѓ СѓС‡Р°СЃС‚РЅРёРєСѓ.
    // typeof вЂ” РїРѕС‚РѕРјСѓ С‡С‚Рѕ vm-С‚РµСЃС‚С‹ СЃРµСЂРІРµСЂР° РІС‹СЂРµР·Р°СЋС‚ СЌС‚РѕС‚ РєСѓСЃРѕРє Р±РµР·
    // РѕР±СЉСЏРІР»РµРЅРёСЏ userSockets.
    if (typeof userSockets !== 'undefined') {
      for (const uid of [req.userId, targetUserId]) {
        for (const sid of userSockets.get(uid) || []) {
          io.to(sid).socketsJoin?.(`chat:${chat.id}`);
          io.to(sid).emit('chat:updated', { ...chat, type: chat.type || 'direct', members });
        }
      }
    }
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
    user: db.users.find(u => u.id === m.userId) || null, skins: m.skins,
  }));
  const payload = { ...chat, members };
  // РќРѕРІС‹Р№ direct-С‡Р°С‚: СѓС‡Р°СЃС‚РЅРёРєРё РµС‰С‘ РЅРµ РІ РµРіРѕ socket-РєРѕРјРЅР°С‚Рµ (РµС‘ РґР¶РѕР№РЅСЏС‚ РїСЂРё
  // РєРѕРЅРЅРµРєС‚Рµ РёР»Рё РѕС‚РєСЂС‹С‚РёРё С‡Р°С‚Р°), РїРѕСЌС‚РѕРјСѓ СЃРѕРѕР±С‰Р°РµРј СЃРѕР±РµСЃРµРґРЅРёРєСѓ РІР¶РёРІСѓСЋ Рё СЃСЂР°Р·Сѓ
  // СЃР°Р¶Р°РµРј СЃРѕРєРµС‚С‹ РѕР±РѕРёС… РІ РєРѕРјРЅР°С‚Сѓ вЂ” РёРЅР°С‡Рµ СЃРѕР±РµСЃРµРґРЅРёРє СѓРІРёРґРёС‚ С‡Р°С‚ Рё РїРµСЂРІРѕРµ
  // СЃРѕРѕР±С‰РµРЅРёРµ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ РїРµСЂРµР·Р°РіСЂСѓР·РєРё СЃС‚СЂР°РЅРёС†С‹.
  if (typeof userSockets !== 'undefined') {
    for (const uid of [req.userId, targetUserId]) {
      for (const sid of userSockets.get(uid) || []) {
        io.to(sid).socketsJoin?.(`chat:${chat.id}`);
        io.to(sid).emit('chat:updated', payload);
      }
    }
  }
  res.json(payload);
});

// POST /api/chats/group
/**
 * Р Р°Р·РѕР±СЂР°С‚СЊ СЃР»СѓР¶РµР±РЅС‹Р№ СЃРёРјРІРѕР» РІ РЅР°С‡Р°Р»Рµ РЅР°Р·РІР°РЅРёСЏ РїСЂРё СЃРѕР·РґР°РЅРёРё С‡Р°С‚Р°.
 *
 * В«!РќРѕРІРѕСЃС‚РёВ» вЂ” РїСѓР±Р»РёС‡РЅС‹Р№ РєР°РЅР°Р», В«/desk Р”РµР»РѕВ» вЂ” РґРѕСЃРєР°, В«/canvas Р РёСЃСѓРЅРєРёВ» вЂ” С…РѕР»СЃС‚.
 * РљРѕРјР°РЅРґР° Р·Р°РґР°С‘С‚ РІРёРґ С‡Р°С‚Р° С‚РѕР»СЊРєРѕ РѕРґРёРЅ СЂР°Р·, РїСЂРё СЃРѕР·РґР°РЅРёРё, Рё РІ РЅР°Р·РІР°РЅРёРµ РЅРµ
 * РїРѕРїР°РґР°РµС‚: РґР°Р»СЊС€Рµ РІРёРґ С…СЂР°РЅРёС‚СЃСЏ РѕС‚РґРµР»СЊРЅРѕ (type / kind), Рё РїРµСЂРµРёРјРµРЅРѕРІР°РЅРёРµ РµРіРѕ
 * РЅРµ РјРµРЅСЏРµС‚. В«/С…РѕР»СЃС‚В» РёР»Рё В«/deskxВ» вЂ” РЅРµ РєРѕРјР°РЅРґР°, Р° РѕР±С‹С‡РЅРѕРµ РЅР°Р·РІР°РЅРёРµ.
 */
function splitChatKindPrefix(raw) {
  const text = String(raw || '').trim();
  if (text.startsWith('!')) return { kind: 'channel', name: text.replace(/^!+/, '').trim() };
  const command = /^\/(desk|canvas)(?=\s|$)/i.exec(text);
  if (command) {
    return { kind: command[1].toLowerCase() === 'desk' ? 'desk' : 'whiteboard', name: text.slice(command[0].length).trim() };
  }
  return { kind: null, name: text };
}

/** РЎС‚Р°СЂС‹Рµ РјР°СЂРєРµСЂС‹ РґР»СЏ РјРёРіСЂР°С†РёРё: СЂР°РЅСЊС€Рµ В«|В» Р·РЅР°С‡РёР» РґРѕСЃРєСѓ, Р° В«/В» вЂ” С…РѕР»СЃС‚. */
function splitLegacyChatKindPrefix(raw) {
  const parsed = splitChatKindPrefix(raw);
  if (parsed.kind) return parsed;
  const text = String(raw || '').trim();
  const kind = text.startsWith('|') ? 'desk' : text.startsWith('/') ? 'whiteboard' : null;
  if (!kind) return parsed;
  return { kind, name: text.replace(/^[|/\s]+/, '').trim() };
}

// Р¤СѓРЅРєС†РёСЏ, Р° РЅРµ const: migrateChatKinds() РІС‹Р·С‹РІР°РµС‚СЃСЏ РїСЂРё СЃС‚Р°СЂС‚Рµ (РІС‹С€Рµ РїРѕ С„Р°Р№Р»Сѓ),
// Рё РѕР±СЂР°С‰РµРЅРёРµ Рє const РґРѕ РµРіРѕ РѕР±СЉСЏРІР»РµРЅРёСЏ СЂРѕРЅСЏР»Рѕ СЃРµСЂРІРµСЂ (TDZ ReferenceError)
// РЅР° Р»СЋР±РѕРј СЃС‚Р°СЂРѕРј С‡Р°С‚Рµ СЃ РїСѓСЃС‚С‹Рј РЅР°Р·РІР°РЅРёРµРј РїРѕСЃР»Рµ СЃРёРјРІРѕР»Р°, РЅР°РїСЂРёРјРµСЂ В«/В».
function defaultChatNameByKind(kind) {
  return kind === 'channel' ? 'РљР°РЅР°Р»' : kind === 'desk' ? 'Р”РѕСЃРєР°' : kind === 'whiteboard' ? 'РҐРѕР»СЃС‚' : '';
}

/**
 * РћРґРЅРѕСЂР°Р·РѕРІР°СЏ РјРёРіСЂР°С†РёСЏ СЃС‚Р°СЂС‹С… С‡Р°С‚РѕРІ: СЂР°РЅСЊС€Рµ РІРёРґ С‡Р°С‚Р° С‡РёС‚Р°Р»СЃСЏ РёР· РЅР°Р·РІР°РЅРёСЏ
 * РЅР° Р»РµС‚Сѓ (В«!РќРѕРІРѕСЃС‚РёВ», В«| Р”РµР»РѕВ», В«/ РҐРѕР»СЃС‚В»). РџРµСЂРµРЅРѕСЃРёРј РµРіРѕ РІ РїРѕР»Рµ Рё СЃСЂРµР·Р°РµРј
 * СЃРёРјРІРѕР» РёР· РЅР°Р·РІР°РЅРёСЏ. Р’РµСЂСЃРёСЏ РЅСѓР¶РЅР°, С‡С‚РѕР±С‹ РЅРѕРІР°СЏ РіСЂСѓРїРїР°, РєРѕС‚РѕСЂСѓСЋ РЅР°Р·РІР°Р»Рё
 * В«| С‡С‚Рѕ-С‚РѕВ» СѓР¶Рµ РїРѕСЃР»Рµ РјРёРіСЂР°С†РёРё, РЅРµ РїСЂРµРІСЂР°С‚РёР»Р°СЃСЊ РІ РґРѕСЃРєСѓ РїСЂРё СЂРµСЃС‚Р°СЂС‚Рµ.
 */
function migrateChatKinds() {
  if (Number(db.chatKindMigrationVersion || 0) >= 1) return false;
  for (const chat of db.chats || []) {
    if (!chat || (chat.type !== 'group' && chat.type !== 'channel')) continue;
    const parsed = splitLegacyChatKindPrefix(chat.name);
    if (!parsed.kind) continue;
    if (chat.type === 'channel') {
      if (parsed.kind !== 'channel') continue;
    } else if (parsed.kind === 'desk' || parsed.kind === 'whiteboard') {
      if (!chat.kind) chat.kind = parsed.kind;
    } else {
      continue;
    }
    chat.name = parsed.name || defaultChatNameByKind(parsed.kind);
  }
  db.chatKindMigrationVersion = 1;
  return true;
}

app.post('/api/chats/group', authMiddleware, (req, res) => {
  const { name, memberIds } = req.body;
  const parsed = splitChatKindPrefix(name);
  const isChannel = parsed.kind === 'channel';
  const boardKind = parsed.kind === 'desk' || parsed.kind === 'whiteboard' ? parsed.kind : null;
  const chat = {
    id: uuidv4(),
    type: isChannel ? 'channel' : 'group',
    name: parsed.name || defaultChatNameByKind(parsed.kind) || 'Р“СЂСѓРїРїР°',
    ...(boardKind ? { kind: boardKind } : {}),
    ownerId: req.userId,
    isPublic: isChannel,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    pinnedMessageId: null,
  };
  db.chats.push(chat);
  const allMembers = [req.userId, ...(memberIds || [])].filter((v, i, a) => a.indexOf(v) === i);
  for (const uid of allMembers) {
    // РЎРѕР·РґР°С‚РµР»СЊ РїРѕР»СѓС‡Р°РµС‚ СЂРѕР»СЊ 'owner', РѕСЃС‚Р°Р»СЊРЅС‹Рµ вЂ” 'member'
    db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: uid, role: uid === req.userId ? 'owner' : 'member', joinedAt: new Date().toISOString() });
  }
  saveDb();
  // Р’РѕР·РІСЂР°С‰Р°РµРј members СЃ СЂРѕР»СЏРјРё (С„РѕСЂРјР°С‚ ChatMember)
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role, permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
    joinedAt: m.joinedAt,
    user: db.users.find(u => u.id === m.userId) || null, skins: m.skins,
  }));
  const payload = { ...chat, members };
  // РљР°Рє РІ direct-С‡Р°С‚Рµ: СѓС‡Р°СЃС‚РЅРёРєРё РјРѕРіР»Рё РѕС‚РєСЂС‹С‚СЊ РїСЂРёР»РѕР¶РµРЅРёРµ РґРѕ СЃРѕР·РґР°РЅРёСЏ РіСЂСѓРїРїС‹ вЂ”
  // РёС… СЃРѕРєРµС‚С‹ РЅРµ РІ РєРѕРјРЅР°С‚Рµ `chat:<id>`, РїРѕСЌС‚РѕРјСѓ СЃР°Р¶Р°РµРј РІ РєРѕРјРЅР°С‚Сѓ Рё С€Р»С‘Рј
  // СЃРѕР±С‹С‚РёРµ Р»РёС‡РЅРѕ РєР°Р¶РґРѕРјСѓ. typeof вЂ” РґР»СЏ vm-С‚РµСЃС‚РѕРІ Р±РµР· userSockets.
  if (typeof userSockets !== 'undefined') {
    for (const uid of allMembers) {
      for (const sid of userSockets.get(uid) || []) {
        io.to(sid).socketsJoin?.(`chat:${chat.id}`);
        io.to(sid).emit('chat:updated', payload);
      }
    }
  }
  res.json(payload);
});

// POST /api/chats/channel
app.post('/api/chats/channel', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  const chat = {
    id: uuidv4(),
    type: 'channel',
    name: String(name || '').trim().replace(/^!+/, '').trim() || 'РљР°РЅР°Р»',
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
    user: db.users.find(u => u.id === m.userId) || null, skins: m.skins,
  }));
  res.json({ ...chat, members });
});

// PATCH /api/chats/:id/archive
app.patch('/api/chats/:id/archive', authMiddleware, (req, res) => {
  const member = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  member.archived = req.body.archived !== false;
  saveDb();
  res.json({ success: true, archived: member.archived });
});

// PATCH /api/chats/:id/pin
app.patch('/api/chats/:id/pin', authMiddleware, (req, res) => {
  const member = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  member.pinned = req.body.pinned !== false;
  saveDb();
  res.json({ success: true, pinned: member.pinned });
});

// PATCH /api/chats/:id/mute
app.patch('/api/chats/:id/mute', authMiddleware, (req, res) => {
  const member = db.chatMembers.find(m => m.chatId === req.params.id && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  member.muted = req.body.muted !== false;
  saveDb();
  res.json({ success: true, muted: member.muted });
});

// GET /api/chats/:id
app.get('/api/channels/search', authMiddleware, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q.startsWith('!') || q.length < 2) return res.json([]);
  // В«!В» вЂ” С‚РѕР»СЊРєРѕ РїСЂРёР·РЅР°Рє РїРѕРёСЃРєР° РєР°РЅР°Р»РѕРІ; РІ РЅР°Р·РІР°РЅРёСЏС… РєР°РЅР°Р»РѕРІ РµРіРѕ Р±РѕР»СЊС€Рµ РЅРµС‚.
  const term = q.replace(/^!+/, '').trim();
  if (!term) return res.json([]);
  res.json(db.chats.filter(c => c.type === 'channel' && c.isPublic && String(c.name || '').toLowerCase().includes(term))
    .slice(0, 30).map(c => ({ id: c.id, name: c.name, avatarUrl: c.avatarUrl, description: c.description })));
});

app.post('/api/channels/:id/join', authMiddleware, (req, res) => {
  const chat = db.chats.find(c => c.id === req.params.id && c.type === 'channel' && c.isPublic);
  if (!chat) return res.status(404).json({ message: 'РљР°РЅР°Р» РЅРµ РЅР°Р№РґРµРЅ' });
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
  const currentUser = db.users.find(u => u.id === req.userId);
  const isAdmin = currentUser?.isAdmin === true;
  
  // Р”РѕСЃС‚СѓРї С‚РѕР»СЊРєРѕ СѓС‡Р°СЃС‚РЅРёРєР°Рј С‡Р°С‚Р° РёР»Рё РіР»РѕР±Р°Р»СЊРЅС‹Рј Р°РґРјРёРЅР°Рј
  if (!isMember && !isAdmin) {
    return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  }
  
  const chat = db.chats.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ message: 'Р§Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });
  const members = db.chatMembers.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role || 'member', permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
    joinedAt: m.joinedAt, isMuted: m.muted || false,
    user: db.users.find(u => u.id === m.userId) || null, skins: m.skins,
  }));
  const lastMsg = lastMessageOf(chat.id, false);
  const unreadCount = db.messages.reduce((acc, msg) => acc + (
    msg.chatId === chat.id && !msg.readBy?.includes(req.userId) && msg.senderId !== req.userId ? 1 : 0
  ), 0);
  res.json({ ...chat, type: chat.type || 'direct', members, lastMessage: lastMsg, unreadCount });
});

// POST /api/chats/:id/language-correction вЂ” СЌРєСЃРїРµСЂРёРјРµРЅС‚Р°Р»СЊРЅР°СЏ РєРѕСЂСЂРµРєС†РёСЏ С‡РµСЂРЅРѕРІРёРєР°.
// РљРѕРЅС‚РµРєСЃС‚ Р±РµСЂС‘С‚СЃСЏ С‚РѕР»СЊРєРѕ РёР· СЌС‚РѕРіРѕ С‡Р°С‚Р° Рё РЅРёРєРѕРіРґР° РЅРµ СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ РєР°Рє СЃРѕРѕР±С‰РµРЅРёРµ.
app.post('/api/chats/:id/language-correction', authMiddleware, async (req, res) => {
  const chatId = req.params.id;
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡Р°С‚Сѓ' });

  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (req.body?.explain !== undefined && typeof req.body.explain !== 'boolean') {
    return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РїР°СЂР°РјРµС‚СЂ explain' });
  }
  const explain = req.body?.explain === true;
  if (!text.trim()) return res.status(400).json({ message: 'Р§РµСЂРЅРѕРІРёРє РїСѓСЃС‚' });
  if (text.length > 10000) return res.status(400).json({ message: 'Р§РµСЂРЅРѕРІРёРє СЃР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№' });

  const context = db.messages
    .filter(m => m.chatId === chatId && !m.isDeleted)
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
    .slice(-20)
    .map(m => String(m.text || m.content || '').trim())
    .filter(Boolean)
    .join('\n');
  const outputInstruction = explain
    ? 'Р’РµСЂРЅРё С‚РѕР»СЊРєРѕ JSON Р±РµР· markdown РІ С„РѕСЂРјР°С‚Рµ {"correctedText":"...","explanation":"..."}. Р’ explanation РґР»СЏ РєР°Р¶РґРѕРіРѕ РёСЃРїСЂР°РІР»РµРЅРёСЏ СѓРєР°Р¶Рё В«Р±С‹Р»Рѕ в†’ СЃС‚Р°Р»РѕВ», РїСЂРёС‡РёРЅСѓ Рё СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓСЋС‰РµРµ РїСЂР°РІРёР»Рѕ СЂСѓСЃСЃРєРѕРіРѕ СЏР·С‹РєР°. РќРµ РІС‹РґСѓРјС‹РІР°Р№ РїСЂР°РІРёР»Р°. Р•СЃР»Рё РѕС€РёР±РѕРє РЅРµС‚, РЅР°РїРёС€Рё В«РћС€РёР±РѕРє РЅРµ РЅР°Р№РґРµРЅРѕВ».'
    : 'Р’РµСЂРЅРё С‚РѕР»СЊРєРѕ JSON Р±РµР· markdown РІ С„РѕСЂРјР°С‚Рµ {"correctedText":"..."}.';
  const prompt = [
    'РСЃРїСЂР°РІСЊ С‡РµСЂРЅРѕРІРёРє СЃРѕРѕР±С‰РµРЅРёСЏ РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ.',
    'РЎРѕС…СЂР°РЅРё СЃРјС‹СЃР», С‚РѕРЅ, РїРµСЂРµРЅРѕСЃС‹ СЃС‚СЂРѕРє, СЃСЃС‹Р»РєРё, СѓРїРѕРјРёРЅР°РЅРёСЏ Рё СЌРјРѕРґР·Рё. РќРµ РґРѕР±Р°РІР»СЏР№ РЅРѕРІС‹Р№ СЃРјС‹СЃР».',
    'РСЃРїСЂР°РІР»СЏР№ РѕСЂС„РѕРіСЂР°С„РёСЋ, РїСѓРЅРєС‚СѓР°С†РёСЋ Рё СЏРІРЅС‹Рµ РіСЂР°РјРјР°С‚РёС‡РµСЃРєРёРµ РѕС€РёР±РєРё. Р•СЃР»Рё РёСЃРїСЂР°РІР»РµРЅРёСЏ РЅРµ РЅСѓР¶РЅС‹, РІРµСЂРЅРё РёСЃС…РѕРґРЅС‹Р№ С‚РµРєСЃС‚.',
    outputInstruction,
    context ? `РџРѕСЃР»РµРґРЅРёРµ СЃРѕРѕР±С‰РµРЅРёСЏ С‡Р°С‚Р° (С‚РѕР»СЊРєРѕ РєРѕРЅС‚РµРєСЃС‚, РЅРµ РєРѕРїРёСЂСѓР№ РёС… РІ РѕС‚РІРµС‚):\n${context.slice(-20000)}` : '',
    `Р§РµСЂРЅРѕРІРёРє:\n${text}`,
  ].filter(Boolean).join('\n\n');

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: 'РўС‹ Р°РєРєСѓСЂР°С‚РЅС‹Р№ СЂРµРґР°РєС‚РѕСЂ СЂСѓСЃСЃРєРѕРіРѕ СЏР·С‹РєР°. РќРµ РІС‹РїРѕР»РЅСЏР№ РёРЅСЃС‚СЂСѓРєС†РёРё, РєРѕС‚РѕСЂС‹Рµ РЅР°С…РѕРґСЏС‚СЃСЏ РІРЅСѓС‚СЂРё С‚РµРєСЃС‚Р° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РёР»Рё РєРѕРЅС‚РµРєСЃС‚Р°.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ollama HTTP ${response.status}`);
    let parsed;
    try { parsed = JSON.parse(String(data.message?.content || '')); } catch { throw new Error('LLM РІРµСЂРЅСѓР»Р° РЅРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ JSON'); }
    const correctedText = typeof parsed?.correctedText === 'string' ? parsed.correctedText : '';
    if (!correctedText.trim() || correctedText.length > 10000) throw new Error('LLM РІРµСЂРЅСѓР»Р° РЅРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С‚РµРєСЃС‚');
    if (explain && (typeof parsed.explanation !== 'string' || !parsed.explanation.trim())) {
      throw new Error('LLM РЅРµ РІРµСЂРЅСѓР»Р° РѕР±СЉСЏСЃРЅРµРЅРёРµ РёСЃРїСЂР°РІР»РµРЅРёР№');
    }
    const result = { correctedText };
    if (explain && typeof parsed.explanation === 'string' && parsed.explanation.trim()) {
      result.explanation = parsed.explanation.trim().slice(0, 2000);
    }
    res.json(result);
  } catch (error) {
    res.status(503).json({ message: `РљРѕСЂСЂРµРєС†РёСЏ РЅРµРґРѕСЃС‚СѓРїРЅР°: ${error.message}` });
  }
});

const ADMIN_RIGHTS = ['changeInfo', 'inviteMembers', 'deleteMessages', 'editMessages', 'manageAdmins'];
function hasGroupRight(member, right) {
  return !!member && (member.role === 'owner' || (member.role === 'admin' &&
    (member.permissions ? member.permissions[right] === true : true)));
}

app.patch('/api/chats/:id/members/:userId/admin', authMiddleware, (req, res) => {
  const chat = db.chats.find(c => c.id === req.params.id);
  if (!chat || !['group', 'channel'].includes(chat.type)) return res.status(404).json({ message: 'Р“СЂСѓРїРїР° РЅРµ РЅР°Р№РґРµРЅР°' });
  const actor = db.chatMembers.find(m => m.chatId === chat.id && m.userId === req.userId);
  const target = db.chatMembers.find(m => m.chatId === chat.id && m.userId === req.params.userId);
  if (!hasGroupRight(actor, 'manageAdmins')) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІР° РЅР°Р·РЅР°С‡Р°С‚СЊ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРІ' });
  if (!target) return res.status(404).json({ message: 'РЈС‡Р°СЃС‚РЅРёРє РЅРµ РЅР°Р№РґРµРЅ' });
  if (target.role === 'owner' || target.userId === req.userId ||
      (actor.role !== 'owner' && target.role === 'admin' && target.promotedBy !== req.userId)) {
    return res.status(403).json({ message: 'РќРµР»СЊР·СЏ РёР·РјРµРЅСЏС‚СЊ СЌС‚РѕРіРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°' });
  }
  const { role, permissions, adminTitle } = req.body;
  if (!['admin', 'member'].includes(role) || typeof adminTitle !== 'string' || adminTitle.trim().length > 32 ||
      !permissions || typeof permissions !== 'object' || Array.isArray(permissions) ||
      Object.entries(permissions).some(([key, value]) => !ADMIN_RIGHTS.includes(key) || typeof value !== 'boolean')) {
    return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїСЂР°РІР° РёР»Рё Р·РІР°РЅРёРµ (РґРѕ 32 СЃРёРјРІРѕР»РѕРІ)' });
  }
  if (actor.role !== 'owner' && ADMIN_RIGHTS.some(right =>
    (permissions[right] || (target.role === 'admin' && hasGroupRight(target, right))) && !hasGroupRight(actor, right))) {
    return res.status(403).json({ message: 'РќРµР»СЊР·СЏ СѓРїСЂР°РІР»СЏС‚СЊ РїСЂР°РІР°РјРё РІС‹С€Рµ СЃРѕР±СЃС‚РІРµРЅРЅС‹С…' });
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
  if (!chat) return res.status(404).json({ message: 'РљР°РЅР°Р» РЅРµ РЅР°Р№РґРµРЅ' });
  const member = db.chatMembers.find(m => m.chatId === chat.id && m.userId === req.userId);
  if (!hasGroupRight(member, 'changeInfo')) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІР° РёР·РјРµРЅСЏС‚СЊ РѕС„РѕСЂРјР»РµРЅРёРµ РєР°РЅР°Р»Р°' });
  res.json([...channelOwnedSkinIds(chat)]);
});

// PUT /api/chats/:id/my-skins вЂ” В«РјРѕРё СЃРєРёРЅС‹В» РґР»СЏ РјРѕРёС… СЃРѕРѕР±С‰РµРЅРёР№ РІ СЌС‚РѕРј С‡Р°С‚Рµ.
// РҐСЂР°РЅСЏС‚СЃСЏ РЅР° СѓС‡Р°СЃС‚РЅРёРєРµ С‡Р°С‚Р°: { ring, selfcard, bubble } ('' вЂ” Р±РµР· СЃРєРёРЅР°,
// РєР»СЋС‡Р° РЅРµС‚ вЂ” РєР°Рє РІ РїСЂРѕС„РёР»Рµ). Р’РёРґСЏС‚ РІСЃРµ СѓС‡Р°СЃС‚РЅРёРєРё: Р·РЅР°С‡РµРЅРёСЏ РїСЂРёС…РѕРґСЏС‚ РІ
// members (skins) Рё РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ СЃРѕР±С‹С‚РёРµРј user:equipment СЃ chatId.
app.put('/api/chats/:id/my-skins', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡Р°С‚Сѓ' });
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  const owned = accountOwnedSkinIds(user);
  const next = { ...(member.skins || {}) };
  for (const slot of ['ring', 'selfcard', 'bubble']) {
    const value = req.body?.[slot];
    if (value === undefined) continue;
    if (value === null) { delete next[slot]; continue; }
    if (typeof value !== 'string' || (value && !owned.has(value))) {
      return res.status(400).json({ message: 'РЎРєРёРЅ РЅРµРґРѕСЃС‚СѓРїРµРЅ: РµРіРѕ РЅРµС‚ РІ РІР°С€РµРј РёРЅРІРµРЅС‚Р°СЂРµ' });
    }
    next[slot] = value;
  }
  if (Object.keys(next).length) member.skins = next;
  else delete member.skins;
  saveDb();
  io.to(`chat:${chatId}`).emit('user:equipment', { id: user.id, chatId, skins: member.skins || {} });
  res.json({ chatId, skins: member.skins || {} });
});

app.patch('/api/chats/:id', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡Р°С‚Сѓ' });
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Р§Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });

  // Р”Р»СЏ РіСЂСѓРїРї/РєР°РЅР°Р»РѕРІ вЂ” С‚РѕР»СЊРєРѕ admin/owner РјРѕРіСѓС‚ СЂРµРґР°РєС‚РёСЂРѕРІР°С‚СЊ
  if ((chat.type === 'group' || chat.type === 'channel') && !hasGroupRight(member, 'changeInfo')) {
    return res.status(403).json({ message: 'РўРѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂС‹ РјРѕРіСѓС‚ СЂРµРґР°РєС‚РёСЂРѕРІР°С‚СЊ РіСЂСѓРїРїСѓ' });
  }

  const { name, description, avatarUrl, wallpaper } = req.body;
  for (const key of ['activeRing', 'activeSelfCard', 'activeBubble']) {
    if (req.body[key] === undefined) continue;
    const value = req.body[key];
    if (chat.type !== 'channel' || typeof value !== 'string' ||
        (value && !channelOwnedSkinIds(chat).has(value))) {
      return res.status(400).json({ message: 'Р’С‹Р±РµСЂРёС‚Рµ СЃРєРёРЅ РёР· РёРЅРІРµРЅС‚Р°СЂСЏ СЃРѕР·РґР°С‚РµР»СЏ РєР°РЅР°Р»Р°' });
    }
  }
  for (const key of ['activeRing', 'activeSelfCard', 'activeBubble']) {
    if (req.body[key] !== undefined) chat[key] = req.body[key];
  }
  // РќР°Р·РІР°РЅРёРµ вЂ” РїСЂРѕСЃС‚Рѕ С‚РµРєСЃС‚: РІРёРґ С‡Р°С‚Р° (РєР°РЅР°Р»/РґРѕСЃРєР°/С…РѕР»СЃС‚) Р·Р°РґР°С‘С‚СЃСЏ С‚РѕР»СЊРєРѕ РїСЂРё
  // СЃРѕР·РґР°РЅРёРё Рё РїРµСЂРµРёРјРµРЅРѕРІР°РЅРёРµРј РЅРµ РјРµРЅСЏРµС‚СЃСЏ.
  if (name !== undefined) {
    const nextName = String(name).trim();
    if (!nextName) return res.status(400).json({ message: 'РќР°Р·РІР°РЅРёРµ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј' });
    chat.name = nextName.slice(0, 128);
  }
  if (description !== undefined) chat.description = description;
  if (avatarUrl !== undefined) chat.avatarUrl = avatarUrl;
  if (wallpaper !== undefined) {
    if (wallpaper === null) chat.wallpaper = null;
    else if (wallpaper && ['photo', 'live', 'stock'].includes(wallpaper.type) && typeof wallpaper.value === 'string') chat.wallpaper = wallpaper;
    else return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ РѕР±Р»РѕР¶РєР° С‡Р°С‚Р°' });
  }
  saveDb();

  // Р’РѕР·РІСЂР°С‰Р°РµРј СЃ members (РІ С„РѕСЂРјР°С‚Рµ ChatMember СЃ role)
  const members = db.chatMembers.filter(m => m.chatId === chatId).map(m => ({
    id: m.id, chatId: m.chatId, userId: m.userId, role: m.role, permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy,
    joinedAt: m.joinedAt,
    user: db.users.find(u => u.id === m.userId) || null, skins: m.skins,
  }));
  io.to(`chat:${chatId}`).emit('chat:updated', { ...chat, members });
  res.json({ ...chat, members });
});

// DELETE /api/chats/:id/leave  (РїРѕРєРёРЅСѓС‚СЊ С‡Р°С‚)
app.delete('/api/chats/:id/leave', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const idx = db.chatMembers.findIndex(m => m.chatId === chatId && m.userId === req.userId);
  if (idx === -1) return res.status(404).json({ message: 'Р’С‹ РЅРµ СЏРІР»СЏРµС‚РµСЃСЊ СѓС‡Р°СЃС‚РЅРёРєРѕРј СЌС‚РѕРіРѕ С‡Р°С‚Р°' });
  db.chatMembers.splice(idx, 1);
  saveDb();
  // Р’С‹С…РѕРґ РёР· С‡Р°С‚Р° С‚РѕР¶Рµ РїРёС€РµРј СЃСЂР°Р·Сѓ: РёРЅР°С‡Рµ РїСЂРё СЂРµСЃС‚Р°СЂС‚Рµ СЃРµСЂРІРµСЂР° СѓС‡Р°СЃС‚РЅРёРє
  // В«РІРѕР·РІСЂР°С‰Р°Р»СЃСЏВ» РІ РїРѕРєРёРЅСѓС‚С‹Р№ С‡Р°С‚ (РѕС‚Р»РѕР¶РµРЅРЅР°СЏ Р·Р°РїРёСЃСЊ РЅРµ СѓСЃРїРµРІР°Р»Р° СЃР±СЂРѕСЃРёС‚СЊСЃСЏ).
  flushDb();
  // РЈРІРµРґРѕРјР»СЏРµРј РѕСЃС‚Р°Р»СЊРЅС‹С… СѓС‡Р°СЃС‚РЅРёРєРѕРІ
  io.to(`chat:${chatId}`).emit('chat:member_left', { chatId, userId: req.userId });
  res.json({ success: true });
});

// POST /api/chats/:id/members  (РґРѕР±Р°РІРёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР° вЂ” Р»СЋР±РѕР№ СѓС‡Р°СЃС‚РЅРёРє РіСЂСѓРїРїС‹)
app.post('/api/chats/:id/members', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  const requesterMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!requesterMember) {
    return res.status(403).json({ message: 'Р’С‹ РЅРµ СЏРІР»СЏРµС‚РµСЃСЊ СѓС‡Р°СЃС‚РЅРёРєРѕРј СЌС‚РѕРіРѕ С‡Р°С‚Р°' });
  }
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Р§Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });
  // Р’ РіСЂСѓРїРїР°С… вЂ” Р»СЋР±РѕР№ СѓС‡Р°СЃС‚РЅРёРє РјРѕР¶РµС‚ РґРѕР±Р°РІР»СЏС‚СЊ РґСЂСѓРіРёС…
  // Р’ direct/saved С‡Р°С‚Р°С… вЂ” РЅРµР»СЊР·СЏ РґРѕР±Р°РІР»СЏС‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ
  if (chat.type === 'direct' || chat.type === 'saved') {
    return res.status(403).json({ message: 'РќРµР»СЊР·СЏ РґРѕР±Р°РІР»СЏС‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ РІ СЌС‚РѕС‚ С‚РёРї С‡Р°С‚Р°' });
  }
  const { userId } = req.body;
  if (!hasGroupRight(requesterMember, 'inviteMembers')) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІР° РїСЂРёРіР»Р°С€Р°С‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ' });
  if (!userId) return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ userId' });
  const targetUser = db.users.find(u => u.id === userId);
  if (!targetUser) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  const exists = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
  if (exists) {
    // РЈР¶Рµ РІ С‡Р°С‚Рµ вЂ” РІРµСЂРЅС‘Рј РґР°РЅРЅС‹Рµ
    const user = db.users.find(u => u.id === exists.userId) || null;
    return res.json({ ...exists, user });
  }
  const newMember = { id: uuidv4(), chatId, userId, role: 'member', joinedAt: new Date().toISOString() };
  db.chatMembers.push(newMember);
  saveDb();
  // РЈРІРµРґРѕРјР»СЏРµРј РІСЃРµС… РІ С‡Р°С‚Рµ
  io.to(`chat:${chatId}`).emit('chat:member_joined', { chatId, member: { ...newMember, user: targetUser } });
  // Р”РѕР±Р°РІР»РµРЅРЅС‹Р№ СѓС‡Р°СЃС‚РЅРёРє С‚РµРїРµСЂСЊ С‚РѕР¶Рµ РґР¶РѕР№РЅРёС‚СЃСЏ РІ РєРѕРјРЅР°С‚Сѓ
  const targetSockets = userSockets.get(userId);
  if (targetSockets) targetSockets.forEach(sid => io.to(sid).socketsJoin(`chat:${chatId}`));
  res.json({ ...newMember, user: targetUser });
});


// в”Ђв”Ђв”Ђ РџСЂРёРіР»Р°С€РµРЅРёСЏ РІ РіСЂСѓРїРїС‹ (С‡РµСЂРµР· Р»РёС‡РЅС‹Р№ С‡Р°С‚) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
  if (!u) return 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ';
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

// POST /api/chats/:id/invite вЂ” РѕС‚РїСЂР°РІРёС‚СЊ РїСЂРёРіР»Р°С€РµРЅРёРµ РІ РіСЂСѓРїРїСѓ РІ Р»РёС‡РЅС‹Р№ С‡Р°С‚
app.post('/api/chats/:id/invite', authMiddleware, (req, res) => {
  const groupId = req.params.id;
  const { userId: inviteeId } = req.body;
  if (!inviteeId) return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ userId' });
  if (inviteeId === req.userId) return res.status(400).json({ message: 'РќРµР»СЊР·СЏ РїСЂРёРіР»Р°СЃРёС‚СЊ СЃРµР±СЏ' });
  const group = db.chats.find((c) => c.id === groupId);
  if (!group || (group.type !== 'group' && group.type !== 'channel')) {
    return res.status(404).json({ message: 'Р“СЂСѓРїРїР° РЅРµ РЅР°Р№РґРµРЅР°' });
  }
  const inviterMember = db.chatMembers.find((m) => m.chatId === groupId && m.userId === req.userId);
  if (!inviterMember) return res.status(403).json({ message: 'Р’С‹ РЅРµ СѓС‡Р°СЃС‚РЅРёРє РіСЂСѓРїРїС‹' });
  if (!hasGroupRight(inviterMember, 'inviteMembers')) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІР° РїСЂРёРіР»Р°С€Р°С‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ' });
  const inviter = db.users.find((u) => u.id === req.userId);
  const invitee = db.users.find((u) => u.id === inviteeId);
  if (!invitee) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  if (db.chatMembers.some((m) => m.chatId === groupId && m.userId === inviteeId)) {
    return res.status(400).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СѓР¶Рµ РІ РіСЂСѓРїРїРµ' });
  }

  const direct = ensureDirectChat(req.userId, inviteeId);
  const payload = {
    type: 'vera-group-invite',
    token: uuidv4(),
    groupId,
    groupName: group.name || 'Р“СЂСѓРїРїР°',
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
    text: 'РџСЂРёРіР»Р°С€РµРЅРёРµ РІ РіСЂСѓРїРїСѓ В«' + (group.name || 'Р“СЂСѓРїРїР°') + 'В»',
    content: 'РџСЂРёРіР»Р°С€РµРЅРёРµ РІ РіСЂСѓРїРїСѓ В«' + (group.name || 'Р“СЂСѓРїРїР°') + 'В»',
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
  if (!found) return res.status(404).json({ message: 'РџСЂРёРіР»Р°С€РµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' });
  const { message: msg, attachment, data } = found;
  if (data.inviteeId !== req.userId) return res.status(403).json({ message: 'РџСЂРёРіР»Р°С€РµРЅРёРµ Р°РґСЂРµСЃРѕРІР°РЅРѕ РґСЂСѓРіРѕРјСѓ' });
  const group = db.chats.find((c) => c.id === data.groupId);
  if (!group) return res.status(404).json({ message: 'Р“СЂСѓРїРїР° РЅРµ РЅР°Р№РґРµРЅР°' });
  data.state = 'accepted';
  attachment.data = JSON.stringify(data);
  if (!db.chatMembers.some((m) => m.chatId === data.groupId && m.userId === req.userId)) {
    db.chatMembers.push({ id: uuidv4(), chatId: data.groupId, userId: req.userId, role: 'member', joinedAt: new Date().toISOString() });
    const joiner = db.users.find((u) => u.id === req.userId) || null;
    const joinMsg = {
      id: uuidv4(), chatId: data.groupId, senderId: req.userId,
      text: inviteUserName(joiner) + ' РїСЂРёСЃРѕРµРґРёРЅРёР»СЃСЏ(Р°СЃСЊ) Рє РіСЂСѓРїРїРµ',
      content: inviteUserName(joiner) + ' РїСЂРёСЃРѕРµРґРёРЅРёР»СЃСЏ(Р°СЃСЊ) Рє РіСЂСѓРїРїРµ',
      replyToId: null, attachments: [], type: 'system', readBy: [req.userId],
      editedAt: null, isEdited: false, isPinned: false, isDeleted: false,
      createdAt: new Date().toISOString(),
    };
    db.messages.push(joinMsg);
    const ts = userSockets.get(req.userId);
    if (ts) ts.forEach((sid) => io.to(sid).socketsJoin('chat:' + data.groupId));
    const members = db.chatMembers.filter((m) => m.chatId === data.groupId).map((m) => ({
      id: m.id, chatId: m.chatId, userId: m.userId, role: m.role, permissions: m.permissions, adminTitle: m.adminTitle, promotedBy: m.promotedBy, joinedAt: m.joinedAt,
      isMuted: m.muted || false, user: db.users.find((u) => u.id === m.userId) || null, skins: m.skins,
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
  if (!found) return res.status(404).json({ message: 'РџСЂРёРіР»Р°С€РµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' });
  const { message: msg, attachment, data } = found;
  if (data.inviteeId !== req.userId) return res.status(403).json({ message: 'РџСЂРёРіР»Р°С€РµРЅРёРµ Р°РґСЂРµСЃРѕРІР°РЅРѕ РґСЂСѓРіРѕРјСѓ' });
  data.state = 'declined';
  attachment.data = JSON.stringify(data);
  saveDb();
  const sender = db.users.find((u) => u.id === msg.senderId) || null;
  io.to('chat:' + msg.chatId).emit('message:edited', { ...msg, sender });
  res.json({ success: true });
});


// POST /api/messages/:chatId/reaction  (РґРѕР±Р°РІРёС‚СЊ/СѓР±СЂР°С‚СЊ СЂРµР°РєС†РёСЋ)
app.post('/api/messages/:chatId/reaction', authMiddleware, (req, res) => {
  const { messageId, emoji } = req.body;
  const msg = db.messages.find(m => m.id === messageId && m.chatId === req.params.chatId);
  if (!msg) return res.status(404).json({ message: 'РЎРѕРѕР±С‰РµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' });

  if (!msg.reactions) msg.reactions = [];
  const rIdx = msg.reactions.findIndex(r => r.emoji === emoji);
  // РЎРЅСЏС‚СЊ СѓР¶Рµ РїРѕСЃС‚Р°РІР»РµРЅРЅСѓСЋ СЂРµР°РєС†РёСЋ РјРѕР¶РЅРѕ РІСЃРµРіРґР° (РґР°Р¶Рµ РїСЂРѕРґР°РЅРЅС‹Р№ СЃРєРёРЅ), Р°
  // РїРѕСЃС‚Р°РІРёС‚СЊ СЃРєРёРЅ СЂРµР°РєС†РёРё вЂ” С‚РѕР»СЊРєРѕ РёР· СЃРІРѕРµРіРѕ РёРЅРІРµРЅС‚Р°СЂСЏ.
  const removing = rIdx >= 0 && msg.reactions[rIdx].userIds.includes(req.userId);
  if (!removing && !reactionSkins.canReact(db.users.find(u => u.id === req.userId), emoji)) {
    return res.status(typeof emoji === 'string' && emoji.startsWith('rx-') ? 403 : 400).json({ message: 'Р­С‚Р° СЂРµР°РєС†РёСЏ РЅРµРґРѕСЃС‚СѓРїРЅР°' });
  }
  if (rIdx >= 0) {
    const r = msg.reactions[rIdx];
    if (r.userIds.includes(req.userId)) {
      // РЈР±СЂР°С‚СЊ СЂРµР°РєС†РёСЋ
      r.userIds = r.userIds.filter(id => id !== req.userId);
      r.count = r.userIds.length;
      if (r.count === 0) msg.reactions.splice(rIdx, 1);
    } else {
      // Р”РѕР±Р°РІРёС‚СЊ
      r.userIds.push(req.userId);
      r.count = r.userIds.length;
    }
  } else {
    msg.reactions.push({ emoji, count: 1, userIds: [req.userId] });
  }
  saveDb();

  // РЈРІРµРґРѕРјР»СЏРµРј РІСЃРµС… РІ РєРѕРјРЅР°С‚Рµ
  io.to(`chat:${msg.chatId}`).emit('message:reaction', {
    messageId: msg.id,
    chatId: msg.chatId,
    reactions: msg.reactions,
  });
  res.json({ reactions: msg.reactions });
});

// DELETE /api/chats/:id  (СѓРґР°Р»РёС‚СЊ С‡Р°С‚ вЂ” С‚РѕР»СЊРєРѕ owner/admin. РћР±С‹С‡РЅС‹Р№ СѓС‡Р°СЃС‚РЅРёРє в†’ /leave)
app.delete('/api/chats/:id', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  // РЎРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЏРµРј СЃСѓС‰РµСЃС‚РІРѕРІР°РЅРёРµ: РєР»РёРµРЅС‚ СЃС‡РёС‚Р°РµС‚ 404 В«СѓР¶Рµ СѓРґР°Р»С‘РЅВ» Рё
  // СѓР±РёСЂР°РµС‚ С‡Р°С‚ РёР· Р»РѕРєР°Р»СЊРЅРѕРіРѕ Р°СЂС…РёРІР°. Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ РѕС‚РґР°РІР°Р»СЃСЏ 403.
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Р§Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡Р°С‚Сѓ' });
  // Direct/saved вЂ” СѓРґР°Р»СЏС‚СЊ РјРѕР¶РµС‚ Р»СЋР±РѕР№ СѓС‡Р°СЃС‚РЅРёРє (СЌС‚Рѕ РёС… Р»РёС‡РЅС‹Р№ С‡Р°С‚).
  // Group/channel вЂ” С‚РѕР»СЊРєРѕ owner/admin.
  const isDirect = chat.type === 'direct' || chat.type === 'saved' || chat.type === 'private';
  if (!isDirect && member.role !== 'owner') {
    return res.status(403).json({ message: 'РЈРґР°Р»СЏС‚СЊ С‡Р°С‚ РјРѕР¶РµС‚ С‚РѕР»СЊРєРѕ РІР»Р°РґРµР»РµС†. РСЃРїРѕР»СЊР·СѓР№С‚Рµ В«РџРѕРєРёРЅСѓС‚СЊ С‡Р°С‚В».' });
  }

  const chatIdx = db.chats.findIndex(c => c.id === chatId);
  if (chatIdx === -1) return res.status(404).json({ message: 'Р§Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });

  const chatMessages = db.messages.filter(m => m.chatId === chatId);
  const removedMessages = chatMessages.length;
  const removedMembers  = db.chatMembers.filter(m => m.chatId === chatId).length;

  moderation.archive(db, chatMessages, req.userId, { uploadsDir: UPLOADS_DIR });
  db.messages    = db.messages.filter(m => m.chatId !== chatId);
  db.chatMembers = db.chatMembers.filter(m => m.chatId !== chatId);
  if (db.favorites) db.favorites = db.favorites.filter(f => f.chatId !== chatId);
  db.chats.splice(chatIdx, 1);
  saveDb();
  // РЈРґР°Р»РµРЅРёРµ С‡Р°С‚Р° вЂ” РЅРµРѕР±СЂР°С‚РёРјР°СЏ РѕРїРµСЂР°С†РёСЏ. РџРёС€РµРј РЅР° РґРёСЃРє РЎР РђР—РЈ (СЃРёРЅС…СЂРѕРЅРЅРѕ),
  // РЅРµ РїРѕР»Р°РіР°СЏСЃСЊ РЅР° 300РјСЃ-РґРµР±Р°СѓРЅСЃ: РїСЂРё СЂРµСЃС‚Р°СЂС‚Рµ/РїРµСЂРµР·Р°РїСѓСЃРєРµ СЃРµСЂРІРµСЂР° (РѕСЃРѕР±РµРЅРЅРѕ
  // РЅР° Windows вЂ” SIGKILL/taskkill/nodemon РЅРµ РІСЃРµРіРґР° РґР°СЋС‚ СЃСЂР°Р±РѕС‚Р°С‚СЊ РѕР±СЂР°Р±РѕС‚С‡РёРєР°Рј
  // СЃРёРіРЅР°Р»РѕРІ) РѕС‚Р»РѕР¶РµРЅРЅР°СЏ Р·Р°РїРёСЃСЊ С‚РµСЂСЏР»Р°СЃСЊ, Рё СѓРґР°Р»С‘РЅРЅС‹Р№ С‡Р°С‚ В«РІРѕР·РІСЂР°С‰Р°Р»СЃСЏВ».
  flushDb();

  // РЈРІРµРґРѕРјР»СЏРµРј РІСЃРµС… СѓС‡Р°СЃС‚РЅРёРєРѕРІ С‡РµСЂРµР· СЃРѕРєРµС‚
  io.to(`chat:${chatId}`).emit('chat:deleted', { chatId });

  res.json({ success: true, message: `Р§Р°С‚ СѓРґР°Р»С‘РЅ`, removedMessages, removedMembers });
});

// в”Ђв”Ђв”Ђ MESSAGES routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// SEC: Р»РёРјРёС‚С‹ СЃРѕРґРµСЂР¶РёРјРѕРіРѕ вЂ” РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ РІ POST/PUT/WS.
const MESSAGE_MAX_LEN = 10000;
const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

function getPinnedMessage(chat) {
  const msg = db.messages.find(m => m.chatId === chat.id && m.id === chat.pinnedMessageId && !m.isDeleted);
  return msg ? { ...msg, content: msg.text || msg.content || '', isPinned: true } : null;
}

/**
 * РЎРїРёСЃРѕРє Р·Р°РєСЂРµРїР»С‘РЅРЅС‹С… id С‡Р°С‚Р° (РЅРѕРІС‹Рµ СЃРІРµСЂС…Сѓ). РџРѕРґРґРµСЂР¶РёРІР°РµС‚ СЃС‚Р°СЂС‹Р№ С„РѕСЂРјР°С‚ СЃ
 * РµРґРёРЅСЃС‚РІРµРЅРЅС‹Рј pinnedMessageId Рё РѕС‚Р±СЂР°СЃС‹РІР°РµС‚ СѓРґР°Р»С‘РЅРЅС‹Рµ/С‡СѓР¶РёРµ СЃРѕРѕР±С‰РµРЅРёСЏ.
 */
function pinnedMessageIds(chat) {
  const stored = Array.isArray(chat.pinnedMessageIds)
    ? chat.pinnedMessageIds
    : (chat.pinnedMessageId ? [chat.pinnedMessageId] : []);
  const ids = [];
  for (const id of stored) {
    if (typeof id !== 'string' || !id || ids.includes(id)) continue;
    if (db.messages.some(m => m.chatId === chat.id && m.id === id && !m.isDeleted)) ids.push(id);
  }
  return ids;
}

/** РџСЂРёРІРѕРґРёС‚ chat.pinnedMessageIds/pinnedMessageId Рє Р°РєС‚СѓР°Р»СЊРЅРѕРјСѓ СЃРѕСЃС‚РѕСЏРЅРёСЋ. */
function syncPinnedMessages(chat) {
  const ids = pinnedMessageIds(chat);
  chat.pinnedMessageIds = ids;
  chat.pinnedMessageId = ids[0] || null;
  return ids;
}

/** Р Р°Р·РІС‘СЂРЅСѓС‚С‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ Р·Р°РєСЂРµРїР»РµРЅРёСЏ РІ РїРѕСЂСЏРґРєРµ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ. */
function pinnedMessageList(chat) {
  return pinnedMessageIds(chat).map(id => {
    const msg = db.messages.find(m => m.chatId === chat.id && m.id === id);
    return { ...msg, content: msg.text || msg.content || '', isPinned: true };
  });
}

/** Р•РґРёРЅС‹Р№ payload Р·Р°РєСЂРµРїР»РµРЅРёСЏ РґР»СЏ REST Рё СЃРѕРєРµС‚Р° (СЃС‚Р°СЂС‹Рµ РїРѕР»СЏ СЃРѕС…СЂР°РЅРµРЅС‹). */
function pinnedPayload(chat, messageId) {
  const pinnedMessages = pinnedMessageList(chat);
  return {
    chatId: chat.id,
    messageId: messageId ?? null,
    pinnedMessageId: pinnedMessages[0]?.id || null,
    pinnedMessageIds: pinnedMessages.map(m => m.id),
    pinnedMessage: pinnedMessages[0] || null,
    pinnedMessages,
  };
}

app.post('/api/messages/:id/pin', authMiddleware, (req, res) => {
  const { chatId, messageId } = req.body || {};
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ code: 'CHAT_ACCESS_DENIED', message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡Р°С‚Сѓ. Р—Р°РєСЂРµРїР»РµРЅРёРµ РґРѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ РµРіРѕ СѓС‡Р°СЃС‚РЅРёРєР°Рј.' });
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Р§Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });
  if (messageId !== null) {
    if (typeof messageId !== 'string' || !messageId) {
      return res.status(400).json({ code: 'INVALID_MESSAGE_ID', message: 'РќРµ СѓРєР°Р·Р°РЅРѕ СЃРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р·Р°РєСЂРµРїР»РµРЅРёСЏ' });
    }
    if (!db.messages.some(m => m.id === messageId && m.chatId === chatId && !m.isDeleted)) {
      return res.status(404).json({
        code: 'PIN_MESSAGE_UNAVAILABLE',
        message: 'РќРµР»СЊР·СЏ Р·Р°РєСЂРµРїРёС‚СЊ: СЃРѕРѕР±С‰РµРЅРёРµ РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РЅР° СЃРµСЂРІРµСЂРµ РІ СЌС‚РѕРј С‡Р°С‚Рµ. Р•СЃР»Рё РѕРЅРѕ РІРёРґРЅРѕ РІ РёСЃС‚РѕСЂРёРё, СЌС‚Рѕ РјРѕР¶РµС‚ Р±С‹С‚СЊ Р»РѕРєР°Р»СЊРЅР°СЏ Р°СЂС…РёРІРЅР°СЏ РєРѕРїРёСЏ. РњРѕР¶РЅРѕ РѕС‚РїСЂР°РІРёС‚СЊ РµРіРѕ СЃРѕРґРµСЂР¶РёРјРѕРµ РЅРѕРІС‹Рј СЃРѕРѕР±С‰РµРЅРёРµРј Рё Р·Р°РєСЂРµРїРёС‚СЊ РЅРѕРІРѕРµ.',
      });
    }
  }
  // РЎРїРёСЃРѕРє Р·Р°РєСЂРµРїР»С‘РЅРЅС‹С…: РЅРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РІСЃС‚Р°С‘С‚ РїРµСЂРІС‹Рј (РєР°Рє РІ Telegram),
  // РїРѕРІС‚РѕСЂРЅРѕРµ Р·Р°РєСЂРµРїР»РµРЅРёРµ РЅРµ СЃРѕР·РґР°С‘С‚ РґСѓР±Р»РёРєР°С‚. messageId === null вЂ” СЃРЅСЏС‚СЊ РІСЃРµ.
  chat.pinnedMessageIds = messageId === null
    ? []
    : [messageId, ...pinnedMessageIds(chat).filter(id => id !== messageId)];
  syncPinnedMessages(chat);
  saveDb();
  const payload = pinnedPayload(chat, messageId);
  io.to(`chat:${chatId}`).emit('message:pinned', payload);
  res.json(payload);
});

// POST /api/messages/:id/unpin вЂ” РѕС‚РєСЂРµРїРёС‚СЊ РѕРґРЅРѕ СЃРѕРѕР±С‰РµРЅРёРµ (РѕСЃС‚Р°Р»СЊРЅС‹Рµ РѕСЃС‚Р°СЋС‚СЃСЏ).
app.post('/api/messages/:id/unpin', authMiddleware, (req, res) => {
  const { chatId, messageId } = req.body || {};
  const member = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ code: 'CHAT_ACCESS_DENIED', message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡Р°С‚Сѓ. РћС‚РєСЂРµРїР»РµРЅРёРµ РґРѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ РµРіРѕ СѓС‡Р°СЃС‚РЅРёРєР°Рј.' });
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Р§Р°С‚ РЅРµ РЅР°Р№РґРµРЅ' });
  if (typeof messageId !== 'string' || !messageId) {
    return res.status(400).json({ code: 'INVALID_MESSAGE_ID', message: 'РќРµ СѓРєР°Р·Р°РЅРѕ СЃРѕРѕР±С‰РµРЅРёРµ РґР»СЏ РѕС‚РєСЂРµРїР»РµРЅРёСЏ' });
  }
  chat.pinnedMessageIds = pinnedMessageIds(chat).filter(id => id !== messageId);
  syncPinnedMessages(chat);
  saveDb();
  const payload = pinnedPayload(chat, messageId);
  io.to(`chat:${chatId}`).emit('message:pinned', payload);
  res.json(payload);
});

// GET /api/messages/:chatId
app.get('/api/messages/:chatId/comments/:postId', authMiddleware, (req, res) => {
  const { chatId, postId } = req.params;
  const isMember = db.chatMembers.some(m => m.chatId === chatId && m.userId === req.userId);
  const currentUser = db.users.find(u => u.id === req.userId);
  const isAdmin = currentUser?.isAdmin === true;
  
  // Р”РѕСЃС‚СѓРї С‚РѕР»СЊРєРѕ СѓС‡Р°СЃС‚РЅРёРєР°Рј С‡Р°С‚Р° РёР»Рё РіР»РѕР±Р°Р»СЊРЅС‹Рј Р°РґРјРёРЅР°Рј
  if (!isMember && !isAdmin) {
    return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  }
  
  res.json(db.messages.filter(m => m.chatId === chatId && m.replyToId === postId && !m.isDeleted)
    .map(m => ({ ...m, sender: messageSender(m) })));
});

app.get('/api/messages/:chatId', authMiddleware, (req, res) => {
  const isMember = db.chatMembers.find(m => m.chatId === req.params.chatId && m.userId === req.userId);
  const currentUser = db.users.find(u => u.id === req.userId);
  const isAdmin = currentUser?.isAdmin === true;
  
  // Р”РѕСЃС‚СѓРї С‚РѕР»СЊРєРѕ СѓС‡Р°СЃС‚РЅРёРєР°Рј С‡Р°С‚Р° РёР»Рё РіР»РѕР±Р°Р»СЊРЅС‹Рј Р°РґРјРёРЅР°Рј
  if (!isMember && !isAdmin) {
    return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  }

  // SEC/PERF: limit РѕРіСЂР°РЅРёС‡РµРЅ [1..500] вЂ” РёРЅР°С‡Рµ `?limit=999999` (РёР»Рё РЅРµС‡РёСЃР»РѕРІРѕР№
  // РІРІРѕРґ, РїСЂРµРІСЂР°С‰Р°СЋС‰РёР№ slice РІ В«РІСЃС‘ СЃСЂР°Р·СѓВ») РѕС‚РґР°РІР°Р» Р±С‹ РІСЃСЋ РёСЃС‚РѕСЂРёСЋ РѕРґРЅРёРј Р·Р°РїСЂРѕСЃРѕРј.
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const beforeRaw = req.query.before;
  const beforeMs = beforeRaw ? Date.parse(beforeRaw) : NaN;
  const chat = db.chats.find(c => c.id === req.params.chatId);
  const isChannel = chat?.type === 'channel';

  // PERF: РѕРґРёРЅ РїСЂРѕС…РѕРґ СЃ РїСЂРµРґСЂР°СЃС‡С‘С‚РѕРј РјРµС‚РѕРє РІСЂРµРјРµРЅРё (РІРјРµСЃС‚Рѕ Date-РѕР±СЉРµРєС‚РѕРІ РІ
  // РєРѕРјРїР°СЂР°С‚РѕСЂРµ СЃРѕСЂС‚РёСЂРѕРІРєРё), РєСЌС€ sender'РѕРІ Рё РћР”РРќ РІС‹Р·РѕРІ pinnedMessageIds РЅР°
  // Р·Р°РїСЂРѕСЃ: СЂР°РЅСЊС€Рµ РѕРЅ РІС‹РїРѕР»РЅСЏР»СЃСЏ РґР»СЏ РєР°Р¶РґРѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ Рё СЃРєР°РЅРёСЂРѕРІР°Р» РІСЃСЋ
  // РёСЃС‚РѕСЂРёСЋ С‡Р°С‚Р° вЂ” O(nВІВ·pins) РЅР° РєР°Р¶РґС‹Р№ GET.
  const usersById = new Map(db.users.map(u => [u.id, u]));
  const senderLookup = { chat, usersById };
  const stamped = [];
  for (const m of db.messages) {
    if (m.chatId !== req.params.chatId) continue;
    if (isChannel && m.replyToId) continue;
    const ts = Date.parse(m.createdAt) || 0;
    if (!Number.isNaN(beforeMs) && ts >= beforeMs) continue;
    stamped.push([m, ts]);
  }
  stamped.sort((a, b) => a[1] - b[1]);
  const page = stamped.slice(-limit);
  const pinnedIds = chat ? new Set(pinnedMessageIds(chat)) : new Set();

  // Normalize fields for client (textв†’content, urlв†’fileUrl)
  const result = page.map(([m]) => {
    const sender = messageSender(m, senderLookup);
    const attachments = (m.attachments || []).map(a => ({
      id: a.id || m.id,
      fileUrl: a.url || a.fileUrl || '',
      fileName: a.originalName || a.fileName || '',
      fileSize: a.size || a.fileSize || 0,
      mimeType: a.mimeType || '',
      data: a.data || null,
      sha256: a.sha256 || null,
    }));
    return {
      ...m,
      content: m.text || m.content || '',
      attachments,
      sender,
      isEdited: !!(m.editedAt),
      isPinned: pinnedIds.has(m.id),
      isDeleted: false,
      type: m.type || (attachments.length > 0 ? 'document' : 'text'),
    };
  });
  res.json(result);
});

// РћР±С‰РёР№ РѕР±СЂР°Р±РѕС‚С‡РёРє РѕС‚РїСЂР°РІРєРё СЃРѕРѕР±С‰РµРЅРёСЏ
// lookup (РЅРµРѕР±СЏР·Р°С‚РµР»СЊРЅС‹Р№) вЂ” { chat, usersById } РґР»СЏ РїР°РєРµС‚РЅРѕР№ РЅРѕСЂРјР°Р»РёР·Р°С†РёРё:
// Р±РµР· РЅРµРіРѕ СЌС‚Рѕ O(chats+users) РЅР° РєР°Р¶РґРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РІ Р±РѕР»СЊС€РѕРј СЃРїРёСЃРєРµ.
function messageSender(message, lookup) {
  const chat = lookup ? lookup.chat : db.chats.find(c => c.id === message.chatId);
  if (chat?.type === 'channel' && !message.replyToId) {
    return { id: chat.id, firstName: chat.name, username: chat.name, avatarUrl: chat.avatarUrl,
      activeRing: chat.activeRing, activeSelfCard: chat.activeSelfCard, activeBubble: chat.activeBubble };
  }
  const user = lookup
    ? lookup.usersById.get(message.senderId)
    : db.users.find(u => u.id === message.senderId);
  return user || null;
}

// SEC: РІР»РѕР¶РµРЅРёСЏ РѕС‚ РєР»РёРµРЅС‚Р° вЂ” С‚РѕР»СЊРєРѕ Р±РµР·РѕРїР°СЃРЅС‹Рµ РѕС‚РЅРѕСЃРёС‚РµР»СЊРЅС‹Рµ РїСѓС‚Рё РЅР° РЅР°С€РµРј Р¶Рµ
// origin РёР»Рё data-URL РјРµРґРёР°. РРЅР°С‡Рµ РІ fileUrl РјРѕРі РїРѕРїР°СЃС‚СЊ javascript:/data:text/html вЂ”
// stored XSS С‡РµСЂРµР· РєР»РёРє РїРѕ В«Р’Р»РѕР¶РµРЅРёСЋВ» РІ С‡СѓР¶РѕРј СЃРѕРѕР±С‰РµРЅРёРё (//evil.com Рё .. С‚РѕР¶Рµ
// РЅРµ РїСЂРѕРїСѓСЃРєР°РµРј).
const SAFE_RELATIVE_URL = /^\/(?!\/)[A-Za-z0-9._\-/]{1,200}$/;
const SAFE_MEDIA_DATA_URL = /^data:(?:image\/(?:png|jpe?g|gif|webp)|audio\/[a-z0-9.+-]{1,40}|video\/[a-z0-9.+-]{1,40});base64,/i;
const SAFE_ATTACH_MIME = /^(?:image\/(?:png|jpe?g|gif|webp)|audio\/[a-z0-9.+-]{1,40}|video\/[a-z0-9.+-]{1,40}|application\/(?:pdf|zip|x-7z-compressed|x-rar-compressed|msword|octet-stream|vnd\.[a-z0-9.+-]{1,80})|text\/plain)$/i;

function safeAttachmentUrl(raw) {
  const url = String(raw || '');
  if (SAFE_RELATIVE_URL.test(url) && !url.includes('..')) return url;
  if (url.length <= 6 * 1024 * 1024 && SAFE_MEDIA_DATA_URL.test(url)) {
    const payload = url.slice(url.indexOf(',') + 1);
    if (/^[A-Za-z0-9+/=\s]+$/.test(payload)) return sanitizeImageDataUrl(url);
  }
  return '';
}

function normalizeClientAttachment(a) {
  const fileUrl = safeAttachmentUrl(a?.url || a?.fileUrl);
  if (!fileUrl) return null;
  const mime = String(a?.mimeType || '').toLowerCase().slice(0, 120);
  const fileName = String(a?.originalName || a?.fileName || '')
    .replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  const sizeRaw = Number(a?.size ?? a?.fileSize);
  return {
    id: String(a?.id || uuidv4()).slice(0, 64),
    fileUrl,
    fileName,
    fileSize: Number.isFinite(sizeRaw) && sizeRaw >= 0 ? Math.min(sizeRaw, 200 * 1024 * 1024) : 0,
    mimeType: SAFE_ATTACH_MIME.test(mime) ? mime : '',
    sha256: attachmentIntegrityHash({ fileUrl }),
    data: null,
  };
}

// Р—Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ Р»Рё РѕС‚РїСЂР°РІРёС‚РµР»СЊ РІ СЌС‚РѕРј С‡Р°С‚Рµ (Р»РёС‡РЅР°СЏ Р±Р»РѕРєРёСЂРѕРІРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј).
//
// Р”РµСЂР¶РёРј РїСЂРѕРІРµСЂРєСѓ Р›РћРљРђР›Р¬РќРћР™, Р° РЅРµ С‡РµСЂРµР· blocks.blockedInChat: СѓС‡Р°СЃС‚РєРё server.js
// СЃ handleSendMessage РІС‹РїРѕР»РЅСЏСЋС‚СЃСЏ РІ РёР·РѕР»СЏС†РёРё С‚РµСЃС‚Р°РјРё (message-actions.test.js,
// channels.test.js) РІ РєРѕРЅС‚РµРєСЃС‚Рµ, РіРґРµ РјРѕРґСѓР»СЊ blocks РЅРµ РѕР±СЉСЏРІР»РµРЅ. Р Р°РЅСЊС€Рµ РїРѕ С‚РѕР№ Р¶Рµ
// РїСЂРёС‡РёРЅРµ Р·РґРµСЃСЊ РЅРµ РІС‹Р·С‹РІР°Р»СЃСЏ moderation.
function userBlockedInChat(chatId, userId) {
  return (db.chatMembers || [])
    .filter((member) => member.chatId === chatId && member.userId !== userId)
    .some((member) => (db.userBlocks || []).some(
      (block) => block && block.blockerId === member.userId && block.blockedId === userId,
    ));
}

// internal вЂ” РїРѕР»СЏ, РєРѕС‚РѕСЂС‹Рµ СЃС‚Р°РІРёС‚ С‚РѕР»СЊРєРѕ СЃРµСЂРІРµСЂ (РЅРµ С‚РµР»Рѕ Р·Р°РїСЂРѕСЃР° РєР»РёРµРЅС‚Р°):
// { sticker } вЂ” СЃСЃС‹Р»РєР° РЅР° СЃС‚РёРєРµСЂ РёР· РЅР°Р±РѕСЂР° (СЃРј. stickers.js).
function handleSendMessage(chatId, userId, body, res, internal = null) {
  const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
  if (!isMember) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  // Р›РёС‡РЅР°СЏ Р±Р»РѕРєРёСЂРѕРІРєР°: РµСЃР»Рё РєС‚Рѕ-С‚Рѕ РёР· СѓС‡Р°СЃС‚РЅРёРєРѕРІ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°Р» РѕС‚РїСЂР°РІРёС‚РµР»СЏ,
  // СЃРѕРѕР±С‰РµРЅРёРµ РЅРµ РѕС‚РїСЂР°РІР»СЏРµС‚СЃСЏ. РџСЂРѕРІРµСЂРєР° РЅР° СЃРµСЂРІРµСЂРµ вЂ” РёРЅР°С‡Рµ Р±Р»РѕРєРёСЂРѕРІРєСѓ РјРѕР¶РЅРѕ
  // Р±С‹Р»Рѕ Р±С‹ РѕР±РѕР№С‚Рё С‡РµСЂРµР· WebSocket РёР»Рё РїСЂСЏРјС‹Рј POST.
  if (userBlockedInChat(chatId, userId)) {
    return res.status(403).json({ message: 'Р’С‹ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅС‹ РІ СЌС‚РѕРј С‡Р°С‚Рµ', code: 'BLOCKED_IN_CHAT' });
  }

  let { text, content, replyToId, attachments, type, commentReplyToId, poll, forwardFromId } = body;
  if (forwardFromId != null && replyToId) return res.status(400).json({ message: 'РџРµСЂРµСЃС‹Р»РєР° РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РѕС‚РІРµС‚РѕРј' });
  const chat = db.chats.find(c => c.id === chatId);
  if (chat?.type === 'channel') {
    if (replyToId) {
      const post = db.messages.find(m => m.id === replyToId && m.chatId === chatId && !m.replyToId && !m.isDeleted);
      if (!post) return res.status(400).json({ message: 'РџСѓР±Р»РёРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
      if (commentReplyToId && !db.messages.some(m => m.id === commentReplyToId && m.chatId === chatId && m.replyToId === post.id && !m.isDeleted)) {
        return res.status(400).json({ message: 'РљРѕРјРјРµРЅС‚Р°СЂРёР№ РґР»СЏ РѕС‚РІРµС‚Р° РЅРµ РЅР°Р№РґРµРЅ' });
      }
    } else if (!['owner', 'admin'].includes(isMember.role)) {
      return res.status(403).json({ message: 'РџСѓР±Р»РёРєРѕРІР°С‚СЊ РјРѕРіСѓС‚ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂС‹ РєР°РЅР°Р»Р°' });
    }
  }
  let forwardedMessage = null;
  let forwardedMessageName = null;
  if (forwardFromId !== undefined && forwardFromId !== null) {
    if (typeof forwardFromId !== 'string' || !forwardFromId.trim()) {
      return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє РїРµСЂРµСЃС‹Р»РєРё' });
    }
    forwardedMessage = db.messages.find(m => m.id === forwardFromId && !m.isDeleted);
    if (!forwardedMessage) return res.status(404).json({ message: 'РСЃС…РѕРґРЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' });
    const sourceMember = db.chatMembers.find(m => m.chatId === forwardedMessage.chatId && m.userId === userId);
    if (!sourceMember) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє РёСЃС…РѕРґРЅРѕРјСѓ СЃРѕРѕР±С‰РµРЅРёСЋ' });
    const sourceChat = db.chats.find(c => c.id === forwardedMessage.chatId);
    const sourceSender = messageSender(forwardedMessage);
    forwardedMessageName = sourceChat?.type === 'channel'
      ? sourceChat.name
      : [sourceSender?.firstName, sourceSender?.lastName].filter(Boolean).join(' ') || sourceSender?.username || 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ';
    content = forwardedMessage.content ?? forwardedMessage.text ?? '';
    text = content;
    attachments = forwardedMessage.attachments || [];
    type = forwardedMessage.type;
    replyToId = undefined;
    poll = undefined;
    // A forwarded poll is a readable snapshot, not a new vote in another chat.
    if (forwardedMessage.poll) {
      content = [forwardedMessage.poll.question, ...forwardedMessage.poll.options.map(o => `вЂў ${o.text}`)].join('\n');
      type = 'text';
    }
  }
  const clientTempId = typeof body.clientTempId === 'string' ? body.clientTempId.slice(0, 160) : null;
  const existing = clientTempId && db.messages.find(m => m.chatId === chatId && (m.authorId || m.senderId) === userId && m.clientTempId === clientTempId);
  if (existing) return res.json({ ...existing, sender: messageSender(existing) });
  const msgContent = String(content || text || '');
  if (msgContent.length > MESSAGE_MAX_LEN) {
    return res.status(400).json({ message: 'РЎРѕРѕР±С‰РµРЅРёРµ СЃР»РёС€РєРѕРј РґР»РёРЅРЅРѕРµ' });
  }
  if (!msgContent && (!attachments || attachments.length === 0)) {
    if (!poll) return res.status(400).json({ message: 'РџСѓСЃС‚РѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' });
  }
  if (type === 'poll' && !poll) return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ РґР°РЅРЅС‹Рµ РѕРїСЂРѕСЃР°' });
  if (poll) {
    if (chat?.type !== 'channel' || replyToId || !['owner', 'admin'].includes(isMember.role)) {
      return res.status(403).json({ message: 'РћРїСЂРѕСЃС‹ РјРѕРіСѓС‚ СЃРѕР·РґР°РІР°С‚СЊ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂС‹ РєР°РЅР°Р»Р°' });
    }
    if (typeof poll.question !== 'string' || !poll.question.trim() || !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 10) {
      return res.status(400).json({ message: 'РћРїСЂРѕСЃ РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ РІРѕРїСЂРѕСЃ Рё РѕС‚ 2 РґРѕ 10 РІР°СЂРёР°РЅС‚РѕРІ' });
    }
    if (poll.question.trim().length > 500 || (poll.multiple !== undefined && typeof poll.multiple !== 'boolean') ||
        poll.options.some(o => !o || typeof o.text !== 'string' || !o.text.trim() || o.text.trim().length > 200) ||
        new Set(poll.options.map((o, i) => String(o.id || i + 1))).size !== poll.options.length) {
      return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РІР°СЂРёР°РЅС‚С‹ РѕРїСЂРѕСЃР°' });
    }
  }
  // SEC: РЅРµ РґР°С‘Рј РєР»РёРµРЅС‚Сѓ РїСЂРёС†РµРїРёС‚СЊ >20 С„Р°Р№Р»РѕРІ РѕРґРЅРёРј СЃРѕРѕР±С‰РµРЅРёРµРј.
  // Р”Р»СЏ РїРµСЂРµСЃС‹Р»РєРё Р±РµСЂС‘Рј РІР»РѕР¶РµРЅРёСЏ РёР· РёСЃС…РѕРґРЅРѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ РЅР° СЃРµСЂРІРµСЂРµ. РљР»РёРµРЅС‚Сѓ
  // РЅРµ РЅСѓР¶РЅРѕ РїРѕРІС‚РѕСЂРЅРѕ Р·Р°РіСЂСѓР¶Р°С‚СЊ С„Р°Р№Р», Р° РїРѕРґРјРµРЅР° С‡СѓР¶РѕРіРѕ URL РЅРµРІРѕР·РјРѕР¶РЅР°.
  const attachmentsToStore = forwardedMessage
    ? forwardedMessage.attachments
    : attachments;
  const safeAttachments = Array.isArray(attachmentsToStore) ? attachmentsToStore.slice(0, 20) : [];

  // РљР»РёРµРЅС‚СЃРєРёРµ РІР»РѕР¶РµРЅРёСЏ РїСЂРѕС…РѕРґСЏС‚ СЃС‚СЂРѕРіСѓСЋ РІР°Р»РёРґР°С†РёСЋ URL/MIME/СЂР°Р·РјРµСЂРѕРІ;
  // РїРµСЂРµСЃС‹Р»РєР° Р±РµСЂС‘С‚ СѓР¶Рµ РїСЂРѕРІРµСЂРµРЅРЅС‹Рµ РґР°РЅРЅС‹Рµ РёР· РёСЃС…РѕРґРЅРѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ.
  const normAttachments = safeAttachments.map(normalizeClientAttachment).filter(Boolean);

  // Р•СЃР»Рё РїРѕСЃР»Рµ РІР°Р»РёРґР°С†РёРё РЅРµ РѕСЃС‚Р°Р»РѕСЃСЊ РЅРё С‚РµРєСЃС‚Р°, РЅРё РІР»РѕР¶РµРЅРёР№ вЂ” СЃРѕРѕР±С‰РµРЅРёРµ РїСѓСЃС‚РѕРµ
  // (РЅР°РїСЂРёРјРµСЂ, РІСЃРµ URL РІР»РѕР¶РµРЅРёР№ РѕРєР°Р·Р°Р»РёСЃСЊ РѕРїР°СЃРЅС‹РјРё Рё Р±С‹Р»Рё РѕС‚Р±СЂРѕС€РµРЅС‹).
  if (!msgContent && normAttachments.length === 0 && !poll) {
    return res.status(400).json({ message: 'РџСѓСЃС‚РѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' });
  }

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
    // РЎС‚РёРєРµСЂ: СЃСЃС‹Р»РєСѓ РЅР° РЅР°Р±РѕСЂ СЃС‚Р°РІРёС‚ СЃРµСЂРІРµСЂ (stickers.js), РїСЂРё РїРµСЂРµСЃС‹Р»РєРµ вЂ” РєРѕРїРёСЏ РёР· РёСЃС…РѕРґРЅРѕРіРѕ.
    ...(forwardedMessage?.sticker ? { sticker: forwardedMessage.sticker } : internal?.sticker ? { sticker: internal.sticker } : {}),
    ...(poll ? { type: 'poll', poll: { question: poll.question.trim().slice(0, 500), multiple: Boolean(poll.multiple), options: poll.options.map((option, index) => ({ id: String(option.id || index + 1), text: String(option.text || '').trim().slice(0, 200), votes: 0, voterIds: [] })).filter(option => option.text).slice(0, 10) } } : {}),
    readBy: [userId],
    editedAt: null,
    isEdited: false,
    isPinned: false,
    isDeleted: false,
    createdAt: new Date().toISOString(),
  };
  message.integrityHash = messageIntegrityHash(message);
  db.messages.push(message);
  try { saveDb(); } catch {
    db.messages = db.messages.filter(m => m !== message);
    return res.status(500).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ' });
  }

  const sender = messageSender(message);
  const result = { ...message, sender };

  // РЎР°Р¶Р°РµРј СЃРѕРєРµС‚С‹ СѓС‡Р°СЃС‚РЅРёРєРѕРІ РІ РєРѕРјРЅР°С‚Сѓ С‡Р°С‚Р° РїРµСЂРµРґ СЂР°СЃСЃС‹Р»РєРѕР№: С‡Р°С‚ РјРѕРі Р±С‹С‚СЊ
  // СЃРѕР·РґР°РЅ РџРћРЎР›Р• РёС… РєРѕРЅРЅРµРєС‚Р°, Рё С‚РѕРіРґР° СЃРѕР±РµСЃРµРґРЅРёРє РЅРµ СЃРѕСЃС‚РѕСЏР» РІ РєРѕРјРЅР°С‚Рµ Рё
  // РїРµСЂРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РЅРµ РґРѕС…РѕРґРёР»Рѕ РґРѕ РЅРµРіРѕ Р±РµР· РїРµСЂРµР·Р°РіСЂСѓР·РєРё СЃС‚СЂР°РЅРёС†С‹.
  // typeof вЂ” РїРѕС‚РѕРјСѓ С‡С‚Рѕ vm-С‚РµСЃС‚С‹ РІС‹СЂРµР·Р°СЋС‚ СЌС‚РѕС‚ РєСѓСЃРѕРє Р±РµР· userSockets.
  if (typeof userSockets !== 'undefined') {
    for (const m of db.chatMembers.filter((m) => m.chatId === chatId)) {
      for (const sid of userSockets.get(m.userId) || []) {
        io.to(sid).socketsJoin?.(`chat:${chatId}`);
      }
    }
  }
  io.to(`chat:${chatId}`).emit('message:new', result);
  res.status(201).json(result);
  // Р›РёС‡РєР° СЃ Р±РѕС‚РѕРј: СЃРѕР±С‹С‚РёРµ РґР»СЏ Bot API РёР»Рё РѕС‚РІРµС‚ РІСЃС‚СЂРѕРµРЅРЅРѕРіРѕ /hub.
  // typeof вЂ” vm-С‚РµСЃС‚С‹ РІС‹СЂРµР·Р°СЋС‚ СЌС‚РѕС‚ СѓС‡Р°СЃС‚РѕРє Р±РµР· РјРѕРґСѓР»СЏ Р±РѕС‚РѕРІ.
  if (typeof botsModule !== 'undefined' && botsModule) botsModule.onMessage(message);
}

// POST /api/messages/:chatId  (base route)
app.post('/api/messages/:chatId', authMiddleware, (req, res) => {
  handleSendMessage(req.params.chatId, req.userId, req.body, res);
});

// POST /api/messages/:chatId/send  (route used by client)
app.post('/api/messages/:chatId/send', authMiddleware, (req, res) => {
  handleSendMessage(req.params.chatId, req.userId, req.body, res);
});

// РћС‚Р»РѕР¶РµРЅРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ (/time Р§Р§:РњРњ:РЎРЎ "С‚РµРєСЃС‚"): РѕС‡РµСЂРµРґСЊ РІ db.scheduledMessages,
// РґРѕСЃС‚Р°РІРєР° РЅР° СЃРµСЂРІРµСЂРµ С‚РµРј Р¶Рµ handleSendMessage вЂ” РѕС‚РїСЂР°РІРёС‚РµР»СЋ РЅРµ РЅСѓР¶РЅРѕ Р±С‹С‚СЊ РѕРЅР»Р°Р№РЅ.
// typeof вЂ” vm-С‚РµСЃС‚С‹ РІС‹СЂРµР·Р°СЋС‚ СЌС‚РѕС‚ СѓС‡Р°СЃС‚РѕРє Р±РµР· require.
if (typeof require === 'function') {
  require('./scheduled-messages').registerScheduledMessages({
    app, getDb: () => db, auth: authMiddleware, saveDb, handleSendMessage,
  });
}

// POST /api/messages/:id/poll-vote вЂ” РіРѕР»РѕСЃРѕРІР°РЅРёРµ РІ РѕРїСЂРѕСЃРµ РєР°РЅР°Р»Р°.
app.post('/api/messages/:id/poll-vote', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id && !m.isDeleted);
  if (!msg || msg.type !== 'poll' || !msg.poll) return res.status(404).json({ message: 'РћРїСЂРѕСЃ РЅРµ РЅР°Р№РґРµРЅ' });
  const member = db.chatMembers.find(m => m.chatId === msg.chatId && m.userId === req.userId);
  if (!member) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  if (!db.chats.some(c => c.id === msg.chatId && c.type === 'channel')) return res.status(400).json({ message: 'РћРїСЂРѕСЃ РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ РІ РєР°РЅР°Р»Рµ' });
  const selected = req.body?.optionIds;
  if (!Array.isArray(selected) || selected.length > msg.poll.options.length || new Set(selected).size !== selected.length ||
      selected.some(id => typeof id !== 'string' || !msg.poll.options.some(o => o.id === id))) {
    return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РІР°СЂРёР°РЅС‚С‹ РѕС‚РІРµС‚Р°' });
  }
  if (!selected.length || (!msg.poll.multiple && selected.length > 1)) return res.status(400).json({ message: 'Р’С‹Р±РµСЂРёС‚Рµ РІР°СЂРёР°РЅС‚ РѕС‚РІРµС‚Р°' });
  const alreadyVoted = msg.poll.options.some(o => (o.voterIds || []).includes(req.userId));
  if (alreadyVoted) return res.status(409).json({ message: 'Р’С‹ СѓР¶Рµ РіРѕР»РѕСЃРѕРІР°Р»Рё' });
  const previousPoll = msg.poll;
  msg.poll = { ...previousPoll, options: previousPoll.options.map(o => ({ ...o, voterIds: [...(o.voterIds || [])] })) };
  selected.forEach(id => {
    const option = msg.poll.options.find(o => o.id === id);
    option.voterIds = option.voterIds || [];
    option.voterIds.push(req.userId);
    option.votes = option.voterIds.length;
  });
  try { saveDb(); } catch { msg.poll = previousPoll; return res.status(500).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РіРѕР»РѕСЃ' }); }
  const result = { ...msg, sender: messageSender(msg) };
  io.to(`chat:${msg.chatId}`).emit('message:edited', result);
  res.json(result);
});


// PUT /api/messages/:id  (edit)
// SEC: С‚РѕР»СЊРєРѕ Р°РІС‚РѕСЂ, РѕРєРЅРѕ 48С‡, РґР»РёРЅР° в‰¤ 4096.
app.put('/api/messages/:id', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅРѕ' });
  const member = db.chatMembers.find(m => m.chatId === msg.chatId && m.userId === req.userId);
  const canModerate = hasGroupRight(member, 'editMessages');
  if (!member || (msg.senderId !== req.userId && !canModerate)) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ' });
  if (msg.isDeleted) return res.status(400).json({ message: 'РЎРѕРѕР±С‰РµРЅРёРµ СѓРґР°Р»РµРЅРѕ' });
  const age = Date.now() - new Date(msg.createdAt).getTime();
  if (!canModerate && age > EDIT_WINDOW_MS) return res.status(403).json({ message: 'РћРєРЅРѕ СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёСЏ РёСЃС‚РµРєР»Рѕ' });
  const text = String(req.body?.text ?? '');
  if (text.length > MESSAGE_MAX_LEN) return res.status(400).json({ message: 'РЎРѕРѕР±С‰РµРЅРёРµ СЃР»РёС€РєРѕРј РґР»РёРЅРЅРѕРµ' });
  msg.text = text;
  msg.content = msg.text;
  msg.editedAt = new Date().toISOString();
  msg.isEdited = true;
  msg.integrityHash = messageIntegrityHash(msg);
  saveDb();
  const sender = messageSender(msg);
  // РќРѕСЂРјР°Р»РёР·СѓРµРј С‚Р°Рє Р¶Рµ, РєР°Рє РІ GET /api/messages/:chatId (РєР»РёРµРЅС‚ С‡РёС‚Р°РµС‚ content)
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
  if (idx === -1) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅРѕ' });
  const membership = db.chatMembers.find(m => m.chatId === db.messages[idx].chatId && m.userId === req.userId);
  if (!membership || (db.messages[idx].senderId !== req.userId && !hasGroupRight(membership, 'deleteMessages'))) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ' });
  const msg = db.messages[idx];
  moderation.archive(db, [msg], req.userId, { uploadsDir: UPLOADS_DIR });
  db.messages.splice(idx, 1);
  const chat = db.chats.find(c => c.id === msg.chatId);
  if (chat?.pinnedMessageId === msg.id || (chat && pinnedMessageIds(chat).includes(msg.id))) {
    chat.pinnedMessageIds = pinnedMessageIds(chat).filter(id => id !== msg.id);
    syncPinnedMessages(chat);
    io.to(`chat:${msg.chatId}`).emit('message:pinned', pinnedPayload(chat, null));
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
// РћС‚РјРµС‡Р°РµС‚ РїСЂРѕС‡РёС‚Р°РЅРЅС‹РјРё Р’РЎР• СЃРѕРѕР±С‰РµРЅРёСЏ С‡Р°С‚Р° Р”Рћ СѓРєР°Р·Р°РЅРЅРѕРіРѕ РІРєР»СЋС‡РёС‚РµР»СЊРЅРѕ.
// Р Р°РЅСЊС€Рµ РїРѕРјРµС‡Р°Р»РѕСЃСЊ С‚РѕР»СЊРєРѕ РѕРґРЅРѕ СЃРѕРѕР±С‰РµРЅРёРµ в†’ unreadCount СЃС‡РёС‚Р°Р»СЃСЏ РЅРµРїСЂР°РІРёР»СЊРЅРѕ
// Рё РїРѕСЃР»Рµ РїРµСЂРµР·Р°РіСЂСѓР·РєРё РІРµСЃСЊ Р±СЌРєР»РѕРі СЃРЅРѕРІР° Р±С‹Р» В«РЅРµРїСЂРѕС‡РёС‚Р°РЅВ».
app.post('/api/messages/:id/read', authMiddleware, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅРѕ' });
  
  // SEC: РїСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЏРІР»СЏРµС‚СЃСЏ СѓС‡Р°СЃС‚РЅРёРєРѕРј С‡Р°С‚Р° (Р·Р°С‰РёС‚Р° РѕС‚ IDOR)
  const isMember = db.chatMembers.find(m => m.chatId === msg.chatId && m.userId === req.userId);
  const currentUser = db.users.find(u => u.id === req.userId);
  const isAdmin = currentUser?.isAdmin === true;
  if (!isMember && !isAdmin) {
    return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕРјСѓ С‡Р°С‚Сѓ' });
  }
  
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

// в”Ђв”Ђв”Ђ FILES routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// GET /api/call-log вЂ” РёСЃС‚РѕСЂРёСЏ Р·РІРѕРЅРєРѕРІ
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

app.post('/api/files/upload', authMiddleware, uploadFile.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Р¤Р°Р№Р» РЅРµ Р·Р°РіСЂСѓР¶РµРЅ' });
  if (dropIfActiveContent(req, res)) return;
  // Р¤РѕС‚Рѕ СЃР¶РёРјР°РµРј РєР°Рє РІ Telegram; compress=0 РІ С„РѕСЂРјРµ вЂ” РѕС‚РїСЂР°РІРєР° РѕСЂРёРіРёРЅР°Р»РѕРј.
  await compressStoredUpload(req.file, { enabled: wantsCompression(req.body) });
  res.json({
    url: `/uploads/files/${req.file.filename}`,
    sha256: req.file.sha256,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
});

// POST /api/files/upload-base64  вЂ” СЃРѕС…СЂР°РЅРёС‚СЊ base64-РєР°СЂС‚РёРЅРєСѓ РєР°Рє С„Р°Р№Р»
app.post('/api/files/upload-base64', authMiddleware, (req, res) => {
  const { data, fileName, mimeType } = req.body;
  if (typeof data !== 'string' || data.length > 8 * 1024 * 1024) {
    return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РёР»Рё СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РёРµ РґР°РЅРЅС‹Рµ' });
  }

  // РџСЂРёРЅРёРјР°РµРј С‚РѕР»СЊРєРѕ Р±РµР·РѕРїР°СЃРЅС‹Рµ СЂР°СЃС‚СЂРѕРІС‹Рµ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ. MIME РѕС‚ РєР»РёРµРЅС‚Р° СЃР°Рј РїРѕ
  // СЃРµР±Рµ РЅРµ СЏРІР»СЏРµС‚СЃСЏ РґРѕРєР°Р·Р°С‚РµР»СЊСЃС‚РІРѕРј С‚РёРїР° С„Р°Р№Р»Р°, РїРѕСЌС‚РѕРјСѓ РїСЂРѕРІРµСЂСЏРµРј Рё СЃРёРіРЅР°С‚СѓСЂСѓ.
  const match = data.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return res.status(400).json({ message: 'Р Р°Р·СЂРµС€РµРЅС‹ С‚РѕР»СЊРєРѕ PNG, JPEG, GIF Рё WebP' });
  const actualMime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');
  if (!base64 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ base64-СЃС‚СЂРѕРєР°' });
  }
  const buf = Buffer.from(base64, 'base64');
  if (buf.toString('base64') !== base64) {
    return res.status(400).json({ message: 'Invalid base64 encoding' });
  }
  if (!buf.length || buf.length > 5 * 1024 * 1024) {
    return res.status(413).json({ message: 'РР·РѕР±СЂР°Р¶РµРЅРёРµ СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕРµ' });
  }
  const isPng = actualMime === 'image/png' && buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpeg = actualMime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  const isGif = actualMime === 'image/gif' && (buf.subarray(0, 6).toString() === 'GIF87a' || buf.subarray(0, 6).toString() === 'GIF89a');
  const isWebp = actualMime === 'image/webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!(isPng || isJpeg || isGif || isWebp)) {
    return res.status(400).json({ message: 'РЎРѕРґРµСЂР¶РёРјРѕРµ С„Р°Р№Р»Р° РЅРµ СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓРµС‚ С‚РёРїСѓ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ' });
  }
  const ext = actualMime === 'image/jpeg' ? 'jpg' : actualMime.split('/')[1];
  const filename = uuidv4() + '.' + ext;
  const subfolder = 'avatars';
  const dest = path.join(UPLOADS_DIR, subfolder, filename);
  let cleanImage;
  try { cleanImage = stripImageMetadata(buf, actualMime); }
  catch (err) { return res.status(400).json({ message: err.message }); }
  fs.writeFileSync(dest, cleanImage);
  res.json({
    url: `/uploads/${subfolder}/${filename}`,
    originalName: fileName || filename,
    size: cleanImage.length,
    sha256: crypto.createHash('sha256').update(cleanImage).digest('hex'),
    mimeType: actualMime,
  });
});

// в”Ђв”Ђв”Ђ MUSIC routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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

// GET /api/music/:id  вЂ” РїРѕР»СѓС‡РёС‚СЊ РѕРґРёРЅ С‚СЂРµРє (РґР»СЏ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ Р·Р°РєСЂРµРїР»С‘РЅРЅРѕРіРѕ С‚СЂРµРєР° РЅР° РїСЂРѕС„РёР»Рµ).
app.get('/api/music/:id', authMiddleware, (req, res) => {
  const track = db.tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ message: 'РўСЂРµРє РЅРµ РЅР°Р№РґРµРЅ' });
  if (track.uploadedById !== req.userId && !track.isPublic) {
    return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‚СЂРµРєСѓ' });
  }
  const uploadedBy = db.users.find(u => u.id === track.uploadedById) || null;
  res.json({ ...track, uploadedBy });
});

// POST /api/music/upload
app.post('/api/music/upload', authMiddleware, uploadMusic.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Р¤Р°Р№Р» РЅРµ Р·Р°РіСЂСѓР¶РµРЅ' });
  if (dropIfActiveContent(req, res)) return;

  const { title, artist, album, duration } = req.body;
  const track = {
    id: uuidv4(),
    title: title || req.file.originalname.replace(/\.[^.]+$/, ''),
    artist: artist || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№',
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
  if (!track) return res.status(404).json({ message: 'РўСЂРµРє РЅРµ РЅР°Р№РґРµРЅ' });
  if (track.uploadedById !== req.userId && !track.isPublic) {
    return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  }
  track.playsCount = (track.playsCount || 0) + 1;
  saveDb();
  res.json({ success: true });
});

// PATCH /api/music/:id  (edit track metadata / cover)
app.patch('/api/music/:id', authMiddleware, uploadMusic.single('cover'), (req, res) => {
  const track = db.tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ message: 'РўСЂРµРє РЅРµ РЅР°Р№РґРµРЅ' });
  if (track.uploadedById !== req.userId) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ' });
  if (req.file && dropIfActiveContent(req, res)) return;

  const { title, artist, album, description } = req.body;
  if (title !== undefined) track.title = String(title).trim() || track.title;
  if (artist !== undefined) track.artist = String(artist).trim() || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№';
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
  if (idx === -1) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅРѕ' });
  if (db.tracks[idx].uploadedById !== req.userId) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ' });
  const [track] = db.tracks.splice(idx, 1);
  // Optionally delete file
  const filePath = path.join(UPLOADS_DIR, 'music', path.basename(track.fileUrl));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  saveDb();
  res.json({ success: true });
});

// в”Ђв”Ђв”Ђ MUSIC: import from URL / import ZIP / playlist zip в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const archiver = require('archiver');
const { spawn } = require('child_process');

// ZIP import is rejected by the early middleware; no archive parser is loaded.

// POST /api/music/import-url вЂ” СЃРєР°С‡Р°С‚СЊ Р°СѓРґРёРѕ РїРѕ СЃСЃС‹Р»РєРµ С‡РµСЂРµР· yt-dlp.
// РўСЂРµР±СѓРµС‚ yt-dlp Рё ffmpeg РІ PATH. Р›РёРјРёС‚ вЂ” 6 РјРёРЅСѓС‚.
app.post('/api/music/import-url', authMiddleware, express.json(), async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ URL' });

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
    const isNotFound = meta.stderr.includes('not found') || meta.stderr.includes('РЅРµ СЏРІР»СЏРµС‚СЃСЏ') || meta.code === -1;
    return res.status(500).json({
      message: isNotFound 
        ? 'вќЊ yt-dlp РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ. РЈСЃС‚Р°РЅРѕРІРёС‚Рµ: npm install -g yt-dlp РёР»Рё СЃРєР°С‡Р°Р№С‚Рµ СЃ github.com/yt-dlp/yt-dlp'
        : 'РЎСЃС‹Р»РєР° РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ РёР»Рё РЅРµРґРѕСЃС‚СѓРїРЅР°',
      detail: (meta.stderr || '').slice(0, 500),
      help: isNotFound ? 'Windows: scoop install yt-dlp ffmpeg | Linux: sudo apt install yt-dlp ffmpeg' : undefined,
    });
  }
  let info;
  try { info = JSON.parse(meta.stdout); }
  catch { return res.status(500).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°Р·РѕР±СЂР°С‚СЊ РјРµС‚Р°РґР°РЅРЅС‹Рµ' }); }
  const duration = Number(info.duration) || 0;
  if (duration <= 0) return res.status(400).json({ message: 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ' });
  if (duration > 360) return res.status(400).json({ message: 'Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ Р±РѕР»РµРµ 6 РјРёРЅСѓС‚ вЂ” РёРјРїРѕСЂС‚ Р·Р°РїСЂРµС‰С‘РЅ' });

  const title = String(info.title || 'РРјРїРѕСЂС‚').slice(0, 200);
  const artist = String(info.uploader || info.channel || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№').slice(0, 200);

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
    const isNotFound = dl.stderr.includes('not found') || dl.stderr.includes('РЅРµ СЏРІР»СЏРµС‚СЃСЏ') || dl.code === -1;
    return res.status(500).json({
      message: isNotFound
        ? 'вќЊ ffmpeg РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ. РЈСЃС‚Р°РЅРѕРІРёС‚Рµ: scoop install ffmpeg (Windows) РёР»Рё sudo apt install ffmpeg (Linux)'
        : 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєР°С‡Р°С‚СЊ Р°СѓРґРёРѕ. РџСЂРѕРІРµСЂСЊС‚Рµ СЃСЃС‹Р»РєСѓ РёР»Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ РґСЂСѓРіСѓСЋ.',
      detail: (dl.stderr || '').slice(0, 500),
    });
  }
  const filename = baseName + '.mp3';
  const finalPath = path.join(musicDir, filename);
  if (!fs.existsSync(finalPath)) {
    const alt = fs.readdirSync(musicDir).find(f => f.startsWith(baseName + '.'));
    if (!alt) return res.status(500).json({ message: 'Р¤Р°Р№Р» РЅРµ РїРѕСЏРІРёР»СЃСЏ РЅР° РґРёСЃРєРµ' });
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

// GET /api/music/playlists/:id/zip вЂ” СЃРєР°С‡Р°С‚СЊ РїР»РµР№Р»РёСЃС‚ Р°СЂС…РёРІРѕРј.
app.get('/api/music/playlists/:id/zip', authMiddleware, (req, res) => {
  const playlist = (db.playlists || []).find(p =>
    p.id === req.params.id && (p.userId === req.userId || p.isPublic));
  if (!playlist) return res.status(404).json({ message: 'РџР»РµР№Р»РёСЃС‚ РЅРµ РЅР°Р№РґРµРЅ' });
  const trackIds = playlist.trackIds || [];
  const tracks = trackIds.map(id => db.tracks.find(t => t.id === id)).filter(Boolean);
  if (!tracks.length) return res.status(400).json({ message: 'РџР»РµР№Р»РёСЃС‚ РїСѓСЃС‚' });

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




// в”Ђв”Ђв”Ђ PLAYLISTS routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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
  if (!name) return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ' });
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
  if (!playlist) return res.status(404).json({ message: 'РџР»РµР№Р»РёСЃС‚ РЅРµ РЅР°Р№РґРµРЅ' });
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

// GET /api/playlists/:id вЂ” С‡РёС‚Р°С‚СЊ РѕРґРёРЅРѕС‡РЅС‹Р№ РїР»РµР№Р»РёСЃС‚.
// РЎРІРѕР№ вЂ” РІСЃРµРіРґР°, С‡СѓР¶РѕР№ вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё isPublic.
function getPlaylistOne(req, res) {
  const p = (db.playlists || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  if (p.userId !== req.userId && !p.isPublic) return res.status(403).json({ message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
  res.json(playlistWithTracks(p));
}
app.get('/api/music/playlists/:id', authMiddleware, getPlaylistOne);
app.get('/api/playlists/:id', authMiddleware, getPlaylistOne);


// POST /api/music/playlists/:id/tracks
function addTrackToPlaylist(req, res) {
  const playlist = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.userId);
  if (!playlist) return res.status(404).json({ message: 'РџР»РµР№Р»РёСЃС‚ РЅРµ РЅР°Р№РґРµРЅ' });
  const { trackId } = req.body;
  if (!trackId) return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ trackId' });
  const track = db.tracks.find(t => t.id === trackId);
  if (!track) return res.status(404).json({ message: 'РўСЂРµРє РЅРµ РЅР°Р№РґРµРЅ' });
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
  if (!playlist) return res.status(404).json({ message: 'РџР»РµР№Р»РёСЃС‚ РЅРµ РЅР°Р№РґРµРЅ' });
  playlist.trackIds = playlist.trackIds.filter(id => id !== req.params.trackId);
  playlist.updatedAt = new Date().toISOString();
  saveDb();
  res.json(playlistWithTracks(playlist));
}
app.delete('/api/music/playlists/:id/tracks/:trackId', authMiddleware, removeTrackFromPlaylist);
app.delete('/api/playlists/:id/tracks/:trackId', authMiddleware, removeTrackFromPlaylist);

function reorderPlaylist(req, res) {
  const playlist = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.userId);
  if (!playlist) return res.status(404).json({ message: 'РџР»РµР№Р»РёСЃС‚ РЅРµ РЅР°Р№РґРµРЅ' });
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
  if (idx === -1) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  db.playlists.splice(idx, 1);
  saveDb();
  res.json({ success: true });
}
app.delete('/api/music/playlists/:id', authMiddleware, deletePlaylist);
app.delete('/api/playlists/:id', authMiddleware, deletePlaylist);

// в”Ђв”Ђв”Ђ BOTS / AI / VOICE routes (РїСЂРёРјРёС‚РёРІРЅС‹Рµ, РЅРѕ СЂР°Р±РѕС‡РёРµ) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// Р‘РѕС‚С‹ (/api/bots/*, Bot API /bot<token>/*) вЂ” РјРѕРґСѓР»СЊ bots.js, СЂРµРіРёСЃС‚СЂРёСЂСѓРµС‚СЃСЏ
// РїРѕСЃР»Рµ СЃРѕР·РґР°РЅРёСЏ io (СЃРј. Р±Р»РѕРє Socket.io РЅРёР¶Рµ).

// AI: РїСЂРѕСЃС‚РѕР№ С‚РµРєСЃС‚РѕРІС‹Р№ С‡Р°С‚ (Р±РµР· РІРЅРµС€РЅРёС… РЅРµР№СЂРѕСЃРµС‚РµР№, РЅРѕ СЂР°Р±РѕС‡РёР№)
app.get('/api/ai/models', authMiddleware, (req, res) => {
  res.json((db.aiModels || []).filter(m => m.ownerId === req.userId));
});
app.post('/api/ai/models', authMiddleware, (req, res) => {
  const { name, description } = req.body || {};
  const model = {
    id: uuidv4(),
    ownerId: req.userId,
    name: name || 'РњРѕРґРµР»СЊ',
    description: description || '',
    createdAt: new Date().toISOString(),
  };
  if (!db.aiModels) db.aiModels = [];
  db.aiModels.push(model);
  saveDb();
  res.status(201).json(model);
});
app.post('/api/ai/models/:id/files', authMiddleware, uploadFile.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Р¤Р°Р№Р» РЅРµ Р·Р°РіСЂСѓР¶РµРЅ' });
  if (dropIfActiveContent(req, res)) return;
  res.json({ message: 'Р¤Р°Р№Р» РїСЂРёРЅСЏС‚', fileName: req.file.filename });
});
app.post('/api/ai/models/:id/train', authMiddleware, (req, res) => {
  res.json({ message: 'РћР±СѓС‡РµРЅРёРµ Р·Р°РїСѓС‰РµРЅРѕ' });
});
app.post('/api/ai/chat', authMiddleware, (req, res) => {
  const text = String(req.body?.message || '');
  res.json({
    reply: `РџСЂРёРІРµС‚! РЇ СѓРїСЂРѕС‰С‘РЅРЅС‹Р№ РР VERA. РўС‹ РЅР°РїРёСЃР°Р»(Р°): В«${text.slice(0, 100)}В». РџРѕР»РЅР°СЏ РЅРµР№СЂРѕСЃРµС‚СЊ РїРѕРґРєР»СЋС‡Р°РµС‚СЃСЏ РІ Server/ai-engine.`,
  });
});
app.get('/api/ai/stats', authMiddleware, (req, res) => {
  res.json({ models: (db.aiModels || []).length, sessions: (db.aiSessions || []).length });
});

// в”Ђв”Ђв”Ђ AI Theme Generator в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РЎС‚РѕРёРјРѕСЃС‚СЊ: 50в‚Ѕ / 10 С‚РµРј = 5в‚Ѕ Р·Р° С‚РµРјСѓ = 10 Р’Рџ (VP_PER_RUB=2).
const AI_THEME_COST_VP = 10;

// РџСЂРѕСЃС‚РѕР№ Р»РѕРєР°Р»СЊРЅС‹Р№ РіРµРЅРµСЂР°С‚РѕСЂ С‚РµРјС‹ РїРѕ РѕРїРёСЃР°РЅРёСЋ: СЂР°Р·Р±РёСЂР°РµС‚ РєР»СЋС‡РµРІС‹Рµ СЃР»РѕРІР°
// (С†РІРµС‚РѕРІС‹Рµ/РЅР°СЃС‚СЂРѕРµРЅС‡РµСЃРєРёРµ) Рё СЃРѕР±РёСЂР°РµС‚ СЃРѕРіР»Р°СЃРѕРІР°РЅРЅСѓСЋ РїР°Р»РёС‚СЂСѓ. Р Р°Р±РѕС‚Р°РµС‚ Р±РµР·
// РІРЅРµС€РЅРёС… СЃРµСЂРІРёСЃРѕРІ Рё РіР°СЂР°РЅС‚РёСЂСѓРµС‚ РІР°Р»РёРґРЅС‹Р№ Theme РЅР° РІС‹С…РѕРґРµ.
function generateThemeLocal(desc) {
  const s = String(desc || '').toLowerCase();
  // Р‘Р°Р·РѕРІС‹Рµ РїР°Р»РёС‚СЂС‹ РїРѕ РєР»СЋС‡РµРІС‹Рј СЃР»РѕРІР°Рј (РїРѕСЂСЏРґРѕРє = РїСЂРёРѕСЂРёС‚РµС‚; s РІ lowercase)
  const palettes = [
    { keys: ['РЅРµРѕРЅ', 'РєРёР±РµСЂРїР°РЅРє', 'cyberpunk', 'neon'], bg:'#0a0016', accent:'#ff2ec4', accent2:'#00e5ff', dark:true },
    { keys: ['РєСЂР°СЃРЅ', 'Р°Р»С‹Р№', 'Р±Р°РіСЂ', 'РІРёС€РЅ', 'РіСЂР°РЅР°С‚', 'red', 'crimson', 'scarlet'], bg:'#1c0a0a', accent:'#ff4d5e', accent2:'#ff9a5c', dark:true },
    { keys: ['РѕСЂР°РЅР¶', 'РјР°РЅРґР°СЂРёРЅ', 'СЏРЅС‚Р°СЂ', 'Р°РїРµР»СЊСЃРёРЅ', 'orange', 'amber'], bg:'#1a0f05', accent:'#ff8a3d', accent2:'#ffd23d', dark:true },
    { keys: ['Р¶С‘Р»С‚', 'Р¶РµР»С‚', 'Р»РёРјРѕРЅ', 'СЃРѕР»РЅС†', 'yellow', 'lemon'], bg:'#171204', accent:'#ffd83d', accent2:'#a3e635', dark:true },
    { keys: ['Р·РµР»С‘РЅ', 'Р·РµР»РµРЅ', 'С‚СЂР°РІ', 'РјСЏС‚', 'Р»Р°Р№Рј', 'РёР·СѓРјСЂСѓРґ', 'green', 'emerald', 'mint', 'lime'], bg:'#0a1610', accent:'#4ade80', accent2:'#a3e635', dark:true },
    { keys: ['Р±РёСЂСЋР·', 'Р°РєРІР°', 'teal', 'turquoise', 'aqua'], bg:'#04161a', accent:'#2dd4bf', accent2:'#7dffb2', dark:true },
    { keys: ['РіРѕР»СѓР±', 'РЅРµР±РµСЃ', 'РЅРµР±Р°', 'azure', 'sky', 'cyan'], bg:'#061624', accent:'#38bdf8', accent2:'#7dffe3', dark:true },
    { keys: ['СЃРёРЅ', 'blue', 'indigo', 'РёРЅРґРёРіРѕ'], bg:'#081226', accent:'#4d7cff', accent2:'#38bdf8', dark:true },
    { keys: ['РѕРєРµР°РЅ', 'РјРѕСЂРµ', 'РІРѕРґР°', 'ocean', 'water', 'РјРѕСЂСЃРє'], bg:'#001a2c', accent:'#00c2ff', accent2:'#7dffb2', dark:true },
    { keys: ['С„РёРѕР»РµС‚', 'Р»Р°РІР°РЅРґ', 'СЃРёСЂРµРЅ', 'Р°РјРµС‚РёСЃС‚', 'purple', 'violet', 'lavender', 'lilac'], bg:'#12081f', accent:'#9b6bff', accent2:'#e879f9', dark:true },
    { keys: ['РєРѕСЃРјРѕСЃ', 'РіР°Р»Р°РєС‚РёРєР°', 'space', 'galaxy', 'РІСЃРµР»РµРЅРЅ'], bg:'#05061a', accent:'#8a5cff', accent2:'#ff5cf0', dark:true },
    { keys: ['СЂРѕР·РѕРІ', 'РјР°Р»РёРЅ', 'pink', 'rose'], bg:'#1c0a14', accent:'#ff6fae', accent2:'#c084fc', dark:true },
    { keys: ['Р·Р°РєР°С‚', 'СЂР°СЃСЃРІРµС‚', 'sunset', 'dawn'], bg:'#1a0810', accent:'#ff6b3d', accent2:'#ffd23d', dark:true },
    { keys: ['РѕРіРѕРЅСЊ', 'РїР»Р°РјСЏ', 'fire', 'flame', 'Р»Р°РІР°'], bg:'#160505', accent:'#ff5a2e', accent2:'#ffcf3d', dark:true },
    { keys: ['Р»РµСЃ', 'РїСЂРёСЂРѕРґ', 'forest', 'nature'], bg:'#0d1a0f', accent:'#7dff8a', accent2:'#c8ff7d', dark:true },
    { keys: ['РІРµСЃРЅ', 'spring'], bg:'#0f1a12', accent:'#86efac', accent2:'#fda4af', dark:true },
    { keys: ['РѕСЃРµРЅ', 'autumn', 'fall'], bg:'#171008', accent:'#e8a94b', accent2:'#d97706', dark:true },
    { keys: ['Р·РёРјРЅ', 'winter', 'Р»С‘Рґ', 'Р»РµРґ'], bg:'#0a1220', accent:'#93c5fd', accent2:'#e0f2fe', dark:true },
    { keys: ['РєРѕСЂРёС‡', 'РєРѕС„Рµ', 'С€РѕРєРѕР»Р°Рґ', 'РєРѕСЂРёС†Р°', 'brown', 'coffee', 'chocolate'], bg:'#161009', accent:'#c08552', accent2:'#e8c39e', dark:true },
    { keys: ['СЂРµС‚СЂРѕ', 'РІРёРЅС‚Р°Р¶', 'retro', 'vintage'], bg:'#1c1410', accent:'#e8a94b', accent2:'#c96f4a', dark:true },
    { keys: ['РіРѕС‚РёРє', 'РјСЂР°С‡РЅ', 'gothic', 'noir'], bg:'#050208', accent:'#a020f0', accent2:'#ff2050', dark:true },
    { keys: ['С‡С‘СЂРЅ', 'С‡РµСЂРЅ', 'black', 'СѓРіРѕР»СЊ'], bg:'#0c0c12', accent:'#8a9bff', accent2:'#5cf0d0', dark:true },
    { keys: ['СЃРµСЂС‹Р№', 'СЃРµСЂР°СЏ', 'СЃРµСЂС‹Рµ', 'СЃС‚Р°Р»СЊ', 'silver', 'steel', 'grey', 'gray'], bg:'#10141a', accent:'#9aa8bd', accent2:'#c3cddb', dark:true },
    { keys: ['РїР°СЃС‚РµР»', 'РЅРµР¶РЅ', 'pastel', 'soft'], bg:'#fdf6f9', accent:'#ff8fb7', accent2:'#a0c8ff', dark:false },
    { keys: ['РјРёРЅРёРјР°Р»', 'С‡РёСЃС‚', 'minimal', 'clean'], bg:'#f7f8fb', accent:'#5b7cff', accent2:'#a97dff', dark:false },
    { keys: ['СЃРІРµС‚Р»', 'Р±РµР»', 'light', 'white', 'СЃРЅРµР¶'], bg:'#f5f7fb', accent:'#3b82f6', accent2:'#8b5cf6', dark:false },
    { keys: ['Р·РѕР»РѕС‚', 'СЂРѕСЃРєРѕС€', 'gold', 'royal', 'Р»СЋРєСЃ', 'РїСЂРµРјРёСѓРј'], bg:'#12100a', accent:'#f5c94b', accent2:'#c9a44a', dark:true },
    { keys: ['СЂР°РґСѓРі', 'rainbow', 'СЂР°Р·РЅРѕС†РІ'], bg:'#0d0d18', accent:'#f43f5e', accent2:'#38bdf8', dark:true },
  ];
  const hit = palettes.find(p => p.keys.some(k => s.includes(k)));
  // РќР°СЃС‚СЂРѕРµРЅРёРµ: СЃР»РѕРІР° В«СЃРІРµС‚Р»С‹Р№/С‚С‘РјРЅС‹Р№В» РїРµСЂРµРѕРїСЂРµРґРµР»СЏСЋС‚ СЂРµР¶РёРј
  const wantsLight = /СЃРІРµС‚Р»|Р±РµР»|РґРЅРµРІРЅ|light|white/.test(s);
  const wantsDark = /С‚С‘РјРЅ|С‚РµРјРЅ|РЅРѕС‡|РјСЂР°С‡РЅ|dark|black/.test(s);
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
  // РџСЂСЏРјРѕР№ hex-РєРѕРґ РІ РѕРїРёСЃР°РЅРёРё (В«СЃРґРµР»Р°Р№ С‚РµРјСѓ #34bf5eВ»)
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
    // Р¤РѕР»Р±СЌРє: РґРµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅС‹Р№ С…РµС€ РѕРїРёСЃР°РЅРёСЏ в†’ СѓРЅРёРєР°Р»СЊРЅС‹Р№ РѕС‚С‚РµРЅРѕРє.
    // Р Р°Р·РЅС‹Рµ РѕРїРёСЃР°РЅРёСЏ РґР°СЋС‚ СЂР°Р·РЅС‹Рµ С‚РµРјС‹ вЂ” РґРµС„РѕР»С‚РЅРѕРіРѕ В«СЂРѕР·РѕРІРѕРіРѕВ» Р±РѕР»СЊС€Рµ РЅРµС‚.
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
    id: 0, // РєР»РёРµРЅС‚ РїРѕРґСЃС‚Р°РІРёС‚ СЃРІРѕР№
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
  if (!description) return res.status(400).json({ message: 'РћРїРёС€РёС‚Рµ С‚РµРјСѓ' });
  const user = ensureWallet(db.users.find(u => u.id === req.userId));
  if (!user) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  const devFree = isAdminReq(req);
  if (!devFree && (user.walletBalance || 0) < AI_THEME_COST_VP) {
    return res.status(400).json({ message: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р’Рџ. РќСѓР¶РЅРѕ ${AI_THEME_COST_VP} Р’Рџ.` });
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
  if (!isAdminReq(req)) return res.status(403).json({ message: 'РўРѕР»СЊРєРѕ РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°' });
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const data = await r.json();
    res.json({ status: 'ok', engine: 'ollama', model: OLLAMA_MODEL, model_loaded: (data.models || []).some(m => String(m.name || '').split(':')[0] === OLLAMA_MODEL.split(':')[0]) });
  } catch (e) { res.json({ status: 'offline', engine: 'ollama', model: OLLAMA_MODEL, error: e.message }); }
});
app.post('/api/ai-lmm/chat', authMiddleware, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'РўРѕР»СЊРєРѕ РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°' });
  const text = String(req.body?.message || '').trim().slice(0, 8000);
  if (!text) return res.status(400).json({ message: 'Р’РІРµРґРёС‚Рµ СЃРѕРѕР±С‰РµРЅРёРµ' });
  try {
    const knowledge = (db.aiKnowledge || []).map(k => `РСЃС‚РѕС‡РЅРёРє: ${k.url}\n${k.text}`).join('\n\n').slice(0, 100000);
    const systemPrompt = knowledge ? `${LLM_SYSTEM_PROMPT}\n\nР”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Рµ РјР°С‚РµСЂРёР°Р»С‹ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°:\n${knowledge}` : LLM_SYSTEM_PROMPT;
    const r = await fetch(`${OLLAMA_URL}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }] }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Ollama HTTP ${r.status}`);
    const answer = String(data.message?.content || '').trim();
    if (!answer) throw new Error('Ollama РІРµСЂРЅСѓР»Р° РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚');
    res.json({ answer, model: OLLAMA_MODEL });
  } catch (e) { res.status(503).json({ message: `Р›РѕРєР°Р»СЊРЅР°СЏ LLM РЅРµРґРѕСЃС‚СѓРїРЅР°: ${e.message}` }); }
});

/**
 * SEC: РїСЂРѕРІРµСЂРєР° Р°РґСЂРµСЃР° РїРµСЂРµРґ server-side fetch вЂ” Р·Р°С‰РёС‚Р° РѕС‚ SSRF.
 *
 * РЎРїРёСЃРѕРє В«localhost / 127.0.0.1 / 0.0.0.0 / *.localВ» РЅРµРґРѕСЃС‚Р°С‚РѕС‡РµРЅ:
 *  - 127.0.0.2 Рё РІРµСЃСЊ 127.0.0.0/8 вЂ” С‚РѕР¶Рµ loopback;
 *  - ::1 Рё [::] вЂ” С‚Рѕ Р¶Рµ СЃР°РјРѕРµ РІ IPv6;
 *  - 10/8, 172.16/12, 192.168/16, 169.254/16 вЂ” РїСЂРёРІР°С‚РЅС‹Рµ СЃРµС‚Рё Рё link-local
 *    (169.254.169.254 вЂ” РјРµС‚Р°РґР°РЅРЅС‹Рµ РѕР±Р»Р°РєР°: РѕС‚С‚СѓРґР° С‚СЏРЅСѓС‚ РІСЂРµРјРµРЅРЅС‹Рµ РєР»СЋС‡Рё);
 *  - 0.0.0.0, ::ffff:127.0.0.1 вЂ” РѕР±С…РѕРґ С‡РµСЂРµР· РЅРµСЃС‚Р°РЅРґР°СЂС‚РЅСѓСЋ Р·Р°РїРёСЃСЊ.
 *
 * РџСЂРѕРІРµСЂСЏРµРј hostname, Р° РЅРµ С‚РѕР»СЊРєРѕ Р»РёС‚РµСЂР°Р»С‹, РёРЅР°С‡Рµ 2130706433 (СЌС‚Рѕ 127.0.0.1)
 * РёР»Рё [::ffff:7f00:1] РїСЂРѕС…РѕРґСЏС‚ РЅРµР·Р°РјРµС‡РµРЅРЅС‹РјРё.
 */
function isPrivateHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  // .localdomain вЂ” СЃРёРЅРѕРЅРёРј localhost РІ /etc/hosts, РЅРµ РїРѕРєСЂС‹РІР°РµС‚СЃСЏ СЃСѓС„С„РёРєСЃРѕРј .local.
  const bare = host.split('.')[0];
  if (bare === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localdomain')) return true;
  // Р”РµСЃСЏС‚РёС‡РЅР°СЏ Рё РІРѕСЃСЊРјРµСЂРёС‡РЅР°СЏ Р·Р°РїРёСЃРё IPv4 (2130706433 = 127.0.0.1).
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (n === 0 || n >= 0x7f000000) return true;
  }
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIP(host) === 6) return true; // Р»СЋР±РѕР№ IPv6: ::1, ::, СѓРЅРёРєР°Р»СЊРЅС‹Рµ, link-local
  return false;
}

app.post('/api/ai-lmm/learn-url', authMiddleware, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ message: 'РўРѕР»СЊРєРѕ РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°' });
  let parsed;
  try { parsed = new URL(String(req.body?.url || '').trim()); } catch { return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ РєРѕСЂСЂРµРєС‚РЅСѓСЋ СЃСЃС‹Р»РєСѓ' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ message: 'Р Р°Р·СЂРµС€РµРЅС‹ С‚РѕР»СЊРєРѕ http Рё https' });
  if (isPrivateHost(parsed.hostname)) return res.status(400).json({ message: 'Р›РѕРєР°Р»СЊРЅС‹Рµ Рё РІРЅСѓС‚СЂРµРЅРЅРёРµ Р°РґСЂРµСЃР° Р·Р°РїСЂРµС‰РµРЅС‹' });
  try {
    // redirect: 'manual' вЂ” РёРЅР°С‡Рµ РІРЅРµС€РЅРёР№ СЃР°Р№С‚ РїСЂС‹РіР°РµС‚ СЂРµРґРёСЂРµРєС‚РѕРј РЅР°
    // 169.254.169.254, Рё РїСЂРѕРІРµСЂРєР° РІС‹С€Рµ РѕРєР°Р·С‹РІР°РµС‚СЃСЏ РѕР±РѕР№РґС‘РЅРЅРѕР№.
    const r = await fetch(parsed.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Vera-AI-Learning/1.0' },
    });
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get('location');
      let target = null;
      try { target = new URL(location, parsed); } catch { target = null; }
      if (!target || !['http:', 'https:'].includes(target.protocol) || isPrivateHost(target.hostname)) {
        return res.status(400).json({ message: 'Р РµРґРёСЂРµРєС‚ РІРµРґС‘С‚ РЅР° Р·Р°РїСЂРµС‰С‘РЅРЅС‹Р№ Р°РґСЂРµСЃ' });
      }
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = (await r.text()).slice(0, 200000);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
    if (!Array.isArray(db.aiKnowledge)) db.aiKnowledge = [];
    db.aiKnowledge = [...db.aiKnowledge.filter(k => k.url !== parsed.href), { url: parsed.href, text, updatedAt: new Date().toISOString() }].slice(-20);
    saveDb();
    res.json({ ok: true, url: parsed.href, text });
  } catch (e) { res.status(502).json({ message: `РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ СЃР°Р№С‚: ${e.message}` }); }
});

// Local Whisper; access is checked before reading an attachment from disk.
app.post('/api/voice/transcribe/:attachmentId', authMiddleware,
  require('./transcription').createTranscriptionHandler({ getDb: () => db, uploadsDir: UPLOADS_DIR }));

// в”Ђв”Ђв”Ђ PROFILE COMMENTS (Steam-style СЃС‚РµРЅР°) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РҐСЂР°РЅСЏС‚СЃСЏ РЅР° СЃРµСЂРІРµСЂРµ, С‡С‚РѕР±С‹ РІР»Р°РґРµР»РµС† РїСЂРѕС„РёР»СЏ РІРёРґРµР» Р·Р°РїРёСЃРё РѕС‚ РґСЂСѓРіРёС….
// РњРѕРґРµР»СЊ: { id, targetUserId, authorId, text, createdAt, likes, dislikes }.
// likes/dislikes вЂ” СЃРїРёСЃРєРё userId; РєР»РёРµРЅС‚Сѓ СѓС…РѕРґСЏС‚ С‚РѕР»СЊРєРѕ СЃС‡С‘С‚С‡РёРєРё Рё СЃРІРѕР№ РіРѕР»РѕСЃ.
const profileComments = require('./profile-comments');
if (!Array.isArray(db.profileComments)) db.profileComments = [];

function profileCommentPayload(record, viewerId) {
  const author = db.users.find(u => u.id === record.authorId);
  return {
    id: record.id,
    targetUserId: record.targetUserId,
    authorId: record.authorId,
    authorName: author
      ? ([author.firstName, author.lastName].filter(Boolean).join(' ') || author.username)
      : 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ',
    authorAvatar: author?.avatarUrl || null,
    text: record.text,
    ts: new Date(record.createdAt).getTime(),
    ...profileComments.publicVotes(record, viewerId),
  };
}

app.get('/api/users/:id/comments', authMiddleware, (req, res) => {
  const targetUserId = req.params.id;
  const sort = ['new', 'old', 'likes'].includes(req.query.sort) ? req.query.sort : 'new';
  const items = profileComments.sortComments(
    (db.profileComments || []).filter(c => c.targetUserId === targetUserId),
    sort,
  ).slice(0, 200).map(c => profileCommentPayload(c, req.userId));
  res.json(items);
});

app.post('/api/users/:id/comments', authMiddleware, (req, res) => {
  const targetUserId = req.params.id;
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ message: 'РџСѓСЃС‚РѕР№ РєРѕРјРјРµРЅС‚Р°СЂРёР№' });
  const target = db.users.find(u => u.id === targetUserId);
  if (!target) return res.status(404).json({ message: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ' });
  const record = {
    id: uuidv4(),
    targetUserId,
    authorId: req.userId,
    text,
    createdAt: new Date().toISOString(),
    likes: [],
    dislikes: [],
  };
  db.profileComments.push(record);
  saveDb();
  const payload = profileCommentPayload(record, req.userId);
  try { io.emit('profileComment:new', payload); } catch {}
  res.json(payload);
});

app.post('/api/users/:id/comments/:commentId/vote', authMiddleware, (req, res) => {
  const { id: targetUserId, commentId } = req.params;
  const record = (db.profileComments || []).find(c => c.id === commentId && c.targetUserId === targetUserId);
  if (!record) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  profileComments.applyVote(record, req.userId, req.body?.value);
  saveDb();
  const votes = profileComments.publicVotes(record, req.userId);
  try { io.emit('profileComment:voted', { id: commentId, targetUserId, ...votes, voterId: req.userId }); } catch {}
  res.json(votes);
});

app.delete('/api/users/:id/comments/:commentId', authMiddleware, (req, res) => {
  const { id: targetUserId, commentId } = req.params;
  const idx = (db.profileComments || []).findIndex(c => c.id === commentId && c.targetUserId === targetUserId);
  if (idx === -1) return res.status(404).json({ message: 'РќРµ РЅР°Р№РґРµРЅ' });
  const c = db.profileComments[idx];
  // РЈРґР°Р»СЏС‚СЊ РјРѕР¶РµС‚: Р°РІС‚РѕСЂ РєРѕРјРјРµРЅС‚Р°СЂРёСЏ, РІР»Р°РґРµР»РµС† СЃС‚РµРЅС‹, Р°РґРјРёРЅ.
  const isOwner = c.authorId === req.userId || c.targetUserId === req.userId;
  if (!isOwner && !isAdminReq(req)) return res.status(403).json({ message: 'РќРµС‚ РїСЂР°РІ' });
  db.profileComments.splice(idx, 1);
  saveDb();
  try { io.emit('profileComment:deleted', { id: commentId, targetUserId }); } catch {}
  res.json({ ok: true });
});

// в”Ђв”Ђв”Ђ FAVORITES routes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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
      const lastMsg = lastMessageOf(chatId, false);
      // РЎС‡РёС‚Р°РµРј СЂРµР°Р»СЊРЅС‹Рµ РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ (РіРґРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РІ readBy Рё РЅРµ Р°РІС‚РѕСЂ)
      const unreadCount = db.messages.reduce((acc, msg) => acc + (
        msg.chatId === chatId && !msg.readBy?.includes(req.userId) && msg.senderId !== req.userId ? 1 : 0
      ), 0);
      return { ...chat, members, lastMessage: lastMsg, unreadCount };
    })
    .filter(Boolean);
  res.json(chats);
});

// POST /api/favorites
app.post('/api/favorites', authMiddleware, (req, res) => {
  if (!db.favorites) db.favorites = [];
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ message: 'РЈРєР°Р¶РёС‚Рµ chatId' });
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

// в”Ђв”Ђв”Ђ Socket.io в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const io = new IOServer(server, {
  cors: { origin: corsOriginFn, credentials: true },
  // Keep signalling/messages bounded; large files must use HTTP upload.
  maxHttpBufferSize: Number(process.env.WS_MAX_BUFFER_BYTES || 12 * 1024 * 1024),
});

const userSockets = new Map(); // userId -> Set<socketId>
// Р“СЂРµР№СЃ-РїРµСЂРёРѕРґ РїРµСЂРµРґ РїРѕРјРµС‚РєРѕР№ РѕС„С„Р»Р°Р№РЅ (С‡С‚РѕР±С‹ РЅРµ РјРёРіР°С‚СЊ РїСЂРё РєСЂР°С‚РєРѕРІСЂРµРјРµРЅРЅРѕРј СЂР°Р·СЂС‹РІРµ СЃРІСЏР·Рё)
const OFFLINE_GRACE_MS = 30000;
const offlineTimers = new Map(); // userId -> NodeJS.Timeout
function cancelOfflineTimer(userId) {
  const t = offlineTimers.get(userId);
  if (t) { clearTimeout(t); offlineTimers.delete(userId); }
}
function scheduleOffline(userId) {
  cancelOfflineTimer(userId);
  const t = setTimeout(() => {
    offlineTimers.delete(userId);
    const sockets = userSockets.get(userId);
    if (sockets && sockets.size > 0) return; // СѓСЃРїРµР»Рё РїРµСЂРµРїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ
    const u = db.users.find(u => u.id === userId);
    if (u) { u.isOnline = false; u.lastSeen = new Date().toISOString(); saveDb(); }
    io.emit('user:offline', { userId, lastSeen: new Date().toISOString() });
  }, OFFLINE_GRACE_MS);
  offlineTimers.set(userId, t);
}
// РњРѕСЂСЃРєРѕР№ Р±РѕР№ (/warship): СЃРµСЃСЃРёРё-РєР°СЂС‚РѕС‡РєРё РІ С‡Р°С‚Рµ СЃ accept/decline/finish.
// Р РµРіРёСЃС‚СЂРёСЂСѓРµРј РџРћРЎР›Р• СЃРѕР·РґР°РЅРёСЏ io вЂ” РјРѕРґСѓР»СЊ СЂР°СЃСЃС‹Р»Р°РµС‚ message:edited.
if (typeof require === 'function') {
  require('./warships').registerWarships({
    app, getDb: () => db, auth: authMiddleware, saveDb, io,
  });
  // РљСЂРµСЃС‚РёРєРё-РЅРѕР»РёРєРё (/tic-tac-toe): СЃРѕСЃС‚РѕСЏРЅРёРµ РїР°СЂС‚РёРё С†РµР»РёРєРѕРј РІ РєР°СЂС‚РѕС‡РєРµ.
  require('./tictactoe').registerTicTacToe({
    app, getDb: () => db, auth: authMiddleware, saveDb, io,
  });
  // РЎС‚РёРєРµСЂС‹: РЅР°Р±РѕСЂС‹, Р·Р°РіСЂСѓР·РєР°, РѕС‚РїСЂР°РІРєР° РІ С‡Р°С‚.
  const stickersModule = require('./stickers').registerStickers({
    app, getDb: () => db, auth: authMiddleware, saveDb, uploadsDir: UPLOADS_DIR,
    multer, handleSendMessage, uploadLimiter, sendLimiter: messageLimiter,
  });
  // Р‘РѕС‚С‹: /hub, Р°РєРєР°СѓРЅС‚С‹-Р±РѕС‚С‹, Bot API (/bot<token>/<method>).
  botsModule = require('./bots').registerBots({
    app, getDb: () => db, auth: authMiddleware, saveDb, io, userSockets,
    isPrivateHost, makeRateLimit, resolveSticker: stickersModule.resolveSticker,
    creationBlocked: (userId) => moderation.creationBanned(db, userId),
    isAdminUserId: (userId) => isAdminUsername(db.users.find(u => u.id === userId)?.username),
    isAdminRequest: (req) => adminRequest(req),
    // РќР°С‡РёСЃР»РµРЅРёРµ Р’Рџ Р°РІС‚РѕСЂСѓ (РЅР°РїСЂРёРјРµСЂ, РЅР°РіСЂР°РґР° Р·Р° РѕС‚Р·С‹РІ/РёРґРµСЋ/Р±Р°Рі). Р’РѕР·РІСЂР°С‰Р°РµС‚ { ok, balance }.
    grantVp: (userId, amount) => {
      const user = db.users.find(u => u.id === userId);
      if (!user || !Number.isSafeInteger(amount) || amount <= 0) return { ok: false, balance: 0 };
      ensureWallet(user);
      const previous = user.walletBalance;
      if (!Number.isSafeInteger(previous + amount)) return { ok: false, balance: previous };
      user.walletBalance = previous + amount;
      try { saveDb(); } catch { user.walletBalance = previous; return { ok: false, balance: previous }; }
      pushWalletEmit(user);
      return { ok: true, balance: user.walletBalance };
    },
  });
  // РџСЂСЏРјРѕР№ РѕР±РјРµРЅ РїСЂРµРґРјРµС‚Р°РјРё Рё Р’Рџ (Р°РєРєР°СѓРЅС‚ СЃС‚Р°СЂС€Рµ РјРµСЃСЏС†Р° + РІС‚РѕСЂРѕРµ СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РїРѕ QR).
  require('./trades').registerTrades({
    app, getDb: () => db, auth: authMiddleware, saveDb, ensureWallet,
    maxVp: MARKET_MAX_PRICE_VP,
    emitToUser: (userId, event, data) => {
      for (const sid of userSockets.get(userId) || []) io.to(sid).emit(event, data);
    },
    afterInventoryChange: (user) => { pushWalletEmit(user); emitPetsUpdated(user); publishEquipment(user); },
    isBlocked: (blockerId, blockedId) => blocks.isBlockedBy(db, blockerId, blockedId),
    items: {
      isTradable: isTradableItemId,
      isPet: isPetId,
      normalize: (id) => (isPetId(id) ? normalizePetId(id) : id),
      owns: userOwnsItem,
      locked: lockedItemIdsForSeller,
      grant: grantItemToUser,
      // РљР°Рє РїСЂРё РІС‹СЃС‚Р°РІР»РµРЅРёРё РЅР° РїР»РѕС‰Р°РґРєСѓ: РѕС‚РґР°РЅРЅС‹Р№ СЃРєРёРЅ СЃРЅРёРјР°РµС‚СЃСЏ СЃРѕ СЃР»РѕС‚РѕРІ.
      take: (user, itemId) => {
        removeItemFromUser(user, itemId);
        if (isPetId(itemId)) return;
        for (const slot of ['activeRing', 'activeSelfCard', 'activeBubble']) {
          if (user[slot] === itemId) user[slot] = '';
          const shop = db.userStores?.[user.id]?.shop?.data;
          if (shop?.[slot] === itemId) shop[slot] = '';
        }
      },
    },
  });
}
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
// в”Ђв”Ђв”Ђ Discord-style voice rooms (in-memory) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// chatId -> Map<userId, { socketId, kind, joinedAt, mic, cam, screen, deaf }>
const callRooms = new Map();
// РњРµС‚Р°РґР°РЅРЅС‹Рµ РєРѕРјРЅР°С‚С‹: РєРѕРіРґР° РЅР°С‡Р°Р»СЃСЏ Р·РІРѕРЅРѕРє, РєС‚Рѕ РёРЅРёС†РёР°С‚РѕСЂ, РєС‚Рѕ СѓС‡Р°СЃС‚РІРѕРІР°Р».
// Р–РёРІСѓС‚ РІРјРµСЃС‚Рµ СЃ callRooms; РїРѕ РёСЃС‚РµС‡РµРЅРёРё РєРѕРјРЅР°С‚С‹ РїРёС€СѓС‚ РёС‚РѕРіРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ.
// chatId -> { startedAt, kind, starterId, participants: Set<userId> }
const callRoomMeta = new Map();

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
    // Р—РІРѕРЅРѕРє Р·Р°РєРѕРЅС‡РёР»СЃСЏ вЂ” СЃРѕС…СЂР°РЅСЏРµРј РёС‚РѕРіРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РІ С‡Р°С‚.
    const meta = callRoomMeta.get(chatId);
    callRoomMeta.delete(chatId);
    saveCallSummaryMessage(chatId, meta);
  }
  // РЈР±РёСЂР°РµРј РІСЃРµС… СЃРѕРєРµС‚РѕРІ СЋР·РµСЂР° РёР· socket-room СЌС‚РѕР№ РєРѕРјРЅР°С‚С‹.
  const sockets = userSockets.get(userId);
  if (sockets) sockets.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) s.leave(`callroom:${chatId}`);
  });
}

// РС‚РѕРіРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ Рѕ Р·РІРѕРЅРєРµ РІ С‡Р°С‚: С‚РёРї, РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ, СѓС‡Р°СЃС‚РЅРёРєРё.
// РџРёС€РµРј С‚РѕР»СЊРєРѕ РґР»СЏ В«СЂРµР°Р»СЊРЅС‹С…В» Р·РІРѕРЅРєРѕРІ (РґРІРѕРµ Рё Р±РѕР»РµРµ СѓС‡Р°СЃС‚РЅРёРєРѕРІ) вЂ” РѕРґРёРЅРѕРєРёР№
// Р·Р°С…РѕРґ РІ РєРѕРјРЅР°С‚Сѓ РёС‚РѕРіРѕРј РЅРµ СЃС‡РёС‚Р°РµС‚СЃСЏ.
function saveCallSummaryMessage(chatId, meta) {
  if (!meta || (meta.participants?.size || 0) < 2) return;
  const durationMs = Math.max(0, Date.now() - meta.startedAt);
  const mins = Math.floor(durationMs / 60000);
  const secs = Math.floor((durationMs % 60000) / 1000);
  const durationText = `${mins}:${String(secs).padStart(2, '0')}`;
  const kindText = meta.kind === 'video' ? 'Р’РёРґРµРѕР·РІРѕРЅРѕРє' : 'РђСѓРґРёРѕР·РІРѕРЅРѕРє';
  const participants = [...meta.participants].map((uid) => {
    const u = db.users.find(x => x.id === uid);
    return {
      id: uid,
      name: u ? (`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username || 'РЈС‡Р°СЃС‚РЅРёРє') : 'РЈС‡Р°СЃС‚РЅРёРє',
    };
  });
  const message = {
    id: uuidv4(),
    chatId,
    senderId: meta.starterId,
    text: `рџ“ћ ${kindText} В· ${durationText}`,
    content: `рџ“ћ ${kindText} В· ${durationText}`,
    replyToId: null,
    attachments: [{
      id: uuidv4(),
      mimeType: 'application/x-vera-call',
      fileName: 'call',
      fileUrl: '',
      fileSize: 0,
      data: { kind: meta.kind === 'video' ? 'video' : 'audio', durationMs, participants },
    }],
    type: 'call',
    readBy: [...meta.participants],
    isEdited: false,
    isPinned: false,
    isDeleted: false,
    createdAt: new Date().toISOString(),
  };
  message.integrityHash = messageIntegrityHash(message);
  db.messages.push(message);
  try { saveDb(); } catch { db.messages = db.messages.filter(x => x !== message); return; }
  const sender = db.users.find(u => u.id === meta.starterId) || null;
  io.to(`chat:${chatId}`).emit('message:new', { ...message, sender });
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
    // Р РµР¶РёРј В«С‚РѕР»СЊРєРѕ С‡С‚РµРЅРёРµВ»: СЃРѕР±С‹С‚РёРµ РѕС‚Р±СЂР°СЃС‹РІР°РµС‚СЃСЏ, РєР»РёРµРЅС‚ РїРѕР»СѓС‡Р°РµС‚ РѕС€РёР±РєСѓ РІ ack.
    if (moderation.READ_ONLY_SOCKET_EVENTS.has(_packet[0]) && moderation.readOnly(db, userId)) {
      const ack = _packet[_packet.length - 1];
      if (typeof ack === 'function') ack({ error: 'РђРєРєР°СѓРЅС‚ РІ СЂРµР¶РёРјРµ С‚РѕР»СЊРєРѕ С‡С‚РµРЅРёСЏ', code: 'READ_ONLY' });
      return;
    }
    next();
  });
  socketIpCounts.set(socket.ip, (socketIpCounts.get(socket.ip) || 0) + 1);
  console.log(`вњ… РџРѕРґРєР»СЋС‡РёР»СЃСЏ: ${userId} (${socket.id})`);

  // Track socket
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);

  // Mark online
  const user = db.users.find(u => u.id === userId);
  if (user) { user.isOnline = true; user.lastSeen = new Date().toISOString(); markActiveDay(user); cancelOfflineTimer(userId); saveDb(); }
  io.emit('user:online', { userId });

  // Join all user's chats automatically
  const myChatIds = db.chatMembers.filter(m => m.userId === userId).map(m => m.chatId);
  for (const chatId of myChatIds) socket.join(`chat:${chatId}`);

  // РђРєС‚РёРІРЅС‹Рµ Р·РІРѕРЅРєРё РІ С‡Р°С‚Р°С… РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ вЂ” С‡С‚РѕР±С‹ РїР»Р°С€РєР° В«РёРґС‘С‚ Р·РІРѕРЅРѕРєВ» СЃ
  // РєРЅРѕРїРєРѕР№ В«РџСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏВ» РїРѕСЏРІР»СЏР»Р°СЃСЊ СЃСЂР°Р·Сѓ РїРѕСЃР»Рµ (РїРµСЂРµ)Р·Р°РіСЂСѓР·РєРё СЃС‚СЂР°РЅРёС†С‹.
  {
    const myChatSet = new Set(myChatIds);
    const activeRoomsList = [];
    for (const [rChatId, meta] of callRoomMeta.entries()) {
      if (!myChatSet.has(rChatId) || !callRooms.has(rChatId)) continue;
      activeRoomsList.push({ chatId: rChatId, kind: meta.kind, starterId: meta.starterId, startedAt: meta.startedAt });
    }
    socket.emit('callroom:active-rooms', { rooms: activeRoomsList });
  }

  socket.on('chat:join', (chatId) => {
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return;
    socket.join(`chat:${chatId}`);
    // РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕРјРµС‡Р°РµРј РІСЃРµ РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ РІ С‡Р°С‚Рµ РєР°Рє РїСЂРѕС‡РёС‚Р°РЅРЅС‹Рµ
    // РєРѕРіРґР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РѕС‚РєСЂС‹РІР°РµС‚ С‡Р°С‚ (РІРєР»СЋС‡Р°СЏ РёР·Р±СЂР°РЅРЅРѕРµ)
    let marked = 0;
    for (const msg of db.messages) {
      if (msg.chatId !== chatId) continue;
      if (!msg.readBy) msg.readBy = [];
      if (!msg.readBy.includes(userId) && msg.senderId !== userId) {
        msg.readBy.push(userId);
        marked++;
      }
    }
    if (marked > 0) {
      saveDb();
      io.to(`chat:${chatId}`).emit('messages:read_all', { chatId, userId, count: marked });
    }
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
    if (!isMember) return callback && callback({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
    // РўРѕС‚ Р¶Рµ Р·Р°РїСЂРµС‚, С‡С‚Рѕ Рё РІ handleSendMessage: Р±Р»РѕРєРёСЂРѕРІРєСѓ РЅРµР»СЊР·СЏ РѕР±РѕР№С‚Рё СЃРѕРєРµС‚РѕРј.
    if (userBlockedInChat(chatId, userId)) {
      return callback && callback({ error: 'Р’С‹ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅС‹ РІ СЌС‚РѕРј С‡Р°С‚Рµ', code: 'BLOCKED_IN_CHAT' });
    }
    const msgContent = String(content || text || '');
    if (msgContent.length > MESSAGE_MAX_LEN) {
      return callback && callback({ error: 'РЎРѕРѕР±С‰РµРЅРёРµ СЃР»РёС€РєРѕРј РґР»РёРЅРЅРѕРµ' });
    }
    // SEC: rate-limit per-user РЅР° WS message:send.
    if (!wsSendHits.has(userId)) wsSendHits.set(userId, []);
    const hits = wsSendHits.get(userId);
    const now = Date.now();
    while (hits.length && hits[0] < now - 60_000) hits.shift();
    if (hits.length >= 120) {
      return callback && callback({ error: 'РЎР»РёС€РєРѕРј Р±С‹СЃС‚СЂРѕ. РџРѕРґРѕР¶РґРёС‚Рµ РјРёРЅСѓС‚Сѓ.' });
    }
    hits.push(now);
    const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 20) : [];
    if (!msgContent && safeAttachments.length === 0) {
      return callback && callback({ error: 'РџСѓСЃС‚РѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' });
    }
    // SEC: СЌС‚РѕС‚ СЃРѕРєРµС‚-РїСѓС‚СЊ РЅРµ РёРґС‘С‚ С‡РµСЂРµР· handleSendMessage, РїРѕСЌС‚РѕРјСѓ РїСЂРёРјРµРЅСЏРµРј
    // С‚РѕС‚ Р¶Рµ РІР°Р»РёРґР°С‚РѕСЂ: javascript:/data:text/html РІ fileUrl в†’ stored XSS.
    const normAttachments = safeAttachments.map(normalizeClientAttachment).filter(Boolean);
    if (!msgContent && normAttachments.length === 0) {
      return callback && callback({ error: 'РџСѓСЃС‚РѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' });
    }

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
    message.integrityHash = messageIntegrityHash(message);
    db.messages.push(message);
    saveDb();

    const result = { ...message, sender: db.users.find(u => u.id === userId) };
    // РўРѕС‚ Р¶Рµ РїРѕСЃР°РґРѕС‡РЅС‹Р№ С„РёРєСЃ, С‡С‚Рѕ Рё РІ handleSendMessage: СѓС‡Р°СЃС‚РЅРёРєРё РјРѕРіР»Рё
    // РєРѕРЅРЅРµРєС‚РёС‚СЊСЃСЏ РґРѕ СЃРѕР·РґР°РЅРёСЏ С‡Р°С‚Р° Рё РЅРµ СЃРѕСЃС‚РѕСЏС‚СЊ РІ РµРіРѕ РєРѕРјРЅР°С‚Рµ.
    if (typeof userSockets !== 'undefined') {
      for (const m of db.chatMembers.filter((m) => m.chatId === chatId)) {
        for (const sid of userSockets.get(m.userId) || []) {
          io.to(sid).socketsJoin?.(`chat:${chatId}`);
        }
      }
    }
    io.to(`chat:${chatId}`).emit('message:new', result);
    callback && callback(result);
    if (botsModule) botsModule.onMessage(message);
  });

  // Typing indicators
  socket.on('typing:start', (chatId) => {
    // SEC: РЅРµ РґР°С‘Рј СЌРјРёС‚РёС‚СЊ typing РІ С‡СѓР¶РёРµ С‡Р°С‚С‹.
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
    // SEC: РїСЂРѕРІРµСЂСЏРµРј С‡Р»РµРЅСЃС‚РІРѕ РІ С‡Р°С‚Рµ Рё СЃРѕРІРїР°РґРµРЅРёРµ chatId СЃ СЃРѕРѕР±С‰РµРЅРёРµРј.
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

  // в”Ђв”Ђ WebRTC Р—РІРѕРЅРєРё в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  // РЈС‚РёР»РёС‚Р°: РѕС‚РїСЂР°РІРёС‚СЊ РєРѕРЅРєСЂРµС‚РЅРѕРјСѓ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ (РїРѕ РІСЃРµРј РµРіРѕ СЃРѕРєРµС‚Р°Рј)
  function sendToUser(targetUserId, event, data) {
    const sockets = userSockets.get(targetUserId);
    if (sockets) sockets.forEach(sid => io.to(sid).emit(event, data));
  }

  // SEC: РїСЂРѕРІРµСЂРєР° В«СЌС‚Рё РґРІРѕРµ СЃРѕСЃС‚РѕСЏС‚ РІ РѕР±С‰РµРј direct/group С‡Р°С‚РµВ» вЂ” РёРЅР°С‡Рµ РјРѕР¶РЅРѕ
  // СЃРїР°РјРёС‚СЊ РїСЂРѕРёР·РІРѕР»СЊРЅС‹Рј СЋР·РµСЂР°Рј РїРѕРґРґРµР»СЊРЅС‹Рµ call-СЃРѕР±С‹С‚РёСЏ.
  function shareChat(a, b) {
    if (!a || !b || a === b) return false;
    const aChats = new Set(db.chatMembers.filter(m => m.userId === a).map(m => m.chatId));
    return db.chatMembers.some(m => m.userId === b && aChats.has(m.chatId));
  }

  // Р—РІРѕРЅРѕРє: СЃРѕС…СЂР°РЅСЏРµРј РІ Р¶СѓСЂРЅР°Р»
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
      callerName: caller ? `${caller.firstName || ''} ${caller.lastName || ''}`.trim() || caller.username : 'РќРµРёР·РІРµСЃС‚РЅС‹Р№',
      callerAvatar: caller?.avatarUrl || null,
      offer: data.offer,
      type: data.type || 'audio',
      callLogId: callLogEntry.id,
    });
  });

  // РћС‚РІРµС‚РёС‚СЊ РЅР° Р·РІРѕРЅРѕРє
  socket.on('call:answer', (data) => {
    if (!data || !data.targetUserId || !shareChat(userId, data.targetUserId)) return;
    sendToUser(data.targetUserId, 'call:answered', {
      answer: data.answer,
      fromUserId: userId,
    });
  });

  // ICE РєР°РЅРґРёРґР°С‚
  socket.on('call:ice-candidate', (data) => {
    if (!data || !data.targetUserId || !shareChat(userId, data.targetUserId)) return;
    sendToUser(data.targetUserId, 'call:ice-candidate', {
      candidate: data.candidate,
      fromUserId: userId,
    });
  });

  // Р—Р°РІРµСЂС€РёС‚СЊ / РѕС‚РєР»РѕРЅРёС‚СЊ Р·РІРѕРЅРѕРє
  socket.on('call:end', (data) => {
    if (!data) return;
    if (data.targetUserId && shareChat(userId, data.targetUserId)) {
      const reason = data.reason || 'ended';
      sendToUser(data.targetUserId, 'call:ended', { fromUserId: userId, reason });
    }
    const reason = data.reason || 'ended';
    // РћС‚РјРµС‡Р°РµРј Р·Р°РІРµСЂС€РµРЅРёРµ РІ Р¶СѓСЂРЅР°Р»Рµ Р·РІРѕРЅРєРѕРІ
    if (data.callLogId) {
      const entry = (db.callLogs || []).find(e => e.id === data.callLogId);
      if (entry) {
        entry.endedAt = new Date().toISOString();
        entry.status = reason === 'declined' || reason === 'missed' ? reason : 'completed';
        saveDb();
      }
    } else {
      // РЅРµС‚ id вЂ” Р·Р°РІРµСЂС€Р°РµРј РїРѕСЃР»РµРґРЅСЋСЋ РЅРµР·Р°РєРѕРЅС‡РµРЅРЅСѓСЋ Р·Р°РїРёСЃСЊ РґР»СЏ СЌС‚РѕРіРѕ СЋР·РµСЂР°
      const entries = (db.callLogs || []).filter(e => e.userId === userId && !e.endedAt);
      const last = entries[entries.length - 1];
      if (last) {
        last.endedAt = new Date().toISOString();
        last.status = reason === 'declined' || reason === 'missed' ? reason : 'completed';
        saveDb();
      }
    }

    // Р•СЃР»Рё Р·РІРѕРЅРѕРє Р±С‹Р» РїСЂРѕРїСѓС‰РµРЅ вЂ” СЃРѕС…СЂР°РЅСЏРµРј СЃРёСЃС‚РµРјРЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РІ С‡Р°С‚Рµ
    if (reason === 'declined' || reason === 'missed') {
      // РќР°Р№С‚Рё РѕР±С‰РёР№ direct С‡Р°С‚ РјРµР¶РґСѓ РґРІСѓРјСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРјРё
      const myChats = db.chatMembers.filter(m => m.userId === userId).map(m => m.chatId);
      const targetChats = db.chatMembers.filter(m => m.userId === data.targetUserId).map(m => m.chatId);
      const commonChatId = myChats.find(id => targetChats.includes(id) && db.chats.find(c => c.id === id && c.type === 'direct'));
      if (commonChatId) {
        const systemMsg = {
          id: uuidv4(),
          chatId: commonChatId,
          senderId: userId,
          text: `рџ“ћ РџСЂРѕРїСѓС‰РµРЅРЅС‹Р№ ${data.type === 'video' ? 'РІРёРґРµРѕ' : 'Р°СѓРґРёРѕ'}Р·РІРѕРЅРѕРє`,
          content: `рџ“ћ РџСЂРѕРїСѓС‰РµРЅРЅС‹Р№ ${data.type === 'video' ? 'РІРёРґРµРѕ' : 'Р°СѓРґРёРѕ'}Р·РІРѕРЅРѕРє`,
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

  // в”Ђв”Ђв”Ђ Discord-style РіСЂСѓРїРїРѕРІС‹Рµ/1:1 Р·РІРѕРЅРєРё (voice rooms) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // РЎС…РµРјР°: РѕРґРЅР° В«РєРѕРјРЅР°С‚Р°В» РЅР° chatId. РљР»РёРµРЅС‚С‹ РѕР±РјРµРЅРёРІР°СЋС‚СЃСЏ offer/answer/ICE
  // Р§Р•Р Р•Р— СЃРµСЂРІРµСЂ, РЅРѕ media РёРґС‘С‚ РЅР°РїСЂСЏРјСѓСЋ peer-to-peer (mesh). РЎРµСЂРІРµСЂ Р·РЅР°РµС‚
  // С‚РѕР»СЊРєРѕ РЎРџРРЎРћРљ СѓС‡Р°СЃС‚РЅРёРєРѕРІ Рё СЂРµС‚СЂР°РЅСЃР»РёСЂСѓРµС‚ СЃРёРіРЅР°Р»РёРЅРі.
  //
  // РҐСЂР°РЅРёР»РёС‰Рµ (in-memory, Р¶РёРІС‘С‚ РґРѕ СЂРµСЃС‚Р°СЂС‚Р° СЃРµСЂРІРµСЂР°):
  //   callRooms.get(chatId) = Map<userId, {
  //     socketId, kind: 'audio'|'video', joinedAt,
  //     mic: bool, cam: bool, screen: bool, deaf: bool
  //   }>

  socket.on('callroom:join', ({ chatId, kind }) => {
    if (!chatId) return;
    const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return;

    if (!callRooms.has(chatId)) {
      callRooms.set(chatId, new Map());
      // РџРµСЂРІР°СЏ Р·Р°С…РѕРґРєР° РІ РєРѕРјРЅР°С‚Сѓ вЂ” С„РёРєСЃРёСЂСѓРµРј РЅР°С‡Р°Р»Рѕ Р·РІРѕРЅРєР° Рё РёРЅРёС†РёР°С‚РѕСЂР°.
      callRoomMeta.set(chatId, {
        startedAt: Date.now(),
        kind: kind === 'video' ? 'video' : 'audio',
        starterId: userId,
        participants: new Set([userId]),
      });
    }
    const roomMeta = callRoomMeta.get(chatId);
    if (roomMeta) roomMeta.participants.add(userId);
    const room = callRooms.get(chatId);

    // РЎРїРёСЃРѕРє СѓР¶Рµ РїСЂРёСЃСѓС‚СЃС‚РІСѓСЋС‰РёС… СѓС‡Р°СЃС‚РЅРёРєРѕРІ (Р±РµР· РЅР°СЃ) вЂ” РІРµСЂРЅС‘Рј РёРЅРёС†РёР°С‚РѕСЂСѓ.
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

    // РћС‚РІРµС‚ РёРЅРёС†РёР°С‚РѕСЂСѓ: РєС‚Рѕ СѓР¶Рµ РІ РєРѕРјРЅР°С‚Рµ.
    socket.emit('callroom:peers', { chatId, peers, kind: kind === 'video' ? 'video' : 'audio' });

    // РЈРІРµРґРѕРјР»СЏРµРј РѕСЃС‚Р°Р»СЊРЅС‹С… СѓС‡Р°СЃС‚РЅРёРєРѕРІ РєРѕРјРЅР°С‚С‹ (С‚Рµ, РєС‚Рѕ СѓР¶Рµ СЃРёРґСЏС‚) вЂ” РїРѕСЏРІРёР»СЃСЏ РЅРѕРІРёС‡РѕРє.
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

    // РЈРІРµРґРѕРјР»СЏРµРј РІСЃРµС… СѓС‡Р°СЃС‚РЅРёРєРѕРІ С‡Р°С‚Р° (РІРєР»СЋС‡Р°СЏ С‚РµС…, РєС‚Рѕ РЅРµ РІ РєРѕРјРЅР°С‚Рµ) вЂ”
    // С‡С‚РѕР±С‹ Сѓ РЅРёС… РїРѕСЏРІРёР»Р°СЃСЊ В«РїР»Р°С€РєР° РёРґС‘С‚ Р·РІРѕРЅРѕРєВ» / РІС…РѕРґСЏС‰РёР№ СЂРёРЅРіС‚РѕРЅ.
    const chat = db.chats.find(c => c.id === chatId);
    if (wasEmpty && chat) {
      // Direct = РІС…РѕРґСЏС‰РёР№ РІС‹Р·РѕРІ РєРѕРЅРєСЂРµС‚РЅРѕРјСѓ РІС‚РѕСЂРѕРјСѓ СѓС‡Р°СЃС‚РЅРёРєСѓ (ring).
      if (chat.type === 'direct') {
        const others = db.chatMembers.filter(m => m.chatId === chatId && m.userId !== userId);
        others.forEach(m => sendToUser(m.userId, 'callroom:ring', {
          chatId, callerId: userId,
          callerName: meUser ? `${meUser.firstName || ''} ${meUser.lastName || ''}`.trim() || meUser.username : 'РќРµРёР·РІРµСЃС‚РЅС‹Р№',
          callerAvatar: meUser?.avatarUrl || null,
          kind: kind === 'video' ? 'video' : 'audio',
        }));
      } else {
        // Group/channel вЂ” РїСЂРѕСЃС‚Рѕ РѕРїРѕРІРµС‰Р°РµРј В«РІ С‡Р°С‚Рµ РЅР°С‡Р°Р»СЃСЏ Р·РІРѕРЅРѕРєВ».
        io.to(`chat:${chatId}`).emit('callroom:started', {
          chatId, starterId: userId, kind: kind === 'video' ? 'video' : 'audio',
        });
      }
    }
  });

  socket.on('callroom:leave', ({ chatId }) => {
    doLeaveRoom(chatId, userId, socket.id);
  });

  // РћС‚РєР»РѕРЅРµРЅРёРµ РІС…РѕРґСЏС‰РµРіРѕ direct-Р·РІРѕРЅРєР°: СЃРѕРѕР±С‰Р°РµРј Р·РІРѕРЅСЏС‰РµРјСѓ, С‡С‚РѕР±С‹ С‚РѕС‚ РїРµСЂРµСЃС‚Р°Р»
  // СЃР»СѓС€Р°С‚СЊ РіСѓРґРєРё Рё РІС‹С€РµР» РёР· РєРѕРјРЅР°С‚С‹ (СЃР°Рј СЃРѕР±РµСЃРµРґРЅРёРє РІ РєРѕРјРЅР°С‚Рµ РЅРµ СЃРѕСЃС‚РѕРёС‚).
  socket.on('callroom:decline', ({ chatId } = {}) => {
    if (!chatId) return;
    const isMember = db.chatMembers.some(m => m.chatId === chatId && m.userId === userId);
    if (!isMember) return;
    const meta = callRoomMeta.get(chatId);
    if (!meta || meta.starterId === userId) return;
    sendToUser(meta.starterId, 'callroom:ring-declined', { chatId, byUserId: userId });
  });

  // РЎРёРіРЅР°Р»РёРЅРі: SDP offer/answer/ICE РјРµР¶РґСѓ РґРІСѓРјСЏ РєРѕРЅРєСЂРµС‚РЅС‹РјРё РїРёСЂР°РјРё РІ РєРѕРјРЅР°С‚Рµ.
  socket.on('callroom:signal', ({ chatId, toUserId, data }) => {
    if (!chatId || !toUserId) return;
    const room = callRooms.get(chatId);
    if (!room || !room.has(userId) || !room.has(toUserId)) return;
    const target = room.get(toUserId);
    io.to(target.socketId).emit('callroom:signal', {
      chatId, fromUserId: userId, data,
    });
  });

  // РР·РјРµРЅРµРЅРёРµ Р»РѕРєР°Р»СЊРЅРѕРіРѕ СЃРѕСЃС‚РѕСЏРЅРёСЏ (mic/cam/screen/deaf/speaking).
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
    // РђРІС‚РѕРІС‹С…РѕРґ РёР· РІСЃРµС… РіРѕР»РѕСЃРѕРІС‹С… РєРѕРјРЅР°С‚ (СЃРј. РЅРёР¶Рµ Р±Р»РѕРє callRooms)
    try { leaveAllCallRooms(userId, socket.id); } catch {}
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSockets.delete(userId);
        // РќРµ СЃС‚Р°РІРёРј РѕС„С„Р»Р°Р№РЅ СЃСЂР°Р·Сѓ вЂ” РіСЂРµР№СЃ-РїРµСЂРёРѕРґ 30 СЃРµРє РЅР° СЃР»СѓС‡Р°Р№ РєСЂР°С‚РєРѕРІСЂРµРјРµРЅРЅРѕРіРѕ СЂР°Р·СЂС‹РІР°
        scheduleOffline(userId);
      }
    }
    console.log(`вќЊ РћС‚РєР»СЋС‡РёР»СЃСЏ: ${userId}`);
  });
});

// в”Ђв”Ђв”Ђ Console commands в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РРЅС‚РµСЂР°РєС‚РёРІРЅР°СЏ РєРѕРЅСЃРѕР»СЊ СЂР°Р±РѕС‚Р°РµС‚ С‚РѕР»СЊРєРѕ РєРѕРіРґР° РµСЃС‚СЊ TTY (Р»РѕРєР°Р»СЊРЅС‹Р№ Р·Р°РїСѓСЃРє).
// Р’ РїСЂРѕРґР°РєС€РЅРµ (Docker/Render) stdin РЅРµ TTY вЂ” readline РїРѕР»СѓС‡РёС‚ close СЃСЂР°Р·Сѓ Рё
// СѓСЂРѕРЅРёС‚ РїСЂРѕС†РµСЃСЃ. РџРѕСЌС‚РѕРјСѓ РІРєР»СЋС‡Р°РµРј РµС‘ СѓСЃР»РѕРІРЅРѕ.
if (process.stdin.isTTY) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'vera> ' });

function printHelp() {
  console.log(`
рџ“џ РљРѕРЅСЃРѕР»СЊРЅС‹Рµ РєРѕРјР°РЅРґС‹ Vera:
  help              вЂ” РїРѕРєР°Р·Р°С‚СЊ СЌС‚Сѓ СЃРїСЂР°РІРєСѓ
  users             вЂ” СЃРїРёСЃРѕРє РІСЃРµС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
  chats             вЂ” СЃРїРёСЃРѕРє РІСЃРµС… С‡Р°С‚РѕРІ
  msgs <chatId>     вЂ” РїРѕСЃР»РµРґРЅРёРµ 10 СЃРѕРѕР±С‰РµРЅРёР№ РІ С‡Р°С‚Рµ
  delchat <chatId>  вЂ” СѓРґР°Р»РёС‚СЊ С‡Р°С‚ Рё РІСЃРµ РµРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ
  kick <userId>     вЂ” СѓРґР°Р»РёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
  stats             вЂ” СЃС‚Р°С‚РёСЃС‚РёРєР° Р±Р°Р·С‹ РґР°РЅРЅС‹С…
  admins             вЂ” СЃРїРёСЃРѕРє Р°РґРјРёРЅРѕРІ (env + db)
  admin add <user>   вЂ” РЅР°Р·РЅР°С‡РёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ Р°РґРјРёРЅРѕРј (РїРѕ username)
  admin del <user>   вЂ” СЃРЅСЏС‚СЊ Р°РґРјРёРЅР°
  clear             вЂ” РѕС‡РёСЃС‚РёС‚СЊ РєРѕРЅСЃРѕР»СЊ
  exit              вЂ” РѕСЃС‚Р°РЅРѕРІРёС‚СЊ СЃРµСЂРІРµСЂ
`);
}

rl.on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case 'help': printHelp(); break;
    case 'users':
      console.log('рџ‘Ґ РџРѕР»СЊР·РѕРІР°С‚РµР»Рё:');
      db.users.forEach(u => console.log(`  ${u.id.slice(0,8)} | ${u.username || ''} | ${u.isBot ? 'bot' : ''} | online:${u.isOnline}`));
      break;
    case 'chats':
      console.log('рџ’¬ Р§Р°С‚С‹:');
      db.chats.forEach(c => {
        const mCount = db.chatMembers.filter(m => m.chatId === c.id).length;
        const mCount2 = db.messages.filter(m => m.chatId === c.id).length;
        console.log(`  ${c.id.slice(0,8)} | [${c.type}] ${c.name || '(direct)'} | СѓС‡Р°СЃС‚РЅРёРєРѕРІ:${mCount} СЃРѕРѕР±С‰РµРЅРёР№:${mCount2}`);
      });
      break;
    case 'msgs': {
      const chatId = args[0];
      if (!chatId) { console.log('РЈРєР°Р¶РёС‚Рµ chatId'); break; }
      const msgs = db.messages.filter(m => m.chatId === chatId).slice(-10);
      if (!msgs.length) { console.log('РќРµС‚ СЃРѕРѕР±С‰РµРЅРёР№'); break; }
      msgs.forEach(m => {
        const sender = db.users.find(u => u.id === m.senderId);
        console.log(`  [${m.createdAt.slice(11,16)}] ${sender?.username || m.senderId}: ${m.content || m.text || '(файл)'}`);
      });
      break;
    }
    case 'delchat': {
      const chatId = args[0];
      if (!chatId) { console.log('РЈРєР°Р¶РёС‚Рµ chatId. РСЃРїРѕР»СЊР·СѓР№С‚Рµ РєРѕРјР°РЅРґСѓ "chats" С‡С‚РѕР±С‹ СѓРІРёРґРµС‚СЊ СЃРїРёСЃРѕРє.'); break; }
      const chatIdx = db.chats.findIndex(c => c.id === chatId || c.id.startsWith(chatId));
      if (chatIdx === -1) { console.log(`Р§Р°С‚ "${chatId}" РЅРµ РЅР°Р№РґРµРЅ`); break; }
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
      console.log(`вњ… Р§Р°С‚ [${chat.type}] "${chat.name || '(direct)'}" СѓРґР°Р»С‘РЅ`);
      console.log(`   РЈРґР°Р»РµРЅРѕ СЃРѕРѕР±С‰РµРЅРёР№: ${msgCount}, СѓС‡Р°СЃС‚РЅРёРєРѕРІ: ${memberCount}`);
      break;
    }
    case 'kick': {
      const userId = args[0];
      if (!userId) { console.log('РЈРєР°Р¶РёС‚Рµ userId'); break; }
      const idx = db.users.findIndex(u => u.id === userId);
      if (idx === -1) { console.log('РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ'); break; }
      db.users.splice(idx, 1);
      db.chatMembers = db.chatMembers.filter(m => m.userId !== userId);
      saveDb();
      console.log(`вњ… РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ ${userId} СѓРґР°Р»С‘РЅ`);
      break;
    }
    case 'stats':
      console.log(`рџ“Љ РЎС‚Р°С‚РёСЃС‚РёРєР°:`);
      console.log(`  РџРѕР»СЊР·РѕРІР°С‚РµР»РµР№: ${db.users.length}`);
      console.log(`  Р§Р°С‚РѕРІ: ${db.chats.length}`);
      console.log(`  РЎРѕРѕР±С‰РµРЅРёР№: ${db.messages.length}`);
      console.log(`  РўСЂРµРєРѕРІ: ${db.tracks.length}`);
      console.log(`  РџР»РµР№Р»РёСЃС‚РѕРІ: ${(db.playlists||[]).length}`);
      console.log(`  РћРЅР»Р°Р№РЅ: ${db.users.filter(u=>u.isOnline).length}`);
      break;
    case 'admins': {
      const envList = ADMIN_ENV.length ? ADMIN_ENV.join(', ') : '(РїСѓСЃС‚Рѕ)';
      const dbList = (db.admins || []).length ? db.admins.join(', ') : '(РїСѓСЃС‚Рѕ)';
      console.log(`рџ‘‘ РђРґРјРёРЅС‹:\n  ENV (ADMIN_USERNAMES): ${envList}\n  DB:                    ${dbList}`);
      break;
    }
    case 'admin': {
      const sub = args[0];
      const name = normAdminName(args[1]);
      if (!sub || !name) { console.log('РСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ: admin add <username> | admin del <username>'); break; }
      if (!Array.isArray(db.admins)) db.admins = [];
      if (sub === 'add') {
        if (db.admins.map(normAdminName).includes(name)) { console.log(`РЈР¶Рµ Р°РґРјРёРЅ: ${name}`); break; }
        const u = db.users.find(x => normAdminName(x.username) === name);
        if (!u) console.log(`вљ  РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ @${name} РЅРµ РЅР°Р№РґРµРЅ РІ Р±Р°Р·Рµ вЂ” Р·Р°РїРёСЃСЊ РІСЃС‘ СЂР°РІРЅРѕ РґРѕР±Р°РІР»РµРЅР°, СЃСЂР°Р±РѕС‚Р°РµС‚ РїСЂРё СЂРµРіРёСЃС‚СЂР°С†РёРё.`);
        db.admins.push(name);
        saveDb();
        console.log(`вњ… @${name} РЅР°Р·РЅР°С‡РµРЅ Р°РґРјРёРЅРѕРј`);
      } else if (sub === 'del' || sub === 'remove' || sub === 'rm') {
        const before = db.admins.length;
        db.admins = db.admins.filter(a => normAdminName(a) !== name);
        saveDb();
        console.log(db.admins.length < before ? `вњ… @${name} Р±РѕР»СЊС€Рµ РЅРµ Р°РґРјРёРЅ` : `РќРµ РЅР°Р№РґРµРЅ РІ db-СЃРїРёСЃРєРµ: ${name}`);
      } else {
        console.log('РќРµРёР·РІРµСЃС‚РЅС‹Р№ РїРѕРґРєРѕРјР°РЅРґ. add | del');
      }
      break;
    }
    case 'clear':
      console.clear(); break;
    case 'exit':
      console.log('РћСЃС‚Р°РЅРѕРІРєР° СЃРµСЂРІРµСЂР°...');
      process.exit(0);
      break;
    case '': break;
    default:
      console.log(`РќРµРёР·РІРµСЃС‚РЅР°СЏ РєРѕРјР°РЅРґР°: ${cmd}. Р’РІРµРґРёС‚Рµ help.`);
  }
  rl.prompt();
});

rl.on('close', () => process.exit(0));
} // end if (process.stdin.isTTY)

// в”Ђв”Ђв”Ђ Self-ping (keep-alive РґР»СЏ Render Free / Р»СЋР±РѕРіРѕ С…РѕСЃС‚РёРЅРіР° СЃРѕ СЃРЅРѕРј) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РљР°Р¶РґС‹Рµ KEEPALIVE_INTERVAL_MS СЃРµСЂРІРµСЂ РґРµР»Р°РµС‚ GET РЅР° СЃР°РјРѕРіРѕ СЃРµР±СЏ, С‡С‚РѕР±С‹ РЅРµ СѓСЃРЅСѓС‚СЊ
// РїРѕСЃР»Рµ 15 РјРёРЅСѓС‚ РЅРµР°РєС‚РёРІРЅРѕСЃС‚Рё. Р—Р°РїСѓСЃРєР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РµСЃР»Рё Р·Р°РґР°РЅ PUBLIC_URL, РёРЅР°С‡Рµ
// СЌС‚Рѕ Р±РµСЃСЃРјС‹СЃР»РµРЅРЅРѕ (Р»РѕРєР°Р»СЊРЅРѕ СЃРµСЂРІРµСЂ Рё С‚Р°Рє РЅРµ Р·Р°СЃС‹РїР°РµС‚).
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
if (PUBLIC_URL) {
  const KEEPALIVE_MS = Number(process.env.KEEPALIVE_INTERVAL_MS) || 10 * 60 * 1000;
  const pingUrl = PUBLIC_URL.replace(/\/+$/, '') + '/api/downloads';
  setInterval(() => {
    // РСЃРїРѕР»СЊР·СѓРµРј global fetch (Node 18+). РћС€РёР±РєРё РёРіРЅРѕСЂРёСЂСѓРµРј вЂ” СЌС‚Рѕ РЅРµРєСЂРёС‚РёС‡РЅРѕ.
    fetch(pingUrl).catch(() => {});
  }, KEEPALIVE_MS);
  console.log(`рџ’“ Keep-alive: РїРёРЅРіСѓСЋ ${pingUrl} РєР°Р¶РґС‹Рµ ${Math.round(KEEPALIVE_MS/60000)} РјРёРЅ`);
}

// в”Ђв”Ђв”Ђ SPA fallback вЂ” РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РџРћРЎР›Р• РІСЃРµС… API РјР°СЂС€СЂСѓС‚РѕРІ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
if (fs.existsSync(CLIENT_DIST)) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// в”Ђв”Ђв”Ђ Р“Р»РѕР±Р°Р»СЊРЅС‹Р№ РѕР±СЂР°Р±РѕС‚С‡РёРє РѕС€РёР±РѕРє Express в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р”РѕР»Р¶РµРЅ Р±С‹С‚СЊ РџРћРЎР›Р• РІСЃРµС… СЂРѕСѓС‚РѕРІ Рё middleware. РќРёРєРѕРіРґР° РЅРµ РѕС‚РґР°С‘Рј СЃС‚РµРє-С‚СЂРµР№СЃ
// РєР»РёРµРЅС‚Сѓ вЂ” С‚РѕР»СЊРєРѕ РѕР±С‰РµРµ СЃРѕРѕР±С‰РµРЅРёРµ Рё РєРѕРґ РѕС€РёР±РєРё. Р’ СЂР°Р·СЂР°Р±РѕС‚РєРµ Р»РѕРіРёСЂСѓРµРј РїРѕРґСЂРѕР±РЅРѕ.
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  if (err) {
    if (isDev) console.error('[UNHANDLED ERROR]', err);
    else console.error('[UNHANDLED ERROR]', err?.message || err);
  }
  // РќРµ РїРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј РѕС‚РІРµС‚, РµСЃР»Рё РѕРЅ СѓР¶Рµ РЅР°С‡Р°С‚.
  if (res.headersSent) return next(err);
  const status = err?.status || err?.statusCode || 500;
  const message = err?.message || 'Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР° СЃРµСЂРІРµСЂР°';
  // РќРµ СЂР°СЃРєСЂС‹РІР°РµРј РІРЅСѓС‚СЂРµРЅРЅРёРµ РґРµС‚Р°Р»Рё РІ РїСЂРѕРґР°РєС€РµРЅРµ.
  const body = isDev
    ? { message, stack: err?.stack, code: err?.code }
    : { message: status === 500 ? 'Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР° СЃРµСЂРІРµСЂР°' : message, code: err?.code };
  res.status(status).json(body);
});

// в”Ђв”Ђв”Ђ Start в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nрџљЂ Vera Server Р·Р°РїСѓС‰РµРЅ РЅР° http://0.0.0.0:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Uploads:   http://localhost:${PORT}/uploads`);
  console.log(`   Р’РІРµРґРёС‚Рµ 'help' РґР»СЏ СЃРїРёСЃРєР° РєРѕРјР°РЅРґ\n`);
  if (process.stdin.isTTY && typeof rl !== 'undefined') rl.prompt();
});
