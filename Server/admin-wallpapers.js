/**
 * Каталог встроенных обоев (фонов), которым управляет админ.
 *
 * Отличие от каталога тем (`themes.js`): здесь сами файлы. Админ заливает фото
 * или заводит css-фон, и они появляются в общей галерее обоев у ВСЕХ — рядом с
 * заводскими `base-*` из `baseWallpapers.ts`.
 *
 * Фото не кладём в БД base64 (раздувало бы файл БД на мегабайты): multer
 * сохраняет их в `uploads/wallpapers/`, в каталоге лежит только URL.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ITEMS = 200;
const MAX_NAME = 80;
const MAX_CSS = 4096;
// Фон рисуется у каждого клиента, поэтому css из сети — это по сути код в
// style: оставляем только градиенты и цвета. url() запрещён (иначе можно было
// бы затащить внешний ресурс или file://), скобки и «;» — тоже: ими из
// значения `background` выходят наружу.
const CSS_FORBIDDEN = /url\s*\(|@|expression|javascript|;|\{|\}|<|>|\\/i;

function ensureCatalog(db) {
  if (!db.builtinWallpapers || typeof db.builtinWallpapers !== 'object' || Array.isArray(db.builtinWallpapers)) {
    db.builtinWallpapers = { items: [], hidden: [], overrides: {}, updatedAt: null };
  }
  // Поля должны существовать всегда, даже если БД писалась старой версией: иначе
  // ответ уезжает без updatedAt, и клиент не может отличить «ещё не загружали» от
  // «загружали, но каталог пуст».
  if (!Array.isArray(db.builtinWallpapers.items)) db.builtinWallpapers.items = [];
  if (!Array.isArray(db.builtinWallpapers.hidden)) db.builtinWallpapers.hidden = [];
  if (!db.builtinWallpapers.overrides || typeof db.builtinWallpapers.overrides !== 'object') {
    db.builtinWallpapers.overrides = {};
  }
  if (typeof db.builtinWallpapers.updatedAt !== 'string') db.builtinWallpapers.updatedAt = null;
  return db.builtinWallpapers;
}

/**
 * Формат id фонов, вшитых в клиент.
 *
 * Заводские фоны живут в бандле, сервер их не видит — поэтому описываем их
 * формами: с такими id работают правка и скрытие. `none` — сброс выбора, а не
 * фон: трогать его нельзя, иначе у всех в галерее пропала бы возможность
 * выключить обои.
 */
const FACTORY_ID_RE = /^(base-[a-z0-9-]{2,60}|[a-z0-9-]{2,60})$/;

/**
 * `admin-wp-*` — это наши собственные загруженные фоны, а не заводские. Если бы
 * regex их пропускал, то удаление такого фона (который лежит в items) можно
 * было бы провернуть и как «скрытие», а правка — записать и в items, и в
 * overrides: фон остался бы в галерее с двойным применением.
 */
function isFactoryId(raw) {
  const id = String(raw || '');
  if (!id || id === 'none' || id.startsWith('admin-wp-')) return false;
  return FACTORY_ID_RE.test(id);
}

/** Скрытые заводские фоны: только такие id. */
function sanitizeHidden(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    if (!isFactoryId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Правка заводского фона: те же поля, что и у элемента каталога, но id может
 * быть заводским. Значения проверяются ровно так же — css рисуется у всех.
 */
function sanitizeOverride(rawId, raw) {
  if (!isFactoryId(rawId) || !raw || typeof raw !== 'object') return null;
  const out = {};
  if (typeof raw.name === 'string') {
    const name = sanitizeName(raw.name);
    if (name) out.name = name;
  }
  if (typeof raw.light === 'boolean') out.light = raw.light;
  if (typeof raw.css === 'string') {
    const css = raw.css.trim();
    if (css && css.length <= MAX_CSS && css !== 'none' && !CSS_FORBIDDEN.test(css)) out.css = css;
  }
  if (typeof raw.url === 'string' && isOwnUpload(raw.url)) out.url = raw.url;
  // Правка без изменений (например, пустое имя) — не пишем.
  return Object.keys(out).length ? out : null;
}

function sanitizeOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const [id, value] of Object.entries(raw)) {
    const clean = sanitizeOverride(id, value);
    if (!clean) continue;
    out[id] = clean;
    if (++count >= MAX_ITEMS) break;
  }
  return out;
}

function sanitizeName(raw) {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : '';
}

