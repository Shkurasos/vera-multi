/**
 * ВЫГРУЗКА ПРАВОК ТЕМ И ОБОЕВ В РЕПОЗИТОРИЙ
 * =========================================
 *
 * Проблема. Правки админа (темы, обои, фото) лежат в runtime-данных:
 *   - каталог  — в Server/data/vera.json (db.builtinThemes / builtinWallpapers)
 *   - фото     — в Server/uploads/wallpapers/
 * Оба пути в .gitignore, поэтому при выкладке исходников (git push, новая
 * машина, новый деплой) правки не уезжают вместе с кодом.
 *
 * Решение. Каталог зеркалится в Server/content/ — эта папка В РЕПОЗИТОРИИ.
 * При старте сервер читает её и поднимает каталог из БД (см. seedOnBoot).
 *
 * ─── Как это работает на практике ─────────────────────────────────────────
 *
 * Авторство правок на локалхосте, деплой через GitHub:
 *   CONTENT_SOURCE=repo   → на старте сервер берёт каталог из репозитория.
 *                            Каждый деплой приводит сервер к тому, что
 *                            закоммичено. Правки в админке НА СЕРВЕРЕ при
 *                            этом затираются на следующем деплое.
 *
 * Правки прямо на сервере (в админке):
 *   CONTENT_SOURCE не задан (по умолчанию 'auto')
 *                          → каталог сервера неприкосновенен, из репозитория
 *                            он берётся только если в БД его нет вовсе.
 *                            Это же спасает, когда диск сервера обнулился.
 *
 * ─── Команды ──────────────────────────────────────────────────────────────
 *
 *   node backup-content.js            выгрузить каталог из БД в Server/content
 *   node backup-content.js --restore  залить Server/content обратно в БД
 *
 * Выгрузка обновляется автоматически после каждой правки админа, так что
 * вручную её запускать нужно редко. После правок не забывайте коммитить
 * Server/content — именно репозиторий и есть постоянное хранилище.
 */
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'vera.json');
// Папка выгрузки переопределяется через CONTENT_DIR — иначе тесты писали бы в
// настоящий Server/content и подменяли бы реальный бэкап тем тестовыми данными.
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, 'content');
const CONTENT_WALLPAPERS = path.join(CONTENT_DIR, 'wallpapers');
const THEMES_FILE = path.join(CONTENT_DIR, 'themes.json');
const WALLPAPERS_FILE = path.join(CONTENT_DIR, 'wallpapers.json');

