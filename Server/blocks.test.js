const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { install, isBlockedBy, blockedInChat, ensureCollections } = require('./blocks');

function createHarness() {
  const db = {
    users: [
      { id: 'alice', username: 'alice' },
      { id: 'bob', username: 'bob' },
      { id: 'carol', username: 'carol' },
      { id: 'admin', username: 'moderator' },
    ],
    chatMembers: [
      { chatId: 'chat-ab', userId: 'alice' },
      { chatId: 'chat-ab', userId: 'bob' },
      { chatId: 'chat-bc', userId: 'bob' },
      { chatId: 'chat-bc', userId: 'carol' },
    ],
    moderationBans: [],
    // В реальном сервере эти коллекции создаются на старте (server.js), поэтому
    // и в тесте они есть: иначе проверка до первого запроса упала бы на undefined.
    userBlocks: [],
    appeals: [],
  };
  const notifications = [];
  const app = express();
  app.use(express.json());
  install({
    app,
    getDb: () => db,
    saveDb: () => {},
    // auth повторяет поведение настоящего authMiddleware: без токена 401.
    // Иначе тест «забаненный не пройдёт по JWT» ничего бы не проверял.
    auth: (req, res, next) => {
      if (req.headers['x-token'] !== 'ok') return res.status(401).json({ message: 'Unauthorized' });
      req.userId = String(req.headers['x-user'] || '');
      next();
    },
    isAdmin: (req) => req.headers['x-admin'] === '1',
    isAdminUsername: (username) => String(username).toLowerCase() === 'moderator',
    notify: (...args) => notifications.push(args),
    blocked: (userId) => (db.moderationBans || []).some((ban) => ban.userId === userId),
    // Установка опознаётся по cookie: печенье 'sess=bob' → пользователь bob.
    resolveInstallationUser: (req) => {
      const raw = String(req.headers.cookie || '');
      const match = raw.match(/sess=([a-z]+)/);
      return match ? match[1] : null;
    },
  });
  return { app, db, notifications };
}

async function start(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const asUser = (id, extra = {}) => ({ headers: { 'x-user': id, 'x-token': 'ok', ...extra } });
// content-type обязателен: express.json() разбирает тело только с ним.
const asUserJson = (id) => ({ headers: { 'x-user': id, 'x-token': 'ok', 'content-type': 'application/json' } });
const asAdmin = { headers: { 'x-user': 'admin', 'x-admin': '1', 'x-token': 'ok', 'content-type': 'application/json' } };
// Принимает объект вида { headers }, как его возвращают asUser/asUserJson/asAdmin:
// иначе заголовки уедут вложенными (headers.headers) и content-type не дойдёт,
// а express.json() оставит req.body пустым.
const json = (opts, body) => ({ method: 'POST', headers: opts.headers, body: JSON.stringify(body) });
const sendAppeal = (base, id, text) => fetch(`${base}/api/appeals`, json(asUserJson(id), { text }));
const blockUser = (base, id, target) => fetch(`${base}/api/users/${target}/block`, { method: 'POST', ...asUser(id) });

test('блокировка односторонняя и действует только там, где есть блокирующий', () => {
  const db = {
    userBlocks: [{ blockerId: 'alice', blockedId: 'bob' }],
    chatMembers: [
      { chatId: 'chat-ab', userId: 'alice' },
      { chatId: 'chat-ab', userId: 'bob' },
      { chatId: 'chat-bc', userId: 'bob' },
      { chatId: 'chat-bc', userId: 'carol' },
    ],
  };
  assert.equal(isBlockedBy(db, 'alice', 'bob'), true);
  assert.equal(isBlockedBy(db, 'bob', 'alice'), false, 'блокировка односторонняя');
  assert.equal(isBlockedBy(db, 'alice', 'carol'), false);

  assert.equal(blockedInChat(db, 'chat-ab', 'bob'), true, 'Б не пишет в чат с А');
  assert.equal(blockedInChat(db, 'chat-bc', 'bob'), false, 'Б пишет в чат, где А нет');
  assert.equal(blockedInChat(db, 'chat-ab', 'alice'), false, 'сам блокирующий пишет свободно');
});

test('коллекции создаются при первом обращении, миграция БД не нужна', () => {
  const db = {};
  ensureCollections(db);
  assert.deepEqual(db.userBlocks, []);
  assert.deepEqual(db.appeals, []);
  db.userBlocks.push({ blockerId: 'a', blockedId: 'b' });
  ensureCollections(db);
  assert.equal(db.userBlocks.length, 1, 'повторный вызов не затирает данные');
});

test('блокировка создаётся один раз, повторный POST не дублирует её', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    const first = await blockUser(base, 'alice', 'bob');
    assert.equal(first.status, 201);
    assert.equal((await first.json()).already, false);
    const second = await blockUser(base, 'alice', 'bob');
    assert.equal(second.status, 200);
    assert.equal((await second.json()).already, true);
    assert.equal(harness.db.userBlocks.length, 1);
  } finally { server.close(); }
});

