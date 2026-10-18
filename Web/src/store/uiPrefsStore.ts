import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Базовые варианты MUI: из них шим берёт саму форму иконки. */
export type BaseIconPack = 'filled' | 'outlined' | 'rounded' | 'sharp' | 'twoTone';
/**
 * Стилевые паки: форма берётся из базового варианта (ICON_PACK_BASE), а вид
 * задаёт свой слой — SVG-фильтры (IconPackDefs) и CSS по классу `vera-ico`
 * в main.tsx. Поэтому стиль ложится сразу на все иконки шима.
 */
export type StyledIconPack = 'relief' | 'puffy' | 'sticker' | 'neon' | 'tile';
export type IconPack = BaseIconPack | StyledIconPack;

/** Какую форму MUI берёт каждый пак. */
export const ICON_PACK_BASE: Record<IconPack, BaseIconPack> = {
  filled: 'filled', outlined: 'outlined', rounded: 'rounded', sharp: 'sharp', twoTone: 'twoTone',
  relief: 'filled', puffy: 'rounded', sticker: 'filled', neon: 'outlined', tile: 'rounded',
};
/**
 * Прежние стили-кнопки. Сейчас стиль интерфейса — это ползунки радиусов и
 * переключатели режимов, а поле осталось для совместимости: старые темы и
 * пресеты хранят его, и setUiStyle переводит значение в ползунки/режимы
 * (LEGACY_UI_STYLES). 'squircle' — «свои значения».
 */
export type UiStyle = 'default' | 'rounded' | 'square' | 'squircle' | 'glass' | 'compact' | 'flat';

/**
 * Радиусы стиля интерфейса — задаются ползунками.
 * surface/bubble — в px, avatar — в % (50% = круг, 0% = квадрат).
 */
