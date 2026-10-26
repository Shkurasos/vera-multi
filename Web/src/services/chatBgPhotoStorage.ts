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

// Соединение держим одно на всё приложение. Раньше openDb() открывал новое на
// каждый get/put и никогда не закрывал: браузер держит такие соединения до
// конца вкладки, и по мере накопления IndexedDB начинает заметно тормозить —
// фото в обоях проявлялось через заметную задержку, тем сильнее, чем дольше
// открыта вкладка. На upgrade соединение нас может заблокировать, поэтому на
// versionchange закрываемся и роняем кэш — следующий open откроет заново.
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

/**
 * Прогреть картинку: декодировать заранее, пока она ещё не вставлена в DOM.
 *
 * object URL сам по себе не «загружает» фото — браузер разбирает JPEG в момент
 * первой отрисовки, и на большом снимке это заметная задержка (несколько
 * сотен миллисекунд). Если декодировать заранее через decode(), картинка
 * появляется сразу. Ошибки глотаем: прекеширование не должно ломать показ.
 */
export function warmUpPhotoBgUrl(url: string): void {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  if (typeof img.decode === 'function') img.decode().catch(() => {});
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

/**
 * Серверная копия фото.
 *
 * IndexedDB живёт на одном устройстве, а в синхронизируемом сторе лежит только
 * ключ. На другом устройстве (или в скачанном приложении, или после перелогина)
 * ключ приезжал, а файла не было — в галерее серый квадрат. Поэтому фото ещё и
 * заливается на сервер, а стор хранит «ключ → /uploads/...». Модуль сам ничего
 * не импортирует (его грузят тесты в голом vm): адаптер подключает App.tsx.
 */
export interface PhotoBgRemote {
  /** Адрес серверной копии, если она уже есть. */
  urlFor: (key: string) => string | null | undefined;
  /** Залить фото на сервер и запомнить адрес. */
  upload: (key: string, blob: Blob) => Promise<void>;
}

let remote: PhotoBgRemote | null = null;

export function setPhotoBgRemote(next: PhotoBgRemote | null): void {
  remote = next;
}

/** Качаем только свои файлы с сервера: адрес приходит из синхронизируемого стора. */
export function isRemotePhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && /^\/uploads\/[A-Za-z0-9._\-/]+$/.test(url) && !url.includes('..');
}

async function putBlob(blob: Blob, key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Сохранить фото (Blob или dataURL) под ключом `<scope>:<id>`. */
export async function savePhotoBg(source: Blob | string, key: string): Promise<void> {
  const blob = typeof source === 'string' ? dataUrlToBlob(source) : source;
  await putBlob(blob, key);
  // Копия на сервер — в фоне: локально фото уже есть, ждать сеть незачем.
  if (remote && !remote.urlFor(key)) void remote.upload(key, blob).catch(() => {});
}

/** Скачать серверную копию в IndexedDB (фото выбрано на другом устройстве). */
async function fetchRemotePhoto(key: string): Promise<Blob | null> {
  const url = remote?.urlFor(key);
  if (!isRemotePhotoUrl(url)) return null;
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.size) return null;
  // Сервер отдаёт /uploads как attachment: тип у Blob может быть пустым.
  const typed = blob.type.startsWith('image/') ? blob : new Blob([blob], { type: 'image/jpeg' });
  try { await putBlob(typed, key); } catch { /* показываем и без кэша */ }
  return typed;
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
      const blob = (await getPhotoBgBlob(key)) || (await fetchRemotePhoto(key));
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(key, url);
      // Декодируем заранее: без этого фото «проявлялось» через заметную
      // паузу — браузер разбирал JPEG прямо в момент первой отрисовки.
      warmUpPhotoBgUrl(url);
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

interface RemoteBackfillState extends PhotoBgState {
  chatListBg?: { type: string; value: string } | null;
  gapBg?: string | null;
  remotePhotos?: Record<string, string | undefined>;
}

/** Все ключи IndexedDB, на которые ссылается стор (без дублей). */
export function referencedPhotoKeys(state: RemoteBackfillState): string[] {
  const keys = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && isPhotoBgKey(v)) keys.add(v); };
  for (const list of Object.values(state.userWallpapers || {})) {
    for (const item of list || []) if (item?.type === 'photo') add(item.value);
  }
  add(state.userPhotoWallpaper);
  for (const o of Object.values(state.perChatOverrides || {})) if (o?.type === 'photo') add(o.value);
  if (state.chatListBg?.type === 'photo') add(state.chatListBg.value);
  add(state.gapBg);
  return [...keys];
}

/**
 * Залить на сервер фото, у которых ещё нет серверной копии, но есть локальный
 * файл. Нужно для фото, загруженных до появления синхронизации.
 */
export async function backfillRemotePhotos(state: RemoteBackfillState): Promise<number> {
  if (!remote) return 0;
  let uploaded = 0;
  for (const key of referencedPhotoKeys(state)) {
    if (remote.urlFor(key) || state.remotePhotos?.[key]) continue;
    const blob = await getPhotoBgBlob(key);
    if (!blob) continue;
    try { await remote.upload(key, blob); uploaded += 1; } catch { /* попробуем в следующий запуск */ }
  }
  return uploaded;
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

