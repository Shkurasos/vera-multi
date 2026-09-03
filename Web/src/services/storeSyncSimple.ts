/**
 * Упрощённая обёртка для подключения синхронизации к существующим stores.
 * Используем это для chatPrefsStore, shopStore и других локальных stores.
 */

import { create, StoreApi } from 'zustand';
import { persist, PersistOptions } from 'zustand/middleware';

const CLIENT_ID_KEY = 'vera_sync_client_id';

function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto as any).randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem('vera_token');
  if (!token) throw new Error('Not authenticated');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, init.headers || {});
  return fetch(`/api${path}`, { ...init, headers });
}

interface SyncManager {
  storeName: string;
  api: StoreApi<any>;
  debounce: number;
  timer: ReturnType<typeof setTimeout> | null;
  isHydrating: boolean;
  socketBound: boolean;
}

const syncManagers = new Map<string, SyncManager>();

/**
 * Подключить синхронизацию к уже существующему store.
 */
export function enableStoreSync(storeName: string, api: StoreApi<any>, debounce = 800) {
  if (syncManagers.has(storeName)) return;

  const manager: SyncManager = {
    storeName,
    api,
    debounce,
    timer: null,
    isHydrating: false,
    socketBound: false,
  };

  syncManagers.set(storeName, manager);

  // Подписываемся на изменения store
  api.subscribe((state) => {
    if (manager.isHydrating) return;
    scheduleSync(manager);
  });

  // Загружаем данные с сервера
  hydrateFromServer(manager);
  
  // Подключаем WebSocket события
  bindSocketEvents(manager);
}

function snapshotState(state: any): any {
  const out: any = {};
  for (const k in state) {
    if (typeof state[k] !== 'function') {
      out[k] = state[k];
    }
  }
  return out;
}

function scheduleSync(manager: SyncManager) {
  if (manager.timer) clearTimeout(manager.timer);
  
  manager.timer = setTimeout(async () => {
    try {
      const snapshot = snapshotState(manager.api.getState());
      const r = await apiFetch(`/sync/stores/${manager.storeName}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          data: snapshot,
          clientId: getClientId(),
        }),
      });
      
      if (!r.ok) {
        console.warn(`[sync:${manager.storeName}] Ошибка синхронизации:`, r.status);
      }
    } catch (e) {
      // Не залогинен или оффлайн — ничего страшного
    }
  }, manager.debounce);
}

async function hydrateFromServer(manager: SyncManager) {
  try {
    const r = await apiFetch(`/sync/stores/${manager.storeName}`);
    if (!r.ok) return;

    const { data, updatedAt } = await r.json();
    if (!data || typeof data !== 'object') return;

    const localUpdatedAt = localStorage.getItem(`vera_sync_${manager.storeName}_updated`);
    if (localUpdatedAt && updatedAt && localUpdatedAt >= updatedAt) {
      scheduleSync(manager);
      return;
    }

    manager.isHydrating = true;
    try {
      manager.api.setState(data);
      if (updatedAt) {
        localStorage.setItem(`vera_sync_${manager.storeName}_updated`, updatedAt);
      }
      console.log(`[sync:${manager.storeName}] Загружено с сервера`);
    } finally {
      manager.isHydrating = false;
    }
  } catch (e) {
    // Оффлайн или не залогинен
  }
}

function bindSocketEvents(manager: SyncManager) {
  if (manager.socketBound) return;

  // Ждём инициализации socket
  import('./socket').then(({ getSocket }) => {
    try {
      const socket = getSocket?.();
      if (!socket) return;

      socket.on('store:updated', (payload: any) => {
        if (payload.storeName !== manager.storeName) return;
        if (payload.clientId && payload.clientId === getClientId()) return;

        const { data, updatedAt } = payload;
        if (!data || typeof data !== 'object') return;

        manager.isHydrating = true;
        try {
          manager.api.setState(data);
          if (updatedAt) {
            localStorage.setItem(`vera_sync_${manager.storeName}_updated`, updatedAt);
          }
          console.log(`[sync:${manager.storeName}] ✓ Обновлено с другого устройства`);
        } finally {
          manager.isHydrating = false;
        }
      });

      manager.socketBound = true;
    } catch (e) {
      console.warn(`[sync:${manager.storeName}] Не удалось привязать WebSocket`);
    }
  }).catch(() => {});
}

/**
 * Хук для инициализации синхронизации при логине.
 */
export async function initStoreSyncOnLogin() {
  const token = localStorage.getItem('vera_token');
  if (!token) return;

  // Перезагружаем все зарегистрированные stores с сервера
  for (const [storeName, manager] of syncManagers.entries()) {
    await hydrateFromServer(manager);
  }
}

/**
 * Отключить синхронизацию при logout.
 */
export function disableAllStoreSync() {
  for (const manager of syncManagers.values()) {
    if (manager.timer) clearTimeout(manager.timer);
  }
  syncManagers.clear();
}
