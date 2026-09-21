/**
 * Account-scoped synchronization for existing Zustand stores.
 *
 * Stores are created while the application is still bootstrapping auth. They
 * must therefore remain paused until the authenticated user is known. Every
 * asynchronous read/write also carries the account and token that started it;
 * a response from an old session is never allowed to mutate the new session.
 */

import { StoreApi } from 'zustand';

const CLIENT_ID_KEY = 'vera_sync_client_id';
const ACTIVE_ACCOUNT_KEY = 'vera_sync_active_account';

type SyncSocket = {
  on: (event: string, handler: (payload: any) => void) => void;
  off?: (event: string, handler?: (payload: any) => void) => void;
};

interface SyncManager {
  storeName: string;
  api: StoreApi<any>;
  debounce: number;
  timer: ReturnType<typeof setTimeout> | null;
  isHydrating: boolean;
  paused: boolean;
  accountId: string | null;
  generation: number;
  socket: SyncSocket | null;
  socketHandler: ((payload: any) => void) | null;
}

const syncManagers = new Map<string, SyncManager>();
const accountStores = new Map<string, StoreApi<any>>();

function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto as any).randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function storedAccountId(): string | null {
  try {
    const raw = localStorage.getItem('vera_user');
    const user = raw ? JSON.parse(raw) : null;
    return typeof user?.id === 'string' ? user.id : null;
  } catch {
    return null;
  }
}

function clearTimer(manager: SyncManager): void {
  if (manager.timer) clearTimeout(manager.timer);
  manager.timer = null;
}

function unbindSocket(manager: SyncManager): void {
  if (manager.socket && manager.socketHandler) {
    manager.socket.off?.('store:updated', manager.socketHandler);
  }
  manager.socket = null;
  manager.socketHandler = null;
}

function resetStore(api: StoreApi<any>): void {
  try {
    const initial = api.getInitialState();
    api.setState(initial, true);
  } catch {
    // A non-standard store should not prevent the other account stores from
    // being reset. Its own account bootstrap remains guarded by the manager.
  }
}

function clearSyncMetadata(storeName: string): void {
  localStorage.removeItem(`vera_sync_${storeName}_updated`);
  localStorage.removeItem(`vera_sync_${storeName}_local_changed`);
}

function resetAllRegisteredStores(): void {
  const stores = new Set<StoreApi<any>>();
  for (const manager of syncManagers.values()) stores.add(manager.api);
  for (const api of accountStores.values()) stores.add(api);
  for (const api of stores) resetStore(api);
}

function isCurrent(
  manager: SyncManager,
  generation: number,
  accountId: string,
  token: string,
): boolean {
  return !manager.paused
    && manager.generation === generation
    && manager.accountId === accountId
    && localStorage.getItem('vera_token') === token
    && storedAccountId() === accountId;
}

async function apiFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  Object.assign(headers, init.headers || {});
  return fetch(`/api${path}`, { ...init, headers });
}

/**
 * Register a persisted account-owned store which does not use the server sync
 * endpoint. It will still be reset before another account is hydrated.
 */
export function registerAccountStore(storeName: string, api: StoreApi<any>): void {
  accountStores.set(storeName, api);
}

/** Connect synchronization to an existing Zustand store. */
export function enableStoreSync(storeName: string, api: StoreApi<any>, debounce = 800): void {
  if (syncManagers.has(storeName)) return;

  const manager: SyncManager = {
    storeName,
    api,
    debounce,
    timer: null,
    isHydrating: false,
    // Never infer that a token is valid merely because it is in localStorage.
    // Auth bootstrap explicitly activates the manager after /auth/me/device.
    paused: true,
    accountId: null,
    generation: 0,
    socket: null,
    socketHandler: null,
  };
  syncManagers.set(storeName, manager);

  api.subscribe(() => {
    if (manager.paused || manager.isHydrating) return;
    localStorage.setItem(`vera_sync_${storeName}_local_changed`, String(Date.now()));
    scheduleSync(manager);
  });
}

