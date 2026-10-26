'use strict';

// Доступ к /uploads по cookie.
//
// Картинки, голосовые и файлы грузятся тегами <img>/<audio>/<a>, которые не
// умеют слать Authorization: Bearer. Поэтому при входе сервер ставит отдельную
// HttpOnly-cookie vera_media (path=/uploads), а middleware проверяет её перед
// express.static. Подпись — HMAC на ключе, производном от JWT_SECRET, но
// отличном от него: cookie нельзя подсунуть вместо access-токена и наоборот.

const crypto = require('node:crypto');

const MEDIA_COOKIE = 'vera_media';
const MEDIA_COOKIE_PATH = '/uploads';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/**
 * @param {object} opts
 * @param {string} opts.secret      базовый секрет (JWT_SECRET)
 * @param {number} opts.ttlMs       срок жизни cookie
 * @param {boolean} opts.secure     ставить флаг Secure (прод)
 * @param {(session: {u: string, d: string|null, tv: number, dv: number}) => boolean} opts.isSessionValid
 *        проверка, что сессия ещё жива (юзер есть, не забанен, устройство не отвязано)
 */
function createMediaAuth({ secret, ttlMs, secure, isSessionValid }) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('media-auth: secret is required');
  const key = crypto.createHmac('sha256', secret).update('vera-media-cookie-v1').digest();

  function mac(body) {
    return crypto.createHmac('sha256', key).update(body).digest();
  }

  function sign({ userId, deviceId, tv, dv }, now = Date.now()) {
    const body = b64url(JSON.stringify({
      u: String(userId), d: deviceId || null, tv: Number(tv || 0), dv: Number(dv || 0), exp: now + ttlMs,
    }));
    return `${body}.${b64url(mac(body))}`;
  }

  function verify(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 1024) return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
    const body = token.slice(0, dot);
    let given;
    try { given = Buffer.from(token.slice(dot + 1), 'base64url'); } catch { return null; }
    const expected = mac(body);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
    if (!payload || typeof payload.u !== 'string' || !payload.u) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
    return payload;
  }

  const cookieOptions = () => ({ httpOnly: true, secure: !!secure, sameSite: 'lax', path: MEDIA_COOKIE_PATH });

  function setCookie(res, session) {
    res.cookie(MEDIA_COOKIE, sign(session), { ...cookieOptions(), maxAge: ttlMs });
  }

  function clearCookie(res) {
    res.clearCookie(MEDIA_COOKIE, cookieOptions());
  }

  function deny(res) {
    res.statusCode = 401;
    // 401 нельзя кэшировать: после входа картинка должна загрузиться.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Unauthorized');
  }

  function middleware(req, res, next) {
    const payload = verify(req.cookies?.[MEDIA_COOKIE]);
    let ok = false;
    if (payload) {
      try { ok = !!isSessionValid(payload); } catch { ok = false; }
    }
    if (!ok) return deny(res);
    return next();
  }

  return { sign, verify, setCookie, clearCookie, middleware };
}

module.exports = { createMediaAuth, MEDIA_COOKIE, MEDIA_COOKIE_PATH };
