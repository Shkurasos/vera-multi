import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type IconPack = 'filled' | 'outlined' | 'rounded' | 'sharp';
export type UiStyle = 'default' | 'rounded' | 'square' | 'glass' | 'compact';
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
