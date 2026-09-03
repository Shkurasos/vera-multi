import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

export interface CustomFont {
  name: string;
  url: string; // blob URL or data URL
}

interface ChatSettingsState {
  fontSize: number;       // 12–24, default 15
  emojiSize: number;      // 16–48, default 28
  fontFamily: string;     // CSS font-family string
  customFonts: CustomFont[];

  setFontSize: (v: number) => void;
  setEmojiSize: (v: number) => void;
  setFontFamily: (f: string) => void;
  addCustomFont: (font: CustomFont) => void;
  removeCustomFont: (name: string) => void;
}

export const BUILTIN_FONTS = [
  { label: 'По умолчанию', value: 'inherit' },
  { label: 'Inter', value: "'Inter', sans-serif" },
  { label: 'Roboto', value: "'Roboto', sans-serif" },
  { label: 'Montserrat', value: "'Montserrat', sans-serif" },
  { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Comic Sans', value: "'Comic Sans MS', cursive" },
];

export const useChatSettingsStore = create<ChatSettingsState>()(
  persist(
    (set) => ({
      fontSize: 15,
      emojiSize: 28,
      fontFamily: 'inherit',
      customFonts: [],

      setFontSize: (v) => set({ fontSize: Math.min(24, Math.max(12, v)) }),
      setEmojiSize: (v) => set({ emojiSize: Math.min(48, Math.max(16, v)) }),
      setFontFamily: (f) => set({ fontFamily: f }),

      addCustomFont: (font) =>
        set((s) => ({
          customFonts: [...s.customFonts.filter((f) => f.name !== font.name), font],
        })),

      removeCustomFont: (name) =>
        set((s) => ({ customFonts: s.customFonts.filter((f) => f.name !== name) })),
    }),
    { name: 'vera-chat-settings' }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('chat-settings', useChatSettingsStore);
}