/** Фото-обои: только наш же /uploads/wallpapers/... — никаких произвольных URL. */
function isOwnUpload(url) {
  return typeof url === 'string' && /^\/uploads\/wallpapers\/[A-Za-z0-9._-]+$/.test(url);
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').slice(0, 80);
  if (!/^admin-wp-[a-z0-9-]{4,60}$/.test(id)) return null;
  const name = sanitizeName(raw.name) || 'Фон';
  const light = !!raw.light;
  if (raw.type === 'photo') {
    if (!isOwnUpload(raw.url)) return null;
    return { id, name, type: 'photo', url: raw.url, light };
  }
  if (raw.type === 'base') {
    const css = typeof raw.css === 'string' ? raw.css.trim() : '';
    if (!css || css.length > MAX_CSS || css === 'none') return null;
    if (CSS_FORBIDDEN.test(css)) return null;
    return { id, name, type: 'base', css, light };
  }
  return null;
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

/** Новый id: он же уходит в css-класс, поэтому без спецсимволов. */
function makeId() {
  return `admin-wp-${crypto.randomBytes(6).toString('hex')}`;
}

function install({ app, getDb, saveDb, auth, isAdmin, notify, upload, uploadsDir, onUploadError }) {
  const catalog = () => ensureCatalog(getDb());
  const persist = typeof saveDb === 'function' ? saveDb : () => {};
  const broadcast = typeof notify === 'function' ? notify : () => {};
  const adminCheck = typeof isAdmin === 'function' ? isAdmin : () => false;
  // Обработчик ошибок multer необязателен лишь технически: без него отказ
  // уходит в стандартный обработчик express (500 с HTML). Поэтому подставляем
  // заглушку, чтобы модуль не падал сам и ошибка была хоть в JSON.
  const uploadErr = typeof onUploadError === 'function' ? onUploadError : (err, req, res, next) => {
    if (!err) return next();
    res.status(400).json({
      message: err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой' : (err.message || 'Ошибка загрузки'),
    });
  };

  function requireAdmin(req, res) {
    if (adminCheck(req)) return true;
    res.status(403).json({ message: 'Встроенные фоны меняет только администратор' });
    return false;
  }

  function dropFile(file) {
    if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
  }

  // Принимает ЧАСТИЧНЫЙ патч каталога (или ничего — просто зафиксировать время).
  // Раньше сюда передавался готовый список items, и вызов вида commit(stored)
  // молча записал бы весь объект каталога в items — фон исчез бы у всех.
  function commit(patch) {
    const stored = catalog();
    if (patch && !Array.isArray(patch)) Object.assign(stored, patch);
    else if (Array.isArray(patch)) stored.items = patch;
    stored.updatedAt = new Date().toISOString();
    persist();
    // Зеркалим каталог в Server/content (папка в репозитории). На арендованном
    // сервере диск эфемерный: без этого после рестарта и загруженные фото-обои,
    // и сам список фонов исчезли бы. sync() сам скопирует файлы в content/.
    try { require('./backup-content').sync(); } catch {}
    try { broadcast(stored); } catch { /* сокет мог ещё не подняться */ }
    return stored;
  }

  // Читает кто угодно залогиненный: иначе админские фоны никто не увидит.
  app.get('/api/themes/wallpapers', auth, (req, res) => {
    res.json({ wallpapers: catalog() });
  });

  // Загрузка фото-фона админом.
  // Обработчик ошибок multer обязателен: без него отказ fileFilter (например
  // файл без mime-типа — обычное дело для HEIC/RAW с телефона) уходит в
  // стандартный обработчик express и возвращает 500 с HTML вместо 400 с
  // понятным текстом. Клиент такой ответ читает как «Не удалось загрузить».
  const uploadMw = upload.single('file');
  app.post('/api/themes/wallpapers', auth, uploadMw, (req, res) => {
    if (!requireAdmin(req, res)) return dropFile(req.file);
    if (!req.file) return res.status(400).json({ message: 'Файл не получен' });
    const stored = catalog();
    if (stored.items.length >= MAX_ITEMS) {
      dropFile(req.file);
      return res.status(413).json({ message: `Больше ${MAX_ITEMS} фонов добавить нельзя` });
    }
    const item = sanitizeItem({
      id: makeId(),
      name: sanitizeName(req.body?.name) || path.parse(req.file.originalname || '').name,
      type: 'photo',
      // Относительный путь: за ним идёт /uploads, как у вложений.
      url: `/uploads/wallpapers/${req.file.filename}`,
      light: String(req.body?.light) === '1' || req.body?.light === true,
    });
    if (!item) {
      dropFile(req.file);
      return res.status(400).json({ message: 'Такой файл нельзя добавить в фоны' });
    }
    res.json({ ok: true, wallpapers: commit([...stored.items, item]) });
  }, uploadErr);

  // Фон без файла — просто css (градиент/цвета).
  app.post('/api/themes/wallpapers/base', auth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const stored = catalog();
    if (stored.items.length >= MAX_ITEMS) {
      return res.status(413).json({ message: `Больше ${MAX_ITEMS} фонов добавить нельзя` });
    }
    const item = sanitizeItem({
      id: makeId(), name: req.body?.name, type: 'base', css: req.body?.css, light: req.body?.light,
    });
    if (!item) {
      return res.status(400).json({ message: 'Нужен css фона: только градиенты и цвета, без url(), @ и ;' });
    }
    res.json({ ok: true, wallpapers: commit([...stored.items, item]) });
  });

  app.delete('/api/themes/wallpapers/:id', auth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const stored = catalog();
    const removed = stored.items.find((i) => i.id === req.params.id);
    if (removed) {
      // Загруженный файл убираем вместе с фоном, иначе uploads растут вечно.
      if (removed.type === 'photo' && uploadsDir && isOwnUpload(removed.url)) {
        try { fs.unlinkSync(path.join(uploadsDir, path.basename(removed.url))); } catch {}
      }
      stored.items = stored.items.filter((i) => i.id !== req.params.id);
      delete stored.overrides[req.params.id];
      stored.hidden = stored.hidden.filter((x) => x !== req.params.id);
      return res.json({ ok: true, wallpapers: commit(stored) });
    }
    // Заводской фон лежит в бандле клиента — удалить его файлом нельзя, но можно
    // убрать из галереи у всех: для пользователя эффект тот же, а вернуть —
    // одним кликом (правка снимает скрытие).
    if (!isFactoryId(req.params.id)) return res.status(404).json({ message: 'Фон не найден' });
    if (stored.hidden.includes(req.params.id)) return res.status(404).json({ message: 'Фон уже скрыт' });
    stored.hidden = [...stored.hidden, req.params.id];
    res.json({ ok: true, wallpapers: commit(stored) });
  });

  // Переименование и пометка «светлый» — без смены картинки. Именно это нужно,
  // чтобы поправить опечатку в названии или переключить тёмность: темы, уже
  // ссылающиеся на этот фон, продолжат работать, потому что id не меняется.
  app.put('/api/themes/wallpapers/:id', auth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const stored = catalog();
    const found = stored.items.find((i) => i.id === req.params.id);
    if (found) {
      const next = sanitizeItem({
        ...found,
        name: req.body?.name === undefined ? found.name : req.body.name,
        light: req.body?.light === undefined ? found.light : !!req.body.light,
      });
      if (!next) return res.status(400).json({ message: 'Не удалось применить изменения' });
      // Изменился только css — новое правило уйдёт всем по событию.
      if (next.type === 'base' && typeof req.body?.css === 'string') {
        next.css = sanitizeItem({ ...next, css: req.body.css })?.css;
        if (!next.css) return res.status(400).json({ message: 'Нужен css фона: только градиенты и цвета' });
      }
      stored.items = stored.items.map((i) => (i.id === next.id ? next : i));
      return res.json({ ok: true, wallpapers: commit(stored) });
    }
    // Заводской фон: правим его «поверх бандла». Заодно правка снимает скрытие —
    // иначе «вернуть» скрытый фон было бы нечем.
    const override = sanitizeOverride(req.params.id, {
      name: req.body?.name,
      light: req.body?.light,
      css: req.body?.css,
    });
    if (!override) return res.status(400).json({ message: 'Не удалось применить изменения' });
    stored.overrides = { ...stored.overrides, [req.params.id]: override };
    stored.hidden = stored.hidden.filter((x) => x !== req.params.id);
    res.json({ ok: true, wallpapers: commit(stored) });
  });

  // Замена картинки существующего фото-фона: id сохраняется, поэтому темы и
  // выборки обоев остаются валидными — меняется только сам файл.
  app.post('/api/themes/wallpapers/:id/replace', auth, uploadMw, (req, res) => {
    if (!requireAdmin(req, res)) return dropFile(req.file);
    if (!req.file) return res.status(400).json({ message: 'Файл не получен' });
    const stored = catalog();
    const old = stored.items.find((i) => i.id === req.params.id);
    if (!old || old.type !== 'photo') {
      dropFile(req.file);
      return res.status(400).json({ message: 'Заменить фото можно только у фото-фона' });
    }
    const next = sanitizeItem({
      id: old.id,
      name: sanitizeName(req.body?.name) || old.name,
      type: 'photo',
      url: `/uploads/wallpapers/${req.file.filename}`,
      light: req.body?.light === undefined ? old.light : String(req.body.light) === '1',
    });
    if (!next) {
      dropFile(req.file);
      return res.status(400).json({ message: 'Такой файл нельзя добавить в фоны' });
    }
    // Старый файл удаляем только после успешной записи нового: если бы он был
    // единственным, а новый не прошёл проверку, фон остался бы битым.
    if (uploadsDir && isOwnUpload(old.url)) {
      try { fs.unlinkSync(path.join(uploadsDir, path.basename(old.url))); } catch {}
    }
    res.json({ ok: true, wallpapers: commit(stored.items.map((i) => (i.id === next.id ? next : i))) });
  }, uploadErr);
}

module.exports = {
  install, ensureCatalog, sanitizeItem, sanitizeItems, sanitizeName, isOwnUpload, makeId,
  isFactoryId, sanitizeHidden, sanitizeOverride, sanitizeOverrides,
  MAX_ITEMS, MAX_CSS, CSS_FORBIDDEN,
};