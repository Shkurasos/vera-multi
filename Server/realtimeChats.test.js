const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

/**
 * Жалоба: «пишу другу — ему нужно обновить страницу, чтобы увидеть мой чат
 * и первое сообщение». Причина: socket-комната `chat:<id>` джойнится только
 * при коннекте/открытии чата, а собеседник подключился ДО создания чата.
 *
 * Тест эмулирует комнаты io: сокет, посаженный в комнату, получает всё, что
 * эмитится в эту комнату — как в socket.io. Ключевая проверка: сокет bob'а,
 * подключившегося до создания чата, получает и `chat:updated`, и
 * `message:new` без переподключения.
 */
function setup() {
  let sequence = 0;
  const routes = {};
  const rooms = new Map();   // 'chat:x' -> Set<sid>
  const delivered = [];      // [sid, event] — что реально получил каждый сокет
  const context = {
    db: {
      users: [
        { id: 'alice', username: 'alice', firstName: 'Alice' },
        { id: 'bob', username: 'bob', firstName: 'Bob' },
      ],
      chats: [], chatMembers: [], messages: [],
    },
    uuidv4: () => `id-${++sequence}`,
    saveDb() {}, authMiddleware() {}, MESSAGE_MAX_LEN: 10000,
    // Сокеты подключены ДО создания чата — как в жалобе.
    userSockets: new Map([
      ['alice', new Set(['sid-alice'])],
      ['bob', new Set(['sid-bob'])],
    ]),
    io: {
      to: (target) => ({
        emit: (event) => {
          if (target.startsWith('chat:')) {
            for (const sid of rooms.get(target) || []) delivered.push([sid, event]);
          } else {
            delivered.push([target, event]);
          }
        },
        socketsJoin: (room) => {
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room).add(target);
        },
      }),
    },
    app: Object.fromEntries(['post'].map(method => [method, (url, auth, fn) => { routes[method + ' ' + url] = fn; }])),
  };
  require('./privacy-test-context')(context);
  vm.runInNewContext(
    source.slice(source.indexOf('// POST /api/chats/direct'), source.indexOf('// POST /api/chats/channel')),
    context,
  );
  vm.runInNewContext(
    source.slice(source.indexOf('function messageSender('), source.indexOf('// POST /api/messages/:chatId  (base route)')),
    context,
  );
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  return { context, routes, response, delivered };
}

test('создание direct-чата: собеседник получает chat:updated и входит в комнату без перезагрузки', () => {
  const { routes, response, context, delivered } = setup();
  const created = response();
  routes['post /api/chats/direct']({ userId: 'alice', body: { targetUserId: 'bob' } }, created);
  assert.equal(created.code, 200);
  assert.equal(created.data.type, 'direct');
  assert.equal(created.data.members.length, 2);
  // Оба сокета получили событие лично (чат ещё не был ни у кого в комнате).
  assert.ok(delivered.some(([sid, event]) => sid === 'sid-bob' && event === 'chat:updated'), 'bob получил chat:updated');
  assert.ok(delivered.some(([sid, event]) => sid === 'sid-alice' && event === 'chat:updated'), 'alice получил chat:updated');
  const bobMember = context.db.chatMembers.find(m => m.chatId === created.data.id && m.userId === 'bob');
  assert.ok(bobMember, 'bob — участник чата в базе');
  // Повторный вызов (alice открывает тот же чат) не падает и остаётся идемпотентным.
  const again = response();
  routes['post /api/chats/direct']({ userId: 'alice', body: { targetUserId: 'bob' } }, again);
  assert.equal(again.data.id, created.data.id, 'второй вызов возвращает тот же чат');
});

test('первое сообщение в новом чате доходит до собеседника по сокету без перезагрузки', () => {
  const { context, routes, response, delivered } = setup();
  const created = response();
  routes['post /api/chats/direct']({ userId: 'alice', body: { targetUserId: 'bob' } }, created);
  const chatId = created.data.id;
  // Bob так и не открывал чат и ничего не эмитил — только сидел в приложении.
  delivered.length = 0;
  const sent = response();
  context.handleSendMessage(chatId, 'alice', { text: 'Привет!' }, sent);
  assert.equal(sent.code, 201);
  assert.ok(
    delivered.some(([sid, event]) => sid === 'sid-bob' && event === 'message:new'),
    'сокет bob получил message:new через комнату',
  );
  assert.ok(
    delivered.some(([sid, event]) => sid === 'sid-alice' && event === 'message:new'),
    'сокет alice получил эхо message:new через комнату',
  );
});
