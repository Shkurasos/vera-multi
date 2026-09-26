/**
 * Свои фото-обои пользователя в IndexedDB.
 *
 * Раньше фото хранились как dataURL в localStorage-персисте стора `chat-bg-prefs`:
 * квота ~5 МБ и серверный лимит синхронизации 128 КБ (413) приводили к потере
 * фотографий при перезагрузке/перелогине. Теперь в сторе лежит только ключ
 * `<scope>:<id>` (как у видео в chatLiveBgStorage), а сам Blob — в IndexedDB.
 * Старые dataURL-значения поддерживались на рендеринге и мигрируют отсюда же.
 */

const DB_NAME = 'vera-photo-bg';
const STORE = 'photos';

/** true, если значение — ключ IndexedDB (`<scope>:<id>`), а не dataURL / URL / путь к файлу. */
export function isPhotoBgKey(value: string): boolean {
  if (!value || /^(data:|https?:|blob:|\/)/i.test(value)) return false;
  // Ключ всегда вида `<scope>:<id>` (global:…, chat-1:… и т.п.).
  return /^[^:\s]+:[^/\s]/.test(value);
}

interface PhotoBgState {
  userWallpapers?: Record<string, Array<{ id: string; name: string; type: string; value: string; createdAt: number }> | undefined>;
  userPhotoWallpaper?: string | null;
  userPhotoName?: string;
  perChatOverrides?: Record<string, { type: string; value: string } | undefined>;
}

export interface PhotoWallpaperMigrationPlan {
  /** Что сохранить в IndexedDB (уникальные ключи). */
  saves: Array<{ key: string; dataUrl: string }>;
  /** Чем заменить поля стора (только изменённые поля). */
  next: {
    userWallpapers?: Record<string, unknown[]>;
    userPhotoWallpaper?: string;
    userPhotoName?: string;
    perChatOverrides?: Record<string, { type: string; value: string }>;
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('Некорректный dataURL фото');
  const [, mime, isBase64, payload] = match;
  if (isBase64) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  }
  const bytes = new TextEncoder().encode(decodeURIComponent(payload));
  return new Blob([bytes], { type: mime || 'image/jpeg' });
}

