/**
 * Дымовой тест боевого server.js: символ в начале названия задаёт вид чата.
 *
 * vm-тесты в channels.test.js вырезают куски кода и не ловят ошибки порядка
 * объявлений при старте. Здесь сервер поднимается целиком на БД со старым
 * чатом «/» (пустое имя после символа) — ровно на нём старт падал с TDZ.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');

const PORT = 34568;
const JWT_SECRET = 'smoke-test-secret-secret-secret-32+';
const BASE = `http://127.0.0.1:${PORT}`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-chat-kind-smoke-'));
const dbFile = path.join(tmpDir, 'vera.json');

fs.writeFileSync(dbFile, JSON.stringify({
  users: [{ id: 'user-1', username: 'ordinary', email: null, tokenVersion: 0 }],
  chats: [
    { id: 'legacy-board', type: 'group', name: '/', ownerId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'legacy-desk', type: 'group', name: '| Дело', ownerId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  chatMembers: [
    { id: 'm1', chatId: 'legacy-board', userId: 'user-1', role: 'owner' },
    { id: 'm2', chatId: 'legacy-desk', userId: 'user-1', role: 'owner' },
  ],
  messages: [], tracks: [], admins: [], devices: [], linkInvites: [], callLogs: [], bots: [],
  aiModels: [], aiSessions: [], walletOrders: [], refreshTokens: [],
}), 'utf8');

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: {
    ...process.env, PORT: String(PORT), JWT_SECRET, NODE_ENV: 'development',
    DB_FILE: dbFile, UPLOADS_DIR: path.join(tmpDir, 'uploads'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const childLog = [];
child.stderr.on('data', (d) => childLog.push(d.toString()));
child.stdout.on('data', (d) => childLog.push(d.toString()));
child.on('exit', (code) => childLog.push(`\n[server exited: ${code}]`));

const auth = {
  authorization: `Bearer ${jwt.sign({ sub: 'user-1', deviceId: null, tv: 0, dv: 0 }, JWT_SECRET, { expiresIn: '5m' })}`,
  'content-type': 'application/json',
};

test.before(async () => {
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`${BASE}/api/themes`)).status) return; } catch { /* поднимается */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`сервер не поднялся.\n${childLog.join('')}`);
});

test.after(() => {
  child.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function create(name) {
  const res = await fetch(`${BASE}/api/chats/group`, { method: 'POST', headers: auth, body: JSON.stringify({ name, memberIds: [] }) });
  assert.equal(res.status, 200, childLog.join(''));
  return res.json();
}

test('server starts on legacy «/» chat and migrates old prefixes', async () => {
  const chats = await (await fetch(`${BASE}/api/chats`, { headers: auth })).json();
  const by = (id) => chats.find((c) => c.id === id);
  assert.equal(by('legacy-board').kind, 'whiteboard');
  assert.equal(by('legacy-board').name, 'Холст');
  assert.equal(by('legacy-desk').kind, 'desk');
  assert.equal(by('legacy-desk').name, 'Дело');
});

test('prefix sets kind over HTTP, with and without a space', async () => {
  for (const [name, type, kind, clean] of [
    ['!Новости', 'channel', undefined, 'Новости'],
    ['! Новости', 'channel', undefined, 'Новости'],
    ['/desk Дело', 'group', 'desk', 'Дело'],
    ['/DESK Дело', 'group', 'desk', 'Дело'],
    ['/desk', 'group', 'desk', 'Доска'],
    ['/canvas Рисунки', 'group', 'whiteboard', 'Рисунки'],
    ['/canvas', 'group', 'whiteboard', 'Холст'],
    // Старые маркеры и похожие слова — уже не команды.
    ['/холст', 'group', undefined, '/холст'],
    ['/deskx', 'group', undefined, '/deskx'],
    ['| Дело', 'group', undefined, '| Дело'],
    ['Обычная', 'group', undefined, 'Обычная'],
  ]) {
    const chat = await create(name);
    assert.equal(chat.type, type, name);
    assert.equal(chat.kind, kind, name);
    assert.equal(chat.name, clean, name);
  }
});
