const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { archive, blocked, install } = require('./moderation');
const moderation = require('./moderation');

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function createHarness() {
  const db = {
    users: [
      { id: 'reporter', username: 'reporter' },
      { id: 'target', username: 'target' },
      { id: 'admin', username: 'moderator' },
    ],
    chats: [{ id: 'chat-1', name: 'Общий чат', type: 'direct' }],
    chatMembers: [
      { id: 'member-1', chatId: 'chat-1', userId: 'reporter' },
      { id: 'member-2', chatId: 'chat-1', userId: 'target' },
    ],
    messages: [
      { id: 'live-1', chatId: 'chat-1', senderId: 'target', text: 'Остаюсь в чате', createdAt: '2026-01-01T00:00:02.000Z' },
    ],
    deletedMessages: [],
    reports: [],
    devices: [{ id: 'device-1', userId: 'target', deviceId: 'target-device', installationHash: 'target-hash' }],
    moderationIps: { target: ['203.0.113.10', '198.51.100.10'] },
    moderationBans: [],
    moderationWarnings: [],
    ipBans: [],
  };
  const notifications = [];
  const disconnects = [];
  const app = express();
  app.use(express.json());
  const auth = (req, _res, next) => {
    req.userId = String(req.headers['x-user'] || '');
    next();
  };
  install({
    app,
    getDb: () => db,
    saveDb: () => {},
    auth,
    isAdmin: (req) => req.headers['x-admin'] === '1',
    isAdminUsername: (username) => String(username).toLowerCase() === 'moderator',
    requestIp: () => '203.0.113.10',
    notify: (...args) => notifications.push(args),
    disconnect: (...args) => disconnects.push(args),
  });
  return { app, db, notifications, disconnects };
}

async function start(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function request(base, path, options = {}) {
  return fetch(base + path, options);
}

const DAY = 24 * 60 * 60 * 1000;
const adminJson = { 'x-user': 'admin', 'x-admin': '1', 'content-type': 'application/json' };
const closeServer = (server) => new Promise((resolve) => server.close(resolve));

async function fileReport(base, targetId = 'target', fields = {}) {
  const form = new FormData();
  form.set('targetId', targetId);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await request(base, '/api/reports', { method: 'POST', headers: { 'x-user': 'reporter' }, body: form });
  assert.equal(response.status, 201);
  return (await response.json()).id;
}

function decide(base, id, body) {
  return request(base, `/api/admin/reports/${id}/decision`, { method: 'POST', headers: adminJson, body: JSON.stringify(body) });
}

function setAutoDelete(base, id, body) {
  return request(base, `/api/admin/reports/${id}/auto-delete`, { method: 'PATCH', headers: adminJson, body: JSON.stringify(body) });
}

test('бан по IP закрывает аккаунт и включает автоудаление, которое можно выключить и перенести', async () => {
  assert.deepEqual(moderation.parseAutoDelete(undefined, 'temporary').value, { enabled: false, days: 7 });
  assert.ok(moderation.parseAutoDelete({ enabled: true }, 'warn').error, 'у предупреждения автоудаления нет');
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    const id = await fileReport(base);
    assert.equal((await decide(base, id, { action: 'ip', reason: 'Нарушение', minutes: 0 })).status, 200);
    const decision = harness.db.reports.find((report) => report.id === id).decision;
    assert.deepEqual(decision.autoDelete, { enabled: true, days: 7 });
    assert.equal(blocked(harness.db, 'target'), true, 'с другого IP аккаунт тоже не войдёт');
    assert.equal(harness.notifications.at(-1)[4].appealReportId, id, 'под уведомлением кнопка апелляции');
    const at = Date.parse(decision.at);

    // Открытая апелляция откладывает удаление.
    harness.db.appeals = [{ id: 'appeal-1', userId: 'target', reportId: id, status: 'open' }];
    assert.deepEqual(moderation.runAutoDeletions(harness.db, at + 8 * DAY), []);
    harness.db.appeals[0].status = 'resolved';

    assert.equal((await setAutoDelete(base, id, { enabled: false })).status, 200);
    assert.deepEqual(moderation.runAutoDeletions(harness.db, at + 8 * DAY), []);
    assert.equal((await setAutoDelete(base, id, { enabled: true, days: 0 })).status, 400);
    assert.equal((await setAutoDelete(base, id, { enabled: true, days: 30 })).status, 200);
    assert.deepEqual(moderation.runAutoDeletions(harness.db, at + 8 * DAY), []);
    assert.deepEqual(moderation.runAutoDeletions(harness.db, at + 31 * DAY), ['target']);
    assert.deepEqual(moderation.runAutoDeletions(harness.db, at + 32 * DAY), [], 'второй раз не удаляет');

    const user = harness.db.users.find((candidate) => candidate.id === 'target');
    assert.equal(user.accountDeleted, true);
    assert.match(user.username, /^deleted_/);
    assert.equal(user.passwordHash, null);
    assert.equal(harness.db.devices[0].revoked, true);
    assert.ok(harness.db.ipBans.length, 'IP остаётся заблокированным');
  } finally {
    await closeServer(server);
  }
});

