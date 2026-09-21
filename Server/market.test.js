const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const routes = {};
  const context = {
    db: { users: [
      { id: 'seller', ownedItems: ['ring-glow'], walletBalance: 0 },
      { id: 'buyer', ownedItems: [], walletBalance: 100 },
    ], marketListings: [] },
    MARKET_MIN_PRICE_VP: 6, MARKET_MAX_PRICE_VP: 100000000, MARKET_SELLER_SHARE: 85,
    ensureWallet: u => u, isKnownSkinId: id => id === 'ring-glow',
    uuidv4: () => 'listing', authMiddleware() {},
    app: { get: (p, a, fn) => routes[p] = fn, post: (p, a, fn) => routes[p] = fn },
    saveDb() {}, pushWalletEmit() {}, emitMarketUpdated() {},
  };
  vm.runInNewContext(source.slice(source.indexOf('function activeListingsForSeller'), source.indexOf('function emitMarketUpdated')), context);
  vm.runInNewContext(source.slice(source.indexOf('// Shared skin marketplace.'), source.indexOf('const CREATOR_FEE_RUB')), context);
  const call = (route, userId = 'seller', body = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    routes[route]({ userId, body, params: { id: 'listing' } }, res);
    return res;
  };
  return { context, call };
}

test('minimum price, shared visibility, escrow, purchase and commission', () => {
  const { context, call } = setup();
  for (const price of [0, 5, 6.5, '6', 100000001]) assert.equal(call('/api/market/list', 'seller', { itemId: 'ring-glow', price }).code, 400);
  assert.equal(call('/api/market/list', 'buyer', { itemId: 'ring-glow', price: 6 }).code, 409);
  assert.equal(call('/api/market/list', 'seller', { itemId: 'ring-glow', price: 6 }).code, 200);
  assert.equal(context.db.users[0].ownedItems.length, 0);
  const listing = call('/api/market', 'buyer').data.listings[0];
  assert.equal(listing.price, 6);
  assert.equal(listing.isMine, false);
  assert.equal(call('/api/market/:id/buy', 'seller').code, 403);
  assert.equal(call('/api/market/:id/cancel', 'buyer').code, 403);
  assert.equal(call('/api/market/:id/buy', 'buyer').code, 200);
  assert.equal(context.db.users[1].walletBalance, 94);
  assert.equal(context.db.users[0].walletBalance, 5);
  assert.equal(context.db.platformRevenueVp, 1);
  assert.equal(context.db.users[1].ownedItems[0], 'ring-glow');
  assert.equal(call('/api/market/:id/buy', 'buyer').code, 404);
});

test('cancellation restores inventory and failed saves roll back', () => {
  const { context, call } = setup();
  call('/api/market/list', 'seller', { itemId: 'ring-glow', price: 200 });
  assert.equal(call('/api/market/:id/buy', 'buyer').code, 409);
  const before = JSON.stringify(context.db);
  context.saveDb = () => { throw Error('disk'); };
  assert.equal(call('/api/market/:id/cancel').code, 500);
  assert.equal(JSON.stringify(context.db), before);
  context.saveDb = () => {};
  assert.equal(call('/api/market/:id/cancel').code, 200);
  assert.equal(context.db.users[0].ownedItems[0], 'ring-glow');
  assert.equal(context.db.marketListings.length, 0);
});