const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/utils/iconDrawing.ts'), 'utf8');
const context = vm.createContext({ console, exports: {}, module: { exports: {} } });
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);
const { removeLightBackground, backgroundLikeness, smoothPoints, toolLineWidth, isShapeTool } = context.exports;
// Выделение фигур (та же трансляция).
const {
  shapePoints, shapeToStroke, toLocal, toWorld, snapped, resized, shapeHandles,
  handleAt, hitTestShape, findShapeAt, rotated, shapeFromStroke, renderIconShape,
} = context.exports;

/** RGBA-картинка w×h, заполненная fill(x, y) → [r, g, b, a]. */
function image(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fill(x, y), (y * w + x) * 4);
  return d;
}
const alpha = (d, w, x, y) => d[(y * w + x) * 4 + 3];

test('белый фон вокруг рисунка становится прозрачным, рисунок остаётся', () => {
  const w = 10; const h = 10;
  const d = image(w, h, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6 ? [200, 30, 30, 255] : [255, 255, 255, 255]));
  const removed = removeLightBackground(d, w, h);
  assert.equal(removed, 100 - 16);
  assert.equal(alpha(d, w, 0, 0), 0);
  assert.equal(alpha(d, w, 9, 9), 0);
  assert.equal(alpha(d, w, 4, 4), 255);
});

test('серо-белая шахматка, нарисованная в картинке, тоже удаляется', () => {
  const w = 16; const h = 16;
  const d = image(w, h, (x, y) => {
    if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return [20, 120, 220, 255];
    return ((x >> 2) + (y >> 2)) % 2 ? [204, 204, 204, 255] : [255, 255, 255, 255];
  });
  removeLightBackground(d, w, h);
  assert.equal(alpha(d, w, 0, 0), 0);
  assert.equal(alpha(d, w, 4, 0), 0); // серая клетка
  assert.equal(alpha(d, w, 7, 7), 255);
});

test('белое внутри рисунка, не связанное с краем, не трогается', () => {
  const w = 9; const h = 9;
  // Чёрное кольцо с белым центром на белом фоне.
  const d = image(w, h, (x, y) => {
    const ring = x >= 2 && x <= 6 && y >= 2 && y <= 6;
    const inner = x >= 3 && x <= 5 && y >= 3 && y <= 5;
    return ring && !inner ? [0, 0, 0, 255] : [255, 255, 255, 255];
  });
  removeLightBackground(d, w, h);
  assert.equal(alpha(d, w, 0, 0), 0);
  assert.equal(alpha(d, w, 4, 4), 255, 'белый центр внутри кольца остался');
});

test('цветной и тёмный фон не считаются фоном', () => {
  assert.equal(backgroundLikeness(255, 230, 0), 0); // жёлтый
  assert.equal(backgroundLikeness(60, 60, 60), 0); // тёмно-серый
  assert.ok(backgroundLikeness(255, 255, 255) > 0.9);
  const w = 4; const h = 4;
  const d = image(w, h, () => [40, 200, 90, 255]);
  assert.equal(removeLightBackground(d, w, h), 0);
  assert.equal(alpha(d, w, 0, 0), 255);
});

test('выравнивание сохраняет концы и уменьшает дрожание, сильнее — глаже', () => {
  // Горизонтальная линия с шумом ±3 по y.
  const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: 50 + (i % 2 ? 3 : -3) }));
  const jitter = (arr) => {
    let s = 0;
    for (let i = 1; i < arr.length - 1; i++) s += Math.abs(arr[i].y - (arr[i - 1].y + arr[i + 1].y) / 2);
    return s / (arr.length - 2);
  };
  const weak = smoothPoints(pts, 1);
  const strong = smoothPoints(pts, 5);
  assert.deepEqual({ ...weak[0] }, { ...pts[0] });
  assert.deepEqual({ ...strong[strong.length - 1] }, { ...pts[pts.length - 1] });
  assert.ok(jitter(weak) < jitter(pts), 'слабое сглаживание уже убирает дрожание');
  assert.ok(jitter(strong) < jitter(weak), 'сильное — глаже слабого');
  // Короткий штрих (точка) не ломается.
  assert.equal(smoothPoints([{ x: 1, y: 1 }], 3).length, 1);
});

