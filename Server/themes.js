// Каталог встроенных тем: админский редактор.
//
// Встроенные темы ОБЩИЕ для всех пользователей сервера (в отличие от
// персональных userStores): админ правит заводские темы, удаляет их и добавляет
// новые стоковые, а каталог раздаётся клиентам и рассылается онлайн-клиентам
// событием `themes:updated`.
//
// Модуль собран отдельно (как blocks.js), чтобы маршруты можно было покрыть
// тестами без поднятия всего server.js.

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const TEXT_LIMIT = 4096;             // цвета, градиенты, тени
const PHOTO_LIMIT = 3 * 1024 * 1024; // фото чата: URL или data URL
const MAX_ITEMS = 400;

// Ключи, которые реально читает рендер (интерфейс Theme в themeStore.ts).
const STRING_KEYS = [
  'bg', 'text', 'accent', 'bgSidebar', 'bgChat', 'bgHeader', 'bgInput',
  'bgBubbleOwn', 'bgBubbleOther', 'bgHover', 'bgActive', 'textSec', 'border',
  'online', 'chatPattern', 'backgroundGlowColor', 'finish', 'bubbleOwnGradient',
  'bubbleOtherGradient', 'bubbleOwnShadow', 'bubbleOtherShadow', 'sidebarGradient',
  'sidebarBlur',
  'headerGradient', 'bubbleOwnText', 'bubbleOtherText', 'messageTimeColor',
  'chatTimeColor',
];
const NUMBER_KEYS = [
  'chatPatternSizeMin', 'chatPatternSizeMax', 'backgroundGlowIntensity',
  'finishAmount', 'bubbleOwnOpacity', 'bubbleOtherOpacity', 'chatBgImageOpacity',
];
const BOOL_KEYS = ['disableBackgroundBlobs', 'disableBackgroundGlow'];
const MAX_ID = 100000000;

/** Создаёт пустой каталог в БД при первом обращении. */
function ensureThemeCatalog(db) {
  if (!db.builtinThemes || typeof db.builtinThemes !== 'object' || Array.isArray(db.builtinThemes)) {
    db.builtinThemes = { overrides: {}, removed: [], added: [], updatedAt: null };
  }
  const catalog = db.builtinThemes;
  if (!catalog.overrides || typeof catalog.overrides !== 'object' || Array.isArray(catalog.overrides)) {
    catalog.overrides = {};
  }
  if (!Array.isArray(catalog.removed)) catalog.removed = [];
  if (!Array.isArray(catalog.added)) catalog.added = [];
  return catalog;
}

/**
 * Оставляет в теме только то, что читает рендер, и режет длины строк.
 *
 * Каталог общий для всех и лежит в БД, поэтому произвольный JSON сюда пускать
 * нельзя: одна «тема» на 50 МБ легла бы в БД и раздалась каждому клиенту.
 */
function sanitizeCatalogTheme(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = Number(raw.id);
  if (!Number.isInteger(id) || id < 0 || id > MAX_ID) return null;
  const out = { id };
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
  out.name = name || `Тема ${id}`;
  for (const key of STRING_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.length <= TEXT_LIMIT) out[key] = value;
  }
  for (const key of NUMBER_KEYS) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  for (const key of BOOL_KEYS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  // Фото чата — единственная картинка внутри самой темы.
  if (typeof raw.chatBgImage === 'string' && raw.chatBgImage.length <= PHOTO_LIMIT) {
    out.chatBgImage = raw.chatBgImage;
  }
  // Настройки темы: обои, звук, иконки, анимации, внешний вид (включая «обои с
  // календарём и часами») и макет. Огромные data URL внутри не пропускаем.
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
    const settings = { ...raw.settings };
    const photo = settings.wallpaper?.photo;
    if (typeof photo === 'string' && photo.length > PHOTO_LIMIT) {
      settings.wallpaper = { ...settings.wallpaper, photo: undefined };
    }
    if (JSON.stringify(settings).length <= MAX_CATALOG_BYTES / 4) out.settings = settings;
  }
  return out;
}

