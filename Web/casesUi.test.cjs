const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ── Кейсы: понятные «Шаг 1 · покупка» / «Шаг 2 · открытие» с выразительными CTA ──
test('диалог кейса разбит на два явных шага с градиентными кнопками', () => {
  const store = read('src/components/Store.tsx');
  assert.ok(store.includes('Шаг 1 · Покупка'), 'шаг 1 — покупка подписан');
  assert.ok(store.includes('Шаг 2 · Открытие'), 'шаг 2 — открытие подписан');
  assert.ok(store.includes('linear-gradient(135deg'), 'CTA-кнопки залиты градиентом');
  assert.ok(store.includes('ваш баланс'), 'показан баланс рядом с покупкой');
  assert.ok(store.includes('В инвентаре:'), 'показано количество кейсов перед открытием');
  assert.ok(store.includes('Не хватает ${Number(selectedPrice) - shop.balanceVp} ВП'), 'причина блокировки покупки — конкретная');
  assert.ok(store.includes('Нет кейсов — купите выше'), 'кнопка открытия без кейсов ведёт к покупке');
  // isHiddenCase обязан остаться: скрытый кейс не продаётся (pets.test.cjs).
  assert.ok(store.includes('isHiddenCase(selectedCase)'), 'скрытый кейс по-прежнему обрабатывается');
});

test('кнопка покупки кейса в маркете тоже выразительная', () => {
  const store = read('src/components/Store.tsx');
  assert.ok(store.includes('variant="contained" disabled={busy || !priced'), 'маркет: contained-кнопка');
  assert.ok(store.includes('`Купить за ${price} ВП`'), 'маркет: полная подпись с ценой');
});

// ── Чат: колесо над строкой ввода и пустыми обоями прокручивает ленту ──
test('колесо над хромом чата пересылается в ленту сообщений', () => {
  const win = read('src/components/ChatWindow.tsx');
  assert.ok(win.includes('forwardWheelToMessages'), 'обработчик есть');
  assert.ok(win.includes('onWheel={forwardWheelToMessages}'), 'обработчик привязан к колонке чата');
  assert.ok(win.includes('container.contains(target)'), 'сама лента скроллится штатно, без двойного пересчёта');
  assert.ok(win.includes('contenteditable'), 'поля ввода не перехватываются');
});

test('колесо в диалогах/меню (порталы) не крутит ленту под ними', () => {
  const win = read('src/components/ChatWindow.tsx');
  const start = win.indexOf('const forwardWheelToMessages');
  assert.ok(start > 0, 'обработчик есть');
  const body = win.slice(start, win.indexOf('const scrollToBottom', start));
  assert.ok(body.includes('if (!e.currentTarget.contains(target)) return;'), 'события из порталов отсекаются');
  // Отсечение должно идти до сдвига scrollTop.
  assert.ok(body.indexOf('e.currentTarget.contains(target)') < body.indexOf('container.scrollTop +='), 'проверка раньше прокрутки');
});
