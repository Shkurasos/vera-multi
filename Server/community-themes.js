const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ITEMS = 500;
const MAX_NAME = 100;
const MAX_DESCRIPTION = 500;
const MAX_THEME_BYTES = 512 * 1024;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const THEME_KEYS = new Set([
  'id', 'name', 'bg', 'text', 'accent', 'bgSidebar', 'bgChat', 'bgHeader', 'bgInput',
  'bgBubbleOwn', 'bgBubbleOther', 'bgHover', 'bgActive', 'textSec', 'border', 'online',
  'chatPattern', 'backgroundGlowColor', 'finish', 'bubbleOwnGradient', 'bubbleOtherGradient',
  'bubbleOwnShadow', 'bubbleOtherShadow', 'sidebarGradient', 'sidebarBlur', 'headerGradient',
  'bubbleOwnText', 'bubbleOtherText', 'messageTimeColor', 'chatTimeColor', 'settings',
  'chatPatternSizeMin', 'chatPatternSizeMax', 'backgroundGlowIntensity', 'finishAmount',
  'bubbleOwnOpacity', 'bubbleOtherOpacity', 'chatBgImageOpacity', 'disableBackgroundBlobs',
  'disableBackgroundGlow', 'chatBgImage',
]);

function ensureCatalog(db) {
  if (!Array.isArray(db.communityThemes)) db.communityThemes = [];
  return db.communityThemes;
}

function cleanTheme(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!THEME_KEYS.has(key)) continue;
    if (key === 'settings') {
      if (value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= MAX_THEME_BYTES / 2) out.settings = value;
    } else if (typeof value === 'string' && value.length <= 4096) out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  out.name = String(raw.name || 'Тема сообщества').trim().slice(0, MAX_NAME) || 'Тема сообщества';
  return JSON.stringify(out).length <= MAX_THEME_BYTES ? out : null;
}

function cleanText(value, max) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''; }
function publicItem(item) {
  return { id: item.id, name: item.name, description: item.description, authorId: item.authorId,
    authorName: item.authorName, theme: item.theme, previewUrl: item.previewUrl || null,
    assetUrl: item.assetUrl || null, assetType: item.assetType || null, downloads: item.downloads || 0,
    createdAt: item.createdAt };
}
function safeFile(file, allowed, maxBytes) {
  if (!file || !file.path) return null;
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!allowed.has(ext) || file.size > maxBytes) { try { fs.unlinkSync(file.path); } catch {} return null; }
  return ext;
}

function install({ app, getDb, saveDb, auth, isAdmin, uploadsDir, upload, onUploadError, notify }) {
  const folder = path.join(uploadsDir, 'community-themes');
  try { fs.mkdirSync(folder, { recursive: true }); } catch {}
  const read = (req, res) => {
    const q = cleanText(req.query.q, 80).toLowerCase();
    const items = ensureCatalog(getDb()).filter(x => !q || `${x.name} ${x.description} ${x.authorName}`.toLowerCase().includes(q));
    res.json({ themes: items.slice(-MAX_ITEMS).reverse().map(publicItem) });
  };
  app.get('/api/community/themes', auth, read);
  const multipart = (req, res, next) => upload.fields([
    { name: 'theme', maxCount: 1 }, { name: 'preview', maxCount: 1 }, { name: 'asset', maxCount: 1 },
  ])(req, res, err => {
    if (!err) return next();
    if (typeof onUploadError === 'function') return onUploadError(err, req, res, next);
    return res.status(400).json({ message: err.message || 'Ошибка загрузки' });
  });
  app.post('/api/community/themes', auth, multipart, (req, res) => {
    const files = req.files || {};
    const themeFile = files.theme?.[0];
    let theme;
    try { theme = cleanTheme(JSON.parse(fs.readFileSync(themeFile.path, 'utf8'))); } catch {}
    if (!theme) { try { if (themeFile?.path) fs.unlinkSync(themeFile.path); } catch {} return res.status(400).json({ message: 'Некорректный файл темы' }); }
    try { fs.unlinkSync(themeFile.path); } catch {}
    const preview = files.preview?.[0];
    const asset = files.asset?.[0];
    const previewExt = preview ? safeFile(preview, IMAGE_EXTENSIONS, MAX_PREVIEW_BYTES) : null;
    const assetExt = asset ? safeFile(asset, new Set([...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS]), MAX_ASSET_BYTES) : null;
    if (preview && !previewExt || asset && !assetExt) {
      for (const file of [preview, asset]) if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
      return res.status(400).json({ message: 'Тип или размер файла не разрешён' });
    }
    const user = (getDb().users || []).find(u => u.id === req.userId) || {};
    const id = crypto.randomUUID();
    const move = (file, ext, kind) => { if (!file || !ext) return null; const dest = path.join(folder, `${id}-${kind}${ext}`); fs.renameSync(file.path, dest); return `/uploads/community-themes/${path.basename(dest)}`; };
    const item = { id, name: cleanText(req.body?.name, MAX_NAME) || theme.name, description: cleanText(req.body?.description, MAX_DESCRIPTION),
      authorId: String(req.userId), authorName: cleanText(user.username || user.firstName, 80) || 'Пользователь', theme,
      previewUrl: move(preview, previewExt, 'preview'), assetUrl: move(asset, assetExt, 'asset'), assetType: assetExt && FONT_EXTENSIONS.has(assetExt) ? 'font' : assetExt ? 'image' : null,
      downloads: 0, createdAt: new Date().toISOString() };
    const catalog = ensureCatalog(getDb()); catalog.push(item); while (catalog.length > MAX_ITEMS) catalog.shift(); saveDb();
    if (notify) notify(catalog.map(publicItem));
    res.status(201).json({ theme: publicItem(item) });
  });
  app.post('/api/community/themes/:id/install', auth, (req, res) => {
    const item = ensureCatalog(getDb()).find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({ message: 'Тема не найдена' });
    item.downloads = Number(item.downloads || 0) + 1; saveDb(); res.json({ theme: publicItem(item) });
  });
  app.get('/api/community/themes/:id/download', auth, (req, res) => {
    const item = ensureCatalog(getDb()).find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({ message: 'Тема не найдена' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${item.id}.json"`);
    res.send(JSON.stringify(item.theme, null, 2));
  });
  app.delete('/api/community/themes/:id', auth, (req, res) => {
    const catalog = ensureCatalog(getDb()); const index = catalog.findIndex(x => x.id === req.params.id); const item = catalog[index];
    if (!item) return res.status(404).json({ message: 'Тема не найдена' });
    if (item.authorId !== String(req.userId) && !isAdmin(req)) return res.status(403).json({ message: 'Нет доступа' });
    for (const url of [item.previewUrl, item.assetUrl]) { const name = path.basename(String(url || '')); if (name && /^[a-f0-9-]+-(preview|asset)\.[a-z0-9]+$/i.test(name)) { try { fs.unlinkSync(path.join(folder, name)); } catch {} } }
    catalog.splice(index, 1); saveDb(); res.json({ ok: true });
  });
}

module.exports = { install, ensureCatalog, cleanTheme, MAX_THEME_BYTES };