test('толщина и тип инструментов', () => {
  assert.equal(toolLineWidth('brush', 9), 9);
  assert.equal(toolLineWidth('pencil', 9), 3);
  assert.equal(toolLineWidth('smooth', 1), 1);
  assert.ok(isShapeTool('circle'));
  assert.ok(!isShapeTool('marker'));
});

/* ── Выделение и правка фигур ── */

const shape = (over = {}) => ({ cx: 50, cy: 50, hw: 30, hh: 20, angle: 0, color: '#f00', width: 4, tool: 'rectangle', ...over });
const deg = (d) => (d * Math.PI) / 180;

test('фигура → опорные точки и обратно: центр и поворот сходятся', () => {
  const s = shape({ angle: deg(30) });
  const [a, b] = shapePoints(s);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  assert.ok(Math.hypot(mid.x - s.cx, mid.y - s.cy) < 1e-9, 'центр сохраняется');
  // Прямоугольник — противоположные углы: в системе фигуры это (±hw, ±hh).
  // Раньше отдавалась только ось X, и прямоугольник становился полосой.
  const la = toLocal(a, s); const lb = toLocal(b, s);
  assert.ok(Math.abs(la.x + s.hw) < 1e-9 && Math.abs(la.y + s.hh) < 1e-9, 'первый угол (-hw, -hh)');
  assert.ok(Math.abs(lb.x - s.hw) < 1e-9 && Math.abs(lb.y - s.hh) < 1e-9, 'второй угол (+hw, +hh)');
  // У линии — концы оси под её углом.
  const line = shape({ tool: 'line', hh: 0, angle: deg(30) });
  const [p, q] = shapePoints(line);
  assert.ok(Math.abs(Math.atan2(q.y - p.y, q.x - p.x) - deg(30)) < 1e-9, 'угол линии сохраняется');
  const st = shapeToStroke(shape());
  assert.equal(st.tool, 'rectangle');
  assert.equal(st.color, '#f00');
});

test('фигура из начерченного штриха лежит там же, где её видно', () => {
  const rect = shapeFromStroke({ tool: 'rectangle', color: '#fff', width: 4, points: [{ x: 90, y: 20 }, { x: 30, y: 60 }] });
  assert.equal(rect.cx, 60); assert.equal(rect.cy, 40);
  assert.equal(rect.hw, 30); assert.equal(rect.hh, 20, 'высота не теряется');
  assert.equal(rect.angle, 0);
  // Линия — под своим углом, длина сохраняется.
  const line = shapeFromStroke({ tool: 'line', color: '#fff', width: 4, points: [{ x: 10, y: 10 }, { x: 40, y: 50 }] });
  assert.equal(line.hw * 2, 50);
  assert.ok(Math.abs(line.angle - Math.atan2(40, 30)) < 1e-9);
  const [p, q] = shapePoints(line);
  assert.ok(Math.hypot(p.x - 10, p.y - 10) < 1e-9 && Math.hypot(q.x - 40, q.y - 50) < 1e-9, 'концы — там, где тянули');
  // Круг — тот же, что рисует штрих: по меньшей стороне от угла начала.
  const c = shapeFromStroke({ tool: 'circle', color: '#fff', width: 4, points: [{ x: 10, y: 10 }, { x: 50, y: 30 }] });
  assert.equal(c.hw, 10); assert.equal(c.hh, 10);
  assert.equal(c.cx, 20); assert.equal(c.cy, 20);
  assert.equal(shapeFromStroke({ tool: 'brush', color: '#fff', width: 4, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }), null, 'кисть — не фигура');
});

test('подвижная фигура рисуется в своей системе: поворот и размер', () => {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  const ctx = {};
  for (const k of ['save', 'restore', 'translate', 'rotate', 'beginPath', 'moveTo', 'lineTo', 'rect', 'ellipse', 'stroke']) ctx[k] = rec(k);
  renderIconShape(ctx, shape({ angle: deg(90) }));
  const names = calls.map((c) => c[0]);
  const t = names.indexOf('translate');
  assert.deepEqual(names.slice(t, t + 2), ['translate', 'rotate'], 'сначала в центр, потом поворот');
  assert.equal(calls[t + 1][1], deg(90));
  const rect = calls.find((c) => c[0] === 'rect');
  assert.deepEqual(rect.slice(1), [-30, -20, 60, 40], 'прямоугольник по полуосям, а не полоса');
  assert.ok(names.includes('stroke'));
  assert.equal(ctx.strokeStyle, '#f00');
});