test('нельзя заблокировать себя, несуществующего и администратора', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    assert.equal((await blockUser(base, 'alice', 'alice')).status, 400);
    assert.equal((await blockUser(base, 'alice', 'ghost')).status, 404);
    // Админа блокировать нельзя: иначе он не сможет разобрать апелляцию.
    assert.equal((await blockUser(base, 'alice', 'admin')).status, 403);
    assert.equal(harness.db.userBlocks.length, 0, 'ни одна запись не создана');
  } finally { server.close(); }
});

test('DELETE разблокирует, повторный DELETE безопасен', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    await blockUser(base, 'alice', 'bob');
    const un = await fetch(`${base}/api/users/bob/block`, { method: 'DELETE', ...asUser('alice') });
    assert.equal(un.status, 200);
    assert.equal(harness.db.userBlocks.length, 0);
    assert.equal((await fetch(`${base}/api/users/bob/block`, { method: 'DELETE', ...asUser('alice') })).status, 200);
  } finally { server.close(); }
});

test('списки блокировок отдают только свои записи', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    await blockUser(base, 'alice', 'bob');
    const mine = await (await fetch(`${base}/api/users/blocks`, asUser('alice'))).json();
    assert.equal(mine.length, 1);
    assert.equal(mine[0].blocked.username, 'bob');
    // У Боба список «заблокированных мной» пуст, но виден блокирующий.
    assert.equal((await (await fetch(`${base}/api/users/blocks`, asUser('bob'))).json()).length, 0);
    const by = await (await fetch(`${base}/api/users/blocks/by`, asUser('bob'))).json();
    assert.equal(by.length, 1);
    assert.equal(by[0].blocker.username, 'alice');
  } finally { server.close(); }
});

test('апелляцию может подать только заблокированный или забаненный', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    // Обычному пользователю форма недоступна — иначе админов можно было бы
    // завалить спамом через /api/appeals.
    assert.equal((await sendAppeal(base, 'carol', 'хочу апелляцию')).status, 403);

    await blockUser(base, 'alice', 'bob');
    assert.equal((await sendAppeal(base, 'bob', 'блокировка несправедлива')).status, 201);
    assert.equal(harness.db.appeals.length, 1);
    assert.equal(harness.db.appeals[0].reason, 'Блокировка пользователем');
  } finally { server.close(); }
});

test('забаненный подаёт апелляцию без личной блокировки, и она уходит админам', async () => {
  const harness = createHarness();
  harness.db.moderationBans.push({ userId: 'bob', kind: 'account' });
  const { server, base } = await start(harness.app);
  try {
    assert.equal((await sendAppeal(base, 'bob', 'прошу пересмотреть бан')).status, 201);
    // Админ должен видеть, что оспаривается именно бан, а не личная блокировка.
    assert.equal(harness.db.appeals[0].reason, 'Бан аккаунта');
    const toAdmin = harness.notifications.filter(([, to]) => to === 'admin');
    assert.equal(toAdmin.length, 1, 'админ уведомлён один раз');
    assert.match(toAdmin[0][2], /прошу пересмотреть бан/);
    assert.match(toAdmin[0][2], /appeal=/, 'в уведомлении ссылка на рассмотрение');
  } finally { server.close(); }
});

test('пустая апелляция отклоняется, вторая не проходит, пока первая открыта', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    assert.equal((await sendAppeal(base, 'bob', '   ')).status, 400, 'пустой текст не принимается');

    harness.db.moderationBans.push({ userId: 'bob', kind: 'account' });
    assert.equal((await sendAppeal(base, 'bob', 'первая')).status, 201);
    assert.equal((await sendAppeal(base, 'bob', 'вторая')).status, 409);
    assert.equal(harness.db.appeals.length, 1);
  } finally { server.close(); }
});

test('GET /api/appeals/mine отдаёт статус последней апелляции', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    assert.equal(await (await fetch(`${base}/api/appeals/mine`, asUser('bob'))).json(), null);
    harness.db.moderationBans.push({ userId: 'bob', kind: 'account' });
    await sendAppeal(base, 'bob', 'текст');
    assert.equal((await (await fetch(`${base}/api/appeals/mine`, asUser('bob'))).json()).status, 'open');
  } finally { server.close(); }
});

test('список апелляций доступен только админу', async () => {
  const harness = createHarness();
  harness.db.moderationBans.push({ userId: 'bob', kind: 'account' });
  const { server, base } = await start(harness.app);
  try {
    await sendAppeal(base, 'bob', 'текст');
    assert.equal((await fetch(`${base}/api/admin/appeals`, asUser('bob'))).status, 403);
    const list = await (await fetch(`${base}/api/admin/appeals`, asAdmin)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].user.username, 'bob');
    assert.equal(list[0].status, 'open');
  } finally { server.close(); }
});

