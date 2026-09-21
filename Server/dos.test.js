const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function setup() {
  let now = 1000;
  const context = vm.createContext({ Date: { now: () => now }, Map, Math,
    setInterval: () => ({ unref() {} }) });
  vm.runInContext(source.slice(source.indexOf('function makeRateLimit('), source.indexOf('const authLimiter')), context);
  return { make: context.makeRateLimit, advance: () => { now += 60001; } };
}
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}
test('HTTP limiter isolates IPs, returns retry delay and resets', () => {
  const c = setup(); const limit = c.make({ windowMs: 60000, max: 2 });
  let accepted = 0;
  const run = ip => { const res = response(); limit({ ip }, res, () => accepted++); return res; };
  run('a'); run('a');
  assert.equal(run('a').statusCode, 429);
  assert.equal(run('a').headers['Retry-After'], 60);
  assert.equal(run('b').statusCode, 200);
  c.advance(); assert.equal(run('a').statusCode, 200);
  assert.equal(accepted, 4);
});
test('limiter bounds unique keys without evicting existing quotas', () => {
  const limit = setup().make({ windowMs: 60000, max: 1 });
  for (let i = 0; i < 10000; i++) limit({ ip: String(i) }, response(), () => {});
  const overflow = response(); limit({ ip: 'new' }, overflow, () => assert.fail());
  assert.equal(overflow.statusCode, 503);
  const existing = response(); limit({ ip: '0' }, existing, () => assert.fail());
  assert.equal(existing.statusCode, 429);
});
test('early flood protection and disabled imports precede body parsing', () => {
  const parser = source.indexOf("app.use(express.json(");
  assert.ok(source.indexOf('app.use(makeRateLimit(') < parser);
  assert.ok(source.indexOf("res.status(503).json({ message: 'Импорт") < parser);
  assert.ok(source.includes("!req.is('multipart/form-data')"));
});