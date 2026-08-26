import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  | 'wallpaper';  // обои (умные, градиенты, жидкое стекло и т.д.)

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
    value: { type: 'daynight', mode: 'auto' }, previewColor: false },
  { id: 'theme-ambient', category: 'theme', name: 'Режим Ambience',
    description: 'Лёгкая цветовая подстройка темы под обои', applyKey: 'themeMode',
    value: { type: 'ambience' }, previewColor: false },

  // ── Обои (умные / динамические) ────────────────────────────────────────
  { id: 'wp-time', category: 'wallpaper', name: 'Умные обои по времени',
    description: 'Меняются утро/день/ночь автоматически', applyKey: 'smartWallpaper',
    value: { type: 'time' }, previewColor: false },
  { id: 'wp-parallax', category: 'wallpaper', name: 'Параллакс',
    description: 'Обои реагируют на наклон устройства', applyKey: 'smartWallpaper',
    value: { type: 'parallax' }, previewColor: false },
  { id: 'wp-touch', category: 'wallpaper', name: '«Жидкое стекло»',
    description: 'Обои реагируют на касания', applyKey: 'smartWallpaper',
    value: { type: 'touch' }, previewColor: false },
];

export type AvatarRingSetting = 'default' | 'rainbow' | 'glow';
export type SelfCardSetting = 'plain' | 'gradient' | 'badge';

export interface ShopState {
  /** Какие товары куплены (по умолчанию все бесплатные открыты). */
  owned: Record<string, boolean>;
  /** Скрывает UI новых платных-возможностей, пока продукт не готов. */
  enabled: boolean;
  /** Текущее состояние плашки-магазина (открыт/закрыт). */
  open: boolean;
  setOpen: (v: boolean) => void;

  /** id выбранной обводки аватара (из категории 'profile'). */
  activeRing: string;
  setActiveRing: (id: string) => void;
  /** id выбранной «плашки» своих сообщений (из категории 'selfcard'). */
  activeSelfCard: string;
  setActiveSelfCard: (id: string) => void;

  purchase: (id: string) => void;
  isOwned: (id: string) => boolean;
  toggleEnabled: () => void;
}

/** Кладёт активный выбор по категории: если это profile/selfcard — фиксирует его. */
export function selectShopItem(id: string): void {
  const item = SHOP_CATALOG.find(i => i.id === id);
  if (!item) return;
  if (item.category === 'profile') useShopStore.getState().setActiveRing(id);
  else if (item.category === 'selfcard') useShopStore.getState().setActiveSelfCard(id);
}

export const useShopStore = create<ShopState>()(
  persist(
    (set) => {
      // Дефолтные активные: первый элемент каждой подходящей категории.
      const defaultRing = SHOP_CATALOG.find(i => i.category === 'profile')?.id || 'ring-default';
      const defaultSelfCard = SHOP_CATALOG.find(i => i.category === 'selfcard')?.id || 'selfcard-default';
      const isOwned = (_id: string) => {
        // Пока всё открыто и бесплатно.
        return true;
      };
      return {
        owned: {},
        enabled: true,
        open: false,
        setOpen: (v) => set({ open: v }),
        activeRing: defaultRing,
        setActiveRing: (id) => set({ activeRing: id }),
        activeSelfCard: defaultSelfCard,
        setActiveSelfCard: (id) => set({ activeSelfCard: id }),
        purchase: (id) => set(s => ({ owned: { ...s.owned, [id]: true } })),
        isOwned,
        toggleEnabled: () => set(s => ({ enabled: !s.enabled })),
      };
    },
    { name: 'vera-shop', partialize: (s) => ({
        enabled: s.enabled,
        activeRing: s.activeRing,
        activeSelfCard: s.activeSelfCard,
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