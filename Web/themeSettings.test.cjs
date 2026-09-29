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
  // setTheme, saveCustomTheme (активная тема) и applyCustomTheme вызывают применение.
  const calls = themeStore.match(/applyThemeSettings\(/g) || [];
  assert.ok(calls.length >= 4, `applyThemeSettings вызывается при переключении/сохранении (найдено ${calls.length})`);
  // Снимок читает все шесть сторов.
  for (const store of ['useChatBgPrefsStore', 'useChatSoundStore', 'useUiPrefsStore', 'useAnimStore', 'useUserSettingsStore']) {
    assert.ok(themeStore.includes(store), `снимок читает ${store}`);
  }
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

test('редактор открывается по центру экрана', () => {
  assert.ok(editor.includes("alignItems: 'center'"), 'оверлей центрирует карточку');
  assert.ok(editor.includes("height: '86vh'"), 'карточка занимает 86vh, а не всю высоту');
  assert.ok(!editor.includes("alignItems: 'stretch'"), 'полноэкранная «плашка» убрана');
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
