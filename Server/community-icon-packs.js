'use strict';

/**
 * Каталог паков иконок сообщества: выложить свой пак, найти и скачать чужой.
 *
 * Пак — JSON со слотами иконок (другая иконка / текст / растровая картинка
 * data URL'ом). Сами паки лежат файлами в DATA_DIR, а не в /uploads: /uploads
 * раздаётся статикой без авторизации, а в БД многомегабайтные паки раздули бы
 * vera.json. В БД — только карточка каталога с маленьким превью.
 *
 * Правила разбора совпадают с клиентом (Web/src/utils/iconPackFormat.ts).
 * Картинки дополнительно проверяются по сигнатуре и очищаются от метаданных.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stripImageMetadata, imageType } = require('./image-privacy');

const MAX_ITEMS = 300;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;
const MAX_SLOTS = 400;
const MAX_ICON_IMAGE_CHARS = 160000;
const MAX_PACK_CHARS = 4000000;
const PREVIEW_SLOTS = 6;
const MAX_PREVIEW_IMAGE_CHARS = 24000;
const BASE_PACKS = new Set(['filled', 'outlined', 'rounded', 'sharp', 'twoTone', 'relief', 'puffy', 'sticker', 'neon', 'tile']);
const SLOT_RE = /^[A-Za-z0-9]{1,40}$/;
const DATA_URL_RE = /^data:(image\/(?:png|webp|jpeg|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const ID_RE = /^[a-f0-9-]{36}$/;

function ensureCatalog(db) {
  if (!Array.isArray(db.communityIconPacks)) db.communityIconPacks = [];
  return db.communityIconPacks;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Картинка слота: формат по сигнатуре обязан совпасть с заявленным. */
function cleanImage(src) {
  if (typeof src !== 'string' || src.length > MAX_ICON_IMAGE_CHARS) return null;
  const m = DATA_URL_RE.exec(src);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || imageType(buf) !== m[1]) return null;
  try {
    return `data:${m[1]};base64,${stripImageMetadata(buf, m[1]).toString('base64')}`;
  } catch { return null; }
}

function cleanIcon(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'mui') return typeof raw.name === 'string' && SLOT_RE.test(raw.name) ? { kind: 'mui', name: raw.name } : null;
  if (raw.kind === 'text') {
    const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim() : '';
    return text && text.length <= 32 ? { kind: 'text', text } : null;
  }
  if (raw.kind === 'image') {
    const src = cleanImage(raw.src);
    if (!src) return null;
    return raw.tint ? { kind: 'image', src, tint: true } : { kind: 'image', src };
  }
  return null;
}

/** Разбор пака. Битые слоты отбрасываются по одному; null — это не пак. */
function cleanPack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!raw.icons || typeof raw.icons !== 'object' || Array.isArray(raw.icons)) return null;
  const icons = {};
  let size = 0;
  let count = 0;
  for (const [slot, value] of Object.entries(raw.icons)) {
    if (count >= MAX_SLOTS || !SLOT_RE.test(slot)) continue;
    const icon = cleanIcon(value);
    if (!icon) continue;
    size += icon.kind === 'image' ? icon.src.length : 64;
    if (size > MAX_PACK_CHARS) break;
    icons[slot] = icon;
    count++;
  }
  if (!count) return null;
  return {
    format: 'vera-icon-pack', version: 1,
    name: cleanText(raw.name, MAX_NAME) || 'Пак иконок',
    base: BASE_PACKS.has(raw.base) ? raw.base : 'filled',
    icons,
  };
}

/** Несколько лёгких слотов для карточки каталога. */
function previewOf(pack) {
  const out = {};
  for (const [slot, icon] of Object.entries(pack.icons)) {
    if (Object.keys(out).length >= PREVIEW_SLOTS) break;
    if (icon.kind === 'image' && icon.src.length > MAX_PREVIEW_IMAGE_CHARS) continue;
    out[slot] = icon;
  }
  return out;
}

function publicItem(item) {
  return {
    id: item.id, name: item.name, description: item.description, base: item.base,
    authorId: item.authorId, authorName: item.authorName, iconCount: item.iconCount,
    preview: item.preview || {}, downloads: item.downloads || 0, createdAt: item.createdAt,
  };
}

function install({ app, getDb, saveDb, auth, isAdmin, dataDir }) {
  const folder = path.join(dataDir, 'community-icon-packs');
  try { fs.mkdirSync(folder, { recursive: true }); } catch {}
  const fileOf = (id) => path.join(folder, `${id}.json`);
  const find = (id) => (ID_RE.test(String(id)) ? ensureCatalog(getDb()).find((x) => x.id === id) : null);

  app.get('/api/community/icon-packs', auth, (req, res) => {
    const q = cleanText(req.query.q, 80).toLowerCase();
    const items = ensureCatalog(getDb())
      .filter((x) => !q || `${x.name} ${x.description} ${x.authorName}`.toLowerCase().includes(q));
    res.json({ packs: items.slice(-MAX_ITEMS).reverse().map(publicItem) });
  });

  app.post('/api/community/icon-packs', auth, (req, res) => {
    const pack = cleanPack(req.body?.pack);
    if (!pack) return res.status(400).json({ message: 'В паке нет ни одной подходящей иконки' });
    const db = getDb();
    const user = (db.users || []).find((u) => u.id === req.userId) || {};
    const id = crypto.randomUUID();
    const name = cleanText(req.body?.name, MAX_NAME) || pack.name;
    pack.name = name;
    try { fs.writeFileSync(fileOf(id), JSON.stringify(pack)); }
    catch { return res.status(500).json({ message: 'Не удалось сохранить пак' }); }
    const item = {
      id, name, description: cleanText(req.body?.description, MAX_DESCRIPTION), base: pack.base,
      authorId: String(req.userId), authorName: cleanText(user.username || user.firstName, 80) || 'Пользователь',
      iconCount: Object.keys(pack.icons).length, preview: previewOf(pack), downloads: 0,
      createdAt: new Date().toISOString(),
    };
    const catalog = ensureCatalog(db);
    catalog.push(item);
    while (catalog.length > MAX_ITEMS) {
      const old = catalog.shift();
      try { fs.unlinkSync(fileOf(old.id)); } catch {}
    }
    saveDb();
    res.status(201).json({ pack: publicItem(item) });
  });

  // Сам пак: и для установки (?install=1 считает скачивание), и для файла.
  app.get('/api/community/icon-packs/:id', auth, (req, res) => {
    const item = find(req.params.id);
    if (!item) return res.status(404).json({ message: 'Пак не найден' });
    let pack;
    try { pack = JSON.parse(fs.readFileSync(fileOf(item.id), 'utf8')); }
    catch { return res.status(404).json({ message: 'Файл пака потерян' }); }
    if (req.query.install === '1') { item.downloads = Number(item.downloads || 0) + 1; saveDb(); }
    res.json({ item: publicItem(item), pack });
  });

  app.delete('/api/community/icon-packs/:id', auth, (req, res) => {
    const item = find(req.params.id);
    if (!item) return res.status(404).json({ message: 'Пак не найден' });
    if (item.authorId !== String(req.userId) && !isAdmin(req)) return res.status(403).json({ message: 'Нет доступа' });
    const catalog = ensureCatalog(getDb());
    catalog.splice(catalog.indexOf(item), 1);
    try { fs.unlinkSync(fileOf(item.id)); } catch {}
    saveDb();
    res.json({ ok: true });
  });
}

module.exports = { install, cleanPack, cleanIcon, ensureCatalog, MAX_PACK_CHARS };
