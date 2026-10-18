const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ── Производительность инвентаря/площадки при большом числе предметов ──
test('сетка магазина: memo-карточки, кэш каталога и постепенный рендер', () => {
  const store = read('src/components/Store.tsx');
  assert.match(store, /const StoreCard = memo\(function StoreCard/, 'карточка вынесена в memo-компонент');
  assert.match(store, /const Preview = memo\(/, 'превью мемоизировано');
  assert.match(store, /const CaseArt = memo\(/, 'арт кейса мемоизирован');
  assert.ok(store.includes('const infoCache = new Map'), 'info() по id кэшируется');
  assert.ok(store.includes('const SHOP_BY_ID = new Map'), 'поиск по каталогу — через Map, а не find');
  assert.ok(!/const info = \(id: string\) => \{ const item = SHOP_CATALOG\.find/.test(store), 'старый линейный info() удалён');
  assert.match(store, /const rows = useMemo/, 'строки мемоизированы');
  assert.match(store, /const visible = useMemo/, 'фильтр/сортировка мемоизированы');
  assert.ok(store.includes('useDeferredValue(query)'), 'поиск не блокирует ввод');
  assert.ok(store.includes('IntersectionObserver'), 'карточки дорисовываются при прокрутке');
  assert.ok(store.includes('shown.map(row =>'), 'рендерится только видимая порция');
  assert.ok(store.includes("contentVisibility: 'auto'"), 'внеэкранные карточки не рисуются');
  assert.ok(store.includes('animate={false}'), 'питомцы в сетке без анимаций');
  assert.ok(store.includes('useThemeStore(s => s.theme)'), 'узкая подписка на тему');
});

test('опрос маркета/кошелька не меняет стор без реальных изменений', () => {
  const shop = read('src/store/shopStore.ts');
  assert.ok(shop.includes('if (sameListings(get().marketListings, data.listings)) return;'), 'одинаковые листинги не перезаписываются');
  assert.match(shop, /freshKeys\.every\(id => s\.owned\[id\]\) \? s\.owned : fresh/, 'тот же owned сохраняет ссылку');
});
