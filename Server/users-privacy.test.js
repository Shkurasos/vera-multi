const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const SEARCH_ROUTE = source.slice(
  source.indexOf("app.get('/api/users/search'"),
  source.indexOf('// Publish only equipment IDs'),
);

test('user search projects stored records through the public user serializer', () => {
  assert.match(SEARCH_ROUTE, /\.map\(item => publicUserFields\(item\.user\)\)/);
  assert.doesNotMatch(SEARCH_ROUTE, /\.map\(item => item\.user\)/);
});

test('public user serializer does not expose account or authorization fields', () => {
  const serializer = source.slice(
    source.indexOf('function publicUserFields(user)'),
    source.indexOf('// GET /api/users/:id'),
  );
  for (const field of ['email', 'phone', 'password', 'tokenVersion', 'isAdmin', 'isDev', 'refreshTokens']) {
    assert.doesNotMatch(serializer, new RegExp(`\b${field}\s*:`), `private field leaked: ${field}`);
  }
  assert.match(serializer, /id: user\.id/);
  assert.match(serializer, /username: user\.username/);
});

test('search returns public profiles without private or future account fields', () => {
  let search;
  const user = {
    id: 'other', username: 'alice', firstName: 'Alice',
    email: 'alice@example.com', phone: '123456', tokenVersion: 7,
    isAdmin: true, isDev: true, futureSecret: 'private', activeRing: 'ring-blue',
  };
  const context = {
    app: { get: (_path, _auth, handler) => { search = handler; } },
    authMiddleware() {}, db: { users: [user, { id: 'self', username: 'alice_self' }] },
    safeLower: value => String(value || '').toLowerCase(),
    normalizeAllUsers() {}, normalizeUserRecord() {},
    sanitizedEquippedPet: () => null,
  };
  const serializer = source.slice(source.indexOf('function publicUserFields(user)'), source.indexOf('// GET /api/users/:id'));
  vm.runInNewContext(serializer + SEARCH_ROUTE, context);
  let result;
  search({ userId: 'self', query: { q: 'alice' } }, { json: value => { result = JSON.parse(JSON.stringify(value)); } });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'other');
  assert.equal(result[0].activeRing, 'ring-blue');
  for (const field of ['email', 'phone', 'tokenVersion', 'isAdmin', 'isDev', 'futureSecret']) {
    assert.equal(Object.hasOwn(result[0], field), false, field);
  }
  assert.equal(user.futureSecret, 'private');
});