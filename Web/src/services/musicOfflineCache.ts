/* ─── Офлайн-медиатека ──────────────────────────────────────────────────────
 * Скачивает аудио и обложки всех треков пользователя (медиатека + плейлисты)
 * в отдельный стор `music_files`. В общем file_cache стоит лимит в 200 записей
 * со сбросом старых — музыка там вытеснялась бы аватарками.
 *
 * Ключи: id трека — аудио, `${id}:cover` — обложка. Качаем по одному треку,
 * в фоне; без сети цикл останавливается и продолжит при следующей загрузке.
 */
import { offlineDelete, offlineGet, offlineHas, offlineKeys, offlineSet } from './offlineDb';
import { getCachedFileUrl } from './fileCache';
import { isAppOffline } from './offlineMode';

const STORE = 'music_files';

export interface OfflineMusicTrack {
  id: string;
  fileUrl?: string;
  coverUrl?: string | null;
}

export const coverKey = (trackId: string) => `${trackId}:cover`;

const isRemote = (url?: string | null): url is string => !!url && !/^(blob:|data:)/i.test(url);

async function download(url: string, key: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include', headers: { 'x-vera-offline': '1' } });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const blob = await res.blob();
  await offlineSet(STORE, key, {
    url, mimeType: blob.type, size: blob.size, blob: await blob.arrayBuffer(),
  });
}

/** Скачать аудио и обложку трека, если их ещё нет. */
export async function cacheMusicTrack(track: OfflineMusicTrack): Promise<void> {
  if (!track?.id) return;
  if (isRemote(track.fileUrl) && !(await offlineHas(STORE, track.id))) {
    await download(track.fileUrl, track.id);
  }
  if (isRemote(track.coverUrl) && !(await offlineHas(STORE, coverKey(track.id)))) {
    await download(track.coverUrl, coverKey(track.id)).catch(() => { /* обложка не обязательна */ });
  }
}

async function blobUrl(key: string): Promise<string | null> {
  const entry = await offlineGet(STORE, key);
  if (!entry?.blob) return null;
  return URL.createObjectURL(new Blob([entry.blob], { type: entry.mimeType || 'application/octet-stream' }));
}

/** blob: URL аудио трека; старые прослушанные треки лежат в file_cache. */
export async function getMusicFileUrl(trackId: string): Promise<string | null> {
  return (await blobUrl(trackId)) || getCachedFileUrl(trackId);
}

export async function getMusicCoverUrl(trackId: string): Promise<string | null> {
  return (await blobUrl(coverKey(trackId))) || getCachedFileUrl(coverKey(trackId));
}

export async function removeMusicTrack(trackId: string): Promise<void> {
  await offlineDelete(STORE, trackId);
  await offlineDelete(STORE, coverKey(trackId));
}

/* ─── Фоновая синхронизация ─────────────────────────────────────────────── */

// Медиатека и плейлисты приходят разными запросами. Лишние файлы удаляем
// только когда известны оба списка, иначе загрузка медиатеки стёрла бы треки
// из плейлистов (и наоборот).
const sources = new Map<string, OfflineMusicTrack[]>();
let running = false;
let dirty = false;

export function syncMusicFiles(source: 'library' | 'playlists', tracks: OfflineMusicTrack[]): void {
  sources.set(source, (tracks || []).filter((t) => t && t.id));
  dirty = true;
  if (running) return;
  running = true;
  void (async () => {
    try {
      try { await navigator.storage?.persist?.(); } catch { /* браузер может отказать */ }
      while (dirty) {
        dirty = false;
        const all = [...sources.values()].flat();
        if (sources.has('library') && sources.has('playlists')) {
          const keep = new Set(all.flatMap((t) => [t.id, coverKey(t.id)]));
          for (const key of await offlineKeys(STORE)) {
            if (!keep.has(key)) await offlineDelete(STORE, key).catch(() => {});
          }
        }
        const seen = new Set<string>();
        for (const track of all) {
          if (isAppOffline() || dirty) break;
          if (seen.has(track.id)) continue;
          seen.add(track.id);
          // Один битый файл (404, квота) не останавливает остальные.
          await cacheMusicTrack(track).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[offline] music sync failed', e);
    } finally {
      running = false;
    }
  })();
}
