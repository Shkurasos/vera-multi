'use strict';

const crypto = require('node:crypto');

function loadArgon2() {
  try { return require('argon2'); } catch (error) {
    error.message = 'argon2 is required for password authentication. Run npm install in Server/. ' + error.message;
    throw error;
  }
}

const ARGON2_OPTIONS = {
  type: loadArgon2().argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('password_too_short');
  return loadArgon2().hash(password, ARGON2_OPTIONS);
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  try { return await loadArgon2().verify(encoded, password); } catch { return false; }
}

function isLegacyBcrypt(encoded) {
  return typeof encoded === 'string' && /^\$2[aby]?\$/.test(encoded);
}

async function verifyAndMigrate(password, user) {
  const encoded = user?.passwordHash;
  if (!encoded) return { ok: false, migrated: false };
  if (encoded.startsWith('$argon2id$')) return { ok: await verifyPassword(password, encoded), migrated: false };
  if (!isLegacyBcrypt(encoded)) return { ok: false, migrated: false };
  const bcrypt = require('bcrypt');
  const ok = await bcrypt.compare(password, encoded);
  if (!ok) return { ok: false, migrated: false };
  user.passwordHash = await hashPassword(password);
  user.passwordHashVersion = 2;
  return { ok: true, migrated: true };
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, verifyAndMigrate, timingSafeEqualText };