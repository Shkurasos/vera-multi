const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  registerBots, sanitizeReplyMarkup, cleanBotUsername, signWebAppData, checkWebAppData, hashToken, HUB_ID,
} = require('./bots');

const response = () => ({
  code: 200,
  status(c) { this.code = c; return this; },
  json(d) { this.data = d; this.writableEnded = true; return this; },
  on() {},
});
const tick = () => new Promise((r) => setImmediate(r));

/** Маршруты в объекте, база в памяти, сокет пишет в массив. */
function setup(extra = {}) {
  const routes = {};
  let botRoute = null;
  const app = {
    get: (url, _a, fn) => { routes['GET ' + url] = fn; },
    post: (url, _a, fn) => { routes['POST ' + url] = fn; },
    delete: (url, _a, fn) => { routes['DELETE ' + url] = fn; },
    all: (_re, parse, _limiter, fn) => { botRoute = { parse, fn }; },
  };
  const db = {
    users: [{ id: 'alice', username: 'alice' }, { id: 'bob', username: 'bob' }],
    chats: [], chatMembers: [], messages: [],
    bots: [{ id: 'old', ownerId: 'alice', username: 'x', token: 'plain' }],
  };
  const emitted = [];
  const io = { to: (room) => ({ emit: (ev, data) => emitted.push({ room, ev, data }) }) };
  const mod = registerBots({
    app, getDb: () => db, auth() {}, saveDb() {}, io,
    isPrivateHost: (h) => /^(localhost|127\.|10\.|192\.168\.)/.test(String(h)),
    lookup: async () => [{ address: '93.184.216.34' }],
    ...extra,
  });
  const call = async (key, userId, { params = {}, body = {}, query = {} } = {}) => {
    const res = response();
    await routes[key]({ userId, params, body, query }, res);
    return res;
  };
  const api = async (token, method, body = {}) => {
    const res = response();
    const req = { params: [token, method], body, query: {} };
    botRoute.parse(req, res, () => {});
    await botRoute.fn(req, res);
    return res;
  };
  const directChat = (id, a, b) => {
    db.chats.push({ id, type: 'direct' });
    db.chatMembers.push({ chatId: id, userId: a }, { chatId: id, userId: b });
  };
  const userSays = (chatId, senderId, text) => {
    const message = { id: 'm' + db.messages.length, chatId, senderId, text, content: text, createdAt: new Date().toISOString() };
    db.messages.push(message);
    mod.onMessage(message);
    return message;
  };
  const createBot = (username = 'echo_bot', name = 'Эхо') =>
    call('POST /api/bots/create', 'alice', { body: { name, username } }).then((r) => r.data);
  return { db, mod, call, api, emitted, directChat, userSays, createBot };
}

test('cleanBotUsername: ник с bot на конце, 5–32 символа', () => {
  assert.equal(cleanBotUsername('/weather_bot').username, 'weather_bot');
  assert.equal(cleanBotUsername('@MyBot').username, 'MyBot');
  assert.ok(cleanBotUsername('weather').error);
  assert.ok(cleanBotUsername('1abot').error, 'с цифры нельзя');
  assert.ok(cleanBotUsername('bot').error, 'слишком короткий');
});

test('sanitizeReplyMarkup: только https и callback_data до 64 байт', () => {
  assert.deepEqual(sanitizeReplyMarkup(undefined), { value: null });
  assert.ok(sanitizeReplyMarkup({ inline_keyboard: [[{ text: 'x', web_app: { url: 'javascript:alert(1)' } }]] }).error);
  assert.ok(sanitizeReplyMarkup({ inline_keyboard: [[{ text: 'x', web_app: { url: 'vera://stickers' } }]] }).error, 'внутренний адрес только для /hub');
  assert.ok(sanitizeReplyMarkup({ inline_keyboard: [[{ text: 'x', callback_data: 'a'.repeat(65) }]] }).error);
  const ok = sanitizeReplyMarkup(JSON.stringify({ inline_keyboard: [[{ text: 'Открыть', web_app: { url: 'https://example.com/app' }, extra: 1 }]] }));
  assert.deepEqual(ok.value, { inline_keyboard: [[{ text: 'Открыть', web_app: { url: 'https://example.com/app' } }]] });
});