test('удаление бота и мини-приложения получает владелец, апелляция их возвращает', async () => {
  const harness = createHarness();
  harness.db.users.push({ id: 'bot-user', username: 'spam_bot', firstName: 'Спам', isBot: true, botOwnerId: 'target' });
  harness.db.bots = [{
    id: 'bot-1', userId: 'bot-user', ownerId: 'target', username: 'spam_bot', name: 'Спам', tokenHash: 'hash',
    apps: [{ shortName: 'shop', title: 'Магазин', url: 'https://example.com/shop' }],
  }];
  const { server, base } = await start(harness.app);
  try {
    const appReport = await fileReport(base, 'bot-user', { targetType: 'bot' });
    const appResponse = await decide(base, appReport, { action: 'delete', reason: 'Фишинг', minutes: 0, appShortName: 'shop' });
    assert.equal(appResponse.status, 200);
    assert.equal('restore' in (await appResponse.json()), false, 'снимок бота не уходит клиенту');
    assert.deepEqual(harness.db.bots[0].apps, []);
    assert.equal(harness.notifications.at(-1)[1], 'target', 'решение получает владелец бота');
    assert.equal(moderation.decisionForAppeal(harness.db, 'target', appReport).label, 'Удаление мини-приложения shop');
    assert.equal(moderation.decisionForAppeal(harness.db, 'reporter', appReport).code, 404);
    const first = harness.db.reports.find((report) => report.id === appReport);
    assert.deepEqual(moderation.overturnDecision(harness.db, first, 'admin'), { ok: true, restored: true });
    assert.equal(harness.db.bots[0].apps[0].shortName, 'shop');

    const userReport = await fileReport(base);
    assert.equal((await decide(base, userReport, { action: 'delete', reason: 'Нет', minutes: 0 })).status, 400,
      'человека удалить решением нельзя');

    const botReport = await fileReport(base, 'bot-user', { targetType: 'bot' });
    assert.equal((await decide(base, botReport, { action: 'delete', reason: 'Спам', minutes: 0 })).status, 200);
    const botUser = harness.db.users.find((candidate) => candidate.id === 'bot-user');
    assert.equal(harness.db.bots.length, 0);
    assert.equal(botUser.botDeleted, true);
    moderation.overturnDecision(harness.db, harness.db.reports.find((report) => report.id === botReport), 'admin');
    assert.equal(harness.db.bots.length, 1);
    assert.equal(botUser.username, 'spam_bot');
    assert.equal(botUser.botDeleted, false);
  } finally {
    await closeServer(server);
  }
});

