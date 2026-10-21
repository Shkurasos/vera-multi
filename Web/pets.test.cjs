const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = relative => fs.readFileSync(path.join(__dirname, relative), 'utf8');

function loadInteraction(position = { x: 50, y: 50 }) {
  const context = { exports: {}, window: { innerWidth: 1000, innerHeight: 500 }, require: () => ({ useRef: () => ({ current: null }) }) };
  vm.runInNewContext(ts.transpileModule(source('src/hooks/usePetInteraction.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  let taps = 0;
  const moves = [];
  const saves = [];
  const handlers = context.exports.default({ position, size: 100,
    onTap: () => taps++, onMove: value => moves.push(value), onSave: value => saves.push(value) });
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const event = (x = 100, y = 100, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1,
    isPrimary: true, button: 0, currentTarget: target, ...extra });
  return { handlers, event, moves, saves, taps: () => taps, dockPet: context.exports.dockPet, getPetDock: context.exports.getPetDock };
}

test('pet taps and pointer jitter react repeatedly without moving or saving', () => {
  const { handlers, event, moves, saves, taps } = loadInteraction();
  for (let i = 0; i < 3; i++) {
    handlers.onPointerDown(event());
    handlers.onPointerMove(event(103, 102));
    handlers.onPointerUp(event(103, 102));
  }
  assert.equal(taps(), 3);
  assert.equal(moves.length, 0);
  assert.equal(saves.length, 0);
});

test('pet tap reacts instantly; second tap in window fires onDoubleTap', async () => {
  const context = { exports: {}, window: { innerWidth: 1000, innerHeight: 500 }, Date,
    require: () => ({ useRef: (v) => ({ current: v === undefined ? null : v }) }) };
  vm.runInNewContext(ts.transpileModule(source('src/hooks/usePetInteraction.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  let singles = 0;
  let doubles = 0;
  const handlers = context.exports.default({ position: { x: 50, y: 50 }, size: 100,
    onTap: () => singles++, onDoubleTap: () => doubles++, onMove() {}, onSave() {} });
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const ev = { clientX: 100, clientY: 100, pointerId: 1, isPrimary: true, button: 0, currentTarget: target };
  const click = () => { handlers.onPointerDown(ev); handlers.onPointerUp(ev); };
  click();
  assert.equal(singles, 1, 'одиночный тап срабатывает сразу, без задержки');
  click();
  assert.equal(doubles, 1);
  assert.equal(singles, 1, 'второй тап не вызывает повторный onTap');
  await new Promise((r) => setTimeout(r, context.exports.PET_DOUBLE_TAP_MS + 40));
  click();
  assert.equal(singles, 2, 'после окна тап снова одиночный');
  assert.equal(doubles, 1);
});

test('double tap: right half is next track, left half is previous', () => {
  const context = { exports: {}, window: { innerWidth: 1000, innerHeight: 500 }, Date,
    require: () => ({ useRef: (v) => ({ current: v === undefined ? null : v }) }) };
  vm.runInNewContext(ts.transpileModule(source('src/hooks/usePetInteraction.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const sides = [];
  const handlers = context.exports.default({ position: { x: 50, y: 50 }, size: 100,
    onTap() {}, onDoubleTap: (side) => sides.push(side), onMove() {}, onSave() {} });
  // Питомец занимает x 100..200 — середина 150.
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 100, width: 100 }) };
  const doubleAt = (x) => {
    const ev = { clientX: x, clientY: 100, pointerId: 1, isPrimary: true, button: 0, currentTarget: target };
    for (let i = 0; i < 2; i++) { handlers.onPointerDown(ev); handlers.onPointerUp(ev); }
  };
  doubleAt(180);
  doubleAt(120);
  assert.deepEqual(sides, ['right', 'left']);
  assert.equal(context.exports.petTapSide(10, null), 'right', 'без размеров — следующий трек');
  const layout = source('src/pages/MainLayout.tsx');
  assert.ok(layout.includes("if (side === 'left')") && layout.includes('prevTrack();'), 'левая половина — prev');
});

test('pet drag docks at the wall but never reacts, including a return to origin', () => {
  const { handlers, event, saves, taps } = loadInteraction();
  handlers.onPointerDown(event());
  handlers.onPointerMove(event(2000, 2000));
  handlers.onPointerUp(event(2000, 2000));
  assert.equal(saves[0].x, 100);
  assert.equal(saves[0].y, 90);
  handlers.onPointerDown(event());
  handlers.onPointerMove(event(110, 100));
  handlers.onPointerUp(event());
  assert.equal(taps(), 0);
  assert.equal(saves.length, 1);
});

test('pet dragging updates the overlay without rerendering MainLayout for every pointer move', () => {
  const layout = source('src/pages/MainLayout.tsx');
  assert.match(layout, /onMove: applyPetPosition/);
  assert.match(layout, /onSave: \(position\) => \{\s*setPetPosition\(position\)/);
  assert.match(layout, /overlay\.style\.left = `\$\{position\.x\}%`/);
  assert.match(layout, /overlay\.style\.top = `\$\{position\.y\}%`/);
  assert.match(layout, /ref=\{petOverlayRef\}/);
  assert.match(layout, /ref=\{petBodyRef\}/);
});

test('pet docks to each wall, leaves the wall on drag, and chooses one wall at corners', () => {
  const { dockPet, getPetDock } = loadInteraction();
  for (const [position, expected, wall] of [
    [{ x: 3, y: 50 }, { x: 0, y: 50 }, 'left'],
    [{ x: 97, y: 50 }, { x: 100, y: 50 }, 'right'],
    [{ x: 50, y: 3 }, { x: 50, y: 0 }, 'top'],
    [{ x: 50, y: 97 }, { x: 50, y: 100 }, 'bottom'],
    // Верх/низ липнут слабее: рядом со стеной питомец лишь упирается в неё.
    [{ x: 50, y: 8 }, { x: 50, y: 10 }, null],
    [{ x: 50, y: 92 }, { x: 50, y: 90 }, null],
    [{ x: -20, y: -20 }, { x: 0, y: 10 }, 'left'],
  ]) {
    const actual = dockPet(position, 100, 1000, 500);
    assert.deepEqual({ ...actual }, expected);
    assert.equal(getPetDock(actual), wall);
  }
  assert.equal(getPetDock(dockPet({ x: 20, y: 50 }, 100, 1000, 500)), null);
  const { handlers, event, saves } = loadInteraction({ x: 0, y: 50 });
  handlers.onPointerDown(event());
  handlers.onPointerUp(event(300, 100));
  assert.deepEqual({ ...saves[0] }, { x: 20, y: 50 });
});

test('pet cancelled and unrelated pointers cannot trigger reactions or persistence', () => {
  const { handlers, event, moves, saves, taps } = loadInteraction();
  handlers.onPointerDown(event(100, 100, { button: 2 }));
  handlers.onPointerUp(event());
  handlers.onPointerDown(event());
  handlers.onPointerUp(event(100, 100, { pointerId: 2 }));
  handlers.onPointerMove(event(120, 100));
  handlers.onPointerCancel(event());
  handlers.onPointerUp(event());
  assert.equal(moves.at(-1).x, 50);
  assert.equal(taps(), 0);
  assert.equal(saves.length, 0);
  handlers.onPointerDown(event());
  handlers.onLostPointerCapture(event());
  handlers.onPointerUp(event());
  assert.equal(taps(), 0);
});

test('pet reacts to keyboard activation, not key repeats', () => {
  const { handlers, taps } = loadInteraction();
  for (const key of ['Enter', ' ']) handlers.onKeyDown({ key, repeat: false, preventDefault() {} });
  handlers.onKeyDown({ key: 'Enter', repeat: true, preventDefault() {} });
  handlers.onKeyDown({ key: 'Escape' });
  assert.equal(taps(), 2);
});

test('every pet has distinct themed particles with finite outward trajectories', () => {
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source('src/utils/petParticles.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const kinds = new Set();
  for (const petId of ['pet-cat', 'pet-fox', 'pet-bunny', 'pet-pixel', 'pet-phoenix',
    'pet-spider', 'pet-bear', 'pet-snake', 'pet-pumpkin', 'pet-jellyfish']) {
    const particles = context.exports.getPetParticles(petId);
    assert.equal(particles.length, 12);
    kinds.add(particles[0].kind);
    for (const particle of particles) {
      assert.ok(Number.isFinite(particle.dx) && Number.isFinite(particle.dy));
      assert.ok(Math.hypot(particle.dx, particle.dy) > 10);
      assert.ok(particle.delay + 800 < 950);
    }
  }
  // star, bubble, spark, pixel, ember + новый heart для медвежонка.
  assert.equal(kinds.size, 6);
  assert.equal(context.exports.getPetParticles('unknown').length, 0);
});

test('pet size follows one fifth of the smaller viewport dimension', () => {
  const context = {
    exports: {},
    require: () => ({ useEffect() {}, useState() {} }),
    window: { innerWidth: 1920, innerHeight: 1080 },
  };
  vm.runInNewContext(ts.transpileModule(source('src/hooks/useMaxPetSize.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  assert.equal(context.exports.getMaxPetSize(), 216);
  context.window.innerWidth = 3840;
  context.window.innerHeight = 2160;
  assert.equal(context.exports.getMaxPetSize(), 432);
  context.window.visualViewport = { width: 390, height: 844 };
  assert.equal(context.exports.getMaxPetSize(), 78);
  context.window.visualViewport.height = 200;
  assert.equal(context.exports.getMaxPetSize(), 40);
});

test('pet case probabilities decrease with rarity and normalize to 100%', () => {
  const definition = require('./src/store/cases.json').find(item => item.id === 'case-pets');
  const weights = Object.fromEntries(definition.rewards.map(reward => [reward.key, reward.weight]));
  const order = ['pet-fox', 'pet-bunny', 'pet-phoenix', 'pet-pixel', 'pet-cat'];
  for (let i = 1; i < order.length; i++) assert.ok(weights[order[i - 1]] > weights[order[i]]);
  const total = definition.rewards.reduce((sum, reward) => sum + reward.weight, 0);
  assert.ok(Math.abs(definition.rewards.reduce((sum, reward) => sum + reward.weight / total * 100, 0) - 100) < 1e-10);
  assert.ok(source('../Server/server.js').includes("require('./../Web/src/store/cases.json')"));
});

test('bestiary case costs 2000 VP with weights decreasing by rarity and matching server pets', () => {
  const definition = require('./src/store/cases.json').find(item => item.id === 'case-pets-bestiary');
  assert.equal(definition.price, 2000);
  assert.equal(definition.name, 'Бестиарий');
  assert.deepEqual(definition.packs, []);
  const weights = Object.fromEntries(definition.rewards.map(reward => [reward.key, reward.weight]));
  const order = ['pet-spider', 'pet-bear', 'pet-snake', 'pet-pumpkin', 'pet-jellyfish'];
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  for (let i = 1; i < order.length; i++) assert.ok(weights[order[i - 1]] > weights[order[i]]);
  const total = definition.rewards.reduce((sum, reward) => sum + reward.weight, 0);
  assert.ok(Math.abs(definition.rewards.reduce((sum, reward) => sum + reward.weight / total * 100, 0) - 100) < 1e-10);
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source('src/store/petCatalog.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const server = source('../Server/server.js');
  const artwork = source('src/components/PetArtwork.tsx');
  order.forEach((id, index) => {
    const pet = context.exports.PET_CATALOG.find(item => item.id === id);
    assert.ok(pet, id);
    assert.equal(pet.rarity, rarities[index]);
    assert.deepEqual([...pet.caseIds], ['case-pets-bestiary']);
    assert.ok(server.includes(`'${id}': { name: '${pet.name}', rarity: '${rarities[index]}', cases: ['case-pets-bestiary'] }`), `сервер: ${id}`);
    assert.ok(artwork.includes(`case '${id}': return <`), `арт: ${id}`);
  });
});

test('mythical pets case costs 2000 VP and synchronizes its exclusive catalog, artwork and particles', () => {
  const definition = require('./src/store/cases.json').find(item => item.id === 'case-pets-mythical');
  assert.equal(definition.price, 2000);
  assert.equal(definition.name, 'Мифические питомцы');
  // Кейс снят с продажи до доработки арта: hidden прячет его с витрины
  // и запрещает покупку на сервере, но инвентарь и открытие работают.
  assert.equal(definition.hidden, true);
  assert.ok(source('../Server/server.js').includes("action === 'buy' && definition.hidden"));
  assert.ok(source('src/store/caseCatalog.ts').includes('isHiddenCase'));
  assert.ok(source('src/components/Store.tsx').includes('isHiddenCase'));
  assert.deepEqual(definition.packs, []);
  const order = ['pet-panda', 'pet-hedgehog', 'pet-squirrel', 'pet-pixel-dragon', 'pet-bat'];
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const weights = Object.fromEntries(definition.rewards.map(reward => [reward.key, reward.weight]));
  for (let i = 1; i < order.length; i++) assert.ok(weights[order[i - 1]] > weights[order[i]]);
  const total = definition.rewards.reduce((sum, reward) => sum + reward.weight, 0);
  assert.ok(Math.abs(definition.rewards.reduce((sum, reward) => sum + reward.weight / total * 100, 0) - 100) < 1e-10);
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source('src/store/petCatalog.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const server = source('../Server/server.js');
  const artwork = source('src/components/PetArtwork.tsx');
  const particles = source('src/utils/petParticles.ts');
  order.forEach((id, index) => {
    const pet = context.exports.PET_CATALOG.find(item => item.id === id);
    assert.ok(pet, id);
    assert.equal(pet.rarity, rarities[index]);
    assert.deepEqual([...pet.caseIds], ['case-pets-mythical']);
    assert.ok(server.includes(`'${id}': { name: '${pet.name}', rarity: '${rarities[index]}', cases: ['case-pets-mythical'] }`), `сервер: ${id}`);
    assert.ok(artwork.includes(`case '${id}': return <`), `арт: ${id}`);
    assert.ok(particles.includes(`'${id}':`), `частицы: ${id}`);
  });
});

test('profile pets peek at 45 degrees independently of the entrance and sway animations', () => {
  for (const file of ['src/pages/ProfilePage.tsx', 'src/components/UserProfileModal.tsx']) {
    const content = source(file);
    assert.match(content, /<Box sx=\{\{ transform: 'rotate\(-45deg\)', transformOrigin: 'center' \}\}>\s*<PetArtwork/);
    assert.ok(content.includes("transform: 'translateY(-50%)'"));
    assert.ok(content.includes("animation: 'veraPetPeekIn .7s ease both, veraPetPeekSway 4s ease-in-out .7s infinite'"));
    assert.ok(content.includes("'@media (prefers-reduced-motion: reduce)': { animation: 'none' }"));
  }
  assert.match(source('src/pages/MainLayout.tsx'), /petDock === 'right' \? -45/);
});

test('pet artwork keeps its glow visible and uses painted artwork as its hit area', () => {
  const artwork = source('src/components/PetArtwork.tsx');
  assert.match(artwork, /overflow: 'visible'.*color: pet\.color/);
  assert.match(artwork, /style=\{\{ overflow: 'visible', pointerEvents: 'visiblePainted' \}\}/);
});

test('overlay has no hide control and bunny has a single pair of eyes', () => {
  const overlay = source('src/pages/MainLayout.tsx');
  assert.ok(!overlay.includes('petHidden'));
  assert.ok(!overlay.includes('Скрыть питомца'));
  // Снять питомца можно только кнопкой в профиле («Питомцы»), не на самом экране.
  const profile = source('src/pages/ProfilePage.tsx');
  assert.ok(profile.includes('equipPet(active ? null : id)'));
  assert.ok(profile.includes("{active ? 'Снять' : 'Надеть'}"));
  const artwork = source('src/components/PetArtwork.tsx');
  const bunny = artwork.slice(artwork.indexOf('function BunnyArt'), artwork.indexOf('function PhoenixArt'));
  assert.equal((bunny.match(/className="vera-pet-blink"/g) || []).length, 1);
  assert.ok(bunny.includes('cx="49" cy="56"'));
  assert.ok(bunny.includes('cx="71" cy="56"'));
});

function loadPetStore(petsApi) {
  const create = fn => {
    const state = {};
    const set = patch => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    const get = () => state;
    Object.assign(state, fn(set, get));
    const hook = () => state;
    hook.getState = get;
    hook.setState = set;
    hook.getInitialState = () => state;
    return hook;
  };
  const context = {
    exports: {},
    require: name => name === 'zustand' ? { create }
      : name.endsWith('storeSyncSimple') ? { registerAccountStore() {} }
      : name.endsWith('services/api') ? { petsApi }
      : { findPet: id => ({ id }) },
  };
  vm.runInNewContext(ts.transpileModule(source('src/store/petStore.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports.usePetStore;
}

test('pet store hydrates duplicate counts and keeps them across equip and settings updates', async () => {
  const petsApi = {
    get: async () => ({
      data: {
        ownedPets: ['pet-cat', 'pet-fox'],
        petCounts: { 'pet-cat': 3 },
        equippedPet: { id: 'pet-cat', settings: { x: 78, y: 76, size: 72, name: 'Мурка', font: 'Georgia, serif' } },
      },
    }),
    setEquipment: async (id, settings) => ({
      data: {
        ownedPets: ['pet-cat', 'pet-fox'],
        petCounts: { 'pet-cat': 3, 'pet-fox': 1 },
        equippedPet: { id, settings: { x: 78, y: 76, size: 72, name: '', font: 'inherit', ...(settings || {}) } },
      },
    }),
  };
  const store = loadPetStore(petsApi);
  await store.getState().load();
  assert.equal(store.getState().petCounts['pet-cat'], 3);
  assert.equal(store.getState().equippedPet.settings.name, 'Мурка');
  await store.getState().equip('pet-fox');
  assert.equal(store.getState().equippedPet.id, 'pet-fox');
  assert.equal(store.getState().petCounts['pet-cat'], 3, 'счётчики не теряются при смене питомца');
  await store.getState().updateSettings({ name: 'Лиса' });
  assert.equal(store.getState().equippedPet.settings.name, 'Лиса');
  assert.equal(store.getState().petCounts['pet-fox'], 1);
});

test('store inventory, drop results and profile show real duplicate counts', () => {
  const store = source('src/components/Store.tsx');
  assert.match(store, /count: pets\.petCounts\?\.\[p\.id\] \|\| 1/);
  assert.match(store, /count: packCountOf\(i\.id\)/);
  assert.match(store, /loot\.packs\[`pack-\$\{key\}`\]/);
  assert.ok(store.includes('row.count} шт.'), 'строка инвентаря показывает количество');
  assert.ok(store.includes('· ×${loot.packs[drop.id]}'), 'результат пака показывает копии');
  assert.match(store, /pets\.petCounts\?\.\[petDrop\]/, 'результат питомца показывает копии');
  assert.match(source('src/pages/ProfilePage.tsx'), /×\{petCounts\[id\]\} шт\./);
  assert.ok(source('src/App.tsx').includes('petCounts: data.petCounts || {}'));
});

test('server persists per-pet settings and counts case duplicates', () => {
  const server = source('../Server/server.js');
  assert.ok(server.includes('user.petSettings = savedPetSettings'), 'настройки каждого питомца сохраняются');
  assert.ok(server.includes('savedPetSettings[outgoing.id] = outgoing.settings'), 'смена питомца не теряет настройки');
  assert.ok(server.includes('user.petCounts = { ...user.petCounts, [key]: previous + 1 }'), 'дубликат кейса идёт в счётчик');
});

// ─── Размер питомца: жалоба «при сохранении спадает до минимума» ──────────────
// Причины были две: (1) getMaxPetSize брал visualViewport, который до первой
// раскладки окна (старт Electron) отдаёт ноль — предел схлопывался до 1 px и
// поле размера зажималось в [1..1]; (2) Number('') === 0 проходил проверку
// isFinite, и пустое поле сохраняло серверный минимум 36.

function loadMaxPetSize(windowObj) {
  const context = { exports: {}, window: windowObj, require: () => ({ useEffect: () => {}, useState: (v) => [typeof v === 'function' ? v() : v, () => {}] }) };
  vm.runInNewContext(ts.transpileModule(source('src/hooks/useMaxPetSize.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}

test('max pet size never collapses below the server minimum', () => {
  // До раскладки окна visualViewport может быть нулевым — раньше это давало 1 px.
  const early = loadMaxPetSize({ visualViewport: { width: 0, height: 0 }, innerWidth: 1920, innerHeight: 1080 });
  assert.ok(early.getMaxPetSize() >= 36, 'нулевой visualViewport не роняет предел ниже минимума');
  // Обычный десктоп:⅕ меньшей стороны.
  const desktop = loadMaxPetSize({ visualViewport: { width: 1920, height: 1080 }, innerWidth: 1920, innerHeight: 1080 });
  assert.equal(desktop.getMaxPetSize(), 216, 'предел — пятая часть меньшей стороны');
  // Мультимониторная область больше одного окна — берём меньшую сторону.
  const wide = loadMaxPetSize({ visualViewport: { width: 3840, height: 900 }, innerWidth: 3840, innerHeight: 900 });
  assert.equal(wide.getMaxPetSize(), 180, 'меньшая сторона побеждает');
  // Без visualViewport вовсе — window-метрики.
  const legacy = loadMaxPetSize({ innerWidth: 800, innerHeight: 600 });
  assert.equal(legacy.getMaxPetSize(), 120, 'fallback на innerWidth/innerHeight');
});

test('profile size field never commits zero or below-minimum values', () => {
  const profile = source('src/pages/ProfilePage.tsx');
  // Пустое поле трактуется как мусор, а не как ноль (иначе — серверный минимум).
  assert.match(profile, /const trimmed = String\(value \?\? ''\)\.trim\(\);/);
  assert.match(profile, /const parsed = trimmed === '' \? NaN : Number\(trimmed\);/);
  // Нижняя граница — серверный минимум, а не maxPetSize (который мог схлопнуться).
  assert.match(profile, /Math\.max\(MIN_PET_SIZE, Math\.min\(maxPetSize, parsed\)\)/);
  assert.ok(profile.includes("from '../hooks/useMaxPetSize'"), 'константа минимума импортирована из хука');
});