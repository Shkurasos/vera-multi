const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { create } = require('zustand');

test('public plaque refresh is deduplicated, preserves live updates and supports removal', async () => {
  let resolve;
  let calls = 0;
  const usersApi = { getById: () => { calls++; return new Promise(r => { resolve = r; }); } };
  const source = fs.readFileSync(path.join(__dirname, 'src/store/equipmentStore.ts'), 'utf8');
  const context = vm.createContext({ exports: {}, console,
    require: name => name === 'zustand' ? { create } : name.endsWith('storeSyncSimple') ? { registerAccountStore() {} } : { usersApi } });
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const store = context.exports.useEquipmentStore;
  const first = store.getState().refresh('sender');
  assert.equal(store.getState().refresh('sender'), first);
  assert.equal(calls, 1);
  resolve({ data: { activeSelfCard: 'selfcard-pack-games-mech' } });
  await first;
  assert.equal(store.getState().users.sender.activeSelfCard, 'selfcard-pack-games-mech');
  const second = store.getState().refresh('sender');
  store.getState().update({ id: 'sender', activeSelfCard: 'selfcard-pack-culture-ink' });
  resolve({ data: { activeSelfCard: 'old' } });
  await second;
  assert.equal(store.getState().users.sender.activeSelfCard, 'selfcard-pack-culture-ink');
  store.getState().update({ id: 'sender', activeSelfCard: '' });
  assert.equal(store.getState().users.sender.activeSelfCard, '');
});