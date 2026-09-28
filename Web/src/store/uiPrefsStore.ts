import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type IconPack = 'filled' | 'outlined' | 'rounded' | 'sharp' | 'twoTone';
export type UiStyle = 'default' | 'rounded' | 'square' | 'glass' | 'compact' | 'flat';
/** Вид карточек чатов в списке слева: насколько скруглены углы. */
export type ChatShape = 'vera' | 'telegram' | 'vk';

interface UiPrefsState {
  iconPack: IconPack;
  uiStyle: UiStyle;
  chatShape: ChatShape;
  /** Обводка карточек чатов: false — убирает рамку совсем. */
  chatBorder: boolean;
  /** Заливка карточек чатов: false — строка становится простой полосой. */
  chatFill: boolean;
  setIconPack: (p: IconPack) => void;
  setUiStyle: (s: UiStyle) => void;
  setChatShape: (s: ChatShape) => void;
  setChatBorder: (v: boolean) => void;
  setChatFill: (v: boolean) => void;
}

export const ICON_PACKS: { id: IconPack; label: string; desc: string }[] = [
  { id: 'filled',   label: 'Залитые',  desc: 'Плотные классические иконки (по умолчанию)' },
  { id: 'outlined', label: 'Контурные', desc: 'Тонкие линии без заливки' },
  { id: 'rounded',  label: 'Скруглённые', desc: 'Мягкие формы со скруглёнными углами' },
  { id: 'sharp',    label: 'Резкие',   desc: 'Прямые углы, строгая геометрия' },
  { id: 'twoTone',  label: 'Двухслойные', desc: 'Контур с полупрозрачной заливкой — «объём» без потери формы' },
];

export const UI_STYLES: { id: UiStyle; label: string; desc: string }[] = [
  { id: 'default', label: 'По умолчанию', desc: 'Стандартный вид Vera' },
  { id: 'rounded', label: 'Скруглённый',  desc: 'Крупные радиусы у пузырей и кнопок' },
  { id: 'square',  label: 'Строгий',      desc: 'Прямые углы, минимализм' },
  { id: 'glass',   label: 'Glass',        desc: 'Прозрачность и размытие фона' },
  { id: 'flat',    label: 'Плоский',      desc: 'Без теней: только заливка и границы' },
  { id: 'compact', label: 'Компактный',   desc: 'Плотный интерфейс, меньше отступов' },
];

/**
 * Радиусы поверхностей для скруглённого и строгого стилей.
 *
 * Раньше правила касались только кнопок, полей и бумаги, поэтому стиль
 * выглядел наполовину применённым: у вкладок, чипов, переключателей и
 * выпадающих списков оставались свои радиусы. Список задан один раз, а CSS
 * в main.tsx разворачивается из него — одна правка меняет весь стиль.
 *
 * Числа — в пикселях: MUI умножает числовой borderRadius в sx на 18, но здесь
 * это обычный CSS, где значение трактуется буквально.
 */
export const UI_STYLE_RADII: Record<'rounded' | 'square', Record<string, number>> = {
  rounded: {
    '.MuiPaper-root': 24,          // диалоги, меню, поповеры
    '.MuiCard-root': 24,
    '.MuiButton-root': 999,        // «таблетки»
    '.MuiChip-root': 999,
    '.MuiIconButton-root': 16,
    '.MuiToggleButton-root': 999,
    '.MuiOutlinedInput-root': 999,
    '.MuiInputBase-root': 999,
    '.MuiListItemButton-root': 18,
    '.MuiListItem-root': 18,
    '.MuiMenuItem-root': 12,
    '.MuiTooltip-tooltip': 12,
    '.MuiBadge-badge': 999,
    '.MuiLinearProgress-root': 999,
    '.MuiAvatar-root': 999,
  },
  square: {
    '.MuiPaper-root': 4,
    '.MuiCard-root': 4,
    '.MuiButton-root': 4,
    '.MuiChip-root': 4,
    '.MuiIconButton-root': 4,
    '.MuiToggleButton-root': 4,
    '.MuiOutlinedInput-root': 4,
    '.MuiInputBase-root': 4,
    '.MuiListItemButton-root': 4,
    '.MuiListItem-root': 4,
    '.MuiMenuItem-root': 2,
    '.MuiTooltip-tooltip': 4,
    '.MuiBadge-badge': 4,
    '.MuiLinearProgress-root': 4,
    '.MuiAvatar-root': 6,
  },
};

