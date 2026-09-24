import { create } from 'zustand';
import {
  checkFontFile, customFontCss, sanitizeFontFamily,
} from '../utils/customFonts';
import {
  deleteFontFile, injectFontFace, loadFontFiles, removeFontFace, saveFontFile,
} from '../services/customFontStorage';
import { useChatFontStore } from './chatFontStore';
import { useChatSettingsStore } from './chatSettingsStore';
import { useUserSettingsStore } from './userSettingsStore';

/**
 * Свои шрифты пользователя — один список на всё приложение.
 *
 * Файлы лежат в IndexedDB (см. `customFontStorage.ts`), поэтому шрифт доступен и
 * в «Шрифте всего приложения» (SettingsDialog), и в шрифтах чата (ChatWindow).
 * Метаданные не дублируем в localStorage — список читается из IndexedDB при
 * старте (`hydrate`), а выбор шрифта хранится в userSettingsStore / chatFontStore.
 */

export interface CustomFont {
  id: string;
  /** Имя семейства в CSS — по нему шрифт выбирается в настройках. */
  family: string;
  /** Исходное имя файла — показываем в списке. */
  fileName: string;
  size: number;
  createdAt: number;
}

interface CustomFontsState {
  /** Свои шрифты, новые сверху. */
  fonts: CustomFont[];
  /** Прочитали ли список из IndexedDB (иначе пустой список = «ещё грузится»). */
  ready: boolean;
  /** Идёт сохранение/удаление файла — кнопки блокируем. */
  busy: boolean;
  /** Ошибка последней операции (показывается в UI). */
  error: string;
  hydrate: () => Promise<void>;
  addFont: (file: File) => Promise<CustomFont | null>;
  removeFont: (id: string) => Promise<void>;
  clearError: () => void;
}

/** object URL'ы своих шрифтов: держим, чтобы освобождать их при удалении. */
const fontUrls = new Map<string, string>();
let hydrating = false;

function newFontId(): string {
  const uuid = (crypto as any)?.randomUUID?.();
  return uuid || `font-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Сбрасывает выбор удалённого шрифта во всех местах: глобально, на конкретный
 * чат и в «устаревшем» шрифте сообщений.
 */
function resetFontSelections(family: string): void {
  const css = customFontCss(family);
  const matches = (value?: string) => !!value && (value === css || value === family);

  const settings = useUserSettingsStore.getState();
  if (matches(settings.globalFontFamily)) settings.set('globalFontFamily', 'inherit');

  const chatFonts = useChatFontStore.getState();
  Object.entries(chatFonts.perChatFonts).forEach(([chatId, value]) => {
    if (matches(value)) chatFonts.clearChatFont(chatId);
  });

  const chatSettings = useChatSettingsStore.getState();
  if (matches(chatSettings.fontFamily)) chatSettings.setFontFamily('inherit');
}

/** Регистрирует файл шрифта в IndexedDB + @font-face и возвращает метаданные. */
async function storeFont(file: File, family: string): Promise<CustomFont> {
  const id = newFontId();
  const createdAt = Date.now();
  await saveFontFile({ id, family, fileName: file.name, size: file.size, createdAt, blob: file });
  const url = URL.createObjectURL(file);
  fontUrls.set(id, url);
  injectFontFace(family, url);
  return { id, family, fileName: file.name, size: file.size, createdAt };
}

/** Полное удаление шрифта: IndexedDB, @font-face, object URL и выбранные значения. */
async function dropFont(id: string, resetSelections = true): Promise<void> {
  const font = useCustomFontsStore.getState().fonts.find((item) => item.id === id);
  if (!font) return;
  await deleteFontFile(id);
  removeFontFace(font.family);
  const url = fontUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    fontUrls.delete(id);
  }
  if (resetSelections) resetFontSelections(font.family);
  useCustomFontsStore.setState((state) => ({ fonts: state.fonts.filter((item) => item.id !== id) }));
}

/**
 * Переносит свои шрифты из старого хранилища (`chatSettingsStore.customFonts`,
 * data URL в localStorage) в общее — чтобы старые загрузки не пропали.
 */
async function importLegacyFonts(existing: CustomFont[]): Promise<CustomFont[]> {
  const legacy = useChatSettingsStore.getState().customFonts;
  if (!legacy?.length) return [];

  const imported: CustomFont[] = [];
  const known = new Set(existing.map((font) => font.family));
  for (const item of legacy) {
    const family = sanitizeFontFamily(item.name) || (item.name || '').trim();
    if (!family || !item.url || known.has(family)) continue;
    try {
      const blob = await (await fetch(item.url)).blob();
      if (!blob.size) continue;
      const id = newFontId();
      const createdAt = Date.now();
      await saveFontFile({ id, family, fileName: item.name, size: blob.size, createdAt, blob });
      const url = URL.createObjectURL(blob);
      fontUrls.set(id, url);
      injectFontFace(family, url);
      known.add(family);
      imported.push({ id, family, fileName: item.name, size: blob.size, createdAt });
    } catch {
      /* битый data URL — просто пропускаем */
    }
  }
  // Старый список очищаем: теперь шрифты живут в IndexedDB и не раздувают localStorage.
  if (imported.length) useChatSettingsStore.setState({ customFonts: [] });
  return imported;
}

export const useCustomFontsStore = create<CustomFontsState>((set, get) => ({
  fonts: [],
  ready: false,
  busy: false,
  error: '',

  hydrate: async () => {
    if (get().ready || hydrating) return;
    hydrating = true;
    try {
      const stored = await loadFontFiles();
      const fonts: CustomFont[] = stored.map((item) => {
        const url = URL.createObjectURL(item.blob);
        fontUrls.set(item.id, url);
        injectFontFace(item.family, url);
        return {
          id: item.id, family: item.family, fileName: item.fileName,
          size: item.size, createdAt: item.createdAt,
        };
      });
      const imported = await importLegacyFonts(fonts);
      set({ fonts: [...imported, ...fonts], ready: true });
    } finally {
      hydrating = false;
    }
  },

  addFont: async (file) => {
    const problem = checkFontFile(file);
    if (problem) {
      set({ error: problem });
      return null;
    }
    set({ busy: true, error: '' });
    try {
      const family = sanitizeFontFamily(file.name);
      // Одно семейство — одна запись: повторная загрузка заменяет старый файл,
      // но уже выбранный шрифт при этом не сбрасываем.
      const duplicate = get().fonts.find((font) => font.family === family);
      if (duplicate) await dropFont(duplicate.id, false);
      const font = await storeFont(file, family);
      set((state) => ({ fonts: [font, ...state.fonts], busy: false, error: '' }));
      return font;
    } catch (error: any) {
      set({ busy: false, error: error?.message || 'Не удалось сохранить шрифт' });
      return null;
    }
  },

  removeFont: async (id) => {
    set({ busy: true, error: '' });
    try {
      await dropFont(id);
      set({ busy: false });
    } catch (error: any) {
      set({ busy: false, error: error?.message || 'Не удалось удалить шрифт' });
    }
  },

  clearError: () => set({ error: '' }),
}));

// Шрифты нужны сразу после загрузки приложения — в том числе чтобы восстановить
// @font-face для выбранного ранее шрифта.
if (typeof window !== 'undefined') {
  void useCustomFontsStore.getState().hydrate();
}

