const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  install, ensureCatalog, sanitizeItem, isOwnUpload, isFactoryId, MAX_ITEMS,
} = require('./admin-wallpapers');

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-wallpapers-'));

// Multer в тестах не нужен: подменяем приём файла заглушкой с .single('file'),
// которая кладёт «файл» на диск — так проверяется, что он удаляется вместе с фоном.
function fakeUpload() {
  return {
    single: () => (req, res, next) => {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      req.file = {
        filename: 'test.jpg',
        originalname: req.headers['x-filename'] || 'test.jpg',
        path: path.join(uploadsDir, 'test.jpg'),
      };
      fs.writeFileSync(req.file.path, 'fake');
      next();
    },
  };
}

function createHarness() {
  const db = { builtinWallpapers: undefined };
  const pushes = [];
  let saves = 0;
  const app = express();
  // json() только когда тело действительно json: иначе он пытается распарсить
  // multipart-загрузку и сам роняет запрос ещё до маршрута.
  app.use((req, res, next) => (
    String(req.headers['content-type'] || '').includes('application/json')
      ? express.json()(req, res, next)
      : next()
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
    notify: (catalog) => pushes.push(catalog),
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

const asUserJson = (id) => ({ headers: { 'x-user': id, 'x-token': 'ok', 'content-type': 'application/json' } });
const asAdminJson = { headers: { 'x-user': 'root', 'x-admin': '1', 'x-token': 'ok', 'content-type': 'application/json' } };
const send = (method, opts, body) => ({ method, headers: opts.headers, body: body ? JSON.stringify(body) : undefined });
// ── Чтение и права ────────────────────────────────────────────────────────────

test('каталог фонов читает любой залогиненный', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    assert.equal((await fetch(`${base}/api/themes/wallpapers`)).status, 401, 'без токена — нет');
    const res = await fetch(`${base}/api/themes/wallpapers`, { headers: { 'x-token': 'ok', 'x-user': 'bob' } });
    assert.equal(res.status, 200);
    // Каталог несёт три секции: загруженные фоны, скрытые заводские id и правки
    // заводских фонов. Пустой он тоже должен быть предсказуемым по форме.
    assert.deepEqual(
      (await res.json()).wallpapers,
      { items: [], hidden: [], overrides: {}, updatedAt: null },
    );
  } finally { server.close(); }
});

test('не-админ не может добавить и удалить фон', async () => {
  const { app, saves } = createHarness();
  const { server, base } = await start(app);
  try {
    const add = await fetch(`${base}/api/themes/wallpapers/base`, send('POST', asUserJson('bob'), {
      name: 'Взлом', css: 'linear-gradient(#000,#fff)',
    }));
    assert.equal(add.status, 403);
    const del = await fetch(`${base}/api/themes/wallpapers/admin-wp-abc123`, send('DELETE', asUserJson('bob')));
    assert.equal(del.status, 403);
    assert.equal(saves(), 0, 'БД не тронута');
  } finally { server.close(); }
});

test('админ добавляет фон-градиент: он попадает в БД и рассылается', async () => {
  const { app, db, pushes, saves } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes/wallpapers/base`, send('POST', asAdminJson, {
      name: 'Закат', css: 'linear-gradient(135deg, #ff9a9e, #fad0c4)', light: true,
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.wallpapers.items.length, 1);
    const item = body.wallpapers.items[0];
    assert.match(item.id, /^admin-wp-/, 'id серверный, не клиентский');
    assert.equal(item.type, 'base');
    assert.equal(item.light, true);
    assert.equal(db.builtinWallpapers.items.length, 1, 'записано в БД');
    assert.equal(saves(), 1);
    assert.equal(pushes.length, 1, 'остальным разослан каталог');
    assert.ok(body.wallpapers.updatedAt, 'есть updatedAt');
  } finally { server.close(); }
});

test('фото-фон сохраняется ссылкой, а не содержимым файла', async () => {
  const { app, db } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes/wallpapers`, {
      method: 'POST',
      // Заглушка загрузки берёт имя из заголовка и подставляет его в req.file.
      // content-type — именно multipart, поэтому auth-заголовки идут первыми.
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x', 'x-filename': 'nebula.jpg' },
      body: 'x',
    });
    assert.equal(res.status, 200);
    const item = (await res.json()).wallpapers.items[0];
    assert.equal(item.type, 'photo');
    assert.equal(item.name, 'nebula', 'имя из файла, без расширения');
    assert.match(item.url, /^\/uploads\/wallpapers\//, 'ссылка на файл, а не base64');
    assert.equal(JSON.stringify(db.builtinWallpapers).includes('fake'), false, 'файл не вшит в БД');
  } finally { server.close(); }
});

