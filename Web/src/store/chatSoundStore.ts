import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

/**
 * Индивидуальные звуки уведомлений для каждого чата + глобальный звук по умолчанию.
 * Пользователь загружает свой аудиофайл с устройства → храним как data URL
 * (короткий файл ~0.5–2 сек) в localStorage. При входящем сообщении в чате
 * играет свой звук, если он задан; иначе — глобальный (если задан), иначе — дефолтный beep.
 */

export interface ChatSoundSetting {
  url: string; // data URL
  name: string; // имя файла
}

interface ChatSoundState {
  sounds: Record<string, ChatSoundSetting>;
  /** Громкость 0..1 для звука уведомления в конкретном чате. По умолчанию 1. */
  volumes: Record<string, number>;
  /** Глобальный звук по умолчанию (применяется ко всем чатам без собственного звука) */
  globalSound: ChatSoundSetting | null;
  /** Глобальная громкость (0..1). По умолчанию 1. */
  globalVolume: number;

  setSound: (chatId: string, s: ChatSoundSetting) => void;
  removeSound: (chatId: string) => void;
  setVolume: (chatId: string, volume: number) => void;
  getVolume: (chatId: string) => number;

  setGlobalSound: (s: ChatSoundSetting | null) => void;
  setGlobalVolume: (volume: number) => void;
}

export const useChatSoundStore = create<ChatSoundState>()(
  persist(
    (set, get) => ({
      sounds: {},
      volumes: {},
      globalSound: null,
      globalVolume: 1,

      setSound: (chatId, s) =>
        set((state) => ({
          sounds: { ...state.sounds, [chatId]: s },
        })),

      removeSound: (chatId) =>
        set((state) => {
          const sounds = { ...state.sounds };
          delete sounds[chatId];
          return { sounds };
        }),

      setVolume: (chatId, volume) =>
        set((state) => ({
          volumes: { ...state.volumes, [chatId]: Math.max(0, Math.min(1, volume)) },
        })),

      getVolume: (chatId) => {
        const v = get().volumes[chatId];
        return typeof v === 'number' ? v : get().globalVolume;
      },

      setGlobalSound: (s) => set({ globalSound: s }),

      setGlobalVolume: (volume) => set({ globalVolume: Math.max(0, Math.min(1, volume)) }),
    }),
    { name: 'vera-chat-sounds', version: 2 }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('chat-sounds', useChatSoundStore);
}