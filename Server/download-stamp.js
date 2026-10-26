'use strict';
/**
 * Embeds the server address into downloaded apps.
 *
 * A free Cloudflare tunnel gets a new address on every start, while the app is
 * built once. So /downloads writes into the file the address the site was opened
 * from (https://xxx.trycloudflare.com, http://localhost:3000, ...): the site and
 * the downloaded app always share one server, with no rebuild.
 *
 *  - APK: the address is a separate entry (ID 'VERA') in the APK Signing Block.
 *    That block is not covered by the v2/v3 signature (Walle/VasDolly channel
 *    builds work the same way), so the APK stays validly signed.
 *    Read by ServerStamp.java.
 *  - EXE (NSIS): a 1024-byte "VERASRV1 <url>\n" trailer. NSIS checks the CRC
 *    only over its own data, so trailing bytes are allowed. The installer
 *    copies the address to server-url.txt next to the app (resources/installer.nsh).
 *
 * SEC: the address comes from Host / X-Forwarded-* headers. Spoofing them only
 * changes the file that same client downloads (responses are no-store, so nothing
 * is shared through caches). The URL is reduced to an http(s) origin without
 * userinfo, so no path or script can be injected. APP_SERVER_URL pins it explicitly.
 */
const fs = require('fs');
const path = require('path');

const APK_STAMP_ID = 0x56455241;   // 'VERA'
const APK_PADDING_ID = 0x42726577; // apksigner alignment padding
const APK_SIG_MAGIC = Buffer.from('APK Sig Block 42', 'ascii');
const EOCD_SIG = 0x06054b50;
const EXE_TRAILER_SIZE = 1024;
const EXE_TRAILER_TAG = 'VERASRV1 ';
const MAX_URL = 300;
const APK_CACHE_LIMIT = 16;

/** Only an http(s) origin: no path, query or login/password. */
function normalizeServerUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_URL) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.origin;
}

/** The address the client opened the site from (behind Cloudflare/proxy too). */
function publicOrigin(req) {
  const fixed = normalizeServerUrl(process.env.APP_SERVER_URL || '');
  if (fixed) return fixed;
  const first = (v) => String(v || '').split(',')[0].trim();
  const headers = req.headers || {};
  const host = (first(headers['x-forwarded-host']) || first(headers.host)).toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  let proto = req.protocol === 'https' ? 'https' : 'http';
  const xfp = first(headers['x-forwarded-proto']).toLowerCase();
  if (xfp === 'https' || xfp === 'http') {
    proto = xfp;
  } else if (headers['cf-visitor']) {
    try {
      const scheme = JSON.parse(String(headers['cf-visitor'])).scheme;
      if (scheme === 'https' || scheme === 'http') proto = scheme;
    } catch { /* malformed header */ }
  }
  return normalizeServerUrl(`${proto}://${host}`);
}

/* ─── APK ─────────────────────────────────────────────────────────────── */

function findEocd(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG && i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  return -1;
}

function locateSigningBlock(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('not a zip/apk');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset < 32 || cdOffset > eocd) throw new Error('bad central directory offset');
  if (!buf.subarray(cdOffset - 16, cdOffset).equals(APK_SIG_MAGIC)) throw new Error('APK has no v2+ signing block');
  const size = Number(buf.readBigUInt64LE(cdOffset - 24));
  const start = cdOffset - size - 8;
  if (size < 24 || start < 0 || Number(buf.readBigUInt64LE(start)) !== size) throw new Error('bad signing block');
  return { eocd, cdOffset, start };
}

function readPairs(buf, start, cdOffset) {
  const pairs = [];
  const end = cdOffset - 24;
  let p = start + 8;
  while (p < end) {
    if (end - p < 12) throw new Error('truncated signing block pair');
    const len = Number(buf.readBigUInt64LE(p));
    if (len < 4 || p + 8 + len > end) throw new Error('bad signing block pair length');
    pairs.push({ id: buf.readUInt32LE(p + 8), value: buf.subarray(p + 12, p + 8 + len) });
    p += 8 + len;
  }
  return pairs;
}

function encodePair(id, value) {
  const out = Buffer.alloc(12 + value.length);
  out.writeBigUInt64LE(BigInt(4 + value.length), 0);
  out.writeUInt32LE(id, 8);
  value.copy(out, 12);
  return out;
}

