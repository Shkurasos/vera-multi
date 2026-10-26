/**
 * Обои промежутков: фото видно только в зазоре между окном чата и остальными
 * панелями (внешний отступ окна чата, layout.chatOuterMargin).
 *
 * Фото не кладётся целиком под интерфейс: рисуются четыре тонкие полосы по
 * периметру окна чата, и браузер растеризует только их площадь. Чтобы полосы
 * складывались в одну картинку, у всех общий фон, привязанный к окну
 * (background-attachment: fixed).
 *
 * Модуль чистый (без React и сторов) — его грузят тесты в голом vm.
 */

/** Скоуп своих фото для промежутков (ключи IndexedDB `gaps:<id>`). */
export const GAP_SCOPE = 'gaps';

/** Длинная сторона фото после сжатия: больше для полос в пару px не нужно. */
export const GAP_PHOTO_MAX_SIDE = 1600;

/** Пределы затемнения фото в промежутках. */
export const GAP_DIM_LIMITS = { min: 0, max: 0.8, default: 0.25 };

/** Есть ли вообще промежуток, в котором можно показать фото. */
export function hasLayoutGap(margin: unknown): boolean {
  const n = Number(margin);
  return Number.isFinite(n) && n >= 1;
}

export function clampGapDim(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return GAP_DIM_LIMITS.default;
  return Math.max(GAP_DIM_LIMITS.min, Math.min(GAP_DIM_LIMITS.max, n));
}

export interface GapStrip {
  key: 'top' | 'bottom' | 'left' | 'right';
  style: { top?: number; bottom?: number; left?: number; right?: number; width?: number; height?: number };
}

/**
 * Четыре полосы рамки толщиной `margin`. Боковые не заходят на углы — углы
 * уже закрыты верхней и нижней, и ни один пиксель не рисуется дважды.
 */
export function gapStrips(margin: number): GapStrip[] {
  const m = Math.max(0, Math.round(Number(margin) || 0));
  if (!m) return [];
  return [
    { key: 'top', style: { top: 0, left: 0, right: 0, height: m } },
    { key: 'bottom', style: { bottom: 0, left: 0, right: 0, height: m } },
    { key: 'left', style: { top: m, bottom: m, left: 0, width: m } },
    { key: 'right', style: { top: m, bottom: m, right: 0, width: m } },
  ];
}

/** Фон одной полосы: затемнение и фото, оба привязаны к окну. */
export function gapBackground(url: string, dim: number): string {
  const d = clampGapDim(dim);
  const safe = String(url).replace(/["\\\n\r]/g, '');
  const shade = `linear-gradient(rgba(0,0,0,${d}), rgba(0,0,0,${d}))`;
  return d > 0 ? `${shade}, url("${safe}")` : `url("${safe}")`;
}

/** Размер после вписывания в квадрат max×max (не увеличиваем). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
