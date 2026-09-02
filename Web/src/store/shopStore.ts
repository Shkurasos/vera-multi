import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { walletApi } from '../services/api';
import { RARITY_META, RARITY_ORDER } from '../utils/rarityStyles';
import { useAuthStore } from './authStore';

/**
 * МАГАЗИН VERA
 * Каталог закрытых возможностей, которые продаёт издатель (только мы).
 *
 * Сейчас ВСЕ товары бесплатные — это техническая основа. Позже поставим
 * цены и флаг платности, а покупку привяжем к аккаунту на сервере.
 * UI-замок уже работает: если товар не куплен, его настройка в редакторе
 * будет закрыта (заблокирована).
 */

export type ShopCategory =
  | 'profile'     // обводки аватара профиля
  | 'selfcard'    // кастомная «плашка» своих сообщений (видимая у других)
  | 'theme'       // режимы/варианты тем
  | 'wallpaper'   // обои (умные, градиенты, жидкое стекло и т.д.)
  | 'bubble';     // стили пузырей сообщений

export interface ShopItem {
  id: string;
  category: ShopCategory;
  name: string;
  description: string;
  /** Технический ключ, который применяется. Например avatarRing.gradient */
  applyKey: string;
  /** Конкретное значение, применяемое по applyKey (могут быть и UI-пресеты). */
  value: any;
  /** Графический превью-цвет для карточки магазина. */
  previewColor?: string | false;
  /** Пока всегда false — издатель ещё не назначил цены. */
  price?: number;
  /** Признак «показывать как купленное/активное». */
  ownedByDefault?: boolean;
  /** Уровень редкости (для платных ring/selfcard из линейки редкостей). */
  rarity?: import('../utils/rarityStyles').RarityTier;
}

