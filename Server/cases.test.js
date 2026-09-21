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
    app: { get: (p, a, fn) => routes[p] = fn, post: (p, a, fn) => routes[p] = fn },
    crypto: { randomInt: () => 0 }, saveDb: () => { if (failSave) throw Error('disk'); },
    userSockets: new Map(), pushWalletEmit() {},
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
test('failed persistence rolls back inventory and rewards', () => {
  const { user, call } = setup(true);
  const before = JSON.stringify(user);
  assert.equal(call('/api/cases/open', 'case-base').code, 500);
  assert.equal(JSON.stringify(user), before);
});

test('case catalog contains the requested marketplace prices', () => {
  const prices = Object.fromEntries(catalog.map(({ id, price }) => [id, price]));
  assert.deepEqual(prices, {
    'case-ashes': 20,
    'case-base': 20,
    'case-myths': 20,
    'case-nightmares': 20,
    'case-signal': 100,
    'case-street': 100,
    'case-culture': 100,
    'case-elements': 500,
    'case-eclipse': 500,
    'case-games': 500,
    'case-corporation': null,
  });
  assert.equal(catalog.find(caseDefinition => caseDefinition.id === 'case-eclipse').name, 'Затемнение');
  assert.equal(catalog.find(caseDefinition => caseDefinition.id === 'case-games').name, 'Легенды видеоигр');
  assert.equal(catalog.find(caseDefinition => caseDefinition.id === 'case-street').name, 'Уличный стиль');
});