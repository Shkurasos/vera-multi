const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { archive, blocked, install } = require('./moderation');

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