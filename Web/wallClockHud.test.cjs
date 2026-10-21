/**
 * Свой HUD вместо встроенных часов: HTML или ссылка в sandbox-iframe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const settings = read('src/store/userSettingsStore.ts');
const clock = read('src/components/WallClockOverlay.tsx');
const panels = read('src/components/ThemeSettingsPanels.tsx');

// normalizeHudUrl вырезаем из исходника и выполняем: без сборки TS-модуля.
function loadNormalize() {
  const start = settings.indexOf('export function normalizeHudUrl');
  // Файл может быть с CRLF: конец функции ищем регуляркой, а не по '\n}\n'.
  const tail = settings.slice(start);
  const end = tail.search(/\r?\n\}\r?\n/) + tail.match(/\r?\n\}/)[0].length;
  const src = tail.slice(0, end)
    .replace('export function', 'function')
    .replace('(raw: string): string | null', '(raw)');
  return new Function(`${src}; return normalizeHudUrl;`)();
}

test('ссылка HUD: только http(s)', () => {
  const norm = loadNormalize();
  assert.equal(norm('https://example.com/c.html'), 'https://example.com/c.html');
  assert.equal(norm('  http://a.b/  '), 'http://a.b/');
  assert.equal(norm('javascript:alert(1)'), null);
  assert.equal(norm('data:text/html,<b>x</b>'), null);
  assert.equal(norm('не ссылка'), null);
  assert.equal(norm(''), null);
});

test('настройки HUD объявлены, по умолчанию встроенные часы и синхронизируются', () => {
  assert.match(settings, /export type WallClockHudMode = 'builtin' \| 'html' \| 'url';/);
  assert.match(settings, /wallClockHudMode: 'builtin',/);
  const sync = settings.slice(settings.indexOf('const SYNC_KEYS'));
  for (const k of ['wallClockHudMode', 'wallClockHudHtml', 'wallClockHudUrl', 'wallClockHudHeight']) {
    assert.ok(sync.includes(`'${k}'`), `${k} в синхронизации`);
  }
});

test('HUD рисуется в sandbox без доступа к приложению', () => {
  assert.ok(clock.includes('<iframe'), 'есть iframe');
  assert.ok(clock.includes('sandbox={sandbox}'), 'sandbox задан');
  // Свой HTML никогда не получает allow-same-origin: иначе скрипт достал бы токен из localStorage.
  assert.match(clock, /: 'allow-scripts';/);
  assert.ok(clock.includes('sameOriginUrl'), 'ссылка на свой же origin без allow-same-origin');
  assert.ok(!clock.includes('dangerouslySetInnerHTML'), 'HTML не вставляется в DOM приложения');
  assert.ok(clock.includes("type: 'vera-clock'"), 'HUD получает время сообщением');
  assert.ok(clock.includes('normalizeHudUrl'), 'ссылка проверяется перед src');
});

test('в панели есть выбор режима и поля HUD', () => {
  assert.ok(panels.includes("s.set('wallClockHudMode', v)"));
  assert.ok(panels.includes("s.set('wallClockHudHtml'"));
  assert.ok(panels.includes("s.set('wallClockHudUrl'"));
  assert.ok(panels.includes('WALL_CLOCK_HUD_HTML_MAX'), 'длина HTML ограничена');
});
