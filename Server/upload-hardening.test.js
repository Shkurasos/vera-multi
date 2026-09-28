const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

/** Достаёт из server.js блок хранения загрузок (Multer storage) и выполняет его. */
function loadStorageBlock() {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf('// ─── Multer storage');
  const end = source.indexOf('function mimeFilter', start);
  const ctx = { path, fs, Buffer };
  vm.runInNewContext(source.slice(start, end), ctx);
  return ctx;
}

test('расширение загрузки берётся из закрытого списка, а не из имени клиента', () => {
  const { safeExt } = loadStorageBlock();
  // Разрешённые форматы продолжают работать как раньше.
  for (const [name, ext] of [
    ['photo.png', '.png'], ['PHOTO.JPG', '.jpg'], ['clip.mp3', '.mp3'],
    ['doc.pdf', '.pdf'], ['archive.ZIP', '.zip'], ['voice.m4a', '.m4a'],
  ]) assert.equal(safeExt(name), ext, name);

  // Активный контент и исполняемые/серверные типы отбрасываются целиком.
  for (const name of [
    'evil.html', 'evil.htm', 'evil.xhtml', 'evil.js', 'evil.mjs', 'evil.mht',
    'evil.svg', 'evil.xml', 'evil.php', 'evil.jsp', 'evil.asp', 'evil.exe',
    'evil.sh', 'evil.bat', 'evil.py', 'evil.jar', 'noext',
    'evil.HTML', 'evil.Svg', 'x.php5', 'x.phtml',
  ]) assert.equal(safeExt(name), '', name);

  // Двойное расширение безвредно: на диск попадает только <uuid> + одно
  // безопасное расширение, исходное имя клиента не используется вовсе.
  assert.equal(safeExt('evil.html.png'), '.png');
});

test('HTML/SVG/XML внутри «медиа»-файла отбрасывается по сигнатуре содержимого', () => {
  const { sniffActiveContent } = loadStorageBlock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-snip-'));
  const check = (content, expected) => {
    const file = path.join(dir, 'sample');
    fs.writeFileSync(file, content);
    assert.equal(sniffActiveContent(file), expected);
  };
  try {
    check('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', true);
    check('  \n<!DOCTYPE html><html><body><script>alert(1)</script></body></html>', true);
    check('<?xml version="1.0"?><foo/>', true);
    check('<SCRIPT>alert(1)</SCRIPT>', true);
    // Реальные бинарные форматы проходят.
    check(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), false);
    check(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]), false);
    check('ID3\x03\x00\x00\x00\x00\x00\x00audio data', false);
    check('%PDF-1.7\n%binary junk', false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Регрессия производительности /api/chats: переписывание lastMessage и
// unreadCount в один проход не должно менять результат. Сравниваем с прежней
// реализацией (filter + sort + filter) на детерминированных случайных данных.

function loadLastMessageOf() {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf('function lastMessageOf');
  const end = source.indexOf("app.get('/api/chats', authMiddleware", start);
  const ctx = { db: { messages: [] } };
  vm.runInNewContext(source.slice(start, end), ctx);
  return ctx.lastMessageOf;
}

function loadChatsHandler(db) {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf("app.get('/api/chats', authMiddleware");
  // Тело маршрута заканчивается после res.json(chats); — захватываем и его.
  const end = source.indexOf('});', source.indexOf('res.json(chats);', start)) + 3;
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    db, app: { get: (_p, _auth, callback) => { handler = callback; } },
    authMiddleware() {}, lastMessageOf: loadLastMessageOf(),
    pinnedMessageIds: () => [], getPinnedMessage: () => null, pinnedMessageList: () => [],
  });
  return handler;
}

