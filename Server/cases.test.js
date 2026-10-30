const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = require('../Web/src/store/cases.json');

function setup(failSave = false) {
  const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const routes = {};
  const user = { id: 'one', walletBalance: 100, ownedItems: [], caseCounts: { 'case-base': 1 } };
  const context = {
    require: () => catalog, db: { users: [user] },
    CASE_PRICES: Object.fromEntries(catalog.map(c => [c.id, null])),
    normalizeCaseInventory: value => Object.fromEntries(catalog.map(c => [c.id, value?.[c.id] || 0])),
    ensureWallet: u => u, authMiddleware() {},
    normalizePetId: id => ({ 'pet-owl': 'pet-bunny', 'pet-dragon': 'pet-pixel' }[id] || id),
    app: { get: (p, a, fn) => routes[p] = fn, post: (p, a, fn) => routes[p] = fn },
    crypto: { randomInt: () => 0 }, saveDb: () => { if (failSave) throw Error('disk'); },
    userSockets: new Map(), pushWalletEmit() {}, reactionSkins: require('./reaction-skins'),
  };
  vm.runInNewContext(source.slice(source.indexOf("const CASE_CATALOG = require("), source.indexOf('// Создать инвойс на пополнение')), context);
  function call(route, caseId) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    routes[route]({ userId: 'one', body: { caseId } }, res);
    return res;
  }
  return { user, call, context };
}
test('opening consumes exactly one case and persists all three matching pieces', () => {
  const { user, call } = setup();
  const result = call('/api/cases/open', 'case-base');
  assert.equal(result.code, 200);
  assert.equal(result.data.drop, 'pack-shadow');
  assert.equal(user.caseCounts['case-base'], 0);
  assert.deepEqual([...user.ownedItems], ['ring-pack-shadow', 'selfcard-pack-shadow', 'bubble-shadow']);
  assert.equal(user.casePacks['pack-shadow'], 1);
  assert.equal(call('/api/cases/open', 'case-base').code, 409);
  assert.equal(user.walletBalance, 100);
});
test('unknown and unpriced cases cannot debit wallet; priced purchases can', () => {
  const { user, call, context } = setup();
  assert.equal(call('/api/cases/buy', 'unknown').code, 400);
  assert.equal(call('/api/cases/buy', 'case-base').code, 409);
  context.CASE_PRICES['case-base'] = 60;
  assert.equal(call('/api/cases/buy', 'case-base').code, 200);
  assert.equal(user.walletBalance, 40);
  assert.equal(user.caseCounts['case-base'], 2);
  assert.equal(call('/api/cases/buy', 'case-base').code, 409);
});
test('hidden case cannot be bought but stays openable from inventory', () => {
  const { user, call, context } = setup();
  // Даже с назначенной ценой и балансом покупка скрытого кейса запрещена.
  context.CASE_PRICES['case-pets-mythical'] = 2000;
  assert.equal(call('/api/cases/buy', 'case-pets-mythical').code, 403);
  assert.equal(user.walletBalance, 100);
  assert.equal(user.caseCounts['case-pets-mythical'] || 0, 0);
  // Запас, купленный до скрытия, продолжает открываться.
  user.caseCounts['case-pets-mythical'] = 1;
  const result = call('/api/cases/open', 'case-pets-mythical');
  assert.equal(result.code, 200);
  assert.equal(result.data.drop, 'pet-panda');
  assert.equal(user.caseCounts['case-pets-mythical'], 0);
});
test('failed persistence rolls back inventory and rewards', () => {
  const { user, call } = setup(true);
  const before = JSON.stringify(user);
  assert.equal(call('/api/cases/open', 'case-base').code, 500);
  assert.equal(JSON.stringify(user), before);
});

