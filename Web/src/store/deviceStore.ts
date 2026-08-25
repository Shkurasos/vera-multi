import { create } from 'zustand';
import { peer, isPeerAvailable, VeraInfo, LinkedDevice, LinkInvite } from '../services/peer';

/*
 * deviceStore — заменяет authStore.
 *
 * Аккаунт == устройство. Никаких токенов, логинов и паролей. При старте
 * приложения зовём `peer.info()`, чтобы получить локальный `deviceId` +
 * `accountId` + `nostrPk`. Дальше UI считает пользователя «залогиненным»,
 * если `info != null`.
 *
 * Второе устройство добавляется к тому же аккаунту через QR (см. LinkPage).
 */

interface DeviceState {
  info: VeraInfo | null;
  linked: LinkedDevice[];
  invite: LinkInvite | null;
  loading: boolean;
  available: boolean;
  error: string | null;

  init: () => Promise<void>;
  refreshLinked: () => Promise<void>;
  makeInvite: () => Promise<void>;
  acceptInvite: (url: string) => Promise<void>;
  clearInvite: () => void;
  setName: (name: string) => Promise<void>;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  info: null,
  linked: [],
  invite: null,
  loading: false,
  available: isPeerAvailable(),
  error: null,

  init: async () => {
    if (!isPeerAvailable()) { set({ available: false }); return; }
    set({ loading: true, error: null });
    try {
      const info = await peer.info();
      set({ info, available: true });
      // Подписки, обновляющие состояние из событий узла
      peer.on('linked-device', () => get().refreshLinked());
      peer.on('ready',         () => peer.info().then((i) => set({ info: i })).catch(() => {}));
      await get().refreshLinked();
    } catch (e: any) {
      set({ error: e?.message || 'init failed' });
    } finally {
      set({ loading: false });
    }
  },

  refreshLinked: async () => {
    try { set({ linked: await peer.listLinkedDevices() }); } catch {}
  },

  makeInvite: async () => {
    set({ error: null });
    try { set({ invite: await peer.createLinkInvite() }); }
    catch (e: any) { set({ error: e?.message || 'invite failed' }); }
  },

  acceptInvite: async (url: string) => {
    set({ error: null });
    try {
      await peer.acceptLinkInvite(url);
      const info = await peer.info();
      set({ info });
      await get().refreshLinked();
    } catch (e: any) { set({ error: e?.message || 'accept failed' }); }
  },

  clearInvite: () => set({ invite: null }),

  setName: async (name: string) => {
    try { set({ info: await peer.setName(name) }); }
    catch (e: any) { set({ error: e?.message || 'setName failed' }); }
  },
}));
