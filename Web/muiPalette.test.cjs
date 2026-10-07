const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/utils/muiPalette.ts'), 'utf8');
const context = vm.createContext({ console, exports: {}, module: { exports: {} } });
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);
const { muiPaletteFromTheme, MUI_DARK_FALLBACK } = context.exports;

// contrast.ts нужен для расчёта контраста, themeStore — для проверки тем.
function loadModule(file, stubs = {}) {
  const c = vm.createContext({
    console, exports: {}, module: { exports: {} },
    window: { location: {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    require: (name) => {
      if (stubs[name]) return stubs[name];
      if (name === 'zustand') return { create: () => (factory) => factory(() => {}, () => ({})) };
      if (name === 'zustand/middleware') return { persist: (factory) => factory, createJSONStorage: (get) => get() };
      if (name.includes('storeSyncSimple')) return { enableStoreSync: () => {} };
      return { usersApi: { get: () => Promise.resolve({ data: {} }) } };
    },
  });
  vm.runInContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    c,
  );
  return c.exports;
}
const { isLightColor } = loadModule('src/utils/contrast.ts');
// Пресеты тем подключаются к каталогу на старте, поэтому грузим их по-настоящему:
// иначе темы пришли бы в тест без своих настроек.
const { themePreset } = loadModule('src/store/themePresets.ts');
const { THEMES } = loadModule('src/store/themeStore.ts', { './themePresets': { themePreset } });

/** Относительный контраст текста к фону (WCAG), с учётом rgba-подложки. */
function parseColor(value) {
  const c = String(value || '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)).concat([1]);
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return null;
}
function over(fg, bg) {
  if (!fg || !bg || fg[3] >= 1) return fg || bg;
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat([1]);
}
const relLuminance = (p) => 0.2126 * (p[0] / 255) + 0.7152 * (p[1] / 255) + 0.0722 * (p[2] / 255);
function contrast(fg, bg) {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// Реальная светлая тема из каталога (themeStore, id 3 «Свет и воздух»).
const LIGHT = {
  text: '#172033', textSec: '#687085', bg: '#EEF2F7', bgHeader: 'rgba(255,255,255,0.66)',
  border: '#D5DDEA', bgHover: '#E3EAF3', bgActive: '#D5DDEA',
};

test('текст MUI берётся из темы, а не из тёмной палитры по умолчанию', () => {
  const p = muiPaletteFromTheme(LIGHT);
  // Регрессия: раньше text.primary всегда был #F5F7FF, и «Мои скины в этом чате»
  // с подписями становились белыми на светлой панели.
  assert.equal(p.text.primary, '#172033');
  assert.equal(p.text.secondary, '#687085');
  assert.notEqual(p.text.primary, MUI_DARK_FALLBACK.text);
});

test('фон paper уходит вместе с текстом — иначе тёмный текст лёг бы на тёмный MUI-фон', () => {
  const p = muiPaletteFromTheme(LIGHT);
  assert.equal(p.background.paper, 'rgba(255,255,255,0.66)');
  assert.equal(p.background.default, '#EEF2F7');
  assert.equal(p.divider, '#D5DDEA');
  assert.equal(p.action.hover, '#E3EAF3');
  assert.equal(p.action.selected, '#D5DDEA');
});

test('частично сохранённая тема не оставляет undefined (иначе текст исчезнет)', () => {
  // deepStrictEqual не годится: объект создан в другом realm (vm) и имеет
  // другой прототип Object, поэтому сравниваем сериализованный вид.
  const expected = JSON.stringify({
    text: { primary: MUI_DARK_FALLBACK.text, secondary: MUI_DARK_FALLBACK.textSec },
    background: { default: MUI_DARK_FALLBACK.bg, paper: MUI_DARK_FALLBACK.bgHeader },
    divider: MUI_DARK_FALLBACK.border,
    action: { hover: MUI_DARK_FALLBACK.bgHover, selected: MUI_DARK_FALLBACK.bgActive },
  });
  // Тема со старого localStorage: полей нет вовсе.
  assert.equal(JSON.stringify(muiPaletteFromTheme({})), expected);
  assert.equal(JSON.stringify(muiPaletteFromTheme(undefined)), expected);

  // Тема без bgHeader — бумара берётся из bg, а не из тёмного дефолта.
  const p = muiPaletteFromTheme({ text: '#111', bg: '#EEE' });
  assert.equal(p.background.paper, '#EEE');

  // Ни одно поле не должно быть undefined.
  for (const value of Object.values(muiPaletteFromTheme({ text: '#111' }).text)) {
    assert.ok(value, 'цвет текста не может быть пустым');
  }
});

test('«Монохром» — чёрно-белый с тёмно-серым: вторичный текст читается, а не сливается', () => {
  const mono = THEMES.find((t) => t.id === 29);
  assert.ok(mono, 'тема 29 «Монохром» должна быть в каталоге');

  // Основа остаётся чистой чёрно-белой.
  assert.equal(mono.bg, '#FFFFFF');
  assert.equal(mono.text, '#000000');
  assert.equal(mono.bubbleOwnText, '#FFFFFF');

  // Регрессия: textSec был #8E8E93 (светло-серый, контраст 1.69:1) — подписи
  // и время сливались с белым фоном.
  assert.ok(!isLightColor(mono.textSec) || contrast(parseColor(mono.textSec), parseColor(mono.bgHeader)) >= 4.5,
    `textSec ${mono.textSec} должен читаться на ${mono.bgHeader}`);
  assert.equal(mono.textSec, '#2A2A2C');

  // Основной и вторичный текст на фоне шапки.
  const header = over(parseColor(mono.bgHeader), parseColor(mono.bg));
  assert.ok(contrast(parseColor(mono.text), header) >= 4.5);
  assert.ok(contrast(parseColor(mono.textSec), header) >= 4.5);
});

test('в «Монохроме» границы заметны: на белом фоне аватары и плашки не растворяются', () => {
  const mono = THEMES.find((t) => t.id === 29);
  // Регрессия: rgba(0,0,0,0.08) на белом давал почти нулевую границу.
  const border = parseColor(mono.border);
  assert.equal(border[3], 0.16);
  // Было rgba(0,0,0,0.08) → 1.08:1 (границы визуально не было).
  // Стало 0.16 → 1.18:1, это различимая тонкая граница.
  const edge = contrast(over(border, parseColor(mono.bg)), parseColor(mono.bg));
  assert.ok(edge > 1.15, `граница должна отличаться от фона, получено ${edge.toFixed(2)}:1`);
});

