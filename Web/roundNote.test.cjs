const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bubble = fs.readFileSync(path.join(__dirname, 'src/components/MessageBubble.tsx'), 'utf8');
const note = bubble.slice(bubble.indexOf('function RoundVideoNote'), bubble.indexOf('function VideoPlayer'));
const recorder = fs.readFileSync(path.join(__dirname, 'src/components/HoldRecorder.tsx'), 'utf8');

// Чистая геометрия из src/utils/roundNote.ts — переносим как есть (без сборки TS).
const util = fs.readFileSync(path.join(__dirname, 'src/utils/roundNote.ts'), 'utf8')
  .replace(/export /g, '')
  .replace(/: RingPoint/g, '')
  .replace(/\(x: number, y: number, rect: \{[^}]*\}\)/, '(x, y, rect)')
  .replace(/\(prev: number, next: number\): number/, '(prev, next)')
  .replace(/interface RingPoint \{[\s\S]*?\n\}/, '');
const { ringPoint, continueRingDrag } = new Function(`${util}; return { ringPoint, continueRingDrag };`)();
const rect = { left: 0, top: 0, width: 100, height: 100 };

test('video fills the whole circle edge to edge', () => {
  assert.ok(note.includes("position: 'absolute', inset: 0, width: '100%', height: '100%'"));
  assert.ok(note.includes("objectFit: 'cover'"));
  assert.ok(!note.includes('ROUND_RING + 0.5'), 'no inset gap between ring and video');
  // Константы объявлены над компонентом — ищем по всему файлу.
  assert.match(bubble, /const ROUND_SIZE = (\d+)/);
  assert.ok(Number(bubble.match(/const ROUND_SIZE = (\d+)/)[1]) > 240, 'larger than before');
  assert.ok(recorder.includes("width: 300, height: 300"), 'recording preview grows too');
});

test('ring angle maps clockwise from 12 o\'clock', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  close(ringPoint(50, 0, rect).fraction, 0);
  close(ringPoint(100, 50, rect).fraction, 0.25);
  close(ringPoint(50, 100, rect).fraction, 0.5);
  close(ringPoint(0, 50, rect).fraction, 0.75);
  assert.equal(ringPoint(50, 2, rect).inRing, true);
  assert.equal(ringPoint(50, 50, rect).inRing, false);
});

test('dragging across 12 o\'clock clamps instead of wrapping', () => {
  assert.equal(continueRingDrag(0.95, 0.05), 1);
  assert.equal(continueRingDrag(0.05, 0.95), 0);
  assert.equal(continueRingDrag(0.4, 0.45), 0.45);
});

test('seek and mute are wired with keyboard and aria support', () => {
  assert.ok(note.includes('onPointerDown={onSeekDown}'));
  assert.ok(note.includes('setPointerCapture'));
  assert.ok(note.includes("e.key === 'ArrowLeft' || e.key === 'ArrowRight'"));
  assert.ok(note.includes("aria-label={muted ? 'Включить звук' : 'Выключить звук'}"));
  assert.ok(note.includes('aria-pressed={muted}'));
  assert.ok(note.includes("e.key === 'ь'"), 'русская раскладка для M');
});
