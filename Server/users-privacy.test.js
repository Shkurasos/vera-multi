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
    inventoryVisibleToOthers: () => true,
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

test('security-log retention purge drops events older than the retention window and keeps recent ones', () => {
  const fnStart = source.indexOf('function purgeStaleSecurityLogs()');
  const fnSrc = source.slice(fnStart, source.indexOf('\n}', fnStart) + 2);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const context = {
    db: {
      loginEvents: [
        { id: 'old', createdAt: now - 120 * day },
        { id: 'edge', createdAt: now - 10 * day },
        { id: 'fresh', createdAt: now - 1 * day },
      ],
    },
    // 90-day window matches the default in server.js / the privacy policy text.
    SECURITY_LOG_RETENTION_MS: 90 * day,
  };
  vm.runInNewContext(fnSrc + '\nchanged = purgeStaleSecurityLogs();', context);
  assert.equal(context.changed, true);
  const ids = context.db.loginEvents.map(e => e.id);
  assert.deepEqual(ids, ['edge', 'fresh']);
});

test('privacy policy page documents concrete retention and restricted access', () => {
  const legal = fs.readFileSync(require.resolve('../Web/src/pages/LegalPage.tsx'), 'utf8');
  assert.match(legal, /90 дней/);
  assert.match(legal, /не более 20 последних/);
  assert.match(legal, /Доступ к журналам безопасности ограничен/);
  assert.match(legal, /16\+/);
});
