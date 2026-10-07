/**
 * Фон пузыря: градиент, если он задан, иначе сплошной цвет.
 *
 * Заведено отдельной функцией, потому что одно и то же правило нужно в трёх
 * местах — при отрисовке сообщений, в превью редактора темы и в витрине тем.
 * Собранный вручную в каждом месте `gradient || color` рано или поздно
 * разъезжается: в одном месте про чужой пузырь забывают, и он выходит
 * сплошным, хотя галочка включена.
 *
 * Функции чистые (без React и DOM), поэтому покрыты тестами
 * `bubbleGradient.test.cjs`.
 */

/** Задан ли градиент — по нему же определяется положение галочки в редакторе. */
export function bubbleBackground(color: string, gradient?: string): string {
  const g = (gradient || '').trim();
  return g || color;
}

// ── Градиент из одного цвета ────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(([^()]*)\)$/i;

interface Rgb { r: number; g: number; b: number; a?: number }

/** #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba() → каналы; иначе null. */
function parseColor(color: string): Rgb | null {
  const value = (color || '').trim();

  const hex = HEX_RE.exec(value);
  if (hex) {
    let body = hex[1];
    if (body.length === 3 || body.length === 4) {
      body = body.split('').map((ch) => ch + ch).join('');
    }
    if (body.length !== 6 && body.length !== 8) return null;
    const alpha = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : undefined;
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
      a: alpha,
    };
  }

  const fn = RGB_RE.exec(value);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b] = parts.slice(0, 3).map(Number);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    const alpha = parts.length === 4 ? Number(parts[3]) : undefined;
    return { r, g, b, a: Number.isFinite(alpha) ? alpha : undefined };
  }

  return null;
}

/** Сколько канала отдать белому (amount > 0) или чёрному (amount < 0). */
function shift(channel: number, amount: number): number {
  const target = amount > 0 ? 255 : 0;
  return Math.round(channel + (target - channel) * Math.abs(amount));
}

function rgba({ r, g, b, a }: Rgb): string {
  if (a === undefined) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * Градиент из одного цвета — чтобы галочка «градиент» сразу давала результат,
 * не заставляя вписывать CSS руками.
 *
 * Светлее к началу и темнее к концу, угол тот же, что у градиентов в
 * заводских темах. Альфа-канал сохраняется: у полупрозрачного цвета
 * (#7DFFB255, rgba(255,255,255,0.07)) осветлённый край обязан остаться
 * полупрозрачным, иначе пузырь получает заметную светлую кайму.
 *
 * Цвета, которые разобрать не удалось (hsl(), именованные, `transparent`,
 * `var()`, `url()`), возвращаются как есть: подставить их в градиент вместо
 * выдуманного значения значит сломать фон пузыря.
 */
export function autoBubbleGradient(color: string, angle = 135): string {
  const value = (color || '').trim();
  const parsed = parseColor(value);
  if (!parsed) return value;

  const { r, g, b } = parsed;
  const light = rgba({ ...parsed, r: shift(r, 0.22), g: shift(g, 0.22), b: shift(b, 0.22) });
  const dark = rgba({ ...parsed, r: shift(r, -0.28), g: shift(g, -0.28), b: shift(b, -0.28) });
  return `linear-gradient(${angle}deg, ${light} 0%, ${rgba(parsed)} 55%, ${dark} 100%)`;
}

/**
 * Пересобрать градиент под новый базовый цвет — но только если он был
 * сгенерирован нами, а не вписан руками. Иначе смена цвета молча затирала бы
 * чужой CSS. Сравнение с результатом для ПРЕЖНЕГО цвета и есть признак
 * «градиент наш».
 */
export function regenerateAutoGradient(
  nextColor: string,
  currentColor: string,
  currentGradient: string,
  angle = 135,
): string {
  const current = (currentGradient || '').trim();
  if (!current) return current;
  return current === autoBubbleGradient(currentColor, angle) ? autoBubbleGradient(nextColor, angle) : currentGradient;
}