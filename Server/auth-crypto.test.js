const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { hashPassword, verifyPassword, verifyAndMigrate } = require('./auth-crypto');

test('Argon2id hashes verify and reject invalid passwords', async () => {
  const encoded = await hashPassword('correct horse battery');
  assert.match(encoded, /^\$argon2id\$/);
  assert.equal(await verifyPassword('correct horse battery', encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);
});

test('legacy bcrypt credentials migrate after successful verification', async () => {
  const user = { passwordHash: await bcrypt.hash('legacy secret password', 4) };
  const result = await verifyAndMigrate('legacy secret password', user);
  assert.deepEqual(result, { ok: true, migrated: true });
  assert.match(user.passwordHash, /^\$argon2id\$/);
  assert.equal((await verifyAndMigrate('wrong password', user)).ok, false);
});

test('short passwords are rejected before hashing', async () => {
  await assert.rejects(() => hashPassword('too short'), /password_too_short/);
});