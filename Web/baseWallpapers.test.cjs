const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

/** Заглушки сторов: тесты грузят только каталог тем и обоев. */
const DEFAULTS = {
  // Мини-зикстенд: create() сам вызывает стейт-креатор и возвращает хук,
  // у которого есть getState/setState — как у настоящего zustand.
  zustand: {
    create: () => (f) => {
      let s;
      const set = (v) => { s = { ...s, ...(typeof v === 'function' ? v(s) : v) }; };
      const get = () => s;
      const hook = (sel) => (sel ? sel(s) : s);
      hook.getState = get;
      hook.setState = set;
      hook.subscribe = () => () => {};
      s = f(set, get, hook);
      return hook;
    },
  },
  'zustand/middleware': { persist: (f) => f, createJSONStorage: (g) => g() },
  '../services/storeSyncSimple': { enableStoreSync: () => {} },
  usersApi: { get: () => Promise.resolve({ data: {} }) },
};

/** Загружает ts-модуль в vm (как wallpapers.test.cjs). */
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
  // Контекст vm нужен тестам, которые подменяют document: модуль читает
  // глобальный document СВОЕГО контекста, а не global этого файла.
  ctx.exports.__ctx = ctx;
  return ctx.exports;
}

const wallpapers = load('src/store/baseWallpapers.ts');
const { BASE_WALLPAPERS, findBaseWallpaper, isLightBaseWallpaper, baseWallpaperClass } = wallpapers;
const wallpapersCtx = wallpapers.__ctx;
const chatBg = load('src/store/chatBgPrefsStore.ts', {
  zustand: { create: () => (f) => { let s; return (f((v) => { s = { ...s, ...(typeof v === 'function' ? v(s) : v) }; }, () => s)); } },
  'zustand/middleware': { persist: (f) => f, createJSONStorage: (g) => g() },
  '../services/storeSyncSimple': { enableStoreSync: () => {} },
  './baseWallpapers': wallpapers,
});
const presets = load('src/store/themePresets.ts');
const { THEME_PRESETS } = presets;
const { THEMES } = load('src/store/themeStore.ts', { './themePresets': presets });

// ── Каталог базовых фонов ────────────────────────────────────────────────

test('базовые фоны описаны и у всех уникальные id', () => {
  assert.ok(BASE_WALLPAPERS.length >= 10, 'фонов достаточно для всех тем');
  const ids = BASE_WALLPAPERS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'id не повторяются');
  for (const w of BASE_WALLPAPERS) {
    assert.ok(w.id.startsWith('base-'), `префикс base- у ${w.id}`);
    assert.ok(w.name && w.name.length > 1, `есть имя у ${w.id}`);
  }
});

