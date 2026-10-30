/**
 * Стикеры: наборы, загрузка, коллекция пользователя, отправка в чат.
 *
 * db.stickerPacks   — наборы: { id, name, title, ownerId, stickers[], ... }.
 *                     name — короткое имя для ссылок и поиска, уникально.
 * db.stickerInstalls — { [userId]: packId[] } — какие наборы у человека
 *                     в панели стикеров (по порядку добавления).
 *
 * Все наборы публичные, как в Telegram: найти и добавить чужой набор может
 * любой. Менять набор может только автор.
 *
 * Загруженную картинку не храним как есть: sharp декодирует её (так
 * отсекается всё, что не картинка), вписывает в 512×512 и пересохраняет в
 * WEBP без метаданных. Анимированные GIF/WEBP остаются анимированными.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PACK_NAME_RE = /^[a-z][a-z0-9_]{2,39}$/i;
const MAX_TITLE = 64;
const MAX_PACKS_PER_OWNER = 30;
const MAX_STICKERS_PER_PACK = 120;
const MAX_INSTALLED = 100;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_STICKER_BYTES = 1024 * 1024;
const MAX_FRAMES = 120;
const STICKER_PX = 512;
const MAX_INPUT_PIXELS = 4096 * 4096;
const ALLOWED_FORMATS = new Set(['png', 'webp', 'jpeg', 'gif']);
const DEFAULT_EMOJI = '🙂';

const lower = (v) => String(v || '').trim().toLowerCase();
const stripControl = (v) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

let sharpLib;
function loadSharp() {
  if (sharpLib === undefined) {
    try { sharpLib = require('sharp'); } catch { sharpLib = null; }
  }
  return sharpLib;
}

function cleanPackName(raw) {
  const name = String(raw || '').trim();
  if (!PACK_NAME_RE.test(name)) return { error: 'Короткое имя набора: латиница, цифры и _, от 3 до 40 символов, с буквы' };
  return { name };
}

function cleanTitle(raw) {
  const title = stripControl(raw);
  if (!title) return { error: 'Укажите название набора' };
  if (title.length > MAX_TITLE) return { error: `Название длиннее ${MAX_TITLE} символов` };
  return { title };
}

/** Эмодзи стикера: хотя бы один пиктограф, не больше 8 символов. */
function cleanEmoji(raw) {
  const value = stripControl(raw).replace(/\s+/g, '');
  if (!value) return { emoji: DEFAULT_EMOJI };
  if (!/\p{Extended_Pictographic}/u.test(value)) return { error: 'Укажите эмодзи, например 😀' };
  if (Array.from(value).length > 8) return { error: 'Не больше 8 эмодзи на стикер' };
  return { emoji: value };
}

/**
 * Картинка → WEBP 512×512 (вписываем, без увеличения пропорций).
 * Бросает ошибку с понятным текстом, если файл не подходит.
 */
