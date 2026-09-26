const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatSkinStore.ts'), 'utf8');

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

test('скины чата хранятся отдельно для каждого чата', () => {
  assert.deepEqual(Object.keys(store.overrides), []);
  store.setChatSkin('chat-a', 'bubble', 'bubble-neon');
  store.setChatSkin('chat-b', 'bubble', 'bubble-sunset');
  assert.equal(store.overrides['chat-a'].bubble, 'bubble-neon');
  assert.equal(store.overrides['chat-b'].bubble, 'bubble-sunset');
  store.setChatSkin('chat-a', 'bubble', 'bubble-ocean');
  assert.equal(store.overrides['chat-a'].bubble, 'bubble-ocean');
  assert.equal(store.overrides['chat-b'].bubble, 'bubble-sunset');
});

test('пустая строка означает «без скина», undefined — «как в профиле»', () => {
  store.setChatSkin('chat-a', 'ring', '');
  assert.equal(store.overrides['chat-a'].ring, '');
  assert.equal(store.getSkinId('chat-a', 'ring', 'ring-default'), '');
  store.setChatSkin('chat-a', 'ring', undefined);
  assert.equal('ring' in store.overrides['chat-a'], false);
  assert.equal(store.getSkinId('chat-a', 'ring', 'ring-default'), 'ring-default');
});

test('чат без переопределений удаляется целиком, getSkinId отдаёт глобальный скин', () => {
  store.setChatSkin('chat-c', 'selfcard', 'selfcard-glass');
  assert.equal(store.getSkinId('chat-c', 'selfcard', 'selfcard-default'), 'selfcard-glass');
  store.clearChatSkins('chat-c');
  assert.equal(store.overrides['chat-c'], undefined);
  assert.equal(store.getSkinId('chat-c', 'selfcard', 'selfcard-default'), 'selfcard-default');
  store.setChatSkin('chat-c', 'bubble', 'bubble-x');
  store.setChatSkin('chat-c', 'bubble', undefined);
  assert.equal(store.overrides['chat-c'], undefined);
});

test('неизвестный чат не влияет на другие и не создаёт мусор', () => {
  const before = Object.keys(store.overrides).sort();
  assert.equal(store.getSkinId('nope', 'bubble', 'fallback'), 'fallback');
  assert.deepEqual(Object.keys(store.overrides).sort(), before);
});
