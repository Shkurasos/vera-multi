const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');

let stickerBubble, THEMED_PACKS, RARITY_META, SKIN_STUDS, FALLBACK_STUD;
// Собираем настоящий stickerBubble с каталогом паков: проверяем итоговые стили.
before(async () => {
  const out = await esbuild.build({
    stdin: {
      contents: `export { stickerBubble } from './src/utils/stickerBubble';
        export { THEMED_PACKS } from './src/store/themedPacks';
        export { RARITY_META } from './src/utils/rarityStyles';
        export { SKIN_STUDS, FALLBACK_STUD } from './src/utils/skinStuds';`,
      resolveDir: __dirname, loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    external: ['@mui/*'],
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  ({ stickerBubble, THEMED_PACKS, RARITY_META, SKIN_STUDS, FALLBACK_STUD } = mod.exports);
});

// Пузырь пака — так же, как его собирает shopStore.
const bubbleOf = (pack) => {
  const def = THEMED_PACKS.find(p => p.id === pack);
  const color = RARITY_META[def.rarity].color;
  return { id: `bubble-${pack}`, category: 'bubble', rarity: def.rarity, previewColor: color, value: { type: 'pack', pack, color } };
};

const layersOf = (v) => v.split(/,\s*(?=url\(|linear|radial|repeating|none)/);
const insetRings = (style) => (style.boxShadow.match(/inset 0 0 0 [\d.]+px/g) || []).length;
const studCount = (style) => layersOf(style['&::before'].backgroundImage).length;

test('фон под текстом — только заливка и узор коллекции, без значков скина', () => {
  for (const def of THEMED_PACKS) {
    const style = stickerBubble(bubbleOf(def.id));
    const urls = layersOf(style.backgroundImage).filter(l => l.startsWith('url('));
    assert.equal(urls.length, 0, `${def.id}: на заливке нет картинок`);
  }
});

test('в каждой коллекции у каждого скина свои фишки на обводке', () => {
  const prefixes = [...new Set(THEMED_PACKS.map(p => p.id.split('-')[0]))];
  for (const prefix of prefixes) {
    const ids = THEMED_PACKS.filter(p => p.id.split('-')[0] === prefix).map(p => p.id);
    // Первая фишка — признак скина без учёта числа (оно зависит от редкости).
    const marks = ids.map(id => layersOf(stickerBubble(bubbleOf(id))['&::before'].backgroundImage)[0]);
    assert.equal(new Set(marks).size, marks.length, `${prefix}: фишки не повторяются`);
  }
});

test('у каждого скина каталога свой мотив, а не общая звёздочка', () => {
  const missing = THEMED_PACKS.map(p => p.id).filter(id => !SKIN_STUDS[id]);
  assert.deepEqual(missing, [], 'мотив есть у всех скинов');
  const bodies = THEMED_PACKS.map(p => SKIN_STUDS[p.id]('#123456', '#000000'));
  assert.equal(new Set(bodies).size, bodies.length, 'мотивы не повторяются во всём каталоге');
  for (const [i, body] of bodies.entries()) {
    const id = THEMED_PACKS[i].id;
    // Мотив — валидный кусок SVG: теги закрыты, нет NaN и пустых путей.
    assert.equal((body.match(/<(path|circle|ellipse|rect)\b/g) || []).length, (body.match(/\/>/g) || []).length, `${id}: теги закрыты`);
    assert.ok(!/NaN|undefined|d=""/.test(body), `${id}: без мусора`);
    assert.ok(body.includes('#123456'), `${id}: красится в цвет скина`);
    assert.notEqual(body, FALLBACK_STUD('#123456', '#000000'), `${id}: не запасная фишка`);
  }
});

test('фишки лежат на линии рамки и почти не выходят за край', () => {
  for (const def of THEMED_PACKS) {
    const style = stickerBubble(bubbleOf(def.id));
    const border = parseFloat(style.border);
    const inset = -parseFloat(style['&::before'].inset);
    const size = parseFloat(style['&::before'].backgroundSize);
    // Наружу выступает только половина фишки минус половина рамки — не больше 4px.
    assert.equal(inset, border / 2 + size / 2, def.id);
    assert.ok(inset - border <= 4, `${def.id}: выступ ${inset - border}px`);
  }
});

test('отделка растёт с редкостью: фишек 1…5, кант богаче', () => {
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const byTier = order.map(r => THEMED_PACKS.find(p => p.rarity === r)).filter(Boolean);
  assert.equal(byTier.length, 5, 'в каталоге есть все пять редкостей');
  const styles = byTier.map(p => stickerBubble(bubbleOf(p.id)));
  assert.deepEqual(styles.map(studCount), [1, 2, 3, 4, 5]);
  const rings = styles.map(insetRings);
  for (let i = 1; i < rings.length; i++) assert.ok(rings[i] >= rings[i - 1], `кант не беднее: ${rings.join(' ≤ ')}`);
  assert.ok(rings[4] > rings[0]);
});

test('значок пака в углу один, как и раньше', () => {
  for (const def of THEMED_PACKS.slice(0, 10)) {
    const after = stickerBubble(bubbleOf(def.id))['&::after'];
    assert.equal(after.backgroundSize, '28px 28px, 46px 20px', def.id);
  }
});

test('у легенды слои и позиции совпадают, кант переливается вместе с рамкой', () => {
  const def = THEMED_PACKS.find(p => p.rarity === 'legendary');
  const style = stickerBubble(bubbleOf(def.id));
  const layers = layersOf(style.backgroundImage).length;
  assert.equal(style.backgroundSize.split(', ').length, layers);
  assert.equal(style.backgroundPosition.split(', ').length, layers);
  const kf = Object.keys(style).find(k => k.startsWith('@keyframes'));
  assert.equal(style[kf]['50%'].backgroundPosition.split(', ').length, layers);
  assert.notEqual(style[kf]['50%'].boxShadow, style.boxShadow);
  assert.equal(style['@media (prefers-reduced-motion: reduce)'].animation, 'none');
});

// Старые пузыри и линейка редкостей — те же ключи, что в shopStore.
const LEGACY_KEYS = ['neon', 'neon-pink', 'glass', 'shadow', 'minimal', 'rounded', 'sharp', 'retro', 'candy', 'mono',
  'aurora', 'cyber', 'holographic', 'gradient-sunset', 'gradient-ocean', 'gradient-forest', 'gradient-lava', 'gradient-ice', 'gradient-gold'];

test('свой мотив есть и у старых пузырей, и у линейки редкостей', () => {
  const keys = [...LEGACY_KEYS, ...Object.keys(RARITY_META).map(r => `r-${r}`)];
  const missing = keys.filter(k => !SKIN_STUDS[k]);
  assert.deepEqual(missing, []);
  const all = Object.values(SKIN_STUDS).map(m => m('#123456', '#000000'));
  assert.equal(new Set(all).size, all.length, 'мотивы не повторяются');
  for (const k of keys) {
    const body = SKIN_STUDS[k]('#123456', '#000000');
    assert.equal((body.match(/<(path|circle|ellipse|rect)\b/g) || []).length, (body.match(/\/>/g) || []).length, `${k}: теги закрыты`);
    assert.ok(!/NaN|undefined|d=""/.test(body) && body.includes('#123456'), k);
  }
});

test('скины одной редкости в коллекции различаются цветом', () => {
  for (const prefix of ['myths', 'nightmare', 'ashes', 'games', 'corp', 'street', 'culture']) {
    const defs = THEMED_PACKS.filter(p => p.id.startsWith(`${prefix}-`));
    for (const rarity of new Set(defs.map(d => d.rarity))) {
      const fills = defs.filter(d => d.rarity === rarity).map(d => stickerBubble(bubbleOf(d.id)).backgroundColor);
      assert.equal(new Set(fills).size, fills.length, `${prefix}/${rarity}: ${fills.join(' ')}`);
    }
  }
});


