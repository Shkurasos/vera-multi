/**
 * Чистые функции редактора картинки иконки (IconImageEditor): удаление
 * светлого фона у загруженного фото, сглаживание штриха и отрисовка штриха
 * каждым инструментом. Без импортов — тестируются в node (iconDrawing.test.cjs).
 */

export type DrawTool =
  | 'brush' | 'marker' | 'pencil' | 'smooth'
  | 'line' | 'rectangle' | 'circle' | 'eraser';

export interface Point { x: number; y: number }

export interface IconStroke {
  tool: DrawTool;
  color: string;
  width: number;
  points: Point[];
  /** Сила выравнивания 1–5, только для tool === 'smooth'. */
  smoothLevel?: number;
}

export const SHAPE_TOOLS: readonly DrawTool[] = ['line', 'rectangle', 'circle'];
export const isShapeTool = (t: DrawTool): t is ShapeTool => t === 'line' || t === 'rectangle' || t === 'circle';

/** Только фигуры-инструменты: их можно выбрать и править после отпускания. */
export type ShapeTool = 'line' | 'rectangle' | 'circle';

export const SMOOTH_LEVEL_LABELS = ['Слабо', 'Мягко', 'Средне', 'Сильно', 'Максимум'] as const;

/* ───────────────────────── Удаление фона ───────────────────────── */

export interface BgRemovalOptions {
  /** Минимальная яркость канала, ниже — точно не фон (0–255). */
  minLight?: number;
  /** Максимальный разброс R/G/B: фон белый или серый, а не цветной. */
  maxSpread?: number;
}

/** Насколько пиксель похож на фон (белый / серая шахматка): 0 — нет, 1 — точно. */
export function backgroundLikeness(r: number, g: number, b: number, opts: BgRemovalOptions = {}): number {
  const minLight = opts.minLight ?? 135;
  const maxSpread = opts.maxSpread ?? 26;
  const lo = Math.min(r, g, b);
  const spread = Math.max(r, g, b) - lo;
  if (lo < minLight || spread > maxSpread) return 0;
  // Чем светлее и нейтральнее, тем увереннее.
  const light = (lo - minLight) / (255 - minLight);
  const neutral = 1 - spread / (maxSpread + 1);
  return Math.min(1, 0.6 + 0.4 * light) * neutral;
}

/**
 * Делает прозрачным белый/серый фон и «нарисованную» шахматку, связанные с
 * краем картинки (заливка от границ). Белое внутри рисунка (блик, глаза) не
 * трогается, если не соединено с краем через фон. Пиксели на границе фона
 * получают частичную прозрачность — без белого ореола.
 * Меняет `data` на месте, возвращает число удалённых пикселей.
 */
