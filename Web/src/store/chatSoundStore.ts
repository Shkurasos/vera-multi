import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Индивидуальные звуки уведомлений для каждого чата.
 * Пользователь загружает свой аудиофайл с устройства → храним как data URL
 * (короткий файл ~0.5–2 сек) в localStorage. При входящем сообщении в чате
 * играет свой звук, если он задан; иначе — стандартный.
 */

export interface ChatSoundSetting {
  url: string; // data URL
  name: string; // имя файла
}

interface ChatSoundState {
  sounds: Record<string, ChatSoundSetting>;
  /** Громкость 0..1 для звука уведомления в конкретном чате. По умолчанию 1. */
  volumes: Record<string, number>;
  setSound: (chatId: string, s: ChatSoundSetting) => void;
  removeSound: (chatId: string) => void;
  setVolume: (chatId: string, volume: number) => void;
  getVolume: (chatId: string) => number;
}

export const useChatSoundStore = create<ChatSoundState>()(
  persist(
    (set, get) => ({
      sounds: {},
      volumes: {},

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
        return typeof v === 'number' ? v : 1;
      },
    }),
    { name: 'vera-chat-sounds' }
  )
);