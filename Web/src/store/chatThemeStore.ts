import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

/**
 * Персональные темы для отдельных чатов (платная функция магазина).
 * Для каждого чата можно задать свой акцент, цвет своих/чужих пузырей и фон —
 * чтобы по цвету было сразу понятно, где ты.
 * Применяются через CSS-переменные на контейнере чата (см. ChatWindow).
 */

export interface ChatThemeOverride {
  accent?: string;
  bubbleOwn?: string;
  bubbleOther?: string;
  bg?: string;
  /** имя пресета для отображения, например «Мама», «Работа», «Друзья» */
  presetName?: string;
}

/** Быстрые пресеты персональных тем. */
export const CHAT_THEME_PRESETS: { id: string; name: string; accent: string; bubbleOwn: string; bubbleOther: string; bg: string }[] = [
  { id: 'mom', name: 'Семья', accent: '#ff8fb1', bubbleOwn: '#8b2f56', bubbleOther: '#3a2f40', bg: '#241b22' },
  { id: 'work', name: 'Работа', accent: '#5b8cff', bubbleOwn: '#1f3a8a', bubbleOther: '#232b3d', bg: '#161c2b' },
  { id: 'friends', name: 'Друзья', accent: '#67e68f', bubbleOwn: '#14532d', bubbleOther: '#1f3a28', bg: '#14221a' },
  { id: 'neon', name: 'Неон', accent: '#c084fc', bubbleOwn: '#4c1d95', bubbleOther: '#2e1065', bg: '#1a0b2e' },
  { id: 'sunset', name: 'Закат', accent: '#ffb347', bubbleOwn: '#7c2d12', bubbleOther: '#431407', bg: '#2a1608' },
];

interface ChatThemeState {
  themes: Record<string, ChatThemeOverride>;
  /** Применить персональную тему для чата (перезапись по chatId). */
  setChatTheme: (chatId: string, t: ChatThemeOverride) => void;
  /** Сбросить персональную тему конкретного чата. */
  removeChatTheme: (chatId: string) => void;
  /** Вернуть переопределение для чата (или undefined). */
  getTheme: (chatId: string) => ChatThemeOverride | undefined;
}

export const useChatThemeStore = create<ChatThemeState>()(
  persist(
    (set, get) => ({
      themes: {},
      setChatTheme: (chatId, t) => set((s) => ({ themes: { ...s.themes, [chatId]: t } })),
      removeChatTheme: (chatId) =>
        set((s) => {
          const themes = { ...s.themes };
          delete themes[chatId];
          return { themes };
        }),
      getTheme: (chatId) => get().themes[chatId],
    }),
    { name: 'vera-chat-themes', version: 1 }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('chat-themes', useChatThemeStore);
}