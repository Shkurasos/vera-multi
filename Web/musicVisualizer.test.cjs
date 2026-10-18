const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

function boot(storage) {
  const context = vm.createContext({
    exports: {},
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    require: (name) => {
      assert.equal(name, 'zustand');
      return require('zustand');
    },
  });
  vm.runInContext(ts.transpileModule(read('src/store/musicVisualizerStore.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports.useMusicVisualizerStore;
}

test('lighting settings persist independently for tracks and playlists after reload', () => {
  const storage = new Map();
  const store = boot(storage);
  store.getState().setSettings('track', 'same-id', { enabled: true, color: '#ff0000', intensity: 1.2, x: 30 });
  store.getState().setSettings('playlist', 'same-id', { enabled: true, color: '#00ff00', style: 'wave' });
  store.getState().setSettings('track', 'same-id', { opacity: 0.5 });
  const reloaded = boot(storage).getState();
  const track = reloaded.getSettings('track', 'same-id');
  assert.equal(track.enabled, true);
  assert.equal(track.color, '#ff0000');
  assert.equal(track.intensity, 1.2);
  assert.equal(track.x, 30);
  assert.equal(track.opacity, 0.5);
  assert.equal(reloaded.getSettings('playlist', 'same-id').color, '#00ff00');
  assert.equal(reloaded.getSettings('playlist', 'same-id').style, 'wave');
  assert.equal(reloaded.getSettings('track', 'other-id').enabled, false);
});

test('system audio preference persists after reload', () => {
  const storage = new Map();
  const store = boot(storage);
  store.getState().setSystemAudioReactive(true);
  assert.equal(boot(storage).getState().systemAudioReactive, true);
  store.getState().setSystemAudioReactive(false);
  assert.equal(boot(storage).getState().systemAudioReactive, false);
});

test('player tabs conditionally render playlist and persisted lighting controls', () => {
  const source = read('src/components/MusicPlayer.tsx');
  assert.match(source, /rightTab === 'playlist' && <Box[\s\S]*?<PlaylistsPanel \/>/);
  assert.match(source, /rightTab === 'settings' && <Box[\s\S]*?<MusicVisualizerSettingsControls/);
  assert.match(source, /rightTab === 'track' && <Box/);
  assert.match(source, /setSettings\(editableVizScope, editableVizId, patch\)/);
  assert.match(source, /void loadPlaylists\(\)/);
});