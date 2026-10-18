'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { stripImageMetadata } = require('./image-privacy');
const loadPrivacy = require('./privacy-test-context');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=', 'base64');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function chunk(tag, data, little = false) {
  const head = Buffer.alloc(8);
  if (little) { head.write(tag); head.writeUInt32LE(data.length, 4); }
  else { head.writeUInt32BE(data.length); head.write(tag, 4); }
  return Buffer.concat([head, data, Buffer.alloc(little ? data.length & 1 : 4)]);
}

test('PNG removes text, EXIF and unknown chunks without changing pixel chunks', () => {
  const dirty = Buffer.concat([png.subarray(0, 33), ...['tEXt', 'iTXt', 'eXIf', 'vpAg'].map(tag => chunk(tag, Buffer.from('private GPS'))), png.subarray(33)]);
  assert.deepEqual(stripImageMetadata(dirty), png);
});

test('JPEG removes application segments and comments before and after scans', () => {
  const scan = Buffer.from([255, 218, 0, 2, 1, 2, 255, 0, 3]);
  const clean = Buffer.concat([Buffer.from([255, 216]), scan, Buffer.from([255, 217])]);
  const metadata = marker => Buffer.from([255, marker, 0, 5, 71, 80, 83]);
  const dirty = Buffer.concat([clean.subarray(0, 2), metadata(225), metadata(237), scan, metadata(254), clean.subarray(-2), Buffer.from('private trailer')]);
  assert.deepEqual(stripImageMetadata(dirty), clean);
});

test('WebP removes metadata and repairs RIFF length and feature flags', () => {
  const header = Buffer.from('RIFF\0\0\0\0WEBP', 'ascii');
  const flags = Buffer.alloc(10); flags[0] = 0x2c;
  const pixel = chunk('VP8L', Buffer.from([47, 0, 0, 0, 0]), true);
  const dirty = Buffer.concat([header, chunk('VP8X', flags, true), chunk('EXIF', Buffer.from('GPS'), true), chunk('XMP ', Buffer.from('private'), true), pixel]);
  dirty.writeUInt32LE(dirty.length - 8, 4);
  const clean = stripImageMetadata(dirty);
  assert.equal(clean.readUInt32LE(4), clean.length - 8);
  assert.equal(clean[20], 0);
  assert.ok(clean.subarray(-pixel.length).equals(pixel));
  assert.ok(!clean.includes(Buffer.from('GPS')));
});

test('GIF removes comments and private applications while preserving frames and looping', () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const loop = Buffer.from([33, 255, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0]);
  const dirty = Buffer.concat([gif.subarray(0, 19), loop, Buffer.from([33, 254, 3, 71, 80, 83, 0]), gif.subarray(19)]);
  assert.deepEqual(stripImageMetadata(dirty), Buffer.concat([gif.subarray(0, 19), loop, gif.subarray(19)]));
});

test('truncated, empty and unsupported image containers are rejected', () => {
  for (const bytes of [png.subarray(0, 8), png.subarray(0, -1), Buffer.from([255,216,255,217]), Buffer.from('RIFF\x04\0\0\0WEBP', 'ascii'), Buffer.from('GIF89a\0\0\0\0\0\0\0;', 'ascii')]) {
    assert.throws(() => stripImageMetadata(bytes, 'image/png'));
  }
  for (const name of ['x.avif', 'x.heic', 'x.tiff', 'x.bmp', 'x.svg', 'x.dng']) assert.throws(() => stripImageMetadata(Buffer.from('unknown'), '', name));
  assert.deepEqual(stripImageMetadata(Buffer.from('document'), 'text/plain', 'x.txt'), Buffer.from('document'));
});

test('data URLs require canonical base64 and recursively sanitize profile images and hashes', () => {
  const ctx = loadPrivacy({});
  for (const data of ['data:image/png;base64,AAAA', 'data:audio/mpeg;base64,YQ=', 'data:audio/mpeg;base64,YR==', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:video/mp4;base64,====']) assert.equal(ctx.sanitizeImageDataUrl(data), '');
  const dirty = Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.from('private')), png.subarray(33)]);
  const store = { bannerUrl: `data:image/png;base64,${dirty.toString('base64')}`, nested: [{ aboutMediaUrl: 'data:image/png;base64,AAAA' }] };
  ctx.sanitizeProfileMediaStore(store);
  assert.equal(store.bannerUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(store.bannerUrlSha256, hash(png));
  assert.equal(store.nested[0].aboutMediaUrl, '');
  assert.equal(store.nested[0].aboutMediaUrlSha256, null);
});

test('stored bytes are sanitized before measuring and hashing; traversal never reads files', () => {
  const ctx = loadPrivacy({});
  const dirty = Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.from('private')), png.subarray(33)]);
  let stored = dirty, reads = 0;
  ctx.fs = { readFileSync() { reads++; return stored; }, writeFileSync(_path, bytes) { stored = bytes; } };
  const info = ctx.sanitizeStoredImage('photo.png', 'image/png');
  assert.equal(info.sha256, hash(png));
  assert.equal(info.size, png.length);
  assert.deepEqual(stored, png);
  for (const fileUrl of ['/uploads/../secret', '/uploads/%2e%2e/secret', '/uploads/..\\secret', '//uploads/file']) assert.equal(ctx.attachmentIntegrityHash({ fileUrl }), null);
  assert.equal(reads, 1);
  assert.equal(ctx.attachmentIntegrityHash({ fileUrl: '/uploads/files/photo.png' }), hash(png));
});

test('message integrity covers immutable identity, content, references, poll and attachments', () => {
  const ctx = loadPrivacy({});
  const message = { id: 'm', chatId: 'c', senderId: 'u', text: 'hello', createdAt: '2026-01-01', attachments: [{ id: 'a', sha256: hash(png) }], poll: { question: 'Q', multiple: false, options: [{ id: 'o', text: 'A' }] } };
  const initial = ctx.messageIntegrityHash(message);
  assert.match(initial, /^[a-f0-9]{64}$/);
  for (const field of ['id', 'chatId', 'senderId', 'text', 'replyToId', 'forwardFromId', 'createdAt']) assert.notEqual(ctx.messageIntegrityHash({ ...message, [field]: 'changed' }), initial);
  assert.notEqual(ctx.messageIntegrityHash({ ...message, attachments: [{ id: 'a', sha256: 'changed' }] }), initial);
  assert.notEqual(ctx.messageIntegrityHash({ ...message, poll: { ...message.poll, question: 'changed' } }), initial);
  assert.equal(ctx.messageIntegrityHash({ ...message, readBy: ['viewer'], integrityHash: 'ignored' }), initial);
});