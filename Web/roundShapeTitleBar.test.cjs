const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// Чистые модули без импортов: транспилируем TS → CJS тем же typescript из devDependencies.
const ts = require('typescript');
function loadTs(file) {
  const { outputText } = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require);
  return mod.exports;
}

const shape = loadTs('src/utils/roundShape.ts');
const bar = loadTs('src/utils/titleBar.ts');

test('round note shape is encoded in the file name, circle keeps the legacy name', () => {
  assert.equal(shape.roundNoteFileName('circle', 'webm'), 'video-note.webm');
  assert.equal(shape.roundNoteFileName('heart', 'mp4'), 'video-note-heart.mp4');
  assert.equal(shape.roundNoteFileName('bogus', 'webm'), 'video-note.webm');
  assert.equal(shape.roundShapeFromName('video-note.webm'), 'circle');
  assert.equal(shape.roundShapeFromName('video-note-squircle.webm'), 'squircle');
  assert.equal(shape.roundShapeFromName('video-note-heart.mp4'), 'heart');
  assert.equal(shape.roundShapeFromName('video.webm'), null);
  assert.equal(shape.isRoundNoteName('video-note-star.webm'), false);
  assert.equal(shape.isRoundNoteName(undefined), false);
});

test('every shape path starts at 12 o\'clock and stays inside the box', () => {
  for (const { id } of shape.ROUND_SHAPES) {
    for (const inset of [0, 1.5, 7]) {
      const d = shape.roundShapePath(id, inset);
      assert.match(d, /^M50 /, `${id} starts at top centre`);
      const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
      assert.ok(nums.every((n) => n >= 0 && n <= 100), `${id}@${inset} within 0..100`);
    }
  }
  assert.deepEqual(shape.roundShapeMaskSx('circle'), { borderRadius: '50%' });
  assert.match(shape.roundShapeMaskSx('heart').maskImage, /^url\("data:image\/svg\+xml,/);
});

test('nearestFraction picks the closest contour sample', () => {
  const pts = [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }];
  assert.equal(shape.nearestFraction(52, 3, pts), 0);
  assert.equal(shape.nearestFraction(97, 48, pts), 0.25);
  assert.equal(shape.nearestFraction(2, 52, pts), 0.75);
  assert.equal(shape.nearestFraction(0, 0, []), 0);
});

test('round shape is a synced, theme-editor setting and the recorder uses it', () => {
  const store = read('src/store/userSettingsStore.ts');
  assert.match(store, /roundShape: 'circle'/);
  assert.match(store, /'chatDateAlign', 'roundShape'/, 'synced between devices');
  const panel = read('src/components/ThemeSettingsPanels.tsx');
  const messages = panel.slice(panel.indexOf('export function MessagesPanel'), panel.indexOf('export function LayoutPanel'));
  assert.ok(messages.includes('label="Форма кружков"'));
  assert.ok(read('src/utils/themeEditorSearch.ts').includes("e('messages', 'Форма кружков'"));
  const rec = read('src/components/HoldRecorder.tsx');
  assert.ok(rec.includes('roundNoteFileName(shapeRef.current, ext)'));
  assert.ok(rec.includes('aria-label="Форма кружка"'));
  const bubble = read('src/components/MessageBubble.tsx');
  assert.ok(bubble.includes('shape={roundShapeFromName(attachment.fileName)'));
  assert.ok(!/\/\^video-note\\\./.test(bubble), 'no hardcoded file-name regex left');
});

test('title bar colours are always opaque #rrggbb', () => {
  assert.equal(bar.opaqueHex('#171D25'), '#171d25');
  assert.equal(bar.opaqueHex('#abc'), '#aabbcc');
  assert.equal(bar.opaqueHex('#11223380'), '#112233');
  assert.equal(bar.opaqueHex('rgba(10,14,26,0.70)'), '#0a0e1a');
  assert.equal(bar.opaqueHex('linear-gradient(red, blue)', '#123456'), '#123456');
  assert.equal(bar.opaqueHex(undefined), '#000000');
  assert.deepEqual(bar.titleBarColors({ bgHeader: 'var(--x)', bg: '#0A0E1A', text: '#F5F7FF' }), { color: '#0a0e1a', symbolColor: '#f5f7ff' });
  assert.equal(bar.isSafeHex('#00ff00'), true);
  assert.equal(bar.isSafeHex('red; x'), false);
});

test('electron window is frameless with a themed overlay and validated IPC', () => {
  const main = read('../App/electron/main.js');
  const preload = read('../App/electron/preload.js');
  assert.ok(main.includes("titleBarStyle: 'hidden'"));
  assert.ok(main.includes("titleBarOverlay: titleBarOverlayFor('#0f0f17', '#ffffff')"));
  assert.ok(main.includes("preload: path.join(__dirname, 'preload.js')"), 'preload is actually loaded');
  assert.ok(main.includes('e.sender !== mainWindow.webContents'), 'only our window may recolour');
  assert.ok(main.includes('HEX6.test'), 'colours validated in main');
  assert.ok(preload.includes("ipcRenderer.send('vera:title-bar-colors'"));
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.deepEqual(manifest.display_override, ['window-controls-overlay', 'standalone']);
  assert.ok(read('src/main.tsx').includes('<TitleBar />'));
});
