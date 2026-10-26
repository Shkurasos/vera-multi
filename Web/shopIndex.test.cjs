const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { create } = require('zustand');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const shopSource = read('src/store/shopStore.ts');
const bubble = read('src/components/MessageBubble.tsx');

// Execute the real catalog generation and lookup. Rebuilding a test-only index
// from the static array hid missing generated skins in the production index.
const cache = new Map();
let updateProfile;
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, {
    exports, console,
    require: name => {
      if (name === 'zustand') return { create };
      if (name === 'zustand/middleware') return { persist: fn => fn };
      if (!name.startsWith('.')) return require(name);
      if (name.endsWith('/services/api')) return { usersApi: { update: data => updateProfile(data) } };
      if (name.endsWith('storeSyncSimple')) return { enableStoreSync() {} };
      if (name.endsWith('authStore')) return { useAuthStore: { getState: () => ({ user: null }) } };
      return load(path.resolve(path.dirname(file), `${name}.ts`));
    },
  });
  return exports;
}
const { SHOP_CATALOG: catalog, findShopItem, useShopStore, selectShopItem } = load(path.join(__dirname, 'src/store/shopStore.ts'));

test('all collectible skins are recognized by the server and survive profile save/reload', () => {
  const server = read('../Server/server.js');
  const validationStart = server.indexOf('const RARITY_IDS =');
  const validationEnd = server.indexOf('// Питомцы хранятся отдельно', validationStart);
  assert.ok(validationStart >= 0 && validationEnd > validationStart);
  const isKnownSkinId = vm.runInNewContext(
    `${server.slice(validationStart, validationEnd)}\nisKnownSkinId;`,
    // Сервер берёт ключи паков из общего каталога кейсов.
    { require: id => require(path.resolve(__dirname, '../Server', id)) },
  );
  const routeStart = server.indexOf("app.patch('/api/users/me',");
  const routeEnd = server.indexOf('// GET /api/users/:id/customization', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  let handler;
  let saved;
  const db = { users: [{ id: 'skin-test' }] };
  vm.runInNewContext(server.slice(routeStart, routeEnd), {
    app: { patch: (_path, _auth, callback) => { handler = callback; } },
    authMiddleware() {}, db,
    saveDb: () => { saved = JSON.stringify(db); },
    withDevFlag: (_req, user) => user,
    publishEquipment() {},
  });
  updateProfile = body => {
    let response;
    handler({ userId: 'skin-test', body }, {
      status: code => { throw new Error(`Profile update rejected: ${code}`); },
      json: data => { response = data; },
    });
    return Promise.resolve({ data: response });
  };
  const slots = { avatarRing: 'activeRing', selfCard: 'activeSelfCard', bubbleStyle: 'activeBubble' };
  for (const item of catalog) {
    const slot = slots[item.applyKey];
    if (!slot) continue;
    if (!item.stock) assert.equal(isKnownSkinId(item.id), true, item.id);
    useShopStore.getState().resetForAccount();
    if (!item.stock) {
      saved = undefined;
      selectShopItem(item.id);
      assert.equal(saved, undefined, `unowned ${item.id}`);
    }
    useShopStore.getState().mergeOwned([item.id]);
    selectShopItem(item.id);
    const expected = item.stock ? '' : item.id;
    assert.equal(JSON.parse(saved).users[0][slot], expected, item.id);
    db.users = JSON.parse(saved).users;
    useShopStore.getState().resetForAccount();
    useShopStore.getState().hydrateEquipment(db.users[0]);
    useShopStore.getState().mergeOwned([item.id]);
    assert.equal(useShopStore.getState()[slot], expected, item.id);
    if (expected) assert.equal(findShopItem(item.applyKey, expected), item);
    selectShopItem(item.id);
    assert.equal(JSON.parse(saved).users[0][slot], '', `clear ${item.id}`);
  }
});

// ── Индекс даёт тот же ответ, что и перебор каталога ────────────────────────

test('поиск по индексу совпадает с перебором каталога на всех предметах', () => {
  assert.ok(catalog.length > 20, 'каталог не пуст');
  for (const key of ['avatarRing', 'selfCard', 'bubbleStyle']) {
    for (const item of catalog.filter(i => i.applyKey === key)) {
      assert.equal(findShopItem(key, item.id), item, `${key}/${item.id}`);
    }
  }
});

test('неизвестный предмет не находится, как и раньше', () => {
  assert.equal(findShopItem('avatarRing', 'не-существует'), undefined);
  assert.equal(findShopItem('avatarRing', ''), undefined);
  assert.equal(findShopItem('avatarRing', undefined), undefined);
  assert.equal(findShopItem('avatarRing', null), undefined);
});

test('скины редкостей и тематических паков находятся во всех трёх слотах', () => {
  for (const [key, ids] of [
    ['avatarRing', ['ring-r-legendary', 'ring-pack-games-dragon']],
    ['selfCard', ['selfcard-r-legendary', 'selfcard-pack-games-dragon']],
    ['bubbleStyle', ['bubble-r-legendary', 'bubble-games-dragon']],
  ]) {
    for (const id of ids) assert.equal(findShopItem(key, id)?.id, id);
  }
});

test('одинаковые id у РАЗНЫХ applyKey не путаются между собой', () => {
  // applyKey входит в ключ намеренно: иначе предмет одного типа выдавался бы
  // за предмет другого с тем же id, и на пузыре встал бы чужой стиль.
  const ids = catalog.map(i => i.id);
  for (const id of ids) {
    const hits = ['avatarRing', 'selfCard', 'bubbleStyle']
      .map(k => findShopItem(k, id))
      .filter(Boolean);
    assert.ok(hits.length <= 1 || new Set(hits).size === hits.length, `id=${id}`);
  }
});

test('в каталоге нет двух предметов с одинаковой парой applyKey+id', () => {
  // Иначе индекс потерял бы предмет молча, без всякой ошибки.
  const seen = new Set();
  for (const item of catalog) {
    const key = `${item.applyKey}|${item.id}`;
    assert.ok(!seen.has(key), `дубль ключа: ${key}`);
    seen.add(key);
  }
});

// ── Горячий путь пользуется индексом, а не перебором ───────────────────────

test('пузырь ищет предметы по индексу, а не перебором каталога', () => {
  const finds = (bubble.match(/SHOP_CATALOG\.find\(/g) || []).length;
  assert.equal(finds, 0, 'линейных поисков по каталогу в пузыре быть не должно');
  // Все четыре места, что раньше искали перебором, идут через индекс.
  for (const key of ['avatarRing', 'selfCard', 'bubbleStyle']) {
    assert.ok(bubble.includes(`findShopItem('${key}'`), `index used for ${key}`);
  }
});

test('индекс в сторе строится один раз, а не на каждый вызов', () => {
  assert.ok(/const SHOP_ITEM_INDEX: Map<string, ShopItem> = new Map\(/.test(shopSource), 'карта');
  assert.ok(/SHOP_CATALOG\.map\(item =>/.test(shopSource), 'строится из каталога один раз');
});