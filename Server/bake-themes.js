/**
 * ВПЕКАНИЕ ПРАВОК АДМИНА В ИСХОДНИК СТОКОВЫХ ТЕМ
 * =============================================
 *
 * Проблема. Правки тем живут в БД и зеркалятся в Server/content. Но это
 * по-прежнему «данные», а не исходник: при переезде, смене сервера или
 * сбросе диска их приходится поднимать заново. Хочется один раз настроить
 * темы и получить их СТОКОВЫМИ — в самом коде.
 *
 * Решение. Скрипт берёт каталог правок (overrides / removed / added) и
 * вносит их прямо в массив THEMES в Web/src/store/themeStore.ts:
 *   - overrides — значения подставляются в существующие объекты тем;
 *   - added     — дописываются новыми объектами в конец массива;
 *   - removed   — соответствующие темы удаляются из массива.
 *
 * Что это даёт: после сборки и деплоя темы уже стоковые. Ничего поднимать
 * из БД не нужно, и Server/content как костыль тоже не нужен.
 *
 * ─── Важно ────────────────────────────────────────────────────────────────
 *
 * Скрипт переписывает ИСХОДНЫЙ КОД, поэтому:
 *   - запускать его осознанно, а не в автосборке;
 *   - результат посмотреть в git diff перед коммитом;
 *   - есть `--dry-run` для предпросмотра без записи.
 *
 * Правит он только строки `ключ: значение` внутри объектов тем: комментарии,
 * хелперы паттернов (stars(), dots() и прочие) и остальные поля не трогаются.
 *
 * ─── Команды ──────────────────────────────────────────────────────────────
 *
 *   node bake-themes.js --dry-run   показать, что изменится
 *   node bake-themes.js             внести правки в themeStore.ts
 *   node bake-themes.js --db        взять каталог из БД, а не из content/
 */
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'vera.json');
const CONTENT_FILE = process.env.CONTENT_FILE
  || path.join(process.env.CONTENT_DIR || path.join(__dirname, 'content'), 'themes.json');
const THEME_STORE = process.env.THEME_STORE_FILE
  || path.join(__dirname, '..', 'Web', 'src', 'store', 'themeStore.ts');

/** Какие поля темы переносим в исходник (всё, что читает рендер). */
const STRING_KEYS = [
  'bg', 'text', 'accent', 'bgSidebar', 'bgChat', 'bgHeader', 'bgInput',
  'bgBubbleOwn', 'bgBubbleOther', 'bgHover', 'bgActive', 'textSec', 'border',
  'online', 'chatPattern', 'backgroundGlowColor', 'finish', 'bubbleOwnGradient',
  'bubbleOtherGradient', 'bubbleOwnShadow', 'bubbleOtherShadow', 'sidebarGradient',
  'sidebarBlur', 'headerGradient', 'bubbleOwnText', 'bubbleOtherText',
  'messageTimeColor', 'chatTimeColor', 'chatBgImage',
];
const NUMBER_KEYS = [
  'chatPatternSizeMin', 'chatPatternSizeMax', 'backgroundGlowIntensity',
  'finishAmount', 'bubbleOwnOpacity', 'bubbleOtherOpacity', 'chatBgImageOpacity',
];
const BOOL_KEYS = ['disableBackgroundBlobs', 'disableBackgroundGlow'];

// ─── Разбор исходника ───────────────────────────────────────────────────────

/**
 * Границы массива THEMES: от `[` до парной `]`.
 *
 * Считаем вложенность, пропуская строки, шаблонные литералы и комментарии —
 * иначе скобки внутри градиентов или в тексте комментария сбили бы счёт.
 */
