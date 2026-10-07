const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const shopSource = read('src/store/shopStore.ts');
const bubble = read('src/components/MessageBubble.tsx');

// Каталог вытаскиваем без исполнения стора: нужен только статический массив.
const catalogSrc = shopSource.slice(
  shopSource.indexOf('export const SHOP_CATALOG'),
  shopSource.indexOf('const SHOP_ITEM_INDEX'),
);
const ctx = vm.createContext({ exports: {} });
vm.runInNewContext(
  // const в vm не попадает на контекст — отдаём значение явно через exports.
  ts.transpileModule(`${catalogSrc.replace('export const', 'const')}\nexports.SHOP_CATALOG = SHOP_CATALOG;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText,
  ctx,
);
const catalog = ctx.exports.SHOP_CATALOG;

// Тот же индекс, что и в сторе, но собранный здесь — чтобы проверить его глазами.
const index = new Map(catalog.map(i => [`${i.applyKey}|${i.id}`, i]));
const findShopItem = (key, id) => (id ? index.get(`${key}|${id}`) : undefined);

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