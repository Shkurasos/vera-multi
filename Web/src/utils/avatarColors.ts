/**
 * Цвета аватарок без фото (кружок с инициалами).
 *
 * Раньше все такие аватарки заливались акцентом темы и сливались в один ряд
 * синих кружков. Теперь цвет берётся из палитры по стабильному ключу (id
 * пользователя или чата): один и тот же человек выглядит одинаково в списке
 * чатов, шапке, сообщениях и профиле.
 *
 * Функции чистые (без React/DOM), поэтому покрыты тестами `avatarColors.test.cjs`.
 */
import { readableTextOn } from './contrast';

/**
 * accent  — как раньше, один цвет акцента;
 * theme   — оттенки вокруг акцента темы (меняются вместе с темой);
 * rainbow — фиксированный набор ярких цветов, как в Telegram;
 * custom  — свои цвета пользователя.
 */
export type AvatarPaletteMode = 'accent' | 'theme' | 'rainbow' | 'custom';

export const AVATAR_PALETTE_MODES: { id: AvatarPaletteMode; label: string; desc: string }[] = [
  { id: 'theme', label: 'Под тему', desc: 'Оттенки вокруг акцента темы, меняются вместе с темой' },
  { id: 'rainbow', label: 'Радуга', desc: 'Яркие разные цвета, как в Telegram' },
  { id: 'custom', label: 'Свои', desc: 'Набор цветов, который вы задаёте сами' },
  { id: 'accent', label: 'Акцент', desc: 'Все аватарки одного цвета акцента, как раньше' },
];

export const DEFAULT_AVATAR_PALETTE: AvatarPaletteMode = 'theme';
export const MAX_CUSTOM_AVATAR_COLORS = 12;

export const RAINBOW_AVATAR_COLORS: readonly string[] = [
  '#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae',
];

/** Сдвиги оттенка для палитры «Под тему»: аналоговая гамма вокруг акцента. */
const THEME_HUE_OFFSETS = [0, 32, -32, 64, -64, 96, -96, 150];
/** Небольшой разброс светлоты, чтобы соседние оттенки различались лучше. */
const THEME_LIGHT_OFFSETS = [0, 0.04, -0.04, 0.02, -0.02, 0.05, -0.05, 0];

export function isAvatarPaletteMode(v: unknown): v is AvatarPaletteMode {
  return v === 'accent' || v === 'theme' || v === 'rainbow' || v === 'custom';
}

/** #rgb / #rrggbb / #rrggbbaa → '#rrggbb' в нижнем регистре, иначе null. */
export function normalizeHexColor(color: unknown): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(typeof color === 'string' ? color.trim() : '');
  if (!match) return null;
  let body = match[1].toLowerCase();
  if (body.length === 3) body = body.split('').map((ch) => ch + ch).join('');
  return '#' + body.slice(0, 6);
}

/** Свои цвета: только валидные hex, без повторов, не больше MAX_CUSTOM_AVATAR_COLORS. */
export function sanitizeAvatarColors(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const hex = normalizeHexColor(item);
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length >= MAX_CUSTOM_AVATAR_COLORS) break;
  }
  return out;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function hexToHsl(hex: string): [number, number, number] | null {
  const norm = normalizeHexColor(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round(clamp(v + m, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Цвет светлее/темнее на amount (доля светлоты, −1..1). Невалидный цвет — как есть. */
export function shiftLightness(color: string, amount: number): string {
  const hsl = hexToHsl(color);
  if (!hsl) return color;
  return hslToHex(hsl[0], hsl[1], clamp(hsl[2] + amount, 0, 1));
}

/**
 * Палитра «Под тему»: тот же характер цвета, что у акцента, но разные оттенки.
 * Насыщенность и светлота зажаты в читаемый диапазон: у почти белого или
 * серого акцента иначе получились бы одинаковые бледные кружки.
 */
export function themeAvatarPalette(accent: string): string[] {
  const hsl = hexToHsl(accent);
  if (!hsl) return [...RAINBOW_AVATAR_COLORS];
  const [h, s0, l0] = hsl;
  const s = clamp(s0, 0.38, 0.72);
  const l = clamp(l0, 0.46, 0.6);
  return THEME_HUE_OFFSETS.map((off, i) => hslToHex(h + off, s, clamp(l + THEME_LIGHT_OFFSETS[i], 0.38, 0.68)));
}

/** Итоговая палитра для режима. Пустые «Свои» откатываются на «Под тему». */
export function avatarPalette(mode: AvatarPaletteMode, accent: string, custom?: readonly string[]): string[] {
  if (mode === 'accent') return [normalizeHexColor(accent) || accent];
  if (mode === 'rainbow') return [...RAINBOW_AVATAR_COLORS];
  if (mode === 'custom') {
    const own = sanitizeAvatarColors(custom);
    if (own.length) return own;
  }
  return themeAvatarPalette(accent);
}

/** Стабильный хеш строки (FNV-1a, 32 бита). */
export function hashAvatarKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Цвет аватарки по ключу: один ключ — всегда один цвет в одной палитре. */
export function avatarColorFor(key: string | null | undefined, palette: readonly string[]): string {
  if (!palette.length) return '#888888';
  if (!key) return palette[0];
  return palette[hashAvatarKey(String(key)) % palette.length];
}

export interface AvatarFill {
  bgcolor: string;
  backgroundImage?: string;
  color: string;
}

/** Заливка кружка и читаемый цвет инициалов. gradient — мягкий перелив сверху вниз. */
export function avatarFill(color: string, gradient: boolean): AvatarFill {
  const fill: AvatarFill = { bgcolor: color, color: readableTextOn(color) };
  if (gradient) {
    fill.backgroundImage = `linear-gradient(160deg, ${shiftLightness(color, 0.1)} 0%, ${color} 55%, ${shiftLightness(color, -0.08)} 100%)`;
  }
  return fill;
}

