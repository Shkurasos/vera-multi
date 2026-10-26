/**
 * Плашка «Доступно обновление»: buildId сборки, сравнение с сервером,
 * «Позже» → пункт в настройках, no-cache для index.html/version.json.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const zustand = require(path.join(__dirname, 'node_modules', 'zustand'));

function load(file, ctxExtra = {}, modules = {}) {
  const ctx = vm.createContext({
    console, exports: {}, module: { exports: {} },
    require: (id) => {
      if (id === 'zustand') return zustand;
      if (id in modules) return modules[id];
      throw new Error(`unexpected require ${id}`);
    },
    ...ctxExtra,
  });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(read(file), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  return ctx.module.exports;
}

test('isNewBuild: разные id — обновление; dev и пустые — нет', () => {
  const { isNewBuild } = load('src/store/updateStore.ts');
  assert.equal(isNewBuild('a1', 'b2'), true);
  assert.equal(isNewBuild('a1', 'a1'), false);
  assert.equal(isNewBuild('dev', 'b2'), false);
  assert.equal(isNewBuild('a1', null), false);
  assert.equal(isNewBuild(null, 'b2'), false);
  assert.equal(isNewBuild('a1', ''), false);
});

test('стор: найдено → «Позже» скрывает плашку, но available остаётся', () => {
  const { useUpdateStore } = load('src/store/updateStore.ts');
  const s = useUpdateStore;
  assert.equal(s.getState().available, false);
  s.getState().dismiss(); // без обновления «Позже» ничего не меняет
  assert.equal(s.getState().dismissed, false);

  s.getState().markAvailable('b2');
  assert.deepEqual([s.getState().available, s.getState().remoteId, s.getState().dismissed], [true, 'b2', false]);

  s.getState().dismiss();
  assert.equal(s.getState().dismissed, true);
  assert.equal(s.getState().available, true, 'пункт в настройках остаётся');

  s.getState().markAvailable('b2'); // повторная проверка той же сборки
  assert.equal(s.getState().dismissed, true, 'та же сборка не всплывает снова');

  s.getState().markAvailable('c3'); // вышла ещё одна сборка
  assert.deepEqual([s.getState().remoteId, s.getState().dismissed], ['c3', false]);
});

function loadAppUpdate(buildId, fetchResult) {
  const store = load('src/store/updateStore.ts');
  const src = read('src/services/appUpdate.ts');
  const ctx = { __VERA_BUILD_ID__: buildId };
  const mod = load('src/services/appUpdate.ts', ctx, { '../store/updateStore': store });
  assert.ok(src.includes("'/api/client-version'"));
  return { mod, store };
}

test('checkForUpdate: другой buildId на сервере → available', async () => {
  const { mod, store } = loadAppUpdate('a1');
  let url;
  const ok = await mod.checkForUpdate(async (u) => { url = u; return { ok: true, json: async () => ({ buildId: 'b2' }) }; });
  assert.equal(ok, true);
  assert.equal(url, '/api/client-version');
  assert.equal(store.useUpdateStore.getState().remoteId, 'b2');
});

test('checkForUpdate: тот же id, ошибка сети, 404 и dev — без обновления', async () => {
  const same = loadAppUpdate('a1');
  assert.equal(await same.mod.checkForUpdate(async () => ({ ok: true, json: async () => ({ buildId: 'a1' }) })), false);
  assert.equal(await same.mod.checkForUpdate(async () => { throw new Error('offline'); }), false);
  assert.equal(await same.mod.checkForUpdate(async () => ({ ok: false, json: async () => ({}) })), false);
  assert.equal(same.store.useUpdateStore.getState().available, false);

  const dev = loadAppUpdate('dev');
  let called = false;
  assert.equal(await dev.mod.checkForUpdate(async () => { called = true; return { ok: true, json: async () => ({ buildId: 'b2' }) }; }), false);
  assert.equal(called, false, 'в dev сервер не опрашивается');
});

test('UI: плашка с «Обновить»/«Позже», доступна и без хардкода цветов; пункт в настройках', () => {
  const prompt = read('src/components/UpdatePrompt.tsx');
  assert.match(prompt, /role="status"/);
  assert.match(prompt, /aria-live="polite"/);
  assert.match(prompt, />Обновить</);
  assert.match(prompt, />Позже</);
  assert.match(prompt, /if \(!available \|\| dismissed\) return null/);
  assert.doesNotMatch(prompt, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);

  const settings = read('src/components/SettingsDialog.tsx');
  assert.match(settings, /useUpdateStore\(\(x\) => x\.available\)/);
  assert.match(settings, /\{updateAvailable && <>/);
  assert.match(settings, /Доступно обновление/);

  const app = read('src/App.tsx');
  assert.match(app, /startUpdatePolling\(\)/);
  assert.match(app, /<UpdatePrompt /);
});

test('сборка пишет version.json, сервер отдаёт его без кэша', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /__VERA_BUILD_ID__/);
  assert.match(vite, /fileName: 'version\.json'/);

  const server = fs.readFileSync(path.join(__dirname, '..', 'Server', 'server.js'), 'utf8');
  assert.match(server, /app\.get\('\/api\/client-version'/);
  assert.match(server, /NO_CACHE_CLIENT_FILES = new Set\(\['index\.html', 'version\.json'\]\)/);
  assert.match(server, /res\.setHeader\('Cache-Control', 'no-cache'\);\s*res\.sendFile\(path\.join\(CLIENT_DIST, 'index\.html'\)\)/);
});
