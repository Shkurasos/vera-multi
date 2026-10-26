/**
 * Пак реакций «Пиксели»: спрайты 32×32 с контуром, а не гладкие SVG-формы.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

function load(file) {
  const ctx = vm.createContext({ console, exports: {}, module: { exports: {} }, require: () => ({}) });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(read(file), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  return ctx.module.exports;
}

const px = load('src/utils/pixelReactions.ts');
const catalog = JSON.parse(read('src/store/reactionSkins.json'));
const COLORS = { from: '#ffe08a', to: '#f5b335', outline: '#1b1b1b', detail: '#5a3a12', accent: '#4fc3ff' };
const keyOf = (id) => id.slice(id.lastIndexOf('-') + 1);

test('у каждой реакции пака «Пиксели» есть спрайт 32×32 с контуром', () => {
  const pack = catalog.packs.find(p => p.id === 'pixel');
  assert.ok(pack, 'пак pixel есть в каталоге');
  for (const r of pack.reactions) {
    const key = keyOf(r.id);
    const grid = px.pixelGrid(key, COLORS);
    assert.ok(grid, `спрайт для ${key}`);
    assert.equal(grid.length, 32);
    assert.ok(grid.every(row => row.length === 32));
    const filled = grid.flat().filter(Boolean);
    assert.ok(filled.length > 150, `${key}: спрайт не пустой (${filled.length})`);
    assert.ok(filled.includes('#1b1b1b'), `${key}: есть контур`);
    // Пиксель-арт — ограниченная палитра, а не градиент.
    assert.ok(new Set(filled).size <= 12, `${key}: палитра ${new Set(filled).size}`);
  }
});

test('полоски не выходят за сетку и не перекрываются', () => {
  for (const key of px.PIXEL_REACTION_KEYS) {
    const seen = new Set();
    for (const r of px.pixelRuns(key, COLORS)) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.w >= 1 && r.x + r.w <= 32 && r.y < 32, `${key}: ${JSON.stringify(r)}`);
      for (let x = r.x; x < r.x + r.w; x++) {
        assert.ok(!seen.has(`${x},${r.y}`), `${key}: клетка ${x},${r.y} дважды`);
        seen.add(`${x},${r.y}`);
      }
    }
  }
});

test('дизлайк — тот же палец, повёрнутый на 180°', () => {
  const like = px.pixelGrid('like', COLORS);
  const dislike = px.pixelGrid('dislike', COLORS);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    assert.equal(!!dislike[31 - y][31 - x], !!like[y][x], `клетка ${x},${y}`);
  }
});

test('mixHex смешивает цвета и не ломает rgba', () => {
  assert.equal(px.mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(px.mixHex('rgba(0,0,0,.3)', '#ffffff', 0.5), 'rgba(0,0,0,.3)');
});

test('глиф рисует пак «Пиксели» спрайтом, остальные — формами', () => {
  const glyph = read('src/components/ReactionGlyph.tsx');
  assert.ok(glyph.includes('p.pixel') && glyph.includes('pixelRuns(key'), 'спрайт для пиксельного пака');
  assert.ok(glyph.includes('<ReactionArt'), 'остальные паки — прежние формы');
  assert.ok(glyph.includes("shapeRendering={p.pixel ? 'crispEdges'"), 'без сглаживания краёв');
});