test('initData: подпись сервера проверяется по исходному токену', () => {
  const token = 'bot1:secret';
  const initData = signWebAppData(hashToken(token), { user: '{"id":"u"}', auth_date: '1' });
  assert.equal(checkWebAppData(initData, token), true);
  assert.equal(checkWebAppData(initData, 'bot1:other'), false);
  assert.equal(checkWebAppData(initData.replace('auth_date=1', 'auth_date=2'), token), false);
});

test('старт: создаёт /hub и убирает открытые токены старой заглушки', () => {
  const { db } = setup();
  assert.ok(db.users.some((u) => u.id === HUB_ID && u.username === 'hub' && u.isBot));
  assert.equal('token' in db.bots[0], false);
  assert.equal(db.bots[0].legacy, true);
});

test('публичный GET /api/bots/:username не отдаёт токен', async () => {
  const { call, createBot } = setup();
  const created = await createBot('weather_bot', 'Погода');
  assert.match(created.token, /^[0-9a-f-]+:/);
  const seen = await call('GET /api/bots/:username', 'bob', { params: { username: '/weather_bot' } });
  assert.equal(seen.data.username, 'weather_bot');
  assert.equal(JSON.stringify(seen.data).includes(created.token.split(':')[1]), false);
  assert.equal('tokenHash' in seen.data, false);
  const legacy = await call('GET /api/bots/:username', 'bob', { params: { username: 'x' } });
  assert.equal(legacy.code, 404, 'старая запись не видна');
});

test('/hub: /newbot → имя → ник → токен; занятый ник просит другой', async () => {
  const { db, directChat, userSays } = setup();
  directChat('hubchat', 'alice', HUB_ID);
  const last = () => db.messages.filter((m) => m.senderId === HUB_ID).at(-1);
  userSays('hubchat', 'alice', '/newbot'); await tick();
  assert.match(last().text, /Как его назовём/);
  userSays('hubchat', 'alice', 'Погода'); await tick();
  assert.match(last().text, /ник бота/);
  userSays('hubchat', 'alice', 'bob'); await tick();
  assert.match(last().text, /Пришлите другой ник/);
  userSays('hubchat', 'alice', 'weather_bot'); await tick();
  assert.match(last().text, /Бот «Погода» создан/);
  const bot = db.bots.find((b) => b.username === 'weather_bot');
  assert.ok(bot && bot.ownerId === 'alice');
  assert.ok(last().text.includes(bot.id + ':'), 'токен в ответе');
  assert.ok(db.users.some((u) => u.id === bot.userId && u.isBot && u.botOwnerId === 'alice'));
});

test('/hub: /stickers присылает кнопку мини-приложения', async () => {
  const { db, directChat, userSays } = setup();
  directChat('hubchat', 'alice', HUB_ID);
  userSays('hubchat', 'alice', '/stickers'); await tick();
  const reply = db.messages.at(-1);
  assert.equal(reply.senderId, HUB_ID);
  assert.equal(reply.replyMarkup.inline_keyboard[0][0].web_app.url, 'vera://stickers');
});

test('/hub: /token выпускает новый токен, старый перестаёт работать', async () => {
  const { db, api, directChat, userSays, createBot } = setup();
  const data = await createBot();
  assert.equal((await api(data.token, 'getMe')).data.result.username, 'echo_bot');
  directChat('hubchat', 'alice', HUB_ID);
  userSays('hubchat', 'alice', '/token echo_bot'); await tick();
  const reply = db.messages.filter((m) => m.senderId === HUB_ID).at(-1).text;
  const fresh = reply.match(/[0-9a-f-]{36}:[A-Za-z0-9_-]+/)[0];
  assert.equal((await api(data.token, 'getMe')).code, 401);
  assert.equal((await api(fresh, 'getMe')).code, 200);
});

