/**
 * Фото в промежутках вокруг окна чата: геометрия полос, «нет промежутка» →
 * серая строка в редакторе, проводка стор → тема → слой в MainLayout.
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

const gap = load('src/utils/gapWallpaper.ts');

test('промежуток есть только при отступе от 1px', () => {
  assert.equal(gap.hasLayoutGap(0), false);
  assert.equal(gap.hasLayoutGap(0.4), false);
  assert.equal(gap.hasLayoutGap(undefined), false);
  assert.equal(gap.hasLayoutGap('abc'), false);
  assert.equal(gap.hasLayoutGap(1), true);
  assert.equal(gap.hasLayoutGap(8), true);
});

test('без промежутка полос нет — фото не рисуется вовсе', () => {
  assert.equal(gap.gapStrips(0).length, 0);
});

test('четыре полосы толщиной в отступ, углы не рисуются дважды', () => {
  const strips = gap.gapStrips(8);
  assert.deepEqual([...strips.map((s) => s.key)], ['top', 'bottom', 'left', 'right']);
  const byKey = Object.fromEntries(strips.map((s) => [s.key, s.style]));
  assert.equal(byKey.top.height, 8);
  assert.equal(byKey.bottom.height, 8);
  assert.equal(byKey.left.width, 8);
  assert.equal(byKey.right.width, 8);
  // Боковые начинаются под верхней и кончаются над нижней.
  assert.equal(byKey.left.top, 8);
  assert.equal(byKey.left.bottom, 8);
  assert.equal(byKey.right.top, 8);
});

test('затемнение ограничено, фон безопасен для url()', () => {
  assert.equal(gap.clampGapDim(5), gap.GAP_DIM_LIMITS.max);
  assert.equal(gap.clampGapDim(-1), 0);
  assert.equal(gap.clampGapDim('x'), gap.GAP_DIM_LIMITS.default);
  assert.equal(gap.gapBackground('blob:a', 0), 'url("blob:a")');
  assert.ok(gap.gapBackground('blob:a', 0.3).startsWith('linear-gradient(rgba(0,0,0,0.3)'));
  assert.ok(!gap.gapBackground('blob:a"),url(evil', 0).includes('"),url('), 'кавычки вырезаются');
});

test('фото сжимается, но не растягивается', () => {
  assert.deepEqual({ ...gap.fitWithin(4000, 3000, 1600) }, { width: 1600, height: 1200 });
  assert.deepEqual({ ...gap.fitWithin(800, 600, 1600) }, { width: 800, height: 600 });
});

const store = read('src/store/chatBgPrefsStore.ts');
const themeStore = read('src/store/themeStore.ts');
const storage = read('src/services/chatBgPhotoStorage.ts');
const layout = read('src/pages/MainLayout.tsx');
const layer = read('src/components/GapWallpaper.tsx');
const panel = read('src/components/GapWallpaperPanel.tsx');
const panels = read('src/components/ThemeSettingsPanels.tsx');

test('стор хранит ключ и затемнение (пределы совпадают с utils)', () => {
  assert.ok(store.includes('gapBg: null,'));
  assert.ok(store.includes('setGapBg: (key) =>'));
  assert.ok(store.includes(`gapDim: ${gap.GAP_DIM_LIMITS.default},`), 'значение по умолчанию');
  assert.ok(store.includes(`Math.min(${gap.GAP_DIM_LIMITS.max}, value)`), 'верхний предел');
  assert.ok(!store.includes("from '../utils/gapWallpaper'"), 'стор без импорта utils (vm-тесты)');
});

test('выбор живёт в теме и не стирается старыми снимками', () => {
  assert.ok(themeStore.includes('gaps: { value: bg.gapBg, dim: bg.gapDim }'), 'снимок');
  assert.ok(themeStore.includes('if (s.wallpaper.gaps) {'), 'применяем только если поле есть');
});

test('фото промежутков уезжает на сервер вместе с остальными', () => {
  assert.ok(/referencedPhotoKeys[\s\S]{0,700}add\(state\.gapBg\)/.test(storage));
});

test('слой лежит под окном чата и не грузит фото без промежутка', () => {
  assert.ok(layout.includes('<GapWallpaper margin={chatOuterMargin} />'));
  assert.ok(/<GapWallpaper[\s\S]{0,300}position: 'relative', zIndex: 1,/.test(layout), 'окно чата поверх полос');
  assert.ok(layer.includes('usePhotoBgUrl(hasLayoutGap(margin) ? gapBg : null)'));
  assert.ok(layer.includes("backgroundAttachment: 'fixed'"), 'полосы складываются в одно фото');
  assert.ok(layer.includes('pointerEvents: \'none\''), 'клики проходят');
});

test('без промежутка строка в обоях серая и недоступна', () => {
  assert.ok(panels.includes('<GapWallpaperPanel />'), 'панель во вкладке обоев');
  assert.ok(panel.includes('const enabled = hasLayoutGap(margin);'));
  assert.ok(panel.includes('disabled={!enabled}'), 'строка и кнопки выключены');
  assert.ok(panel.includes("filter: enabled ? undefined : 'grayscale(1)'"), 'превью серое');
  assert.ok(panel.includes('Промежутка нет'), 'объясняем почему');
});