/** Каталог — зашит в клиент, значит все товары принадлежат нам (издателю). */
export const SHOP_CATALOG: ShopItem[] = [
  // ── Обводка аватара профиля ────────────────────────────────────────────
  { id: 'ring-default', category: 'profile', name: 'Классическая обводка',
    description: 'Простой акцентный ободок вокруг аватара', applyKey: 'avatarRing',
    value: { type: 'solid' }, previewColor: '#ff4870' },
  { id: 'ring-rainbow', category: 'profile', name: 'Радужный градиент',
    description: 'Плавно переливающаяся разноцветная обводка', applyKey: 'avatarRing',
    value: { type: 'gradient', gradient: 'linear-gradient(90deg,#ff4870,#ff914d,#ffd54f,#4dff88,#4dd0ff,#a04dff,#ff4870)' },
    previewColor: 'linear-gradient(90deg,#ff4870,#ffd54f,#4dd0ff,#a04dff)' },
  { id: 'ring-glow', category: 'profile', name: 'Неоновое свечение',
    description: 'Светящаяся обводка с мягким glow', applyKey: 'avatarRing',
    value: { type: 'glow', glow: true, color: '#00e5ff' }, previewColor: '#00e5ff' },

  // ── Кастомная плашка своих сообщений (видна у других) ──────────────────
  { id: 'selfcard-default', category: 'selfcard', name: 'Стандартная плашка',
    description: 'Обычная подпись «Вы» под вашими сообщениями', applyKey: 'selfCard',
    value: { type: 'plain' }, previewColor: false },
  { id: 'selfcard-gradient', category: 'selfcard', name: 'Градиентная плашка',
    description: 'Цветная градиентная подпись вашего имени/«Вы»', applyKey: 'selfCard',
    value: { type: 'gradient', gradient: 'linear-gradient(90deg,#ff4870,#ff9d4d)' }, previewColor: 'linear-gradient(90deg,#ff4870,#ff9d4d)' },
  { id: 'selfcard-badge', category: 'selfcard', name: 'Бейдж-плашка',
    description: 'Подпись оформлена как маленький бейдж', applyKey: 'selfCard',
    value: { type: 'badge' }, previewColor: false },

  // ── Режимы тем ─────────────────────────────────────────────────────────
  { id: 'theme-auto-daynight', category: 'theme', name: 'Авто день/ночь',
    description: 'Тема автоматически меняется по времени суток', applyKey: 'themeMode',
    value: { type: 'daynight', mode: 'auto' }, previewColor: false, price: 0 },
  { id: 'theme-ambient', category: 'theme', name: 'Режим Ambience',
    description: 'Лёгкая цветовая подстройка темы под обои', applyKey: 'themeMode',
    value: { type: 'ambience' }, previewColor: false, price: 0 },

  // ── Обои (умные / динамические) — ПЛАТНЫЕ ─────────────────────────────
  { id: 'wp-time', category: 'wallpaper', name: 'Умные обои по времени',
    description: 'Обои сами меняются утро/день/вечер/ночь (продаётся издателем)', applyKey: 'smartWallpaper',
    value: { type: 'time' }, previewColor: false, price: 120, ownedByDefault: false },
  { id: 'wp-parallax', category: 'wallpaper', name: 'Параллакс',
    description: 'Обои реагируют на наклон устройства (продаётся издателем)', applyKey: 'smartWallpaper',
    value: { type: 'parallax' }, previewColor: false, price: 180, ownedByDefault: false },
  { id: 'wp-touch', category: 'wallpaper', name: '«Жидкое стекло»',
    description: 'Обои реагируют на касания (продаётся издателем)', applyKey: 'smartWallpaper',
    value: { type: 'touch' }, previewColor: false, price: 200, ownedByDefault: false },

  // ── Персональные темы для контактов — ПЛАТНЫЕ ─────────────────────────
  { id: 'chat-theme', category: 'theme', name: 'Персональные темы',
    description: 'Свой фон и цвет пузырей для каждого чата отдельно (продаётся издателем)',
    applyKey: 'perChatTheme', value: { type: 'perchat' },
    previewColor: 'linear-gradient(90deg,#4dd0ff,#a04dff,#ff4870)', price: 250, ownedByDefault: false },

  // ── Стили пузырей сообщений — ПЛАТНЫЕ ──────────────────────────────────────
  { id: 'bubble-neon', category: 'bubble', name: 'Неоновые пузыри',
    description: 'Пузыри с неоновой подсветкой краёв', applyKey: 'bubbleStyle',
    value: { type: 'neon' }, previewColor: '#00e5ff', price: 150 },
  { id: 'bubble-glass', category: 'bubble', name: 'Стеклянные пузыри',
    description: 'Frosted glass — полупрозрачные пузыри с размытием', applyKey: 'bubbleStyle',
    value: { type: 'glass' }, previewColor: 'rgba(255,255,255,0.18)', price: 180 },
  { id: 'bubble-shadow', category: 'bubble', name: 'Глубокая тень',
    description: 'Пузыри с объёмной тенью и поднятым эффектом', applyKey: 'bubbleStyle',
    value: { type: 'shadow' }, previewColor: '#1a1a2e', price: 120 },
  { id: 'bubble-gradient-sunset', category: 'bubble', name: 'Пузыри Закат',
    description: 'Пузыри с градиентом тёплого заката', applyKey: 'bubbleStyle',
    value: { type: 'gradient', gradient: 'linear-gradient(135deg,#f7971e,#ffd200,#ff4870)' },
    previewColor: 'linear-gradient(135deg,#f7971e,#ff4870)', price: 200 },
  { id: 'bubble-gradient-ocean', category: 'bubble', name: 'Пузыри Океан',
    description: 'Пузыри с морским голубым градиентом', applyKey: 'bubbleStyle',
    value: { type: 'gradient', gradient: 'linear-gradient(135deg,#0575e6,#021b79)' },
    previewColor: 'linear-gradient(135deg,#0575e6,#021b79)', price: 200 },
  { id: 'bubble-gradient-forest', category: 'bubble', name: 'Пузыри Лес',
    description: 'Пузыри с зелёным лесным градиентом', applyKey: 'bubbleStyle',
    value: { type: 'gradient', gradient: 'linear-gradient(135deg,#134e5e,#71b280)' },
    previewColor: 'linear-gradient(135deg,#134e5e,#71b280)', price: 200 },
  { id: 'bubble-minimal', category: 'bubble', name: 'Минимализм',
    description: 'Тонкая рамка вместо заливки — ультра-чистый вид', applyKey: 'bubbleStyle',
    value: { type: 'minimal' }, previewColor: false, price: 90 },
  { id: 'bubble-rounded', category: 'bubble', name: 'Мягкие пузыри',
    description: 'Максимальное скругление углов — pill-форма', applyKey: 'bubbleStyle',
    value: { type: 'rounded' }, previewColor: false, price: 100 },
  { id: 'bubble-sharp', category: 'bubble', name: 'Острые углы',
    description: 'Прямые острые углы — брутальный стиль', applyKey: 'bubbleStyle',
    value: { type: 'sharp' }, previewColor: false, price: 100 },
  { id: 'bubble-retro', category: 'bubble', name: 'Ретро',
    description: 'Пузыри в стиле SMS-эпохи с хвостиком', applyKey: 'bubbleStyle',
    value: { type: 'retro' }, previewColor: '#fffde7', price: 130 },
  { id: 'bubble-candy', category: 'bubble', name: 'Конфеты',
    description: 'Яркие пастельные цвета каждого пузыря', applyKey: 'bubbleStyle',
    value: { type: 'candy' }, previewColor: 'linear-gradient(90deg,#f9a8d4,#a5f3fc,#bbf7d0)', price: 160 },
  { id: 'bubble-mono', category: 'bubble', name: 'Монохром',
    description: 'Чёрно-белые пузыри с сильным контрастом', applyKey: 'bubbleStyle',
    value: { type: 'mono' }, previewColor: '#e5e5e5', price: 110 },
  { id: 'bubble-aurora', category: 'bubble', name: 'Аврора',
    description: 'Переливающийся северный свет в каждом пузыре', applyKey: 'bubbleStyle',
    value: { type: 'aurora' },
    previewColor: 'linear-gradient(135deg,#43e97b,#38f9d7,#4facfe,#a18cd1)', price: 220 },
  { id: 'bubble-cyber', category: 'bubble', name: 'Кибер',
    description: 'Кибер-панк: неон + тёмный фон + рамка', applyKey: 'bubbleStyle',
    value: { type: 'cyber' }, previewColor: '#0d0d1a', price: 240 },

  // ── Дополнительные обои — ПЛАТНЫЕ ─────────────────────────────────────────
  { id: 'wp-gradient-fire', category: 'wallpaper', name: 'Обои Огонь',
    description: 'Тёплый огненный градиент фона чата', applyKey: 'smartWallpaper',
    value: { type: 'gradient', gradient: 'linear-gradient(160deg,#f7971e 0%,#ff4870 100%)' },
    previewColor: 'linear-gradient(160deg,#f7971e,#ff4870)', price: 90 },
  { id: 'wp-gradient-ocean', category: 'wallpaper', name: 'Обои Океан',
    description: 'Морской градиент от бирюзы до тёмно-синего', applyKey: 'smartWallpaper',
    value: { type: 'gradient', gradient: 'linear-gradient(160deg,#0575e6 0%,#021b79 100%)' },
    previewColor: 'linear-gradient(160deg,#0575e6,#021b79)', price: 90 },
  { id: 'wp-gradient-forest', category: 'wallpaper', name: 'Обои Лес',
    description: 'Спокойный зелёный градиент', applyKey: 'smartWallpaper',
    value: { type: 'gradient', gradient: 'linear-gradient(160deg,#134e5e 0%,#71b280 100%)' },
    previewColor: 'linear-gradient(160deg,#134e5e,#71b280)', price: 90 },
  { id: 'wp-gradient-cosmic', category: 'wallpaper', name: 'Обои Космос',
    description: 'Тёмный космический градиент с фиолетовым', applyKey: 'smartWallpaper',
    value: { type: 'gradient', gradient: 'linear-gradient(160deg,#0f0c29 0%,#302b63 50%,#24243e 100%)' },
    previewColor: 'linear-gradient(160deg,#0f0c29,#302b63,#24243e)', price: 110 },
  { id: 'wp-gradient-candy', category: 'wallpaper', name: 'Обои Конфета',
    description: 'Яркий пастельный градиент', applyKey: 'smartWallpaper',
    value: { type: 'gradient', gradient: 'linear-gradient(160deg,#f9a8d4 0%,#a5f3fc 50%,#bbf7d0 100%)' },
    previewColor: 'linear-gradient(160deg,#f9a8d4,#a5f3fc,#bbf7d0)', price: 90 },
  { id: 'wp-particles', category: 'wallpaper', name: 'Частицы',
    description: 'Анимированные летящие частицы на фоне', applyKey: 'smartWallpaper',
    value: { type: 'particles' }, previewColor: false, price: 160 },
  { id: 'wp-waves', category: 'wallpaper', name: 'Волны',
    description: 'Плавно анимированные волны на фоне чата', applyKey: 'smartWallpaper',
    value: { type: 'waves' }, previewColor: 'linear-gradient(90deg,#4dd0ff,#4d88ff)', price: 140 },
  { id: 'wp-grid', category: 'wallpaper', name: 'Сетка',
    description: 'Тонкая сетка в стиле технических чертежей', applyKey: 'smartWallpaper',
    value: { type: 'grid' }, previewColor: false, price: 80 },
  { id: 'wp-dots-animate', category: 'wallpaper', name: 'Живые точки',
    description: 'Анимированные плавающие точки на фоне', applyKey: 'smartWallpaper',
    value: { type: 'dots-animate' }, previewColor: false, price: 130 },
  { id: 'wp-aurora', category: 'wallpaper', name: 'Северное сияние',
    description: 'Живое северное сияние на фоне чата', applyKey: 'smartWallpaper',
    value: { type: 'aurora' },
    previewColor: 'linear-gradient(160deg,#43e97b,#38f9d7,#4facfe)', price: 250 },
  { id: 'wp-matrix', category: 'wallpaper', name: 'Матрица',
    description: 'Зелёные символы падают как в фильме', applyKey: 'smartWallpaper',
    value: { type: 'matrix' }, previewColor: '#001a00', price: 200 },
  { id: 'wp-snow', category: 'wallpaper', name: 'Снегопад',
    description: 'Медленно падающий снег на фоне', applyKey: 'smartWallpaper',
    value: { type: 'snow' }, previewColor: '#e8f4fd', price: 150 },
  { id: 'wp-rain', category: 'wallpaper', name: 'Дождь',
    description: 'Анимированный дождь по стеклу', applyKey: 'smartWallpaper',
    value: { type: 'rain' }, previewColor: '#1a2a3a', price: 150 },
  { id: 'wp-stars', category: 'wallpaper', name: 'Звёздное небо',
    description: 'Мерцающие звёзды на ночном небе', applyKey: 'smartWallpaper',
    value: { type: 'stars' }, previewColor: '#0a0a1a', price: 180 },
  { id: 'wp-noise', category: 'wallpaper', name: 'Шум-плёнка',
    description: 'Плёночный шум поверх фона — киношный вид', applyKey: 'smartWallpaper',
    value: { type: 'noise' }, previewColor: '#2a2a2a', price: 100 },
  { id: 'wp-blob', category: 'wallpaper', name: 'Живые блобы',
    description: 'Мягкие цветные капли плавают по фону', applyKey: 'smartWallpaper',
    value: { type: 'blob' },
    previewColor: 'linear-gradient(135deg,#a18cd1,#fbc2eb)', price: 170 },
];

