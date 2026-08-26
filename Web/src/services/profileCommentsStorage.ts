/**
 * Локальная стена комментариев профиля (Steam-style).
 * Хранение: IndexedDB, ключ — id владельца профиля (targetUserId).
 * Каждый комментарий — {id, authorId, authorName, authorAvatar, text, ts}.
 *
 * Синхронизация по P2P — задел на будущее (piggy-back на chat sync).
 * Сейчас комментарии видны локально автору стены и тому, кто их писал
 * на своём устройстве; это осознанная поэтапная реализация.
 */

const DB_NAME = 'vera-profile-comments';
const STORE = 'comments';

export interface ProfileComment {
  id: string;
  targetUserId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  text: string;
  ts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('by_target', 'targetUserId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addComment(c: Omit<ProfileComment, 'id' | 'ts'> & { id?: string; ts?: number }): Promise<ProfileComment> {
  const full: ProfileComment = {
    id: c.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: c.ts || Date.now(),
    targetUserId: c.targetUserId,
    authorId: c.authorId,
    authorName: c.authorName,
    authorAvatar: c.authorAvatar,
    text: c.text,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return full;
}

export async function listComments(targetUserId: string): Promise<ProfileComment[]> {
  try {
    const db = await openDb();
    return await new Promise<ProfileComment[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('by_target');
      const req = idx.getAll(targetUserId);
      req.onsuccess = () => {
        const arr = (req.result as ProfileComment[]) || [];
        arr.sort((a, b) => b.ts - a.ts);
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteComment(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}
