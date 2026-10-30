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

test('empty remote chat-bg snapshot does not wipe local wallpapers', async () => {
  // Серверный снапшот без списка фото-обоев (dataURL-синк падал с 413)
  // не должен затирать локальные userWallpapers/userPhotoWallpaper.
  const env = setup({ brightness: {}, userWallpapers: {}, userPhotoWallpaper: null });
  const store = createStore(() => ({
    brightness: {},
    userWallpapers: { global: [{ id: 'a', name: 'Закат', type: 'photo', value: 'global:a', createdAt: 1 }] },
    userPhotoWallpaper: 'global:a',
    userPhotoName: 'Закат',
    perChatOverrides: {},
  }));
  env.sync.enableStoreSync('chat-bg-prefs', store);
  await env.sync.initStoreSyncOnLogin('owner');
  assert.equal(store.getState().userPhotoWallpaper, 'global:a');
  assert.equal(store.getState().userWallpapers.global.length, 1);
  assert.equal(store.getState().userWallpapers.global[0].value, 'global:a');
});

test('remote snapshot with wallpapers replaces local list', async () => {
  const env = setup({
    userWallpapers: { global: [{ id: 'b', name: 'Море', type: 'photo', value: 'global:b', createdAt: 2 }] },
    userPhotoWallpaper: 'global:b',
    userPhotoName: 'Море',
  });
  const store = createStore(() => ({
    userWallpapers: { global: [{ id: 'a', name: 'Закат', type: 'photo', value: 'global:a', createdAt: 1 }] },
    userPhotoWallpaper: 'global:a',
    userPhotoName: 'Закат',
    perChatOverrides: {},
  }));
  env.sync.enableStoreSync('chat-bg-prefs', store);
  await env.sync.initStoreSyncOnLogin('owner');
  assert.equal(store.getState().userWallpapers.global[0].id, 'b');
  assert.equal(store.getState().userPhotoWallpaper, 'global:b');
});

test('theme snapshot leaves out the shared builtin catalog and derived fields', async () => {
  const env = setup(null);
  const store = createStore(() => ({
    themeId: 5, customThemes: [], settingsByTheme: { 5: { layout: { mobileHeaderStyle: 'island' } } },
    builtinThemes: new Array(30).fill({ big: 'x'.repeat(1000) }), builtinThemesLoading: false,
    publishedBuiltinCatalog: {}, themeVersion: 3, theme: { id: 5 },
  }));
  env.sync.enableStoreSync('theme', store);
  await env.sync.initStoreSyncOnLogin('owner');
  for (const callback of env.timers.values()) await callback();
  const sent = env.writes[0].data;
  assert.equal(sent.themeId, 5);
  assert.equal(sent.settingsByTheme[5].layout.mobileHeaderStyle, 'island');
  for (const key of ['builtinThemes', 'builtinThemesLoading', 'publishedBuiltinCatalog', 'themeVersion', 'theme']) {
    assert.ok(!(key in sent), `${key} не уходит на сервер`);
  }
});

test('incoming theme keeps local derived fields and runs the store hooks', async () => {
  const env = setup({ themeId: 9, theme: { id: 'stale-from-server' }, builtinThemes: [] });
  const local = { themeId: 1, theme: { id: 1 }, builtinThemes: [{ id: 1 }], themeVersion: 0 };
  const store = createStore(() => local);
  let after = 0;
  env.sync.enableStoreSync('theme', store, 800, {
    snapshot: (d) => ({ ...d, compacted: true }),
    merge: (current, next) => ({ ...next, merged: current.themeId }),
    afterRemote: () => { after += 1; assert.equal(env.sync.isStoreSyncReady('theme'), false, 'ещё под гидратацией'); },
  });
  assert.equal(env.sync.isStoreSyncReady('theme'), false, 'до входа стор не готов');
  await env.sync.initStoreSyncOnLogin('owner');
  const s = store.getState();
  assert.equal(s.themeId, 9);
  assert.equal(s.theme.id, 1, 'производная тема не берётся с сервера');
  assert.equal(s.builtinThemes.length, 1, 'каталог встроенных тем остаётся локальным');
  assert.equal(s.merged, 1);
  assert.equal(after, 1);
  assert.equal(env.sync.isStoreSyncReady('theme'), true);
  // Снапшот с другого устройства по сокету тоже проходит через hooks.
  await new Promise((r) => setImmediate(r));
  env.handlers['store:updated']({ storeName: 'theme', clientId: 'phone', data: { themeId: 12 } });
  assert.equal(store.getState().themeId, 12);
  assert.equal(after, 2);
  store.setState({ themeId: 13 });
  for (const callback of env.timers.values()) await callback();
  assert.equal(env.writes.at(-1).data.compacted, true, 'снапшот прошёл через hook');
  env.sync.disableAllStoreSync();
  assert.equal(env.sync.isStoreSyncReady('theme'), false);
});

test('shop wallet polling does not upload a stale snapshot over favorites', async () => {
  const env = setup(null);
  const store = createStore(() => ({ owned: { a: true }, balanceVp: 5, favoriteIds: [], colorModes: {} }));
  env.sync.enableStoreSync('shop', store);
  await env.sync.initStoreSyncOnLogin('owner');
  for (const [id, callback] of env.timers) { env.timers.delete(id); await callback(); }
  const before = env.writes.length;
  // Опрос кошелька: баланс, владение и пустой set() не должны уходить на сервер.
  store.setState({ balanceVp: 6 });
  store.setState({ owned: { a: true, b: true } });
  store.setState({});
  assert.equal(env.timers.size, 0, 'запись не запланирована');
  assert.equal(env.writes.length, before);
});

test('remote shop snapshot does not undo a favorite that is still being sent', async () => {
  const env = setup(null);
  const store = createStore(() => ({ favoriteIds: [], colorModes: {} }));
  env.sync.enableStoreSync('shop', store);
  await env.sync.initStoreSyncOnLogin('owner');
  for (const [id, callback] of env.timers) { env.timers.delete(id); await callback(); }
  await new Promise((r) => setImmediate(r));
  store.setState({ favoriteIds: ['a'], colorModes: { a: 'theme' } });
  env.handlers['store:updated']({ storeName: 'shop', clientId: 'phone', data: { favoriteIds: [], colorModes: {} } });
  assert.deepEqual(store.getState().favoriteIds, ['a']);
  assert.equal(store.getState().colorModes.a, 'theme');
  for (const callback of env.timers.values()) await callback();
  assert.deepEqual(env.writes.at(-1).data.favoriteIds, ['a']);
});
