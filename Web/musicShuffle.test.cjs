const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createStore() {
  let state;
  const context = { exports: {}, Math: Object.assign(Object.create(Math), { random: () => 0 }), require: (name) => {
    if (name === 'zustand') return { create: () => (init) => {
      state = init(patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; }, () => state);
      return { getState: () => state };
    } };
    if (name === 'zustand/middleware') return { persist: init => init };
    if (name.endsWith('/api')) return { musicApi: { recordPlay: () => Promise.resolve() } };
    if (name.endsWith('/peer')) return { isPeerAvailable: () => false };
    if (name.endsWith('/storeSyncSimple')) return { registerAccountStore: () => {} };
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/store/musicStore.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports.useMusicStore;
}

test('shuffled library playback starts, copies the list and leaves repeat-one', () => {
  const store = createStore();
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  store.getState().toggleRepeat();
  store.getState().toggleRepeat();
  store.getState().playShuffled(tracks);
  assert.equal(store.getState().shuffle, true);
  assert.equal(store.getState().repeat, 'none');
  assert.equal(store.getState().isPlaying, true);
  assert.equal(store.getState().currentTrack.id, 'a');
  assert.notEqual(store.getState().queue, tracks);
  store.getState().next();
  assert.equal(store.getState().currentTrack.id, 'b');
  assert.equal(store.getState().currentIndex, 1);
  assert.deepEqual(tracks.map(t => t.id), ['a', 'b', 'c']);
});

test('empty list is a no-op and a single track remains playable', () => {
  const store = createStore();
  store.getState().playShuffled([]);
  assert.equal(store.getState().currentTrack, null);
  assert.equal(store.getState().shuffle, false);
  store.getState().playShuffled([{ id: 'a' }]);
  store.getState().next();
  assert.equal(store.getState().currentTrack.id, 'a');
});