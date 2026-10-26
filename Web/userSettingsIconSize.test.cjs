const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('userSettingsStore has iconSize field', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/store/userSettingsStore.ts'), 'utf8');
  assert.ok(src.includes('iconSize: number;'), 'UserSettingsState имеет поле iconSize');
  assert.ok(src.includes('iconSize: 24,'), 'иконки по умолчанию 24px');
  assert.ok(src.includes('iconSize'), 'iconSize присутствует в SYNC_KEYS');
});

test('userSettingsStore applies iconSize to DOM via CSS variable', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/store/userSettingsStore.ts'), 'utf8');
  assert.ok(src.includes('--vera-icon-size'), 'применяется CSS переменная --vera-icon-size');
  assert.ok(src.includes('applyIconSizeToDom'), 'функция применения размера иконок существует');
});

test('IconsPanel in theme editor has icon size slider', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/components/ThemeSettingsPanels.tsx'), 'utf8');
  const start = src.indexOf('export function IconsPanel');
  const end = src.indexOf('export function', start + 1);
  const panel = src.slice(start, end);
  assert.ok(start >= 0, 'IconsPanel существует');
  assert.ok(panel.includes('label="Размер иконок"'), 'слайдер находится внутри IconsPanel');
  assert.ok(panel.includes("set('iconSize', v)"), 'слайдер пишет iconSize');
  assert.ok(panel.includes('min={16}') && panel.includes('max={40}'), 'диапазон 16..40');
});

test('icon size slider removed from SettingsDialog', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/components/SettingsDialog.tsx'), 'utf8');
  assert.ok(!src.includes('Размер иконок'), 'в общих настройках слайдера больше нет');
  assert.ok(!src.includes('iconSize'), 'SettingsDialog не трогает iconSize');
});

test('icon size is searchable and saved with the theme', () => {
  const search = fs.readFileSync(path.join(__dirname, 'src/utils/themeEditorSearch.ts'), 'utf8');
  assert.ok(search.includes("e('icons', 'Размер иконок'"), 'поиск редактора находит строку');
  const themeSrc = fs.readFileSync(path.join(__dirname, 'src/store/themeStore.ts'), 'utf8');
  assert.ok(themeSrc.includes('iconSize?: number'), 'поле в ThemeSettings.ui');
  assert.ok(themeSrc.includes('iconSize: us.iconSize'), 'снимок темы сохраняет размер');
  assert.ok(themeSrc.includes("set('iconSize'"), 'применение темы восстанавливает размер');
});

test('MUI SvgIcon uses --vera-icon-size', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  assert.ok(mainSrc.includes('MuiSvgIcon'), 'есть override MuiSvgIcon');
  assert.ok(mainSrc.includes("fontSizeMedium: { fontSize: 'var(--vera-icon-size, 24px)' }"), 'medium = переменная');
});