/** Список id удалённых тем: только положительные целые, без дублей. */
function sanitizeThemeIdList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isInteger(id) || id < 0 || id > MAX_ID || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** Добавленные админом стоковые темы. */
function sanitizeCatalogThemes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const theme = sanitizeCatalogTheme(item);
    if (theme) out.push(theme);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** Полная нормализация каталога (правки + удалённые + добавленные). */
function normalizeCatalog(body) {
  const source = body && typeof body === 'object' ? body : {};
  const overridesRaw = source.overrides && typeof source.overrides === 'object' && !Array.isArray(source.overrides)
    ? source.overrides
    : {};
  const overrides = {};
  for (const [key, value] of Object.entries(overridesRaw)) {
    if (!/^\d{1,9}$/.test(key)) continue;
    const theme = sanitizeCatalogTheme({ ...(value || {}), id: Number(key) });
    if (theme) overrides[key] = theme;
    if (Object.keys(overrides).length >= MAX_ITEMS) break;
  }
  return {
    overrides,
    removed: sanitizeThemeIdList(source.removed),
    added: sanitizeCatalogThemes(source.added),
  };
}
/**
 * Подключает маршруты каталога встроенных тем.
 *
 * @param app       express-приложение
 * @param getDb     () => db
 * @param saveDb    () => void (запись БД, коалесцируется в server.js)
 * @param auth      authMiddleware (кладёт req.userId)
 * @param isAdmin   (req) => boolean — только админ меняет встроенные темы
 * @param notify    (catalog) => void — рассылка `themes:updated` онлайн-клиентам
 */
function install({ app, getDb, saveDb, auth, isAdmin, notify }) {
  const db = () => getDb();
  const broadcast = typeof notify === 'function' ? notify : () => {};
  const isAdminReq = typeof isAdmin === 'function' ? isAdmin : () => false;
  const persist = typeof saveDb === 'function' ? saveDb : () => {};

  // GET /api/themes — каталог встроенных тем (заводские + правки админа).
  // Нужен всем клиентам, а не только админу: иначе правки не увидит никто.
  app.get('/api/themes', auth, (req, res) => {
    res.json({ themes: ensureThemeCatalog(db()) });
  });

  // PUT /api/themes — только админ: каталог целиком (overrides / removed / added).
  app.put('/api/themes', auth, (req, res) => {
    if (!isAdminReq(req)) {
      return res.status(403).json({ message: 'Встроенные темы меняет только администратор' });
    }
    const catalog = normalizeCatalog(req.body);
    const next = {
      ...catalog,
      updatedAt: new Date().toISOString(),
      updatedBy: req.userId || null,
    };
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_CATALOG_BYTES) {
      return res.status(413).json({
        message: `Каталог тем слишком большой (${Math.round(serialized.length / 1024)} КБ)`,
      });
    }
    const stored = ensureThemeCatalog(db());
    stored.overrides = next.overrides;
    stored.removed = next.removed;
    stored.added = next.added;
    stored.updatedAt = next.updatedAt;
    stored.updatedBy = next.updatedBy;
    persist();
    // Каталог из репозитория (Server/content) — страховка от эфемерного диска
    // арендованного сервера. Обновляем сразу после публикации, чтобы свежие
    // правки админа уже были в исходниках, и рестарт их не съел.
    try { require('./backup-content').sync(); } catch {}
    // Правки общие: сообщаем всем клиентам, что встроенные темы изменились.
    try { broadcast(stored); } catch { /* сокет мог ещё не подняться */ }
    res.json({ ok: true, themes: stored });
  });
}

module.exports = {
  install,
  ensureThemeCatalog,
  normalizeCatalog,
  sanitizeCatalogTheme,
  sanitizeThemeIdList,
  sanitizeCatalogThemes,
  MAX_CATALOG_BYTES,
  MAX_ITEMS,
};