// ─── Линейка редкостей (21×2 = 42 платных предмета) ────────────────────────
// Генерируется из RARITY_META (общий источник истины для UI-стилей и цен).
// id: `ring-r-<rarity>` / `selfcard-r-<rarity>` — префикс `-r-` защищает от
// коллизий со старыми `ring-default` / `selfcard-default`.
for (const r of RARITY_ORDER) {
  const meta = RARITY_META[r];
  SHOP_CATALOG.push({
    id: `ring-r-${r}`, category: 'profile',
    name: `Обводка «${meta.codename}»`,
    description: `${meta.label} редкость — стиль ${meta.codename}`,
    applyKey: 'avatarRing',
    value: { type: 'rarity', rarity: r },
    previewColor: meta.color,
    price: meta.price,
    rarity: r,
  });
  SHOP_CATALOG.push({
    id: `selfcard-r-${r}`, category: 'selfcard',
    name: `Плашка «${meta.codename}»`,
    description: `${meta.label} редкость — плашка своих сообщений`,
    applyKey: 'selfCard',
    value: { type: 'rarity', rarity: r },
    previewColor: meta.color,
    price: meta.price,
    rarity: r,
  });
}

/** Валюта магазина — «Вера-баллы» (пока виртуальные, покупка локальная). */
export const SHOP_CURRENCY = 'ВП';

