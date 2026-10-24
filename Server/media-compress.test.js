const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { compressImageBuffer, compressStoredUpload, wantsCompression, MAX_SIDE } = require('./media-compress');

// Шумная картинка: на однотонной заливке любой кодек выигрывает, тест был бы нечестным.
async function noisyJpeg(width, height, withExif = true) {
  const raw = crypto.randomBytes(width * height * 3);
  let img = sharp(raw, { raw: { width, height, channels: 3 } });
  if (withExif) img = img.withExif({ IFD0: { Make: 'VeraTestCam' }, IFD3: { GPSLatitudeRef: 'N' } }).withMetadata({ orientation: 6 });
  return img.jpeg({ quality: 100 }).toBuffer();
}

function tmpUpload(buf, name, mimetype) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-compress-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return { dir, file: { path: file, filename: name, mimetype, size: buf.length } };
}

test('большое фото уменьшается по длинной стороне и становится легче', async () => {
  const input = await noisyJpeg(3200, 1800);
  const out = await compressImageBuffer(input, 'image/jpeg');
  assert.ok(out, 'фото должно сжаться');
  assert.ok(out.buffer.length < input.length);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(Math.max(meta.width, meta.height), MAX_SIDE);
  assert.equal(out.mime, 'image/jpeg');
});

test('EXIF и GPS удаляются, ориентация применяется к пикселям', async () => {
  const input = await noisyJpeg(1200, 800);
  assert.ok((await sharp(input).metadata()).exif, 'в исходнике есть EXIF');
  assert.ok(input.includes(Buffer.from('VeraTestCam')), 'в исходнике есть маркер камеры');
  const out = await compressImageBuffer(input, 'image/jpeg');
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.exif, undefined);
  assert.ok(!out.buffer.includes(Buffer.from('VeraTestCam')));
  // Orientation=6 (поворот на 90°): картинка становится портретной.
  assert.deepEqual([meta.width, meta.height], [800, 1200]);
});

test('PNG с прозрачностью сохраняет альфу (WebP), непрозрачный PNG уходит в JPEG', async () => {
  const w = 600, h = 400;
  const rgba = crypto.randomBytes(w * h * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = i % 8 === 3 ? 0 : 255;
  const transparentPng = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const t = await compressImageBuffer(transparentPng, 'image/png');
  assert.equal(t.mime, 'image/webp');
  assert.ok((await sharp(t.buffer).metadata()).hasAlpha);

  const opaque = Buffer.from(rgba); for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
  const opaquePng = await sharp(opaque, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const o = await compressImageBuffer(opaquePng, 'image/png');
  assert.equal(o.mime, 'image/jpeg');
});

test('GIF, анимации и не-картинки не трогаются', async () => {
  const gif = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#f00' } }).gif().toBuffer();
  assert.equal(await compressImageBuffer(gif, 'image/gif'), null);
  const frames = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#0f0' } }).webp().toBuffer();
  const animated = await sharp(frames, { animated: true }).webp().toBuffer();
  const animatedMultiPage = await sharp(animated).metadata();
  if ((animatedMultiPage.pages || 1) > 1) assert.equal(await compressImageBuffer(animated, 'image/webp'), null);
  assert.equal(await compressImageBuffer(Buffer.from('%PDF-1.7 hello'), 'application/pdf'), null);
});

test('уже маленькое фото не перекодируется, если выигрыша нет', async () => {
  const tiny = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#123456' } }).jpeg({ quality: 40 }).toBuffer();
  assert.equal(await compressImageBuffer(tiny, 'image/jpeg'), null);
});

test('compressStoredUpload переписывает файл на месте и обновляет метаданные', async () => {
  const input = await noisyJpeg(3000, 2000);
  const { dir, file } = tmpUpload(input, 'abc.png', 'image/jpeg');
  try {
    await compressStoredUpload(file);
    assert.equal(file.compressed, true);
    assert.equal(file.filename, 'abc.jpg');
    assert.ok(fs.existsSync(file.path));
    assert.ok(!fs.existsSync(path.join(dir, 'abc.png')), 'старый файл удалён');
    assert.equal(fs.statSync(file.path).size, file.size);
    assert.ok(file.size < input.length);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('режим «без сжатия» и битые файлы оставляют оригинал байт в байт', async () => {
  const input = await noisyJpeg(3000, 2000, false);
  const a = tmpUpload(input, 'orig.jpg', 'image/jpeg');
  const b = tmpUpload(Buffer.from([0xff, 0xd8, 1, 2, 3]), 'bad.jpg', 'image/jpeg');
  try {
    await compressStoredUpload(a.file, { enabled: false });
    assert.ok(fs.readFileSync(a.file.path).equals(input));
    assert.equal(a.file.compressed, undefined);
    await compressStoredUpload(b.file);
    assert.ok(fs.readFileSync(b.file.path).equals(Buffer.from([0xff, 0xd8, 1, 2, 3])));
  } finally {
    fs.rmSync(a.dir, { recursive: true, force: true });
    fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

test('wantsCompression: по умолчанию сжимаем, compress=0/false — оригинал', () => {
  assert.equal(wantsCompression(undefined), true);
  assert.equal(wantsCompression({}), true);
  assert.equal(wantsCompression({ compress: '1' }), true);
  for (const v of ['0', 'false', 'FALSE', 'no', 'off']) assert.equal(wantsCompression({ compress: v }), false, v);
});
