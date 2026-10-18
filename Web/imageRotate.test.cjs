const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bubble = fs.readFileSync(path.join(__dirname, 'src/components/MessageBubble.tsx'), 'utf8');
const viewer = bubble.slice(bubble.indexOf('function ImageViewer'), bubble.indexOf('{open && createPortal('));
const fullscreen = bubble.slice(bubble.indexOf('{open && createPortal('), bubble.indexOf('), document.body)}', bubble.indexOf('{open && createPortal(')));
const preview = viewer.slice(viewer.indexOf('return ('));

test('photo rotation exists only in the fullscreen viewer', () => {
  assert.ok(fullscreen.includes('aria-label={btn.label}'));
  assert.ok(fullscreen.includes("'Повернуть влево'"));
  assert.ok(fullscreen.includes("'Повернуть вправо'"));
  assert.ok(fullscreen.includes('transform: `rotate(${rotation}deg)`'));
  // Превью в пузыре не поворачивается.
  assert.ok(!preview.includes('rotate('));
});

test('rotation resets on photo change and swaps size limits on quarter turns', () => {
  assert.ok(viewer.includes('useEffect(() => { setRotation(0); }, [idx, open]);'));
  assert.ok(fullscreen.includes("maxWidth: quarterTurned ? '94vh' : '96vw'"));
  const quarter = r => (((r / 90) % 2) + 2) % 2 === 1;
  assert.deepEqual([0, 90, 180, 270, -90, -180, 360, 450].map(quarter),
    [false, true, false, true, true, false, false, true]);
});

test('R rotates without hijacking Ctrl+R reload', () => {
  assert.match(viewer, /!e\.ctrlKey && !e\.metaKey && !e\.altKey && \(e\.key === 'r'/);
  assert.ok(viewer.includes("e.key === 'к'"), 'русская раскладка');
});
