// «Выравнивание по стенке» и положение времени/галочек в пузыре.
// Настройки должны быть и в теме (layout), и в ⋮ → Настройки отображения (на чат).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('в layout есть сетка времени для своих и чужих, по умолчанию снизу слева', () => {
  const s = read('src/store/userSettingsStore.ts');
  assert.match(s, /bubbleWallAlign: boolean;/);
  assert.match(s, /bubbleMetaPos: BubbleMetaPos;/);
  assert.match(s, /bubbleMetaPosOwn: BubbleMetaPos;/);
  assert.match(s, /bubbleMetaPosOther: BubbleMetaPos;/);
  assert.match(s, /bubbleWallAlign: false,/);
  assert.match(s, /bubbleMetaPos: 'bottomLeft',/);
  assert.match(s, /bubbleMetaPosOwn: 'bottomLeft',/);
  assert.match(s, /bubbleMetaPosOther: 'bottomLeft',/);
  assert.match(s, /key === 'bubbleMetaPosOwn' \? normalizeMetaPos\(value\)/);
  assert.match(s, /key === 'bubbleMetaPosOther' \? normalizeMetaPos\(value\)/);
  // Миграция v4 переводит старый дефолт inlineRight на belowLeft.
  assert.match(s, /version: 5,/);
  assert.match(s, /version < 4 && persisted\.layout\.bubbleMetaPos === 'inlineRight'/);
  // v5 копирует общее поле в свои/чужие, если их ещё нет.
  assert.match(s, /if \(persisted\.layout\.bubbleMetaPosOwn === undefined\) persisted\.layout\.bubbleMetaPosOwn = shared;/);
  assert.match(s, /if \(persisted\.layout\.bubbleMetaPosOther === undefined\) persisted\.layout\.bubbleMetaPosOther = shared;/);
  // Серверный снапшот без метки версии тоже переводится.
  assert.match(s, /out\.__layoutVersion = LAYOUT_VERSION;/);
  assert.match(s, /!\(Number\(settings\.__layoutVersion\) >= 4\) && clean\.layout\.bubbleMetaPos === 'inlineRight'/);
  assert.match(s, /if \(clean\.layout\.bubbleMetaPosOwn === undefined\) clean\.layout\.bubbleMetaPosOwn = shared;/);
  const b = read('src/components/MessageBubble.tsx');
  assert.match(b, /bubbleMetaPosOwn = 'bottomLeft',/);
  assert.match(b, /bubbleMetaPosOther = 'bottomLeft',/);
});

test('normalizeMetaPos понимает сетку 3×3 и старые значения, resolveMetaPair разделяет свои и чужие', () => {
  const src = read('src/utils/bubbleSettings.ts');
  for (const v of ['topLeft', 'top', 'topRight', 'middleLeft', 'center', 'middleRight', 'bottomLeft', 'bottom', 'bottomRight']) {
    assert.ok(src.includes(`'${v}'`), `нет клетки ${v}`);
  }
  for (const v of ['inlineRight', 'inlineLeft', 'belowRight', 'belowLeft', 'belowWall']) {
    assert.ok(src.includes(`${v}:`), `нет перевода старого значения ${v}`);
  }
  assert.match(src, /DEFAULT_BUBBLE_META_POS: BubbleMetaPos = 'bottomLeft'/);
  assert.match(src, /return metaAnchor\(pos\)\.h === 'right'/);
  assert.match(src, /own: source\?\.metaPosOwn !== undefined \? normalizeMetaPos\(source\.metaPosOwn\) : fallback/);
  assert.match(src, /other: source\?\.metaPosOther !== undefined \? normalizeMetaPos\(source\.metaPosOther\) : fallback/);
});

test('общие контролы показывают переключатель стенки и две сетки времени', () => {
  const c = read('src/components/BubbleSettingsControls.tsx');
  assert.match(c, /Выравнивание по стенке/);
  assert.match(c, /onChange\(\{ wallAlign \}\)/);
  assert.match(c, /onChange\(\{ metaPosOwn: v \}\)/);
  assert.match(c, /onChange\(\{ metaPosOther: v \}\)/);
  assert.match(c, /id="bubble-meta-pos-own-label"/);
  assert.match(c, /id="bubble-meta-pos-other-label"/);
});

test('тема и ⋮-меню чата передают настройки своих и чужих пузырей', () => {
  const theme = read('src/components/ThemeSettingsPanels.tsx');
  assert.match(theme, /s\.setLayout\('bubbleWallAlign', patch\.wallAlign\)/);
  assert.match(theme, /s\.setLayout\('bubbleMetaPosOwn', patch\.metaPosOwn\)/);
  assert.match(theme, /s\.setLayout\('bubbleMetaPosOther', patch\.metaPosOther\)/);
  const chat = read('src/components/ChatWindow.tsx');
  assert.match(chat, /wallAlign: bubblePrefs\.wallAlign \?\? layoutBubbleWallAlign/);
  assert.match(chat, /metaPosOwn: bubblePrefs\.metaPosOwn \?\? layoutBubbleMetaPosOwn/);
  assert.match(chat, /metaPosOther: bubblePrefs\.metaPosOther \?\? layoutBubbleMetaPosOther/);
  assert.match(chat, /bubbleWallAlign=\{effectiveBubble\.wallAlign\}/);
  assert.match(chat, /bubbleMetaPosOwn=\{effectiveBubble\.metaPosOwn\}/);
  assert.match(chat, /bubbleMetaPosOther=\{effectiveBubble\.metaPosOther\}/);
  assert.match(chat, /<BubbleSettingsControls value=\{effectiveBubble\}/);
});

test('пузырь применяет выравнивание текста и позицию времени, memo их учитывает', () => {
  const b = read('src/components/MessageBubble.tsx');
  assert.match(b, /const wallTextAlign = bubbleWallAlign \? \(isOwnSide \? 'right' : 'left'\) : undefined;/);
  assert.match(b, /textAlign: wallTextAlign/);
  assert.match(b, /justifyContent: meta\.h === 'right' \? 'flex-end' : meta\.h === 'center' \? 'center' : 'flex-start'/);
  assert.doesNotMatch(b, /flexDirection: metaRight/);
  assert.match(b, /maxWidth: hasVisualMedia \? '100%' : `\$\{maxWidthPct\}%`/);
  assert.match(b, /width: singleVisual \? 'fit-content' : 'auto'/);
  assert.match(b, /const metaBesideText = metaInline && !!message\.content && !attachment && !message\.replyToId && !message\.isEdited;/);
  assert.match(b, /prev\.bubbleWallAlign === next\.bubbleWallAlign/);
  assert.match(b, /prev\.bubbleMetaPosOwn === next\.bubbleMetaPosOwn/);
  assert.match(b, /prev\.bubbleMetaPosOther === next\.bubbleMetaPosOther/);
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