test('duplicate drops keep pet copies and pack counts instead of overwriting', () => {
  const { user, call } = setup();
  user.caseCounts['case-pets'] = 2;
  const first = call('/api/cases/open', 'case-pets');
  assert.equal(first.code, 200);
  assert.equal(first.data.drop, 'pet-cat');
  assert.equal(call('/api/cases/open', 'case-pets').code, 200);
  assert.deepEqual([...user.ownedPets], ['pet-cat'], 'второй кот не плодит дубликата в ownedPets');
  assert.equal(user.petCounts['pet-cat'], 2, 'дубликат идёт в счётчик копий');
  assert.equal(user.caseCounts['case-pets'], 0);

  user.caseCounts['case-base'] = 2;
  assert.equal(call('/api/cases/open', 'case-base').data.drop, 'pack-shadow');
  assert.equal(call('/api/cases/open', 'case-base').data.drop, 'pack-shadow');
  assert.deepEqual([...user.ownedItems], ['ring-pack-shadow', 'selfcard-pack-shadow', 'bubble-shadow']);
  assert.equal(user.casePacks['pack-shadow'], 2, 'повторный пак копится в счётчике');
  assert.equal(call('/api/cases/open', 'case-pets').code, 409);
});

test('legacy pet ids count duplicates against their migrated form', () => {
  const { user, call, context } = setup();
  user.ownedPets = ['pet-owl'];
  user.caseCounts['case-pets'] = 1;
  // roll=102 попадает в pet-bunny (cat:2 + fox:100 уже выбраны по весу).
  // Веса теперь умножаются на 1e12 перед randomInt, поэтому та же точка — 102e12.
  context.crypto.randomInt = () => 102e12;
  const result = call('/api/cases/open', 'case-pets');
  assert.equal(result.code, 200);
  assert.equal(result.data.drop, 'pet-bunny');
  assert.equal(user.petCounts['pet-bunny'], 2, 'дубликат старого id учтён как вторая копия');
});

test('reaction case grants skin copies into reactionSkins', () => {
  const { user, call } = setup();
  user.caseCounts['case-reactions'] = 2;
  const first = call('/api/cases/open', 'case-reactions');
  assert.equal(first.code, 200);
  assert.equal(first.data.drop, 'rx-neon-like');
  assert.equal(call('/api/cases/open', 'case-reactions').code, 200);
  assert.equal(user.reactionSkins['rx-neon-like'], 2, 'дубликат скина копится в счётчике');
  assert.equal(user.lastCaseDrop, 'rx-neon-like');
  assert.equal(user.caseCounts['case-reactions'], 0);
  assert.deepEqual([...user.ownedItems], [], 'скин реакции не попадает в ownedItems');
});

test('reaction case rewards all exist in the reaction skin catalog', () => {
  const skins = require('./reaction-skins');
  const definition = catalog.find(c => c.id === 'case-reactions');
  assert.equal(definition.rewards.length, 50);
  for (const reward of definition.rewards) assert.ok(skins.isSkinId(reward.key), reward.key);
});

test('case catalog contains the requested marketplace prices', () => {
  const prices = Object.fromEntries(catalog.map(({ id, price }) => [id, price]));
  assert.deepEqual(prices, {
    'case-ashes': 300,
    'case-base': 100,
    'case-myths': 400,
    'case-nightmares': 500,
    'case-signal': 100,
    'case-street': 500,
    'case-culture': 100,
    'case-elements': 500,
    'case-eclipse': 500,
    'case-games': 500,
    'case-corporation': 200,
    'case-pets': 1000,
    'case-pets-bestiary': 2000,
    'case-pets-mythical': 2000,
    'case-reactions': 300,
  });
  assert.equal(catalog.find(caseDefinition => caseDefinition.id === 'case-eclipse').name, 'Затемнение');
  assert.equal(catalog.find(caseDefinition => caseDefinition.id === 'case-games').name, 'Легенды видеоигр');
  assert.equal(catalog.find(caseDefinition => caseDefinition.id === 'case-street').name, 'Уличный стиль');
});