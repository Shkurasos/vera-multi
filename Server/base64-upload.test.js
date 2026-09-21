const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function upload(body) {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/files/upload-base64'");
  const end = source.indexOf('// ─── MUSIC routes', start);
  let handler;
  const writes = [];
  vm.runInNewContext(source.slice(start, end), {
    app: { post: (_path, _auth, callback) => { handler = callback; } },
    authMiddleware() {}, Buffer, path, uuidv4: () => 'generated-id',
    UPLOADS_DIR: path.join(__dirname, 'unused-test-path'),
    fs: { writeFileSync: (...args) => writes.push(args) },
  });
  const result = { status: 200, writes };
  const response = {
    status(code) { result.status = code; return this; },
    json(data) { result.body = data; return this; },
  };
  handler({ body }, response);
  return result;
}

test('base64 upload rejects objects, SVG, spoofed MIME, oversized and malformed data', () => {
  for (const data of [{}, 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,aGVsbG8=', 'data:image/png;base64,=AAAA',
    'a'.repeat(8 * 1024 * 1024 + 1)]) {
    const result = upload({ data, mimeType: 'image/png' });
    assert.equal(result.status, 400);
    assert.equal(result.writes.length, 0);
  }
});

test('base64 image receives a server-generated path, never a client MIME extension', () => {
  const data = 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  const result = upload({ data, mimeType: '../../evil', fileName: '../../evil.html' });
  assert.equal(result.status, 200);
  assert.equal(result.body.url, '/uploads/avatars/generated-id.png');
  assert.equal(result.body.mimeType, 'image/png');
  assert.equal(result.writes.length, 1);
});