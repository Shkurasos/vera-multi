const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { create } = require('zustand');

test('every server reward has matching client pieces, rarity and weight', () => {
  const cache = new Map();
  function load(file) {
    if (file.endsWith('.json')) return require(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const context = {
      exports, console,
      require: name => {
        if (name === 'zustand') return { create };
        if (name === 'zustand/middleware') return { persist: fn => fn };
        if (!name.startsWith('.')) return require(name);
        if (name.endsWith('/services/api')) return {};
        if (name.endsWith('storeSyncSimple')) return { registerAccountStore() {} };
        if (name.endsWith('authStore')) return { useAuthStore: { getState: () => ({ user: null }) } };
        return load(path.resolve(path.dirname(file), name + (name.endsWith('.json') ? '' : '.ts')));
      },
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText, context);
    return exports;
  }
  const { SKIN_PACKS, casePacks, packChance, drawPack } = load(path.join(__dirname, 'src/store/lootStore.ts'));
  const { SHOP_CATALOG } = load(path.join(__dirname, 'src/store/shopStore.ts'));
  const { THEMED_MATERIALS, themedSkin } = load(path.join(__dirname, 'src/utils/themedSkin.ts'));
  const redesigned = Object.keys(THEMED_MATERIALS).filter(key => /^(myths|nightmare|ashes)-/.test(key));
  assert.equal(redesigned.length, 30);
  for (const key of redesigned) {
    const material = THEMED_MATERIALS[key];
    for (const part of ['bubble', 'ring']) {
      const style = themedSkin(key, part);
      assert.equal(style.border, part === 'ring'
        ? `${material.edge === '1px solid' ? '2px solid' : material.edge} ${material.accent}`
        : `${material.edge} ${material.accent}99`);
      assert.equal(style['@media (prefers-reduced-motion: reduce)']['&::before, &::after'].animation, 'none');
      if (part === 'ring') {
        assert.equal(style.overflow, 'visible');
        assert.equal(style.outline, `1px solid ${material.accent}66`);
        assert.equal(style.outlineOffset, '2px');
      } else {
        assert.equal(style.color, material.ink);
        assert.equal(style.borderRadius, material.radius === '50%' ? '22px 22px 10px 10px' : material.radius);
        assert.ok(style.background.includes('linear-gradient'));
        assert.equal(style['&::before'].pointerEvents, 'none');
      }
    }
  }
  for (const [key, material] of Object.entries(THEMED_MATERIALS)) {
    const style = themedSkin(key, 'selfcard');
    assert.equal(style.border, `1px solid ${material.accent}66`);
    assert.equal(style.borderRadius, '10px');
    assert.equal(style.background, `radial-gradient(ellipse at 100% 0%, ${material.accent}38, transparent 65%), ${material.surface}`);
    assert.equal(style.boxShadow, `inset 0 1px 0 ${material.accent}44, inset 0 -1px 0 #00000033, 0 5px 16px #00000026`);
    assert.equal(style.color, material.ink);
  }
  const seen = new Set();
  const { bubbleSkin, selfcardSkin } = load(path.join(__dirname, 'src/utils/bubbleSkin.ts'));
  for (const item of SHOP_CATALOG.filter(item => item.category === 'selfcard' && item.value?.pack)) {
    const bubble = SHOP_CATALOG.find(candidate => candidate.category === 'bubble' && candidate.value?.pack === item.value.pack);
    assert.ok(bubble, item.id);
    for (const themeMode of [false, true]) {
      const plaque = selfcardSkin(item, SHOP_CATALOG, '#aabbcc', themeMode);
      const expected = bubbleSkin(bubble, '#aabbcc', themeMode);
      for (const key of Object.keys(expected)) {
        if (['borderRadius', '&::before', '&::after'].includes(key)) continue;
        assert.deepEqual(plaque[key], expected[key], `${item.id}: ${key}`);
      }
      assert.equal(plaque.fontSize, 11);
      assert.equal(plaque.display, 'inline-flex');
      assert.equal(plaque.borderRadius, '4px');
      assert.equal(plaque['&::before'].width, '18px');
      assert.equal(plaque['&::before'].flexShrink, 0);
      assert.ok(plaque['&::before'].backgroundImage.startsWith('url('));
      assert.equal(plaque['&::before'].position, undefined);
    }
  }
  for (const definition of require('./src/store/cases.json')) {
    const pool = casePacks(definition.id);
    assert.equal(pool.length, definition.rewards.length);
    assert.ok(Math.abs(pool.reduce((sum, pack) => sum + packChance(pack, definition.id), 0) - 100) < 1e-8);
    assert.ok(pool.some(pack => pack.id === drawPack(0, definition.id).id));
    assert.ok(pool.some(pack => pack.id === drawPack(0.999999, definition.id).id));
    for (const reward of definition.rewards) {
      assert.ok(!seen.has(reward.key));
      seen.add(reward.key);
      const pack = SKIN_PACKS.find(pack => pack.id === `pack-${reward.key}`);
      assert.ok(pack);
      assert.equal(pack.weight, reward.weight);
      const parts = [pack.ring, pack.selfcard, pack.bubble].map(id => SHOP_CATALOG.find(item => item.id === id));
      assert.ok(parts.every(Boolean));
      assert.equal(parts[0].rarity, parts[1].rarity);
      assert.equal(parts[1].rarity, parts[2].rarity);
    }
  }
  assert.equal(seen.size, SKIN_PACKS.length);
  const games = casePacks('case-games');
  const dragon = games.find(pack => pack.id === 'pack-games-dragon');
  assert.ok(Math.abs(packChance(dragon, 'case-games') - 0.001) < 1e-12);
  const total = games.reduce((sum, pack) => sum + pack.weight, 0);
  assert.ok(Number.isSafeInteger(total) && total < 2 ** 48);
  assert.ok(games.every(pack => Number.isSafeInteger(pack.weight) && pack.weight > 0));
  const start = games.slice(0, games.indexOf(dragon)).reduce((sum, pack) => sum + pack.weight, 0);
  assert.equal(drawPack((start + 0.5) / total, 'case-games').id, dragon.id);
  assert.equal(drawPack((start + dragon.weight - 0.5) / total, 'case-games').id, dragon.id);
  assert.notEqual(drawPack((start - 0.5) / total, 'case-games').id, dragon.id);
  assert.notEqual(drawPack((start + dragon.weight + 0.5) / total, 'case-games').id, dragon.id);
});