function snapshotState(storeName: string, state: any): any {
  const out: any = {};
  for (const key in state) {
    if (typeof state[key] !== 'function') {
      // Public outfit fields are authoritative on the user record. Generic
      // shop snapshots must never overwrite another outfit asynchronously.
      if (storeName === 'shop' && ['activeRing', 'activeSelfCard', 'activeBubble', 'owned', 'balanceVp', 'marketListings'].includes(key)) continue;
      out[key] = state[key];
    }
  }
  return out;
}

// Some old snapshots intentionally omitted fields. Merge only those legacy
// exceptions; account switching resets `current` before this function runs.
function mergeSyncedState(storeName: string, current: any, incoming: any): any {
  if (storeName === 'shop') {
    incoming = { ...incoming, owned: current.owned, balanceVp: current.balanceVp, marketListings: current.marketListings };
  }
  if (storeName === 'profile-customization') {
    const defaults: Record<string, any> = {
      bannerUrl: '',
      bannerColor: '#3a4a6b',
      cardAccent: '',
      cardOpacity: 0.72,
      showcase: '',
      activityKind: 'auto',
      activityText: '',
      aboutMediaUrl: '',
    };
    const merged = { ...incoming };
    for (const [key, defaultValue] of Object.entries(defaults)) {
      const localValue = current?.[key];
      if (localValue !== undefined && incoming?.[key] === defaultValue && localValue !== defaultValue) {
        merged[key] = localValue;
      }
    }
    return merged;
  }
  if (storeName === 'shop') {
    return {
      ...incoming,
      activeRing: current?.activeRing || '',
      activeSelfCard: current?.activeSelfCard || '',
      activeBubble: current?.activeBubble || '',
    };
  }
  if (storeName !== 'chat-prefs') return incoming;
  return {
    ...incoming,
    pinnedIds: incoming.pinnedIds ?? current.pinnedIds,
    archivedIds: incoming.archivedIds ?? current.archivedIds,
    mutedIds: incoming.mutedIds ?? current.mutedIds,
    pinnedMessages: current.pinnedMessages,
  };
}

function scheduleSync(manager: SyncManager): void {
  if (manager.paused) return;
  clearTimer(manager);

  const generation = manager.generation;
  const accountId = manager.accountId;
  const token = localStorage.getItem('vera_token');
  if (!accountId || !token) return;

  manager.timer = setTimeout(async () => {
    manager.timer = null;
    if (!isCurrent(manager, generation, accountId, token)) return;

    const snapshot = snapshotState(manager.storeName, manager.api.getState());
    try {
      const response = await apiFetch(`/sync/stores/${manager.storeName}`, token, {
        method: 'PUT',
        body: JSON.stringify({ data: snapshot, clientId: getClientId() }),
      });
      // Do not even update local sync metadata after logout/account switch.
      if (!isCurrent(manager, generation, accountId, token)) return;
      if (!response.ok) {
        console.warn(`[sync:${manager.storeName}] Ошибка синхронизации:`, response.status);
        return;
      }
      localStorage.removeItem(`vera_sync_${manager.storeName}_local_changed`);
      const result = await response.json().catch(() => null);
      if (isCurrent(manager, generation, accountId, token) && result?.updatedAt) {
        localStorage.setItem(`vera_sync_${manager.storeName}_updated`, result.updatedAt);
      }
    } catch {
      // Offline/network errors leave the persisted local state intact. The
      // local-changed marker makes the next authenticated bootstrap retry it.
    }
  }, manager.debounce);
}

