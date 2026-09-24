const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatPrefsStore.ts'), 'utf8');

// Минимальная эмуляция zustand: состояние мутируется на месте, set поддерживает
// функциональные обновления — как в настоящем сторе.
let store;
const setFn = (update) => {
  const next = typeof update === 'function' ? update(store) : update;
  Object.assign(store, next);
};
const getFn = () => store;

const context = vm.createContext({
  console,
  exports: {},
  module: { exports: {} },
  require: (name) => {
    if (name === 'zustand') return { create: () => (factory) => { store = factory(setFn, getFn); return store; } };
    if (name === 'zustand/middleware') return { persist: (factory) => factory };
    if (name === '../utils/bubbleSettings') return { clampBubble: (_kind, value) => value };
    if (name === '../types') return {};
    if (name === '../services/storeSyncSimple') return { enableStoreSync: () => {} };
    throw new Error('unexpected require: ' + name);
  },
});
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);

test('состояние панели «инфо о чате» сохраняется отдельно для каждого чата', () => {
  assert.deepEqual(Object.keys(store.showInfo), []);
  store.setShowInfo('chat-a', true);
  assert.equal(store.showInfo['chat-a'], true);
  // Другой чат — своё состояние.
  assert.equal(store.showInfo['chat-b'], undefined);
  store.setShowInfo('chat-b', true);
  store.setShowInfo('chat-a', false);
  assert.equal(store.showInfo['chat-a'], false);
  assert.equal(store.showInfo['chat-b'], true);
});
