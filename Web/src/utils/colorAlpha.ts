/**
 * Прозрачность фона пузырей.
 *
 * Полупрозрачным делаем только фон: цвет (или градиент из цветов) превращаем в
 * тот же цвет с alpha. Так текст, время и кнопки внутри пузыря остаются
 * полностью непрозрачными — в отличие от `opacity` на самом пузыре, который
 * гасит и содержимое.
 *
 * Функции чистые (без React/DOM), поэтому покрыты тестами `colorAlpha.test.cjs`.
 */

export const MIN_ALPHA = 0;
export const MAX_ALPHA = 1;

/** Приводим прозрачность к диапазону 0..1 (по умолчанию — 1, без прозрачности). */
export function clampAlpha(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return MAX_ALPHA;
  return Math.min(MAX_ALPHA, Math.max(MIN_ALPHA, num));
}

function roundAlpha(value: number): number {
  return Math.round(Math.min(MAX_ALPHA, Math.max(MIN_ALPHA, value)) * 1000) / 1000;
}

/** #rgb / #rgba / #rrggbb / #rrggbbaa → rgba() с домноженной прозрачностью. */
export function hexWithAlpha(hex: string, alpha: number): string | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec((hex || '').trim());
  if (!match) return null;
  let body = match[1];
  if (body.length === 3 || body.length === 4) {
    body = body.split('').map((ch) => ch + ch).join('');
  }
  if (body.length !== 6 && body.length !== 8) return null;
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  const base = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${roundAlpha(base * alpha)})`;
}

/** Значение alpha из записи вида `0.4`, `40%` (или 1, если разобрать не удалось). */
function parseAlphaPart(part?: string): number {
  if (!part) return 1;
  const value = part.trim();
  if (value.endsWith('%')) {
    const pct = Number(value.slice(0, -1));
    return Number.isFinite(pct) ? pct / 100 : 1;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : 1;
}

/** rgb()/rgba()/hsl()/hsla() → тот же цвет с домноженной прозрачностью. */
export function functionalWithAlpha(color: string, alpha: number): string | null {
  const match = /^(rgba?|hsla?)\(([^()]*)\)$/i.exec((color || '').trim());
  if (!match) return null;
  const fn = match[1].toLowerCase();
  const parts = match[2].split(/[,\s/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [first, second, third, alphaPart] = parts;
  const base = parts.length === 4 ? parseAlphaPart(alphaPart) : 1;
  const next = roundAlpha(base * alpha);
  return fn.startsWith('hsl')
    ? `hsla(${first}, ${second}, ${third}, ${next})`
    : `rgba(${first}, ${second}, ${third}, ${next})`;
}

// Цвета внутри градиента: hex или rgb()/rgba()/hsl()/hsla().
// Одна замена за проход, чтобы уже подменённые rgba() не обрабатывались повторно.
const GRADIENT_COLOR_RE = /#([0-9a-f]{3,8})\b|(rgba?|hsla?)\(([^()]*)\)/gi;

/**
 * Фон пузыря с нужной прозрачностью: подходит и для сплошного цвета, и для
 * градиента (`linear-gradient(135deg, #7c6af7, #4a3f9f)`) — в градиенте
 * прозрачность домножается у каждого цвета, позиции и `transparent` не трогаем.
 * Незнакомые форматы (`var()`, именованные цвета, url()) возвращаются как есть.
 */
export function withAlpha(color: string, alpha: number): string {
  const value = typeof color === 'string' ? color.trim() : '';
  if (!value) return color;
  const a = clampAlpha(alpha);
  if (a >= MAX_ALPHA) return value;

  const hex = hexWithAlpha(value, a);
  if (hex) return hex;
  const functional = functionalWithAlpha(value, a);
  if (functional) return functional;

  if (/gradient\(/i.test(value)) {
    return value.replace(GRADIENT_COLOR_RE, (match) => (
      hexWithAlpha(match, a) ?? functionalWithAlpha(match, a) ?? match
    ));
  }
  return value;
}