async function hydrateFromServer(manager: SyncManager, generation: number, accountId: string, token: string): Promise<void> {
  if (!isCurrent(manager, generation, accountId, token)) return;
  try {
    const response = await apiFetch(`/sync/stores/${manager.storeName}`, token);
    if (!isCurrent(manager, generation, accountId, token) || !response.ok) return;

    const { data, updatedAt } = await response.json();
    if (!isCurrent(manager, generation, accountId, token)) return;
    if (data === null) { scheduleSync(manager); return; }
    if (!data || typeof data !== 'object') return;

    const localUpdatedAt = localStorage.getItem(`vera_sync_${manager.storeName}_updated`);
    const localChangedAt = Number(localStorage.getItem(`vera_sync_${manager.storeName}_local_changed`) || 0);
    const serverUpdatedAt = updatedAt ? Date.parse(updatedAt) : 0;
    if (localChangedAt && (!serverUpdatedAt || localChangedAt > serverUpdatedAt)) {
      scheduleSync(manager);
      return;
    }
    if (localUpdatedAt && updatedAt && localUpdatedAt >= updatedAt) {
      scheduleSync(manager);
      return;
    }

    manager.isHydrating = true;
    try {
      if (isCurrent(manager, generation, accountId, token)) {
        manager.api.setState(mergeSyncedState(manager.storeName, manager.api.getState(), data));
        if (updatedAt) localStorage.setItem(`vera_sync_${manager.storeName}_updated`, updatedAt);
      }
    } finally {
      manager.isHydrating = false;
    }
  } catch {
    // Offline or an expired session: auth bootstrap will retry on the next run.
  }
}

function bindSocketEvents(manager: SyncManager): void {
  const generation = manager.generation;
  const accountId = manager.accountId;
  const token = localStorage.getItem('vera_token');
  if (!accountId || !token) return;

  import('./socket').then(({ getSocket }) => {
    if (!isCurrent(manager, generation, accountId, token)) return;
    const socket = getSocket?.() as SyncSocket | null;
    if (!socket) return;
    if (manager.socket === socket) return;
    unbindSocket(manager);

    const handler = (payload: any) => {
      if (!isCurrent(manager, generation, accountId, token)) return;
      if (payload?.storeName !== manager.storeName) return;
      if (payload.clientId && payload.clientId === getClientId()) return;
      const data = payload?.data;
      if (!data || typeof data !== 'object') return;

      manager.isHydrating = true;
      try {
        if (isCurrent(manager, generation, accountId, token)) {
          manager.api.setState(mergeSyncedState(manager.storeName, manager.api.getState(), data));
          if (payload.updatedAt) localStorage.setItem(`vera_sync_${manager.storeName}_updated`, payload.updatedAt);
        }
      } finally {
        manager.isHydrating = false;
      }
    };
    socket.on('store:updated', handler);
    manager.socket = socket;
    manager.socketHandler = handler;
  }).catch(() => {});
}

/** Hydrate and activate all registered stores for one authenticated account. */
export async function initStoreSyncOnLogin(accountId?: string, prepare?: () => void): Promise<void> {
  const token = localStorage.getItem('vera_token');
  const targetAccount = accountId || storedAccountId();
  if (!token || !targetAccount || storedAccountId() !== targetAccount) return;

  const previousAccount = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  const accountChanged = previousAccount !== targetAccount;

  for (const manager of syncManagers.values()) {
    clearTimer(manager);
    unbindSocket(manager);
    manager.paused = true;
    manager.isHydrating = false;
    manager.accountId = null;
    manager.generation += 1;
  }

  if (accountChanged) {
    resetAllRegisteredStores();
    for (const manager of syncManagers.values()) clearSyncMetadata(manager.storeName);
  }
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, targetAccount);
  prepare?.();

  for (const manager of syncManagers.values()) {
    manager.accountId = targetAccount;
    manager.generation += 1;
    manager.paused = false;
    const generation = manager.generation;
    await hydrateFromServer(manager, generation, targetAccount, token);
    if (isCurrent(manager, generation, targetAccount, token)) bindSocketEvents(manager);
  }
}

/** Pause synchronization and clear all account-owned local state on logout. */
export function disableAllStoreSync(): void {
  for (const manager of syncManagers.values()) {
    clearTimer(manager);
    unbindSocket(manager);
    manager.paused = true;
    manager.isHydrating = false;
    manager.accountId = null;
    manager.generation += 1;
    clearSyncMetadata(manager.storeName);
  }
  resetAllRegisteredStores();
  localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
}