import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { creatorApi, CustomItem, CustomCategory, CustomSpec } from '../services/api';

/**
 * Магазин экипировки кастомных предметов (созданных авторами через «Мастерскую»).
 *
 * Хранит:
 *  - `items` — кэш опубликованных кастомных товаров (id -> item со `spec`),
 *    подгружается из `/api/shop/custom` на бут приложения и после покупки;
 *  - `equipped` — какой купленный кастом активирован в каждой категории.
 *    Значения — «короткие» id без префикса `custom:`.
 *
 * UI-компоненты (MessageBubble, Sidebar, ProfilePage, ChatWindow) читают
 * `getEquipped(category)` и рендерят `specToStyle(spec)`.
 */

export interface CustomEquipState {
  items: Record<string, CustomItem>;
  equipped: {
    profile?: string;
    selfcard?: string;
    wallpaper?: string;
    bubble?: string;
  };
  loaded: boolean;

  load: () => Promise<void>;
  upsertItem: (item: CustomItem) => void;
  setEquipped: (category: CustomCategory, id: string | undefined) => void;
  getEquipped: (category: CustomCategory) => CustomItem | undefined;
  getSpec: (category: CustomCategory) => CustomSpec | undefined;
}

export const useCustomEquipStore = create<CustomEquipState>()(
  persist(
    (set, get) => ({
      items: {},
      equipped: {},
      loaded: false,

      load: async () => {
        try {
          const { data } = await creatorApi.publicList();
          const map: Record<string, CustomItem> = {};
          for (const it of data.items) map[it.id] = it;
          set(s => ({ items: { ...s.items, ...map }, loaded: true }));
        } catch (e) {
          console.warn('[customEquip] load failed', e);
          set({ loaded: true });
        }
      },
      upsertItem: (item) => set(s => ({ items: { ...s.items, [item.id]: item } })),
      setEquipped: (category, id) => set(s => ({
        equipped: { ...s.equipped, [category]: id },
      })),
      getEquipped: (category) => {
        const id = get().equipped[category];
        if (!id) return undefined;
        return get().items[id];
      },
      getSpec: (category) => {
        const it = get().getEquipped(category);
        return it?.spec;
      },
    }),
    {
      name: 'vera-custom-equip',
      partialize: (s) => ({ equipped: s.equipped, items: s.items }),
    }
  )
);

/** Класс CSS-анимации для активного кастома данной категории (или ''). */
export function equippedAnimClass(category: CustomCategory): string {
  const spec = useCustomEquipStore.getState().getSpec(category);
  if (!spec || spec.animation === 'none') return '';
  return `vera-anim-${spec.animation}`;
}
