const { test } = require('node:test');
const assert = require('node:assert/strict');
const skins = require('./reaction-skins');

test('default slots are the 10 stock reactions', () => {
  assert.deepEqual(skins.slots({}), [...skins.STOCK]);
  assert.equal(skins.SLOT_COUNT, 10);
});

test('grant counts copies and ignores unknown ids', () => {
  const user = {};
  skins.grant(user, 'rx-neon-like');
  skins.grant(user, 'rx-neon-like');
  assert.equal(user.reactionSkins['rx-neon-like'], 2);
  assert.throws(() => skins.grant(user, 'rx-nope'));
  assert.deepEqual(skins.ownedSkins({ reactionSkins: { 'rx-nope': 3, 'rx-gold-star': 0, 'rx-pixel-sad': 1 } }), { 'rx-pixel-sad': 1 });
});

test('slots accept owned skins and stock emoji, reject foreign or duplicates', () => {
  const user = { reactionSkins: { 'rx-gold-star': 1 } };
  const wanted = ['rx-gold-star', ...skins.STOCK.slice(1)];
  assert.deepEqual(skins.validateSlots(user, wanted).slots, wanted);
  assert.ok(skins.validateSlots(user, ['rx-neon-like', ...skins.STOCK.slice(1)]).error, 'скина нет в инвентаре');
  assert.ok(skins.validateSlots(user, skins.STOCK.slice(0, 9)).error, 'меньше 10');
  assert.ok(skins.validateSlots(user, [skins.STOCK[1], ...skins.STOCK.slice(1)]).error, 'повтор');
  assert.ok(skins.validateSlots(user, ['💩', ...skins.STOCK.slice(1)]).error, 'не из стока');
});

test('slots fall back to stock when a saved skin is no longer owned', () => {
  const user = { reactionSkins: {}, reactionSlots: ['rx-gold-star', ...skins.STOCK.slice(1)] };
  assert.deepEqual(skins.slots(user), [...skins.STOCK]);
  // Сток позиции уже занят в другом слоте — подставляется свободный стоковый.
  const moved = { reactionSkins: {}, reactionSlots: ['rx-gold-star', skins.STOCK[0], ...skins.STOCK.slice(2)] };
  const result = skins.slots(moved);
  assert.equal(new Set(result).size, 10);
  assert.ok(result.includes(skins.STOCK[1]));
});

test('canReact: own skins only, plain emoji allowed', () => {
  assert.equal(skins.canReact({}, '👍'), true);
  assert.equal(skins.canReact({}, 'rx-neon-like'), false);
  assert.equal(skins.canReact({ reactionSkins: { 'rx-neon-like': 1 } }, 'rx-neon-like'), true);
  assert.equal(skins.canReact({}, ''), false);
  assert.equal(skins.canReact({}, 'x'.repeat(40)), false);
  // Любой скин каталога, включая длинные id вроде rx-cosmos-dislike.
  const catalog = require('../Web/src/store/reactionSkins.json');
  for (const id of catalog.packs.flatMap(p => p.reactions.map(r => r.id))) {
    assert.equal(skins.canReact({ reactionSkins: { [id]: 1 } }, id), true, id);
  }
  assert.equal(skins.canReact({}, 'rx-cosmos-dislike'), false, 'чужой скин всё ещё нельзя');
});

test('PUT /api/reactions/slots saves, emits and rejects invalid input', () => {
  const routes = {};
  const user = { id: 'u', reactionSkins: { 'rx-cosmos-fire': 1 } };
  const emitted = [];
  skins.install({
    app: { get: (p, a, fn) => { routes['get ' + p] = fn; }, put: (p, a, fn) => { routes['put ' + p] = fn; } },
    getDb: () => ({ users: [user] }), saveDb() {}, authMiddleware() {},
    emitToUser: (u, event, payload) => emitted.push([event, payload]),
  });
  const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } });
  const slots = [skins.STOCK[0], skins.STOCK[1], 'rx-cosmos-fire', ...skins.STOCK.slice(3)];
  const ok = res();
  routes['put /api/reactions/slots']({ userId: 'u', body: { slots } }, ok);
  assert.equal(ok.code, 200);
  assert.deepEqual(ok.data.reactionSlots, slots);
  assert.equal(emitted[0][0], 'reactions:updated');
  const bad = res();
  routes['put /api/reactions/slots']({ userId: 'u', body: { slots: ['rx-gold-star', ...skins.STOCK.slice(1)] } }, bad);
  assert.equal(bad.code, 400);
  const got = res();
  routes['get /api/reactions']({ userId: 'u' }, got);
  assert.deepEqual(got.data.reactionSlots, slots);
});
