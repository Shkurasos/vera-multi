const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('ContextMenu: поддерживает строку header над пунктами', () => {
  const src = read('src/components/ContextMenu.tsx');
  assert.ok(src.includes('header?: React.ReactNode;'));
  assert.ok(src.includes('{header}'), 'header рендерится');
});

test('ПКМ по сообщению: быстрые реакции и все прежние пункты', () => {
  const src = read('src/components/MessageBubble.tsx');
  const start = src.indexOf('{contextMenu && (');
  const block = src.slice(start, src.indexOf('{imageMenu && (', start));
  assert.ok(block.includes('data-vera-context-reactions'), 'строка реакций в меню');
  assert.ok(block.includes('reactionSlots.map('), 'те же слоты, что в попапе');
  assert.ok(block.includes('handleAddReaction(emoji)'), 'тот же путь сохранения');
  assert.ok(block.includes('aria-label={`Поставить реакцию ${reactionLabel(emoji)}`}'));
  for (const key of ['reply', 'forward', 'copy', 'pin', 'select', 'edit', 'delete']) {
    assert.ok(block.includes(`key: '${key}'`), `пункт ${key} на месте`);
  }
});