export type AvatarRingSetting = 'default' | 'rainbow' | 'glow';
export type SelfCardSetting = 'plain' | 'gradient' | 'badge';

export type ShopTab = 'inventory' | 'shop';

export interface ShopState {
  /** Какие товары куплены (по умолчанию все бесплатные открыты). */
  owned: Record<string, boolean>;
  /** Текущий баланс ВП (с сервера). */
  balanceVp: number;
  /** Скрывает UI новых платных-возможностей, пока продукт не готов. */
  enabled: boolean;
  /** Текущее состояние плашки-магазина (открыт/закрыт). */
  open: boolean;
  /** Активная вкладка магазина (инвентарь / витрина). */
  tab: ShopTab;
  setOpen: (v: boolean) => void;
  setTab: (t: ShopTab) => void;

  /** id выбранной обводки аватара (из категории 'profile'). */
  activeRing: string;
  setActiveRing: (id: string) => void;
  /** id выбранной «плашки» своих сообщений (из категории 'selfcard'). */
  activeSelfCard: string;
  setActiveSelfCard: (id: string) => void;
  /** id выбранных умных обоев ('' = выключено, т.е. без смарт-обоев). */
  activeWallpaper: string;
  setActiveWallpaper: (id: string) => void;
  /** id выбранного стиля пузырей ('' = стандартные пузыри темы). */
  activeBubble: string;
  setActiveBubble: (id: string) => void;