test('reports accept an optional comment and validate/upload a PNG photo', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    const form = new FormData();
    form.set('targetId', 'target');
    form.set('chatId', 'chat-1');
    form.set('photo', new Blob([png], { type: 'image/png' }), 'evidence.png');
    const response = await request(base, '/api/reports', {
      method: 'POST', headers: { 'x-user': 'reporter' }, body: form,
    });
    assert.equal(response.status, 201);
    const report = harness.db.reports[0];
    assert.equal(report.comment, '');
    assert.equal(report.photo.mime, 'image/png');
    assert.equal(harness.notifications.length, 1);
    assert.match(harness.notifications[0][2], new RegExp(`/admin\\?report=${report.id}`));

    const invalid = new FormData();
    invalid.set('targetId', 'target');
    invalid.set('photo', new Blob(['not an image'], { type: 'image/png' }), 'bad.png');
    const invalidResponse = await request(base, '/api/reports', {
      method: 'POST', headers: { 'x-user': 'reporter' }, body: invalid,
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('admin-only history merges live and archived messages and photo access is protected', async () => {
  const harness = createHarness();
  archive(harness.db, [{
    id: 'deleted-1', chatId: 'chat-1', senderId: 'target', text: 'Удалённое доказательство',
    createdAt: '2026-01-01T00:00:01.000Z',
  }], 'target');
  const { server, base } = await start(harness.app);
  try {
    const form = new FormData();
    form.set('targetId', 'target');
    form.set('chatId', 'chat-1');
    form.set('comment', 'Нужна проверка');
    form.set('photo', new Blob([png], { type: 'image/png' }), 'evidence.png');
    const created = await request(base, '/api/reports', {
      method: 'POST', headers: { 'x-user': 'reporter' }, body: form,
    });
    const reportId = (await created.json()).id;

    const forbidden = await request(base, `/api/admin/reports/${reportId}/photo`, {
      headers: { 'x-user': 'reporter' },
    });
    assert.equal(forbidden.status, 403);

    const photoResponse = await request(base, `/api/admin/reports/${reportId}/photo`, {
      headers: { 'x-user': 'admin', 'x-admin': '1' },
    });
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get('content-type'), 'image/png');

    const historyResponse = await request(base, `/api/admin/reports/${reportId}/messages`, {
      headers: { 'x-user': 'admin', 'x-admin': '1' },
    });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.total, 2);
    assert.deepEqual(history.messages.map((message) => message.id), ['deleted-1', 'live-1']);
    assert.equal(history.messages[0].isDeleted, true);
    assert.equal(history.messages[0].sender.username, 'target');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('warning and temporary account ban decisions persist, expire, disconnect, and cannot repeat', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    const createReport = async () => {
      const form = new FormData();
      form.set('targetId', 'target');
      form.set('chatId', 'chat-1');
      const response = await request(base, '/api/reports', {
        method: 'POST', headers: { 'x-user': 'reporter' }, body: form,
      });
      assert.equal(response.status, 201);
      return (await response.json()).id;
    };

    const warningId = await createReport();
    const warning = await request(base, `/api/admin/reports/${warningId}/decision`, {
      method: 'POST', headers: { 'x-user': 'admin', 'x-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'warn', reason: 'Осторожнее', minutes: 0 }),
    });
    assert.equal(warning.status, 200);
    assert.equal(harness.db.moderationWarnings.length, 1);
    assert.equal(harness.db.moderationBans.length, 0);
    assert.equal(harness.notifications.at(-1)[1], 'target');

    const repeated = await request(base, `/api/admin/reports/${warningId}/decision`, {
      method: 'POST', headers: { 'x-user': 'admin', 'x-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', reason: 'Повторно', minutes: 0 }),
    });
    assert.equal(repeated.status, 409);

    const banId = await createReport();
    const ban = await request(base, `/api/admin/reports/${banId}/decision`, {
      method: 'POST', headers: { 'x-user': 'admin', 'x-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'temporary', reason: 'Нарушение правил', minutes: 1 }),
    });
    assert.equal(ban.status, 200);
    assert.equal(blocked(harness.db, 'target', 'target-device'), true);
    assert.equal(harness.disconnects.at(-1)[0], 'target');

    harness.db.moderationBans[0].expiresAt = Date.now() - 1;
    assert.equal(blocked(harness.db, 'target', 'target-device'), false);

    const ipReportId = await createReport();
    const ipDecision = await request(base, `/api/admin/reports/${ipReportId}/decision`, {
      method: 'POST', headers: { 'x-user': 'admin', 'x-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ip', reason: 'Общий IP нарушителя', minutes: 10 }),
    });
    assert.equal(ipDecision.status, 200);
    assert.deepEqual(harness.db.ipBans.map((ban) => ban.ip), ['198.51.100.10']);
    assert.deepEqual(harness.disconnects.at(-1), ['target', ['198.51.100.10']]);

    const deviceReportId = await createReport();
    const deviceDecision = await request(base, `/api/admin/reports/${deviceReportId}/decision`, {
      method: 'POST', headers: { 'x-user': 'admin', 'x-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'device', reason: 'Устройство нарушителя', minutes: 10 }),
    });
    assert.equal(deviceDecision.status, 200);
    assert.equal(blocked(harness.db, null, 'target-device'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('режим только чтения: вход открыт, писать и создавать нельзя, читать и обжаловать можно', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    const id = await fileReport(base);
    assert.equal((await decide(base, id, { action: 'readonly', reason: 'Спам', minutes: 0 })).status, 200);
    assert.equal(blocked(harness.db, 'target'), false, 'войти можно');
    assert.equal(moderation.readOnly(harness.db, 'target'), true);
    assert.equal(moderation.creationBanned(harness.db, 'target'), true);
    assert.equal(moderation.readOnly(harness.db, 'reporter'), false);
    assert.equal(harness.disconnects.length, 0, 'из сети не выкидывает');
    assert.equal(harness.notifications.at(-1)[4].appealReportId, id);

    assert.equal(moderation.readOnlyAllows('POST', '/api/messages/chat-1/send'), false);
    assert.equal(moderation.readOnlyAllows('PUT', '/api/messages/message-1'), false);
    assert.equal(moderation.readOnlyAllows('POST', '/api/bots/create'), false);
    assert.equal(moderation.readOnlyAllows('GET', '/api/chats'), true);
    assert.equal(moderation.readOnlyAllows('POST', '/api/appeals'), true);
    assert.equal(moderation.readOnlyAllows('POST', '/api/messages/message-1/read'), true);
    assert.ok(moderation.READ_ONLY_SOCKET_EVENTS.has('message:send'));

    const nobots = await fileReport(base);
    assert.equal((await decide(base, nobots, { action: 'nobots', reason: 'Фишинговые боты', minutes: 60 })).status, 200);
    const ban = harness.db.moderationBans.find((item) => item.kind === 'bots');
    assert.ok(ban.expiresAt > Date.now(), 'у запрета есть срок');
  } finally {
    await closeServer(server);
  }
});

test('админ открывает чат по ссылке: живые и удалённые сообщения с вложениями, просмотр в журнале', async () => {
  const harness = createHarness();
  harness.db.deletedMessages.push({
    id: 'deleted-9', chatId: 'chat-1', senderId: 'target', text: 'Удалил',
    attachments: [{ fileUrl: '/uploads/files/evidence.png' }], isDeleted: true, createdAt: '2026-01-01T00:00:01.000Z',
  });
  const { server, base } = await start(harness.app);
  const link = encodeURIComponent('https://vera.example/#/chat/chat-1');
  try {
    const forbidden = await request(base, `/api/admin/chats/lookup?link=${link}`, { headers: { 'x-user': 'reporter' } });
    assert.equal(forbidden.status, 403);

    const response = await request(base, `/api/admin/chats/lookup?link=${link}`, { headers: adminJson });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.chat.id, 'chat-1');
    assert.deepEqual(data.messages.map((message) => message.id), ['deleted-9', 'live-1']);
    assert.equal(data.messages[0].isDeleted, true);
    assert.equal(data.messages[0].attachments[0].fileUrl, '/uploads/files/evidence.png');
    assert.equal(data.members.length, 2);
    assert.equal(harness.db.adminAudit.at(-1).chatId, 'chat-1');

    const missing = await request(base, `/api/admin/chats/lookup?link=${encodeURIComponent('/#/chat/nope')}`, { headers: adminJson });
    assert.equal(missing.status, 404);
    assert.equal(moderation.parseChatLink('chat-1'), 'chat-1');
    assert.equal(moderation.parseChatLink('../../etc'), null);
  } finally {
    await closeServer(server);
  }
});