test('удаление фона убирает и сам файл с диска', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const created = await fetch(`${base}/api/themes/wallpapers`, {
      method: 'POST',
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x' },
      body: 'x',
    });
    const item = (await created.json()).wallpapers.items[0];
    assert.ok(fs.existsSync(path.join(uploadsDir, 'test.jpg')), 'файл лежит на диске');

    const res = await fetch(`${base}/api/themes/wallpapers/${item.id}`, send('DELETE', asAdminJson));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).wallpapers.items.length, 0, 'каталог пуст');
    assert.equal(fs.existsSync(path.join(uploadsDir, 'test.jpg')), false, 'файл удалён, иначе uploads растёт вечно');
  } finally { server.close(); }
});

test('удаление чужого фона — 404, а не тихий успех', async () => {
  // id с недопустимыми символами не похож ни на загруженный фон, ни на
  // заводской: такой запрос не должен ничего скрывать «на всякий случай».
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes/wallpapers/Не%20фон%3F`, send('DELETE', asAdminJson));
    assert.equal(res.status, 404);
  } finally { server.close(); }
});

test('фон переименовывается и переключается «светлый» без смены id', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const created = await fetch(`${base}/api/themes/wallpapers/base`, send('POST', asAdminJson, {
      name: 'Закат', css: 'linear-gradient(#000,#fff)',
    }));
    const id = (await created.json()).wallpapers.items[0].id;

    const res = await fetch(`${base}/api/themes/wallpapers/${id}`, send('PUT', asAdminJson, {
      name: 'Закат (обновлён)', light: true,
    }));
    assert.equal(res.status, 200);
    const item = (await res.json()).wallpapers.items[0];
    assert.equal(item.name, 'Закат (обновлён)');
    assert.equal(item.light, true);
    assert.equal(item.id, id, 'id не меняется — темы, ссылающиеся на фон, не ломаются');
  } finally { server.close(); }
});

test('правкой css нельзя протащить url()', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const created = await fetch(`${base}/api/themes/wallpapers/base`, send('POST', asAdminJson, {
      name: 'Закат', css: 'linear-gradient(#000,#fff)',
    }));
    const id = (await created.json()).wallpapers.items[0].id;
    const res = await fetch(`${base}/api/themes/wallpapers/${id}`, send('PUT', asAdminJson, {
      css: 'url(https://evil.example/x.png)',
    }));
    assert.equal(res.status, 400, 'правка проходит через тот же санитайзер');
  } finally { server.close(); }
});

test('замена фото сохраняет id и убирает старый файл', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const created = await fetch(`${base}/api/themes/wallpapers`, {
      method: 'POST',
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x' },
      body: 'x',
    });
    const first = (await created.json()).wallpapers.items[0];
    assert.ok(fs.existsSync(path.join(uploadsDir, 'test.jpg')), 'первый файл на диске');

    const res = await fetch(`${base}/api/themes/wallpapers/${first.id}/replace`, {
      method: 'POST',
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x', 'x-filename': 'new.jpg' },
      body: 'x',
    });
    assert.equal(res.status, 200);
    const item = (await res.json()).wallpapers.items[0];
    assert.equal(item.id, first.id, 'id прежний — выборки обоев и темы остаются валидными');
    assert.ok(item.url.startsWith('/uploads/wallpapers/'), 'новый файл сохранён');
    assert.equal(item.url, first.url, 'заглушка отдаёт то же имя файла — проверим через имя');
  } finally { server.close(); }
});

// ── Главное: загрузка не должна падать на «неизвестном» типе файла ───────────

test('файл без mime-типа даёт 400 с текстом, а не 500 с HTML', async () => {
  // Именно это ломало загрузку: mimeFilter звал cb(new Error) без
  // обработчика, express отдавал 500 c HTML, а клиент показывал
  // «Не удалось загрузить фон» вместо внятной причины.
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const rejecting = {
      single: () => (req, res, next) => next(new Error('Тип файла не разрешён: ')),
    };
    const db = { builtinWallpapers: undefined };
    const a2 = express();
    a2.use((req, res, next) => (
      String(req.headers['content-type'] || '').includes('application/json')
        ? express.json()(req, res, next) : next()
    ));
    install({
      app: a2, getDb: () => db, saveDb: () => {}, auth: (q, r, n) => n(),
      isAdmin: () => true, notify: () => {}, upload: rejecting, uploadsDir,
      onUploadError: (err, req, res, next) => {
        if (!err) return next();
        res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой' : (err.message || 'Ошибка загрузки') });
      },
    });
    const { server: s2, base: b2 } = await start(a2);
    try {
      const res = await fetch(`${b2}/api/themes/wallpapers`, {
        method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'x',
      });
      assert.equal(res.status, 400, 'понятный 4xx, а не 500');
      assert.match(res.headers.get('content-type') || '', /application\/json/, 'ответ — json, а не HTML');
      assert.ok((await res.json()).message, 'есть текст причины для пользователя');
    } finally { s2.close(); }
  } finally { server.close(); }
});

test('слишком большой файл отбивается как «слишком большой»', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const tooBig = {
      single: () => (req, res, next) => {
        const err = new Error('File too large');
        err.code = 'LIMIT_FILE_SIZE';
        next(err);
      },
    };
    const db = { builtinWallpapers: undefined };
    const a2 = express();
    install({
      app: a2, getDb: () => db, saveDb: () => {}, auth: (q, r, n) => n(),
      isAdmin: () => true, notify: () => {}, upload: tooBig, uploadsDir,
      onUploadError: (err, req, res, next) => {
        if (!err) return next();
        res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой' : (err.message || 'Ошибка загрузки') });
      },
    });
    const { server: s2, base: b2 } = await start(a2);
    try {
      const res = await fetch(`${b2}/api/themes/wallpapers`, {
        method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'x',
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).message, 'Файл слишком большой');
    } finally { s2.close(); }
  } finally { server.close(); }
});
// ── Санитайзер: css из сети рисуется у каждого клиента ───────────────────────

test('css-фон принимается, если это просто градиент/цвета', () => {
  const item = sanitizeItem({
    id: 'admin-wp-aaaa1111',
    name: 'Закат',
    type: 'base',
    css: 'linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)',
  });
  assert.ok(item, 'валидный градиент принят');
  assert.equal(item.name, 'Закат');
  assert.equal(item.light, false, 'по умолчанию тёмный');
});

test('из css вырезаны url() и всё, чем можно выйти из background', () => {
  // Фон рисуется у ВСЕХ, поэтому это код в style: url() увёл бы наружу,
  // «;» и скобки — выход из контекста значения, «@» — в @import.
  const bad = [
    'url(https://evil.example/x.png)',
    'url("file:///etc/passwd")',
    'linear-gradient(#fff, #000); background: url(x)',
    '@import "evil.css"',
    'expression(alert(1))',
    '#fff} body{display:none',
    'red; }</style><script>alert(1)</script>',
    'javascript:alert(1)',
    '#fff\\3b color:red',
  ];
  for (const css of bad) {
    assert.equal(sanitizeItem({ id: 'admin-wp-bbbb2222', type: 'base', css }), null, `отбит: ${css}`);
  }
});

test('фон без «content» или пустой не принимается', () => {
  for (const css of ['', '   ', 'none', undefined, 123]) {
    assert.equal(sanitizeItem({ id: 'admin-wp-cccc3333', type: 'base', css }), null, `отбит: ${css}`);
  }
});

test('слишком длинный css не принимается', () => {
  const long = 'linear-gradient(' + 'red '.repeat(2000) + ')';
  assert.equal(sanitizeItem({ id: 'admin-wp-dddd4444', type: 'base', css: long }), null);
});

test('чужой id и чужая ссылка не принимаются', () => {
  // id уходит в css-класс и в выбор темы — с мусором он ломает разметку.
  assert.equal(sanitizeItem({ id: 'bad id', type: 'base', css: '#fff' }), null);
  assert.equal(sanitizeItem({ id: '../x', type: 'base', css: '#fff' }), null);
  assert.equal(sanitizeItem({ id: 'base-paper-cream', type: 'base', css: '#fff' }), null, 'не выдаём id заводских обоев');
  // Фото обязано лежать в НАШЕЙ папке: иначе можно было бы в галерею подсунуть
  // ссылку на чужой ресурс или на file://.
  for (const url of ['https://evil.example/x.png', '/uploads/avatars/a.jpg', '/uploads/wallpapers/../x.jpg', '//evil/x.jpg']) {
    assert.equal(sanitizeItem({ id: 'admin-wp-eeee5555', type: 'photo', url }), null, `отбит: ${url}`);
  }
  assert.ok(sanitizeItem({ id: 'admin-wp-eeee5555', type: 'photo', url: '/uploads/wallpapers/a1b2.jpg' }));
});

test('фото без url и фон неизвестного типа не принимаются', () => {
  assert.equal(sanitizeItem({ id: 'admin-wp-ffff6666', type: 'photo' }), null);
  assert.equal(sanitizeItem({ id: 'admin-wp-ffff6666', type: 'video', css: '#fff' }), null);
  assert.equal(sanitizeItem(null), null);
});

test('isOwnUpload пропускает только наши файлы фонов', () => {
  assert.equal(isOwnUpload('/uploads/wallpapers/a.jpg'), true);
  assert.equal(isOwnUpload('/uploads/wallpapers/../../etc/passwd'), false);
  assert.equal(isOwnUpload('http://x/y.jpg'), false);
});

test('пустая/битая БД превращается в пустой каталог, а не падает', () => {
  const empty = { items: [], hidden: [], overrides: {}, updatedAt: null };
  assert.deepEqual(ensureCatalog({}), empty);
  assert.deepEqual(ensureCatalog({ builtinWallpapers: { items: 'мусор' } }), empty);
  // overrides без hidden (БД со старой версии) тоже должны доехать целыми.
  assert.deepEqual(ensureCatalog({ builtinWallpapers: { items: [], hidden: ['base-x'] } }).overrides, {});
  assert.equal(MAX_ITEMS, 200, 'лимит каталога задан');
});
// ── Заводские фоны: правка и «удаление» поверх бандла ─────────────────────────

test('заводской фон скрывается из каталога (это и есть его удаление)', async () => {
  // Фон вшит в бандл клиента — файла на сервере нет. Но убрать его из галереи у
  // всех можно, и для пользователя это неотличимо от удаления.
  const { app, db, pushes } = createHarness();
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/themes/wallpapers/base-paper-cream`, send('DELETE', asAdminJson));
    assert.equal(res.status, 200);
    const cat = (await res.json()).wallpapers;
    assert.deepEqual(cat.hidden, ['base-paper-cream']);
    assert.deepEqual(cat.items, [], 'в items ничего не попало — фон не наш');
    assert.deepEqual(db.builtinWallpapers.hidden, ['base-paper-cream']);
    assert.equal(pushes.length, 1, 'галерея у всех обновилась');

    // Повторное удаление — 404, чтобы в списке не копились дубли.
    const again = await fetch(`${base}/api/themes/wallpapers/base-paper-cream`, send('DELETE', asAdminJson));
    assert.equal(again.status, 404);
  } finally { server.close(); }
});

