/**
 * Хранилище живых обоев чата (видео).
 * localStorage не подходит — квота 5МБ и base64 раздувает файл на ~33%.
 * Используем IndexedDB, из Blob формируем объект URL, который живёт пока
 * не будет вызван URL.revokeObjectURL. Флаг наличия видео дублируется
 * в localStorage, чтобы UI мог показать соответствующий пункт меню сразу.
 */

const DB_NAME = 'vera-live-bg';
const STORE = 'videos';
const KEY = 'chat-bg-video';
export const LIVE_BG_FLAG_KEY = 'vera-live-bg-set';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLiveBg(blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  try { localStorage.setItem(LIVE_BG_FLAG_KEY, '1'); } catch {}
}

export async function loadLiveBgUrl(): Promise<string | null> {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function clearLiveBg(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  try { localStorage.removeItem(LIVE_BG_FLAG_KEY); } catch {}
}

export function hasLiveBg(): boolean {
  try { return localStorage.getItem(LIVE_BG_FLAG_KEY) === '1'; } catch { return false; }
}
