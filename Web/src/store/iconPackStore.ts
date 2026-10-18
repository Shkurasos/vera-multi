import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { BasePackId, CustomIcon, CustomIconPack } from '../utils/iconPackFormat';

/**
 * Свои паки иконок. Хранятся в IndexedDB, а не в localStorage: в паке бывают
 * десятки картинок, и квота localStorage (~5 МБ) кончилась бы на втором паке.
 * Какой пак включён — живёт в uiPrefsStore.customPack (и сохраняется в теме).
 */

const DB_NAME = 'vera-icon-packs';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB недоступен')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** Хранилище для persist. Без IndexedDB (тесты, приватный режим) — память. */
const memory = new Map<string, string>();
const idbStorage: StateStorage = {
  getItem: (name) => tx<string | undefined>('readonly', (s) => s.get(name))
    .then((v) => v ?? null).catch(() => memory.get(name) ?? null),
  setItem: (name, value) => tx('readwrite', (s) => s.put(value, name))
    .then(() => undefined).catch(() => { memory.set(name, value); }),
  removeItem: (name) => tx('readwrite', (s) => s.delete(name))
    .then(() => undefined).catch(() => { memory.delete(name); }),
};

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface IconPackState {
  packs: Record<string, CustomIconPack>;
  /** true, когда паки прочитаны из IndexedDB. */
  hydrated: boolean;
  /** Создать пак; возвращает id. */
  createPack: (name: string, base: BasePackId, icons?: Record<string, CustomIcon>) => string;
  /** Сохранить пак целиком (из редактора). */
  savePack: (pack: Omit<CustomIconPack, 'updatedAt'>) => void;
  duplicatePack: (id: string) => string | null;
  deletePack: (id: string) => void;
}

export const useIconPackStore = create<IconPackState>()(
  persist(
    (set, get) => ({
      packs: {},
      hydrated: false,
      createPack: (name, base, icons = {}) => {
        const id = newId();
        set({ packs: { ...get().packs, [id]: { id, name, base, icons, updatedAt: Date.now() } } });
        return id;
      },
      savePack: (pack) => {
        set({ packs: { ...get().packs, [pack.id]: { ...pack, updatedAt: Date.now() } } });
      },
      duplicatePack: (id) => {
        const src = get().packs[id];
        if (!src) return null;
        return get().createPack(`${src.name} (копия)`, src.base, { ...src.icons });
      },
      deletePack: (id) => {
        const next = { ...get().packs };
        delete next[id];
        set({ packs: next });
      },
    }),
    {
      name: 'vera-icon-packs',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ packs: s.packs }) as unknown as IconPackState,
      onRehydrateStorage: () => () => { useIconPackStore.setState({ hydrated: true }); },
    },
  ),
);