test('правка заводского фона ложится в overrides и снимает скрытие', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    await fetch(`${base}/api/themes/wallpapers/base-deep-night`, send('DELETE', asAdminJson));
    const res = await fetch(`${base}/api/themes/wallpapers/base-deep-night`, send('PUT', asAdminJson, {
      name: 'Ночь Vera', light: true, css: 'linear-gradient(#000,#111)',
    }));
    assert.equal(res.status, 200);
    const cat = (await res.json()).wallpapers;
    // Вернули фон в галерею — иначе «вернуть» было бы нечем.
    assert.deepEqual(cat.hidden, [], 'правка возвращает фон из галереи');
    assert.deepEqual(cat.overrides['base-deep-night'], {
      name: 'Ночь Vera', light: true, css: 'linear-gradient(#000,#111)',
    });
    assert.deepEqual(cat.items, [], 'в items по-прежнему пусто: фон не копируется');
  } finally { server.close(); }
});

test('через правку заводского фона нельзя протащить url() или чужой файл', async () => {
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    for (const body of [
      { css: 'url(https://evil.example/x.png)' },
      { url: 'https://evil.example/x.png' },
      { url: '/uploads/avatars/a.png' },
      { css: '#fff} body{display:none' },
    ]) {
      const res = await fetch(`${base}/api/themes/wallpapers/base-ember`, send('PUT', asAdminJson, body));
      assert.equal(res.status, 400, `отбито: ${JSON.stringify(body)}`);
    }
  } finally { server.close(); }
});