async function processStickerImage(buffer, sharp = loadSharp()) {
  if (!sharp) throw new Error('Обработка картинок на сервере недоступна');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Пустой файл');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Файл больше 2 МБ');
  let meta;
  try {
    meta = await sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new Error('Это не картинка или файл повреждён');
  }
  if (!ALLOWED_FORMATS.has(meta.format)) throw new Error('Подходят PNG, WEBP, JPEG и GIF');
  const frames = meta.pages || 1;
  if (frames > MAX_FRAMES) throw new Error(`Слишком много кадров: больше ${MAX_FRAMES}`);
  const animated = frames > 1;
  const { data, info } = await sharp(buffer, { animated, limitInputPixels: MAX_INPUT_PIXELS })
    .resize(STICKER_PX, STICKER_PX, { fit: 'inside' })
    .webp({ quality: 85, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  if (data.length > MAX_STICKER_BYTES) throw new Error('После обработки стикер больше 1 МБ: уменьшите картинку или число кадров');
  return { data, width: info.width, height: info.pageHeight || info.height, animated };
}

function ensureCollections(db) {
  if (!Array.isArray(db.stickerPacks)) db.stickerPacks = [];
  if (!db.stickerInstalls || typeof db.stickerInstalls !== 'object' || Array.isArray(db.stickerInstalls)) db.stickerInstalls = {};
}

function stickerView(s) {
  return { id: s.id, emoji: s.emoji, fileUrl: s.fileUrl, width: s.width, height: s.height, animated: !!s.animated };
}

function packView(pack, viewerId, installed) {
  return {
    id: pack.id,
    name: pack.name,
    title: pack.title,
    ownerId: pack.ownerId,
    isMine: pack.ownerId === viewerId,
    installed: !!installed,
    stickers: (pack.stickers || []).map(stickerView),
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
  };
}

/** Короткая карточка для поиска: без полного списка стикеров. */
function packSummary(pack, viewerId, installed) {
  const stickers = pack.stickers || [];
  return {
    id: pack.id, name: pack.name, title: pack.title,
    isMine: pack.ownerId === viewerId, installed: !!installed,
    count: stickers.length, preview: stickers.slice(0, 5).map(stickerView),
  };
}

/** Поиск стикера по id во всех наборах. */
function findSticker(db, stickerId) {
  for (const pack of db.stickerPacks || []) {
    const sticker = (pack.stickers || []).find((s) => s.id === stickerId);
    if (sticker) return { pack, sticker };
  }
  return null;
}

/** Вложение и ссылка на набор для сообщения со стикером. */
function stickerMessageParts(pack, sticker) {
  return {
    attachment: {
      id: crypto.randomUUID(),
      fileUrl: sticker.fileUrl,
      fileName: `${pack.name}-${sticker.id.slice(0, 8)}.webp`,
      fileSize: sticker.size || 0,
      mimeType: 'image/webp',
    },
    ref: { id: sticker.id, packId: pack.id, packName: pack.name, emoji: sticker.emoji },
  };
}

/**
 * @param {object} deps
 * @param {import('express').Express} deps.app
 * @param {() => any} deps.getDb
 * @param {Function} deps.auth
 * @param {() => void} deps.saveDb
 * @param {string} deps.uploadsDir
 * @param {any} deps.multer
 * @param {Function} deps.handleSendMessage   (chatId, userId, body, res, internal)
 * @param {Function} [deps.uploadLimiter]
 * @param {Function} [deps.processImage]       подмена sharp в тестах
 * @param {Function} [deps.createZip]          () => archiver('zip')
 */
function registerStickers({
  app, getDb, auth, saveDb, uploadsDir, multer, handleSendMessage,
  uploadLimiter = (_req, _res, next) => next(),
  sendLimiter = (_req, _res, next) => next(),
  processImage = processStickerImage,
  createZip = () => require('archiver')('zip', { zlib: { level: 6 } }),
}) {
  const dir = path.join(uploadsDir, 'stickers');
  fs.mkdirSync(dir, { recursive: true });
  ensureCollections(getDb());

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
  }).single('file');

  const db = () => { const d = getDb(); ensureCollections(d); return d; };
  const installedIds = (d, userId) => (Array.isArray(d.stickerInstalls[userId]) ? d.stickerInstalls[userId] : []);
  const isInstalled = (d, userId, packId) => installedIds(d, userId).includes(packId);
  const packById = (d, id) => d.stickerPacks.find((p) => p.id === id) || null;
  const packByName = (d, name) => d.stickerPacks.find((p) => lower(p.name) === lower(name)) || null;

  function install(d, userId, packId) {
    const list = installedIds(d, userId).filter((id) => id !== packId);
    if (list.length >= MAX_INSTALLED) return false;
    d.stickerInstalls[userId] = [...list, packId];
    return true;
  }

  function ownPack(req, res) {
    const d = db();
    const pack = packById(d, String(req.params.id || ''));
    if (!pack) { res.status(404).json({ message: 'Набор не найден' }); return null; }
    if (pack.ownerId !== req.userId) { res.status(403).json({ message: 'Менять набор может только автор' }); return null; }
    return { d, pack };
  }

  /** Удаляем файл стикера, только если на него не ссылается ни одно сообщение. */
  function dropFile(d, fileUrl) {
    if (!/^\/uploads\/stickers\/[A-Za-z0-9-]+\.webp$/.test(String(fileUrl || ''))) return;
    const used = (d.messages || []).some((m) => (m.attachments || []).some((a) => (a.fileUrl || a.url) === fileUrl));
    if (used) return;
    try { fs.unlinkSync(path.join(dir, path.basename(fileUrl))); } catch { /* уже нет */ }
  }

  const touch = (pack) => { pack.updatedAt = new Date().toISOString(); };

  // GET /api/stickers/my — наборы в панели стикеров и свои наборы.
  app.get('/api/stickers/my', auth, (req, res) => {
    const d = db();
    const installed = installedIds(d, req.userId).map((id) => packById(d, id)).filter(Boolean);
    const own = d.stickerPacks.filter((p) => p.ownerId === req.userId);
    res.json({
      installed: installed.map((p) => packView(p, req.userId, true)),
      own: own.map((p) => packView(p, req.userId, isInstalled(d, req.userId, p.id))),
    });
  });

  // GET /api/stickers/search?q= — поиск наборов по названию и короткому имени.
  app.get('/api/stickers/search', auth, (req, res) => {
    const d = db();
    const q = lower(String(req.query.q || '').slice(0, 64));
    const found = d.stickerPacks
      .filter((p) => (p.stickers || []).length > 0)
      .filter((p) => !q || lower(p.name).includes(q) || lower(p.title).includes(q))
      .sort((a, b) => (lower(a.name) === q ? -1 : 0) - (lower(b.name) === q ? -1 : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 30);
    res.json(found.map((p) => packSummary(p, req.userId, isInstalled(d, req.userId, p.id))));
  });

  // GET /api/stickers/packs/by-name/:name — набор по короткому имени (ссылки).
  app.get('/api/stickers/packs/by-name/:name', auth, (req, res) => {
    const d = db();
    const pack = packByName(d, req.params.name);
    if (!pack) return res.status(404).json({ message: 'Набор не найден' });
    return res.json(packView(pack, req.userId, isInstalled(d, req.userId, pack.id)));
  });

  // POST /api/stickers/packs { name, title } — новый набор; сразу в панели автора.
  app.post('/api/stickers/packs', auth, (req, res) => {
    const d = db();
    const n = cleanPackName(req.body?.name);
    if (n.error) return res.status(400).json({ message: n.error });
    const t = cleanTitle(req.body?.title);
    if (t.error) return res.status(400).json({ message: t.error });
    if (d.stickerPacks.filter((p) => p.ownerId === req.userId).length >= MAX_PACKS_PER_OWNER) {
      return res.status(429).json({ message: `Не больше ${MAX_PACKS_PER_OWNER} своих наборов` });
    }
    if (packByName(d, n.name)) return res.status(409).json({ message: 'Это короткое имя уже занято' });
    const stamp = new Date().toISOString();
    const pack = { id: crypto.randomUUID(), name: n.name, title: t.title, ownerId: req.userId, stickers: [], createdAt: stamp, updatedAt: stamp };
    d.stickerPacks.push(pack);
    install(d, req.userId, pack.id);
    saveDb();
    return res.status(201).json(packView(pack, req.userId, true));
  });

  // PATCH /api/stickers/packs/:id { title } — переименовать набор.
  app.patch('/api/stickers/packs/:id', auth, (req, res) => {
    const ctx = ownPack(req, res);
    if (!ctx) return undefined;
    const t = cleanTitle(req.body?.title);
    if (t.error) return res.status(400).json({ message: t.error });
    ctx.pack.title = t.title;
    touch(ctx.pack);
    saveDb();
    return res.json(packView(ctx.pack, req.userId, isInstalled(ctx.d, req.userId, ctx.pack.id)));
  });

  // DELETE /api/stickers/packs/:id — удалить набор у всех.
  // Уже отправленные стикеры остаются в чатах: их файлы не трогаем.
  app.delete('/api/stickers/packs/:id', auth, (req, res) => {
    const ctx = ownPack(req, res);
    if (!ctx) return undefined;
    const { d, pack } = ctx;
    d.stickerPacks = d.stickerPacks.filter((p) => p !== pack);
    for (const userId of Object.keys(d.stickerInstalls)) {
      d.stickerInstalls[userId] = installedIds(d, userId).filter((id) => id !== pack.id);
    }
    for (const sticker of pack.stickers || []) dropFile(d, sticker.fileUrl);
    saveDb();
    return res.json({ ok: true });
  });

  // POST /api/stickers/packs/:id/stickers (multipart: file, emoji) — добавить стикер.
  app.post('/api/stickers/packs/:id/stickers', auth, uploadLimiter, (req, res) => {
    const ctx = ownPack(req, res);
    if (!ctx) return undefined;
    return upload(req, res, async (err) => {
      if (err) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({ message: tooBig ? 'Файл больше 2 МБ' : 'Не удалось принять файл' });
      }
      if (!req.file) return res.status(400).json({ message: 'Прикрепите картинку' });
      const e = cleanEmoji(req.body?.emoji);
      if (e.error) return res.status(400).json({ message: e.error });
      const d = db();
      const pack = packById(d, ctx.pack.id);
      if (!pack) return res.status(404).json({ message: 'Набор удалён' });
      if ((pack.stickers || []).length >= MAX_STICKERS_PER_PACK) {
        return res.status(409).json({ message: `В наборе не больше ${MAX_STICKERS_PER_PACK} стикеров` });
      }
      let image;
      try { image = await processImage(req.file.buffer); } catch (error) {
        return res.status(400).json({ message: (error && error.message) || 'Не удалось обработать картинку' });
      }
      const id = crypto.randomUUID();
      const fileName = `${id}.webp`;
      try {
        // Папку мог снести админский сброс загрузок — создаём заново.
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fileName), image.data);
      } catch {
        return res.status(500).json({ message: 'Не удалось сохранить стикер' });
      }
      const sticker = {
        id, emoji: e.emoji, fileUrl: `/uploads/stickers/${fileName}`,
        width: image.width, height: image.height, animated: !!image.animated,
        size: image.data.length, createdAt: new Date().toISOString(),
      };
      pack.stickers = [...(pack.stickers || []), sticker];
      touch(pack);
      saveDb();
      return res.status(201).json(packView(pack, req.userId, isInstalled(d, req.userId, pack.id)));
    });
  });

  // PATCH /api/stickers/packs/:id/stickers/:stickerId { emoji } — сменить эмодзи.
  app.patch('/api/stickers/packs/:id/stickers/:stickerId', auth, (req, res) => {
    const ctx = ownPack(req, res);
    if (!ctx) return undefined;
    const sticker = (ctx.pack.stickers || []).find((s) => s.id === req.params.stickerId);
    if (!sticker) return res.status(404).json({ message: 'Стикер не найден' });
    const e = cleanEmoji(req.body?.emoji);
    if (e.error) return res.status(400).json({ message: e.error });
    sticker.emoji = e.emoji;
    touch(ctx.pack);
    saveDb();
    return res.json(packView(ctx.pack, req.userId, isInstalled(ctx.d, req.userId, ctx.pack.id)));
  });

  // DELETE /api/stickers/packs/:id/stickers/:stickerId — убрать стикер из набора.
  app.delete('/api/stickers/packs/:id/stickers/:stickerId', auth, (req, res) => {
    const ctx = ownPack(req, res);
    if (!ctx) return undefined;
    const sticker = (ctx.pack.stickers || []).find((s) => s.id === req.params.stickerId);
    if (!sticker) return res.status(404).json({ message: 'Стикер не найден' });
    ctx.pack.stickers = ctx.pack.stickers.filter((s) => s !== sticker);
    dropFile(ctx.d, sticker.fileUrl);
    touch(ctx.pack);
    saveDb();
    return res.json(packView(ctx.pack, req.userId, isInstalled(ctx.d, req.userId, ctx.pack.id)));
  });

  // POST /api/stickers/packs/:id/install — добавить набор в свою панель.
  app.post('/api/stickers/packs/:id/install', auth, (req, res) => {
    const d = db();
    const pack = packById(d, String(req.params.id || ''));
    if (!pack) return res.status(404).json({ message: 'Набор не найден' });
    if (!install(d, req.userId, pack.id)) return res.status(409).json({ message: `В панели не больше ${MAX_INSTALLED} наборов` });
    saveDb();
    return res.json(packView(pack, req.userId, true));
  });

  // DELETE /api/stickers/packs/:id/install — убрать набор из своей панели.
  app.delete('/api/stickers/packs/:id/install', auth, (req, res) => {
    const d = db();
    const id = String(req.params.id || '');
    d.stickerInstalls[req.userId] = installedIds(d, req.userId).filter((x) => x !== id);
    saveDb();
    return res.json({ ok: true });
  });

  // GET /api/stickers/packs/:id/download — ZIP: WEBP-файлы и pack.json.
  app.get('/api/stickers/packs/:id/download', auth, (req, res) => {
    const pack = packById(db(), String(req.params.id || ''));
    if (!pack) return res.status(404).json({ message: 'Набор не найден' });
    const zip = createZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pack.name}.zip"`);
    zip.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
    zip.pipe(res);
    const manifest = { name: pack.name, title: pack.title, stickers: [] };
    (pack.stickers || []).forEach((s, i) => {
      const file = path.join(dir, path.basename(s.fileUrl));
      if (!fs.existsSync(file)) return;
      const entry = `${String(i + 1).padStart(3, '0')}.webp`;
      zip.file(file, { name: entry });
      manifest.stickers.push({ file: entry, emoji: s.emoji, animated: !!s.animated });
    });
    zip.append(JSON.stringify(manifest, null, 2), { name: 'pack.json' });
    void zip.finalize();
    return undefined;
  });

  // POST /api/stickers/send { chatId, stickerId, clientTempId? } — стикер в чат.
  // Права (участник, блокировки, канал) проверяет общий handleSendMessage.
  app.post('/api/stickers/send', auth, sendLimiter, (req, res) => {
    const found = findSticker(db(), String(req.body?.stickerId || ''));
    if (!found) return res.status(404).json({ message: 'Стикер не найден' });
    const { attachment, ref } = stickerMessageParts(found.pack, found.sticker);
    return handleSendMessage(String(req.body?.chatId || ''), req.userId, {
      attachments: [attachment], type: 'sticker',
      clientTempId: typeof req.body?.clientTempId === 'string' ? req.body.clientTempId : undefined,
    }, res, { sticker: ref });
  });

  /** Для Bot API: стикер по id в виде частей сообщения. */
  return {
    resolveSticker(stickerId) {
      const found = findSticker(db(), stickerId);
      return found ? stickerMessageParts(found.pack, found.sticker) : null;
    },
  };
}

module.exports = {
  registerStickers,
  processStickerImage,
  cleanPackName,
  cleanEmoji,
  findSticker,
  MAX_STICKERS_PER_PACK,
  MAX_UPLOAD_BYTES,
};
