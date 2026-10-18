const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('пресеты фото чата: уникальные id, подписи и рендер в PNG-файл', () => {
  const src = read('src/services/chatAvatarPresets.ts');
  const ids = [...src.matchAll(/\{ id: '([a-z-]+)', label: '[^']+', emoji: '[^']+', from: '#[0-9a-f]{6}', to: '#[0-9a-f]{6}' \}/g)].map(m => m[1]);
  assert.ok(ids.length >= 12, 'хватает вариантов');
  assert.equal(new Set(ids).size, ids.length, 'id не повторяются');
  assert.ok(src.includes("new File([blob], `chat-avatar-${p.id}.png`, { type: 'image/png' })"));
});

test('инфопанель: выбор готового фото идёт тем же путём, что и загрузка', () => {
  const src = read('src/components/ChatInfoPanel.tsx');
  assert.ok(src.includes('applyAvatarFile(await renderChatAvatarPreset(preset))'));
  assert.ok(src.includes('if (file) await applyAvatarFile(file);'));
  assert.ok(src.includes('onClick={() => setAvatarPickerOpen(true)}'), 'камера открывает выбор');
  assert.ok(src.includes('aria-label={p.label}'), 'кнопки пресетов подписаны');
  assert.ok(src.includes('Загрузить своё фото'), 'загрузка своего осталась');
});
