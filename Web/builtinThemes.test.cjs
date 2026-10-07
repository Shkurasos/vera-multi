/**
 * Каталог встроенных тем: сборка (заводские → правки → удалённые → новые)
 * и признак неопубликованных правок.
 *
 * Первое важно всем пользователям (встроенные темы общие), второе — только
 * админу: «Применить для всех» должно гаснуть после публикации, а не гореть
 * вечно из-за уже применённых правок.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/themeStore.ts'), 'utf8');
const context = vm.createContext({
  console, exports: {}, module: { exports: {} },
  window: { location: {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  require: (name) => {
    if (name === 'zustand') return { create: () => (factory) => factory(() => {}, () => ({})) };
    if (name === 'zustand/middleware') return { persist: (factory) => factory, createJSONStorage: (get) => get() };
    if (name.includes('storeSyncSimple')) return { enableStoreSync: () => {} };
    if (name === './themePresets') return { themePreset: () => undefined };
    return {};
  },
});
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);
const {
  THEMES, buildBuiltinCatalog, normalizeBuiltinCatalog, builtinCatalogsEqual, builtinCatalogDirty,
} = context.exports;

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const first = THEMES[0];
const last = THEMES[THEMES.length - 1];

// ── Сборка каталога ────────────────────────────────────────────────────────────

test('без правок каталог — это заводские темы', () => {
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog(undefined));
  assert.equal(built.length, THEMES.length);
  assert.deepEqual(built.map((t) => t.id), THEMES.map((t) => t.id));
});

test('правка админа заменяет заводскую тему, а не добавляет дубль', () => {
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog({
    overrides: { [String(first.id)]: { ...first, name: 'Правленная' } },
  }));
  assert.equal(built.length, THEMES.length, 'столько же тем, id не задвоились');
  assert.equal(built.find((t) => t.id === first.id).name, 'Правленная');
});

test('удалённая тема исчезает из каталога у всех', () => {
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog({ removed: [last.id] }));
  assert.ok(!built.some((t) => t.id === last.id), 'темы нет в списке');
  assert.equal(built.length, THEMES.length - 1);
});

test('удаление перекрывает правку той же темы', () => {
  // Админ удалил тему и раньше правил её: показать её правку уже нельзя.
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog({
    overrides: { [String(last.id)]: { ...last, name: 'Правленная' } },
    removed: [last.id],
  }));
  assert.ok(!built.some((t) => t.id === last.id), 'удаление сильнее правки');
});

test('добавленные стоковые темы идут в конец и не пересекаются с заводскими', () => {
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog({
    added: [{ id: 500, name: 'Новая стоковая', bg: '#111', accent: '#0f0' }],
  }));
  assert.equal(built.length, THEMES.length + 1);
  assert.equal(built[built.length - 1].id, 500);
  assert.equal(new Set(built.map((t) => t.id)).size, built.length, 'id уникальны');
});

test('добавленная тема с id заводской не двоит каталог', () => {
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog({
    added: [{ ...first, name: 'Подмена' }],
  }));
  assert.equal(built.length, THEMES.length, 'id не продублирован');
  assert.ok(!built.some((t) => t.name === 'Подмена'), 'заводская тема не вытеснена');
});

test('все секции применяются вместе', () => {
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog({
    overrides: { [String(first.id)]: { ...first, name: 'Правленная' } },
    removed: [last.id],
    added: [{ id: 501, name: 'Добавленная' }],
  }));
  assert.equal(built.length, THEMES.length, 'одна правка, одно удаление, одно добавление');
  assert.equal(built.find((t) => t.id === first.id).name, 'Правленная');
  assert.ok(!built.some((t) => t.id === last.id));
  assert.ok(built.some((t) => t.id === 501));
});

test('мусор в каталоге не ломает сборку', () => {
  const built = buildBuiltinCatalog(normalizeBuiltinCatalog({
    overrides: { abc: { id: 1 }, '-4': { id: -4 }, ok: first },
    removed: [NaN, 'x'],
    added: [null, 'строка'],
  }));
  assert.equal(built.length, THEMES.length, 'битый ключ/NaN/не тема — выброшены');
  assert.equal(new Set(built.map((t) => t.id)).size, built.length);
});
// ── Ожидание публикации ────────────────────────────────────────────────────────

const catalog = (over = {}) => normalizeBuiltinCatalog({
  overrides: {}, removed: [], added: [], ...over,
});

test('одинаковые каталоги считаются равными', () => {
  assert.ok(builtinCatalogsEqual(catalog(), catalog()));
  // Порядок в removed не важен: список приходит с сервера в чужом порядке.
  assert.ok(builtinCatalogsEqual(catalog({ removed: [3, 1] }), catalog({ removed: [1, 3] })));
});

test('разные updatedAt не делают каталог «грязным»', () => {
  // Сервер проставляет updatedAt при каждой публикации: свежая загрузка
  // каталога не должна выглядеть как неопубликованная правка.
  const b = normalizeBuiltinCatalog({ overrides: {}, removed: [], added: [], updatedAt: '2026-01-01T00:00:00.000Z' });
  assert.ok(builtinCatalogsEqual(catalog(), b));
  assert.equal(builtinCatalogDirty(catalog(), b), false);
});

test('после публикации правок кнопка «Применить для всех» гаснет', () => {
  // Главный баг: после публикации каталог остаётся непустым (правки лежат в
  // overrides/removed/added), поэтому проверка «есть записи» вечно показывала
  // неопубликованные изменения и держала админа в состоянии «есть что отправить».
  const published = catalog({ overrides: { 0: first }, removed: [29], added: [{ id: 500 }] });
  assert.equal(builtinCatalogDirty(published, published), false);
});

test('новая правка поверх опубликованной снова считается ожидающей', () => {
  const published = catalog({ overrides: { 0: first } });
  const edited = catalog({ overrides: { 0: { ...first, name: 'Ещё правка' } } });
  assert.equal(builtinCatalogDirty(edited, published), true);
});

test('удаление темы ждёт публикации — в обе стороны', () => {
  const published = catalog();
  assert.equal(builtinCatalogDirty(catalog({ removed: [29] }), published), true);
  assert.equal(builtinCatalogDirty(published, catalog({ removed: [29] })), true, 'и возврат темы тоже правка');
});

test('добавленная тема ждёт публикации', () => {
  const published = catalog();
  assert.equal(builtinCatalogDirty(catalog({ added: [{ id: 500 }] }), published), true);
});

test('без серверного эталона пустой каталог не выглядит ожидающим', () => {
  assert.equal(builtinCatalogDirty(catalog(), null), false, 'нечего публиковать');
  assert.equal(builtinCatalogDirty(catalog({ added: [{ id: 500 }] }), null), true, 'есть что публиковать');
});

test('повторная загрузка того же каталога не создаёт «грязных» правок', () => {
  // Сервер вправе вернуть те же данные (например, после реконнекта): это не правка.
  const fromServer = catalog({ overrides: { 0: first } });
  assert.equal(builtinCatalogDirty(fromServer, fromServer), false);
});
// ── Прокрутка полноэкранных страниц ────────────────────────────────────────────

test('страница под Routes скроллится сама: документ в приложении не скроллится', () => {
  // Приложение построено как Telegram: в main.tsx body и #root стоят на
  // overflow: hidden, и MainLayout оборачивает <Routes> в overflow: hidden.
  // Документ прокрутить нельзя физически, поэтому каждая страница обязана
  // поставить overflowY: auto на свой корневой Box. Без этого длинная
  // страница (админка с каталогом тем) просто обрезается по высоте экрана.
  const main = read('src/main.tsx');
  const layout = read('src/pages/MainLayout.tsx');
  assert.match(
    main, /body: \{[\s\S]{0,200}overflowY: 'hidden'/,
    'body не скроллится — значит скроллить должна страница',
  );
  assert.match(
    layout, /<Box sx=\{\{ flex: 1, overflow: 'hidden', minHeight: 0, height: '100%' \}\}>/,
    'обёртка Routes режет overflow',
  );

  // Теперь проверяем, что обе страницы под Routes это компенсируют.
  for (const file of ['src/pages/AdminToolsPage.tsx', 'src/pages/BotFatherPage.tsx']) {
    const src = read(file);
    assert.match(
      src, /<Box sx=\{\{[\s\S]{0,200}overflowY: 'auto'/,
      `${file}: корневой Box должен скроллиться`,
    );
    assert.match(src, /height: '100%'/, `${file}: нужен height, иначе auto-скролл не ограничен`);
  }
});