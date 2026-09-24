const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/utils/themeLink.ts'), 'utf8');
// Модульный синтаксис убираем: код выполняется в vm как обычный скрипт,
// нужные функции затем кладём в globalThis (в контексте нет btoa/atob).
const script = source
  .replace(/^\s*import[^\n]*\n/gm, '')
  .replace(/\bexport (const|function)\b/g, '$1');
const context = vm.createContext({ btoa, atob });
vm.runInContext(
  ts.transpileModule(`${script}
globalThis.themeToLink = themeToLink;
globalThis.themeFromLink = themeFromLink;
globalThis.CUSTOM_THEME_ID_START = CUSTOM_THEME_ID_START;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText,
  context,
);
const { themeToLink, themeFromLink, CUSTOM_THEME_ID_START } = context;

const baseTheme = (over) => ({
  id: 1001, name: 'Моя тема', bg: '#101010', text: '#fff', accent: '#7c6af7',
  bgSidebar: '#181818', bgChat: '#101010', bgHeader: '#181818', bgInput: '#202020',
  bgBubbleOwn: '#6C5CE7', bgBubbleOther: '#2A2A3A',
  bgHover: '#202020', bgActive: '#282828', textSec: '#9a9aa5',
  border: 'rgba(255,255,255,0.1)', online: '#4CAF50',
  ...over,
});

test('ссылка на тему переносит цвета времени на сообщениях и в списке чатов', () => {
  const parsed = themeFromLink(themeToLink(baseTheme({ messageTimeColor: '#ffd166', chatTimeColor: '#8fe3cf' })));
  assert.equal(parsed.messageTimeColor, '#ffd166');
  assert.equal(parsed.chatTimeColor, '#8fe3cf');
  assert.equal(parsed.name, 'Моя тема');
  assert.ok(parsed.id >= CUSTOM_THEME_ID_START);
});

test('остальные поля темы не теряются при экспорте и импорте ссылки', () => {
  const theme = baseTheme({
    bubbleOwnText: '#00100E', bubbleOtherText: '#E7E9EA', textSec: '#71767B',
    finish: 'matte', finishAmount: 0.4, bubbleOwnGradient: 'linear-gradient(135deg, #6C5CE7, #4A3F9F)',
  });
  const parsed = themeFromLink(themeToLink(theme));
  assert.equal(parsed.bgChat, '#101010');
  assert.equal(parsed.bgBubbleOwn, '#6C5CE7');
  assert.equal(parsed.bubbleOwnText, '#00100E');
  assert.equal(parsed.bubbleOtherText, '#E7E9EA');
  assert.equal(parsed.textSec, '#71767B');
  assert.equal(parsed.finish, 'matte');
  assert.equal(parsed.finishAmount, 0.4);
  assert.equal(parsed.bubbleOwnGradient, 'linear-gradient(135deg, #6C5CE7, #4A3F9F)');
});

test('старая ссылка без ключей mt/ct читается, время остаётся со цветом из темы', () => {
  // Так выглядела ссылка до появления отдельных цветов времени.
  const legacy = Buffer.from(JSON.stringify({
    n: 'Old', b: '#000000', t: '#ffffff', a: '#00ff00', ts: '#aaaaaa',
  }), 'utf8').toString('base64');
  const parsed = themeFromLink(legacy);
  assert.equal(parsed.name, 'Old');
  assert.equal(parsed.textSec, '#aaaaaa');
  assert.equal(parsed.messageTimeColor, undefined);
  assert.equal(parsed.chatTimeColor, undefined);
});

test('тема без своих цветов времени не получает их после круга по ссылке', () => {
  const parsed = themeFromLink(themeToLink(baseTheme()));
  assert.equal(parsed.messageTimeColor, undefined);
  assert.equal(parsed.chatTimeColor, undefined);
  assert.ok(themeToLink(baseTheme()).length > 0);
});

test('битая ссылка возвращает null и не бросает исключение', () => {
  assert.equal(themeFromLink('совсем не ссылка'), null);
  assert.equal(themeFromLink(''), null);
  assert.equal(themeFromLink('12345'), null);
});
