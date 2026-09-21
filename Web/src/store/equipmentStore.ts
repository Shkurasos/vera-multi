import { create } from 'zustand';
import { usersApi } from '../services/api';
import type { User } from '../types';
import { registerAccountStore } from '../services/storeSyncSimple';

export type Equipment = Pick<User, 'id' | 'activeRing' | 'activeSelfCard' | 'activeBubble'>;
const pending = new Map<string, Promise<void>>();

interface EquipmentState {
  users: Record<string, Equipment>;
  update: (equipment: Equipment) => void;
  refresh: (userId: string) => Promise<void>;
}

/** Public outfits are independent of archived messages and chat-member snapshots. */
export const useEquipmentStore = create<EquipmentState>((set, get) => ({
  users: {},
  update: equipment => set(state => ({ users: { ...state.users, [equipment.id]: equipment } })),
  refresh: userId => {
    const existing = pending.get(userId);
    if (existing) return existing;
    const before = get().users[userId];
    const request = usersApi.getById(userId).then(({ data }) => {
      // A live event received during the request is newer than this response.
      if (get().users[userId] !== before) return;
      get().update({ id: userId, activeRing: data.activeRing ?? '',
        activeSelfCard: data.activeSelfCard ?? '', activeBubble: data.activeBubble ?? '' });
    }).catch(error => console.error('[equipment] Failed to load outfit', error))
      .finally(() => { pending.delete(userId); });
    pending.set(userId, request);
    return request;
  },
}));

registerAccountStore('equipment', useEquipmentStore);