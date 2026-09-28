const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/utils/contrast.ts'), 'utf8');
const context = vm.createContext({ console, exports: {}, module: { exports: {} } });
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);
const { colorLuminance, isLightColor, readableTextOn } = context.exports;

test('яркость считается по Rec. 709 и понимает #rgb и #rrggbb', () => {
  assert.equal(colorLuminance('#000000'), 0);
  assert.equal(colorLuminance('#ffffff'), 1);
  // #abc === #aabbcc
  assert.equal(colorLuminance('#abc'), colorLuminance('#aabbcc'));
  // #00E5FF: r=0, g=229, b=255
  const cyan = 0.2126 * 0 + 0.7152 * (229 / 255) + 0.0722 * (255 / 255);
  assert.ok(Math.abs(colorLuminance('#00E5FF') - cyan) < 1e-12);
});

test('мусорные значения не считаются светлым цветом', () => {
  for (const bad of ['', 'не цвет', 'rgb(1,2,3)', '#12', 'transparent']) {
    assert.equal(colorLuminance(bad), 0, bad);
    assert.equal(isLightColor(bad), false, bad);
  }
});

test('светлые акценты светлых тем получают тёмный текст, а тёмные — светлый', () => {
  // Регрессия: белый текст на пастельном/ярком акценте нечитаем.
  // #00E5FF — основной акцент Vera Dark, но он светлый (яркость 0.71),
  // поэтому и на нём тёмный текст контрастнее (≈12:1 против ≈1.6:1).
  for (const light of ['#FFE082', '#F8BBD0', '#FFFFFF', '#FFF3E0', '#00E5FF']) {
    assert.equal(readableTextOn(light), '#0B0B10', light);
  }
  for (const dark of ['#7C4DFF', '#000000', '#263238', '#1A1A2E', '#0B0B10']) {
    assert.equal(readableTextOn(dark), '#FFFFFF', dark);
  }
});

test('порог светлоты совпадает с isLightColor (0.6) и граничным случаем', () => {
  // 0.6 по Rec. 709 ≈ #999 — тёмный, 0.61 — уже светлый.
  assert.equal(isLightColor('#999999'), false);
  assert.equal(isLightColor('#9A9A9A'), true);
  assert.equal(readableTextOn('#999999'), '#FFFFFF');
  assert.equal(readableTextOn('#9A9A9A'), '#0B0B10');
});
