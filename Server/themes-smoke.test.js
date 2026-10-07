
/**
 * Дымовой тест боевого server.js: встроенные темы читает любой, правит админ.
 *
 * Модульные тесты themes.test.js проверяют сам роутер, но не то, что он вообще
 * подключён в приложении и что admin-гейт уехал в тот же файл. Здесь поднимаем
 * настоящий сервер на временной БД и ходим по HTTP.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');

const PORT = 34567;
const JWT_SECRET = 'smoke-test-secret-secret-secret-32+';
const BASE = `http://127.0.0.1:${PORT}`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-themes-smoke-'));
const dbFile = path.join(tmpDir, 'vera.json');

// Админ по ADMIN_USERNAMES — без записи в db.admins.
fs.writeFileSync(dbFile, JSON.stringify({
  users: [
    { id: 'admin-1', username: 'Vera_koto_a', email: null, tokenVersion: 0 },
    { id: 'user-1', username: 'ordinary', email: null, tokenVersion: 0 },
  ],
  chats: [], chatMembers: [], messages: [], tracks: [], chatMembers: [],
  admins: [], devices: [], linkInvites: [], callLogs: [], bots: [],
  aiModels: [], aiSessions: [], walletOrders: [], refreshTokens: [],
}), 'utf8');

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  // У каждого набора тестов своя БД и свои загрузки: иначе тесты влияли бы
  // друг на друга (каталог фонов общий на сервер).
  env: {
    ...process.env, PORT: String(PORT), JWT_SECRET, NODE_ENV: 'development',
    DB_FILE: process.env.SMOKE_DB || dbFile,
    UPLOADS_DIR: process.env.SMOKE_UPLOADS || path.join(tmpDir, 'uploads'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

// stderr пробрасываем в свой лог: иначе причина падения при старте не видна.
const childLog = [];
child.stderr.on('data', (d) => childLog.push(d.toString()));
child.stdout.on('data', (d) => childLog.push(d.toString()));
child.on('exit', (code) => childLog.push(`\n[server exited: ${code}]`));

const token = (id) => jwt.sign({ sub: id, deviceId: null, tv: 0, dv: 0 }, JWT_SECRET, { expiresIn: '5m' });
const authed = (id) => ({ headers: { authorization: `Bearer ${token(id)}` } });

async function waitForServer() {
  // Сервер тяжёлый (много модулей, миграции БД) — ждём щедро.
  for (let i = 0; i < 300; i++) {
    try {
      const res = await fetch(`${BASE}/api/themes`);
      if (res.status) return;
    } catch { /* ещё поднимается */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`сервер не поднялся.\n${childLog.join('')}`);
}

// Один сервер на весь файл: поднимать его ради каждого теста дорого, а второй
// инстанс не занял бы тот же порт.
test.before(async () => { await waitForServer(); });

/**
 * Записи БД коалесцируются (DB_SAVE_DEBOUNCE_MS), поэтому файл появляется не
 * сразу после ответа. Ждём, пока каталог действительно ляжет на диск.
 */
async function readPersisted() {
  for (let i = 0; i < 60; i++) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      if (parsed?.builtinThemes?.overrides?.['0']) return parsed;
    } catch { /* файл ещё пишется */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}