function readDb() {
  if (!fs.existsSync(DB_FILE)) throw new Error(`БД не найдена: ${DB_FILE}`);
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/** Каталог тем в приведённом виде: только то, что реально правит админ. */
function pickThemes(db) {
  const t = db.builtinThemes || {};
  return {
    overrides: t.overrides || {},
    removed: t.removed || [],
    added: t.added || [],
    updatedAt: t.updatedAt || null,
  };
}

function pickWallpapers(db) {
  const w = db.builtinWallpapers || {};
  return {
    items: w.items || [],
    hidden: w.hidden || [],
    overrides: w.overrides || {},
    updatedAt: w.updatedAt || null,
  };
}

/** Фото-обои лежат файлами; в каталоге остаётся только URL. */
function copyWallpaperFiles(list, fromDir, toDir) {
  // Сначала считаем, какие файлы ДОЛЖНЫ лежать в выгрузке.
  const expected = new Set();
  for (const item of list || []) {
    const url = String(item?.url || '');
    if (url.startsWith('/uploads/wallpapers/')) expected.add(path.basename(url));
  }

  if (!expected.size) {
    // Обоев нет вовсе — выгрузка тоже не должна держать старые файлы.
    if (fs.existsSync(toDir)) fs.rmSync(toDir, { recursive: true, force: true });
    return;
  }
  fs.mkdirSync(toDir, { recursive: true });

  let copied = 0;
  for (const name of expected) {
    const src = path.join(fromDir, 'wallpapers', name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(toDir, name));
    copied++;
  }
  // Удалённые админом обои чистим и из выгрузки: иначе файлы копятся в
  // репозитории вечно, хотя в каталоге их уже нет и восстановить их нельзя.
  let removed = 0;
  for (const name of fs.readdirSync(toDir)) {
    if (expected.has(name)) continue;
    try { fs.rmSync(path.join(toDir, name), { force: true }); removed++; } catch {}
  }
  console.log(`  файлов обоев скопировано: ${copied}`
    + (removed ? `, удалено устаревших: ${removed}` : ''));
}

function backup() {
  const db = readDb();
  fs.mkdirSync(CONTENT_DIR, { recursive: true });

  const themes = pickThemes(db);
  fs.writeFileSync(THEMES_FILE, JSON.stringify(themes, null, 2));
  console.log(`[backup] тем: правок ${Object.keys(themes.overrides).length}, `
    + `удалено ${themes.removed.length}, добавлено ${themes.added.length} → ${THEMES_FILE}`);

  const wallpapers = pickWallpapers(db);
  fs.writeFileSync(WALLPAPERS_FILE, JSON.stringify(wallpapers, null, 2));
  console.log(`[backup] обоев: ${wallpapers.items.length} → ${WALLPAPERS_FILE}`);
  copyWallpaperFiles(wallpapers.items, UPLOADS_DIR, CONTENT_WALLPAPERS);
  console.log('[backup] готово. Папка Server/content/ должна попасть в репозиторий.');
}

function restore() {
  if (!fs.existsSync(THEMES_FILE)) throw new Error(`Нет файла ${THEMES_FILE} — нечего восстанавливать`);
  const db = readDb();

  db.builtinThemes = {
    ...(db.builtinThemes || {}),
    ...JSON.parse(fs.readFileSync(THEMES_FILE, 'utf8')),
  };
  console.log(`[restore] каталог тем восстановлен (${Object.keys(db.builtinThemes.overrides).length} правок)`);

  if (fs.existsSync(WALLPAPERS_FILE)) {
    db.builtinWallpapers = {
      ...(db.builtinWallpapers || {}),
      ...JSON.parse(fs.readFileSync(WALLPAPERS_FILE, 'utf8')),
    };
    console.log(`[restore] каталог обоев восстановлен (${(db.builtinWallpapers.items || []).length} шт.)`);
  }

  // Файлы обоев возвращаем на место — иначе в каталоге остались бы ссылки
  // на несуществующие /uploads/wallpapers/... и обои не показывались бы.
  const items = (db.builtinWallpapers?.items || []);
  const destDir = path.join(UPLOADS_DIR, 'wallpapers');
  if (items.length && fs.existsSync(CONTENT_WALLPAPERS)) {
    fs.mkdirSync(destDir, { recursive: true });
    let copied = 0;
    for (const item of items) {
      const url = String(item?.url || '');
      if (!url.startsWith('/uploads/wallpapers/')) continue;
      const name = path.basename(url);
      const src = path.join(CONTENT_WALLPAPERS, name);
      const dest = path.join(destDir, name);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        copied++;
      }
    }
    console.log(`[restore] файлов обоев возвращено: ${copied}`);
  }

  writeDb(db);
  console.log('[restore] готово. Перезапустите сервер.');
}

/**
 * Режим источника каталога при старте.
 *
 *   'repo' (CONTENT_SOURCE=repo) — каталог берётся из Server/content/ и
 *     перекрывает БД. Это сценарий «правлю на локалхосте → пуш → сервер
 *     обновился»: каждый деплой приводит сервер к состоянию репозитория.
 *     ВАЖНО: правки, сделанные в админке прямо на сервере, будут затёрты
 *     при следующем деплое — авторство ведётся локально, в репозитории.
 *
 *   'db' / 'auto' (по умолчанию) — безопасный режим: каталог из репозитория
 *     поднимается ТОЛЬКО если в БД его нет. Локальные правки сервера остаются
 *     главными. Пуш сам по себе темы на сервере НЕ меняет.
 */
