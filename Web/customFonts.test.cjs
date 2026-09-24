const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/utils/customFonts.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const {
  FONT_FILE_ACCEPT, MAX_FONT_FILE_SIZE,
  checkFontFile, customFontCss, fontFileExtension, formatFontSize,
  isSupportedFontFile, sanitizeFontFamily,
} = context.exports;

test('имя семейства читается из имени файла и чистится от опасных для CSS символов', () => {
  assert.equal(sanitizeFontFamily('Мой Шрифт.ttf'), 'Мой Шрифт');
  assert.equal(sanitizeFontFamily('C:\\fonts\\Foo-Bar.OTF'), 'Foo-Bar');
  assert.equal(sanitizeFontFamily('  Inter   Variable.woff2  '), 'Inter Variable');
  // Кавычки, точки с запятой и фигурные скобки внутри @font-face ломают CSS.
  assert.equal(sanitizeFontFamily('bad"font;{ }.ttf'), 'bad font');
  assert.equal(sanitizeFontFamily('.ttf'), '');
  assert.equal(sanitizeFontFamily(''), '');
  assert.equal(sanitizeFontFamily(`${'x'.repeat(120)}.ttf`).length, 64);
});

test('поддерживаются .ttf/.otf/.woff/.woff2, accept для input собирается из них', () => {
  assert.equal(FONT_FILE_ACCEPT, '.ttf,.otf,.woff,.woff2');
  ['Font.ttf', 'Font.OTF', 'Font.woff', 'Font.WOFF2', 'Мой Шрифт.otf']
    .forEach((name) => assert.equal(isSupportedFontFile(name), true, name));
  ['Font.ttx', 'Font.ttf.txt', 'Font', 'Font.']
    .forEach((name) => assert.equal(isSupportedFontFile(name), false, name));
  assert.equal(fontFileExtension('Font.TTF'), 'ttf');
  assert.equal(fontFileExtension('Font'), '');
});

test('файл проверяется до загрузки: формат, пустой файл, слишком большой файл', () => {
  assert.equal(checkFontFile(null), 'Файл не выбран');
  assert.match(checkFontFile({ name: 'font.zip', size: 10 }), /ttf/);
  assert.match(checkFontFile({ name: 'font.ttf', size: 0 }), /пустой/);
  assert.match(checkFontFile({ name: 'font.ttf', size: MAX_FONT_FILE_SIZE + 1 }), /МБ/);
  assert.equal(checkFontFile({ name: 'font.ttf', size: 1024 }), null);
  assert.equal(checkFontFile({ name: 'Мой Шрифт.otf', size: MAX_FONT_FILE_SIZE }), null);
  assert.match(checkFontFile({ name: '.ttf', size: 1024 }), /название/);
});

test('CSS-значение своего шрифта всегда с системным запасным вариантом', () => {
  assert.equal(customFontCss('My Font'), '"My Font", system-ui, "Segoe UI", sans-serif');
  assert.equal(customFontCss('My "Font"'), '"My Font", system-ui, "Segoe UI", sans-serif');
  assert.equal(customFontCss('My Font', 'serif'), '"My Font", serif');
  assert.equal(customFontCss('', 'serif'), 'serif');
  assert.equal(customFontCss('   ', 'serif'), 'serif');
});

test('размер файла шрифта показывается по-человечески', () => {
  assert.equal(formatFontSize(0), '0 КБ');
  assert.equal(formatFontSize(-5), '0 КБ');
  assert.equal(formatFontSize(2048), '2 КБ');
  assert.equal(formatFontSize(1024 * 1024 * 2.5), '2.5 МБ');
});
