/* ─── Vera File Cache ───────────────────────────────────────────────────────
 * Кэширует бинарные файлы (аватарки, обложки треков, аудиофайлы) как blobs
 * в IndexedDB. Позволяет показывать аватары и проигрывать музыку офлайн.
 *
 * Схема хранения (стор `file_cache` в VeraOffline):
 *   key: string  — исходный URL или пользовательский ключ (userId, trackId)
 *   value: { id, key, url, mimeType, size, blob, _updatedAt }
 *     blob хранится как ArrayBuffer (в IndexedDB можно класть Blobs напрямую,
 *     но ArrayBuffer надёжнее между сессиями WebView).
 */

import { offlineSet, offlineGet, offlineGetAll, offlineDelete, offlineClear } from './offlineDb';

const FILE_CACHE_STORE = 'file_cache';
const MAX_CACHE_ITEMS = 200;   // жёсткий лимит записей (защита от квоты IndexedDB)
const MAX_CACHE_SIZE_MB = 200; // мягкий лимит по размеру

/** Уникальный ключ для файла. Если передан url — ключ = url. */
function normalizeKey(urlOrKey: string): string {
  return urlOrKey;
}

/** Сохранить файл в кэш. Принимает Blob и исходный URL/ключ. */
export async function cacheFile(
  key: string,
  blob: Blob,
  originalUrl?: string,
): Promise<void> {
  const arrayBuffer = await blob.arrayBuffer();
  await offlineSet(FILE_CACHE_STORE, key, {
    id: key,
    key,
    url: originalUrl || key,
    mimeType: blob.type,
    size: blob.size,
    blob: arrayBuffer,
    _updatedAt: Date.now(),
  });
  await enforceLimits();
}

/** Получить закэшированный файл как Blob (или null). */
export async function getCachedFile(key: string): Promise<Blob | null> {
  const entry = await offlineGet(FILE_CACHE_STORE, key);
  if (!entry || !entry.blob) return null;
  return new Blob([entry.blob], { type: entry.mimeType || 'application/octet-stream' });
}

/** Получить закэшированный файл как blob: URL (для <img src>, <audio src>). */
export async function getCachedFileUrl(key: string): Promise<string | null> {
  const blob = await getCachedFile(key);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

/** Проверить, есть ли файл в кэше. */
export async function hasCachedFile(key: string): Promise<boolean> {
  const entry = await offlineGet(FILE_CACHE_STORE, key);
  return Boolean(entry && entry.blob);
}

/** Удалить файл из кэша. */
export async function removeCachedFile(key: string): Promise<void> {
  await offlineDelete(FILE_CACHE_STORE, key);
}

/** Очистить весь файловый кэш. */
export async function clearFileCache(): Promise<void> {
  await offlineClear(FILE_CACHE_STORE);
}

/** Скачать файл по URL и положить в кэш. Возвращает ключ. */
export async function fetchAndCache(
  url: string,
  key?: string,
): Promise<string> {
  const cacheKey = key || url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} failed: ${response.status}`);
  const blob = await response.blob();
  await cacheFile(cacheKey, blob, url);
  return cacheKey;
}

/** Получить все ключи из файловый кэш (для отладки/очистки). */
export async function listCachedFiles(): Promise<Array<{ key: string; size: number; url: string }>> {
  const entries = await offlineGetAll(FILE_CACHE_STORE);
  return entries.map((e) => ({ key: e.key, size: e.size || 0, url: e.url || e.key }));
}

/* ─── Лимиты квоты ───────────────────────────────────────────────────────── */

async function enforceLimits(): Promise<void> {
  const entries = await offlineGetAll(FILE_CACHE_STORE);
  if (entries.length <= MAX_CACHE_ITEMS) return;
  // Удаляем самые старые записи.
  entries.sort((a, b) => (a._updatedAt || 0) - (b._updatedAt || 0));
  const toRemove = entries.slice(0, entries.length - MAX_CACHE_ITEMS);
  for (const e of toRemove) {
    await offlineDelete(FILE_CACHE_STORE, e.id);
  }
}

/** Отозвать ранее созданный blob: URL (чтобы не протекать памятью). */
export function revokeObjectUrl(url: string | null | undefined): void {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}