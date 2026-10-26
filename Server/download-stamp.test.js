const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const s = require('./download-stamp');

const MAGIC = Buffer.from('APK Sig Block 42', 'ascii');

/** Minimal "APK": a zip with a v2-style signing block (pairs + magic) and an EOCD. */
function fakeApk({ padding = false } = {}) {
  const content = Buffer.from('PK\x03\x04-fake-entries-');
  const pairs = [];
  const sig = Buffer.alloc(12 + 5);
  sig.writeBigUInt64LE(9n, 0); sig.writeUInt32LE(0x7109871a, 8); sig.write('SIGNS', 12);
  pairs.push(sig);
  if (padding) {
    const pad = Buffer.alloc(12 + 100);
    pad.writeBigUInt64LE(104n, 0); pad.writeUInt32LE(0x42726577, 8);
    pairs.push(pad);
  }
  const body = Buffer.concat(pairs);
  const size = BigInt(body.length + 24);
  const head = Buffer.alloc(8); head.writeBigUInt64LE(size);
  const tail = Buffer.alloc(24); tail.writeBigUInt64LE(size); MAGIC.copy(tail, 8);
  const block = Buffer.concat([head, body, tail]);
  const cd = Buffer.from('PK\x01\x02-central-dir-');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(content.length + block.length, 16);
  return { apk: Buffer.concat([content, block, cd, eocd]), content, cd, blockStart: content.length };
}

test('normalizeServerUrl keeps only an http(s) origin', () => {
  assert.equal(s.normalizeServerUrl('https://abc.trycloudflare.com/x?y#z'), 'https://abc.trycloudflare.com');
  assert.equal(s.normalizeServerUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(s.normalizeServerUrl('javascript:alert(1)'), null);
  assert.equal(s.normalizeServerUrl('file:///C:/x'), null);
  assert.equal(s.normalizeServerUrl('https://user:pw@evil.com'), null);
  assert.equal(s.normalizeServerUrl(''), null);
  assert.equal(s.normalizeServerUrl('https://' + 'a'.repeat(400) + '.com'), null);
});

test('publicOrigin: Host, X-Forwarded-*, cf-visitor, APP_SERVER_URL', () => {
  const prev = process.env.APP_SERVER_URL;
  delete process.env.APP_SERVER_URL;
  try {
    assert.equal(s.publicOrigin({ protocol: 'http', headers: { host: 'localhost:3000' } }), 'http://localhost:3000');
    assert.equal(s.publicOrigin({ protocol: 'http', headers: { host: 'abc.trycloudflare.com', 'x-forwarded-proto': 'https' } }),
      'https://abc.trycloudflare.com');
    assert.equal(s.publicOrigin({ protocol: 'http', headers: { host: 'abc.trycloudflare.com', 'cf-visitor': '{"scheme":"https"}' } }),
      'https://abc.trycloudflare.com');
    assert.equal(s.publicOrigin({ protocol: 'http', headers: { host: 'evil.com/"><script>' } }), null);
    process.env.APP_SERVER_URL = 'https://vera.example.com/';
    assert.equal(s.publicOrigin({ protocol: 'http', headers: { host: 'localhost:3000' } }), 'https://vera.example.com');
  } finally {
    if (prev === undefined) delete process.env.APP_SERVER_URL; else process.env.APP_SERVER_URL = prev;
  }
});

test('stampApk embeds the address without touching signed regions', () => {
  const { apk, content, cd } = fakeApk();
  const out = s.stampApk(apk, 'https://abc.trycloudflare.com');
  assert.equal(s.readApkStamp(out), 'https://abc.trycloudflare.com');
  // The signed regions (zip entries and the central directory) are unchanged.
  assert.ok(out.subarray(0, content.length).equals(content));
  assert.ok(out.includes(cd));
  assert.ok(out.includes(Buffer.from('SIGNS')));
  // Re-stamping replaces rather than duplicates.
  const again = s.stampApk(out, 'http://localhost:3000');
  assert.equal(s.readApkStamp(again), 'http://localhost:3000');
  assert.equal(again.length, out.length - 'https://abc.trycloudflare.com'.length + 'http://localhost:3000'.length);
  assert.equal(s.readApkStamp(apk), null);
});

test('stampApk keeps 4096 alignment when the block had padding', () => {
  const { apk, blockStart } = fakeApk({ padding: true });
  const out = s.stampApk(apk, 'https://abc.trycloudflare.com');
  const eocd = out.length - 22;
  const cdOffset = out.readUInt32LE(eocd + 16);
  assert.equal((cdOffset - blockStart) % 4096, 0);
  assert.equal(s.readApkStamp(out), 'https://abc.trycloudflare.com');
});

test('stampApk rejects files without a signing block and bad URLs', () => {
  assert.throws(() => s.stampApk(Buffer.from('not a zip at all, definitely'), 'https://a.com'));
  assert.throws(() => s.stampApk(fakeApk().apk, 'javascript:1'));
});

test('exe trailer is 1024 bytes and readable', () => {
  const t = s.exeTrailer('https://abc.trycloudflare.com/path');
  assert.equal(t.length, s.EXE_TRAILER_SIZE);
  assert.ok(t.toString('ascii').startsWith('VERASRV1 https://abc.trycloudflare.com\n'));
  assert.equal(s.readExeStamp(Buffer.concat([Buffer.alloc(5000, 1), t])), 'https://abc.trycloudflare.com');
  assert.equal(s.readExeStamp(Buffer.alloc(5000, 1)), null);
});


function get(port, file, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: `/downloads/${file}`, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('middleware serves apk/exe with the address the site was opened from', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-dl-'));
  const exe = Buffer.alloc(3000, 7);
  fs.writeFileSync(path.join(dir, 'Vera-Setup-Windows.exe'), exe);
  fs.writeFileSync(path.join(dir, 'Vera-Android.apk'), fakeApk().apk);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
  const app = express();
  app.use('/downloads', s.createDownloadStamper({ dir, log: { warn() {} } }));
  app.use('/downloads', express.static(dir));
  const server = app.listen(0);
  const { port } = server.address();
  const prev = process.env.APP_SERVER_URL;
  delete process.env.APP_SERVER_URL;
  try {
    const tunnel = { host: 'abc.trycloudflare.com', 'x-forwarded-proto': 'https' };
    const a = await get(port, 'Vera-Android.apk', tunnel);
    assert.equal(a.res.statusCode, 200);
    assert.equal(a.res.headers['cache-control'], 'no-store');
    assert.equal(a.res.headers['content-type'], 'application/vnd.android.package-archive');
    assert.equal(s.readApkStamp(a.body), 'https://abc.trycloudflare.com');

    const e = await get(port, 'Vera-Setup-Windows.exe', tunnel);
    assert.equal(e.body.length, exe.length + s.EXE_TRAILER_SIZE);
    assert.equal(Number(e.res.headers['content-length']), e.body.length);
    assert.ok(e.body.subarray(0, exe.length).equals(exe));
    assert.equal(s.readExeStamp(e.body), 'https://abc.trycloudflare.com');

    const local = await get(port, 'Vera-Setup-Windows.exe');
    assert.equal(s.readExeStamp(local.body), `http://localhost:${port}`);

    const txt = await get(port, 'notes.txt');
    assert.equal(txt.body.toString(), 'hi');
    assert.equal((await get(port, '..%2Fsecret.exe')).res.statusCode, 404);
  } finally {
    if (prev !== undefined) process.env.APP_SERVER_URL = prev;
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
