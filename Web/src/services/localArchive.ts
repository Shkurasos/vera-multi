/**
 * Локальный архив чатов и сообщений (IndexedDB).
 *
 * Сервер на Render Free держит данные в /tmp и теряет их при рестарте.
 * Плюс пользователь хочет, чтобы история сохранялась на его устройстве.
 * Держим полную зеркальную копию чатов+сообщений в браузере/Electron.
 *
 * Поведение:
 *  - При старте читаем архив и МГНОВЕННО показываем историю.
 *  - Ответ сервера (loadChats/loadMessages) обновляет стор и дописывает архив.
 *  - Все правки (новое, edit, delete) синкаем в IndexedDB.
 *  - Если сервер потерял сообщение, а в архиве оно есть — оно остаётся у юзера.
 *
 * База: vera-archive-<userId>. Хранилища:
 *  chats    (keyPath id)
 *  messages (keyPath id, индекс by_chat).
 */
import type { Chat, Message } from '../types';

const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;
let currentUserId = '';

function openDb(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`vera-archive-${userId || 'anon'}`, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chats')) {
        db.createObjectStore('chats', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('by_chat', 'chatId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function initArchive(userId: string) {
  if (!userId) return;
  if (currentUserId === userId && dbPromise) return;
  currentUserId = userId;
  dbPromise = openDb(userId).catch((e) => {
    console.warn('[archive] open failed:', e);
    throw e;
  });
}

export function closeArchive() {
  if (dbPromise) dbPromise.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  currentUserId = '';
}

async function withStore<T>(
  name: 'chats' | 'messages',
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T | null> {
  if (!dbPromise) return null;
  try {
    const db = await dbPromise;
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      let result: any;
      Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[archive] tx failed:', e);
    return null;
  }
}

/* ---------- chats ---------- */

export async function loadArchivedChats(): Promise<Chat[]> {
  const res = await withStore('chats', 'readonly', (store) => new Promise<Chat[]>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as Chat[]);
    req.onerror = () => reject(req.error);
  }));
  return res || [];
}

export async function saveArchivedChats(chats: Chat[]): Promise<void> {
  if (!chats || chats.length === 0) return;
  await withStore('chats', 'readwrite', (store) => {
    chats.forEach((c) => { if (c && c.id) store.put(c); });
  });
}

export async function deleteArchivedChat(chatId: string): Promise<void> {
  await withStore('chats', 'readwrite', (store) => { store.delete(chatId); });
  await withStore('messages', 'readwrite', (store) => {
    const idx = store.index('by_chat');
    const req = idx.openCursor(IDBKeyRange.only(chatId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  });
}

/* ---------- messages ---------- */

export async function loadArchivedMessages(chatId: string): Promise<Message[]> {
  const res = await withStore('messages', 'readonly', (store) => new Promise<Message[]>((resolve, reject) => {
    const idx = store.index('by_chat');
    const req = idx.getAll(IDBKeyRange.only(chatId));
    req.onsuccess = () => {
      const arr = (req.result as Message[]) || [];
      arr.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  }));
  return res || [];
}

export async function saveArchivedMessages(messages: Message[]): Promise<void> {
  if (!messages || messages.length === 0) return;
  await withStore('messages', 'readwrite', (store) => {
    messages.forEach((m) => {
      if (m && m.id && !String(m.id).startsWith('temp-')) store.put(m);
    });
  });
}

export async function deleteArchivedMessage(messageId: string): Promise<void> {
  if (!messageId || String(messageId).startsWith('temp-')) return;
  await withStore('messages', 'readwrite', (store) => { store.delete(messageId); });
}

/* ---------- utility ---------- */

export function mergeById<T extends { id: string; createdAt?: string }>(
  archived: T[], fresh: T[],
): T[] {
  const map = new Map<string, T>();
  for (const item of archived) if (item && item.id) map.set(item.id, item);
  // Свежее с сервера важнее (edit/реакции).
  for (const item of fresh) if (item && item.id) map.set(item.id, item);
  const arr = Array.from(map.values());
  arr.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  return arr;
}