test.after(() => {
  child.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('боевой сервер: чтение всем, запись админу, остальным 403', async () => {
  // 1. Любой залогиненный читает каталог — иначе правки админа никто не увидит.
  const userRead = await fetch(`${BASE}/api/themes`, authed('user-1'));
  assert.equal(userRead.status, 200, 'обычный пользователь читает каталог');

  const catalog = (await userRead.json()).themes;
  assert.deepEqual(catalog, { overrides: {}, removed: [], added: [], updatedAt: null }, 'из коробки пусто');

  // 2. Обычный пользователь править не может.
  const forbidden = await fetch(`${BASE}/api/themes`, {
    method: 'PUT',
    headers: { ...authed('user-1').headers, 'content-type': 'application/json' },
    body: JSON.stringify({ overrides: { 0: { name: 'Взлом' } }, removed: [], added: [] }),
  });
  assert.equal(forbidden.status, 403, 'не-админ получает 403');

  // 3. Админ публикует правку, удаление и новую тему.
  const published = await fetch(`${BASE}/api/themes`, {
    method: 'PUT',
    headers: { ...authed('admin-1').headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      overrides: { 0: { name: 'Vera для всех', bg: '#0a0a0a' } },
      removed: [29],
      added: [{ id: 500, name: 'Стоковая', bg: '#123456' }],
    }),
  });
  assert.equal(published.status, 200, 'админ публикует');

  // 4. Каталог сохранился и виден остальным — и на диске тоже.
  const afterRead = await fetch(`${BASE}/api/themes`, authed('user-1'));
  const after = (await afterRead.json()).themes;
  assert.equal(after.overrides['0'].name, 'Vera для всех');
  assert.deepEqual(after.removed, [29]);
  assert.equal(after.added[0].id, 500);
  assert.ok(after.updatedAt, 'updatedAt проставлен');

  const onDisk = await readPersisted();
  assert.equal(onDisk.builtinThemes.overrides['0'].name, 'Vera для всех', 'каталог записан в БД');
});

test('без токена каталог не отдаётся', async () => {
  assert.equal((await fetch(`${BASE}/api/themes/wallpapers`)).status, 401);
});

test('админ загружает фото-файл: он доступен всем и лежит в uploads', async () => {
  // Настоящий multipart с картинкой: это проверяет связку multer + санитайзер,
  // которую заглушка юнит-теста подменяет.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'Закат.png');
  form.append('name', 'Закат');

  const up = await fetch(`${BASE}/api/themes/wallpapers`, {
    method: 'POST', headers: { authorization: `Bearer ${token('admin-1')}` }, body: form,
  });
  assert.equal(up.status, 200, 'админ загрузил фон');
  const item = (await up.json()).wallpapers.items[0];
  assert.equal(item.type, 'photo');
  assert.equal(item.name, 'Закат', 'имя из формы, а не из имени файла');
  assert.match(item.url, /^\/uploads\/wallpapers\/.+\.png$/, 'файл сохранён с расширением');

  // Файл реально отдаётся по HTTP — иначе фон был бы битым у всех.
  const file = await fetch(`${BASE}${item.url}`);
  assert.equal(file.status, 200, 'файл доступен по ссылке из каталога');
  assert.ok((await file.arrayBuffer()).byteLength > 0, 'файл не пустой');

  // Не-админ загрузить не может.
  const form2 = new FormData();
  form2.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
  const denied = await fetch(`${BASE}/api/themes/wallpapers`, {
    method: 'POST', headers: { authorization: `Bearer ${token('user-1')}` }, body: form2,
  });
  assert.equal(denied.status, 403);

  // Обычный пользователь видит фон в каталоге.
  const seen = await (await fetch(`${BASE}/api/themes/wallpapers`, authed('user-1'))).json();
  assert.equal(seen.wallpapers.items.length, 1, 'фон общий');
  assert.equal(seen.wallpapers.items[0].id, item.id);
});

test('не-файл и огромный градиент в фон не пролезают', async () => {
  const put = (body) => fetch(`${BASE}/api/themes/wallpapers/base`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token('admin-1')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.equal((await put({ name: 'X', css: 'url(https://evil.example/x.png)' })).status, 400, 'url() отбит');
  assert.equal((await put({ name: 'X', css: '#fff} body{display:none' })).status, 400, 'выход из контекста отбит');
  assert.equal((await put({ name: 'X', css: 'x'.repeat(5000) })).status, 400, 'слишком длинный css отбит');
  assert.equal((await put({ name: 'Норм', css: 'linear-gradient(#000,#fff)' })).status, 200, 'валидный градиент принят');
});