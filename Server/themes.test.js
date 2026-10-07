const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const {
  install, ensureThemeCatalog, normalizeCatalog, sanitizeCatalogTheme,
} = require('./themes');

function createHarness() {
  const db = { users: [], builtinThemes: undefined };
  const pushes = [];
  let saves = 0;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
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
    notify: (catalog) => pushes.push(catalog),
  });
  return { app, db, pushes, saves: () => saves };
}

async function start(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const asUser = (id) => ({ headers: { 'x-user': id, 'x-token': 'ok' } });
const asUserJson = (id) => ({ headers: { 'x-user': id, 'x-token': 'ok', 'content-type': 'application/json' } });
const asAdminJson = { headers: { 'x-user': 'root', 'x-admin': '1', 'x-token': 'ok', 'content-type': 'application/json' } };
// Заголовки передаём «как есть»: express.json() разбирает тело только с content-type.
const put = (opts, body) => ({ method: 'PUT', headers: opts.headers, body: JSON.stringify(body) });

// ── Читает каталог любой авторизованный, правит — только админ ────────────────

test('каталог создаётся при первом обращении, без миграции БД', async () => {
  const { app, db } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes`, asUser('alice'));
    assert.equal(res.status, 200);
    const { themes } = await res.json();
    assert.deepEqual(themes, { overrides: {}, removed: [], added: [], updatedAt: null });
    assert.ok(db.builtinThemes, 'каталог появился в БД');
  } finally { server.close(); }
});

test('без токена каталог недоступен', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    assert.equal((await fetch(`${base}/api/themes`)).status, 401);
  } finally { server.close(); }
});

test('каталог читает любой залогиненный: иначе правки не увидит никто', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes`, asUser('bob'));
    assert.equal(res.status, 200, 'не только админ');
  } finally { server.close(); }
});

test('обычный пользователь не может менять встроенные темы', async () => {
  const { app, db, saves } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes`, put(asUserJson('bob'), {
      overrides: { 0: { name: 'Взлом', bg: '#000000' } },
    }));
    assert.equal(res.status, 403);
    assert.equal(saves(), 0, 'БД не тронута');
    assert.equal(db.builtinThemes, undefined, 'каталог не создан');
  } finally { server.close(); }
});

test('админ сохраняет каталог, он попадает в БД и рассылается', async () => {
  const { app, db, pushes, saves } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes`, put(asAdminJson, {
      overrides: { 0: { name: 'Моя Vera', bg: '#101010', accent: '#ff0066' } },
      removed: [29],
      added: [{ id: 500, name: 'Новая стоковая', bg: '#123456', accent: '#abcdef' }],
    }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    assert.equal(db.builtinThemes.overrides['0'].name, 'Моя Vera');
    assert.deepEqual(db.builtinThemes.removed, [29]);
    assert.equal(db.builtinThemes.added.length, 1);
    assert.equal(db.builtinThemes.added[0].id, 500);
    assert.ok(db.builtinThemes.updatedAt, 'есть updatedAt');
    assert.equal(saves(), 1, 'БД записана один раз');
    assert.equal(pushes.length, 1, 'клиентам разослан каталог');
    assert.equal(pushes[0].overrides['0'].accent, '#ff0066');
  } finally { server.close(); }
});
// ── Санитайзер: каталог общий, произвольный JSON в него не пролезает ──────────

test('тема очищается: только ключи рендера, имя обязательно', () => {
  const clean = sanitizeCatalogTheme({
    id: 7,
    name: '   ',
    bg: '#000000',
    accent: '#ffffff',
    // Мусор, которого нет в Theme.
    evil: { nested: 'x' },
    onClick: 'alert(1)',
    chatBgImage: 12345,
  });
  assert.equal(clean.id, 7);
  assert.equal(clean.name, 'Тема 7', 'пустое имя заменяется');
  assert.equal(clean.bg, '#000000');
  assert.equal(clean.evil, undefined, 'посторонние поля вырезаны');
  assert.equal(clean.onClick, undefined);
  assert.equal(clean.chatBgImage, undefined, 'не строка — не картинка');
});

test('километровые строки и фото обрезаются', () => {
  const huge = 'x'.repeat(5000);
  const clean = sanitizeCatalogTheme({ id: 1, name: 'A', bg: huge, chatBgImage: 'y'.repeat(4 * 1024 * 1024) });
  assert.equal(clean.bg, undefined, 'цвет длиннее лимита не проходит');
  assert.equal(clean.chatBgImage, undefined, 'фото больше лимита не проходит');
});

test('настройки темы (обои с календарём и часами) сохраняются', () => {
  const settings = {
    wallpaper: { stockId: 'base-paper-cream', brightness: 0.9 },
    appearance: {
      brightness: 1, textScale: 1, globalFontFamily: 'inherit',
      wallClock: { enabled: true, pos: 'center' },
    },
  };
  const clean = sanitizeCatalogTheme({ id: 3, name: 'С часами', settings });
  assert.deepEqual(clean.settings.appearance.wallClock, { enabled: true, pos: 'center' });
  assert.equal(clean.settings.wallpaper.stockId, 'base-paper-cream');
});

test('огромное фото-обои из настроек не уезжает в БД', () => {
  const clean = sanitizeCatalogTheme({
    id: 4,
    name: 'Тяжёлая',
    settings: { wallpaper: { stockId: 'custom-photo', photo: 'data:'.padEnd(4 * 1024 * 1024, 'A') } },
  });
  assert.equal(clean.settings.wallpaper.photo, undefined, 'фото вырезано');
  assert.equal(clean.settings.wallpaper.stockId, 'custom-photo', 'остальное на месте');
});

test('нормализация отбрасывает мусорные id и дубли', () => {
  const catalog = normalizeCatalog({
    overrides: { 0: { name: 'ok' }, abc: { name: 'нет' }, 5: { name: 'ok2' } },
    removed: [29, '29', -3, 'x', 30],
    added: [{ id: 500, name: 'A' }, null, { id: 'нет' }],
  });
  assert.deepEqual(Object.keys(catalog.overrides).sort(), ['0', '5']);
  assert.deepEqual(catalog.removed, [29, 30], 'дубли и отрицательные выброшены');
  assert.equal(catalog.added.length, 1);
});

test('каталог без полей превращается в пустой, а не падает', () => {
  const catalog = normalizeCatalog(undefined);
  assert.deepEqual(catalog, { overrides: {}, removed: [], added: [] });
  assert.deepEqual(ensureThemeCatalog({}), { overrides: {}, removed: [], added: [], updatedAt: null });
});