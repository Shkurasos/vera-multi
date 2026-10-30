const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** Транспилирует чистый модуль и отдаёт его exports (contrast.ts — его зависимость). */
function load(file, deps = {}) {
  const sub = { exports: {} };
  vm.runInContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    vm.createContext({
      exports: sub.exports, module: sub,
      require: (name) => { if (deps[name]) return deps[name]; throw new Error('unexpected require: ' + name); },
    }),
  );
  return sub.exports;
}
const contrast = load('src/utils/contrast.ts');
const A = load('src/utils/avatarColors.ts', { './contrast': contrast });
// Массивы из vm-контекста — с чужим Array.prototype: копируем перед deepEqual.
const arr = (a) => [...a];

test('один ключ — всегда один цвет, разные ключи расходятся по палитре', () => {
  const pal = A.avatarPalette('rainbow', '#3AA0E8');
  assert.equal(A.avatarColorFor('user-1', pal), A.avatarColorFor('user-1', pal));
  const used = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((k) => A.avatarColorFor('id-' + k, pal)));
  assert.ok(used.size >= 4, 'десять разных id дают несколько разных цветов, а не один');
  assert.equal(A.avatarColorFor(null, pal), pal[0]);
  assert.equal(A.avatarColorFor('x', []), '#888888');
});

test('«Под тему» — разные оттенки, зависят от акцента', () => {
  const blue = A.themeAvatarPalette('#3AA0E8');
  const red = A.themeAvatarPalette('#E0455A');
  assert.equal(blue.length, 8);
  assert.equal(new Set(blue).size, blue.length, 'оттенки не повторяются');
  assert.notDeepEqual(blue, red, 'другая тема — другая палитра');
  for (const c of blue) assert.match(c, /^#[0-9a-f]{6}$/);
  // Почти белый акцент не даёт бледных кружков: светлота зажата.
  for (const c of A.themeAvatarPalette('#E4F0F6')) assert.ok(contrast.colorLuminance(c) < 0.8, c);
  // Битый акцент — откат на радугу, без исключений.
  assert.deepEqual(arr(A.themeAvatarPalette('var(--x)')), [...A.RAINBOW_AVATAR_COLORS]);
});

test('режимы палитры: акцент, свои, пустые свои откатываются на тему', () => {
  assert.deepEqual(arr(A.avatarPalette('accent', '#3AA0E8')), ['#3aa0e8']);
  assert.deepEqual(arr(A.avatarPalette('custom', '#3AA0E8', ['#FF0000', 'мусор', '#f00', '#0f0'])), ['#ff0000', '#00ff00']);
  assert.deepEqual(arr(A.avatarPalette('custom', '#3AA0E8', [])), arr(A.themeAvatarPalette('#3AA0E8')));
});

test('свои цвета чистятся и ограничены по количеству', () => {
  const many = Array.from({ length: 20 }, (_, i) => '#' + i.toString(16).padStart(2, '0') + '0000');
  assert.equal(A.sanitizeAvatarColors(many).length, A.MAX_CUSTOM_AVATAR_COLORS);
  assert.deepEqual(arr(A.sanitizeAvatarColors('не массив')), []);
  assert.equal(A.normalizeHexColor('#ABCDEF80'), '#abcdef');
  assert.equal(A.isAvatarPaletteMode('rainbow'), true);
  assert.equal(A.isAvatarPaletteMode('neon'), false);
});

test('инициалы читаемы: цвет текста по яркости заливки, градиент по флагу', () => {
  assert.equal(A.avatarFill('#ffe082', false).color, '#0B0B10');
  assert.equal(A.avatarFill('#263238', false).color, '#FFFFFF');
  assert.equal(A.avatarFill('#263238', false).backgroundImage, undefined);
  assert.match(A.avatarFill('#263238', true).backgroundImage, /^linear-gradient\(160deg/);
});

test('настройки подключены: стор, снимок темы, все аватарки без фото', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const store = read('src/store/uiPrefsStore.ts');
  assert.ok(store.includes('setAvatarPalette') && store.includes('avatarGradient: false'));
  const theme = read('src/store/themeStore.ts');
  assert.ok(theme.includes('avatarPalette: ui.avatarPalette'), 'палитра попадает в снимок темы');
  assert.ok(theme.includes('ui.setAvatarPalette(s.ui.avatarPalette)'), 'и применяется при переключении темы');
  for (const f of ['Sidebar', 'ChatWindow', 'MessageBubble', 'ChatInfoPanel', 'UserProfileModal']) {
    assert.ok(read(`src/components/${f}.tsx`).includes('useAvatarFill'), f);
  }
  assert.ok(read('src/components/ThemeSettingsPanels.tsx').includes('label="Палитра аватарок"'));
});
