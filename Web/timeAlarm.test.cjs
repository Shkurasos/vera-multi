/**
 * Команда чата /time и будильники карточек доски.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const ctx = vm.createContext({ console, exports: {}, module: { exports: {} }, require: () => ({}) });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  return ctx.module.exports;
}

const { parseTimeCommand, formatDelay, MAX_TIME_DELAY_MS } = load('src/utils/timeCommand.ts');
const {
  emptyBoard, addItem, setItemAlarm, alarmKey, dueAlarms, toDateTimeLocal, parseDateTimeLocal,
} = load('src/utils/deskBoard.ts');

const plain = (v) => JSON.parse(JSON.stringify(v));

// ── /time ─────────────────────────────────────────────────────────────────────

test('обычный текст — не команда', () => {
  assert.equal(parseTimeCommand('привет'), null);
  assert.equal(parseTimeCommand('/timer 00:00:05 "x"'), null, '/timer — другое слово');
});

test('разбирает задержку и текст в кавычках', () => {
  assert.deepEqual(plain(parseTimeCommand('/time 01:02:03 "Позвони маме"')), { delayMs: 3723000, text: 'Позвони маме' });
  assert.deepEqual(plain(parseTimeCommand('/time 0:0:5 «ёлочки»')), { delayMs: 5000, text: 'ёлочки' });
  assert.deepEqual(plain(parseTimeCommand('/time 00:00:10 без кавычек')), { delayMs: 10000, text: 'без кавычек' });
  assert.deepEqual(plain(parseTimeCommand('/time 00:00:10 "две\nстроки"')), { delayMs: 10000, text: 'две\nстроки' });
});

test('неверная команда — ошибка, а не отправка как есть', () => {
  for (const bad of ['/time', '/time 10 "x"', '/time 00:61:00 "x"', '/time 00:00:60 "x"', '/time 00:00:00 "x"', '/time 00:00:05 ""']) {
    assert.ok('error' in parseTimeCommand(bad), bad);
  }
});

test('предел 99:59:59 совпадает с сервером', () => {
  assert.equal(parseTimeCommand('/time 99:59:59 "x"').delayMs, MAX_TIME_DELAY_MS);
  assert.equal(MAX_TIME_DELAY_MS, require('../Server/scheduled-messages').MAX_DELAY_MS);
});

test('formatDelay', () => {
  assert.equal(formatDelay(3723000), '1 ч 2 мин 3 с');
  assert.equal(formatDelay(60000), '1 мин');
});

// ── Будильники ────────────────────────────────────────────────────────────────

const note = (id) => ({ id, kind: 'note', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 1, createdAt: 1 });
const folder = (id) => ({ ...note(id), kind: 'folder' });

test('setItemAlarm ставит и снимает, папкам — нет', () => {
  let b = addItem(addItem(emptyBoard(), note('a')), folder('f'));
  b = setItemAlarm(b, 'a', 5000);
  assert.equal(b.items.find((i) => i.id === 'a').alarmAt, 5000);
  assert.equal(setItemAlarm(b, 'f', 5000), b, 'папка не меняется');
  b = setItemAlarm(b, 'a', null);
  assert.equal('alarmAt' in b.items.find((i) => i.id === 'a'), false);
});

test('dueAlarms: только наступившие и не выключенные', () => {
  let b = addItem(addItem(emptyBoard(), note('a')), note('b'));
  b = setItemAlarm(setItemAlarm(b, 'a', 2000), 'b', 1000);
  assert.deepEqual(plain(dueAlarms(b, 1500).map((i) => i.id)), ['b']);
  assert.deepEqual(plain(dueAlarms(b, 3000).map((i) => i.id)), ['b', 'a']);
  const off = new Set([alarmKey({ id: 'b', alarmAt: 1000 })]);
  assert.deepEqual(plain(dueAlarms(b, 3000, off).map((i) => i.id)), ['a']);
  // Перенос будильника — новый ключ, выключение старого не мешает.
  b = setItemAlarm(b, 'b', 2500);
  assert.deepEqual(plain(dueAlarms(b, 3000, off).map((i) => i.id)), ['a', 'b']);
});

test('datetime-local туда и обратно, битые даты — null', () => {
  const ms = new Date(2026, 9, 13, 14, 5).getTime();
  assert.equal(toDateTimeLocal(ms), '2026-10-13T14:05');
  assert.equal(parseDateTimeLocal('2026-10-13T14:05'), ms);
  assert.equal(parseDateTimeLocal('2026-02-31T10:00'), null);
  assert.equal(parseDateTimeLocal(''), null);
});
