const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ── Редизайн инвентаря/площадки: шапка с вкладками и балансом, плитки, витрина ──
test('шапка: вкладки-переключатель, баланс с раскрытием пополнения, крестик', () => {
  const store = read('src/components/Store.tsx');
  assert.ok(store.includes('role="tablist"') && store.includes('role="tab"'), 'разделы — доступные вкладки');
  assert.ok(store.includes('aria-selected={tab === t.id}'), 'выбранная вкладка помечена');
  assert.ok(store.includes('<Collapse in={topupOpen}'), 'пополнение скрыто под балансом, а не занимает экран');
  assert.ok(store.includes('aria-expanded={topupOpen}'), 'кнопка баланса сообщает состояние');
  assert.ok(store.includes('aria-label="Закрыть"'), 'закрытие — иконка с подписью для скринридера');
});

test('плитка предмета: полоса редкости, «Надето», счётчик и звезда избранного', () => {
  const store = read('src/components/Store.tsx');
  const card = store.slice(store.indexOf('const StoreCard = memo'), store.indexOf('export default function Store'));
  assert.ok(card.includes("'&::after'") && card.includes('bgcolor: tone'), 'полоса цвета редкости');
  assert.ok(card.includes('>Надето<'), 'надетый предмет отмечен');
  assert.ok(card.includes('{row.count} шт.'), 'количество копий на плитке');
  assert.ok(card.includes('<StarGlyph') && card.includes('aria-pressed={favorite}'), 'избранное — переключатель-звезда');
  assert.ok(card.includes('prefers-reduced-motion'), 'подъём при наведении отключается при reduced motion');
  assert.ok(!card.includes('Выставить на продажу'), 'продажа перенесена в витрину предмета');
});

test('витрина предмета: арт слева, описание и действия справа, продажа с расчётом выручки', () => {
  const store = read('src/components/Store.tsx');
  assert.ok(store.includes("gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 5fr) minmax(0, 6fr)' }"), 'две колонки');
  assert.ok(store.includes('Продать на площадке'), 'блок продажи');
  assert.ok(store.includes('Вы получите ${Math.floor(Number(salePrice) * 85 / 100)'), 'выручка с учётом комиссии');
  assert.ok(store.includes('Сбросить фильтры'), 'пустое состояние предлагает сбросить фильтры');
});