test('toLocal/toWorld — взаимно обратны под поворотом', () => {
  const s = shape({ angle: deg(-57) });
  const p = { x: 73.5, y: 21.25 };
  const back = toWorld(toLocal(p, s), s);
  assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-9);
  // snapped прибивает к bbox в системе фигуры (центр в начале, поворот снят).
  const q = snapped({ x: 999, y: -999 }, s);
  assert.equal(q.x, s.hw);
  assert.equal(q.y, s.hh, 'внутри bbox, ближняя грань');
});

test('ручки: углы + середки, у линии только два конца; попадание с допуском', () => {
  const r = shapeHandles(shape());
  assert.equal(r.length, 8);
  const l = shapeHandles(shape({ tool: 'line', hh: 0 }));
  assert.equal(l.length, 2, 'у линии только два конца');
  // Концы линии — на самом отрезке, а не в углах bbox.
  assert.ok(Math.abs(l[0].p.x - 20) < 1e-9 && Math.abs(l[0].p.y - 50) < 1e-9);
  const s = shape();
  const corner = r[0].p;
  const h = handleAt(corner, s, 4);
  // Объект из другого vm-контекста — сравниваем поля, а не сам объект.
  assert.ok(h && h.kx === r[0].kx && h.ky === r[0].ky);
  assert.equal(handleAt({ x: 50, y: 50 }, s, 4), null, 'в центре ручек нет');
});

test('растяжение держит поворот и не даёт фигуре выродиться', () => {
  const s = shape({ angle: deg(45) });
  // Тянем за правый угол: hw растёт, поворот не сбивается.
  const far = toWorld({ x: 70, y: 0 }, s);
  const big = resized(s, { kx: 1, ky: 1 }, far, 'both');
  assert.ok(big.hw > s.hw);
  assert.equal(big.angle, s.angle);
  // Боковая ручка меняет только ширину.
  const side = resized(s, { kx: 1, ky: 0 }, far, 'x');
  assert.ok(side.hw > s.hw);
  assert.equal(side.hh, s.hh);
  // Микроскопическая ручка не обнуляет фигуру.
  const tiny = resized(s, { kx: 1, ky: 1 }, { x: 50.4, y: 50.1 }, 'both');
  assert.ok(tiny.hw >= 2 && tiny.hh >= 2, 'минимальный размер держится');
});

test('попадание: берётся контур прямоугольника, дырка внутри — мимо', () => {
  const s = shape();
  assert.ok(hitTestShape({ x: 50, y: 30 }, s, 3), 'верхняя грань');
  assert.ok(!hitTestShape({ x: 50, y: 50 }, s, 3), 'середка пустая');
  assert.ok(!hitTestShape({ x: 95, y: 50 }, s, 3), 'за границей');
  // Линия ловится по отрезку, круг — по кольцу.
  const l = shape({ tool: 'line', hh: 0 });
  assert.ok(hitTestShape({ x: 50, y: 50 }, l, 3), 'на линии');
  const c = shape({ tool: 'circle', hw: 25, hh: 25 });
  assert.ok(hitTestShape({ x: 75, y: 50 }, c, 3), 'на ободе');
  assert.ok(!hitTestShape({ x: 50, y: 50 }, c, 3), 'внутри круга пусто');
});

test('поиск фигуры: верхняя (последняя) в приоритете, мимо — ничего', () => {
  const a = shape();
  const b = shape({ cx: 55, cy: 55 });
  assert.equal(findShapeAt({ x: 55, y: 32 }, [a, b], 3), 1, 'сверху — вторая');
  assert.equal(findShapeAt({ x: 10, y: 10 }, [a, b], 3), -1);
});

test('rotated приводит угол к ±π и не двигает центр', () => {
  const s = shape({ angle: deg(10) });
  const r = rotated(s, deg(10) + deg(360));
  assert.ok(Math.abs(r.angle - s.angle) < 1e-9);
  assert.equal(r.cx, s.cx);
  assert.equal(r.cy, s.cy);
});
