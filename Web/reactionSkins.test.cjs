const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const catalog = require('./src/store/reactionSkins.json');
const cases = require('./src/store/cases.json');

test('каталог скинов реакций: 5 паков по 10, 10 стоковых, уникальные id', () => {
  assert.equal(catalog.stock.length, 10);
  assert.equal(new Set(catalog.stock).size, 10);
  assert.equal(catalog.packs.length, 5);
  const ids = catalog.packs.flatMap(p => p.reactions.map(r => r.id));
  assert.equal(ids.length, 50);
  assert.equal(new Set(ids).size, 50);
  for (const pack of catalog.packs) for (const r of pack.reactions) assert.ok(r.id.startsWith(`rx-${pack.id}-`), r.id);
  const definition = cases.find(c => c.id === 'case-reactions');
  assert.deepEqual(definition.rewards.map(r => r.key).sort(), [...ids].sort(), 'кейс выдаёт ровно скины каталога');
});

test('быстрые реакции берутся из слотов пользователя и рисуются через ReactionGlyph', () => {
  const bubble = read('src/components/MessageBubble.tsx');
  assert.ok(!bubble.includes('REACTION_EMOJIS'), 'захардкоженный список удалён');
  assert.ok(bubble.includes('reactionSlots.map('), 'пикер построен по слотам');
  assert.ok(bubble.includes('<ReactionGlyph value={r.emoji} />'), 'реакции сообщения рендерят скины');
  const comments = read('src/components/ChannelComments.tsx');
  assert.ok(comments.includes('reactionSlots.map('), 'комментарии канала используют те же слоты');
  assert.ok(comments.includes('<ReactionGlyph value={r.emoji} />'));
});

test('владение и слоты синхронизируются с сервером', () => {
  const app = read('src/App.tsx');
  assert.ok(app.includes("socket.on('reactions:updated'"), 'слушаем обновление слотов');
  // Кейс передаёт обе части: раньше приходил только reactionSkins, и гидратация
  // без reactionSlots затирала выбранные слоты стоком сразу после открытия.
  const loot = read('src/store/lootStore.ts');
  assert.ok(loot.includes('hydrate({ reactionSkins: data.reactionSkins, reactionSlots: data.reactionSlots })'), 'кейсы передают и скины, и слоты');
  assert.ok(loot.includes('data.reactionSkins || data.reactionSlots'), 'гидратация не падает без одного из полей');
  // Сервер отдаёт слоты вместе с кейсами: событие cases:updated — тот же payload.
  const server = read('../Server/server.js');
  assert.ok(server.includes('reactionSlots: reactionSkins.slots(user)'), 'слоты в ответе /api/cases');
  assert.ok(server.includes('reactionSkins: reactionSkins.ownedSkins(user)'), 'владение в ответе /api/cases');
  const api = read('src/services/api.ts');
  assert.ok(api.includes("api.put<{ reactionSkins: Record<string, number>; reactionSlots: string[] }>('/reactions/slots', { slots })"));
  assert.ok(read('src/components/ProfileCustomizeDialog.tsx').includes('<ReactionSlotsEditor />'), 'редактор 10 слотов в кастомизации');
  assert.ok(read('src/components/Store.tsx').includes('setReactionDrop(lastDrop)'), 'магазин показывает выпавший скин');
});

test('слоты грузятся при входе и в профиле, скинов нет в инвентаре', () => {
  // После F5 слоты не должны зависеть от захода в инвентарь.
  const auth = read('src/store/authStore.ts');
  const hydrate = auth.slice(auth.indexOf('async function hydrateAccount'), auth.indexOf('interface AuthState'));
  assert.ok(hydrate.includes('useReactionSkinStore.getState().load()'), 'загрузка слотов при входе');
  assert.ok(read('src/components/ReactionSlotsEditor.tsx').includes('useReactionSkinStore.getState().load()'), 'профиль сам грузит слоты');
  const store = read('src/components/Store.tsx');
  assert.ok(!store.includes('Object.entries(reactionOwned)'), 'скины реакций не в сетке инвентаря');
  assert.ok(!store.includes("['reaction', 'Реакции']"), 'нет вкладки «Реакции» в инвентаре');
});

test('реакции рисуются своими SVG-формами, а не системными эмодзи', () => {
  const glyph = read('src/components/ReactionGlyph.tsx');
  const art = read('src/components/ReactionArt.tsx');
  assert.ok(glyph.includes('<svg') && glyph.includes('<ReactionArt'), 'глиф — собственный SVG');
  assert.ok(!glyph.includes('skin.glyph'), 'системный эмодзи скина больше не выводится');
  const keys = new Set(catalog.packs.flatMap(p => p.reactions.map(r => r.id.slice(r.id.lastIndexOf('-') + 1))));
  for (const key of keys) assert.ok(art.includes(`'${key}'`), `есть форма для ${key}`);
  for (const pack of catalog.packs) assert.ok(art.includes(`${pack.id}: `), `есть палитра пака ${pack.id}`);
});

test('кейс реакций крутит рулетку, как паки и питомцы', () => {
  const store = read('src/components/Store.tsx');
  assert.ok(store.includes('setReactionReel(sequence)'), 'лента рулетки для скинов реакций');
  assert.ok(!/setReactionDrop\(lastDrop\); setPhase\('result'\)/.test(store), 'нет мгновенного результата без прокрутки');
  assert.ok(store.includes('reactionReel.length > 0'), 'лента показывается в общем окне рулетки');
});

test('профиль: слева питомцы, в центре «О себе», QR и комментарии, справа реакции', () => {
  const profile = read('src/pages/ProfilePage.tsx');
  assert.ok(profile.includes('data-vera-profile-columns'));
  assert.ok(profile.includes(`md: '"left center right" "left comments right"'`), 'три колонки, комментарии под центром');
  assert.ok(!profile.includes('⅕ экрана`'), 'подсказка «До N px · ⅕ экрана» убрана');
  const center = profile.indexOf('data-vera-profile-center');
  const left = profile.indexOf('data-vera-profile-left');
  const right = profile.indexOf('data-vera-profile-right');
  const comments = profile.indexOf('data-vera-profile-comments');
  const between = (from, to, needle) => { const i = profile.indexOf(needle, from); return i > from && i < to; };
  assert.ok(center > 0 && left > center && right > left && comments > right, 'порядок DOM: центр, лево, право, комментарии');
  assert.ok(between(center, left, 'О себе') && between(center, left, 'QR-привязка'), '«О себе» и QR — в центре');
  assert.ok(between(left, right, 'Питомцы') && !between(left, right, '<ReactionSlotsEditor />'), 'слева только питомцы');
  assert.ok(between(right, comments, '<ReactionSlotsEditor />'), 'реакции — справа');
  assert.ok(profile.indexOf('<ProfileCommentsWall', comments) > comments, 'комментарии — под «О себе»');
  assert.ok(!read('src/components/ReactionSlotsEditor.tsx').includes('setActive(i => (i + 1)'), 'слот не перескакивает — ставим в любой');
});
