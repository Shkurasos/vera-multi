/**
 * Стандартный звук прихода сообщения.
 *
 * Звук синтезируется формулами, а не грузится файлом: у сэмпла есть автор, и
 * даже «похожий на айфоновский» риск — это копия. Проверяем и план звука, и то,
 * что синтез не расползся по проекту копиями.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const source = read('src/utils/notificationSound.ts');

// Без окна (SSR, юнит-тест чистых чисел): звук не падает, а отказывает.
const bare = vm.createContext({ console, exports: {}, module: { exports: {} }, window: undefined });
bare.exports = bare.module.exports;
vm.runInContext(
  ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
  bare,
);
const { notificationVoice, nextDrift, playVoice, playDefaultChime } = bare.exports;

/** Минимальный эмулятор Web Audio: считает, что создали. */
function loadWithFakeAudio() {
  const stats = { contexts: 0, oscillators: 0, gains: 0, filters: 0, started: 0 };
  const param = (v = 0) => ({
    value: v,
    setValueAtTime(x) { this.value = x; },
    linearRampToValueAtTime(x) { this.value = x; },
    exponentialRampToValueAtTime(x) { this.value = x; },
  });
  class Node {
    connect() {}
    start() { stats.started += 1; }
    stop() {}
  }
  class FakeCtx {
    constructor() { stats.contexts += 1; }
    get currentTime() { return 0; }
    get state() { return 'running'; }
    get destination() { return new Node(); }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createOscillator() { stats.oscillators += 1; const n = new Node(); n.frequency = param(440); n.type = 'sine'; return n; }
    createGain() { stats.gains += 1; const n = new Node(); n.gain = param(0); return n; }
    createBiquadFilter() { stats.filters += 1; const n = new Node(); n.frequency = param(350); n.Q = param(1); return n; }
  }
  const c = vm.createContext({ console, exports: {}, module: { exports: {} }, window: { AudioContext: FakeCtx } });
  c.exports = c.module.exports;
  vm.runInContext(
    ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
    c,
  );
  return { mod: c.exports, stats };
}
test('звук — это мягкий тинг из двух нот, а не писк', () => {
  const notes = notificationVoice(1, 0);
  assert.equal(notes.length, 2, 'две ноты: открывающая и отвечающая');
  assert.equal(notes[0].at, 0, 'первая звучит сразу');
  assert.ok(notes[1].at > 0, 'вторая приходит чуть позже');
  // Вторая нота выше первой — так звук читается как «уведомление», а не «пик».
  assert.ok(notes[1].freq > notes[0].freq, 'вторая нота выше');
  for (const n of notes) {
    assert.ok(n.freq > 200 && n.freq < 3000, `частота в человеческом диапазоне: ${n.freq}`);
    assert.ok(n.dur > 0.2, 'звук длиннее щелчка');
  }
});

test('громкость уважается и защищена от мусора', () => {
  assert.equal(notificationVoice(0)[0].gain, 0, 'тишина — это тишина');
  assert.ok(notificationVoice(1)[0].gain > notificationVoice(0.5)[0].gain, 'громче — громче');
  for (const bad of [undefined, null, NaN, 'x', {}]) {
    const notes = notificationVoice(bad);
    assert.ok(Number.isFinite(notes[0].gain), `выживает: ${bad}`);
    assert.ok(notes[0].gain > 0, `и звучит по умолчанию: ${bad}`);
  }
  // Отрицательное и >1 — это «выкрученный» ползунок, а не громче максимума.
  assert.equal(notificationVoice(-5)[0].gain, 0, 'отрицательная громкость = тишина');
  assert.equal(notificationVoice(99)[0].gain, notificationVoice(1)[0].gain, 'больше 100% не громче');
});

test('лёгкий расстрой есть, но он незаметен', () => {
  // Смысл: очередь сообщений не должна звучать механически. Но расстрой
  // настолько мал, что сам по себе запись не опознаётся.
  const values = [0, 0.5, 1].map((r) => nextDrift(() => r));
  assert.ok(Math.abs(values[0] - values[2]) <= 4, `разброс мал: ${values.join(', ')} цента`);
  assert.equal(values[1], 0, 'середина диапазона — без смещения');
  const plain = notificationVoice(1, 0)[0].freq;
  const drifted = notificationVoice(1, 2)[0].freq;
  assert.notEqual(plain, drifted, 'частота слегка меняется');
});

test('обертоны приглушены, чтобы не было резкого звона', () => {
  const partials = notificationVoice(1)[0].partials;
  assert.equal(partials[0].ratio, 1, 'основной тон');
  assert.ok(partials.length > 1, 'есть верхние обертоны — характер стеклянный');
  for (const p of partials.slice(1)) assert.ok(p.level < 0.35, `обертон ${p.ratio} тихий: ${p.level}`);
  assert.equal(partials[0].level, 1, 'основной тон самый громкий');
});

test('синтез живёт в одном файле, а не размазан копиями', () => {
  // Раньше одинаковый beep был продублирован в четырёх местах, и правки
  // разъезжались: в настройках звучал один, в уведомлениях другой.
  const copies = [
    'src/App.tsx', 'src/components/ChatWindow.tsx',
    'src/components/NotificationSettingsDialog.tsx', 'src/components/GlobalSoundSettingsDialog.tsx',
  ];
  for (const f of copies) {
    assert.ok(!/setValueAtTime\(880/.test(read(f)), `${f}: старый beep вырезан`);
    assert.ok(read(f).includes('notificationSound'), `${f}: использует общий синтез`);
  }
});

test('без браузера звук не падает, а молча отказывает', () => {
  assert.equal(playVoice(notificationVoice(1)), false);
  assert.equal(playDefaultChime(1), false);
  assert.equal(playDefaultChime(0), false, 'при нулевой громкости даже не создаём контекст');
});

test('звук действительно синтезируется, а не молча падает', () => {
  const { mod, stats } = loadWithFakeAudio();
  assert.equal(mod.playDefaultChime(1), true, 'проигрывание удалось');
  // Две ноты × три обертона — ровно столько осцилляторов должно быть создано.
  assert.equal(stats.oscillators, 6, 'обе ноты с тремя обертонами каждая');
  assert.equal(stats.started, 6, 'все осцилляторы запущены');
  assert.equal(stats.filters, 2, 'по фильтру на ноту');
  assert.ok(stats.gains >= 6, 'огибающие и уровни обертонов созданы');
});

test('AudioContext создаётся один на всё приложение', () => {
  // Новый контекст на каждое сообщение — это подтормаживания; ради этого
  // синтез и вынесен в отдельный модуль.
  const { mod, stats } = loadWithFakeAudio();
  mod.playDefaultChime(1);
  mod.playDefaultChime(1);
  mod.playDefaultChime(0.4);
  assert.equal(stats.contexts, 1, 'контекст один');
  assert.equal(stats.oscillators, 18, 'но звук играет каждый раз');
});

test('контекст освобождается и создаётся заново', () => {
  const { mod, stats } = loadWithFakeAudio();
  mod.playDefaultChime(1);
  mod.disposeNotificationSound();
  mod.playDefaultChime(1);
  assert.equal(stats.contexts, 2, 'после освобождения контекст создаётся снова');
});