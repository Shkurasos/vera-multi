const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

function loadWithDevFlag(admins = []) {
  const context = { isAdminUsername: name => admins.includes(name), isDevIp: () => false };
  vm.runInNewContext(source.slice(source.indexOf('const PRIVATE_USER_FIELDS ='), source.indexOf('// ─── Админы по username')), context);
  return context;
}

function loadAdminEnv(env) {
  const context = { process: { env }, db: { admins: [] }, isDevIp: () => false };
  vm.runInNewContext(source.slice(source.indexOf('const ADMIN_ENV ='), source.indexOf('function normalizeAllUsers()')), context);
  return context;
}

test('auth responses never include credentials or session secrets', () => {
  const { withDevFlag } = loadWithDevFlag();
  const user = {
    id: 'u1', username: 'alice', email: 'a@example.com', phone: '+7900', walletBalance: 5,
    passwordHash: '$argon2id$...', passwordHashVersion: 2, tokenVersion: 3,
    refreshTokens: ['x'], totpSecret: 's', recoveryCodes: ['c'],
  };
  const result = JSON.parse(JSON.stringify(withDevFlag({}, user)));
  for (const field of ['passwordHash', 'passwordHashVersion', 'tokenVersion', 'refreshTokens', 'totpSecret', 'recoveryCodes']) {
    assert.equal(Object.hasOwn(result, field), false, field);
  }
  // Владелец по-прежнему видит свои контакты и баланс.
  assert.equal(result.email, 'a@example.com');
  assert.equal(result.phone, '+7900');
  assert.equal(result.walletBalance, 5);
  assert.equal(result.isAdmin, false);
  // Исходная запись в БД не изменена.
  assert.equal(user.passwordHash, '$argon2id$...');
});

test('admin flag is still applied after sanitizing', () => {
  const { withDevFlag } = loadWithDevFlag(['boss']);
  const result = withDevFlag({}, { id: 'b', username: 'boss', passwordHash: 'h' });
  assert.equal(result.isAdmin, true);
  assert.equal(result.isDev, true);
  assert.equal(Object.hasOwn(result, 'passwordHash'), false);
});

test('production refuses to start without explicit ADMIN_USERNAMES', () => {
  assert.throws(() => loadAdminEnv({ NODE_ENV: 'production' }), /ADMIN_USERNAMES/);
  assert.throws(() => loadAdminEnv({ NODE_ENV: 'production', ADMIN_USERNAMES: '  ' }), /ADMIN_USERNAMES/);
  const ctx = loadAdminEnv({ NODE_ENV: 'production', ADMIN_USERNAMES: 'Owner' });
  assert.equal(ctx.isAdminUsername('owner'), true);
  assert.equal(ctx.isAdminUsername('Vera_koto_a'), false);
});
