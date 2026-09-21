const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

function setup(env = {}, admins = []) {
  const context = { process: { env }, db: { admins }, isDevIp: () => false };
  vm.runInNewContext(source.slice(source.indexOf('const ADMIN_ENV ='), source.indexOf('function normalizeAllUsers()')), context);
  return context;
}

test('Vera koto accounts replace the three default admins', () => {
  const context = setup();
  for (const username of ['Vera_koto_a', 'Vera_koto_b', ' @VERA_KOTO_A ']) {
    assert.equal(context.isAdminUser({}, { username }), true, username);
  }
  for (const username of ['admin1', 'admin2', 'admin3', '1', '2', '3', 'Vera_koto_c', '', undefined]) {
    assert.equal(context.isAdminUser({}, { username }), false, String(username));
  }
});

test('explicit environment and database admin assignments still work', () => {
  const context = setup({ ADMIN_USERNAMES: ' @Custom_Admin ' }, ['Database_Admin']);
  assert.equal(context.isAdminUsername('custom_admin'), true);
  assert.equal(context.isAdminUsername('@DATABASE_ADMIN'), true);
  assert.equal(context.isAdminUsername('Vera_koto_a'), false);
  assert.equal(context.isAdminUsername('admin1'), false);
});