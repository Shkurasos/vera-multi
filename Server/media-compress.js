'use strict';

// Сжатие фото «как в Telegram»: поворот по EXIF, длинная сторона не больше
// MAX_SIDE, перекодирование (JPEG без прозрачности, WebP с прозрачностью),
// метаданные (EXIF/GPS/XMP) не переносятся. GIF и анимированный WebP не
// трогаем: sharp пересобрал бы их в статичную картинку или раздул.
// Результат сохраняется, только если он меньше исходника: уже оптимальные
// маленькие фото лишний раз не теряют качество.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_SIDE = 2560;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 80;
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

let sharpLib;
function loadSharp() {
  if (sharpLib === undefined) {
    try { sharpLib = require('sharp'); } catch { sharpLib = null; }
  }
  return sharpLib;
}

/** Клиент просит оригинал: поле compress=0/false/no/off в multipart. */
function wantsCompression(body) {
  const v = String(body?.compress ?? '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

/**
 * Сжимает буфер изображения. Возвращает { buffer, mime, ext } или null, если
 * сжимать нечего (не тот формат, анимация, результат не меньше исходника).
 */
async function compressImageBuffer(input, mime) {
  const sharp = loadSharp();
  if (!sharp || !COMPRESSIBLE.has(String(mime || '').toLowerCase())) return null;
  const meta = await sharp(input).metadata();
  if ((meta.pages || 1) > 1) return null; // анимированный WebP
  const pipeline = sharp(input)
    .rotate() // применяем EXIF Orientation до того, как EXIF пропадёт
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  // Проверяем фактическую прозрачность, а не наличие канала: PNG-скриншоты
  // часто RGBA с полностью непрозрачной альфой, им подходит JPEG.
  let transparent = false;
  if (meta.hasAlpha) {
    const stats = await sharp(input).stats();
    transparent = !stats.isOpaque;
  }
  const out = transparent
    ? { buffer: await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer(), mime: 'image/webp', ext: '.webp' }
    : { buffer: await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(), mime: 'image/jpeg', ext: '.jpg' };
  return out.buffer.length < input.length ? out : null;
}

/**
 * Сжимает уже сохранённый multer-файл на месте. Обновляет поля req.file
 * (path, filename, size, mimetype, sha256). При любой ошибке файл остаётся
 * как был: загрузка не должна падать из-за сжатия.
 */
async function compressStoredUpload(file, { enabled = true } = {}) {
  if (!enabled || !file?.path) return file;
  try {
    const original = fs.readFileSync(file.path);
    const result = await compressImageBuffer(original, file.mimetype);
    if (!result) return file;
    const dir = path.dirname(file.path);
    const base = path.basename(file.filename || file.path, path.extname(file.filename || file.path));
    const filename = base + result.ext;
    const target = path.join(dir, filename);
    fs.writeFileSync(target, result.buffer);
    if (target !== file.path) { try { fs.unlinkSync(file.path); } catch {} }
    Object.assign(file, {
      path: target,
      filename,
      size: result.buffer.length,
      mimetype: result.mime,
      sha256: crypto.createHash('sha256').update(result.buffer).digest('hex'),
      compressed: true,
    });
  } catch (err) {
    console.warn('[media-compress] оставляем оригинал:', err.message);
  }
  return file;
}

module.exports = { compressImageBuffer, compressStoredUpload, wantsCompression, MAX_SIDE };
