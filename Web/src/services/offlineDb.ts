/* ─── Vera Offline IndexedDB ───────────────────────────────────────────────
 * Локальный кэш для десктоп-приложения: музыка, аватарки, сообщения,
 * скины, темы, иконки. Использует нативный IndexedDB — никаких лишних
 * зависимостей. Данные хранятся под ключом storeName -> id -> значение.
 */

const DB_NAME = 'VeraOffline';
const DB_VERSION = 1;

const STORES: string[] = [
  'music_library',   // кэш треков музыкальной библиотеки (метаданные)
  'file_cache',      // кэш бинарных файлов (аватарки, обложки, аудио blobs)
  'avatars',         // кэш аватарок пользователей (только URL + meta)
  'messages',        // последние 30 сообщений на чат
  'skins',           // кэш скинов
  'themes',          // кэш тем оформления
  'icons',           // кэш иконок и наборов иконок
  'user_profile',    // кэш профиля текущего пользователя
];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

/** Обёртка над IDBRequest, возвращающая Promise. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Сохранить одну запись. */
export async function offlineSet(storeName: string, id: string, value: any): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await request(store.put({ id, ...value, _updatedAt: Date.now() }));
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

/** Сохранить много записей одной транзакцией. */
export async function offlineSetMany(storeName: string, entries: Array<{ id: string; [key: string]: any }>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const e of entries) {
    await request(store.put({ ...e, _updatedAt: Date.now() }));
  }
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

/** Получить запись по id. */
export async function offlineGet(storeName: string, id: string): Promise<any | null> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const result = await request<any | null>(store.get(id));
  await new Promise<void>((res) => { tx.oncomplete = () => res(); });
  return result;
}

/** Получить все записи из стора. */
export async function offlineGetAll(storeName: string): Promise<any[]> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const result = await request<any[]>(store.getAll());
  await new Promise<void>((res) => { tx.oncomplete = () => res(); });
  return result;
}

/** Получить записи по массиву id. */
export async function offlineGetMany(storeName: string, ids: string[]): Promise<any[]> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const results: any[] = [];
  for (const id of ids) {
    const item = await request<any | null>(store.get(id));
    if (item) results.push(item);
  }
  await new Promise<void>((res) => { tx.oncomplete = () => res(); });
  return results;
}

/** Удалить запись по id. */
export async function offlineDelete(storeName: string, id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await request(store.delete(id));
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

/** Очистить весь стор. */
export async function offlineClear(storeName: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await request(store.clear());
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

/** Проверить, есть ли стор. */
export async function offlineHasStore(storeName: string): Promise<boolean> {
  const db = await openDB();
  return db.objectStoreNames.contains(storeName);
}