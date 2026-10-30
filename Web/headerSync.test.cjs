const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ── Стиль мобильной шапки чата ──────────────────────────────────────────────

test('стиль мобильной шапки — настройка макета со «сплошной» по умолчанию', () => {
  const store = read('src/store/userSettingsStore.ts');
  assert.match(store, /mobileHeaderStyle: 'solid' \| 'island';/, 'тип настройки');
  assert.match(store, /mobileHeaderStyle: 'solid',/, 'по умолчанию — сплошная');
  // Макет целиком входит в снимок темы — значит, настройка едет вместе с темой.
  assert.match(read('src/store/themeStore.ts'), /layout: \{ \.\.\.us\.layout \}/);
});

test('переключатель стоит в «Макете» и находится поиском редактора', () => {
  const panels = read('src/components/ThemeSettingsPanels.tsx');
  assert.ok(panels.includes('label="Шапка чата на телефоне"'));
  assert.match(panels, /setLayout\('mobileHeaderStyle'/);
  assert.match(panels, /\['solid', 'Сплошная'\], \['island', 'Остров'\]/);
  assert.ok(read('src/utils/themeEditorSearch.ts').includes("e('layout', 'Шапка чата на телефоне'"));
});

test('окно чата рисует «остров» поверх ленты и сохраняет сплошную шапку', () => {
  const win = read('src/components/ChatWindow.tsx');
  assert.match(win, /s\.layout\.mobileHeaderStyle\) === 'island'/);
  assert.match(win, /\{mobileIsland \? \(/, 'два варианта шапки');
  const solid = win.slice(win.indexOf('const islandSolidSx'), win.indexOf('const islandSolidSx') + 700);
  assert.match(solid, /bgcolor: MOBILE_HEADER_BG/, 'кнопки острова непрозрачные');
  assert.doesNotMatch(solid, /backdropFilter|withAlpha/, 'без стекла и прозрачности');
  assert.match(solid, /pointerEvents: 'auto'/, 'кнопки ловят тапы');
  // Полоса острова висит поверх ленты и прозрачна: сквозь неё видны сообщения.
  const island = win.slice(win.indexOf('{mobileIsland ? ('), win.indexOf(') : (', win.indexOf('{mobileIsland ? (')));
  assert.match(island, /position: 'absolute', top: 0, left: 0, right: 0/);
  assert.match(island, /bgcolor: 'transparent'/);
  assert.match(island, /pointerEvents: 'none'/, 'прокрутка и тапы проходят сквозь полосу');
  assert.match(island, /env\(safe-area-inset-top\)/, 'учитывает вырез экрана');
  // Лента отодвигает первое сообщение под полосу, плашки получают прокладку.
  assert.match(win, /pt: \{ xs: mobileIsland && !islandBarsShown \? `calc\(\$\{ISLAND_STRIP_CSS\} \+ 10px\)`/);
  assert.match(win, /\{islandBarsShown && \(/);
  assert.ok(win.includes('MOBILE_HEADER_BG'), 'сплошная шапка осталась');
});

// ── Размытие под инфопанелью на телефоне ────────────────────────────────────

test('инфопанель на телефоне размывает чат под собой, на ПК — сплошная', () => {
  const info = read('src/components/ChatInfoPanel.tsx');
  const root = info.slice(info.indexOf('<Box ref={panelRef}'), info.indexOf('role="separator"'));
  assert.match(root, /bgcolor: withAlpha\(theme\.bgHeader, 0\.\d+\)/, 'полупрозрачный фон');
  assert.match(root, /backdropFilter: 'blur\(\d+px/, 'размытие');
  assert.match(root, /@supports not/, 'без backdrop-filter фон сплошной');
  const desktop = root.slice(root.indexOf("'@media (min-width: 701px)'"));
  assert.match(desktop, /backdropFilter: 'none'/, 'на ПК размытия нет');
  assert.match(desktop, /bgcolor: theme\.bgHeader/);
});

// ── Синк темы и иконок по аккаунту ──────────────────────────────────────────

test('каталог встроенных тем не раздувает синк темы аккаунта', () => {
  const sync = read('src/services/storeSyncSimple.ts');
  assert.match(sync, /theme: \['builtinThemes', 'builtinThemesLoading', 'publishedBuiltinCatalog', 'themeVersion', 'theme'\]/);
});

test('тема пересобирается и применяется после снапшота с другого устройства', () => {
  const store = read('src/store/themeStore.ts');
  assert.match(store, /enableStoreSync\('theme', useThemeStore, 800, \{[\s\S]{0,120}afterRemote: rebuildActiveTheme/);
  const rebuild = store.slice(store.indexOf('function rebuildActiveTheme'), store.indexOf('function rebuildActiveTheme') + 900);
  assert.match(rebuild, /applyRestoredThemeSettings\(\)/, 'иконки, стиль и макет применяются');
  // Тяжёлые фото в синк не идут — иначе 413 и тема не доезжает совсем.
  assert.match(store, /SYNC_PHOTO_LIMIT = 16 \* 1024/);
});

test('живые правки иконок и стиля попадают в тему без её пересохранения', () => {
  const store = read('src/store/themeStore.ts');
  const capture = store.slice(store.indexOf('function captureActiveThemeSettings'), store.indexOf('function watchLiveThemeSettings'));
  assert.match(capture, /if \(!isStoreSyncReady\('theme'\)\) return;/, 'до сверки с сервером не пишет');
  assert.match(capture, /JSON\.stringify\(s\.settingsByTheme\[key\] \?\? null\) === JSON\.stringify\(snap\)/, 'без эха');
  const watch = store.slice(store.indexOf('function watchLiveThemeSettings'), store.indexOf('function watchLiveThemeSettings') + 700);
  for (const s of ['useUiPrefsStore', 'useAnimStore', 'useUserSettingsStore']) assert.ok(watch.includes(s), s);
  assert.match(watch, /store\?\.subscribe\?\.\(schedule\)/);
});

test('свои паки иконок синкаются отдельным каналом при входе и выходе', () => {
  const auth = read('src/store/authStore.ts');
  assert.match(auth, /void startIconPackSync\(user\.id, changed\)/);
  assert.match(auth, /stopIconPackSync\(\);/);
  const panel = read('src/components/CustomIconPacksPanel.tsx');
  // Выбор пака едет с темой быстрее самого пака: авто-сброс при отсутствии
  // пака отправлял null обратно и выключал пак на другом устройстве.
  assert.doesNotMatch(panel, /!packs\[customPack\]\)\s*setCustomPack\(null\)/, 'нет авто-сброса выбора');
  assert.doesNotMatch(panel, /useEffect\(/, 'панель не правит выбор сама');
  assert.match(panel, /if \(customPack === p\.id\) setCustomPack\(null\);\s*deletePack\(p\.id\)/, 'выбор снимается только при удалении');
});
