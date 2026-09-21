const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/utils/mirrorBubble.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { mirrorBubble } = context.exports;

test('moves the tail to the opposite corner without changing text or colors', () => {
  const original = { borderRadius: '16px 16px 4px 16px', color: '#fff', background: '#123', fontFamily: 'Arial' };
  const mirrored = mirrorBubble(original);
  assert.equal(mirrored.borderRadius, '16px 16px 16px 4px');
  assert.equal(mirrored.color, original.color);
  assert.equal(mirrored.fontFamily, original.fontFamily);
  assert.equal(original.borderRadius, '16px 16px 4px 16px');
  assert.equal(mirrorBubble(mirrored).borderRadius, original.borderRadius);
});

test('preserves symmetric shapes and handles shorthand, variables and elliptical corners', () => {
  assert.equal(mirrorBubble({ borderRadius: 24 }).borderRadius, 24);
  assert.equal(mirrorBubble({ borderRadius: '2px 14px' }).borderRadius, '14px 2px 14px 2px');
  assert.equal(mirrorBubble({ borderRadius: '1px 2px 3px / 4px 5px' }).borderRadius, '2px 1px 2px 3px / 5px 4px 5px 4px');
  assert.equal(mirrorBubble({ borderRadius: 'var(--radius, 16px) 4px' }).borderRadius, '4px var(--radius, 16px) 4px var(--radius, 16px)');
});

test('moves asymmetric borders and explicit corners without leaving an extra border', () => {
  const result = mirrorBubble({ border: '1px solid red', borderLeft: '4px solid blue', borderBottomRightRadius: '3px' });
  assert.equal(result.borderRight, '4px solid blue');
  assert.equal(result.border, '1px solid red');
  assert.equal('borderLeft' in result, false);
  assert.equal(result.borderBottomLeftRadius, '3px');
  assert.equal('borderBottomRightRadius' in result, false);
});