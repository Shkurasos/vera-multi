const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createStore } = require('zustand/vanilla');

function setup(data) {
  const storage = new Map([['vera_token', 'token'], ['vera_user', '{"id":"owner"}'], ['vera_sync_active_account', 'owner']]);
  const writes = [];
  const timers = new Map();
  const handlers = {};
  const context = vm.createContext({ exports: {}, console, crypto: { randomUUID: () => 'client' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    setTimeout: fn => { const id = {}; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    require: () => ({ getSocket: () => ({ on: (event, fn) => { handlers[event] = fn; }, off() {} }) }),
    fetch: async (url, init) => {
      if (init.method === 'PUT') writes.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ data, updatedAt: '2026-09-19T00:00:00Z' }) };
    },
  });
  vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/services/storeSyncSimple.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { sync: context.exports, storage, writes, timers, handlers };
}

test('first snapshot is uploaded without requiring another settings edit', async () => {
  const env = setup(null);
  const store = createStore(() => ({ themeId: 42 }));
  env.sync.enableStoreSync('theme', store);
  await env.sync.initStoreSyncOnLogin('owner');
  for (const callback of env.timers.values()) await callback();
  assert.equal(env.writes[0].data.themeId, 42);
});

test('account switch discards old local settings before applying the owner snapshot', async () => {
  const env = setup({ themeId: 7 });
  const store = createStore(() => ({ themeId: 0, customThemes: [] }));
  store.setState({ themeId: 99, customThemes: ['old-account'] });
  env.storage.set('vera_sync_active_account', 'other');
  env.sync.enableStoreSync('theme', store);
  await env.sync.initStoreSyncOnLogin('owner');
  assert.equal(store.getState().themeId, 7);
  assert.deepEqual(store.getState().customThemes, []);
  assert.equal(env.writes.length, 0);
});

test('empty remote chat lists propagate unpin, unarchive and unmute', async () => {
  const env = setup({ pinnedIds: [], archivedIds: [], mutedIds: [] });
  const store = createStore(() => ({ pinnedIds: ['a'], archivedIds: ['a'], mutedIds: ['a'], pinnedMessages: {} }));
  env.sync.enableStoreSync('chat-prefs', store);
  await env.sync.initStoreSyncOnLogin('owner');
  for (const key of ['pinnedIds', 'archivedIds', 'mutedIds']) assert.equal(store.getState()[key].length, 0);
});

test('queued writes cannot cross an account switch', async () => {
  const env = setup(null);
  const store = createStore(() => ({ themeId: 1 }));
  env.sync.enableStoreSync('theme', store);
  await env.sync.initStoreSyncOnLogin('owner');
  env.storage.set('vera_user', '{"id":"other"}');
  for (const callback of env.timers.values()) await callback();
  assert.equal(env.writes.length, 0);
});