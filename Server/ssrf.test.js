const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const net = require('node:net');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

const FN = source.slice(
  source.indexOf('function isPrivateHost('),
  source.indexOf('app.post(\'/api/ai-lmm/learn-url\''),
);
const ctx = { net };
vm.runInNewContext(FN, ctx);
const isPrivateHost = ctx.isPrivateHost;

const ROUTE = source.slice(
  source.indexOf('app.post(\'/api/ai-lmm/learn-url\''),
  source.indexOf('// Local Whisper'),
);

/**
 * SSRF: сервер ходит по ссылке, которую задаёт пользователь. Если адрес не
 * проверяется, атакующий тянет из внутренней сети сервисы, недоступные извне:
 * метаданные облака (169.254.169.254), другие контейнеры, локальный Redis.
 *
 * Раньше проверялся список из трёх строк, что обходилось десятком способов.
 */
test('приватные и служебные адреса закрыты', () => {
  const blocked = [
    'localhost', 'LOCALHOST', 'localhost.localdomain',
    '127.0.0.1', '127.0.0.2', '127.1.2.3', '0.0.0.0', '0',
    '10.0.0.5', '10.255.255.255',
    '172.16.0.1', '172.31.255.254', '192.168.1.1',
    '169.254.169.254',            // метаданные облака
    '100.64.0.1',                 // CGNAT
    'db.internal', 'redis.local', 'foo.localhost',
    '2130706433',                 // 127.0.0.1 десятичной записью
    '::1', '[::1]', '::', 'fe80::1', '::ffff:127.0.0.1',
    '', '   ',
  ];
  for (const host of blocked) {
    assert.equal(isPrivateHost(host), true, `должен быть закрыт: ${JSON.stringify(host)}`);
  }
});

test('обычные публичные адреса остаются доступными', () => {
  for (const host of ['example.com', '8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.1.1', '93.184.216.34']) {
    assert.equal(isPrivateHost(host), false, `должен быть открыт: ${host}`);
  }
});

test('редирект не обходит проверку адреса', () => {
  // fetch по умолчанию идёт по редиректам. Внешний сайт отвечает 302 на
  // 169.254.169.254, и проверка исходного URL оказывается бесполезной.
  assert.ok(/redirect: 'manual'/.test(ROUTE), 'редиректы не следуются автоматически');
  assert.ok(/isPrivateHost\(target\.hostname\)/.test(ROUTE), 'цель редиректа тоже проверяется');
});

test('роут сверяется с найденным адресом, а не только со схемой', () => {
  assert.ok(/isPrivateHost\(parsed\.hostname\)/.test(ROUTE), 'исходный адрес проверяется');
});

test('функция проверки адреса нигде не подменена на список строк', () => {
  assert.ok(
    !/\['localhost', '127\.0\.0\.1'/.test(ROUTE),
    'старый список из трёх адресов больше не используется',
  );
});