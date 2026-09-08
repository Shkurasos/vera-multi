import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

/**
 * Стоковые шрифты (базовые пресеты).
 * Применяются к сообщениям в чате, заголовкам и тексту.
 */
export const STOCK_FONTS = [
  { id: 'default', name: 'По умолчанию (глобальный)', family: 'inherit' },
  { id: 'inter', name: 'Inter', family: 'Inter, system-ui, sans-serif' },
  { id: 'roboto', name: 'Roboto', family: 'Roboto, sans-serif' },
  { id: 'montserrat', name: 'Montserrat', family: 'Montserrat, sans-serif' },
  { id: 'open-sans', name: 'Open Sans', family: '"Open Sans", sans-serif' },
  { id: 'lato', name: 'Lato', family: 'Lato, sans-serif' },
  { id: 'source-code-pro', name: 'Source Code Pro (моноширинный)', family: '"Source Code Pro", monospace' },
  { id: 'georgia', name: 'Georgia (с засечками)', family: 'Georgia, serif' },
  { id: 'times', name: 'Times New Roman', family: '"Times New Roman", Times, serif' },
  { id: 'arial', name: 'Arial', family: 'Arial, sans-serif' },
  { id: 'verdana', name: 'Verdana', family: 'Verdana, sans-serif' },
  { id: 'courier', name: 'Courier New', family: '"Courier New", Courier, monospace' },
  { id: 'comic-sans', name: 'Comic Sans MS', family: '"Comic Sans MS", "Comic Sans", cursive' },
  { id: 'playfair', name: 'Playfair Display', family: '"Playfair Display", serif' },
  { id: 'merriweather', name: 'Merriweather', family: 'Merriweather, serif' },
];

/**
 * Индивидуальные шрифты для каждого чата + глобальный шрифт в userSettingsStore.
 * Пользователь может:
 * - Использовать глобальный шрифт (применяется ко всему приложению)
 * - Переопределить шрифт для конкретного чата (per-chat override)
 * - Загрузить свой шрифт (custom font via @font-face)
 */

export interface CustomFontData {
  family: string; // font-family name
  url: string; // data URL or URL to font file
  name: string; // display name
}

interface ChatFontState {
  /** Per-chat переопределения шрифтов (chatId -> font family) */
  perChatFonts: Record<string, string>;
  
  /** Пользовательские загруженные шрифты */
  customFonts: Record<string, CustomFontData>; // fontId -> font data
  
  /** Установить шрифт для чата */
  setChatFont: (chatId: string, fontFamily: string) => void;
  
  /** Удалить переопределение шрифта для чата (вернуться к глобальному) */
  clearChatFont: (chatId: string) => void;
  
  /** Получить шрифт для чата (returns font-family или null если используется глобальный) */
  getChatFont: (chatId: string) => string | null;
  
  /** Добавить кастомный шрифт */
  addCustomFont: (id: string, data: CustomFontData) => void;
  
  /** Удалить кастомный шрифт */
  removeCustomFont: (id: string) => void;
}

export const useChatFontStore = create<ChatFontState>()(
  persist(
    (set, get) => ({
      perChatFonts: {},
      customFonts: {},

      setChatFont: (chatId, fontFamily) => {
        set((state) => ({
          perChatFonts: { ...state.perChatFonts, [chatId]: fontFamily },
        }));
      },

      clearChatFont: (chatId) => {
        set((state) => {
          const { [chatId]: _, ...rest } = state.perChatFonts;
          return { perChatFonts: rest };
        });
      },

      getChatFont: (chatId) => {
        return get().perChatFonts[chatId] || null;
      },

      addCustomFont: (id, data) => {
        set((state) => ({
          customFonts: { ...state.customFonts, [id]: data },
        }));
        // Инжектируем @font-face в DOM
        injectFontFace(data.family, data.url);
      },

      removeCustomFont: (id) => {
        set((state) => {
          const { [id]: removed, ...rest } = state.customFonts;
          return { customFonts: rest };
        });
      },
    }),
    { name: 'vera-chat-fonts' }
  )
);

/**
 * Инжектирует @font-face в DOM для загруженного пользовательского шрифта
 */
function injectFontFace(family: string, url: string) {
  if (typeof document === 'undefined') return;
  
  const styleId = `custom-font-${family.replace(/\s+/g, '-')}`;
  
  // Удаляем старый стиль если есть
  const existing = document.getElementById(styleId);
  if (existing) existing.remove();
  
  // Создаём новый
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @font-face {
      font-family: "${family}";
      src: url("${url}");
    }
  `;
  document.head.appendChild(style);
}

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('chatFonts', useChatFontStore);
  
  // Восстанавливаем @font-face для всех кастомных шрифтов при загрузке
  const state = useChatFontStore.getState();
  Object.values(state.customFonts).forEach((font) => {
    injectFontFace(font.family, font.url);
  });
}
