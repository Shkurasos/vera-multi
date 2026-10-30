const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createStore } = require('zustand/vanilla');

/**
 * Синк своих паков иконок (services/iconPackSync.ts) против поддельного
 * сервера в памяти: списки, докачка, выгрузка, удаление, смена аккаунта.
 */
function setup(serverPacks = {}) {
  const storage = new Map([['vera_token', 'tok'], ['vera_sync_client_id', 'me']]);
  const server = new Map(Object.entries(serverPacks));
  const calls = [];
  const timers = [];
  const store = createStore(() => ({ packs: {}, hydrated: true, syncing: false }));
  const ui = createStore((set) => ({ customPack: null, setCustomPack: (id) => set({ customPack: id || null }) }));
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const m = /\/api\/icon-packs\/mine(?:\/([^?]+))?/.exec(url);
    const id = m[1] && decodeURIComponent(m[1]);
    calls.push(`${method} ${id || ''}`.trim());
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (method === 'GET' && !id) return json({ packs: [...server.values()].map(({ id: i, name, updatedAt }) => ({ id: i, name, updatedAt })) });
    if (method === 'GET') return server.has(id) ? json({ pack: server.get(id) }) : { ok: false, status: 404 };
    if (method === 'PUT') { const b = JSON.parse(init.body); server.set(id, { id, ...b.pack, updatedAt: b.updatedAt }); return json({ ok: true }); }
    if (method === 'DELETE') { server.delete(id); return json({ ok: true }); }
    throw new Error('unexpected ' + method);
  };
  const modules = {
    '../store/iconPackStore': { useIconPackStore: store },
    '../store/uiPrefsStore': { useUiPrefsStore: ui },
    './storeSyncSimple': { getSyncClientId: () => 'me' },
  };
  const handlers = new Map();
  const socket = {
    on: (e, h) => handlers.set(e, h),
    off: (e) => handlers.delete(e),
    emit: (e, p) => handlers.get(e)?.(p),
  };
  const context = vm.createContext({
    exports: {}, console, fetch, Promise, __socket: socket,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    require: (name) => { if (modules[name]) return modules[name]; throw new Error('unexpected require ' + name); },
  });
  // Динамический import('./socket') в vm недоступен — подменяем поддельным сокетом.
  const src = fs.readFileSync(path.join(__dirname, 'src/services/iconPackSync.ts'), 'utf8')
    .replace("import('./socket')", 'Promise.resolve({ getSocket: () => __socket })');
  vm.runInContext(ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  // Таймер выгрузки запускает upload без await — даём ему досчитаться.
  const flush = async () => {
    for (let i = 0; i < 10; i++) {
      while (timers.length) await timers.shift()();
      await new Promise((r) => setImmediate(r));
    }
  };
  return { sync: context.exports, store, ui, socket, server, calls, storage, flush };
}

const pack = (id, updatedAt, icons = { Search: { kind: 'text', text: '🐱' } }) => ({ id, name: `Пак ${id}`, base: 'filled', icons, updatedAt });

test('новое устройство докачивает паки аккаунта и ничего не удаляет на сервере', async () => {
  const env = setup({ a: pack('a', 10), b: pack('b', 20) });
  await env.sync.startIconPackSync('owner', false);
  await env.flush();
  assert.deepEqual(Object.keys(env.store.getState().packs).sort(), ['a', 'b']);
  assert.equal(env.store.getState().packs.a.icons.Search.text, '🐱');
  assert.ok(!env.calls.some((c) => c.startsWith('DELETE')), 'пустое устройство не стирает паки');
  assert.ok(!env.calls.some((c) => c.startsWith('PUT')), 'докачанное не уходит обратно');
  assert.equal(env.store.getState().syncing, false);
});

test('локальный пак, которого нет на сервере, выгружается; свежая правка — тоже', async () => {
  const env = setup({ a: pack('a', 10) });
  env.store.setState({ packs: { a: pack('a', 50), local: pack('local', 5) } });
  await env.sync.startIconPackSync('owner', false);
  await env.flush();
  assert.equal(env.server.get('local').name, 'Пак local');
  assert.equal(env.server.get('a').updatedAt, 50, 'более новая локальная версия победила');
});

test('правка и удаление пака после входа уходят на сервер', async () => {
  const env = setup({ a: pack('a', 10) });
  await env.sync.startIconPackSync('owner', false);
  await env.flush();
  env.store.setState({ packs: { ...env.store.getState().packs, n: pack('n', 99) } });
  await env.flush();
  assert.ok(env.server.has('n'));
  const { a, ...rest } = env.store.getState().packs;
  env.store.setState({ packs: rest });
  await env.flush();
  assert.ok(!env.server.has('a'), 'удалённый пользователем пак удалён на сервере');
});

test('смена аккаунта убирает паки прежнего и не выгружает их новому', async () => {
  const env = setup({});
  env.store.setState({ packs: { old: pack('old', 1) } });
  await env.sync.startIconPackSync('other', true);
  await env.flush();
  assert.equal(Object.keys(env.store.getState().packs).length, 0);
  assert.ok(!env.server.has('old'));
});

test('после выхода изменения паков никуда не отправляются', async () => {
  const env = setup({});
  await env.sync.startIconPackSync('owner', false);
  await env.flush();
  env.sync.stopIconPackSync();
  env.store.setState({ packs: { x: pack('x', 1) } });
  await env.flush();
  assert.ok(!env.server.has('x'));
});

test('включённый пак свой у устройства: синк паков его не меняет, пока пак существует', async () => {
  const env = setup({ a: pack('a', 10) });
  env.store.setState({ packs: { a: pack('a', 10) } });
  env.ui.getState().setCustomPack('a');
  await env.sync.startIconPackSync('owner', false);
  await env.flush();
  assert.equal(env.ui.getState().customPack, 'a');
});

test('пак удалили на другом устройстве — здесь он выключается', async () => {
  const env = setup({ a: pack('a', 10), b: pack('b', 20) });
  await env.sync.startIconPackSync('owner', false);
  await env.flush();
  env.ui.getState().setCustomPack('a');
  env.server.delete('a');
  env.socket.emit('icon-packs:updated', { packs: [{ id: 'b', name: 'Пак b', updatedAt: 20 }], clientId: 'phone' });
  await env.flush();
  assert.deepEqual(Object.keys(env.store.getState().packs), ['b']);
  assert.equal(env.ui.getState().customPack, null);
});

test('чужой пак удалили — включённый здесь пак остаётся', async () => {
  const env = setup({ a: pack('a', 10), b: pack('b', 20) });
  await env.sync.startIconPackSync('owner', false);
  await env.flush();
  env.ui.getState().setCustomPack('a');
  env.socket.emit('icon-packs:updated', { packs: [{ id: 'a', name: 'Пак a', updatedAt: 10 }], clientId: 'phone' });
  await env.flush();
  assert.equal(env.ui.getState().customPack, 'a');
});

test('смена аккаунта выключает пак прежнего', async () => {
  const env = setup({});
  env.store.setState({ packs: { old: pack('old', 1) } });
  env.ui.getState().setCustomPack('old');
  await env.sync.startIconPackSync('other', true);
  await env.flush();
  assert.equal(env.ui.getState().customPack, null);
});
