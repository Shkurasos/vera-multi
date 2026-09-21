const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/utils/musicPlayback.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);

test('restores position once without rewinding after seeking or buffering', () => {
  const audio = new EventTarget();
  let position = 0;
  let seeks = 0;
  let playing = true;
  Object.defineProperty(audio, 'currentTime', {
    get: () => position, set: value => { position = value; seeks++; },
  });
  audio.duration = 200;
  audio.paused = true;
  let plays = 0;
  audio.play = () => { plays++; audio.paused = false; return Promise.resolve(); };
  const dispose = context.exports.bindMusicPlayback(audio, 42, () => playing, d => assert.equal(d, 200));
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(position, 42);
  audio.dispatchEvent(new Event('canplay'));
  position = 65;
  for (let i = 0; i < 5; i++) audio.dispatchEvent(new Event('canplay'));
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(position, 65);
  assert.equal(seeks, 1);
  assert.equal(plays, 1);
  playing = false;
  audio.paused = true;
  audio.dispatchEvent(new Event('canplay'));
  assert.equal(plays, 1);
  dispose();
  playing = true;
  audio.dispatchEvent(new Event('canplay'));
  assert.equal(plays, 1);
});