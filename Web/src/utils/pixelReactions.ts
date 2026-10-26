/**
 * Пиксель-арт для пака реакций «Пиксели»: каждая из 10 форм растеризуется в
 * сетку 32×32 (1 клетка = 1 единица viewBox 0 0 32 32) с контуром в 1 пиксель,
 * бликом сверху-слева, тенью снизу-справа и ступенчатой заливкой — как спрайт
 * из 16-битной игры. Модуль без импортов: тесты грузят его через vm.
 */
export const PIXEL_GRID = 32;

export interface PixelColors { from: string; to: string; outline: string; detail: string; accent: string; }
/** Горизонтальная полоска одноцветных пикселей: x, y — клетка, w — длина. */
export interface PixelRun { x: number; y: number; w: number; fill: string; }

type Pt = [number, number];
/** Маска проверяется в центре клетки: (i + 0.5, j + 0.5). */
type Mask = (x: number, y: number) => boolean;
type Tone = 'detail' | 'accent' | 'outline' | 'white' | 'tongue' | 'sky' | 'mint' | 'from';

interface Sprite {
  body: Mask;
  /** Рисуются только по телу, поверх заливки. */
  layers?: [Mask, Tone][];
  /** Рисуются после контура и могут выходить за тело (слёзы, конфетти). */
  over?: [Mask, Tone][];
}

const inPoly = (pts: Pt[]): Mask => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const disk = (cx: number, cy: number, r: number): Mask => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
/** Клетки x0..x1-1 × y0..y1-1. */
const cells = (x0: number, y0: number, x1: number, y1: number): Mask => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const any = (...masks: Mask[]): Mask => (x, y) => masks.some(m => m(x, y));
const and = (a: Mask, b: Mask): Mask => (x, y) => a(x, y) && b(x, y);
/** Зеркало по вертикальной оси: клетка i ↔ 31 - i. */
const mirrorX = (m: Mask): Mask => (x, y) => m(PIXEL_GRID - x, y);
const both = (m: Mask): Mask => any(m, mirrorX(m));
const rotate180 = (m: Mask): Mask => (x, y) => m(PIXEL_GRID - x, PIXEL_GRID - y);

// ── Лицо и его детали ──
const FACE = disk(16, 16, 13.6);
const EYES = any(cells(10, 11, 12, 14), cells(20, 11, 22, 14));
const EYE_GLINT = any(cells(10, 11, 11, 12), cells(20, 11, 21, 12));
const FROWN: Mask = (x, y) => { const d = Math.hypot(x - 16, y - 28.5); return d >= 5.6 && d < 7.2 && y < 25; };
const tear = (cx: number, top: number): Mask => (x, y) =>
  Math.hypot(x - cx, y - (top + 4)) <= 1.8 || (y >= top && y < top + 4 && Math.abs(x - cx) <= (y - top) * 0.5);
const LAUGH_MOUTH: Mask = (x, y) => y >= 17 && Math.hypot(x - 16, y - 17) <= 8.2;

// ── Палец вверх (дизлайк — он же, повёрнутый на 180°) ──
const THUMB: Sprite = {
  body: any(
    cells(4, 14, 9, 28),
    inPoly([[11, 14], [16, 5], [18, 4.5], [20, 6], [20, 12], [26.5, 12], [29.2, 14], [29.4, 15.6], [27.4, 24.6], [24.4, 28], [11, 28]]),
  ),
  layers: [
    [(x, y) => x >= 20 && x < 28 && [17, 21, 25].includes(Math.floor(y)), 'outline'],
    [cells(6, 24, 7, 26), 'white'],
  ],
};