/** Прежняя реализация — эталон поведения. */
function referenceChats(db, userId) {
  return db.chatMembers.filter(m => m.userId === userId).map((m) => {
    const chat = db.chats.find(c => c.id === m.chatId);
    if (!chat) return null;
    const lastMsg = db.messages
      .filter(msg => msg.chatId === chat.id && (chat.type !== 'channel' || !msg.replyToId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
    const unreadCount = db.messages.filter(msg =>
      msg.chatId === chat.id && !msg.readBy?.includes(userId) && msg.senderId !== userId
    ).length;
    return { id: chat.id, lastId: lastMsg ? lastMsg.id : null, unreadCount };
  }).filter(Boolean);
}

/** mulberry32 — детерминированный ГПСЧ, чтобы падения воспроизводились. */
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeDb(seed) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const users = ['u1', 'u2', 'u3', 'u4'].map(id => ({ id, name: id }));
  const chats = [
    { id: 'c1', type: 'direct' },
    { id: 'c2', type: 'group' },
    { id: 'c3', type: 'channel' },   // реакции не должны попадать в lastMessage
    { id: 'c4', type: 'direct' },    // чат без сообщений
  ];
  const chatMembers = [];
  for (const chat of chats) {
    for (const user of users) {
      if (random() < 0.6) chatMembers.push({ id: `${chat.id}-${user.id}`, chatId: chat.id, userId: user.id });
    }
  }
  // Метки времени намеренно повторяются — проверяем стабильность выбора.
  const stamps = ['2024-01-01T10:00:00.000Z', '2024-01-01T10:00:00.000Z',
    '2024-01-02T12:00:00.000Z', '2024-01-03T08:30:00.000Z'];
  const messages = [];
  for (let i = 0; i < 300; i += 1) {
    const isReply = random() < 0.2;
    const readBy = random() < 0.5 ? [] : [pick(users).id];
    messages.push({
      id: `m${i}`,
      chatId: pick(chats).id,
      senderId: pick(users).id,
      createdAt: pick(stamps),
      replyToId: isReply ? 'root' : undefined,
      readBy,
    });
  }
  return { users, chats, chatMembers, messages };
}

test('однопроходный подсчёт lastMessage/unreadCount совпадает с прежней реализацией', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    const db = makeDb(seed);
    for (const user of db.users) {
      const handler = loadChatsHandler(db);
      let payload = null;
      handler({ userId: user.id }, { json: (data) => { payload = data; } });
      const actual = payload.map(c => ({ id: c.id, lastId: c.lastMessage ? c.lastMessage.id : null, unreadCount: c.unreadCount }));
      assert.deepEqual(actual, referenceChats(db, user.id), `seed=${seed} user=${user.id}`);
    }
  }
});

test('lastMessageOf возвращает то же, что filter+sort+[0], включая ничьи по времени', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf('function lastMessageOf');
  const end = source.indexOf("app.get('/api/chats', authMiddleware", start);
  const definition = source.slice(start, end).match(/function lastMessageOf[\s\S]*?\n}/)[0];
  for (const seed of [3, 11, 99]) {
    const db = makeDb(seed);
    // lastMessageOf берёт db из области видимости контекста — создаём его на каждый seed.
    const lastMessageOf = vm.runInNewContext(`(${definition})`, { db });
    for (const chat of db.chats) {
      const isChannel = chat.type === 'channel';
      const expected = db.messages
        .filter(msg => msg.chatId === chat.id && (!isChannel || !msg.replyToId))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
      const actual = lastMessageOf(chat.id, isChannel);
      assert.equal(actual ? actual.id : null, expected ? expected.id : null, `seed=${seed} chat=${chat.id}`);
    }
  }
});

test('загрузка файла отклоняется, если сигнатура указывает на активный контент', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/files/upload'");
  const end = source.indexOf('// POST /api/files/upload-base64', start);
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    app: { post: (_p, _auth, callback) => { handler = callback; } },
    authMiddleware() {}, dropIfActiveContent: () => true,
    // middleware-слои multer в этом изолированном контексте — заглушка
    uploadFile: { single: () => (_req, _res) => {} },
  });
  const result = { status: 200 };
  const response = { status(c) { result.status = c; return this; }, json(d) { result.body = d; return this; } };
  // dropIfActiveContent() === true → handler обязан прервать выполнение.
  handler({ file: { filename: 'a.png' } }, response);
  assert.equal(result.status, 200);
  assert.equal(result.body, undefined, 'ответ не должен отправляться после отклонения файла');
});