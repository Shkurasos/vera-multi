const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const sidebar = read('src/components/Sidebar.tsx');
const bubble = read('src/components/MessageBubble.tsx');
const profilePage = read('src/pages/ProfilePage.tsx');
const profileModal = read('src/components/UserProfileModal.tsx');

// ── В списке чатов скинов быть не должно ─────────────────────────────────────

test('в списке чатов не применяется ни кольцо из магазина, ни кастомный профиль', () => {
  // Регресс: сюда попадало МОЁ кольцо, и у всех аватарок в списке оказывалась
  // одна и та же обводка, хотя поставил её один человек. Аватарка в строке
  // списка — чужая, ей чужое кольцо и не полагается.
  const body = sidebar.slice(sidebar.indexOf('// Обводка аватарок в списке чатов'));
  const block = body.slice(0, body.indexOf('const ringSx'));
  assert.ok(
    !/buildShopRingSx|skinColors|specToStyle/.test(block),
    'стили магазина не тянутся в обводку списка',
  );
  // И импорты, из которых это бралось, тоже не должны болтаться без нужды.
  assert.ok(!/import \{[^}]*buildShopRingSx/.test(sidebar), 'неиспользуемый импорт убран');
  assert.ok(!/import \{[^}]*skinColors/.test(sidebar), 'неиспользуемый импорт убран');
  assert.ok(!/useShopStore/.test(sidebar), 'список чатов не читает магазин');
  assert.ok(!/useCustomEquipStore/.test(sidebar), 'список чатов не читает кастомную экипировку');
});

test('активный чат в списке всё ещё выделяется обводкой темы', () => {
  // Скины убрали, а подсветку активной строки — обычное дело темы, не скин.
  assert.ok(
    /boxShadow: `0 0 0 2px \$\{active \? theme\.accent/.test(sidebar),
    'активный чат выделен обводкой акцента',
  );
});

test('обводка в списке пересчитывается только на смену темы', () => {
  // Раньше в зависимостях стояли скины: смена экипировки перерисовывала
  // весь список. Теперь список от неё не зависит вовсе.
  assert.ok(/\}, \[theme\.accent\]\);/.test(sidebar), 'зависимость только от акцента темы');
});

// ── Скин виден там, где аватарка именно его ─────────────────────────────────

test('в сообщениях кольцо остаётся у того, кто его поставил', () => {
  assert.ok(
    /const ringIdForAvatar = isOwn \? ownRingId : \(sender\?\.activeRing \|\| ''\)/.test(bubble),
    'своё — своё кольцо, чужое — кольцо отправителя',
  );
});

test('в профиле кольцо принадлежит тому, чей это профиль', () => {
  assert.ok(/shopActiveRing/.test(profilePage), 'на своей странице берётся своё кольцо');
  assert.ok(
    /isMe \? ownRing : remoteRing\?\.userId === user\.id \? remoteRing\.id : user\.activeRing/.test(profileModal),
    'в чужом профиле — кольцо этого пользователя',
  );
});