export function removeLightBackground(
  data: Uint8ClampedArray, w: number, h: number, opts: BgRemovalOptions = {},
): number {
  const n = w * h;
  if (!n) return 0;
  const isBg = (i: number) => {
    const o = i * 4;
    if (data[o + 3] < 16) return true; // уже прозрачный — тоже фон
    return backgroundLikeness(data[o], data[o + 1], data[o + 2], opts) >= 0.5;
  };

  const removed = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const seed = (i: number) => { if (!removed[i] && isBg(i)) { removed[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

  while (top) {
    const i = stack[--top];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < n - w) seed(i + w);
  }

  let count = 0;
  for (let i = 0; i < n; i++) {
    if (removed[i]) { data[i * 4 + 3] = 0; count++; }
  }
  if (!count) return 0;

  // Мягкий край: сосед удалённого пикселя теряет альфу пропорционально
  // «похожести на фон» — убирает светлую кайму от сглаживания JPEG/PNG.
  const edgeOpts = { ...opts, minLight: (opts.minLight ?? 135) - 40 };
  for (let i = 0; i < n; i++) {
    if (removed[i]) continue;
    const x = i % w;
    const touches = (x > 0 && removed[i - 1]) || (x < w - 1 && removed[i + 1])
      || (i >= w && removed[i - w]) || (i < n - w && removed[i + w]);
    if (!touches) continue;
    const o = i * 4;
    const like = backgroundLikeness(data[o], data[o + 1], data[o + 2], edgeOpts);
    if (like > 0) data[o + 3] = Math.round(data[o + 3] * (1 - like * 0.85));
  }
  return count;
}

/* ───────────────────────── Сглаживание ───────────────────────── */

/**
 * Выравнивание штриха: скользящее среднее (окно растёт с силой) + проход
 * Чайкина. Первая и последняя точки сохраняются — линия не «укорачивается».
 */
export function smoothPoints(points: Point[], level: number): Point[] {
  const lv = Math.max(1, Math.min(5, Math.round(level)));
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const radius = lv * 2;
  const avg: Point[] = points.map((_, i) => {
    let sx = 0; let sy = 0; let cnt = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(points.length - 1, i + radius); j++) {
      sx += points[j].x; sy += points[j].y; cnt++;
    }
    return { x: sx / cnt, y: sy / cnt };
  });
  avg[0] = { ...points[0] };
  avg[avg.length - 1] = { ...points[points.length - 1] };

  let out = avg;
  const passes = lv >= 3 ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    const next: Point[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]; const b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/* ───────────────────────── Отрисовка ───────────────────────── */

/** Толщина линии инструмента при выбранном размере. */
export function toolLineWidth(tool: DrawTool, size: number): number {
  if (tool === 'pencil' || tool === 'smooth') return Math.max(1, size / 3);
  return size;
}

/**
 * Рисует штрих целиком. Редактор восстанавливает снимок слоя и вызывает это
 * на каждый move — так маркер не накапливает альфу, а фигуры тянутся.
 */
export function renderIconStroke(ctx: CanvasRenderingContext2D, s: IconStroke): void {
  const pts = s.tool === 'smooth' ? smoothPoints(s.points, s.smoothLevel ?? 3) : s.points;
  if (!pts.length) return;
  const first = pts[0]; const last = pts[pts.length - 1];
  ctx.save();
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.globalAlpha = s.tool === 'marker' ? 0.35 : 1;
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
  ctx.lineWidth = toolLineWidth(s.tool, s.width);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();

  if (isShapeTool(s.tool)) {
    if (s.tool === 'rectangle') {
      ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else if (s.tool === 'circle') {
      const r = Math.min(Math.abs(last.x - first.x), Math.abs(last.y - first.y)) / 2;
      ctx.arc(first.x + Math.sign(last.x - first.x) * r, first.y + Math.sign(last.y - first.y) * r, r, 0, Math.PI * 2);
    } else {
      ctx.moveTo(first.x, first.y); ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
  } else if (pts.length === 1) {
    ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Квадратичные кривые через середины отрезков — без углов на изломах.
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2; const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

/* ────────────── Выделение фигур (подвижные фигуры) ────────────── */

/**
 * Фигура хранится не «в слое» (там просто вектор примитивов, выбрать его
 * нельзя), а отдельным объектом — поэтому её можно выделить, подвинуть,
 * повернуть и растянуть прямо по холсту, а уже потом впечать в слой.
 *
 * Форма пересобирается из центра, полуосей и угла поворота: размер и поворот
 * независимы — растяжение не сбивает угол, поворот не меняет размер.
 * Всё в системе координат слоя (128×128).
 */
export interface ShapeObj {
  /** Центр фигуры. */
  cx: number; cy: number;
  /** Полуполудлина по X и по Y — уже в повёрнутой системе фигуры. */
  hw: number; hh: number;
  /** Поворот в радианах. */
  angle: number;
  color: string;
  /** Толщина штриха, как у обычной фигуры. */
  width: number;
  tool: ShapeTool;
}

const TAU = Math.PI * 2;
const normAngle = (a: number) => {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Опорные точки фигуры: противоположные углы (прямоугольник, круг) или концы оси (линия). */
export function shapePoints(s: ShapeObj): [Point, Point] {
  const c = Math.cos(s.angle);
  const sn = Math.sin(s.angle);
  // Векторы полуосей, повёрнутые в систему слоя.
  const ux = s.hw * c;
  const uy = s.hw * sn;
  const vx = -s.hh * sn;
  const vy = s.hh * c;
  if (s.tool !== 'line') {
    // Раньше прямоугольник отдавал только ось по X: высота терялась, и
    // прямоугольник после отпускания мыши превращался в полосу.
    return [{ x: s.cx - ux - vx, y: s.cy - uy - vy }, { x: s.cx + ux + vx, y: s.cy + uy + vy }];
  }
  // Линия живёт только по X — hh у неё отвечает лишь за концы.
  return [{ x: s.cx - ux, y: s.cy - uy }, { x: s.cx + ux, y: s.cy + uy }];
}

/** Фигура → обычный штрих (без поворота). Для отрисовки — renderIconShape. */
export function shapeToStroke(s: ShapeObj): IconStroke {
  return { tool: s.tool, color: s.color, width: s.width, points: shapePoints(s) };
}

/**
 * Рисует подвижную фигуру с её поворотом и размерами: прямоугольник и эллипс
 * строятся в системе фигуры, поэтому повёрнутый прямоугольник остаётся
 * прямоугольником. globalAlpha не трогаем — им редактор гасит соседние фигуры.
 */
export function renderIconShape(ctx: CanvasRenderingContext2D, s: ShapeObj): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = s.color;
  ctx.lineWidth = toolLineWidth(s.tool, s.width);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.translate(s.cx, s.cy);
  ctx.rotate(s.angle);
  ctx.beginPath();
  if (s.tool === 'line') {
    ctx.moveTo(-s.hw, 0); ctx.lineTo(s.hw, 0);
  } else if (s.tool === 'rectangle') {
    ctx.rect(-s.hw, -s.hh, s.hw * 2, s.hh * 2);
  } else {
    ctx.ellipse(0, 0, Math.max(0.01, s.hw), Math.max(0.01, s.hh), 0, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Фигура из только что начерченного штриха (две точки, как тянули мышью) —
 * ровно там, где её видно в превью: прямоугольник по рамке, круг — тот же,
 * что рисует renderIconStroke, линия — под своим углом.
 */
export function shapeFromStroke(stroke: IconStroke): ShapeObj | null {
  const [a, b] = stroke.points;
  if (!a || !b || !isShapeTool(stroke.tool)) return null;
  const base = { color: stroke.color, width: stroke.width, tool: stroke.tool };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (stroke.tool === 'line') {
    return { ...base, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, hw: Math.hypot(dx, dy) / 2, hh: 0, angle: Math.atan2(dy, dx) };
  }
  if (stroke.tool === 'circle') {
    // Тот же круг, что в renderIconStroke: радиус по меньшей стороне, от угла начала.
    const r = Math.min(Math.abs(dx), Math.abs(dy)) / 2;
    return { ...base, cx: a.x + Math.sign(dx) * r, cy: a.y + Math.sign(dy) * r, hw: r, hh: r, angle: 0 };
  }
  return { ...base, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, hw: Math.abs(dx) / 2, hh: Math.abs(dy) / 2, angle: 0 };
}

/** Точка из системы слоя в систему фигуры (центр в начале, поворот снят). */
export const toLocal = (p: Point, s: ShapeObj): Point => {
  const dx = p.x - s.cx;
  const dy = p.y - s.cy;
  const c = Math.cos(-s.angle);
  const sn = Math.sin(-s.angle);
  return { x: dx * c - dy * sn, y: dx * sn + dy * c };
};

/** Точка из системы фигуры в систему слоя. */
export const toWorld = (p: Point, s: ShapeObj): Point => {
  const c = Math.cos(s.angle);
  const sn = Math.sin(s.angle);
  return { x: s.cx + p.x * c - p.y * sn, y: s.cy + p.x * sn + p.y * c };
};

/**
 * Точка прибита к границам фигуры в её системе координат: за границу ручку
 * тянуть смысла нет — фигура при этом не «улетает» и не разворачивается.
 */
/**
 * Точка, прибитая к границам фигуры в её системе координат (центр в начале,
 * поворот снят): за границу ручку тянуть смысла нет — фигура при этом не
 * «улетает». Возвращает координаты в системе фигуры.
 */
export const snapped = (p: Point, s: ShapeObj): Point => {
  const l = toLocal(p, s);
  return { x: clamp(l.x, -s.hw, s.hw), y: clamp(l.y, -s.hh, s.hh) };
};

/** Фигура не должна вырождаться в точку. */
export const MIN_SHAPE_SIZE = 2;

/**
 * Новый размер при перетаскивании ручки `handle` в точку `p`.
 * `keep` держит прежнюю полуось: 'x' — у горизонтальных ручек (ширина та же),
 * 'y' — у вертикальных. Так поворот не зависит от растяжения.
 */
export function resized(
  s: ShapeObj,
  handle: { kx: number; ky: number },
  p: Point,
  keep: 'both' | 'x' | 'y',
): ShapeObj {
  // Без snapped: если прибить к текущему bbox, ручка не сможет растянуть
  // фигуру за её прежние границы — только ужать. Ограничение — только минимум.
  const l = toLocal(p, s);
  const hw = handle.kx === 0 ? s.hw : Math.max(MIN_SHAPE_SIZE, Math.abs(l.x));
  const hh = handle.ky === 0 ? s.hh : Math.max(MIN_SHAPE_SIZE, Math.abs(l.y));
  return { ...s, hw: keep === 'y' ? s.hw : hw, hh: keep === 'x' ? s.hh : hh };
}

/**
 * Ручки масштаба: углы и середки сторон (kx, ky ∈ {-1, 0, 1}, обе нули —
 * не ручка). У линии их две — концы самого отрезка: тянуть её «по поперечине»
 * бессмысленно, поэтому bbox-углы для неё не годятся.
 */
export function shapeHandles(s: ShapeObj): Array<{ kx: number; ky: number; p: Point }> {
  if (s.tool === 'line') {
    return [
      { kx: -1, ky: 0, p: toWorld({ x: -s.hw, y: 0 }, s) },
      { kx: 1, ky: 0, p: toWorld({ x: s.hw, y: 0 }, s) },
    ];
  }
  const out: Array<{ kx: number; ky: number; p: Point }> = [];
  for (const kx of [-1, 0, 1]) for (const ky of [-1, 0, 1]) {
    if (kx === 0 && ky === 0) continue;
    out.push({ kx, ky, p: toWorld({ x: kx * s.hw, y: ky * s.hh }, s) });
  }
  return out;
}

/** Попадание указателя в ручку (радиус r в системе слоя — зависит от зума). */
export function handleAt(p: Point, s: ShapeObj, r: number): { kx: number; ky: number } | null {
  for (const h of shapeHandles(s)) {
    if (Math.hypot(p.x - h.p.x, p.y - h.p.y) <= r) return { kx: h.kx, ky: h.ky };
  }
  return null;
}



const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * Попадание в саму фигуру. Точка переводится в систему фигуры и ловим то, что
 * чертили: линия — отрезок, прямоугольник — контур, круг — кольцо.
 * `tol` — допуск указателя в пикселях слоя (растёт на толщину штриха).
 */
export function hitTestShape(p: Point, s: ShapeObj, tol: number): boolean {
  const l = toLocal(p, s);
  const t = tol + s.width / 2;
  if (s.tool === 'line') return distToSeg(l.x, l.y, -s.hw, 0, s.hw, 0) <= t;
  if (s.tool === 'circle') {
    // Кольцо эллипса (у круга hw === hh): расстояние до обода в долях радиуса.
    const r = Math.min(s.hw, s.hh);
    const d = Math.hypot(l.x / Math.max(s.hw, 1e-6), l.y / Math.max(s.hh, 1e-6));
    return Math.abs(d - 1) * r <= Math.max(t, r * 0.3);
  }
  const x0 = -s.hw; const x1 = s.hw; const y0 = -s.hh; const y1 = s.hh;
  const inside = l.x >= x0 - t && l.x <= x1 + t && l.y >= y0 - t && l.y <= y1 + t;
  if (!inside) return false;
  // Прямоугольник берётся только за контур — дырку внутри можно щёлкнуть мимо.
  return Math.min(Math.abs(l.x - x0), Math.abs(l.x - x1)) <= t
    || Math.min(Math.abs(l.y - y0), Math.abs(l.y - y1)) <= t;
}

/** Индекс фигуры под указателем: ищем от верхней (последней) к нижней. */
export function findShapeAt(p: Point, shapes: readonly ShapeObj[], tol: number): number {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitTestShape(p, shapes[i], tol)) return i;
  return -1;
}

/** Поворот фигуры вокруг её центра (угол в радианах, приводится к ±π). */
export const rotated = (s: ShapeObj, angle: number): ShapeObj => ({ ...s, angle: normAngle(angle) });