test('Bot API: getUpdates получает сообщение, sendMessage отвечает в чат', async () => {
  const { db, call, api, directChat, userSays, emitted, createBot } = setup();
  const data = await createBot();
  const botUserId = data.bot.userId;
  directChat('c1', 'bob', botUserId);
  userSays('c1', 'bob', 'привет');
  const updates = (await api(data.token, 'getUpdates')).data.result;
  assert.equal(updates.length, 1);
  assert.equal(updates[0].message.text, 'привет');
  assert.equal(updates[0].message.from.username, 'bob');
  const again = (await api(data.token, 'getUpdates', { offset: updates[0].update_id + 1 })).data.result;
  assert.equal(again.length, 0, 'offset подтверждает прочитанное');

  const markup = { inline_keyboard: [[{ text: 'Ещё', callback_data: 'more' }]] };
  const sent = await api(data.token, 'sendMessage', { chat_id: 'c1', text: 'эхо: привет', reply_markup: markup });
  assert.equal(sent.data.ok, true);
  const msg = db.messages.at(-1);
  assert.equal(msg.senderId, botUserId);
  assert.deepEqual(msg.replyMarkup, markup);
  assert.equal(emitted.at(-1).ev, 'message:new');
  assert.equal(db.messages.length, 2, 'ответ бота не порождает новое событие');

  const press = await call('POST /api/bots/callback', 'bob', { body: { messageId: msg.id, data: 'more' } });
  assert.equal(press.data.ok, true);
  const cb = (await api(data.token, 'getUpdates')).data.result.at(-1);
  assert.equal(cb.callback_query.data, 'more');
  assert.equal((await call('POST /api/bots/callback', 'bob', { body: { messageId: msg.id, data: 'fake' } })).code, 400);
});

test('Bot API: getUpdates с timeout ждёт новое сообщение', async () => {
  const { api, directChat, userSays, createBot } = setup();
  const data = await createBot();
  directChat('c1', 'bob', data.bot.userId);
  const pending = api(data.token, 'getUpdates', { timeout: 5 });
  await tick();
  userSays('c1', 'bob', 'позже');
  const res = await pending;
  assert.equal(res.data.result[0].message.text, 'позже');
});

test('Bot API: бот не пишет в чужие чаты и туда, где его заблокировали', async () => {
  const { db, api, directChat, createBot } = setup();
  const data = await createBot();
  directChat('people', 'alice', 'bob');
  assert.equal((await api(data.token, 'sendMessage', { chat_id: 'people', text: 'спам' })).code, 403);
  directChat('c1', 'bob', data.bot.userId);
  db.userBlocks = [{ blockerId: 'bob', blockedId: data.bot.userId }];
  assert.equal((await api(data.token, 'sendMessage', { chat_id: 'c1', text: 'спам' })).code, 403);
  assert.equal((await api('nope:nope', 'getMe')).code, 401);
});

test('setWebhook: только публичный https, события уходят POST-запросом с секретом', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200 }; };
  const { api, directChat, userSays, createBot } = setup({ fetchImpl });
  const data = await createBot();
  assert.equal((await api(data.token, 'setWebhook', { url: 'http://example.com/hook' })).code, 400);
  assert.equal((await api(data.token, 'setWebhook', { url: 'https://127.0.0.1/hook' })).code, 400);
  assert.equal((await api(data.token, 'setWebhook', { url: 'https://example.com:22/hook' })).code, 400);
  const set = await api(data.token, 'setWebhook', { url: 'https://example.com/hook', secret_token: 's3cret' });
  assert.equal(set.data.ok, true);
  assert.equal((await api(data.token, 'getUpdates')).code, 409);
  directChat('c1', 'bob', data.bot.userId);
  userSays('c1', 'bob', 'hi');
  for (let i = 0; i < 5 && !calls.length; i++) await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.headers['X-Vera-Bot-Api-Secret-Token'], 's3cret');
  assert.equal(JSON.parse(calls[0].init.body).message.text, 'hi');
});

