const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const source = read('src/utils/bubbleGradient.ts');
const context = vm.createContext({ console, exports: {}, module: { exports: {} } });
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);
const { bubbleBackground, autoBubbleGradient, regenerateAutoGradient } = context.exports;

const themeStore = read('src/store/themeStore.ts');
const editor = read('src/components/ThemeEditor.tsx');
const bubble = read('src/components/MessageBubble.tsx');
const chatWindow = read('src/components/ChatWindow.tsx');
const themeLink = read('src/utils/themeLink.ts');
const serverThemes = read('../Server/themes.js');

// ── Галочка «градиент» переключает ровно два режима ──────────────────────────

test('без градиента пузырь сплошной, с градиентом — градиентный', () => {
  assert.equal(bubbleBackground('#6C5CE7'), '#6C5CE7');
  assert.equal(bubbleBackground('#6C5CE7', undefined), '#6C5CE7');
  assert.equal(bubbleBackground('#6C5CE7', ''), '#6C5CE7');
  // Пробелы — не градиент: иначе снятая галочка оставляла бы пустой фон.
  assert.equal(bubbleBackground('#6C5CE7', '   '), '#6C5CE7');
  const g = 'linear-gradient(135deg, #6C5CE7, #4A3F9F)';
  assert.equal(bubbleBackground('#6C5CE7', g), g);
});

test('свой и чужой пузырь считаются по одному правилу', () => {
  // Регресс: у чужих пузырей про градиент забывали, и галочка у них ничего
  // не делала — пузырь оставался сплошным при включённой галочке.
  const own = 'linear-gradient(135deg, #fff, #ccc)';
  const other = 'linear-gradient(135deg, #333, #111)';
  assert.equal(bubbleBackground('#6C5CE7', own), own);
  assert.equal(bubbleBackground('#2A2A3A', other), other);
});

// ── Градиент строится из одного цвета ───────────────────────────────────────

test('галочка сама даёт градиент из цвета, вручную ничего вписывать не надо', () => {
  const g = autoBubbleGradient('#6C5CE7');
  assert.ok(g.startsWith('linear-gradient('), g);
test('альфа полупрозрачного цвета не теряется — иначе край пузыря светлеет', () => {
  // Регресс: у rgba-цветов забывали про альфу и получали заметную кайму.
  const g = autoBubbleGradient('rgba(255,255,255,0.07)');
  assert.equal((g.match(/rgba\(/g) || []).length, 3, g);
  for (const part of g.match(/rgba\([^)]*\)/g)) {
    assert.ok(part.endsWith('0.07)'), `альфа сохранена: ${part}`);
  }
  assert.ok(autoBubbleGradient('#7DFFB255').includes(', 0.333)'), 'hex с альфой тоже');
});

test('неразбираемые цвета не ломают фон, а остаются как есть', () => {
  // Подставить hsl() вместо выдуманного значения значит убить фон пузыря.
  for (const bad of ['hsl(210, 40%, 20%)', 'transparent', 'var(--accent)', 'не цвет', '']) {
    assert.equal(autoBubbleGradient(bad), bad, bad);
  }
});

// ── Смена цвета не затирает чужой CSS ────────────────────────────────────────

test('смена цвета пересобирает НАШ градиент и не трогает чужой', () => {
  const from = '#6C5CE7';
  const to = '#00FF88';
  assert.equal(regenerateAutoGradient(to, from, autoBubbleGradient(from)), autoBubbleGradient(to));
  // Рукописный CSS пользователя должен уцелеть.
  const handmade = 'linear-gradient(90deg, red, blue)';
  assert.equal(regenerateAutoGradient(to, from, handmade), handmade);
  // Градиента нет — и нечего пересобирать.
  assert.equal(regenerateAutoGradient(to, from, ''), '');
// ── Настройка доходит до отрисовки ───────────────────────────────────────────

test('в теме есть градиент чужих пузырей — у них его раньше не было вовсе', () => {
  assert.ok(/bubbleOtherGradient\?:\s*string/.test(themeStore), 'поле объявлено в теме');
});

test('галочки стоят рядом с обоими цветами пузырей', () => {
  assert.ok(/function BubbleColorField/.test(editor), 'один общий компонент на оба пузыря');
  assert.ok((editor.match(/<BubbleColorField/g) || []).length === 2, 'по экземпляру на пузырь');
  // Галочка одна и та же: включение задаёт градиент, снятие чистит его.
  assert.ok(/onGradient\(on \? '' : autoBubbleGradient\(color\)\)/.test(editor), 'снятие чистит градиент');
  assert.ok(/checked=\{on\}/.test(editor), 'положение галочки выведено из градиента');
  assert.ok(/label="Свой пузырь"/.test(editor) && /label="Чужой пузырь"/.test(editor), 'подписаны оба');
});

test('пузырь рисуется по общему правилу, а не как раньше «свой или чужой»', () => {
  assert.ok(/const themeBubbleBackground = isOwn/.test(bubble), 'фон считается один раз');
  assert.ok(/bubbleBackground\(bgBubbleOther, bubbleOtherGradient\)/.test(bubble), 'чужой учитывает градиент');
  // Старое «градиент только у своих» не должно где-либо остаться.
  assert.ok(!/bubbleOwnGradient \|\| bgBubbleOwn/.test(bubble), 'старой формулы не осталось');
  assert.ok(
    !/isOwn\s*\?\s*bubbleOwnGradient\s*\|\|/.test(bubble),
    'ветка без учёта градиента чужого удалена',
  );
});

test('тема передаёт оба градиента в сообщения', () => {
  assert.ok(/bubbleOtherGradient=\{theme\.bubbleOtherGradient\}/.test(chatWindow), 'проп доходит до пузыря');
});

test('ссылка на тему переносит градиент чужих пузырей', () => {
  assert.ok(/og2: theme\.bubbleOtherGradient/.test(themeLink), 'экспорт');
  assert.ok(/bubbleOtherGradient: p\.og2/.test(themeLink), 'импорт');
  // Старая ссылка без og2 читается — чужие пузыри просто сплошные.
  assert.ok(/Старые ссылки ключа og2/.test(themeLink), 'устаревшая ссылка не ломается');
});

test('сервер пропускает новое поле в теме, иначе оно молча терялось бы', () => {
  assert.ok(/'bubbleOtherGradient'/.test(serverThemes), 'поле в whitelist');
});
});
  // Три опорные точки: светлее → база → темнее.
  assert.equal((g.match(/rgb\(/g) || []).length, 3, g);
  assert.ok(g.includes('rgb(140, 128, 236)'), `светлее в начале: ${g}`);
  assert.ok(g.includes('rgb(108, 92, 231)'), `база в середине: ${g}`);
  assert.ok(g.includes('rgb(78, 66, 166)'), `темнее в конце: ${g}`);
});

test('#rgb и #rrggbb дают один и тот же градиент', () => {
  assert.equal(autoBubbleGradient('#abc'), autoBubbleGradient('#aabbcc'));
});