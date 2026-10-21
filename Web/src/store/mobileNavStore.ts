import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_DESKTOP_NAV_ORDER, DEFAULT_NAV_ORDER, moveNavKey, normalizeNavOrder, type NavKey,
} from '../utils/mobileNav';

/** Порядок кнопок нижней навигации на телефоне (меняется удержанием кнопки). */
// На ПК те же кнопки живут в нижней панели сайдбара и двигаются зажатой мышкой.
// Порядок у ПК свой: раскладка там другая, и у панелей разные порядки по умолчанию.
interface MobileNavState {
  order: NavKey[];
  move: (key: NavKey, target: NavKey) => void;
  reset: () => void;
  desktopOrder: NavKey[];
  moveDesktop: (key: NavKey, target: NavKey) => void;
  resetDesktop: () => void;
}

export const useMobileNavStore = create<MobileNavState>()(
  persist(
    (set) => ({
      order: [...DEFAULT_NAV_ORDER],
      move: (key, target) => set((s) => ({ order: moveNavKey(s.order, key, target) })),
      reset: () => set({ order: [...DEFAULT_NAV_ORDER] }),
      desktopOrder: [...DEFAULT_DESKTOP_NAV_ORDER],
      moveDesktop: (key, target) => set((s) => ({ desktopOrder: moveNavKey(s.desktopOrder, key, target) })),
      resetDesktop: () => set({ desktopOrder: [...DEFAULT_DESKTOP_NAV_ORDER] }),
    }),
    {
      name: 'vera-mobile-nav',
      partialize: (s) => ({ order: s.order, desktopOrder: s.desktopOrder }),
      // Сохранённый порядок мог устареть или испортиться: чиним при загрузке.
      merge: (persisted, current) => {
        const p = persisted as Partial<MobileNavState> | undefined;
        return {
          ...current,
          order: normalizeNavOrder(p?.order, DEFAULT_NAV_ORDER),
          desktopOrder: normalizeNavOrder(p?.desktopOrder, DEFAULT_DESKTOP_NAV_ORDER),
        };
      },
    }
  )
);
