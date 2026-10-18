/**
 * Формат своих паков иконок: что можно положить в слот и как пак выглядит в
 * файле. Чистые функции без DOM — их же гоняют тесты, и тот же разбор
 * применяется к импорту файла и к установке пака из каталога сообщества.
 *
 * Слот иконки может быть заменён чем угодно, смысл не проверяется:
 *  - `mui`   — другая иконка из шима (например, «Поиск» нарисован шестерёнкой);
 *  - `text`  — эмодзи или пара символов;
 *  - `image` — растровая картинка (PNG/WebP/JPEG/GIF) data URL'ом. SVG не
 *    принимаем: внутри него может оказаться скрипт.
 */

/** Встроенные паки, которые может взять за основу свой пак. */
export const BASE_PACK_IDS = [
  'filled', 'outlined', 'rounded', 'sharp', 'twoTone',
  'relief', 'puffy', 'sticker', 'neon', 'tile',
] as const;
export type BasePackId = typeof BASE_PACK_IDS[number];

export type CustomIcon =
  | { kind: 'mui'; name: string }
  | { kind: 'text'; text: string }
  /** tint — перекрасить картинку в цвет иконки (по её прозрачности). */
  | { kind: 'image'; src: string; tint?: boolean };

export interface CustomIconPack {
  id: string;
  name: string;
  base: BasePackId;
  icons: Record<string, CustomIcon>;
  updatedAt: number;
}

export const ICON_PACK_FILE_FORMAT = 'vera-icon-pack';
export const ICON_PACK_FILE_VERSION = 1;
/** Сторона картинки слота в пикселях: иконке больше не нужно. */
export const ICON_IMAGE_SIDE = 128;
/** Предел одной картинки (длина data URL). 128×128 PNG с запасом. */
export const MAX_ICON_IMAGE_CHARS = 160_000;
export const MAX_ICON_TEXT = 4;
export const MAX_PACK_NAME = 60;
/** Предел всего пака в символах JSON — совпадает с сервером. */
export const MAX_PACK_CHARS = 4_000_000;

const IMAGE_DATA_URL = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Подпись пользователя: убрать управляющие символы и лишние пробелы. */
function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const out = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PACK_NAME);
  return out || fallback;
}

/**
 * Проверяет один слот. `known` — имена иконок шима: замена «другой иконкой»
 * обязана ссылаться на существующую, иначе слот молча стал бы пустым.
 */
export function sanitizeIcon(raw: unknown, known?: ReadonlySet<string>): CustomIcon | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'mui') {
    const name = typeof r.name === 'string' ? r.name : '';
    if (!/^[A-Za-z0-9]{1,40}$/.test(name)) return null;
    if (known && !known.has(name)) return null;
    return { kind: 'mui', name };
  }
  if (r.kind === 'text') {
    // Считаем графемы, а не UTF-16: эмодзи-семья — это один символ.
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || Array.from(text).length > MAX_ICON_TEXT * 4 || text.length > 32) return null;
    return { kind: 'text', text };
  }
  if (r.kind === 'image') {
    const src = typeof r.src === 'string' ? r.src : '';
    if (src.length > MAX_ICON_IMAGE_CHARS || !IMAGE_DATA_URL.test(src)) return null;
    return r.tint ? { kind: 'image', src, tint: true } : { kind: 'image', src };
  }
  return null;
}

/**
 * Разбирает пак из файла / каталога. Битые слоты отбрасываются по одному —
 * пак из 100 иконок не должен пропадать из-за одной кривой картинки.
 * Возвращает null, только если это вообще не пак.
 */
export function sanitizePack(
  raw: unknown,
  known?: ReadonlySet<string>,
): { name: string; base: BasePackId; icons: Record<string, CustomIcon>; dropped: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const iconsRaw = r.icons;
  if (!iconsRaw || typeof iconsRaw !== 'object' || Array.isArray(iconsRaw)) return null;
  const base = (BASE_PACK_IDS as readonly string[]).includes(r.base as string) ? r.base as BasePackId : 'filled';
  const icons: Record<string, CustomIcon> = {};
  let dropped = 0;
  let size = 0;
  for (const [slot, value] of Object.entries(iconsRaw as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9]{1,40}$/.test(slot) || (known && !known.has(slot))) { dropped++; continue; }
    const icon = sanitizeIcon(value, known);
    if (!icon) { dropped++; continue; }
    size += icon.kind === 'image' ? icon.src.length : 64;
    if (size > MAX_PACK_CHARS) { dropped++; continue; }
    icons[slot] = icon;
  }
  return { name: cleanName(r.name, 'Мой пак'), base, icons, dropped };
}

/** Пак в виде файла для скачивания / публикации. */
export function packToFile(pack: Pick<CustomIconPack, 'name' | 'base' | 'icons'>) {
  return {
    format: ICON_PACK_FILE_FORMAT,
    version: ICON_PACK_FILE_VERSION,
    name: pack.name,
    base: pack.base,
    icons: pack.icons,
  };
}

/** Имя файла без опасных символов (кириллица остаётся). */
export function packFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 60);
  return `${safe || 'icon-pack'}.vera-icons.json`;
}
