const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const themeStore = read('src/store/themeStore.ts');
const settings = read('src/components/SettingsDialog.tsx');
const editor = read('src/components/ThemeEditor.tsx');
const panels = read('src/components/ThemeSettingsPanels.tsx');

// ── Модель: настройки живут в теме ────────────────────────────────────────────

test('ThemeSettings содержит все перенесённые группы настроек', () => {
  assert.ok(themeStore.includes('export interface ThemeSettings'), 'тип объявлен');
  for (const key of ['wallpaper?:', 'sound?:', 'ui?:', 'animations?:', 'appearance?:', 'layout?:']) {
    assert.ok(themeStore.includes(key), `есть группа ${key}`);
  }
  assert.ok(themeStore.includes('settings?: ThemeSettings'), 'Theme.settings объявлено');
});

test('переключение и сохранение темы применяют её настройки', () => {
  assert.ok(themeStore.includes('export function applyThemeSettings'), 'функция применения экспортирована');
  assert.ok(themeStore.includes('export function snapshotThemeSettings'), 'снимок настроек экспортирован');
  // setTheme и applyCustomTheme применяют настройки выбранной темы.
  const calls = themeStore.match(/applyThemeSettings\(/g) || [];
  assert.ok(calls.length >= 3, `applyThemeSettings вызывается при переключении (найдено ${calls.length})`);
  // Снимок читает все пять сторов с настройками.
  for (const store of ['useChatBgPrefsStore', 'useChatSoundStore', 'useUiPrefsStore', 'useAnimStore', 'useUserSettingsStore']) {
    assert.ok(themeStore.includes(store), `снимок читает ${store}`);
  }
});

test('настройки принадлежат каждой теме отдельно и не текут между темами', () => {
  assert.ok(themeStore.includes('settingsByTheme: Record<string, ThemeSettings>'), 'есть per-theme хранилище');
  // Уходя из темы — снимаем снимок именно в неё: правки остаются её.
  assert.ok(
    /if \(from !== null && from !== id\) storeThemeSettings\(from, snapshotThemeSettings\(\)/.test(themeStore),
    'снимок пишется в тему, с которой ушли',
  );
  // Входя в тему — берём её собственные настройки.
  assert.ok(themeStore.includes('const settings = takeThemeSettings(id, t, get, set)'), 'берутся настройки выбранной темы');
  assert.ok(themeStore.includes('applyThemeSettings(settings)'), 'применяются именно они');
  // Первое посещение засеивает тему и запоминает — дальше она ни с кем не делится.
  assert.ok(
    /const seeded: ThemeSettings = t\.settings \? t\.settings : snapshotThemeSettings\(\)/.test(themeStore),
    'первое посещение засеивает тему',
  );
  // Сохранение и удаление темы работают с её же настройками.
  assert.ok(
    themeStore.includes('storeThemeSettings(t.id, t.settings || snapshotThemeSettings()'),
    'сохранение темы пишет её настройки',
  );
  assert.ok(
    themeStore.includes('const { [String(id)]: _dropped, ...rest } = get().settingsByTheme'),
    'удаление темы убирает её настройки',
  );
  // Персист: настройки не теряются при перезагрузке.
  assert.ok(themeStore.includes('settingsByTheme: p.settingsByTheme || {}'), 'восстанавливаются при загрузке');
});

// ── Настройки больше не живут в «Настройках» ─────────────────────────────────

test('из Настроек убраны перенесённые пункты', () => {
  assert.ok(!settings.includes('Обои для всех чатов'), 'пункт обоев удалён');
  assert.ok(!settings.includes('Звук уведомлений по умолчанию'), 'пункт звука удалён');
  assert.ok(!settings.includes('>Иконки и стиль интерфейса<'), 'секция иконок удалена');
  assert.ok(!settings.includes('>Анимации<'), 'секция анимаций удалена');
  assert.ok(!settings.includes('>Внешний вид<'), 'секция внешнего вида удалена');
  assert.ok(!settings.includes('>Макет<'), 'секция макета удалена');
  assert.ok(!settings.includes('WallpaperSettingsDialog'), 'диалог обоев не подключён');
  assert.ok(!settings.includes('GlobalSoundSettingsDialog'), 'диалог звука не подключён');
  assert.ok(!settings.includes('LayoutDesignerDialog'), 'конструктор макета не подключён');
  // Язык остаётся в настройках — это не свойство темы.
  assert.ok(settings.includes('>Язык интерфейса<'), 'язык остался в настройках');
});

// ── Редактор: по центру, с вкладками ──────────────────────────────────────────

test('редактор — полноэкранная плашка в портале', () => {
  // Плашка во всю высоту (как раньше), а не маленькая карточка 86vh.
  assert.ok(editor.includes("alignItems: 'stretch'"), 'плашка растянута на всю высоту');
  assert.ok(editor.includes("height: '100%'"), 'плашка во весь экран');
  assert.ok(editor.includes("maxWidth: 'min(1680px, 100%)'"), 'по ширине — почти весь экран');
  // Портал в body: иначе backdrop-filter корневого Box сайдбара зажимает
  // fixed-оверлей рамками панели чатов.
  assert.ok(/createPortal\(content, document\.body\)/.test(editor), 'оверлей рендерится порталом в body');
});

test('редактор разбит на вкладки и подключает панели настроек', () => {
  for (const tab of ['wallpaper', 'sound', 'ui', 'anim', 'look', 'layout']) {
    assert.ok(editor.includes(`'${tab}'`), `вкладка ${tab} объявлена`);
    assert.ok(new RegExp(`tab === '${tab}' && <`).test(editor), `вкладка ${tab} рендерит панель`);
  }
  for (const panel of ['WallpaperPanel', 'SoundPanel', 'UiStylePanel', 'AnimationsPanel', 'AppearancePanel', 'LayoutPanel']) {
    assert.ok(editor.includes(panel), `${panel} подключена`);
    assert.ok(panels.includes(`export function ${panel}`), `${panel} экспортирована`);
  }
  // Сохранение темы снимает настройки в неё.
  assert.ok(editor.includes('settings: snapshotThemeSettings()'), 'сохранение кладёт снимок в тему');
});

test('обои в редакторе всегда глобальные (для темы, а не для чата)', () => {
  assert.ok(editor.includes('forceGlobal') || panels.includes('forceGlobal'), 'диалог обоев открыт в режиме глобальных');
  assert.ok(read('src/components/WallpaperSettingsDialog.tsx').includes('forceGlobal'), 'у диалога есть prop forceGlobal');
});

test('окна из редактора открываются поверх плашки, а не под ней', () => {
  // Плашка редактора — z-index 9999, а MUI по умолчанию ставит модальные окна
  // на 1300: без поднятия шкалы диалог обоев и конструктор макета оказывались
  // под плашкой и по клику не выбирались.
  assert.ok(panels.includes('export function ThemeSettingsLayer'), 'слой поднятых порталов есть');
  assert.ok(panels.includes('modal: 10100'), 'шкала modal поднята выше плашки');
  assert.ok(panels.includes('tooltip: 10200'), 'тултипы и меню внутри окон тоже подняты');
  assert.ok(editor.includes('<ThemeSettingsLayer>'), 'вкладки настроек обёрнуты в слой');
  assert.ok(/tab !== 'theme' && \([\s\S]{0,200}<ThemeSettingsLayer>/.test(editor), 'слой только для вкладок настроек');
});
