/**
 * Хранилище своих шрифтов: сам файл лежит в IndexedDB, а в DOM регистрируется
 * `@font-face` со ссылкой на Blob (object URL).
 *
 * localStorage и серверный синк для шрифтов не годятся: base64 раздувает файл
 * на ~33%, а квота localStorage — 5 МБ. С живыми обоями поступаем так же
 * (см. `chatLiveBgStorage.ts`).
 */

const DB_NAME = 'vera-custom-fonts';
const STORE = 'files';
const STYLE_ID_PREFIX = 'vera-custom-font-';

export interface StoredFontFile {
  id: string;
  /** Имя семейства, под которым шрифт виден в CSS. */
  family: string;
  /** Исходное имя файла — показываем пользователю. */
  fileName: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Сохраняет файл шрифта (перезапись по id). */
export async function saveFontFile(file: StoredFontFile): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(file);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Все сохранённые файлы шрифтов, новые сверху. */
export async function loadFontFiles(): Promise<StoredFontFile[]> {
  try {
    const db = await openDb();
    const list = await new Promise<StoredFontFile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as StoredFontFile[]);
      req.onerror = () => reject(req.error);
    });
    return list
      .filter((item) => !!item && !!item.id && !!item.blob && !!item.family)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

/** Удаляет файл шрифта из IndexedDB. */
export async function deleteFontFile(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* нет IndexedDB — удалять нечего */
  }
}

/** id элемента <style>, в котором живёт `@font-face` своего шрифта. */
export function fontFaceStyleId(family: string): string {
  return STYLE_ID_PREFIX + family.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '');
}

/** Регистрирует `@font-face` для своего шрифта (прошлый стиль с тем же id заменяется). */
export function injectFontFace(family: string, url: string): void {
  if (typeof document === 'undefined' || !family || !url) return;
  const id = fontFaceStyleId(family);
  document.getElementById(id)?.remove();
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `@font-face { font-family: "${family.replace(/["'\\]/g, ' ')}"; src: url("${url}"); font-display: swap; }`;
  document.head.appendChild(style);
}

/** Убирает `@font-face` своего шрифта (например, при удалении файла). */
export function removeFontFace(family: string): void {
  if (typeof document === 'undefined' || !family) return;
  document.getElementById(fontFaceStyleId(family))?.remove();
}
