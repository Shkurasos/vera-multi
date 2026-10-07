/**
 * Общие стоковые шрифты, которые админ заливает для всех.
 *
 * Отличие от «своих шрифтов» пользователя (`customFontsStore`): те лежат в
 * IndexedDB устройства и доступны только ему. Здесь файл лежит на сервере, и
 * шрифт появляется в выборе шрифта у ВСЕХ — как обычный стоковый, без загрузки.
 *
 * Шрифты — не картинки: mime-типы у них ненадёжны (браузер отдаёт
 * application/octet-stream), поэтому проверяем РАСШИРЕНИЕ, а не content-type.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ITEMS = 100;
const MAX_NAME = 80;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
// Те же расширения, что принимает FontPicker для своих шрифтов.
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

function ensureCatalog(db) {
  if (!db.adminFonts || typeof db.adminFonts !== 'object' || Array.isArray(db.adminFonts)) {
    db.adminFonts = { items: [], updatedAt: null };
  }
  if (!Array.isArray(db.adminFonts.items)) db.adminFonts.items = [];
  if (typeof db.adminFonts.updatedAt !== 'string') db.adminFonts.updatedAt = null;
  return db.adminFonts;
}

function sanitizeName(raw) {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : '';
}

/**
 * Имя семейства из имени файла.
 *
 * Оно попадает в `@font-face { font-family: "…" }` и в CSS-значение настроек,
 * поэтому кавычки, обратные слэши и переводы строк убираются — иначе правило
 * разорвётся, а шрифт молча не применится.
 */
function sanitizeFamily(raw) {
  return String(raw || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/["'\\;{}()<>,\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/** Ссылка строго на нашу папку — иначе в шрифты можно было бы подсунуть чужой URL. */
function isOwnUpload(url) {
  return typeof url === 'string' && /^\/uploads\/fonts\/[A-Za-z0-9._-]+$/.test(url);
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!/^admin-font-[a-f0-9]{4,40}$/.test(id)) return null;
  const family = sanitizeFamily(raw.family);
  if (!family) return null;
  const url = String(raw.url || '');
  if (!isOwnUpload(url)) return null;
  return { id, name: sanitizeName(raw.name) || family, family, url };
}

function sanitizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const clean = sanitizeItem(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function makeId() {
  return `admin-font-${crypto.randomBytes(8).toString('hex')}`;
}

/** Пропускаем ли такой файл: решает расширение, а не mime (см. шапку модуля). */
function isFontFile(fileName) {
  return FONT_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
}
function install({ app, getDb, saveDb, auth, isAdmin, notify, upload, uploadsDir, onUploadError }) {
  const catalog = () => ensureCatalog(getDb());
  const persist = typeof saveDb === 'function' ? saveDb : () => {};
  const broadcast = typeof notify === 'function' ? notify : () => {};
  const adminCheck = typeof isAdmin === 'function' ? isAdmin : () => false;
  const uploadErr = typeof onUploadError === 'function' ? onUploadError : (err, req, res, next) => {
    if (!err) return next();
    res.status(400).json({
      message: err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой' : (err.message || 'Ошибка загрузки'),
    });
  };

  function dropFile(file) {
    if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
  }

  function commit(next) {
    const stored = catalog();
    stored.items = next;
    stored.updatedAt = new Date().toISOString();
    persist();
    try { broadcast(stored); } catch { /* сокет мог ещё не подняться */ }
    return stored;
  }

  // Читает любой залогиненный: иначе общие шрифты никто не увидит.
  app.get('/api/themes/fonts', auth, (req, res) => {
    res.json({ fonts: catalog() });
  });

  const uploadMw = upload.single('file');
  app.post('/api/themes/fonts', auth, uploadMw, (req, res) => {
    if (!adminCheck(req)) {
      dropFile(req.file);
      return res.status(403).json({ message: 'Общие шрифты меняет только администратор' });
    }
    if (!req.file) return res.status(400).json({ message: 'Файл не получен' });
    if (!isFontFile(req.file.originalname)) {
      dropFile(req.file);
      return res.status(400).json({ message: 'Нужен файл .ttf, .otf, .woff или .woff2' });
    }
    const stored = catalog();
    if (stored.items.length >= MAX_ITEMS) {
      dropFile(req.file);
      return res.status(413).json({ message: `Больше ${MAX_ITEMS} общих шрифтов добавить нельзя` });
    }
    const family = sanitizeFamily(req.body?.family || path.parse(req.file.originalname || '').name);
    const item = sanitizeItem({
      id: makeId(),
      name: sanitizeName(req.body?.name) || family,
      family,
      url: `/uploads/fonts/${req.file.filename}`,
    });
    if (!item) {
      dropFile(req.file);
      return res.status(400).json({ message: 'Не удалось прочитать название шрифта из файла' });
    }
    res.json({ ok: true, fonts: commit([...stored.items, item]) });
  }, uploadErr);

  app.delete('/api/themes/fonts/:id', auth, (req, res) => {
    if (!adminCheck(req)) return res.status(403).json({ message: 'Общие шрифты меняет только администратор' });
    const stored = catalog();
    const removed = stored.items.find((i) => i.id === req.params.id);
    if (!removed) return res.status(404).json({ message: 'Шрифт не найден' });
    if (uploadsDir && isOwnUpload(removed.url)) {
      try { fs.unlinkSync(path.join(uploadsDir, path.basename(removed.url))); } catch {}
    }
    res.json({ ok: true, fonts: commit(stored.items.filter((i) => i.id !== req.params.id)) });
  });
}

module.exports = {
  install, ensureCatalog, sanitizeItem, sanitizeItems, sanitizeName, sanitizeFamily,
  isOwnUpload, isFontFile, makeId, FONT_EXTENSIONS, MAX_ITEMS, MAX_FILE_BYTES,
};