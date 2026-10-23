'use strict';
/**
 * Криптография хранилища.
 *
 *   VERA_KEK  — корневой ключ (≥32 байт, base64 или hex). Сам по себе ничего
 *               не шифрует: из него HKDF выводит отдельные подключи под каждую
 *               задачу, чтобы компрометация одного назначения не давала другое.
 *
 *   records   — шифрование записей БД (AES-256-GCM, случайный 12-байтный nonce,
 *               AAD привязывает шифротекст к таблице/коллекции/id — запись нельзя
 *               молча переставить в другую строку).
 *   files     — шифрование загруженных файлов (blobs/). Отдельный подключ:
 *               AAD файла — его имя, так что файл нельзя подставить под чужое.
 *
 * Формат конверта: [версия 1 байт][nonce 12][tag 16][ciphertext].
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const MIN_KEK_BYTES = 32;

function decodeKey(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) return Buffer.from(text, 'hex');
  const decoded = Buffer.from(text, 'base64');
  // Buffer.from молча выбрасывает мусор — проверяем, что это действительно base64.
  if (decoded.length && decoded.toString('base64').replace(/=+$/, '') === text.replace(/=+$/, '')) return decoded;
  return null;
}

function hkdf(kek, info) {
  return Buffer.from(crypto.hkdfSync('sha256', kek, Buffer.from('vera-store'), Buffer.from(info), 32));
}

/** Набор подключей из одного KEK. */
function createKeyring(kek) {
  if (!Buffer.isBuffer(kek) || kek.length < MIN_KEK_BYTES) {
    throw new Error(`VERA_KEK должен быть не короче ${MIN_KEK_BYTES} байт`);
  }
  return Object.freeze({
    records: hkdf(kek, 'records:v1'),
    files: hkdf(kek, 'files:v1'),
  });
}

function encrypt(key, plaintext, aad) {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(String(aad)));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), nonce, cipher.getAuthTag(), body]);
}

/** Бросает исключение при неверном ключе, AAD или подмене байтов (GCM fail-fast). */
function decrypt(key, envelope, aad) {
  const buf = Buffer.isBuffer(envelope) ? envelope : Buffer.from(envelope || []);
  if (buf.length < HEADER_BYTES || buf[0] !== ENVELOPE_VERSION) throw new Error('Повреждённый шифротекст');
  const nonce = buf.subarray(1, 1 + NONCE_BYTES);
  const tag = buf.subarray(1 + NONCE_BYTES, HEADER_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(String(aad)));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(HEADER_BYTES)), decipher.final()]);
}

function encryptJson(key, value, aad) {
  return encrypt(key, Buffer.from(JSON.stringify(value), 'utf8'), aad);
}

function decryptJson(key, envelope, aad) {
  return JSON.parse(decrypt(key, envelope, aad).toString('utf8'));
}

/** Файл ключа, который создаётся рядом с базой, если VERA_KEK не задан. */
const LOCAL_KEK_FILE = 'vera-dev.kek';

/**
 * Достаёт KEK из окружения. Если VERA_KEK не задан, ключ берётся из файла
 * vera-dev.kek рядом с базой (создаётся для новой базы). Это временный режим:
 * ключ лежит рядом с данными, поэтому защищает только от утечки одной базы.
 * REQUIRE_VERA_KEK=1 запрещает этот режим (сервер не стартует без VERA_KEK).
 * Перейти с файла на VERA_KEK: node store-cli.js rekey (см. DEPLOY.md).
 */
function resolveKek({ env = process.env, dataDir, isProd = env.NODE_ENV === 'production', log = console, allowCreate = true } = {}) {
  if (env.VERA_KEK) {
    const kek = decodeKey(env.VERA_KEK);
    if (!kek || kek.length < MIN_KEK_BYTES) throw new Error(`VERA_KEK должен быть base64/hex и не короче ${MIN_KEK_BYTES} байт`);
    return kek;
  }
  if (env.REQUIRE_VERA_KEK === '1') throw new Error('[FATAL] VERA_KEK is not set, а REQUIRE_VERA_KEK=1. Задайте ключ (fly secrets set VERA_KEK=...).');
  if (isProd) log.warn('[store] ВНИМАНИЕ: VERA_KEK не задан, ключ шифрования хранится в файле рядом с базой.');
  const file = path.join(dataDir, LOCAL_KEK_FILE);
  if (fs.existsSync(file)) return decodeKey(fs.readFileSync(file, 'utf8'));
  // База уже есть, а ключа нет — новый ключ её всё равно не откроет.
  if (!allowCreate) throw new Error(`Нет ключа ${file} и не задан VERA_KEK — хранилище не расшифровать`);
  fs.mkdirSync(dataDir, { recursive: true });
  const kek = crypto.randomBytes(MIN_KEK_BYTES);
  fs.writeFileSync(file, kek.toString('base64'), { mode: 0o600 });
  log.warn(`[store] VERA_KEK не задан — создан локальный dev-ключ ${file}. Без него база не откроется.`);
  return kek;
}

module.exports = {
  createKeyring, encrypt, decrypt, encryptJson, decryptJson, decodeKey, resolveKek,
  MIN_KEK_BYTES, LOCAL_KEK_FILE,
};