function findThemesArray(src) {
  const anchor = src.indexOf('export const THEMES');
  if (anchor < 0) throw new Error('В themeStore.ts не найден массив THEMES');
  // Важно: ищем именно СКОБКУ МАССИВА, а не первое `[`. В сигнатуре
  // `export const THEMES: Theme[] = [` стоит аннотация типа `Theme[]`, и
  // первый же `[` оказывается с парой `]` — обход замыкался за символ, и
  // скрипт «не видел» ни одной темы (все правки считались отсутствующими).
  let open = -1;
  for (let i = anchor + 1; i < src.length; i++) {
    if (src[i] !== '[') continue;
    if (src[i + 1] === ']') { i++; continue; } // пропускаем пустую аннотацию типа
    open = i;
    break;
  }
  if (open < 0) throw new Error('Не найдено начало массива THEMES');
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i); i = end < 0 ? src.length : end + 1; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return { start: open, end: i };
    }
  }
  throw new Error('Не найдено закрытие массива THEMES');
}

/**
 * Объекты тем верхнего уровня: их границы и id.
 *
 * Возвращает список в порядке следования, чтобы можно было править исходник
 * с конца к началу и не сбивать индексы предыдущими вставками.
 */
function parseThemeObjects(src) {
  const { start, end } = findThemesArray(src);
  const body = src.slice(start + 1, end);
  const out = [];
  let depth = 0;
  let quote = null;
  let objStart = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && body[i + 1] === '/') { const nl = body.indexOf('\n', i); i = nl < 0 ? body.length : nl; continue; }
    if (ch === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i); i = e < 0 ? body.length : e + 1; continue; }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const text = body.slice(objStart, i + 1);
        const idMatch = /(?:^|[\s{,])id:\s*(\d+)/.exec(text);
        out.push({
          id: idMatch ? Number(idMatch[1]) : null,
          // Абсолютные позиции в исходном файле.
          absStart: start + 1 + objStart,
          absEnd: start + 1 + i + 1,
          text,
        });
        objStart = -1;
      }
    }
  }
  return out;
}

// ─── Правка объектов ────────────────────────────────────────────────────────

/** Значение темы → текст на языке TypeScript. */
function serializeValue(value) {
  if (typeof value === 'string') {
    // В исходнике приняты одинарные кавычки; экранируем и их, и бэкслеши.
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'undefined';
  if (typeof value === 'boolean') return String(value);
  // Объекты (например settings) — как JSON: TS такой литерал принимает.
  return JSON.stringify(value);
}

/** Ключи темы, которые имеет смысл переносить в исходник. */
function themeKeys(patch) {
  return Object.keys(patch).filter((k) => (
    k !== 'id' && k !== 'name'
    && (STRING_KEYS.includes(k) || NUMBER_KEYS.includes(k) || BOOL_KEYS.includes(k))
  ));
}

/**
 * Границы значения поля внутри объекта темы.
 *
 * Ищем `ключ:` как отдельный токен, затем значение до запятой НУЛЕВОГО уровня
 * или до закрывающей скобки. Простой поиск по строкам тут не годится: в темах
 * на одной строке умещается по нескольку полей
 * (`bg: '...', text: '...', accent: '...',`), и поля со второй позиции
 * считались бы отсутствующими — скрипт дописал бы дубли ключей.
 */
function findKeyRange(objText, key) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < objText.length; i++) {
    const ch = objText[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue; }
    if (depth !== 1) continue;

    // Начало поля: ключ должен идти как отдельное слово.
    const rest = objText.slice(i);
    const m = new RegExp(`^${key}\\s*:`).exec(rest);
    if (!m) continue;
    const prev = objText[i - 1];
    if (prev && /[\w$]/.test(prev)) continue; // это хвост другого идентификатора

    // Значение — до запятой нулевого уровня или до конца объекта.
    let j = i + m[0].length;
    let q = null;
    let d = 0;
    for (; j < objText.length; j++) {
      const c = objText[j];
      if (q) {
        if (c === '\\') { j++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '{' || c === '[' || c === '(') { d++; continue; }
      if (c === '}' || c === ']' || c === ')') {
        if (d === 0) break;
        d--;
        continue;
      }
      if (c === ',' && d === 0) break;
    }
    const valueStart = i + m[0].length;
    const raw = objText.slice(valueStart, j).trim();
    return { keyStart: i, valueStart, valueEnd: j, raw };
  }
  return null;
}

