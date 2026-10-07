const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  install, ensureCatalog, sanitizeItem, sanitizeFamily, isOwnUpload, isFontFile, MAX_ITEMS,
} = require('./admin-fonts');

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-fonts-'));

// Multer в тестах не нужен: заглушка с .single('file') кладёт «файл» на диск.
function fakeUpload() {
  return {
    single: () => (req, res, next) => {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      // Имя сохраняемого файла берём из заголовка — multer так же делает по
      // расширению оригинала, и тест должен видеть реальное расширение.
      const original = req.headers['x-filename'] || 'font.woff2';
      const ext = path.extname(original) || '.woff2';
      req.file = {
        filename: `saved${ext}`,
        originalname: original,
        path: path.join(uploadsDir, `saved${ext}`),
      };
      fs.writeFileSync(req.file.path, 'fake-font');
      next();
    },
  };
}

function createHarness() {
  const db = { adminFonts: undefined };
  const pushes = [];
  let saves = 0;
  const app = express();
  app.use((req, res, next) => (
    String(req.headers['content-type'] || '').includes('application/json')
      ? express.json()(req, res, next) : next()
  ));
  install({
    app,
    getDb: () => db,
    saveDb: () => { saves += 1; },
    auth: (req, res, next) => {
      if (req.headers['x-token'] !== 'ok') return res.status(401).json({ message: 'Unauthorized' });
      req.userId = String(req.headers['x-user'] || '');
      next();
    },
    isAdmin: (req) => req.headers['x-admin'] === '1',
    notify: (c) => pushes.push(c),
    upload: fakeUpload(),
    uploadsDir,
  });
  return { app, db, pushes, saves: () => saves };
}

async function start(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const asAdminJson = { headers: { 'x-user': 'root', 'x-admin': '1', 'x-token': 'ok', 'content-type': 'application/json' } };
const asUserJson = (id) => ({ headers: { 'x-user': id, 'x-token': 'ok', 'content-type': 'application/json' } });
const send = (method, opts, body) => ({ method, headers: opts.headers, body: body ? JSON.stringify(body) : undefined });
test('каталог шрифтов читает любой залогиненный', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    assert.equal((await fetch(`${base}/api/themes/fonts`)).status, 401, 'без токена — нет');
    const res = await fetch(`${base}/api/themes/fonts`, { headers: { 'x-token': 'ok', 'x-user': 'bob' } });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).fonts, { items: [], updatedAt: null });
  } finally { server.close(); }
});

test('не-админ не может залить шрифт', async () => {
  const { app, saves } = createHarness();
  const { server, base } = await start(app);
  try {
    const up = await fetch(`${base}/api/themes/fonts`, {
      method: 'POST',
      headers: { ...asUserJson('bob').headers, 'content-type': 'multipart/form-data; boundary=x' },
      body: 'x',
    });
    assert.equal(up.status, 403);
    assert.equal(saves(), 0, 'БД не тронута');
  } finally { server.close(); }
});

test('админ заливает общий шрифт: он в БД, рассылается и лежит файлом', async () => {
  const { app, db, pushes, saves } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes/fonts`, {
      method: 'POST',
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x', 'x-filename': 'VeraSans.ttf' },
      body: 'x',
    });
    assert.equal(res.status, 200);
    const item = (await res.json()).fonts.items[0];
    assert.match(item.id, /^admin-font-/, 'id серверный');
    assert.equal(item.family, 'VeraSans', 'семейство из имени файла, без расширения');
    assert.match(item.url, /^\/uploads\/fonts\/.+\.ttf$/);
    assert.equal(db.adminFonts.items.length, 1, 'записано в БД');
    assert.equal(saves(), 1);
    assert.equal(pushes.length, 1, 'остальным разослано');
    assert.ok(fs.existsSync(path.join(uploadsDir, 'saved.ttf')), 'файл на диске');
  } finally { server.close(); }
});

test('не-шрифт не принимается', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes/fonts`, {
      method: 'POST',
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x', 'x-filename': 'virus.exe' },
      body: 'x',
    });
    assert.equal(res.status, 400, 'расширение решает, а не mime');
    assert.equal(fs.existsSync(path.join(uploadsDir, 'saved.exe')), false, 'файл убран, раз его отвергли');
  } finally { server.close(); }
});

test('удаление шрифта убирает и файл', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const created = await fetch(`${base}/api/themes/fonts`, {
      method: 'POST',
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x' },
      body: 'x',
    });
    const id = (await created.json()).fonts.items[0].id;
    const res = await fetch(`${base}/api/themes/fonts/${id}`, send('DELETE', asAdminJson));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).fonts.items.length, 0);
    assert.equal(fs.existsSync(path.join(uploadsDir, 'saved.woff2')), false, 'файл удалён');
  } finally { server.close(); }
});
// ── Санитайзер: имя семейства попадает прямо в CSS ───────────────────────────

test('семейство очищается от символов, которые рвут @font-face', () => {
  assert.equal(sanitizeFamily('Vera Sans.ttf'), 'Vera Sans');
  assert.equal(sanitizeFamily('bad";}body{display:none}.woff2'), 'bad body display:none');
  // Двоеточие внутри кавычек допустимо в CSS (font-family:"…:…"), а вот кавычка
  // и точка с запятой разорвали бы правило — их выкидываем.
  assert.ok(!/["';{}<>]/.test(sanitizeFamily('a"b;c{d}e<g>h.woff2')), 'разрывающих символов не осталось');
  assert.equal(sanitizeFamily('line\r\nbreak.otf'), 'line break');
  assert.equal(sanitizeFamily('   '), '');
});

test('принимаются только шрифтовые расширения', () => {
  for (const ok of ['a.ttf', 'a.OTF', 'a.woff', 'a.woff2', 'a.WOFF2']) {
    assert.equal(isFontFile(ok), true, `принимается ${ok}`);
  }
  for (const bad of ['a.exe', 'a.ttf.exe', 'a.png', 'a', 'a.ttfz', 'a.js']) {
    assert.equal(isFontFile(bad), false, `не принимается ${bad}`);
  }
});

test('чужой id или ссылка не принимаются', () => {
  assert.equal(sanitizeItem({ id: 'x', family: 'A', url: '/uploads/fonts/a.woff2' }), null, 'id не наш');
  assert.equal(sanitizeItem({ id: 'admin-font-abcd', family: 'A', url: 'https://evil.example/f.woff2' }), null, 'чужой URL');
  assert.equal(sanitizeItem({ id: 'admin-font-abcd', family: 'A', url: '/uploads/avatars/a.woff2' }), null, 'не та папка');
  assert.ok(sanitizeItem({ id: 'admin-font-abcd', family: 'A', url: '/uploads/fonts/a.woff2' }));
});

test('битая БД превращается в пустой каталог', () => {
  assert.deepEqual(ensureCatalog({}), { items: [], updatedAt: null });
  assert.deepEqual(ensureCatalog({ adminFonts: { items: 'мусор' } }), { items: [], updatedAt: null });
  assert.equal(isOwnUpload('/uploads/fonts/a.woff2'), true);
  assert.equal(isOwnUpload('/uploads/fonts/../x'), false);
  assert.equal(MAX_ITEMS, 100);
});