/** Copy of the APK with the server address written in (re-stamping replaces it). */
function stampApk(buf, serverUrl) {
  const url = normalizeServerUrl(serverUrl);
  if (!url) throw new Error('invalid server url');
  const { eocd, cdOffset, start } = locateSigningBlock(buf);
  const old = readPairs(buf, start, cdOffset);
  const hadPadding = old.some((p) => p.id === APK_PADDING_ID);
  const body = old
    .filter((p) => p.id !== APK_STAMP_ID && p.id !== APK_PADDING_ID)
    .map((p) => encodePair(p.id, p.value));
  body.push(encodePair(APK_STAMP_ID, Buffer.from(url, 'utf8')));
  let pairsLen = body.reduce((n, b) => n + b.length, 0);
  if (hadPadding) {
    // Like apksigner: keep the whole block a multiple of 4096 bytes.
    const pad = (4096 - ((8 + pairsLen + 12 + 24) % 4096)) % 4096;
    body.push(encodePair(APK_PADDING_ID, Buffer.alloc(pad)));
    pairsLen += 12 + pad;
  }
  const size = pairsLen + 24;
  const head = Buffer.alloc(8);
  head.writeBigUInt64LE(BigInt(size));
  const tail = Buffer.alloc(24);
  tail.writeBigUInt64LE(BigInt(size));
  APK_SIG_MAGIC.copy(tail, 8);
  const block = Buffer.concat([head, ...body, tail]);
  // The v2 digest uses the EOCD with the CD offset replaced by the block start.
  // The start does not move, so the signature remains valid with the new offset.
  const eocdBuf = Buffer.from(buf.subarray(eocd));
  eocdBuf.writeUInt32LE(start + block.length, 16);
  return Buffer.concat([buf.subarray(0, start), block, buf.subarray(cdOffset, eocd), eocdBuf]);
}

function readApkStamp(buf) {
  try {
    const { cdOffset, start } = locateSigningBlock(buf);
    const pair = readPairs(buf, start, cdOffset).find((p) => p.id === APK_STAMP_ID);
    return pair ? normalizeServerUrl(pair.value.toString('utf8')) : null;
  } catch {
    return null;
  }
}

/* ─── EXE ─────────────────────────────────────────────────────────────── */

function exeTrailer(serverUrl) {
  const url = normalizeServerUrl(serverUrl);
  if (!url) throw new Error('invalid server url');
  const out = Buffer.alloc(EXE_TRAILER_SIZE, 0x0a);
  out.write(EXE_TRAILER_TAG + url + '\n', 0, 'ascii');
  return out;
}

function readExeStamp(buf) {
  if (buf.length < EXE_TRAILER_SIZE) return null;
  const text = buf.subarray(buf.length - EXE_TRAILER_SIZE).toString('ascii');
  if (!text.startsWith(EXE_TRAILER_TAG)) return null;
  return normalizeServerUrl(text.slice(EXE_TRAILER_TAG.length).split('\n')[0]);
}


/* ─── Middleware for /downloads ────────────────────────────────────────── */

function createDownloadStamper({ dir, log = console }) {
  const apkCache = new Map();
  return function stampedDownload(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let name;
    try { name = decodeURIComponent(String(req.path || '').replace(/^\//, '')); } catch { return next(); }
    const m = /^\w[\w .-]*\.(apk|exe)$/i.exec(name);
    if (!m) return next();
    const url = publicOrigin(req);
    if (!url) return next();
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { return next(); }
    if (!st.isFile()) return next();
    const isApk = m[1].toLowerCase() === 'apk';

    let apk = null;
    if (isApk) {
      const key = `${full}|${st.mtimeMs}|${st.size}|${url}`;
      apk = apkCache.get(key);
      if (!apk) {
        try {
          apk = stampApk(fs.readFileSync(full), url);
        } catch (e) {
          log.warn(`[downloads] cannot stamp ${name}: ${e.message}`);
          return next(); // unsigned/broken APK is served unchanged
        }
        apkCache.set(key, apk);
        if (apkCache.size > APK_CACHE_LIMIT) apkCache.delete(apkCache.keys().next().value);
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[\r\n"\\]/g, '_')}"`);
    res.setHeader('X-Vera-Server', url);

    if (isApk) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Length', apk.length);
      return req.method === 'HEAD' ? res.end() : res.end(apk);
    }
    const trailer = exeTrailer(url);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', st.size + trailer.length);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(full);
    stream.on('error', () => res.destroy());
    stream.on('end', () => res.end(trailer));
    stream.pipe(res, { end: false });
  };
}

module.exports = {
  APK_STAMP_ID,
  EXE_TRAILER_SIZE,
  normalizeServerUrl,
  publicOrigin,
  stampApk,
  readApkStamp,
  exeTrailer,
  readExeStamp,
  createDownloadStamper,
};