/**
 * Подставляет значения патча в текст объекта темы.
 *
 * Существующие поля правятся на месте (комментарии и порядок сохраняются),
 * недостающие дописываются перед закрывающей скобкой.
 */
function applyPatchToObject(objText, patch) {
  let out = objText;
  const inserts = [];

  for (const key of themeKeys(patch)) {
    const value = patch[key];
    const found = findKeyRange(out, key);

    if (value === undefined) {
      // Явный undefined в патче означает «поле не задано»: при отрисовке
      // {...factory, ...patch} затирает заводское значение, поэтому и в
      // исходнике ключ надо убрать, а не оставить прежним.
      if (found) {
        let end = found.valueEnd;
        if (out[end] === ',') end++; // убираем и запятую
        out = out.slice(0, found.keyStart) + out.slice(end);
      }
      continue;
    }

    const serialized = serializeValue(value);
    if (found) {
      if (found.raw === serialized) continue; // уже так — не трогаем
      out = out.slice(0, found.valueStart) + ` ${serialized}` + out.slice(found.valueEnd);
      continue;
    }
    inserts.push({ key, serialized });
  }

  if (!inserts.length) return out;

  // Отступ берём у существующего поля, чтобы вставка не выбивалась.
  const idFound = findKeyRange(out, 'id');
  const lineStart = out.lastIndexOf('\n', idFound ? idFound.keyStart : 0) + 1;
  const fieldIndent = (/^[ \t]*/.exec(out.slice(lineStart)) || ['  '])[0] || '  ';

  const closeAt = out.lastIndexOf('}');
  let head = out.slice(0, closeAt).replace(/\s*$/, '');
  if (head.trim() && !/,$/.test(head)) head += ',';
  const added = inserts.map(({ key, serialized }) => `${fieldIndent}${key}: ${serialized},`).join('\n');
  return `${head}\n${added}\n${out.slice(closeAt)}`;
}

// ─── Сборка нового исходника ────────────────────────────────────────────────

/** Объект темы из данных каталога — для добавленных админом тем. */
function buildThemeObject(theme, indent = '  ') {
  const lines = [`${indent}{`];
  lines.push(`${indent}  id: ${Number(theme.id)}, name: ${serializeValue(String(theme.name || `Тема ${theme.id}`))},`);
  for (const key of themeKeys(theme)) {
    const value = theme[key];
    if (value === undefined) continue;
    lines.push(`${indent}  ${key}: ${serializeValue(value)},`);
  }
  lines.push(`${indent}},`);
  return lines.join('\n');
}

/**
 * Вносит каталог правок в исходник themeStore.ts.
 *
 * Правки применяются от КОНЦА файла к началу: иначе после первой вставки или
 * удаления поехали бы все ранее вычисленные позиции следующих объектов.
 *
 * Возвращает { source, stats } — новый текст и сводку по изменениям.
 */