const SPRITES: Record<string, Sprite> = {
  like: THUMB,
  dislike: {
    body: rotate180(THUMB.body),
    layers: THUMB.layers?.map(([m, t]) => [rotate180(m), t] as [Mask, Tone]),
  },
  heart: {
    body: (x, y) => {
      const X = (x - 16) / 12.2;
      const Y = (17 - y) / 12.2;
      const a = X * X + Y * Y - 1;
      return a * a * a - X * X * Y * Y * Y <= 0;
    },
    layers: [[any(cells(7, 8, 9, 11), cells(9, 7, 11, 8)), 'white']],
  },
  star: {
    body: inPoly([[16, 3], [19.8, 11.6], [29, 12.4], [22, 18.6], [24.2, 27.8], [16, 23], [7.8, 27.8], [10, 18.6], [3, 12.4], [12.2, 11.6]]),
    layers: [[any(cells(14, 9, 16, 11), cells(15, 8, 16, 9)), 'white']],
  },
  fire: {
    body: inPoly([[16, 2.5], [18, 6], [22, 10], [24.5, 15], [24.5, 19], [23.5, 23], [21, 26.5], [16, 27.8], [11, 26.5], [8.5, 23], [7.5, 19], [8.5, 14], [11.7, 9.6], [13, 13], [14.9, 14.6], [14.5, 9]]),
    layers: [
      [inPoly([[16, 15.5], [19.2, 19.5], [20.4, 23.5], [18.8, 26.2], [16, 26.8], [13.2, 26.2], [11.6, 23.5], [12.8, 19.5]]), 'accent'],
      [cells(15, 22, 17, 25), 'white'],
    ],
  },
  party: {
    body: inPoly([[4, 28.5], [10.5, 11], [21.5, 22]]),
    layers: [[(x, y) => Math.floor((x - y + 64) / 3) % 2 === 0, 'accent']],
    over: [
      [cells(21, 4, 23, 6), 'accent'],
      [cells(26, 12, 28, 14), 'sky'],
      [cells(15, 2, 17, 4), 'mint'],
      [cells(25, 20, 27, 22), 'accent'],
      [cells(28, 6, 29, 7), 'from'],
      // Серпантин лесенкой от раструба к углу.
      [any(cells(18, 13, 20, 14), cells(20, 12, 22, 13), cells(22, 11, 23, 12), cells(23, 10, 25, 11), cells(25, 9, 26, 10)), 'mint'],
    ],
  },
  laugh: {
    body: FACE,
    layers: [
      [(x, y) => { const cx = x < 16 ? 11 : 21; const d = Math.hypot(x - cx, y - 14); return d >= 2.2 && d < 3.6 && y < 13.5; }, 'detail'],
      [LAUGH_MOUTH, 'detail'],
      [and(LAUGH_MOUTH, (x, y) => y < 19 && Math.abs(x - 16) < 6.5), 'white'],
      [and(LAUGH_MOUTH, disk(16, 25, 3.6)), 'tongue'],
    ],
    over: [[both(tear(4.5, 15)), 'accent']],
  },
  wow: {
    body: FACE,
    layers: [
      [EYES, 'detail'], [EYE_GLINT, 'white'],
      [(x, y) => ((x - 16) / 3.2) ** 2 + ((y - 21.5) / 4.2) ** 2 <= 1, 'detail'],
    ],
  },
  sad: {
    body: FACE,
    layers: [[EYES, 'detail'], [EYE_GLINT, 'white'], [FROWN, 'detail'], [tear(9, 15), 'accent']],
  },
  angry: {
    body: FACE,
    layers: [
      [any(cells(10, 14, 12, 16), cells(20, 14, 22, 16)), 'detail'],
      [both((x, y) => { if (x < 7 || x > 14) return false; const ly = 9.5 + (x - 7) * 0.5; return y >= ly && y < ly + 1.6; }), 'detail'],
      [FROWN, 'detail'],
    ],
  },
};

export const PIXEL_REACTION_KEYS = Object.keys(SPRITES);

// ── Цвета ──
const parseHex = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Смесь двух #rrggbb; не-hex цвет (rgba/var) возвращаем как есть. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Растр спрайта: null — прозрачная клетка. Индексация grid[y][x]. */
export function pixelGrid(key: string, c: PixelColors): (string | null)[][] | null {
  const sprite = SPRITES[key];
  if (!sprite) return null;
  const N = PIXEL_GRID;
  const at = (m: Mask, x: number, y: number) => m(x + 0.5, y + 0.5);
  const body: boolean[][] = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => at(sprite.body, x, y)));
  const isBody = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && body[y][x];

  let minX = N, minY = N, maxX = 0, maxY = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (body[y][x]) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const tones: Record<Tone, string> = {
    detail: c.detail, accent: c.accent, outline: c.outline, white: '#ffffff',
    tongue: '#ff5c7a', sky: '#4fc3ff', mint: '#5ee8a5', from: c.from,
  };
  const light = mixHex(c.from, '#ffffff', 0.45);
  const mid = mixHex(c.from, c.to, 0.5);
  const shadow = mixHex(c.to, '#000000', 0.25);

  const grid: (string | null)[][] = Array.from({ length: N }, () => Array<string | null>(N).fill(null));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (body[y][x]) {
      // Блик по верхне-левой кромке, тень по нижне-правой, внутри — три ступени.
      if (!isBody(x, y - 1) || !isBody(x - 1, y)) grid[y][x] = light;
      else if (!isBody(x, y + 1) || !isBody(x + 1, y)) grid[y][x] = shadow;
      else {
        const t = ((y - minY) / h) * 0.75 + ((x - minX) / w) * 0.25;
        grid[y][x] = t < 0.36 ? c.from : t < 0.68 ? mid : c.to;
      }
      for (const [m, tone] of sprite.layers || []) if (at(m, x, y)) grid[y][x] = tones[tone];
    } else if (isBody(x - 1, y) || isBody(x + 1, y) || isBody(x, y - 1) || isBody(x, y + 1)) {
      grid[y][x] = c.outline;
    }
  }
  for (const [m, tone] of sprite.over || []) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (at(m, x, y)) grid[y][x] = tones[tone];
  }
  return grid;
}

const cache = new Map<string, PixelRun[]>();

/** Спрайт как полоски `<rect>` (соседние одноцветные клетки строки слиты). */
export function pixelRuns(key: string, c: PixelColors): PixelRun[] {
  const id = `${key}|${c.from}|${c.to}|${c.outline}|${c.detail}|${c.accent}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const grid = pixelGrid(key, c);
  const runs: PixelRun[] = [];
  grid?.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === fill) end++;
      if (fill) runs.push({ x, y, w: end - x, fill });
      x = end;
    }
  });
  cache.set(id, runs);
  return runs;
}
