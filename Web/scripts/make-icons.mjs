import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Иконки VERA в стиле знака ВП: скруглённый квадрат #EFEFEF + осколки #2B2B2B.
// Геометрия 1-в-1 со Web/src/components/VpIcon.tsx. Запуск: node scripts/make-icons.mjs

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const app = join(web, '..', 'App');
const RECT = { x: 2, y: 2, w: 60, h: 60, r: 12 };
const SHARDS = [
  [[6, 9], [39, 9], [21, 31], [45, 40], [34, 58]],
  [[47, 9], [60.5, 9], [52, 29]],
];

function inPoly(px, py, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRect(px, py, q) {
  const { x, y, w, h, r } = q;
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// RGBA-рендер со суперсэмплингом 4×4 (оба цвета серые — один канал).
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = 64 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      let sum = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = (x + (sx + 0.5) / 4) * s;
          const py = (y + (sy + 0.5) / 4) * s;
          if (!inRect(px, py, RECT)) continue;
          sum += SHARDS.some((p) => inPoly(px, py, p)) ? 0x2b : 0xef;
          n++;
        }
      }
      if (!n) continue;
      const i = (y * size + x) * 4;
      const v = Math.round(sum / n);
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = Math.round((n / 16) * 255);
    }
  }
  return buf;
}

const T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO: 32bpp BMP-записи (BITMAPINFOHEADER + XOR bottom-up + AND-маска).
function bmp(n, rgba) {
  const xorLen = n * n * 4;
  const andStride = ((n + 31) >> 5) << 2;
  const h = Buffer.alloc(40);
  h.writeUInt32LE(40);
  h.writeInt32LE(n, 4);
  h.writeInt32LE(n * 2, 8);
  h.writeUInt16LE(1, 12);
  h.writeUInt16LE(32, 14);
  h.writeUInt32LE(xorLen + andStride * n, 20);
  const xor = Buffer.alloc(xorLen);
  const and = Buffer.alloc(andStride * n);
  for (let y = 0; y < n; y++) {
    const src = y * n * 4;
    const dst = (n - 1 - y) * n * 4;
    for (let x = 0; x < n; x++) {
      const s = src + x * 4;
      const d = dst + x * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
    const aDst = (n - 1 - y) * andStride;
    for (let x = 0; x < n; x++) if (rgba[src + x * 4 + 3] < 128) and[aDst + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return Buffer.concat([h, xor, and]);
}

function ico(sizes) {
  const parts = sizes.map((n) => ({ n, data: bmp(n, render(n)) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(parts.length, 4);
  let off = 6 + parts.length * 16;
  const dirs = [];
  const datas = [];
  for (const { n, data } of parts) {
    const d = Buffer.alloc(16);
    d[0] = n >= 256 ? 0 : n;
    d[1] = n >= 256 ? 0 : n;
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(data.length, 8);
    d.writeUInt32LE(off, 12);
    dirs.push(d);
    datas.push(data);
    off += data.length;
  }
  return Buffer.concat([head, ...dirs, ...datas]);
}

const write = (p, b) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, b);
  console.log(`${p} — ${b.length} B`);
};

for (const [f, n] of [
  ['public/icons/apple-touch-icon.png', 180],
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/vera-icon.png', 192], // уведомления (notifications.ts)
]) write(join(web, f), png(n, render(n)));

// Десктоп-приложение: electron-builder по умолчанию берёт build/icon.ico.
write(join(app, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
write(join(app, 'build', 'icon.png'), png(512, render(512)));

// Классический фавикон для браузеров, которые не берут SVG.
write(join(web, 'public', 'favicon.ico'), ico([16, 32, 48]));