  purchase: (id: string) => Promise<void>;
  isOwned: (id: string) => boolean;
  toggleEnabled: () => void;

  /** Загрузить баланс + купленное с сервера (при открытии магазина / после входа). */
  loadWallet: () => Promise<void>;
  /** Обновить баланс с сервера (событие wallet:updated). */
  setBalance: (n: number) => void;
  /** Влить купленные товары от сервера (событие shop:owned / ответ покупки). */
  mergeOwned: (ids: string[]) => void;
}

/** Кладёт активный выбор по категории: если это profile/selfcard — фиксирует его. */
export function selectShopItem(id: string): void {
  const item = SHOP_CATALOG.find(i => i.id === id);
  if (!item) return;
  if (item.category === 'profile') useShopStore.getState().setActiveRing(id);
  else if (item.category === 'selfcard') useShopStore.getState().setActiveSelfCard(id);
  else if (item.category === 'wallpaper') useShopStore.getState().setActiveWallpaper(id);
  else if (item.category === 'bubble') useShopStore.getState().setActiveBubble(id);
}

export const useShopStore = create<ShopState>()(
  persist(
    (set, get) => {
      const isOwned = (id: string) => {
        const item = SHOP_CATALOG.find(i => i.id === id);
        if (!item) return false;
        // Dev-режим: всё открыто.
        try {
          if (useAuthStore.getState().user?.isDev) return true;
        } catch {}
        // Бесплатные (price: 0) и дефолтные открыты всегда; платные — только после purchase().
        if (item.ownedByDefault || !item.price || item.price <= 0) return true;
        return !!get().owned[id];
      };
      return {
        owned: {},
        balanceVp: 0,
        enabled: true,
        open: false,
        setOpen: (v) => set({ open: v }),
        tab: 'inventory',
        setTab: (t) => set({ tab: t }),
        activeRing: 'ring-default',
        setActiveRing: (id) => set({ activeRing: id }),
        activeSelfCard: 'selfcard-default',
        setActiveSelfCard: (id) => set({ activeSelfCard: id }),
        activeWallpaper: '',
        setActiveWallpaper: (id) => set({ activeWallpaper: id }),
        activeBubble: '',
        setActiveBubble: (id) => set({ activeBubble: id }),
        purchase: async (id) => {
          const item = SHOP_CATALOG.find(i => i.id === id);
          if (!item) return;
          const price = item.price && item.price > 0 ? item.price : 0;
          if (price > 0) {
            // Платная покупка — списываем ВП на сервере.
            const { data } = await walletApi.buy(id);
            set(s => ({
              balanceVp: data.balance,
              owned: { ...s.owned, [id]: true },
            }));
            return;
          }
          // Бесплатные открываются сразу.
          set(s => ({ owned: { ...s.owned, [id]: true } }));
        },
        loadWallet: async () => {
          try {
            const { data } = await walletApi.get();
            const serverOwned: string[] = Array.isArray(data.ownedItems) ? data.ownedItems : [];
            set(s => ({
              balanceVp: typeof data.balance === 'number' ? data.balance : 0,
              owned: { ...s.owned, ...Object.fromEntries(serverOwned.map((oid) => [oid, true])) },
            }));
          } catch (err) {
            console.warn('[shop] loadWallet failed:', err);
          }
        },
        setBalance: (n) => set({ balanceVp: n }),
        mergeOwned: (ids) => set(s => ({
          owned: { ...s.owned, ...Object.fromEntries(ids.map((id) => [id, true])) },
        })),
        isOwned,
        toggleEnabled: () => set(s => ({ enabled: !s.enabled })),
      };
    },
    { name: 'vera-shop', partialize: (s) => ({
        enabled: s.enabled,
        activeRing: s.activeRing,
        activeSelfCard: s.activeSelfCard,
        activeWallpaper: s.activeWallpaper,
        activeBubble: s.activeBubble,
        owned: s.owned,
        balanceVp: s.balanceVp,
      }) }
  )
);

/** Возвращает активную обводку аватара (item + value) или null. */
export function getActiveRing(): (ShopItem | undefined) {
  return SHOP_CATALOG.find(i => i.applyKey === 'avatarRing' && i.id === useShopStore.getState().activeRing);
}
/** Возвращает активную плашку своих сообщений или null. */
export function getActiveSelfCard(): (ShopItem | undefined) {
  return SHOP_CATALOG.find(i => i.applyKey === 'selfCard' && i.id === useShopStore.getState().activeSelfCard);
}