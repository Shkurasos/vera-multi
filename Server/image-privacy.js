'use strict';

// Container-level removal: compressed pixel data is preserved. Unknown image
// formats are rejected rather than published with unexamined metadata.
const IMAGE_EXT = /\.(?:png|jpe?g|jfif|gif|webp|avif|heic|heif|tiff?|bmp|svg|dng|cr2|nef|arw)$/i;
function imageType(b) {
  if (b[0] === 255 && b[1] === 216) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (/^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) return 'image/gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}
function invalid() { throw new Error('Изображение повреждено или его формат не поддерживает безопасную очистку. Используйте JPEG, PNG, GIF или WebP.'); }
function stripImageMetadata(b, mime = '', name = '') {
  const type = imageType(b);
  if (!type) {
    const header = b.toString('hex', 0, 4);
    if (/^image\//i.test(mime) || IMAGE_EXT.test(name) || ['49492a00', '4d4d002a'].includes(header) || b.toString('ascii', 4, 8) === 'ftyp' && /avif|heic|heif|mif1/.test(b.toString('ascii', 8, 32))) invalid();
    return b;
  }
  const parts = [];
  if (type === 'image/jpeg') {
    parts.push(b.subarray(0, 2));
    let p = 2, hasScan = false;
    while (p < b.length) {
      const start = p;
      if (b[p++] !== 255) invalid();
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 0xd9) { if (!hasScan) invalid(); parts.push(Buffer.from([255, 217])); return Buffer.concat(parts); }
      if (marker === undefined || marker === 0 || marker === 0xd8) invalid();
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) { parts.push(b.subarray(start, p)); continue; }
      if (p + 2 > b.length) invalid();
      const length = b.readUInt16BE(p);
      if (length < 2 || p + length > b.length) invalid();
      // Drop ALL application segments and comments (EXIF/XMP/IPTC/vendor data).
      if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(b.subarray(start, p + length));
      p += length;
      if (marker === 0xda) {
        hasScan = true;
        const scan = p;
        while (p < b.length) {
          if (b[p] !== 255) { p++; continue; }
          let q = p + 1;
          while (b[q] === 255) q++;
          if (b[q] === 0 || b[q] >= 0xd0 && b[q] <= 0xd7) { p = q + 1; continue; }
          break;
        }
        parts.push(b.subarray(scan, p));
      }
    }
    invalid();
  }
  if (type === 'image/png') {
    parts.push(b.subarray(0, 8));
    let p = 8, hasHeader = false, hasData = false;
    const keep = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'acTL', 'fcTL', 'fdAT']);
    while (p + 12 <= b.length) {
      const n = b.readUInt32BE(p), tag = b.toString('ascii', p + 4, p + 8);
      if (p + n + 12 > b.length) invalid();
      if (!hasHeader && (tag !== 'IHDR' || n !== 13)) invalid();
      if (tag === 'IHDR') {
        if (hasHeader || n !== 13 || !b.readUInt32BE(p + 8) || !b.readUInt32BE(p + 12)) invalid();
        hasHeader = true;
      }
      if (tag === 'IDAT') hasData = true;
      if (tag === 'IEND' && (n !== 0 || !hasData)) invalid();
      if (keep.has(tag)) parts.push(b.subarray(p, p + n + 12));
      p += n + 12;
      if (tag === 'IEND') return Buffer.concat(parts);
    }
    invalid();
  }
  if (type === 'image/webp') {
    parts.push(Buffer.from(b.subarray(0, 12)));
    let p = 12, hasData = false;
    const end = b.readUInt32LE(4) + 8;
    if (end < 12 || end > b.length) invalid();
    while (p + 8 <= end) {
      const tag = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4), next = p + 8 + n + (n & 1);
      if (next > end) invalid();
      if (['VP8 ', 'VP8L', 'ANMF'].includes(tag)) { if (!n) invalid(); hasData = true; }
      if (['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF'].includes(tag)) {
        const chunk = Buffer.from(b.subarray(p, next));
        if (tag === 'VP8X') { if (n !== 10) invalid(); chunk[8] &= ~0x2c; }
        parts.push(chunk);
      }
      p = next;
    }
    if (p !== end || !hasData) invalid();
    const out = Buffer.concat(parts); out.writeUInt32LE(out.length - 8, 4); return out;
  }
  // Preserve frames, graphics control and the standard animation loop only.
  let p = 13, hasFrame = false;
  if (b.length < p) invalid();
  if (b[10] & 128) p += 3 * (1 << ((b[10] & 7) + 1));
  if (p > b.length) invalid();
  parts.push(b.subarray(0, p));
  function subblocks() {
    while (p < b.length) {
      const n = b[p++]; if (!n) return;
      p += n; if (p > b.length) invalid();
    }
    invalid();
  }
  while (p < b.length) {
    const start = p, tag = b[p++];
    if (tag === 0x3b) { if (!hasFrame) invalid(); parts.push(b.subarray(start, p)); return Buffer.concat(parts); }
    if (tag === 0x2c) {
      hasFrame = true;
      if (p + 9 > b.length) invalid();
      const packed = b[p + 8]; p += 9;
      if (packed & 128) p += 3 * (1 << ((packed & 7) + 1));
      p++; subblocks(); parts.push(b.subarray(start, p));
    } else if (tag === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && (b[p] !== 4 || b[p + 5] !== 0)) invalid();
      const loop = label === 255 && b[p] === 11 && b.toString('ascii', p + 1, p + 12) === 'NETSCAPE2.0' && b[p + 12] === 3 && b[p + 13] === 1 && b[p + 16] === 0;
      subblocks();
      if (label === 0xf9 || loop) parts.push(b.subarray(start, p));
    } else invalid();
  }
  invalid();
}
module.exports = { stripImageMetadata, imageType };