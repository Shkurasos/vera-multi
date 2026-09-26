const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

// Загружаем те же куски server.js, что и message-actions.test.js:
// messageSender + handleSendMessage со валидацией вложений.
function setup() {
  let sequence = 0;
  const routes = {};
  const context = {
    db: {
      chats: [{ id: 'chat1', type: 'direct' }],
      users: [{ id: 'alice', username: 'Alice' }],
      messages: [],
      chatMembers: [{ chatId: 'chat1', userId: 'alice', role: 'member' }],
    },
    uuidv4: () => `id-${++sequence}`,
    MESSAGE_MAX_LEN: 10000,
    EDIT_WINDOW_MS: 172800000,
    authMiddleware() {},
    io: { to: () => ({ emit() {} }) },
    saveDb() {},
    app: Object.fromEntries(['post', 'get', 'put'].map((method) =>
      [method, (url, auth, fn) => { routes[method + ' ' + url] = fn; }])),
  };
  for (const [start, end] of [
    ['function messageSender(', '// POST /api/messages/:chatId  (base route)'],
    ['function getPinnedMessage(', '// Общий обработчик отправки сообщения'],
  ]) vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  const send = (body) => { const res = response(); context.handleSendMessage('chat1', 'alice', body, res); return res; };
  return { send, response };
}

test('опасные URL вложений (javascript:, data:text/html, //evil) отбрасываются', () => {
  const { send } = setup();
  const res = send({
    text: 'hi',
    attachments: [
      { fileUrl: 'javascript:alert(document.cookie)', mimeType: 'image/png' },
      { fileUrl: 'data:text/html,<script>alert(1)</script>', mimeType: 'text/html' },
      { fileUrl: '//evil.com/x.png', mimeType: 'image/png' },
      { fileUrl: '/uploads/../etc/passwd', mimeType: 'image/png' },
      { fileUrl: '/uploads/files/ok.png', mimeType: 'image/png', fileName: 'ok.png', size: 123 },
    ],
  });
  assert.equal(res.code, 201);
  const urls = [...res.data.attachments].map((a) => a.fileUrl);
  assert.deepEqual(urls, ['/uploads/files/ok.png']);
});

test('MIME санится (svg/html не проходят), data:image и относительные пути — остаются', () => {
  const { send } = setup();
  const res = send({
    text: 'x',
    attachments: [
      { fileUrl: '/uploads/files/a.png', mimeType: 'image/svg+xml' },
      { fileUrl: '/uploads/files/b.png', mimeType: 'text/html' },
      { fileUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
      { fileUrl: '/one.png', mimeType: 'application/pdf' },
    ],
  });
  assert.equal(res.code, 201);
  const items = [...res.data.attachments];
  assert.equal(items.length, 4);
  assert.equal(items[0].mimeType, ''); // svg запрещён
  assert.equal(items[1].mimeType, ''); // text/html запрещён
  assert.equal(items[2].fileUrl, 'data:image/png;base64,AAAA');
  assert.equal(items[3].fileUrl, '/one.png');
  assert.equal(items[3].mimeType, 'application/pdf');
});

test('сообщение без текста и только с опасными вложениями не создаётся', () => {
  const { send } = setup();
  const res = send({ attachments: [{ fileUrl: 'javascript:alert(1)' }] });
  assert.equal(res.code, 400);
  assert.match(res.data.message, /Пустое/);
});

test('лимиты: имя файла очищается от управляющих символов, размер ограничен', () => {
  const { send } = setup();
  const res = send({
    text: 'x',
    attachments: [{
      fileUrl: '/uploads/files/c.png',
      fileName: 'bad\u0000name\n.txt',
      fileSize: Number.MAX_SAFE_INTEGER,
      mimeType: 'image/png',
    }],
  });
  assert.equal(res.code, 201);
  const item = [...res.data.attachments][0];
  assert.ok(!/[\u0000\n]/.test(item.fileName));
  assert.equal(item.fileSize, 200 * 1024 * 1024);
});