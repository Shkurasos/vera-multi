import React, { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';
import { BASE_WALLPAPERS, findBaseWallpaper, baseWallpaperClass, adminWallpaperClass } from './baseWallpapers';
import {
  useAdminWallpaperItems, useAdminHiddenWallpapers, useAdminWallpaperOverrides,
  type AdminWallpaper, type AdminWallpaperOverride,
} from './adminWallpapersStore';

/** Запись в галерее стоковых обоев: заводская или добавленная админом. */
export type StockWallpaper = {
  id: string;
  name: string;
  type: 'none' | 'base' | 'photo';
  url?: string;
  light?: boolean;
  /** Фон загрузил админ (не из вшитого каталога). */
  admin?: boolean;
  /** Для админского градиента — его css (рисуется через общий <style>). */
  css?: string;
  /** Фон правил админ поверх заводского — видно меткой в панели. */
  edited?: boolean;
};

/**
 * Стоковые обои (встроенные пресеты).
 *
 * Кроме сетевых фото здесь живут БАЗОВЫЕ ФОНЫ ТЕМ (см. `baseWallpapers.ts`):
 * это css-градиенты с инлайновым SVG, поэтому в каталоге они помечены
 * `type: 'base'` и не имеют `url` — движок обоев рисует их через `background`.
 * Так базовый фон можно выбрать вручную для любой темы, а не только той,
 * которой он «родной».
 */
export const STOCK_WALLPAPERS: StockWallpaper[] = [
  { id: 'none', name: 'Без обоев', type: 'none' as const },
  ...BASE_WALLPAPERS.map((w) => ({
    id: w.id, name: w.name, type: 'base' as const, light: !!w.light,
  })),
  { id: 'gradient-purple', name: 'Фиолетовый градиент', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1920' },
  { id: 'gradient-blue', name: 'Синий градиент', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1920' },
  { id: 'gradient-pink', name: 'Розовый градиент', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1557682268-e3955ed5d83f?w=1920' },
  { id: 'mountains', name: 'Горы', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920' },
  { id: 'ocean', name: 'Океан', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=1920' },
  { id: 'forest', name: 'Лес', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1511497584788-876760111969?w=1920' },
  { id: 'night-sky', name: 'Ночное небо', type: 'photo' as const, url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920' },
];

/** Базовый фон темы по id — или undefined, если выбран не он. */
export function isBaseWallpaperId(id?: string | null): boolean {
  return !!findBaseWallpaper(id);
}

/**
 * Скоуп для обоев СПИСКА ЧАТОВ (экран выбора чатов).
 *
 * Список чатов — не чат, поэтому переиспользовать под него `perChatOverrides`
 * нельзя: там ключи — id чатов, и подмена сломала бы и перебор чатов, и
 * миграцию фото из dataURL. Отдельный скоуп и отдельное поле выбора.
 */
export const CHAT_LIST_SCOPE = 'chatlist';

/* ── Фото и фоны, добавленные админом (общие для всех) ─────────────────────── */

/**
 * Единый список стоковых обоев: заводские + загруженные админом.
 *
 * Заводские лежат в константе, админские приходят с сервера, поэтому список
 * собирается функцией. Раньше все три экрана (галерея, превью в настройках
 * темы и сам чат) брали константу напрямую — и админских фонов в них просто не
 * было бы, даже если бы каталог с сервера пришёл.
 *
 * Заводские всегда идут первыми, админские дописываются в конц: так порядок
 * галереи предсказуем, а не «прыгает» после публикации нового фона.
 */
export function buildStockWallpapers(
  adminItems: AdminWallpaper[] = [],
  hidden: string[] = [],
  overrides: Record<string, AdminWallpaperOverride> = {},
): StockWallpaper[] {
  // Скрытые заводские фоны выпадают из галереи у всех — это «удаление» фона,
  // вшитого в бандл: файла на сервере нет, а пользователь его не видит.
  const hiddenIds = new Set(hidden);
  const out: StockWallpaper[] = STOCK_WALLPAPERS
    .filter((w) => !hiddenIds.has(w.id))
    // Правка админа идёт «поверх» бандла: имя, тёмность и css меняются у всех,
    // а id остаётся прежним — темы, ссылающиеся на фон, не ломаются.
    .map((w) => {
      const o = overrides[w.id];
      if (!o) return w;
      return {
        ...w,
        name: o.name || w.name,
        light: o.light === undefined ? w.light : o.light,
        css: o.css || w.css,
        url: o.url || w.url,
        edited: true,
      } as StockWallpaper;
    });
  const known = new Set(out.map((w) => w.id));
  for (const a of adminItems) {
    if (!a || known.has(a.id)) continue;
    known.add(a.id);
    // Фото-фон админа рисуется как обычное фото (url), фон-градиент — как base:
    // так на них работает ровно тот же код галереи и чата, что на заводских.
    out.push({
      id: a.id,
      name: a.name,
      type: a.type === 'photo' ? ('photo' as const) : ('base' as const),
      url: a.url,
      // css обязателен: без него фон-градиент админа нечем рисовать —
      // wallpaperCssClass получил бы undefined и вернул пустой класс.
      css: a.css,
      light: !!a.light,
      admin: true,
    });
  }
  return out;
}

/** Стоковые обои вместе с админскими — для галереи и превью. */
export function useAllStockWallpapers(): StockWallpaper[] {
  const adminItems = useAdminWallpaperItems();
  const hidden = useAdminHiddenWallpapers();
  const overrides = useAdminWallpaperOverrides();
  return useMemo(() => buildStockWallpapers(adminItems, hidden, overrides), [adminItems, hidden, overrides]);
}

/**
 * CSS-класс фона для обоих видов «не-фото»: заводские `base-*` и админские
 * градиенты. Админский фон приходит с сервера, поэтому правило кладём в тот же
 * общий <style> — иначе длинная строка фона попала бы в `sx` и emotion
 * хешировал бы её на каждом рендере (см. baseWallpaper.ts).
 */
export function wallpaperCssClass(wp?: StockWallpaper | null): string {
  if (!wp) return '';
  // Правленный заводской фон — тот же случай, что и админский градиент: css
  // приехал с сервера, значит рисуется через общий <style>, а не из бандла.
  if (wp.type === 'base' && wp.css && (wp.admin || wp.edited)) return adminWallpaperClass(wp.id, wp.css);
  return baseWallpaperClass(wp.id);
}

/** Светлый ли фон — от этого зависит цвет слоя яркости поверх обоев. */
export function isLightWallpaper(wp?: StockWallpaper | null): boolean {
  return !!wp?.light;
}

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
 * Свои обои пользователя (несколько на чат/глобально).
 * photo — dataURL в value; live — ключ-скоуп в IndexedDB (chatLiveBgStorage),
 * что позволяет хранить несколько видео одновременно.
 */
export interface UserWallpaperItem {
  id: string;
  name: string;
  type: 'photo' | 'live';
  value: string;
  createdAt: number;
}

/**
 * Глобальные и per-chat настройки обоев/яркости.
 */
export interface ChatBgPrefsState {
  editAllChats: boolean;
  setEditAllChats: (value: boolean) => void;
  /** Глобальные обои (применяются ко всем чатам по умолчанию): id из STOCK_WALLPAPERS или CUSTOM_* */
  globalStockWallpaper: string;

  /** Per-chat переопределения (если установлены свои обои в чате) */
  perChatOverrides: Record<string, WallpaperOverride>;

  /** Per-chat яркость фона (0..1, где 1 = полная яркость) */
  perChatBrightness: Record<string, number>;
  /**
   * Выбранные обои списка чатов ({ type:'photo'|'stock', value }). null — обоев
   * нет. Живут отдельно от perChatOverrides: см. CHAT_LIST_SCOPE.
   */
  chatListBg: WallpaperOverride | null;
  /** Затемнение фото под списком чатов, 0..1 (нужно, чтобы текст читался). */
  chatListDim: number;
  /** Размытие фото под списком чатов, px. */
  chatListBlur: number;

  /** Базовая яркость по умолчанию */
  defaultBrightness: number;

  /** Своё фото-обои, загруженное пользователем (dataURL) */
  userPhotoWallpaper: string | null;
  /** Имя файла своего фото-обоев */
  userPhotoName: string;
  /** Свои обои (несколько) по scope: chatId или 'global'. */
  userWallpapers: Record<string, UserWallpaperItem[]>;
  /** Storage-scope выбранного глобального видео (для нескольких своих видео). */
  globalLiveValue: string;
  /** Счётчик версий живых обоев — чтобы клиент перезагрузить видео из IndexedDB */
  liveBgStamp: number;

  // Actions
  setGlobalStockWallpaper: (id: string) => void;
  setUserPhotoWallpaper: (dataUrl: string, name: string) => void;
  clearUserPhotoWallpaper: () => void;
  bumpLiveBg: () => void;
  /** Добавить свои обои (фото/видео) в список scope. */
  addUserWallpaper: (scope: string, item: UserWallpaperItem) => void;
  /** Удалить свои обои из списка scope по id. */
  removeUserWallpaper: (scope: string, id: string) => void;
  /** Список своих обоев scope. */
  getUserWallpapers: (scope: string) => UserWallpaperItem[];
  /** Выбрать глобальное видео по его storage-scope. */
  setGlobalLiveWallpaper: (value: string) => void;
  /** Выбрать обои списка чатов (null — убрать). */
  setChatListBg: (value: WallpaperOverride | null) => void;
  /** Затемнение фото под списком чатов, 0..1. */
  setChatListDim: (value: number) => void;
  /** Размытие фото под списком чатов, px. */
  setChatListBlur: (value: number) => void;
  setChatWallpaper: (chatId: string, override: WallpaperOverride) => void;
  clearChatWallpaper: (chatId: string) => void;
  getChatWallpaper: (chatId: string) => ResolvedWallpaper | null;

  setBrightness: (chatId: string, v: number) => void;
  getBrightness: (chatId: string) => number;
}

export const useChatBgPrefsStore = create<ChatBgPrefsState>()(
  persist(
    (set, get) => ({
      editAllChats: false,
      setEditAllChats: (value) => set({ editAllChats: value }),
      globalStockWallpaper: 'none',
      perChatOverrides: {},
      perChatBrightness: {},
      chatListBg: null,
      chatListDim: 0.35,
      chatListBlur: 0,
      defaultBrightness: 0.65,
      userPhotoWallpaper: null,
      userPhotoName: '',
      userWallpapers: {},
      globalLiveValue: 'global',
      liveBgStamp: 0,

      setGlobalStockWallpaper: (id) => set({ globalStockWallpaper: id }),

      setUserPhotoWallpaper: (dataUrl, name) => set({ userPhotoWallpaper: dataUrl, userPhotoName: name }),
      clearUserPhotoWallpaper: () => set({ userPhotoWallpaper: null, userPhotoName: '' }),
      bumpLiveBg: () => set((s) => ({ liveBgStamp: s.liveBgStamp + 1 })),

      addUserWallpaper: (scope, item) => set((s) => ({
        userWallpapers: { ...s.userWallpapers, [scope]: [...(s.userWallpapers[scope] || []), item] },
      })),
      removeUserWallpaper: (scope, id) => set((s) => ({
        userWallpapers: { ...s.userWallpapers, [scope]: (s.userWallpapers[scope] || []).filter((i) => i.id !== id) },
      })),
      getUserWallpapers: (scope) => get().userWallpapers[scope] || [],
      setGlobalLiveWallpaper: (value) => set({ globalStockWallpaper: CUSTOM_LIVE_WALLPAPER_ID, globalLiveValue: value }),

      setChatListBg: (value) => set({ chatListBg: value }),
      setChatListDim: (value) => set({ chatListDim: Math.max(0, Math.min(1, value)) }),
      setChatListBlur: (value) => set({ chatListBlur: Math.max(0, Math.min(40, value)) }),

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
        if (globalId === CUSTOM_PHOTO_WALLPAPER_ID) {
          // Фото могли удалить, а id остаться. Раньше он уезжал дальше как
          // «стоковый» id, которого нет в каталоге, — и чат оставался вовсе
          // без фона. Теперь это просто «ничего не выбрано»: базовый фон темы
          // подставит вызывающий.
          return get().userPhotoWallpaper
            ? { type: 'photo', value: get().userPhotoWallpaper as string }
            : null;
        }
        if (globalId === CUSTOM_LIVE_WALLPAPER_ID) {
          return { type: 'live', value: get().globalLiveValue || 'global' };
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
    {
      name: 'vera-chat-bg-prefs',
      version: 3,
      // v3: одиночные «свои обои» превращаем в список (несколько обоев на чат).
      migrate: (persisted: any) => {
        const next = { ...(persisted || {}) };
        if (!next.userWallpapers || typeof next.userWallpapers !== 'object') next.userWallpapers = {};
        if (typeof next.globalLiveValue !== 'string') next.globalLiveValue = 'global';
        if (next.userPhotoWallpaper && !(next.userWallpapers.global || []).length) {
          next.userWallpapers = {
            ...next.userWallpapers,
            global: [{
              id: 'legacy-photo',
              name: next.userPhotoName || 'Моё фото',
              type: 'photo',
              value: next.userPhotoWallpaper,
              createdAt: Date.now(),
            }],
          };
        }
        return next;
      },
    }
  )
);

enableStoreSync('chat-bg-prefs', useChatBgPrefsStore);