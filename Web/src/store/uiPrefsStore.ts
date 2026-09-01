import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type IconPack = 'filled' | 'outlined' | 'rounded' | 'sharp';
export type UiStyle = 'default' | 'rounded' | 'square' | 'glass' | 'compact';

interface UiPrefsState {
  iconPack: IconPack;
  uiStyle: UiStyle;
  setIconPack: (p: IconPack) => void;
  setUiStyle: (s: UiStyle) => void;
}

export const ICON_PACKS: { id: IconPack; label: string; desc: string }[] = [
  { id: 'filled',   label: 'Filled',   desc: 'Классические залитые иконки (по умолчанию)' },
  { id: 'outlined', label: 'Outlined', desc: 'Тонкие контурные иконки' },
  { id: 'rounded',  label: 'Rounded',  desc: 'Скруглённые формы' },
  { id: 'sharp',    label: 'Sharp',    desc: 'Резкие углы' },
];

export const UI_STYLES: { id: UiStyle; label: string; desc: string }[] = [
  { id: 'default', label: 'По умолчанию', desc: 'Стандартный вид Vera' },
  { id: 'rounded', label: 'Скруглённый',  desc: 'Крупные радиусы у пузырей и кнопок' },
  { id: 'square',  label: 'Строгий',      desc: 'Прямые углы, минимализм' },
  { id: 'glass',   label: 'Glass',        desc: 'Прозрачность и размытие фона' },
  { id: 'compact', label: 'Компактный',   desc: 'Плотный интерфейс, меньше отступов' },
];

function applyToDom(iconPack: IconPack, uiStyle: UiStyle) {
  try {
    const el = document.documentElement;
    el.setAttribute('data-icon-pack', iconPack);
    el.setAttribute('data-ui-style', uiStyle);
  } catch {}
}

export const useUiPrefsStore = create<UiPrefsState>()(
  persist(
    (set) => ({
      iconPack: 'filled',
      uiStyle: 'default',
      setIconPack: (p) => { set({ iconPack: p }); applyToDom(p, useUiPrefsStore.getState().uiStyle); },
      setUiStyle: (s) => { set({ uiStyle: s }); applyToDom(useUiPrefsStore.getState().iconPack, s); },
    }),
    {
      name: 'vera-ui-prefs',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) applyToDom(state.iconPack, state.uiStyle);
      },
    }
  )
);

// Первичная синхронизация (persist может не успеть до первого рендера)
applyToDom(useUiPrefsStore.getState().iconPack, useUiPrefsStore.getState().uiStyle);
