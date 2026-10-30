import { create } from 'zustand';
import { stickersApi, type StickerPack } from '../services/api';

/**
 * Наборы стикеров текущего пользователя: что лежит в панели (installed) и
 * какие наборы он сделал сам (own). Источник правды — сервер; стор только
 * кэширует ответ /stickers/my, чтобы панель у поля ввода открывалась сразу.
 */
interface StickerState {
  installed: StickerPack[];
  own: StickerPack[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: (force?: boolean) => Promise<void>;
  /** Подменить набор после правки (ответ сервера), не перезагружая всё. */
  upsert: (pack: StickerPack) => void;
  remove: (packId: string) => void;
}

export const useStickerStore = create<StickerState>((set, get) => ({
  installed: [],
  own: [],
  loaded: false,
  loading: false,
  error: '',

  load: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return;
    set({ loading: true, error: '' });
    try {
      const { data } = await stickersApi.my();
      set({ installed: data.installed || [], own: data.own || [], loaded: true });
    } catch (e: any) {
      set({ error: e?.response?.data?.message || 'Не удалось загрузить стикеры' });
    } finally {
      set({ loading: false });
    }
  },

  upsert: (pack) => set((s) => {
    const replace = (list: StickerPack[]) => list.map((p) => (p.id === pack.id ? pack : p));
    const inInstalled = s.installed.some((p) => p.id === pack.id);
    const inOwn = s.own.some((p) => p.id === pack.id);
    let installed = replace(s.installed);
    if (pack.installed && !inInstalled) installed = [...installed, pack];
    if (!pack.installed) installed = installed.filter((p) => p.id !== pack.id);
    const own = pack.isMine ? (inOwn ? replace(s.own) : [...s.own, pack]) : s.own;
    return { installed, own };
  }),

  remove: (packId) => set((s) => ({
    installed: s.installed.filter((p) => p.id !== packId),
    own: s.own.filter((p) => p.id !== packId),
  })),
}));