test('setWebhook: домен, который резолвится во внутреннюю сеть, отклоняется', async () => {
  const { api, createBot } = setup({ lookup: async () => [{ address: '10.0.0.5' }] });
  const data = await createBot();
  const res = await api(data.token, 'setWebhook', { url: 'https://evil.example/hook' });
  assert.equal(res.code, 400);
  assert.match(res.data.description, /внутреннюю сеть/);
});

test('webapp-init подписывает только адрес из кнопки бота', async () => {
  const { db, call, api, directChat, createBot } = setup();
  const data = await createBot();
  directChat('c1', 'bob', data.bot.userId);
  const markup = { inline_keyboard: [[{ text: 'App', web_app: { url: 'https://example.com/app' } }]] };
  await api(data.token, 'sendMessage', { chat_id: 'c1', text: 'app', reply_markup: markup });
  const msg = db.messages.at(-1);
  const good = await call('POST /api/bots/webapp-init', 'bob', { body: { messageId: msg.id, url: 'https://example.com/app' } });
  assert.equal(checkWebAppData(good.data.initData, data.token), true);
  const bad = await call('POST /api/bots/webapp-init', 'bob', { body: { messageId: msg.id, url: 'https://evil.example' } });
  assert.equal(bad.code, 400);
  const outsider = await call('POST /api/bots/webapp-init', 'alice', { body: { messageId: msg.id, url: 'https://example.com/app' } });
  assert.equal(outsider.code, 403, 'не участник чата');
});

test('удаление бота освобождает ник и гасит токен', async () => {
  const { db, call, api, createBot } = setup();
  const data = await createBot();
  assert.equal((await call('DELETE /api/bots/:id', 'bob', { params: { id: data.bot.id } })).code, 404, 'чужого не удалить');
  assert.equal((await call('DELETE /api/bots/:id', 'alice', { params: { id: data.bot.id } })).data.ok, true);
  assert.equal((await api(data.token, 'getMe')).code, 401);
  const user = db.users.find((u) => u.id === data.bot.userId);
  assert.equal(user.botDeleted, true);
  assert.notEqual(user.username, 'echo_bot');
});

test('команды: у /hub меню есть сразу, бот задаёт своё через setMyCommands', async () => {
  const { call, api, createBot } = setup();
  const hub = await call('GET /api/bots/:username', 'bob', { params: { username: 'hub' } });
  assert.ok(hub.data.commands.some((c) => c.command === 'newbot'));

  const data = await createBot();
  const empty = await call('GET /api/bots/:username', 'bob', { params: { username: 'echo_bot' } });
  assert.deepEqual(empty.data.commands, []);

  const commands = [{ command: '/Start', description: 'начать' }, { command: 'weather', description: 'погода' }];
  assert.equal((await api(data.token, 'setMyCommands', { commands: JSON.stringify(commands) })).data.ok, true);
  const seen = await call('GET /api/bots/:username', 'bob', { params: { username: 'echo_bot' } });
  assert.deepEqual(seen.data.commands, [{ command: 'start', description: 'начать' }, { command: 'weather', description: 'погода' }]);
  assert.equal((await api(data.token, 'getMyCommands')).data.result.length, 2);

  assert.equal((await api(data.token, 'setMyCommands', { commands: [{ command: 'с пробелом', description: 'x' }] })).code, 400);
  assert.equal((await api(data.token, 'setMyCommands', { commands: [{ command: 'a', description: '' }] })).code, 400);
  assert.equal((await api(data.token, 'setMyCommands', { commands: [{ command: 'a', description: 'x' }, { command: 'a', description: 'y' }] })).code, 400);

  assert.equal((await api(data.token, 'deleteMyCommands')).data.ok, true);
  assert.deepEqual((await api(data.token, 'getMyCommands')).data.result, []);
});