/** Поверхности, с которых снимаются тени в стиле «Плоский». */
export const UI_STYLE_FLAT_TARGETS = [
  '.MuiPaper-root', '.MuiCard-root', '.MuiButton-root', '.MuiChip-root',
  '.MuiIconButton-root', '.MuiMenuItem-root', '.MuiListItemButton-root',
  '.MuiToggleButton-root', '.MuiTooltip-tooltip', '.MuiLinearProgress-root',
];

// Радиусы — в пикселях, как их видит браузер. В sx числовой borderRadius
// умножается на theme.shape.borderRadius (18), поэтому карточка чата с
// `borderRadius: 3.5` реально скруглена на 63 px. Здесь пишем готовые px,
// чтобы значения совпадали с тем, что видно. Названия — по форме угла,
// чтобы не привязываться к конкретным приложениям.
export const CHAT_SHAPES: { id: ChatShape; label: string; desc: string; radius: number }[] = [
  { id: 'vera',     label: 'Круглые', desc: 'Сильное скругление, карточки-таблетки (63 px)', radius: 63 },
  { id: 'telegram', label: 'Умеренные', desc: 'Среднее скругление (14 px)', radius: 14 },
  { id: 'vk',       label: 'Прямые', desc: 'Почти без скругления (4 px)', radius: 4 },
];

function applyToDom(iconPack: IconPack, uiStyle: UiStyle, chatShape: ChatShape, chatBorder: boolean, chatFill: boolean) {
  try {
    const el = document.documentElement;
    el.setAttribute('data-icon-pack', iconPack);
    el.setAttribute('data-ui-style', uiStyle);
    el.setAttribute('data-chat-shape', chatShape);
    // Явные on/off вместо удаления атрибута: так «выключено» нельзя спутать
    // с «настройка ещё не применилась».
    el.setAttribute('data-chat-border', chatBorder ? 'on' : 'off');
    el.setAttribute('data-chat-fill', chatFill ? 'on' : 'off');
  } catch {}
}

export const useUiPrefsStore = create<UiPrefsState>()(
  persist(
    (set) => ({
      iconPack: 'filled',
      uiStyle: 'default',
      chatShape: 'vera',
      chatBorder: true,
      chatFill: true,
      setIconPack: (p) => { set({ iconPack: p }); applyAll(); },
      setUiStyle: (s) => { set({ uiStyle: s }); applyAll(); },
      setChatShape: (s) => { set({ chatShape: s }); applyAll(); },
      setChatBorder: (v) => { set({ chatBorder: v }); applyAll(); },
      setChatFill: (v) => { set({ chatFill: v }); applyAll(); },
    }),
    {
      name: 'vera-ui-prefs',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) applyToDom(state.iconPack, state.uiStyle, state.chatShape, state.chatBorder !== false, state.chatFill !== false);
      },
    }
  )
);

/**
 * Проставляет все data-атрибуты из текущего состояния.
 * Вызывается сразу после set(), поэтому состояние уже новое — перечитываем
 * целиком, чтобы не забыть про новую настройку при добавлении следующей.
 */
function applyAll() {
  const s = useUiPrefsStore.getState();
  applyToDom(s.iconPack, s.uiStyle, s.chatShape, s.chatBorder, s.chatFill);
}

// Первичная синхронизация (persist может не успеть до первого рендера)
{
  const s = useUiPrefsStore.getState();
  applyToDom(s.iconPack, s.uiStyle, s.chatShape, s.chatBorder, s.chatFill);
}
