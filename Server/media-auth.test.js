const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMediaAuth, MEDIA_COOKIE } = require('./media-auth');

const SECRET = 'x'.repeat(48);

function make(valid = () => true) {
  return createMediaAuth({ secret: SECRET, ttlMs: 60_000, secure: false, isSessionValid: valid });
}

function run(auth, cookies) {
  const res = { statusCode: 200, headers: {}, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() { this.ended = true; } };
  let passed = false;
  auth.middleware({ cookies }, res, () => { passed = true; });
  return { passed, res };
}

test('без cookie /uploads отвечает 401 и не кэшируется', () => {
  const { passed, res } = run(make(), {});
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('подписанная cookie живой сессии пропускает к файлу', () => {
  const auth = make();
  const token = auth.sign({ userId: 'u1', deviceId: 'd1', tv: 0, dv: 0 });
  assert.equal(run(auth, { [MEDIA_COOKIE]: token }).passed, true);
});

test('подделанная, чужая или просроченная cookie отклоняется', () => {
  const auth = make();
  const token = auth.sign({ userId: 'u1', deviceId: 'd1', tv: 0, dv: 0 });
  const [body, sig] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ u: 'admin', d: null, tv: 0, dv: 0, exp: Date.now() + 1e6 })).toString('base64url');
  for (const bad of [`${forgedBody}.${sig}`, `${body}.${sig.slice(0, -2)}AA`, `${body}`, 'garbage', '']) {
    assert.equal(run(auth, { [MEDIA_COOKIE]: bad }).passed, false, bad);
  }
  // Другой секрет — другая подпись.
  const other = createMediaAuth({ secret: 'y'.repeat(48), ttlMs: 60_000, isSessionValid: () => true });
  assert.equal(run(auth, { [MEDIA_COOKIE]: other.sign({ userId: 'u1' }) }).passed, false);
  // Просрочка.
  const old = auth.sign({ userId: 'u1' }, Date.now() - 120_000);
  assert.equal(auth.verify(old), null);
});

test('отозванная сессия (logout/отвязка/бан) закрывает доступ к файлам', () => {
  let alive = true;
  const auth = make(() => alive);
  const token = auth.sign({ userId: 'u1', deviceId: 'd1', tv: 0, dv: 0 });
  assert.equal(run(auth, { [MEDIA_COOKIE]: token }).passed, true);
  alive = false;
  assert.equal(run(auth, { [MEDIA_COOKIE]: token }).passed, false);
});

test('cookie HttpOnly и ограничена путём /uploads', () => {
  const auth = make();
  const set = [];
  auth.setCookie({ cookie: (name, value, opts) => set.push({ name, value, opts }) }, { userId: 'u1' });
  assert.equal(set[0].name, MEDIA_COOKIE);
  assert.equal(set[0].opts.httpOnly, true);
  assert.equal(set[0].opts.path, '/uploads');
});

test('server.js ставит проверку cookie перед раздачей /uploads и выдаёт cookie при входе', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const guard = source.indexOf("app.use('/uploads', mediaAuth.middleware)");
  const serve = source.indexOf("app.use('/uploads', express.static(");
  assert.ok(guard > 0 && serve > guard, 'middleware должен стоять до express.static');
  // Все места выдачи сессии передают пользователя — иначе cookie не появится.
  const calls = source.match(/setAuthCookies\(res, [^)]*\)/g) || [];
  assert.ok(calls.length >= 4);
  for (const call of calls) assert.match(call, /setAuthCookies\(res, \w+, \w+, [\w.]+\)/, call);
});