test('/hub: /newapp создаёт мини-приложение, /setmenubutton ставит кнопку у поля ввода', async () => {
  const { db, call, api, directChat, userSays, createBot } = setup();
  const data = await createBot();
  directChat('h1', 'alice', HUB_ID);
  const last = () => db.messages.filter((m) => m.senderId === HUB_ID).at(-1);
  const say = async (text) => { userSays('h1', 'alice', text); await tick(); return last(); };

  await say('/newapp');
  await say('echo_bot');
  await say('Магазин');
  await say('/skip');
  assert.match((await say('http://example.com')).content, /https/, 'http не принимаем');
  assert.match((await say('https://localhost/app')).content, /внутреннюю сеть/);
  await say('https://example.com/shop');
  assert.match((await say('a!')).content, /Короткое имя/);
  const done = await say('shop');
  assert.match(done.content, /vera:\/\/app\/echo_bot\/shop/);
  assert.equal(done.replyMarkup.inline_keyboard[0][0].web_app.url, 'vera://app/echo_bot/shop');
  const bot = db.bots.find((b) => b.username === 'echo_bot');
  assert.deepEqual({ ...bot.apps[0], createdAt: undefined }, { shortName: 'shop', title: 'Магазин', description: '', url: 'https://example.com/shop', createdAt: undefined });

  // Чужой пользователь открывает приложение по ссылке: initData подписан токеном бота.
  const opened = await call('POST /api/bots/app-init', 'bob', { body: { username: 'echo_bot', app: 'shop' } });
  assert.equal(opened.data.url, 'https://example.com/shop');
  assert.equal(checkWebAppData(opened.data.initData, data.token), true);
  assert.equal((await call('POST /api/bots/app-init', 'bob', { body: { username: 'echo_bot', app: 'nope' } })).code, 404);
  assert.equal((await call('POST /api/bots/app-init', 'bob', { body: { username: 'echo_bot' } })).code, 404, 'кнопки ещё нет');

  // Кнопка у поля ввода по короткому имени приложения.
  await say('/setmenubutton echo_bot');
  await say('shop');
  assert.match((await say('Открыть')).content, /появилась кнопка/);
  const info = await call('GET /api/bots/:username', 'bob', { params: { username: 'echo_bot' } });
  assert.deepEqual(info.data.menuButton, { text: 'Открыть' });
  assert.equal(info.data.url, undefined, 'адрес сайта в публичной карточке не нужен');
  const viaButton = await call('POST /api/bots/app-init', 'bob', { body: { username: 'echo_bot' } });
  assert.equal(viaButton.data.url, 'https://example.com/shop');

  // Bot API: getChatMenuButton / setChatMenuButton.
  assert.equal((await api(data.token, 'getChatMenuButton')).data.result.web_app.url, 'https://example.com/shop');
  assert.equal((await api(data.token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'X', web_app: { url: 'http://x.example' } } })).code, 400);
  assert.equal((await api(data.token, 'setChatMenuButton', { menu_button: JSON.stringify({ type: 'default' }) })).data.ok, true);
  assert.deepEqual((await api(data.token, 'getChatMenuButton')).data.result, { type: 'default' });

  // Чужого бота не настроить, удаление приложения гасит ссылку.
  directChat('h2', 'bob', HUB_ID);
  userSays('h2', 'bob', '/newapp echo_bot');
  await tick();
  assert.match(db.messages.filter((m) => m.senderId === HUB_ID && m.chatId === 'h2').at(-1).content, /Не нашёл вашего бота/);
  assert.match((await say('/deleteapp echo_bot/shop')).content, /удалено/);
  assert.equal((await call('POST /api/bots/app-init', 'bob', { body: { username: 'echo_bot', app: 'shop' } })).code, 404);
  assert.match((await say('/myapps')).content, /пока нет/);
});