/** Сохранить фото (Blob или dataURL) под ключом `<scope>:<id>`. */
export async function savePhotoBg(source: Blob | string, key: string): Promise<void> {
  const blob = typeof source === 'string' ? dataUrlToBlob(source) : source;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getPhotoBgBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Объект-URL фото. Кэшируется, освобождается только в clearPhotoBg. */
const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function loadPhotoBgUrl(key: string): Promise<string | null> {
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;
  const task = (async () => {
    try {
      const blob = await getPhotoBgBlob(key);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(key, url);
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

/** Удалить фото и освободить объект-URL. */
export async function clearPhotoBg(key: string): Promise<void> {
  const url = urlCache.get(key);
  if (url) {
    urlCache.delete(key);
    try { URL.revokeObjectURL(url); } catch { /* уже освобождён */ }
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Нет IndexedDB — удалять нечего.
  }
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 1;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * План миграции dataURL-фото → ключи IndexedDB (чистая функция).
 * Одинаковые dataURL (список + легаси-одиночное + per-chat override)
 * схлопываются в один ключ с одной записью Blob.
 * Возвращает null, если мигрировать нечего.
 */
export function planPhotoWallpaperMigration(state: PhotoBgState): PhotoWallpaperMigrationPlan | null {
  const urlToKey = new Map<string, string>();
  const usedKeys = new Set<string>();
  const saves: Array<{ key: string; dataUrl: string }> = [];
  let listChanged = false;

  const nextList: Record<string, unknown[]> = {};
  const srcList = state.userWallpapers || {};
  for (const [scope, rawItems] of Object.entries(srcList)) {
    const items = Array.isArray(rawItems) ? rawItems : [];
    let scopeChanged = false;
    const nextItems = items.map((item) => {
      if (!item || item.type !== 'photo' || typeof item.value !== 'string' || !item.value.startsWith('data:')) return item;
      let key = urlToKey.get(item.value);
      if (!key) {
        key = uniqueKey(`${scope}:${item.id}`, usedKeys);
        urlToKey.set(item.value, key);
        usedKeys.add(key);
        saves.push({ key, dataUrl: item.value });
      }
      scopeChanged = true;
      listChanged = true;
      return { ...item, value: key };
    });
    nextList[scope] = scopeChanged ? nextItems : items;
  }

  let photoChanged = false;
  let userPhotoWallpaper = state.userPhotoWallpaper ?? null;
  if (typeof userPhotoWallpaper === 'string' && userPhotoWallpaper.startsWith('data:')) {
    let key = urlToKey.get(userPhotoWallpaper);
    if (!key) {
      key = uniqueKey('global:legacy-photo', usedKeys);
      urlToKey.set(userPhotoWallpaper, key);
      usedKeys.add(key);
      saves.push({ key, dataUrl: userPhotoWallpaper });
    }
    userPhotoWallpaper = key;
    photoChanged = true;
  }

  let overridesChanged = false;
  const nextOverrides: Record<string, { type: string; value: string }> = {};
  for (const [chatId, override] of Object.entries(state.perChatOverrides || {})) {
    if (override && override.type === 'photo' && typeof override.value === 'string' && override.value.startsWith('data:')) {
      let key = urlToKey.get(override.value);
      if (!key) {
        key = uniqueKey(`${chatId}:photo-override`, usedKeys);
        urlToKey.set(override.value, key);
        usedKeys.add(key);
        saves.push({ key, dataUrl: override.value });
      }
      nextOverrides[chatId] = { ...override, value: key };
      overridesChanged = true;
    } else if (override) {
      nextOverrides[chatId] = override;
    }
  }

  if (!saves.length) return null;

  const next: PhotoWallpaperMigrationPlan['next'] = {};
  if (listChanged) next.userWallpapers = nextList;
  if (photoChanged) {
    next.userPhotoWallpaper = userPhotoWallpaper as string;
    next.userPhotoName = state.userPhotoName || '';
  }
  if (overridesChanged) next.perChatOverrides = nextOverrides;
  return { saves, next };
}

/**
 * Перенести dataURL-фото из стора в IndexedDB.
 * При ошибке IndexedDB состояние не трогаем — dataURL остаётся рабочим
 * форматом рендеринга (fallback).
 */
export async function migratePhotoWallpapers(api: {
  getState: () => PhotoBgState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setState: (partial: any) => void;
}): Promise<boolean> {
  const plan = planPhotoWallpaperMigration(api.getState());
  if (!plan) return false;
  try {
    for (const { key, dataUrl } of plan.saves) {
      await savePhotoBg(dataUrl, key);
    }
  } catch {
    return false;
  }
  api.setState(plan.next);
  return true;
}

type MigrationApi = {
  getState: () => PhotoBgState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setState: (partial: any) => void;
  subscribe: (listener: (state: unknown, prev: unknown) => void) => void;
};

let started = false;

/**
 * Запустить миграцию один раз и продолжать следить за стором:
 * server-hydrate может принести dataURL уже после стартовой миграции.
 * При стойкой ошибке IndexedDB — не больше 3 попыток, чтобы не крутить цикл.
 */
export function startPhotoWallpaperMigration(api: MigrationApi): void {
  if (started || typeof indexedDB === 'undefined') return;
  started = true;
  let queued = false;
  let running = false;
  let failures = 0;

  const schedule = () => {
    if (queued || running) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      void run();
    }, 0);
  };

  const run = async () => {
    if (running) return;
    if (!planPhotoWallpaperMigration(api.getState())) {
      failures = 0;
      return;
    }
    running = true;
    try {
      const ok = await migratePhotoWallpapers(api);
      failures = ok ? 0 : failures + 1;
    } catch {
      failures += 1;
    } finally {
      running = false;
    }
    if (failures < 3 && planPhotoWallpaperMigration(api.getState())) schedule();
  };

  api.subscribe(schedule);
  schedule();
}