test('overturn снимает бан, uphold оставляет, повторное решение запрещено', async () => {
  const harness = createHarness();
  harness.db.moderationBans.push({ userId: 'bob', kind: 'account' });
  const { server, base } = await start(harness.app);
  try {
    await sendAppeal(base, 'bob', 'верните меня');
    const id = harness.db.appeals[0].id;
    const decide = (action) => fetch(`${base}/api/admin/appeals/${id}/decision`, json(asAdmin, { action, note: 'решение' }));

    assert.equal((await decide('uphold')).status, 200);
    assert.equal(harness.db.moderationBans.length, 1, 'при uphold бан остаётся');
    assert.equal(harness.db.appeals[0].status, 'resolved');
    assert.equal((await decide('overturn')).status, 409, 'повторное решение запрещено');

    // Успешная апелляция действительно снимает бан — и только его.
    harness.db.moderationBans.push({ userId: 'carol', kind: 'account' });
    harness.db.appeals.push({ id: 'a2', userId: 'carol', text: 't', status: 'open', createdAt: '' });
    const res = await fetch(`${base}/api/admin/appeals/a2/decision`, json(asAdmin, { action: 'overturn', note: 'ошибка' }));
    assert.equal(res.status, 200);
    assert.equal(harness.db.moderationBans.length, 1);
    assert.equal(harness.db.moderationBans[0].userId, 'bob', 'снят только бан carol');
  } finally { server.close(); }
});

test('забаненный подаёт апелляцию по cookie установки, без входа в аккаунт', async () => {
  const harness = createHarness();
  harness.db.moderationBans.push({ userId: 'bob', kind: 'account' });
  const { server, base } = await start(harness.app);
  try {
    // У забаненного НЕТ действующего JWT: verifyAccessToken бросает
    // ACCOUNT_BANNED, поэтому обычный путь с auth ему недоступен.
    const noToken = await fetch(`${base}/api/appeals`, {
      method: 'POST', headers: { 'x-user': 'bob', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'текст' }),
    });
    assert.equal(noToken.status, 401, 'без токена обычный путь закрыт');
    assert.equal(harness.db.appeals.length, 0, 'и апелляция не создалась');

    // Поэтому у него остаётся вход по cookie его установки.
    const res = await fetch(`${base}/api/auth/appeal`, {
      method: 'POST',
      headers: { cookie: 'sess=bob', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'прошу пересмотреть бан' }),
    });
    assert.equal(res.status, 201, 'забаненный подал апелляцию своей установкой');
    assert.equal(harness.db.appeals.length, 1);
    assert.equal(harness.db.appeals[0].reason, 'Бан аккаунта');
    // Повторную апелляцию, пока первая открыта, не принимаем.
    const again = await fetch(`${base}/api/auth/appeal`, {
      method: 'POST',
      headers: { cookie: 'sess=bob', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ещё раз' }),
    });
    assert.equal(again.status, 409);
  } finally { server.close(); }
});

test('по cookie нельзя подать апелляцию за незабаненного и без установки', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    // Иначе cookie позволила бы писать в апелляции от чужого имени.
    const notBanned = await fetch(`${base}/api/auth/appeal`, {
      method: 'POST',
      headers: { cookie: 'sess=carol', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'я не забанен' }),
    });
    assert.equal(notBanned.status, 403);
    const noCookie = await fetch(`${base}/api/auth/appeal`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'без установки' }),
    });
    assert.equal(noCookie.status, 401);
    assert.equal(harness.db.appeals.length, 0, 'ни одна апелляция не создана');
  } finally { server.close(); }
});

test('GET /api/auth/appeal показывает бан и статус уже поданной апелляции', async () => {
  const harness = createHarness();
  const { server, base } = await start(harness.app);
  try {
    harness.db.moderationBans.push({ userId: 'bob', kind: 'account' });
    let res = await (await fetch(`${base}/api/auth/appeal`, { headers: { cookie: 'sess=bob' } })).json();
    assert.equal(res.banned, true);
    assert.equal(res.appeal, null);

    await fetch(`${base}/api/auth/appeal`, {
      method: 'POST',
      headers: { cookie: 'sess=bob', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'текст' }),
    });
    res = await (await fetch(`${base}/api/auth/appeal`, { headers: { cookie: 'sess=bob' } })).json();
    assert.equal(res.appeal.status, 'open', 'экран бана не предложит вторую апелляцию');

    // У незабаненного установка есть, но бан false — это не экран бана.
    const carol = await (await fetch(`${base}/api/auth/appeal`, { headers: { cookie: 'sess=carol' } })).json();
    assert.equal(carol.banned, false);
  } finally { server.close(); }
});

