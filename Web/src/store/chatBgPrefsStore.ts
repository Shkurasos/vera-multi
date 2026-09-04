import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Пер-чатовые настройки фона: яркость обоев/живых обоев и флаг «применить
 * ко всем чатам». Хранится локально на устройстве (синк можно добавить через
 * storeSyncSimple, если потребуется).
 */
export interface ChatBgPrefsState {
  /** chatId -> { brightness: 0..1 } (0 = совсем тёмный, 1 = исходная картинка) */
  perChat: Record<string, { brightness: number }>;
  /** Базовое затемнение фона чата (0..1). */
  defaultBrightness: number;
  /** Применить выбранный фон ко всем чатам (галочка). */
  applyAll: boolean;
  /** Текущий чат, к которому применяется настройка (чтобы UI знал). */
  currentChatId: string | null;
  setCurrentChat: (id: string | null) => void;
  setBrightness: (chatId: string, v: number) => void;
  getBrightness: (chatId: string) => number;
  setApplyAll: (v: boolean) => void;
  applyBrightnessToAll: (v: number) => void;
}

export const useChatBgPrefsStore = create<ChatBgPrefsState>()(
  persist(
    (set, get) => ({
      perChat: {},
      defaultBrightness: 0.65,
      applyAll: false,
      currentChatId: null,
      setCurrentChat: (id) => set({ currentChatId: id }),
      setBrightness: (chatId, v) => set((s) => ({
        perChat: { ...s.perChat, [chatId]: { ...s.perChat[chatId], brightness: v } },
      })),
      getBrightness: (chatId) => {
        const p = get().perChat[chatId];
        return typeof p?.brightness === 'number' ? p.brightness : get().defaultBrightness;
      },
      setApplyAll: (v) => set({ applyAll: v }),
      applyBrightnessToAll: (v) => {
        const ids = Object.keys(get().perChat);
        const all: Record<string, { brightness: number }> = {};
        ids.forEach(id => { all[id] = { brightness: v }; });
        set({ perChat: all, applyAll: true });
      },
    }),
    { name: 'vera-chat-bg-prefs', version: 1 }
  )
);