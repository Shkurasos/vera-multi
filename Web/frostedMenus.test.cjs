const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('frosted: полупрозрачный фон + размытие того, что под плашкой', () => {
  const src = read('src/styles/frosted.ts');
  assert.ok(src.includes('withAlpha(background, alpha)'), 'фон темы с прозрачностью');
  assert.ok(src.includes('backdropFilter: FROSTED_BLUR'), 'размытие');
  assert.ok(src.includes('WebkitBackdropFilter: FROSTED_BLUR'), 'Safari');
});

test('ContextMenu: фон валиден и для rgba()-шапок тем (текст не сливается с фото)', () => {
  const src = read('src/components/ContextMenu.tsx');
  // `rgba(...)` + 'F2' — невалидный цвет: браузер выкидывал фон целиком.
  assert.ok(!/bgHeader\s*\+\s*'/.test(src), 'нет склейки цвета со строкой hex-альфы');
  assert.ok(src.includes('bgcolor: withAlpha(theme.bg, 0.9)'), 'сплошная подложка из фона темы');
  assert.ok(src.includes('withAlpha(theme.bgHeader, 0.95)'), 'шапка темы поверх подложки');
});

test('меню «три точки» в чате использует матовое стекло', () => {
  const src = read('src/components/ChatWindow.tsx');
  const menu = src.slice(src.indexOf('<Menu anchorEl={anchorEl}'), src.indexOf('Поиск по сообщениям'));
  assert.ok(menu.includes('frostedPaperSx(theme.bgHeader, theme.border)'));
});

test('списки выбора скинов в инфопанели размывают фон', () => {
  const src = read('src/components/ChatInfoPanel.tsx');
  assert.ok(/MenuProps:\s*\{\s*PaperProps:\s*\{\s*sx:\s*\{\s*\.\.\.frostedPaperSx/.test(src));
  assert.equal((src.match(/SelectProps=\{skinSelectProps\}/g) || []).length, 2, 'скины канала и мои скины');
});

test('фильтры инвентаря (категория, коллекция, редкость, сортировка) размывают фон', () => {
  const src = read('src/components/Store.tsx');
  assert.ok(src.includes("import { frostedPaperSx } from '../styles/frosted';"));
  assert.ok(/filterSelectProps = useMemo\([\s\S]*?\.\.\.frostedPaperSx\(theme\.bgHeader, theme\.border\)/.test(src));
  // Категория — строка чипов, остальные три фильтра — выпадающие списки с размытием.
  assert.equal((src.match(/SelectProps=\{filterSelectProps\}/g) || []).length, 3, 'коллекция, редкость, сортировка');
  assert.ok(src.includes('aria-pressed={category === id}'), 'категории переключаются чипами');
});