function contentSourceMode() {
  return String(process.env.CONTENT_SOURCE || 'auto').trim().toLowerCase();
}

/**
 * Восстановление каталога при старте сервера.
 *
 * Зачем: на арендованном сервере диск часто эфемерный. Рестарт, редеплой или
 * переезд на другую машину обнуляют vera.json, и все правки тем, сделанные
 * админом, исчезают: пользователи молча возвращаются к заводским темам.
 *
 * Server/content/ лежит в репозитории, поэтому при старте мы возвращаем каталог
 * оттуда. Режим задаётся CONTENT_SOURCE (см. contentSourceMode).
 */
function seedOnBoot() {
  if (!fs.existsSync(DB_FILE)) return false;
  const db = readDb();
  const themesFileExists = fs.existsSync(THEMES_FILE);
  const wallpapersFileExists = fs.existsSync(WALLPAPERS_FILE);
  if (!themesFileExists && !wallpapersFileExists) return false;

  const repoWins = contentSourceMode() === 'repo';
  const hasThemes = db.builtinThemes
    && (Object.keys(db.builtinThemes.overrides || {}).length
      || (db.builtinThemes.added || []).length
      || (db.builtinThemes.removed || []).length);
  const hasWallpapers = db.builtinWallpapers && (db.builtinWallpapers.items || []).length;

  // Без режима 'repo' живой каталог сервера неприкосновенен.
  if (!repoWins && hasThemes && hasWallpapers) return false;

  let changed = false;
  if (themesFileExists && (repoWins || !hasThemes)) {
    const incoming = JSON.parse(fs.readFileSync(THEMES_FILE, 'utf8'));
    db.builtinThemes = { ...(db.builtinThemes || {}), ...incoming };
    console.log(`[content] каталог тем взят из репозитория `
      + `(${Object.keys(db.builtinThemes.overrides || {}).length} правок, `
      + `${(db.builtinThemes.added || []).length} добавленных)`);
    changed = true;
  }
  if (wallpapersFileExists && (repoWins || !hasWallpapers)) {
    const incoming = JSON.parse(fs.readFileSync(WALLPAPERS_FILE, 'utf8'));
    db.builtinWallpapers = { ...(db.builtinWallpapers || {}), ...incoming };
    console.log(`[content] каталог обоев взят из репозитория `
      + `(${(db.builtinWallpapers.items || []).length} шт.)`);
    changed = true;
  }

  if (changed) {
    restoreWallpaperFiles(db);
    writeDb(db);
  }
  return changed;
}

/** Возвращает файлы обоев из content/ в uploads/ (без них ссылки мёртвые). */
function restoreWallpaperFiles(db) {
  const items = (db?.builtinWallpapers?.items || []);
  if (!items.length || !fs.existsSync(CONTENT_WALLPAPERS)) return 0;
  const destDir = path.join(UPLOADS_DIR, 'wallpapers');
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const item of items) {
    const url = String(item?.url || '');
    if (!url.startsWith('/uploads/wallpapers/')) continue;
    const name = path.basename(url);
    const src = path.join(CONTENT_WALLPAPERS, name);
    const dest = path.join(destDir, name);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      copied++;
    }
  }
  return copied;
}

/** Синхронизация выгрузки с БД — вызывается после каждой правки админом. */
function sync() {
  try {
    backup();
  } catch (e) {
    // Не мешаем правке тем из-за сбоя выгрузки, но сообщаем.
    console.warn(`[content] не удалось обновить выгрузку: ${e.message}`);
  }
}

if (require.main === module) {
  try {
    if (process.argv.includes('--restore')) restore();
    else backup();
  } catch (e) {
    console.error(`[error] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { backup, restore, seedOnBoot, restoreWallpaperFiles, sync, pickThemes, pickWallpapers };