/**
 * Универсальная синхронизация Zustand stores между устройствами.
 * 
 * Использование:
 * 1. Оборачиваем store в syncedStore() вместо обычного persist()
 * 2. Store автоматически синхронизируется с сервером и другими устройствами
 * 3. Конфликты разрешаются по принципу last-write-wins
 */

import { StateCreator } from 'zustand';
import { getSocket } from './socket';

// Клиентский ID для фильтрации собственных эхо-событий
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, init.headers || {});
  return fetch(`/api${path}`, { ...init, headers });
}

interface SyncConfig {
  /** Имя store (должно быть уникальным в приложении) */
  name: string;
  /** Debounce в мс перед отправкой на сервер (по умолчанию 800) */
  debounce?: number;
  /** Ключи для синхронизации (если не указаны — синхронизируется весь state, кроме функций) */
  keys?: string[];
  /** Включить локальный persist в localStorage (по умолчанию true) */
  localStorage?: boolean;
}

interface StoreMeta {
  __updatedAt?: string;
  __clientId?: string;
}

/**
 * Middleware для синхронизации store между устройствами.
 * Работает поверх локального localStorage persist.
 */
export function syncedStore<T extends object>(
  config: SyncConfig,
  creator: StateCreator<T>
) {
  const { name, debounce = 800, keys } = config;
  
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let isHydrating = false;
  let socketBound = false;

  function snapshotForSync(state: any): any {
    const out: any = {};
    
    if (keys && keys.length > 0) {
      for (const k of keys) {
        if (state[k] !== undefined) out[k] = state[k];
      }
    } else {
      for (const k in state) {
        if (typeof state[k] !== 'function') {
          out[k] = state[k];
        }
      }
    }
    
    return out;
  }

  function scheduleSync(api: any) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const token = localStorage.getItem('vera_token');
      if (!token) return;

      try {
        const snapshot = snapshotForSync(api.getState());
        const r = await apiFetch(`/sync/stores/${name}`, {
          method: 'PUT',
          body: JSON.stringify({ 
            data: snapshot,
            clientId: getClientId(),
          }),
        });
        
        if (!r.ok) {
          console.warn(`[sync:${name}] Не удалось синхронизировать:`, r.status);
        }
      } catch (e) {
        console.warn(`[sync:${name}] Ошибка синхронизации:`, e);
      }
    }, debounce);
  }

  async function hydrateFromServer(api: any) {
    const token = localStorage.getItem('vera_token');
    if (!token) return;

    try {
      const r = await apiFetch(`/sync/stores/${name}`);
      if (!r.ok) return;

      const { data, updatedAt } = await r.json();
      if (!data || typeof data !== 'object') return;

      const localUpdatedAt = localStorage.getItem(`vera_sync_${name}_updated`);
      if (localUpdatedAt && updatedAt && localUpdatedAt >= updatedAt) {
        scheduleSync(api);
        return;
      }

      isHydrating = true;
      try {
        api.setState(data);
        if (updatedAt) {
          localStorage.setItem(`vera_sync_${name}_updated`, updatedAt);
        }
      } finally {
        isHydrating = false;
      }
    } catch (e) {
      console.warn(`[sync:${name}] Не удалось загрузить с сервера:`, e);
    }
  }

  function bindSocketEvents(api: any) {
    if (socketBound) return;
    
    try {
      const socket = getSocket?.();
      if (!socket) return;

      socket.on('store:updated', (payload: any) => {
        if (payload.storeName !== name) return;
        if (payload.clientId && payload.clientId === getClientId()) return;

        const { data, updatedAt } = payload;
        if (!data || typeof data !== 'object') return;

        isHydrating = true;
        try {
          api.setState(data);
          if (updatedAt) {
            localStorage.setItem(`vera_sync_${name}_updated`, updatedAt);
          }
          console.log(`[sync:${name}] Получено обновление с другого устройства`);
        } finally {
          isHydrating = false;
        }
      });

      socket.on('store:deleted', (payload: any) => {
        if (payload.storeName !== name) return;
        
        console.log(`[sync:${name}] Store удалён на сервере`);
        isHydrating = true;
        try {
          const initialState = creator(api.setState, api.getState, api);
          api.setState(initialState);
          localStorage.removeItem(`vera_sync_${name}_updated`);
        } finally {
          isHydrating = false;
        }
      });

      socketBound = true;
    } catch (e) {
      console.warn(`[sync:${name}] Не удалось привязать WebSocket:`, e);
    }
  }

  const result: any = {
    name: `vera-${name}`,
    version: 1,
    partialize: (state: any) => snapshotForSync(state),
    onRehydrateStorage: () => {
      return (state: any, error: any) => {
        if (error) {
          console.error(`[sync:${name}] Ошибка гидрации:`, error);
          return;
        }
        
        const api = (window as any).__ZUSTAND_STORES__?.[name];
        if (api) {
          api.subscribe(() => {
            if (!isHydrating) scheduleSync(api);
          });
          
          hydrateFromServer(api);
          bindSocketEvents(api);
        }
      };
    },
  };

  if (typeof window !== 'undefined') {
    if (!(window as any).__ZUSTAND_STORES__) {
      (window as any).__ZUSTAND_STORES__ = {};
    }
  }

  return result;
}

export async function forceSyncStore(storeName: string, data: any): Promise<boolean> {
  const token = localStorage.getItem('vera_token');
  if (!token) return false;

  try {
    const r = await apiFetch(`/sync/stores/${storeName}`, {
      method: 'PUT',
      body: JSON.stringify({ data, clientId: getClientId() }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function hydrateAllStores(): Promise<Record<string, any>> {
  const token = localStorage.getItem('vera_token');
  if (!token) return {};

  try {
    const r = await apiFetch('/sync/stores');
    if (!r.ok) return {};
    
    const { stores } = await r.json();
    return stores || {};
  } catch {
    return {};
  }
}
