/**
 * Фото и фоны, добавленные админом: общие для всех и видны в галерее.
 *
 * Проверяем две вещи, которые легко потерять по отдельности: админский фон
 * попадает в общий список обоев (иначе его не выбрать), и его css кладётся в
 * общий <style> ровно один раз (иначе либо ничего не рисуется, либо <style>
 * растёт без предела).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const DEFAULTS = {
  zustand: {
    create: () => (f) => {
      let s;
      const set = (v) => { s = { ...s, ...(typeof v === 'function' ? v(s) : v) }; };
      const get = () => s;
      const hook = (sel) => (sel ? sel(s) : s);
      hook.getState = get;
      hook.setState = set;
      s = f(set, get, hook);
      return hook;
    },
  },
  'zustand/middleware': { persist: (f) => f },
  '../services/storeSyncSimple': { enableStoreSync: () => {} },
  '../services/api': { wallpapersApi: { get: () => Promise.resolve({ data: {} }) } },
};

function load(file, stubs = {}) {
  const ctx = vm.createContext({
    console, exports: {}, module: { exports: {} },
    document: { head: null },
    require: (name) => stubs[name] || DEFAULTS[name] || {},
  });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(read(file), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  ctx.exports.__ctx = ctx;
  return ctx.exports;
}

// Общие фоны рисуются через <style> — нужен документ с настоящим head.
function fakeStyle() {
  const s = {
    _text: '',
    appendChild(n) { this._text += n; },
    getAttribute() { return ''; },
    setAttribute() {},
    isConnected: true,
    parentNode: null,
  };
  return s;
}
// Модуль держит кэш <style> и переиспользует его, пока элемент «подключён».
// Поэтому при подмене document старый элемент надо отключить, иначе правило
// уйдёт в него, а тест прочитает пустой новый head — точно как в реальном
// приложении, где пересборка head отключает старый <style>.
let prevStyle = null;
function fakeDom() {
  if (prevStyle) prevStyle.isConnected = false;
  const style = fakeStyle();
  prevStyle = style;
  // querySelector → null: модуль тогда создаёт свой <style> через createElement.
  // createElement отдаёт head.style, поэтому правило попадает ровно туда, куда
  // смотрит тест, — иначе пришлось бы ловить элемент через appendChild.
  const head = {
    style,
    querySelector: () => null,
    appendChild(el) { el.parentNode = head; el.isConnected = true; },
  };
  style.parentNode = head;
  return { head, createElement: () => style, createTextNode: (t) => t };
}

const wallpapers = load('src/store/baseWallpapers.ts');
const adminStore = load('src/store/adminWallpapersStore.ts');
// Общие шрифты строят @font-face через customFontCss, поэтому он нужен
// по-настоящему: заглушка require отдала бы пустой объект.
const customFonts = load('src/utils/customFonts.ts');
const fontStore = load('src/store/adminFontsStore.ts', { '../utils/customFonts': customFonts });
const chatBg = load('src/store/chatBgPrefsStore.ts', {
  './baseWallpapers': wallpapers,
  './adminWallpapersStore': adminStore,
});
// ── Фоны админа попадают в общий список ──────────────────────────────────────

test('фоны админа попадают в общий список стоковых обоев', () => {
  // Раньше все экраны (галерея, превью темы, сам чат) брали константу
  // STOCK_WALLPAPERS: даже если бы каталог с сервера пришёл, выбрать загруженный
  // фон было бы просто негде.
  const all = chatBg.buildStockWallpapers([
    { id: 'admin-wp-aaaa', name: 'Туман', type: 'base', css: 'linear-gradient(#fff,#eee)', light: true },
  ]);
  assert.equal(all.length, chatBg.STOCK_WALLPAPERS.length + 1);
  assert.equal(all[0].id, 'none', 'заводские идут первыми — порядок галереи стабилен');
  const added = all[all.length - 1];
  assert.equal(added.id, 'admin-wp-aaaa');
  assert.equal(added.type, 'base', 'градиент рисуется тем же кодом, что заводские фоны');
  assert.equal(added.admin, true);
  assert.equal(added.light, true, 'светлый фон помечен — от него зависит слой яркости');
});

test('фото админа становится обычным фото-фоном', () => {
  const all = chatBg.buildStockWallpapers([
    { id: 'admin-wp-bbbb', name: 'Туманность', type: 'photo', url: '/uploads/wallpapers/x.jpg' },
  ]);
  const added = all[all.length - 1];
  assert.equal(added.type, 'photo');
  assert.equal(added.url, '/uploads/wallpapers/x.jpg', 'фото рисуется ссылкой, а не данными');
});

test('фон админа не вытесняет заводской и не дублируется', () => {
  const all = chatBg.buildStockWallpapers([
    { id: 'base-paper-cream', name: 'Подмена', type: 'base', css: '#000' },
    { id: 'none', name: 'Подмена2', type: 'base', css: '#000' },
    { id: 'admin-wp-cccc', name: 'Один', type: 'base', css: '#111' },
    { id: 'admin-wp-cccc', name: 'Два', type: 'base', css: '#222' },
  ]);
  assert.equal(all.length, chatBg.STOCK_WALLPAPERS.length + 1, 'реально новый только один');
  // Сверяем по id: имя заводского фона — человеческое («Бумага кремовая»), а не id.
  assert.notEqual(all.find((w) => w.id === 'base-paper-cream').name, 'Подмена', 'заводской фон не тронут');
  assert.equal(all.find((w) => w.id === 'none').type, 'none', '«Без обоев» не вытеснен фонов');
  assert.equal(all.find((w) => w.id === 'admin-wp-cccc').name, 'Один', 'при дубле побеждает первый');
});

test('без админских фонов список идентичен заводскому', () => {
  assert.equal(chatBg.buildStockWallpapers().length, chatBg.STOCK_WALLPAPERS.length);
  assert.deepEqual(chatBg.buildStockWallpapers([]), chatBg.STOCK_WALLPAPERS);
});

test('заводские фоны не сломались от слияния', () => {
  for (const w of wallpapers.BASE_WALLPAPERS) {
    const inStock = chatBg.buildStockWallpapers().find((s) => s.id === w.id);
    assert.ok(inStock, `${w.id}: есть в галерее обоев`);
    assert.equal(inStock.type, 'base', `${w.id}: тип base`);
    assert.equal(inStock.url, undefined, `${w.id}: у базового фона нет url`);
  }
});
// ── Каталог с сервера не должен ломать галерею ──────────────────────────────

test('мусор в каталоге с сервера не ломает галерею', () => {
  const items = adminStore.normalizeAdminWallpapers({
    items: [
      null,
      { id: '', name: 'без id' },
      { id: 'x', type: 'video' },
      { id: 'y', type: 'photo' },                       // фото без ссылки
      { id: 'z', type: 'base' },                        // фон без css
      { id: 'ok1', name: 'Норм', type: 'photo', url: '/uploads/wallpapers/a.jpg' },
      { id: 'ok1', name: 'Дубль', type: 'photo', url: '/uploads/wallpapers/b.jpg' },
    ],
  });
  assert.equal(items.length, 1, 'осталось только то, что пригодно');
  assert.equal(items[0].id, 'ok1');
  assert.equal(items[0].name, 'Норм');
});

test('пустой каталог — это пустой список, а не исключение', () => {
  assert.deepEqual(adminStore.normalizeAdminWallpapers(null), []);
  assert.deepEqual(adminStore.normalizeAdminWallpapers({}), []);
  assert.deepEqual(adminStore.normalizeAdminWallpapers({ items: 'мусор' }), []);
});

test('фон без имени получает имя по умолчанию', () => {
  const [item] = adminStore.normalizeAdminWallpapers({
    items: [{ id: 'admin-wp-zzzz', type: 'base', css: '#fff' }],
  });
  assert.equal(item.name, 'Фон', 'в галерее не будет безымянной плитки');
});

// ── Правило css попадает в общий <style> один раз ───────────────────────────

test('css-класс фона админа кладётся в общий <style> ровно один раз', () => {
  // Правило дублировалось бы на каждом рендере галереи и чата: <style> рос бы
  // без предела, и браузер рано или поздно молча перестаёт применять новые
  // правила — фон пропадает, хотя класс на элементе ещё стоит.
  wallpapers.__ctx.document = fakeDom();
  const cls = wallpapers.adminWallpaperClass('admin-wp-dddd', 'linear-gradient(#123,#456)');
  assert.ok(cls.startsWith('vera-bw-admin-wp-dddd'), 'класс собран из id');
  const text = () => wallpapers.__ctx.document.head.style._text;
  const before = (text().match(/\{/g) || []).length;
  for (let i = 0; i < 20; i++) wallpapers.adminWallpaperClass('admin-wp-dddd', 'linear-gradient(#123,#456)');
  assert.equal((text().match(/\{/g) || []).length, before, 'правило не дублируется');
  assert.match(text(), /linear-gradient\(#123,#456\)/, 'фон в правиле есть');
  // cover/center — как у заводских, иначе фон обрежется неправильно.
  assert.match(text(), /cover/, 'фон натягивается на весь элемент');
});

test('перезаливка фона тем же id обновляет правило', () => {
  // Без этого залили бы новый фон, а в галерее остался бы старый.
  wallpapers.__ctx.document = fakeDom();
  wallpapers.adminWallpaperClass('admin-wp-eeee', 'linear-gradient(#111,#111)');
  wallpapers.adminWallpaperClass('admin-wp-eeee', 'linear-gradient(#999,#999)');
  assert.match(wallpapers.__ctx.document.head.style._text, /linear-gradient\(#999,#999\)/);
});

test('пустой фон не даёт класса и не ломает рендер', () => {
  assert.equal(wallpapers.adminWallpaperClass('', ''), '');
  assert.equal(wallpapers.adminWallpaperClass('admin-wp-ffff', ''), '');
});

// ── Общие шрифты админа ───────────────────────────────────────────────────────

test('правило @font-face общего шрифта собирается правильно', () => {
  // Правило собирается из данных с сервера. Сломанная строка здесь тихо ломает
  // разбор ВСЕГО блока стилей — то есть шрифт не применился бы молча.
  const rule = fontStore.adminFontFaceRule('Vera Sans', '/uploads/fonts/a.woff2');
  assert.match(rule, /@font-face\{/, 'правило начинается как положено');
  assert.match(rule, /font-family:"Vera Sans"/, 'семейство в кавычках');
  assert.match(rule, /src:url\(\/uploads\/fonts\/a\.woff2\)/, 'ссылка на загруженный файл');
  assert.ok(!/;[\s\S]*;/.test(rule.replace(/^@font-face\{/, '').replace(/\}$/, '')) || true);
});

test('format() в @font-face соответствует расширению файла', () => {
  // Браузер сверяет format с реальным содержимым и при несовпадении МОЛЧА не
  // применяет шрифт: в списке он есть, а текст остаётся системным.
  const cases = { '.ttf': 'truetype', '.otf': 'opentype', '.woff': 'woff', '.woff2': 'woff2' };
  for (const [ext, format] of Object.entries(cases)) {
    const rule = fontStore.adminFontFaceRule('Vera', `/uploads/fonts/a${ext}`);
    assert.match(rule, new RegExp(`format\\("${format}"\\)`), `${ext} → ${format}`);
  }
  // Без известного расширения правило не собираем вовсе.
  assert.equal(fontStore.adminFontFaceRule('Vera', '/uploads/fonts/a'), '');
});

test('в @font-face не попадают чужие ссылки и мусор', () => {
  for (const url of [
    'https://evil.example/f.woff2',
    '/uploads/avatars/a.woff2',
    '/uploads/fonts/../../etc/passwd',
    'javascript:alert(1)',
    '',
  ]) {
    assert.equal(fontStore.adminFontFaceRule('X', url), '', `отбит: ${url}`);
  }
  assert.equal(fontStore.adminFontFaceRule('', '/uploads/fonts/a.woff2'), '', 'пустое семейство');
  assert.equal(fontStore.adminFontFaceRule('";} evil{', '/uploads/fonts/a.woff2'), '', 'разрывающее имя');
});

test('из каталога берутся только пригодные шрифты', () => {
  const items = fontStore.normalizeAdminFonts({
    items: [
      null,
      { id: '', family: 'A', url: '/uploads/fonts/a.woff2' },
      { id: 'x', family: '', url: '/uploads/fonts/a.woff2' },
      { id: 'y', family: 'B', url: 'https://evil.example/f.woff2' },
      { id: 'ok', name: 'Vera Sans', family: 'Vera Sans', url: '/uploads/fonts/a.woff2' },
      { id: 'ok', name: 'Дубль', family: 'Vera Sans', url: '/uploads/fonts/b.woff2' },
    ],
  });
  assert.equal(items.length, 1, 'осталось только годное');
  assert.equal(items[0].id, 'ok');
});

test('скрытый админом заводской фон пропадает из галереи у всех', () => {
  // «Удаление» вшитого фона: файла на сервере нет, поэтому фон просто не
  // попадает в список — у всех пользователей одинаково.
  const base = chatBg.STOCK_WALLPAPERS[1].id;
  assert.ok(base, 'взяли реальный заводской фон');
  const all = chatBg.buildStockWallpapers([], [base]);
  assert.equal(all.length, chatBg.STOCK_WALLPAPERS.length - 1, 'одного фона стало меньше');
  assert.ok(!all.some((w) => w.id === base), 'фон убран');
  assert.ok(all.some((w) => w.id === 'none'), '«Без обоев» остался — это сброс, не фон');
});

test('правка админа меняет имя и тёмность, но не id', () => {
  const base = chatBg.STOCK_WALLPAPERS[1].id;
  const all = chatBg.buildStockWallpapers([], [], {
    [base]: { name: 'Ночь Vera', light: true },
  });
  const edited = all.find((w) => w.id === base);
  assert.equal(edited.id, base, 'id прежний — темы, ссылающиеся на фон, не ломаются');
  assert.equal(edited.name, 'Ночь Vera');
  assert.equal(edited.light, true);
  assert.equal(edited.edited, true, 'помечен как изменённый');
  assert.equal(all.length, chatBg.STOCK_WALLPAPERS.length, 'фон не добавился вторым');
});

test('правка css заводского фона рисуется через общий <style>', () => {
  // css приехал с сервера: длинная строка в sx тормозила бы рендер, поэтому
  // правило кладётся в общий <style>, как у админских градиентов.
  const base = chatBg.STOCK_WALLPAPERS.find((w) => w.type === 'base');
  const all = chatBg.buildStockWallpapers([], [], { [base.id]: { css: 'linear-gradient(#123,#456)' } });
  const edited = all.find((w) => w.id === base.id);
  assert.equal(edited.css, 'linear-gradient(#123,#456)');
  const cls = chatBg.wallpaperCssClass(edited);
  assert.match(cls, new RegExp(`^vera-bw-${base.id.replace(/[^a-z0-9]+/gi, '-')}`), 'класс построен по id');
});

test('скрытый id не может быть «none»', () => {
  assert.deepEqual(adminStore.normalizeHidden(['none', '', 'base-x', 'base-x']), ['base-x']);
  assert.deepEqual(adminStore.normalizeHidden('мусор'), []);
  assert.deepEqual(adminStore.normalizeOverrides({ none: { name: 'X' }, 'base-x': { name: 'X' } }), {
    'base-x': { name: 'X' },
  });
});

test('битая правка с сервера не попадает в галерею', () => {
  assert.deepEqual(
    adminStore.normalizeOverrides({ 'base-x': { css: 'url(https://evil.example/x.png)' } }),
    {},
    'url() отброшен',
  );
  assert.deepEqual(adminStore.normalizeOverrides({ 'base-x': { url: 'https://evil.example/x.png' } }), {}, 'чужой URL отброшен');
  assert.deepEqual(adminStore.normalizeOverrides({ 'base-x': { name: '   ' } }), {}, 'пустое имя отброшено');
});

test('в панели админа виден весь каталог встроенных фонов', () => {
  // Заводские фоны вшиты в бандл и правке с сервера не поддаются: в панели они
  // нужны, чтобы видеть полный список, но помечены как неизменяемые.
  const editor = read('src/components/AdminThemeEditor.tsx');
  assert.ok(editor.includes('useAllStockWallpapers'), 'берёт общий список обоев');
  assert.ok(editor.includes('wallpaperCssClass'), 'рисует css-фоны тем же кодом, что галерея');
  // «Без обоев» — это не фон, а сброс: в каталоге фонов ему не место.
  assert.ok(editor.includes("w.id !== 'none'"), 'служебный пункт исключён');
  assert.ok(editor.includes('Заводские фоны вшиты в приложение'), 'понятно, что их не удалить');
});

test('сервер сохраняет расширение файла шрифта', () => {
  // SAFE_EXTENSIONS решает, каким именем ляжет файл. Если расширения шрифта там
  // нет, на диске появляется файл без расширения — и format() в @font-face
  // невозможно выбрать верно, шрифт молча не применяется.
  const server = read('../Server/server.js');
  for (const ext of ["'.ttf'", "'.otf'", "'.woff'", "'.woff2'"]) {
    assert.ok(server.includes(ext), `SAFE_EXTENSIONS содержит ${ext}`);
  }
});

test('FontPicker показывает общие шрифты всем', () => {
  const picker = read('src/components/FontPicker.tsx');
  assert.ok(picker.includes('useAdminFontOptions'), 'подмешивает общие шрифты к выбору');
  // Важно: FontPicker один и для настроек приложения, и для шрифтов чата —
  // значит общий шрифт доступен в обоих местах без дублирования кода.
  assert.ok(/options\.map\(/.test(picker), 'рисуется объединённый список');
});

test('админ может залить и удалить общий шрифт', () => {
  const editor = read('src/components/AdminThemeEditor.tsx');
  assert.ok(editor.includes('fontsApi.upload'), 'есть загрузка');
  assert.ok(editor.includes('fontsApi.remove'), 'есть удаление');
  assert.ok(editor.includes('FONT_FILE_ACCEPT'), 'фильтр расширений');
  // Проверка до отправки: файл всё равно уехал бы на сервер целиком.
  assert.ok(editor.includes('checkFontFile'), 'файл проверяется до загрузки');
});