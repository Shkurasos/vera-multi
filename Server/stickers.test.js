const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerStickers, cleanEmoji, cleanPackName, processStickerImage } = require('./stickers');

const response = () => ({ code: 200, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } });

/** multer-заглушка: кладёт в req.file то, что тест положил в req._file. */
const fakeMulter = () => ({ single: () => (req, _res, cb) => { req.file = req._file || null; cb(null); } });
fakeMulter.memoryStorage = () => ({});

function setup() {
  const routes = {};
  const app = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    app[method] = (url, ...handlers) => { routes[`${method.toUpperCase()} ${url}`] = handlers.at(-1); };
  }
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-stickers-'));
  const db = { users: [], messages: [], chats: [], chatMembers: [] };
  const sent = [];
  const handleSendMessage = (chatId, userId, body, res, internal) => {
    sent.push({ chatId, userId, body, internal });
    res.status(201).json({ ok: true });
  };
  // Вместо sharp: «картинка» — любой буфер, начинающийся с IMG.
  const processImage = async (buf) => {
    if (!buf.toString().startsWith('IMG')) throw new Error('Это не картинка или файл повреждён');
    return { data: Buffer.from('WEBP' + buf.toString()), width: 512, height: 512, animated: false };
  };
  registerStickers({ app, getDb: () => db, auth() {}, saveDb() {}, uploadsDir, multer: fakeMulter, handleSendMessage, processImage });
  const call = async (key, userId, { params = {}, body = {}, query = {}, file = null } = {}) => {
    const res = response();
    await routes[key]({ userId, params, body, query, _file: file }, res);
    // Загрузка обрабатывается в колбэке multer, ждём её.
    await new Promise((r) => setImmediate(r));
    return res;
  };
  const newPack = (name = 'cats', title = 'Котики') =>
    call('POST /api/stickers/packs', 'alice', { body: { name, title } }).then((r) => r.data);
  const addSticker = (packId, emoji = '😺', content = 'IMG') =>
    call('POST /api/stickers/packs/:id/stickers', 'alice', { params: { id: packId }, body: { emoji }, file: { buffer: Buffer.from(content) } });
  const cleanup = () => fs.rmSync(uploadsDir, { recursive: true, force: true });
  return { db, call, sent, uploadsDir, cleanup, newPack, addSticker };
}

test('валидация: короткое имя набора и эмодзи', () => {
  assert.equal(cleanPackName('cats_2026').name, 'cats_2026');
  assert.ok(cleanPackName('2cats').error);
  assert.ok(cleanPackName('ab').error);
  assert.equal(cleanEmoji('').emoji, '🙂');
  assert.equal(cleanEmoji(' 😺 ').emoji, '😺');
  assert.ok(cleanEmoji('cat').error);
  assert.ok(cleanEmoji('😺😺😺😺😺😺😺😺😺').error);
});

test('processStickerImage: без sharp и с мусором — понятная ошибка', async () => {
  await assert.rejects(processStickerImage(Buffer.from('x'), null), /недоступна/);
  const brokenSharp = () => ({ metadata: async () => { throw new Error('bad'); } });
  await assert.rejects(processStickerImage(Buffer.from('<svg/>'), brokenSharp), /не картинка/);
  const svgSharp = () => ({ metadata: async () => ({ format: 'svg' }) });
  await assert.rejects(processStickerImage(Buffer.from('<svg/>'), svgSharp), /PNG, WEBP/);
});

