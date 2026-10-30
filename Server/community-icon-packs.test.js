const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { install, cleanPack } = require('./community-icon-packs');

/** Настоящий PNG 1×1 — сервер проверяет сигнатуру и чанки. */
function png() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Author\u0000secret')), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG_URL = `data:image/png;base64,${png().toString('base64')}`;

function harness() {
  const db = { users: [{ id: 'alice', username: 'alice' }, { id: 'bob', username: 'bob' }] };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-icons-'));
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  install({
    app, getDb: () => db, saveDb: () => {}, dataDir,
    auth: (req, res, next) => { if (!req.headers['x-user']) return res.status(401).end(); req.userId = req.headers['x-user']; next(); },
    isAdmin: (req) => req.headers['x-admin'] === '1',
  });
  return { app, db, dataDir };
}
async function start(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const as = (user, extra = {}) => ({ 'x-user': user, 'content-type': 'application/json', ...extra });

test('разбор пака: картинка проверяется по сигнатуре и чистится от метаданных', () => {
  const pack = cleanPack({
    name: 'Коты', base: 'neon',
    icons: {
      Search: { kind: 'image', src: PNG_URL, tint: true },
      Call: { kind: 'image', src: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') },
      MoreVert: { kind: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=' },
      Send: { kind: 'text', text: '🚀' },
      'bad slot': { kind: 'text', text: 'x' },
    },
  });
  assert.deepEqual(Object.keys(pack.icons).sort(), ['Search', 'Send']);
  const stored = Buffer.from(pack.icons.Search.src.split(',')[1], 'base64');
  assert.ok(!stored.includes(Buffer.from('secret')), 'tEXt-метаданные вырезаны');
  assert.equal(pack.icons.Search.tint, true);
  assert.equal(cleanPack({ icons: {} }), null, 'пустой пак не публикуется');
});

test('каталог: выложить, найти, поставить, удалить может только автор или админ', async () => {
  const { app, db, dataDir } = harness();
  const { server, base } = await start(app);
  try {
    assert.equal((await fetch(`${base}/api/community/icon-packs`)).status, 401);
    const pub = await fetch(`${base}/api/community/icon-packs`, {
      method: 'POST', headers: as('alice'),
      body: JSON.stringify({ name: 'Коты', description: 'мяу', pack: { base: 'tile', icons: { Search: { kind: 'text', text: '🐱' }, Call: { kind: 'image', src: PNG_URL } } } }),
    });
    assert.equal(pub.status, 201);
    const { pack: item } = await pub.json();
    assert.equal(item.iconCount, 2);
    assert.equal(item.authorName, 'alice');
    assert.ok(!JSON.stringify(db).includes('"icons"'), 'сам пак лежит файлом, а не в БД');

    const list = await (await fetch(`${base}/api/community/icon-packs?q=кот`, { headers: as('bob') })).json();
    assert.equal(list.packs.length, 1);

    const got = await (await fetch(`${base}/api/community/icon-packs/${item.id}?install=1`, { headers: as('bob') })).json();
    assert.equal(got.pack.base, 'tile');
    assert.equal(got.item.downloads, 1);

    assert.equal((await fetch(`${base}/api/community/icon-packs/${item.id}`, { method: 'DELETE', headers: as('bob') })).status, 403);
    assert.equal((await fetch(`${base}/api/community/icon-packs/../../etc`, { headers: as('bob') })).status, 404);
    assert.equal((await fetch(`${base}/api/community/icon-packs/${item.id}`, { method: 'DELETE', headers: as('alice') })).status, 200);
    assert.equal(fs.readdirSync(path.join(dataDir, 'community-icon-packs')).length, 0, 'файл пака удалён');

    const bad = await fetch(`${base}/api/community/icon-packs`, { method: 'POST', headers: as('alice'), body: JSON.stringify({ pack: { icons: { X: { kind: 'html' } } } }) });
    assert.equal(bad.status, 400);
  } finally { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('свои паки аккаунта: одни и те же на всех устройствах, чужие не видны', async () => {
  const { app, db, dataDir } = harness();
  const events = [];
  const notifyApp = express();
  notifyApp.use(express.json({ limit: '10mb' }));
  install({
    app: notifyApp, getDb: () => db, saveDb: () => {}, dataDir,
    auth: (req, res, next) => { if (!req.headers['x-user']) return res.status(401).end(); req.userId = req.headers['x-user']; next(); },
    isAdmin: () => false,
    notify: (userId, payload) => events.push({ userId, payload }),
  });
  void app;
  const { server, base } = await start(notifyApp);
  const mine = `${base}/api/icon-packs/mine`;
  try {
    assert.equal((await fetch(mine)).status, 401);
    const put = await fetch(`${mine}/p1`, {
      method: 'PUT', headers: as('alice'),
      body: JSON.stringify({ pack: { name: 'Коты', base: 'neon', icons: { Search: { kind: 'image', src: PNG_URL, tint: true } } }, updatedAt: 1234, clientId: 'pc' }),
    });
    assert.equal(put.status, 200);
    assert.ok(!JSON.stringify(db).includes(PNG_URL.slice(30, 60)), 'картинки — в файле, не в БД');
    assert.deepEqual(events.at(-1), { userId: 'alice', payload: { packs: [{ id: 'p1', name: 'Коты', updatedAt: 1234 }], clientId: 'pc' } });

    // Другое устройство того же аккаунта видит список и сам пак.
    const list = await (await fetch(mine, { headers: as('alice') })).json();
    assert.deepEqual(list.packs, [{ id: 'p1', name: 'Коты', updatedAt: 1234 }]);
    const got = await (await fetch(`${mine}/p1`, { headers: as('alice') })).json();
    assert.equal(got.pack.base, 'neon');
    assert.equal(got.pack.icons.Search.tint, true);
    assert.equal(got.pack.updatedAt, 1234);

    // Чужой аккаунт паков alice не видит.
    assert.deepEqual((await (await fetch(mine, { headers: as('bob') })).json()).packs, []);
    assert.equal((await fetch(`${mine}/p1`, { headers: as('bob') })).status, 404);

    // Пустой пак (только что созданный) сохраняется; мусор — нет.
    const empty = await fetch(`${mine}/p2`, { method: 'PUT', headers: as('alice'), body: JSON.stringify({ pack: { name: 'Новый', base: 'x', icons: {} } }) });
    assert.equal(empty.status, 200);
    assert.equal((await fetch(`${mine}/p3`, { method: 'PUT', headers: as('alice'), body: JSON.stringify({ pack: { icons: { X: { kind: 'html' } } } }) })).status, 400);
    assert.equal((await fetch(`${mine}/..%2F..%2Fx`, { method: 'PUT', headers: as('alice'), body: JSON.stringify({ pack: { icons: {} } }) })).status, 400);

    assert.equal((await fetch(`${mine}/p1?clientId=phone`, { method: 'DELETE', headers: as('alice') })).status, 200);
    assert.deepEqual((await (await fetch(mine, { headers: as('alice') })).json()).packs.map((p) => p.id), ['p2']);
    assert.equal(events.at(-1).payload.clientId, 'phone');
  } finally { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('свои паки аккаунта: не больше лимита, id пользователя не уводит из папки', async () => {
  const { MAX_ACCOUNT_PACKS } = require('./community-icon-packs');
  const { app, db, dataDir } = harness();
  db.userIconPacks = { alice: Array.from({ length: MAX_ACCOUNT_PACKS }, (_, i) => ({ id: `x${i}`, name: 'x', updatedAt: 1 })) };
  const { server, base } = await start(app);
  try {
    const body = JSON.stringify({ pack: { icons: { Search: { kind: 'text', text: '1' } } } });
    assert.equal((await fetch(`${base}/api/icon-packs/mine/new`, { method: 'PUT', headers: as('alice'), body })).status, 413);
    assert.equal((await fetch(`${base}/api/icon-packs/mine/x0`, { method: 'PUT', headers: as('alice'), body })).status, 200, 'существующий обновляется');
    assert.equal((await fetch(`${base}/api/icon-packs/mine/a`, { method: 'PUT', headers: as('../evil'), body })).status, 400);
  } finally { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