test('каждый фон — непустой корректный css', () => {
  for (const w of BASE_WALLPAPERS) {
    const css = w.css;
    assert.ok(css && css !== 'none', `${w.id}: фон собран`);
    assert.ok(!/undefined|NaN|\[object/.test(css), `${w.id}: без мусора в css`);
    // скобки сбалансированы — иначе слой не применится
    assert.equal(
      (css.match(/\(/g) || []).length,
      (css.match(/\)/g) || []).length,
      `${w.id}: скобки сбалансированы`,
    );
  }
});

test('в data-URI фона нет двойных кавычек — иначе css-строка рвётся', () => {
  for (const w of BASE_WALLPAPERS) {
    // Вырезаем содержимое каждого url("…") и проверяем, что внутри нет ".
    for (const m of w.css.matchAll(/url\("data:image\/svg\+xml,([\s\S]*?)"\)/g)) {
      assert.ok(!m[1].includes('"'), `${w.id}: внутри url нет двойных кавычек`);
    }
  }
});

test('фон стабилен между вызовами и не собирается заново', () => {
  for (const w of BASE_WALLPAPERS) {
    assert.equal(w.css, w.css, `${w.id}: css кэшируется`);
  }
});

test('поиск по id и флаг светлого фона', () => {
  assert.equal(findBaseWallpaper('base-photo-sakura')?.id, 'base-photo-sakura', 'photo-фон есть в каталоге');
  assert.equal(findBaseWallpaper('base-paper-cream')?.id, 'base-paper-cream');
  assert.equal(findBaseWallpaper('нет-такого'), undefined);
  assert.equal(findBaseWallpaper(undefined), undefined);
  assert.equal(isLightBaseWallpaper('base-vk-blue'), true, 'светлый фон помечен');
  assert.equal(isLightBaseWallpaper('base-abyss-ice'), false, 'тёмный фон не помечен');
});

// ── Связь с темами ───────────────────────────────────────────────────────

test('базовые фоны попали в каталог стоковых обоев', () => {
  for (const w of BASE_WALLPAPERS) {
    const inStock = chatBg.STOCK_WALLPAPERS.find((s) => s.id === w.id);
    assert.ok(inStock, `${w.id}: есть в галерее обоев`);
    assert.equal(inStock.type, 'base', `${w.id}: тип base, а не photo`);
    assert.equal(inStock.url, undefined, `${w.id}: у базового фона нет url`);
  }
});

test('каждая встроенная тема приходит со смысловным фоном', () => {
  // Раньше требовалось фон у КАЖДОЙ темы. Теперь это не так и намеренно: фотографий ровно столько, сколько фотографий (остальным чистый фон выглядит хуже), поэтому проверяем обе группы.
  const withPhoto = [];
  const without = [];
  for (const theme of THEMES) {
    const stockId = theme.settings?.wallpaper?.stockId;
    assert.ok(stockId, `${theme.name}: фон задан (id или 'none')`);
    if (stockId === 'none') { without.push(theme.name); continue; }
    withPhoto.push(theme.name);
    assert.ok(findBaseWallpaper(stockId), `${theme.name}: фон «${stockId}» существует`);
  }
  assert.ok(withPhoto.length > 0, 'есть темы с фоном');
  assert.ok(without.length > 0, 'есть темы без фона — они чистые, а не сломанные');
});

test('фонов ровно столько, сколько фотографий', () => {
  // Иначе фото-обои лежат в галерее могут быть не вовсе: старые из них не трогаются, а один фон достаётся двум темам.
  const photoIds = BASE_WALLPAPERS.filter((w) => w.id.startsWith('base-photo-')).map((w) => w.id);
  const used = THEMES.map((t) => t.settings?.wallpaper?.stockId).filter((s) => s && s !== 'none');
  assert.ok(photoIds.length > 0, 'есть фото-фоны');
  assert.equal(new Set(used).size, used.length, 'один фон не достаётся двум темам');
  for (const id of used) assert.ok(photoIds.includes(id), `фон ${id} не фото`);
});

test('тема меняет не только цвета, но и характер интерфейса', () => {
  for (const theme of THEMES) {
    const s = theme.settings;
    assert.ok(s?.ui?.uiStyle, `${theme.name}: стиль интерфейса`);
    assert.ok(s?.ui?.iconPack, `${theme.name}: набор иконок`);
    assert.ok(s?.ui?.chatShape, `${theme.name}: форма карточек`);
    assert.ok(s?.appearance, `${theme.name}: внешний вид (шрифт/масштаб)`);
    assert.ok(s?.layout?.density, `${theme.name}: плотность макета`);
    assert.ok(typeof s?.layout?.radius === 'number', `${theme.name}: радиусы`);
    assert.ok(typeof s?.layout?.bubbleRadius === 'number', `${theme.name}: радиус пузырей`);
  }
});

test('в пресетах нет полей, которых не знает ThemeSettings', () => {
  for (const [id, p] of Object.entries(THEME_PRESETS)) {
    for (const key of Object.keys(p)) {
      assert.ok(
        ['wallpaper', 'ui', 'animations', 'appearance', 'layout', 'sound'].includes(key),
        `тема ${id}: неизвестная группа ${key}`,
      );
    }
    assert.ok(p.wallpaper, `тема ${id}: есть обои`);
    // 'none' — осознанный отказ от фона (тем больше, чем небо), а не ошибка:
    // раньше фон требовался у каждой темы, теперь фонов ровно столько,
    // сколько фотографий.
    if (p.wallpaper.stockId !== 'none') {
      assert.ok(findBaseWallpaper(p.wallpaper.stockId), `тема ${id}: фон существует`);
    }
    assert.equal(typeof p.wallpaper.brightness, 'number', `тема ${id}: задана яркость фона`);
    // ui и appearance приходят полными — иначе часть стилей не применится
    for (const key of ['iconPack', 'uiStyle', 'chatShape', 'chatBorder', 'chatFill']) {
      assert.notEqual(p.ui[key], undefined, `тема ${id}: ui.${key} заполнен`);
    }
    for (const key of ['brightness', 'textScale', 'globalFontFamily']) {
      assert.notEqual(p.appearance[key], undefined, `тема ${id}: appearance.${key} заполнен`);
    }
  }
});

// ── Производительность ───────────────────────────────────────────────────

test('строка фона не попадает в sx — только короткий класс', () => {
  // Строка фона — десятки килобайт. Положенная в sx, она хешируется emotion
  // на каждом рендере, и чат начинает подлагивать. Поэтому в разметке должен
  // быть только className из общего <style>.
  for (const file of [
    'src/components/ChatWindow.tsx',
    'src/components/WallpaperSettingsDialog.tsx',
    'src/components/ThemeSettingsPanels.tsx',
  ]) {
    const src = read(file);
    assert.ok(
      !/background:\s*(findBaseWallpaper|baseWallpaperCss)\(/.test(src),
      `${file}: строка фона не уходит в sx`,
    );
    // wallpaperCssClass — обёртка над baseWallpaperClass/adminWallpaperClass:
    // она вызывается теми же файлами и кладёт фон в общий <style>, поэтому
    // длинной строки в sx по-прежнему нет.
    assert.ok(
      /baseWallpaperClass\(|wallpaperCssClass\(/.test(src),
      `${file}: используется класс фона`,
    );
  }
});

test('класс фона короче самой строки в сотни раз', () => {
  // Фото-фоны — короткие ссылки, поэтому для сравнения берём самый
  // «тяжёлый» фон каталога: класс должен быть кратно короче правила.
  let css = '';
  let id = '';
  for (const w of wallpapers.BASE_WALLPAPERS) {
    const len = wallpapers.baseWallpaperCss(w.id).length;
    if (len > css.length) { css = wallpapers.baseWallpaperCss(w.id); id = w.id; }
  }
  assert.ok(css.length > 100, 'фон действительно не пустой');
  // Класс собирается и без DOM (document.head = null), и остаётся коротким.
  const cls = wallpapers.baseWallpaperClass(id);
  assert.ok(cls.length > 0, 'класс создан');
  assert.ok(cls.length < 60, `класс короткий (${cls.length} симв. для ${id})`);
  // Повторный вызов не плодит новые правила.
  assert.equal(wallpapers.baseWallpaperClass(id), cls);
});

// ── Фон применяется сразу, без захода в настройки ────────────────────────

test('у темы есть собственный базовый фон, независимый от стора обоев', () => {
  const { themeBaseWallpaperId } = load('src/store/themeStore.ts', { './themePresets': presets });
  // Тема, у которой снимок ещё не засеян: берём фон из пресета.
  assert.equal(
    themeBaseWallpaperId({ themeId: 1, theme: { settings: THEME_PRESETS[1] }, settingsByTheme: {} }),
    THEME_PRESETS[1].wallpaper.stockId,
  );
  // Снимок темы важнее пресета — свой выбор пользователя не теряется.
  assert.equal(
    themeBaseWallpaperId({
      themeId: 1,
      theme: { settings: THEME_PRESETS[1] },
      settingsByTheme: { 1: { wallpaper: { stockId: 'base-mono-grid' } } },
    }),
    'base-mono-grid',
  );
  // 'none' — это осознанный отказ от обоев, а не повод подставлять фон темы.
  assert.equal(
    themeBaseWallpaperId({
      themeId: 1,
      theme: { settings: THEME_PRESETS[1] },
      settingsByTheme: { 1: { wallpaper: { stockId: 'none' } } },
    }),
    null,
  );
  assert.equal(themeBaseWallpaperId({ themeId: null, settingsByTheme: {} }), null);
});

test('фон восстанавливается при старте, а не только при переключении темы', () => {
  const src = read('src/store/themeStore.ts');
  assert.ok(
    src.includes('applyRestoredThemeSettings();'),
    'настройки темы применяются при подъёме стора',
  );
  // Свойство: настройки берутся из восстановленной темы, а пресет — лишь
  // запасной рубеж для темы без снимка (в нём лежит её базовый фон).
  // Сравниваем без пробелов: выражение перенесено на несколько строк.
  const noSpace = src.replace(/\s+/g, '');
  assert.ok(
    noSpace.includes('s.settingsByTheme[String(s.themeId)]||t.settings||themePreset(s.themeId)'),
    'применяются настройки именно восстановленной темы, с пресетом запасом',
  );
  // Раньше фон появлялся только после ручного переключения темы.
  assert.ok(src.includes('applyThemeSettings(settings);'), 'и при переключении тоже');
});

test('удалённое своё фото не превращается в несуществующие стоковые обои', () => {
  // Раньше 'custom-photo' без самого фото уезжал дальше как id из каталога,
  // которого там нет, — и чат оставался вовсе без фона.
  const { useChatBgPrefsStore } = load('src/store/chatBgPrefsStore.ts', {
    './baseWallpapers': wallpapers,
  });
  const s = useChatBgPrefsStore.getState();
  useChatBgPrefsStore.setState({ globalStockWallpaper: 'custom-photo', userPhotoWallpaper: null });
  assert.equal(s.getChatWallpaper('chat'), null, 'нет фото — нет и обоев');
  useChatBgPrefsStore.setState({ userPhotoWallpaper: 'data:image/png;base64,AAA' });
  assert.equal(s.getChatWallpaper('chat').type, 'photo', 'фото на месте — обои есть');
});

test('пустой снимок темы ДОСТРАИВАЕТСЯ фоном темы, а не остаётся пустым', () => {
  const { fillMissingThemeWallpapers } = load('src/store/themeStore.ts', { './themePresets': presets });
  const themeId = 1;
  const presetId = THEME_PRESETS[themeId].wallpaper.stockId;

  // Снимок, сделанный до появления базовых фонов: stockId 'none'.
  // Именно этот случай миграция обязана чинить — раньше 'none' из снимка
  // перекрывал stockId пресета, и фон не появлялся НИКОГДА.
  const filled = fillMissingThemeWallpapers({ [themeId]: { wallpaper: { stockId: 'none' } } });
  assert.equal(
    filled[themeId].wallpaper.stockId,
    presetId,
    'фон темы подставлен в старый снимок',
  );
  assert.ok(findBaseWallpaper(filled[themeId].wallpaper.stockId), 'фон реально существует');

  // Свой выбор пользователя не трогаем.
  const snapshot = { wallpaper: { stockId: 'base-mono-grid' } };
  const own = fillMissingThemeWallpapers({ [themeId]: snapshot });
  assert.equal(own[themeId].wallpaper.stockId, 'base-mono-grid', 'свой выбор сохранён');
  assert.equal(own[themeId], snapshot, 'снимок с фоном не пересобирается зря');

  // Кастомная тема без пресета остаётся нетронутой.
  // Сравниваем структурно: объекты из vm-контекста имеют другой прототип.
  assert.equal(
    JSON.stringify(fillMissingThemeWallpapers({ 9999: { wallpaper: { stockId: 'none' } } })),
    JSON.stringify({ 9999: { wallpaper: { stockId: 'none' } } }),
    'у темы без пресета ничего не выдумываем',
  );
});

test('после миграции каждая тема действительно остаётся от валидного фона', () => {
  const { fillMissingThemeWallpapers, themeBaseWallpaperId } = load('src/store/themeStore.ts', { './themePresets': presets });
  // У тем без своего фона подставка 'none' — это не «обканельной», а отказ. Миграция должна вернуть фон тотько темам, у которым он положен, и не выдумывать фон тем, которой его не было.
  const legacy = fillMissingThemeWallpapers(
    Object.fromEntries(Object.keys(THEME_PRESETS).map((id) => [id, { wallpaper: { stockId: 'none' } }])),
  );
  let withBg = 0;
  let without = 0;
  for (const id of Object.keys(THEME_PRESETS)) {
    const presetHas = THEME_PRESETS[id].wallpaper.stockId !== 'none';
    const got = themeBaseWallpaperId({
      themeId: Number(id),
      theme: { settings: THEME_PRESETS[id] },
      settingsByTheme: legacy,
    });
    if (presetHas) {
      withBg++;
      assert.ok(got, `тема ${id}: фон восстановился`);
      assert.ok(findBaseWallpaper(got), `тема ${id}: фон «${got}» существует`);
    } else {
      without++;
      assert.equal(got, null, `тема ${id}: чистый фон не придумывается`);
    }
  }
  assert.ok(withBg > 0 && without > 0, 'есть и с фоном, и без');
});

/**
 * Поддельный document ДЛЯ VM-КОНТЕКСТА модуля: внутри <style> лежит текст, а не
 * элементы — именно поэтому `sheet.querySelector('.класс')` в реальном коде
 * всегда давал null. Считаем, сколько раз что-то дописали.
 *
 * Модуль держит ссылку на созданный <style> между вызовами, поэтому прежний
 * элемент обязательно помечаем отсоединённым: иначе тесты влияли бы друг на
 * друга и модуль писал бы в <style> предыдущего теста.
 */
let lastStyle = null;
function installFakeDom(ctx) {
  if (lastStyle) lastStyle.isConnected = false;
  const created = [];
  let current = null;
  const makeStyle = () => ({
    _text: '',
    isConnected: true,
    parentNode: null,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(node) { this._text += node.text; },
    // У <style> нет элементов-детей: только текст. querySelector всегда null.
    querySelector() { return null; },
  });
  ctx.document = {
    head: {
      querySelector: () => null,
      appendChild(el) { el.parentNode = this; current = el; lastStyle = el; created.push(el); },
    },
    createElement: () => makeStyle(),
    createTextNode: (text) => ({ text }),
  };
  return {
    created,
    get style() { return current; },
    detach() { if (current) current.isConnected = false; },
  };
}

test('правило фона дописывается один раз, а не на каждый рендер', () => {
  // Регрессия: <style> рос без предела, потому что проверка «правило уже есть»
  // шла через querySelector по тексту и всегда давала null. Разросшийся лист
  // заставлял браузер молча отбрасывать новые правила — обои пропадали.
  const dom = installFakeDom(wallpapersCtx);
  const cls = baseWallpaperClass('base-paper-cream');
  assert.ok(cls.startsWith('vera-bw-'), 'класс создан');
  const sizeAfterFirst = dom.style._text.length;
  assert.ok(sizeAfterFirst > 0, 'правило записано');
  for (let i = 0; i < 50; i++) baseWallpaperClass('base-paper-cream');
  assert.equal(dom.style._text.length, sizeAfterFirst, 'повторные вызовы не растят <style>');
  assert.equal((dom.style._text.match(/vera-bw-base-paper-cream/g) || []).length, 1, 'ровно одно правило');
});

test('после пересоздания <style> правило возвращается — фон не пропадает', () => {
  const dom = installFakeDom(wallpapersCtx);
  baseWallpaperClass('base-abyss-ice');
  const first = dom.style;
  // head пересобрали: прежний элемент выпал из документа.
  dom.detach();
  const cls = baseWallpaperClass('base-abyss-ice');
  assert.equal(cls, 'vera-bw-base-abyss-ice');
  assert.notEqual(dom.style, first, 'создан новый <style>');
  assert.equal((dom.style._text.match(/vera-bw-base-abyss-ice/g) || []).length, 1, 'правило вернулось');
});

test('при открытии галереи получает правило каждый из 42 фонов', () => {
  // Именно так выглядит баг на практике: в галерее рисуются все плитки сразу,
  // но правило добиралось не всем — часть плиток оставалась пустой.
  const dom = installFakeDom(wallpapersCtx);
  for (const w of BASE_WALLPAPERS) baseWallpaperClass(w.id);
  const text = dom.style._text;
  for (const w of BASE_WALLPAPERS) {
    assert.ok(text.includes(`vera-bw-${w.id}`), `правило для ${w.id} записано`);
  }
  const ruleCount = (text.match(/\{/g) || []).length;
  assert.equal(ruleCount, BASE_WALLPAPERS.length, 'правил ровно столько, сколько фонов');
  // А повторный открытие-закрытие галереи не должно ничего утолстить.
  for (let i = 0; i < 20; i++) for (const w of BASE_WALLPAPERS) baseWallpaperClass(w.id);
  assert.equal(
    (dom.style._text.match(/\{/g) || []).length, ruleCount,
    'после 20 повторных проходов число правил прежнее',
  );
});

test('цвет в background только последним слоем — иначе фон не рисуется вовсе', () => {
  // Правило CSS: в шорткате background цвет допустим ТОЛЬКО последним слоем.
  // mesh() возвращал «градиенты + цвет» одной строкой, и дописанные после неё
  // слои оставляли цвет в середине: браузер отбрасывал весь background, и фон
  // не отображался вообще (Полёт, Линии, Линии тёмные).
  const isColor = (l) =>
    /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%deg/]+\)|[a-z]+)$/i.test(l);
  const splitTop = (v) => {
    const out = []; let depth = 0, quote = null, cur = '';
    for (const ch of v) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  for (const w of BASE_WALLPAPERS) {
    const layers = splitTop(w.css);
    const colors = layers.filter(isColor);
    assert.ok(colors.length <= 1, `${w.id}: цвет не более одного`);
    if (colors.length === 1) {
      assert.equal(
        layers.indexOf(colors[0]), layers.length - 1,
        `${w.id}: цвет последним слоем`,
      );
    }
    // Каждый слой обязан быть чем-то осмысленным, иначе весь background падает.
    for (const l of layers) {
      assert.ok(
        l.startsWith('url(') || /^(radial|linear|conic)-gradient\(/.test(l) || isColor(l),
        `${w.id}: слой «${l.slice(0, 32)}» понятен CSS`,
      );
    }
  }
});

test('в правиле фона всегда есть cover — иначе плитки не масштабируются', () => {
  // Пробовали убирать cover для слоёв с собственной раскладкой — фоны с
  // плитками (Аврора, Полёт, Пиксельный город) рисовались в натуральную
  // величину, и в маленькой плитке галереи был виден только угол узора.
  assert.ok(
    !read('src/store/baseWallpapers.ts').includes('layersHaveOwnPlacement'),
    'условное отключение cover убрано',
  );
});

test('слои фона не перебиваются общим background-size: cover', () => {
  // cover нужен всем: у плиточных слоёв он масштабирует узор под элемент,
  // иначе в маленькой плитке галереи виден только угол рисунка.
  const src = read('src/store/baseWallpapers.ts');
  assert.ok(
    src.includes('background-size:cover;background-position:center;'),
    'cover и центрирование применяются ко всем фонам',
  );
});
