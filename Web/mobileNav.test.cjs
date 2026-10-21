const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** Загружает чистый TS-модуль без зависимостей. */
function load(rel) {
  const context = vm.createContext({ exports: {}, module: { exports: {} }, console });
  vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, rel), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}
const nav = load('src/utils/mobileNav.ts');
const plain = (v) => JSON.parse(JSON.stringify(v));

test('порядок по умолчанию: редактор, профиль, музыка, архив', () => {
  assert.deepEqual(plain(nav.DEFAULT_NAV_ORDER), ['editor', 'profile', 'music', 'archive']);
});

test('moveNavKey: соседи меняются местами', () => {
  assert.deepEqual(plain(nav.moveNavKey(['editor', 'profile', 'music', 'archive'], 'editor', 'profile')),
    ['profile', 'editor', 'music', 'archive']);
  assert.deepEqual(plain(nav.moveNavKey(['editor', 'profile', 'music', 'archive'], 'archive', 'music')),
    ['editor', 'profile', 'archive', 'music']);
});

test('moveNavKey: перенос через несколько кнопок сдвигает остальные', () => {
  assert.deepEqual(plain(nav.moveNavKey(['editor', 'profile', 'music', 'archive'], 'editor', 'archive')),
    ['profile', 'music', 'archive', 'editor']);
  assert.deepEqual(plain(nav.moveNavKey(['editor', 'profile', 'music', 'archive'], 'archive', 'editor')),
    ['archive', 'editor', 'profile', 'music']);
});

test('moveNavKey: на себя — без изменений, исходный массив не мутируется', () => {
  const order = ['music', 'editor', 'profile', 'archive'];
  assert.deepEqual(plain(nav.moveNavKey(order, 'music', 'music')), order);
  nav.moveNavKey(order, 'music', 'archive');
  assert.deepEqual(order, ['music', 'editor', 'profile', 'archive']);
});

test('normalizeNavOrder чинит испорченный сохранённый порядок', () => {
  assert.deepEqual(plain(nav.normalizeNavOrder(undefined)), ['editor', 'profile', 'music', 'archive']);
  assert.deepEqual(plain(nav.normalizeNavOrder('editor')), ['editor', 'profile', 'music', 'archive']);
  // Мусор и дубли выкидываются, недостающие кнопки дописываются в конец.
  assert.deepEqual(plain(nav.normalizeNavOrder(['archive', 'chats', 'archive', 42, 'music'])),
    ['archive', 'music', 'editor', 'profile']);
});

test('ПК: свой порядок по умолчанию, недостающие дописываются по нему', () => {
  assert.deepEqual(plain(nav.DEFAULT_DESKTOP_NAV_ORDER), ['profile', 'music', 'editor', 'archive']);
  assert.deepEqual(plain(nav.normalizeNavOrder(undefined, nav.DEFAULT_DESKTOP_NAV_ORDER)),
    ['profile', 'music', 'editor', 'archive']);
  assert.deepEqual(plain(nav.normalizeNavOrder(['archive'], nav.DEFAULT_DESKTOP_NAV_ORDER)),
    ['archive', 'profile', 'music', 'editor']);
});

test('ПК: кнопки сайдбара перетаскиваются мышкой и хранят свой порядок', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/components/SidebarNavButtons.tsx'), 'utf8');
  assert.ok(src.includes('desktopOrder'), 'порядок ПК отдельный от телефона');
  assert.ok(src.includes('DRAG_THRESHOLD_PX'), 'мышью перетаскивание начинается со сдвига');
  assert.ok(src.includes('.map(renderItem)'), 'кнопки рисуются циклом по порядку');
  const sidebar = fs.readFileSync(path.join(__dirname, 'src/components/Sidebar.tsx'), 'utf8');
  assert.ok(sidebar.includes('<SidebarNavButtons'), 'сайдбар использует перетаскиваемые кнопки');
  const store = fs.readFileSync(path.join(__dirname, 'src/store/mobileNavStore.ts'), 'utf8');
  assert.ok(store.includes('desktopOrder: s.desktopOrder'), 'порядок ПК сохраняется');
});

test('панель рисует кнопки по сохранённому порядку и ловит удержание', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/components/MobileBottomNav.tsx'), 'utf8');
  assert.ok(src.includes('useMobileNavStore'), 'порядок берётся из стора');
  assert.ok(src.includes('.map(renderItem)'), 'кнопки рисуются циклом по порядку');
  assert.ok(src.includes('LONG_PRESS_MS'), 'перестановка включается удержанием');
  assert.ok(src.includes("touchAction: 'none'"), 'браузер не перехватывает жест прокруткой');
  const store = fs.readFileSync(path.join(__dirname, 'src/store/mobileNavStore.ts'), 'utf8');
  assert.ok(store.includes("name: 'vera-mobile-nav'"), 'порядок переживает перезагрузку');
  assert.ok(store.includes('normalizeNavOrder'), 'сохранённое значение проверяется');
});