function bakeThemes(source, catalog) {
  const objects = parseThemeObjects(source);
  const byId = new Map(objects.filter((o) => o.id !== null).map((o) => [o.id, o]));
  const overrides = catalog?.overrides && typeof catalog.overrides === 'object' ? catalog.overrides : {};
  const removed = new Set((Array.isArray(catalog?.removed) ? catalog.removed : []).map(Number));
  const added = Array.isArray(catalog?.added) ? catalog.added.filter(Boolean) : [];

  const edits = [];
  const stats = { patched: [], added: [], removed: [], missing: [] };

  for (const [key, patch] of Object.entries(overrides)) {
    const id = Number(key);
    const obj = byId.get(id);
    if (!obj || !patch || typeof patch !== 'object') { stats.missing.push(id); continue; }
    const next = applyPatchToObject(obj.text, patch);
    if (next !== obj.text) {
      edits.push({ start: obj.absStart, end: obj.absEnd, text: next });
      stats.patched.push(id);
    }
  }

  for (const id of removed) {
    const obj = byId.get(id);
    if (!obj) { stats.missing.push(id); continue; }
    // Захватываем и запятую после объекта, и комментарий-заголовок перед ним:
    // иначе в массиве остались бы висеть пустые строки и мусорные запятые.
    let end = obj.absEnd;
    let i = end;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === ',') end = i + 1;
    let start = obj.absStart;
    const before = source.slice(0, start);
    const commentMatch = /(?:^|\n)([ \t]*\/\/[^\n]*)\n[ \t]*$/.exec(before);
    if (commentMatch) start = before.length - commentMatch[0].length + (commentMatch[0][0] === '\n' ? 1 : 0);
    // Подчищаем оставшуюся пустую строку.
    if (source[start - 1] === '\n' && source[start - 2] === '\n') start -= 1;
    edits.push({ start, end, text: '' });
    stats.removed.push(id);
  }

  if (added.length) {
    const bounds = findThemesArray(source);
    // Перед закрывающей скобкой массива, последним элементом.
    let at = bounds.end;
    let i = at - 1;
    while (i > bounds.start && /\s/.test(source[i])) i--;
    const needsComma = source[i] !== ',';
    const block = added.map((t) => buildThemeObject(t)).join('\n');
    edits.push({ start: at, end: at, text: `${needsComma ? ',' : ''}\n${block}`, beforeClose: true });
    stats.added = added.map((t) => t.id);
  }

  let out = source;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { source: out, stats };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function readCatalog(useDb) {
  if (useDb) {
    if (!fs.existsSync(DB_FILE)) throw new Error(`БД не найдена: ${DB_FILE}`);
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return db.builtinThemes || { overrides: {}, removed: [], added: [] };
  }
  if (!fs.existsSync(CONTENT_FILE)) {
    throw new Error(`Нет файла ${CONTENT_FILE}. Сначала выгрузите каталог: node backup-content.js`);
  }
  return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
}

if (require.main === module) {
  try {
    const dryRun = process.argv.includes('--dry-run');
    const catalog = readCatalog(process.argv.includes('--db'));
    const source = fs.readFileSync(THEME_STORE, 'utf8');
    const { source: out, stats } = bakeThemes(source, catalog);

    console.log(`[bake] правок применено: ${stats.patched.length}${stats.patched.length ? ` (id: ${stats.patched.join(', ')})` : ''}`);
    console.log(`[bake] тем добавлено: ${stats.added.length}${stats.added.length ? ` (id: ${stats.added.join(', ')})` : ''}`);
    console.log(`[bake] тем удалено: ${stats.removed.length}${stats.removed.length ? ` (id: ${stats.removed.join(', ')})` : ''}`);
    if (stats.missing.length) {
      console.warn(`[bake] пропущено (нет такой темы в исходнике): ${stats.missing.join(', ')}`);
    }

    if (out === source) {
      console.log('[bake] исходник уже содержит эти правки — менять нечего');
    } else if (dryRun) {
      console.log('[bake] --dry-run: файл не изменён. Изменилось бы столько строк:');
      const a = source.split('\n').length;
      const b = out.split('\n').length;
      console.log(`       строк было ${a}, стало ${b}`);
    } else {
      fs.writeFileSync(THEME_STORE, out);
      console.log(`[bake] записано: ${THEME_STORE}`);
      console.log('[bake] проверьте git diff, затем соберите клиент: npm run build (в Web/)');
    }
  } catch (e) {
    console.error(`[error] ${e.message}`);
    process.exit(1);
  }
}

module.exports = {
  // Основное действие и CLI.
  bakeThemes, buildThemeObject, readCatalog,
  // Внутренности — нужны тестам: правку исходника проще проверять напрямую.
  findThemesArray, parseThemeObjects, applyPatchToObject,
  findKeyRange, serializeValue, themeKeys,
  CONTENT_FILE, THEME_STORE,
};