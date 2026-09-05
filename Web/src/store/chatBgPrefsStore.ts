import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Стоковые обои (встроенные пресеты).
 */
export const STOCK_WALLPAPERS = [
  { id: 'none', name: 'Без обоев', type: 'none' as const },
  { id: 'gradient-purple', name: 'Фиолетовый градиент', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1920' },
  { id: 'gradient-blue', name: 'Синий градиент', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1920' },
  { id: 'gradient-pink', name: 'Розовый градиент', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1557682268-e3955ed5d83f?w=1920' },
  { id: 'mountains', name: 'Горы', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920' },
  { id: 'ocean', name: 'Океан', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=1920' },
  { id: 'forest', name: 'Лес', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1511497584788-876760111969?w=1920' },
  { id: 'night-sky', name: 'Ночное небо', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920' },
];

/** Специальные id глобальных обоев: своё фото / своё видео (загруженное пользователем). */
export const CUSTOM_PHOTO_WALLPAPER_ID = 'custom-photo';
export const CUSTOM_LIVE_WALLPAPER_ID = 'custom-live';

export type WallpaperOverride = {
  type: 'photo' | 'live' | 'stock';
  /** Для photo: dataURL или URL; для live: blob ID в IndexedDB; для stock: id из STOCK_WALLPAPERS */
  value: string;
};

export type ResolvedWallpaper = { type: 'stock' | 'photo' | 'live'; value: string };

/**
 * Глобальные и per-chat настройки обоев/яркости.
 */
export interface ChatBgPrefsState {
  /** Глобальные обои (применяются ко всем чатам по умолчанию): id из STOCK_WALLPAPERS или CUSTOM_* */
  globalStockWallpaper: string;

  /** Per-chat переопределения (если установлены свои обои в чате) */
  perChatOverrides: Record<string, WallpaperOverride>;

  /** Per-chat яркость фона (0..1, где 1 = полная яркость) */
  perChatBrightness: Record<string, number>;

  /** Базовая яркость по умолчанию */
  defaultBrightness: number;

  /** Своё фото-обои, загруженное пользователем (dataURL) */
  userPhotoWallpaper: string | null;
  /** Имя файла своего фото-обоев */
  userPhotoName: string;
  /** Счётчик версий живых обоев — чтобы клиент перезагрузить видео из IndexedDB */
  liveBgStamp: number;

  // Actions
  setGlobalStockWallpaper: (id: string) => void;
  setUserPhotoWallpaper: (dataUrl: string, name: string) => void;
  clearUserPhotoWallpaper: () => void;
  bumpLiveBg: () => void;
  setChatWallpaper: (chatId: string, override: WallpaperOverride) => void;
  clearChatWallpaper: (chatId: string) => void;
  getChatWallpaper: (chatId: string) => ResolvedWallpaper | null;

  setBrightness: (chatId: string, v: number) => void;
  getBrightness: (chatId: string) => number;
}

export const useChatBgPrefsStore = create<ChatBgPrefsState>()(
  persist(
    (set, get) => ({
      globalStockWallpaper: 'none',
      perChatOverrides: {},
      perChatBrightness: {},
      defaultBrightness: 0.65,
      userPhotoWallpaper: null,
      userPhotoName: '',
      liveBgStamp: 0,

      setGlobalStockWallpaper: (id) => set({ globalStockWallpaper: id }),

      setUserPhotoWallpaper: (dataUrl, name) => set({ userPhotoWallpaper: dataUrl, userPhotoName: name }),
      clearUserPhotoWallpaper: () => set({ userPhotoWallpaper: null, userPhotoName: '' }),
      bumpLiveBg: () => set((s) => ({ liveBgStamp: s.liveBgStamp + 1 })),

      setChatWallpaper: (chatId, override) => set((s) => ({
        perChatOverrides: { ...s.perChatOverrides, [chatId]: override },
      })),

      clearChatWallpaper: (chatId) => set((s) => {
        const { [chatId]: _, ...rest } = s.perChatOverrides;
        return { perChatOverrides: rest };
      }),

      getChatWallpaper: (chatId) => {
        const override = get().perChatOverrides[chatId];
        if (override) return override;

        // Fallback на глобальные обои
        const globalId = get().globalStockWallpaper;
        if (globalId === CUSTOM_PHOTO_WALLPAPER_ID && get().userPhotoWallpaper) {
          return { type: 'photo', value: get().userPhotoWallpaper as string };
        }
        if (globalId === CUSTOM_LIVE_WALLPAPER_ID) {
          return { type: 'live', value: 'global' };
        }
        if (!globalId || globalId === 'none') return null;
        return { type: 'stock', value: globalId };
      },

      setBrightness: (chatId, v) => set((s) => ({
        perChatBrightness: { ...s.perChatBrightness, [chatId]: v },
      })),

      getBrightness: (chatId) => {
        const b = get().perChatBrightness[chatId];
        return typeof b === 'number' ? b : get().defaultBrightness;
      },
    }),
    { name: 'vera-chat-bg-prefs', version: 2 }
  )
);