test('processStickerImage: настоящий sharp пересобирает PNG в WEBP 512', async (t) => {
  let sharp;
  try { sharp = require('sharp'); } catch { return t.skip('sharp не установлен'); }
  const png = await sharp({ create: { width: 1024, height: 600, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const out = await processStickerImage(png);
  assert.equal(out.width, 512);
  assert.equal((await sharp(out.data).metadata()).format, 'webp');
  return undefined;
});

test('набор: создать, загрузить стикер, только автор меняет', async (t) => {
  const { call, uploadsDir, cleanup, newPack, addSticker } = setup();
  t.after(cleanup);
  const pack = await newPack();
  assert.equal(pack.installed, true, 'свой набор сразу в панели');
  assert.equal((await call('POST /api/stickers/packs', 'bob', { body: { name: 'CATS', title: 'x' } })).code, 409);

  const added = await addSticker(pack.id, '😺', 'IMG-cat');
  assert.equal(added.code, 201);
  const sticker = added.data.stickers[0];
  assert.match(sticker.fileUrl, /^\/uploads\/stickers\/[0-9a-f-]+\.webp$/);
  assert.equal(fs.readFileSync(path.join(uploadsDir, 'stickers', path.basename(sticker.fileUrl)), 'utf8'), 'WEBPIMG-cat');

  assert.equal((await addSticker(pack.id, '😺', '<html>')).code, 400);
  const file = { buffer: Buffer.from('IMG') };
  const foreign = await call('POST /api/stickers/packs/:id/stickers', 'bob', { params: { id: pack.id }, body: {}, file });
  assert.equal(foreign.code, 403);
  assert.equal((await call('DELETE /api/stickers/packs/:id', 'bob', { params: { id: pack.id } })).code, 403);
});

test('чужой набор: найти, добавить в панель, убрать', async (t) => {
  const { call, cleanup, newPack, addSticker } = setup();
  t.after(cleanup);
  const pack = await newPack('dogs', 'Пёсики');
  assert.equal((await call('GET /api/stickers/search', 'bob', { query: { q: 'dog' } })).data.length, 0, 'пустой набор не ищется');
  await addSticker(pack.id, '🐶');
  const found = (await call('GET /api/stickers/search', 'bob', { query: { q: 'пёс' } })).data;
  assert.equal(found.length, 1);
  assert.equal(found[0].installed, false);
  await call('POST /api/stickers/packs/:id/install', 'bob', { params: { id: pack.id } });
  let mine = (await call('GET /api/stickers/my', 'bob')).data;
  assert.equal(mine.installed.length, 1);
  assert.equal(mine.installed[0].isMine, false);
  await call('DELETE /api/stickers/packs/:id/install', 'bob', { params: { id: pack.id } });
  mine = (await call('GET /api/stickers/my', 'bob')).data;
  assert.equal(mine.installed.length, 0);
});

test('отправка стикера идёт через handleSendMessage с серверной ссылкой на набор', async (t) => {
  const { call, sent, cleanup, newPack, addSticker } = setup();
  t.after(cleanup);
  const pack = await newPack();
  const { data: full } = await addSticker(pack.id, '😺');
  const stickerId = full.stickers[0].id;
  const res = await call('POST /api/stickers/send', 'bob', { body: { chatId: 'c1', stickerId } });
  assert.equal(res.code, 201);
  assert.equal(sent[0].body.type, 'sticker');
  assert.equal(sent[0].body.attachments[0].mimeType, 'image/webp');
  assert.equal(sent[0].body.attachments[0].fileUrl, full.stickers[0].fileUrl);
  assert.deepEqual(sent[0].internal.sticker, { id: stickerId, packId: pack.id, packName: 'cats', emoji: '😺' });
  assert.equal((await call('POST /api/stickers/send', 'bob', { body: { chatId: 'c1', stickerId: 'nope' } })).code, 404);
});

test('удаление стикера не трогает файл, если его уже отправили', async (t) => {
  const { db, call, uploadsDir, cleanup, newPack, addSticker } = setup();
  t.after(cleanup);
  const pack = await newPack();
  const [sticker] = (await addSticker(pack.id)).data.stickers;
  db.messages.push({ id: 'm1', attachments: [{ fileUrl: sticker.fileUrl }] });
  await call('DELETE /api/stickers/packs/:id/stickers/:stickerId', 'alice', { params: { id: pack.id, stickerId: sticker.id } });
  assert.ok(fs.existsSync(path.join(uploadsDir, 'stickers', path.basename(sticker.fileUrl))), 'файл нужен старому сообщению');
  const [second] = (await addSticker(pack.id)).data.stickers;
  await call('DELETE /api/stickers/packs/:id/stickers/:stickerId', 'alice', { params: { id: pack.id, stickerId: second.id } });
  assert.equal(fs.existsSync(path.join(uploadsDir, 'stickers', path.basename(second.fileUrl))), false, 'неотправленный файл удалён');
});