export interface SquircleRadii { surface: number; avatar: number; bubble: number; profile: number }
export const SQUIRCLE_LIMITS = {
  surface: { min: 0, max: 32, def: 12 },
  // Плашки страницы профиля — отдельно от основного экрана.
  profile: { min: 0, max: 32, def: 12 },
  avatar: { min: 0, max: 50, def: 50 },
  bubble: { min: 0, max: 30, def: 14 },
} as const;
const clampRadius = (key: keyof SquircleRadii, v: unknown) => {
  const { min, max, def } = SQUIRCLE_LIMITS[key];
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const defaultRadii = (): SquircleRadii => ({
  surface: SQUIRCLE_LIMITS.surface.def, avatar: SQUIRCLE_LIMITS.avatar.def, bubble: SQUIRCLE_LIMITS.bubble.def,
  profile: SQUIRCLE_LIMITS.profile.def,
});

/** Режимы, которые включаются переключателями поверх радиусов. */
export interface UiModes { glass: boolean; flat: boolean; compact: boolean }
export const UI_MODES: { id: keyof UiModes; label: string; desc: string }[] = [
  { id: 'glass',   label: 'Glass',      desc: 'Прозрачность и размытие фона' },
  { id: 'flat',    label: 'Плоский',    desc: 'Без теней: только заливка и границы' },
  { id: 'compact', label: 'Компактный', desc: 'Плотный интерфейс, меньше отступов' },
];
const NO_MODES: UiModes = { glass: false, flat: false, compact: false };

/**
 * Как прежние стили-кнопки раскладываются на ползунки и режимы.
 * radii: null — оставить текущие ползунки («Полускруглённый» уже был ими).
 */
export const LEGACY_UI_STYLES: Record<UiStyle, { radii: SquircleRadii | null; modes: UiModes }> = {
  default:  { radii: defaultRadii(), modes: NO_MODES },
  rounded:  { radii: { surface: 24, avatar: 50, bubble: 26, profile: 24 }, modes: NO_MODES },
  square:   { radii: { surface: 4, avatar: 12, bubble: 4, profile: 4 }, modes: NO_MODES },
  squircle: { radii: null, modes: NO_MODES },
  glass:    { radii: defaultRadii(), modes: { ...NO_MODES, glass: true } },
  flat:     { radii: defaultRadii(), modes: { ...NO_MODES, flat: true } },
  compact:  { radii: defaultRadii(), modes: { ...NO_MODES, compact: true } },
};

/**
 * Переключатели рисуются «квадратиками» (○ / ✕), когда углы интерфейса —
 * от прямых (0px) до скруглённого квадрата. Почти круглые углы (больше max)
 * оставляют базовый вид MUI. При 0px CSS всё равно держит минимальное
 * скругление дорожки (4px) и бегунка (3px), чтобы ✕/○ не упирались в край.
 */
export const SQUIRCLE_SWITCH_RANGE = { min: 0, max: 20 } as const;
export function switchStyleFor(surface: number): 'squircle' | 'base' {
  return surface >= SQUIRCLE_SWITCH_RANGE.min && surface <= SQUIRCLE_SWITCH_RANGE.max ? 'squircle' : 'base';
}
/** Вид карточек чатов в списке слева: насколько скруглены углы. */
export type ChatShape = 'vera' | 'telegram' | 'vk';

interface UiPrefsState {
  iconPack: IconPack;
  /** id своего пака (iconPackStore) поверх iconPack, либо null — без замен. */
  customPack: string | null;
  uiStyle: UiStyle;
  chatShape: ChatShape;
  /** Обводка карточек чатов: false — убирает рамку совсем. */
  chatBorder: boolean;
  /** Заливка карточек чатов: false — строка становится простой полосой. */
  chatFill: boolean;
  /** Ползунки стиля интерфейса. */
  squircle: SquircleRadii;
  /** Переключатели режимов стиля интерфейса. */
  uiModes: UiModes;
  setUiMode: (key: keyof UiModes, v: boolean) => void;
  setIconPack: (p: IconPack) => void;
  setCustomPack: (id: string | null) => void;
  setUiStyle: (s: UiStyle) => void;
  setChatShape: (s: ChatShape) => void;
  setChatBorder: (v: boolean) => void;
  setChatFill: (v: boolean) => void;
  setSquircleRadius: (key: keyof SquircleRadii, v: number) => void;
}

export const ICON_PACKS: { id: IconPack; label: string; desc: string }[] = [
  { id: 'filled',   label: 'Залитые',  desc: 'Плотные классические иконки (по умолчанию)' },
  { id: 'outlined', label: 'Контурные', desc: 'Тонкие линии без заливки' },
  { id: 'rounded',  label: 'Скруглённые', desc: 'Мягкие формы со скруглёнными углами' },
  { id: 'sharp',    label: 'Резкие',   desc: 'Прямые углы, строгая геометрия' },
  { id: 'twoTone',  label: 'Двухслойные', desc: 'Контур с полупрозрачной заливкой — «объём» без потери формы' },
  { id: 'relief',   label: 'Рельеф',   desc: 'Выпуклые 3D-иконки с бликом сверху и тенью снизу' },
  { id: 'puffy',    label: 'Надутые',  desc: 'Мягкие «надутые» формы с глянцевым бликом' },
  { id: 'sticker',  label: 'Стикеры',  desc: 'Иконка-наклейка: белая обводка и лёгкая тень' },
  { id: 'neon',     label: 'Неон',     desc: 'Тонкие линии со свечением цвета иконки' },
  { id: 'tile',     label: 'Плитки',   desc: 'Знак, вырезанный на цветной скруглённой плитке' },
];

export const UI_STYLES: { id: UiStyle; label: string; desc: string }[] = [
  { id: 'default', label: 'По умолчанию', desc: 'Стандартный вид Vera' },
  { id: 'rounded', label: 'Скруглённый',  desc: 'Крупные радиусы у пузырей и кнопок' },
  { id: 'square',  label: 'Строгий',      desc: 'Прямые углы, минимализм' },
  { id: 'squircle', label: 'Полускруглённый', desc: 'Квадрат со скруглёнными углами — радиусы настраиваются ползунками' },
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

/** Поверхности стиля «Полускруглённый»: радиус берётся из --vera-sq-radius. */
export const UI_STYLE_SQUIRCLE_TARGETS = Object.keys(UI_STYLE_RADII.rounded)
  .filter((selector) => selector !== '.MuiAvatar-root');

/**
 * Радиус «плашек» (карточки инвентаря, блоки настроек, кнопки ПКМ-меню):
 * все они берут скругление из ползунка «Скругление углов интерфейса».
 */
export const UI_SURFACE_RADIUS = 'var(--vera-sq-radius, 12px)';
/** Радиус элемента внутри плашки с отступом 6px — чтобы углы шли параллельно. */
export const UI_INNER_RADIUS = 'max(2px, calc(var(--vera-sq-radius, 12px) - 6px))';
/** Радиус плашек страницы профиля — свой ползунок «Скругление плашек профиля». */
export const UI_PROFILE_RADIUS = 'var(--vera-profile-radius, var(--vera-sq-radius, 12px))';
/** Вложенный элемент плашки профиля (отступ 6px). */
export const UI_PROFILE_INNER_RADIUS = 'max(2px, calc(var(--vera-profile-radius, var(--vera-sq-radius, 12px)) - 6px))';

function applyToDom(iconPack: IconPack, chatShape: ChatShape, chatBorder: boolean, chatFill: boolean, squircle?: SquircleRadii, modes?: UiModes) {
  try {
    const el = document.documentElement;
    const sq = squircle || defaultRadii();
    const m = modes || NO_MODES;
    const surface = clampRadius('surface', sq.surface);
    const bubble = clampRadius('bubble', sq.bubble);
    el.style?.setProperty('--vera-sq-radius', `${surface}px`);
    el.style?.setProperty('--vera-profile-radius', `${clampRadius('profile', sq.profile ?? surface)}px`);
    el.style?.setProperty('--vera-sq-avatar', `${clampRadius('avatar', sq.avatar)}%`);
    el.style?.setProperty('--vera-sq-bubble', `${bubble}px`);
    // Пузыри читают --vera-bubble-radius (с «хвостиком» 4px) — раньше его
    // писал ползунок макета, теперь единственный источник — стиль интерфейса.
    el.style?.setProperty('--vera-bubble-radius', `${bubble}px`);
    el.setAttribute('data-icon-pack', iconPack);
    // Радиусы теперь действуют всегда — атрибут нужен CSS как общий префикс.
    el.setAttribute('data-ui-style', 'custom');
    for (const mode of UI_MODES) el.setAttribute(`data-ui-${mode.id}`, m[mode.id] ? 'on' : 'off');
    el.setAttribute('data-switch-style', switchStyleFor(surface));
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
      customPack: null,
      uiStyle: 'squircle',
      chatShape: 'vera',
      chatBorder: true,
      chatFill: true,
      squircle: defaultRadii(),
      uiModes: { ...NO_MODES },
      setSquircleRadius: (key, v) => {
        set((s) => ({ squircle: { ...s.squircle, [key]: clampRadius(key, v) } }));
        applyAll();
      },
      setUiMode: (key, v) => {
        set((s) => ({ uiModes: { ...s.uiModes, [key]: !!v } }));
        applyAll();
      },
      setIconPack: (p) => { set({ iconPack: p }); applyAll(); },
      setCustomPack: (id) => { set({ customPack: id || null }); },
      // Прежний стиль-кнопка раскладывается на ползунки и режимы; после этого
      // хранится как 'squircle' («свои значения»).
      setUiStyle: (s) => {
        const legacy = LEGACY_UI_STYLES[s] || LEGACY_UI_STYLES.default;
        set((st) => ({
          uiStyle: 'squircle',
          squircle: legacy.radii ? { ...legacy.radii } : st.squircle,
          uiModes: { ...legacy.modes },
        }));
        applyAll();
      },
      setChatShape: (s) => { set({ chatShape: s }); applyAll(); },
      setChatBorder: (v) => { set({ chatBorder: v }); applyAll(); },
      setChatFill: (v) => { set({ chatFill: v }); applyAll(); },
    }),
    {
      name: 'vera-ui-prefs',
      version: 3,
      // v2: стиль-кнопка → ползунки + режимы. «Полускруглённый» сохраняет
      // свои ползунки, остальные стили получают свои радиусы и режим.
      migrate: (persisted, version) => {
        const p = (persisted || {}) as Partial<UiPrefsState>;
        if (version < 2) {
          const legacy = LEGACY_UI_STYLES[p.uiStyle as UiStyle] || LEGACY_UI_STYLES.default;
          return {
            ...p,
            uiStyle: 'squircle',
            squircle: legacy.radii
              ? { ...legacy.radii }
              : { ...defaultRadii(), profile: p.squircle?.surface ?? SQUIRCLE_LIMITS.profile.def, ...p.squircle },
            uiModes: { ...legacy.modes },
          } as UiPrefsState;
        }
        // v3: отдельный ползунок профиля стартует с текущего «surface»,
        // чтобы вид профиля после обновления не изменился.
        if (version < 3) {
          const sq = { ...defaultRadii(), ...p.squircle } as SquircleRadii;
          if (typeof p.squircle?.profile !== 'number') sq.profile = sq.surface;
          return { ...p, squircle: sq } as UiPrefsState;
        }
        return p as UiPrefsState;
      },
      onRehydrateStorage: () => (state) => {
        if (state) applyToDom(state.iconPack, state.chatShape, state.chatBorder !== false, state.chatFill !== false, state.squircle, state.uiModes);
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
  applyToDom(s.iconPack, s.chatShape, s.chatBorder, s.chatFill, s.squircle, s.uiModes);
}

// Первичная синхронизация (persist может не успеть до первого рендера)
{
  const s = useUiPrefsStore.getState();
  applyToDom(s.iconPack, s.chatShape, s.chatBorder, s.chatFill, s.squircle, s.uiModes);
}
