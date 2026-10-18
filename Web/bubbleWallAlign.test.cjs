// «Выравнивание по стенке» и положение времени/галочек в пузыре.
// Настройки должны быть и в теме (layout), и в ⋮ → Настройки отображения (на чат).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('в layout есть новые поля, время по умолчанию снизу слева', () => {
  const s = read('src/store/userSettingsStore.ts');
  assert.match(s, /bubbleWallAlign: boolean;/);
  assert.match(s, /bubbleMetaPos: BubbleMetaPos;/);
  assert.match(s, /bubbleWallAlign: false,/);
  assert.match(s, /bubbleMetaPos: 'belowLeft',/);
  assert.match(s, /key === 'bubbleMetaPos' \? normalizeMetaPos\(value\)/);
  // Миграция v4 переводит старый дефолт inlineRight на belowLeft.
  assert.match(s, /version: 4,/);
  assert.match(s, /version < 4 && persisted\.layout\.bubbleMetaPos === 'inlineRight'/);
  // Серверный снапшот без метки версии тоже переводится.
  assert.match(s, /out\.__layoutVersion = LAYOUT_VERSION;/);
  assert.match(s, /!\(Number\(settings\.__layoutVersion\) >= LAYOUT_VERSION\) && clean\.layout\.bubbleMetaPos === 'inlineRight'/);
  const b = read('src/components/MessageBubble.tsx');
  assert.match(b, /bubbleMetaPos = 'belowLeft',/);
});

test('normalizeMetaPos отбрасывает мусор и metaOnRight учитывает стенку', () => {
  const src = read('src/utils/bubbleSettings.ts');
  for (const v of ['inlineRight', 'inlineLeft', 'belowRight', 'belowLeft', 'belowWall']) {
    assert.ok(src.includes(`'${v}'`), `нет варианта ${v}`);
  }
  assert.match(src, /if \(pos === 'belowWall'\) return isOwnSide;/);
  assert.match(src, /DEFAULT_BUBBLE_META_POS: BubbleMetaPos = 'belowLeft'/);
});

test('общие контролы показывают переключатель стенки и выбор места времени', () => {
  const c = read('src/components/BubbleSettingsControls.tsx');
  assert.match(c, /Выравнивание по стенке/);
  assert.match(c, /onChange\(\{ wallAlign \}\)/);
  assert.match(c, /onChange\(\{ metaPos: v as BubbleMetaPos \}\)/);
  assert.match(c, /aria-labelledby="bubble-meta-pos-label"/);
});

test('тема и ⋮-меню чата передают новые настройки', () => {
  const theme = read('src/components/ThemeSettingsPanels.tsx');
  assert.match(theme, /s\.setLayout\('bubbleWallAlign', patch\.wallAlign\)/);
  assert.match(theme, /s\.setLayout\('bubbleMetaPos', patch\.metaPos\)/);
  const chat = read('src/components/ChatWindow.tsx');
  assert.match(chat, /wallAlign: bubblePrefs\.wallAlign \?\? layoutBubbleWallAlign/);
  assert.match(chat, /metaPos: normalizeMetaPos\(bubblePrefs\.metaPos \?\? layoutBubbleMetaPos\)/);
  assert.match(chat, /bubbleWallAlign=\{effectiveBubble\.wallAlign\}/);
  assert.match(chat, /bubbleMetaPos=\{effectiveBubble\.metaPos\}/);
  assert.match(chat, /<BubbleSettingsControls value=\{effectiveBubble\}/);
});

test('пузырь применяет выравнивание текста и позицию времени, memo их учитывает', () => {
  const b = read('src/components/MessageBubble.tsx');
  assert.match(b, /const wallTextAlign = bubbleWallAlign \? \(isOwnSide \? 'right' : 'left'\) : undefined;/);
  assert.match(b, /textAlign: wallTextAlign/);
  assert.match(b, /justifyContent: metaRight \? 'flex-end' : 'flex-start'/);
  assert.match(b, /prev\.bubbleWallAlign === next\.bubbleWallAlign/);
  assert.match(b, /prev\.bubbleMetaPos === next\.bubbleMetaPos/);
});

test('при стенке пузырь сужается до самой длинной строки', () => {
  const b = read('src/components/MessageBubble.tsx');
  const start = b.indexOf('// ─── «По стенке»: пузырь по ширине самой длинной строки');
  assert.ok(start > 0, 'нет эффекта подгонки ширины');
  const body = b.slice(start, start + 2200);
  assert.match(body, /if \(!bubbleWallAlign\) \{ reset\(\); return; \}/);
  assert.match(body, /range\.getClientRects\(\)/);
  assert.match(body, /el\.style\.width = `\$\{width\}px`/);
  assert.match(body, /new ResizeObserver/);
  assert.match(body, /ro\.disconnect\(\)/);
  assert.match(b, /<Typography ref=\{textRef\}/);
});