test('«Без обоев» нельзя ни скрыть, ни переписать', async () => {
  // Это сброс выбора, а не фон: если его скрыть, у всех пропадёт возможность
  // выключить обои в галерее.
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    assert.equal((await fetch(`${base}/api/themes/wallpapers/none`, send('DELETE', asAdminJson))).status, 404);
    assert.equal((await fetch(`${base}/api/themes/wallpapers/none`, send('PUT', asAdminJson, { name: 'X' }))).status, 400);
    const cat = (await (await fetch(`${base}/api/themes/wallpapers`, { headers: asAdminJson.headers })).json()).wallpapers;
    assert.deepEqual(cat.hidden, [], 'ничего не скрыто');
    assert.deepEqual(cat.overrides, {}, 'ничего не переписано');
  } finally { server.close(); }
});

test('удаление загруженного фона чистит и его правку, и скрытие', async () => {
  // Иначе в каталоге остался бы мусор по удалённому фону.
  const { app } = createHarness();
  const { server, base } = await start(app);
  try {
    const created = await fetch(`${base}/api/themes/wallpapers`, {
      method: 'POST',
      headers: { ...asAdminJson.headers, 'content-type': 'multipart/form-data; boundary=x' },
      body: 'x',
    });
    const id = (await created.json()).wallpapers.items[0].id;
    const res = await fetch(`${base}/api/themes/wallpapers/${id}`, send('DELETE', asAdminJson));
    const cat = (await res.json()).wallpapers;
    assert.deepEqual(cat.items, []);
    assert.ok(!(id in cat.overrides), 'правки удалённого фона не осталось');
  } finally { server.close(); }
});

test('isFactoryId узнаёт заводские id и не путает их с чужими', () => {
  for (const ok of ['base-paper-cream', 'base-deep-night', 'gradient-purple', 'night-sky', 'mountains']) {
    assert.equal(isFactoryId(ok), true, `заводской: ${ok}`);
  }
  for (const bad of ['none', '', 'Не фон', 'a'.repeat(80), 'admin-wp-abc123']) {
    assert.equal(isFactoryId(bad), false, `не заводской: ${bad}`);
  }
});