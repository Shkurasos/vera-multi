import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Настройки анимаций интерфейса.
 * Каждая группа отключается отдельно через атрибут `data-anim-off-*` на <html>,
 * через который CSS в main.tsx включает/выключает анимации.
 * Также учитывается системный prefers-reduced-motion (глушит всё).
 */
export type AnimKey =
  | 'hoverLift'      // Подъём карточек при наведении
  | 'press'          // Нажатие кнопок (мембран-эффект)
  | 'menus'          // Пружинное всплытие меню
  | 'dialogs'        // Zoom-fade диалоговых окон
  | 'messages'       // Появление сообщений в чате
  | 'listEntrance'   // Нарастающее появление элементов списков
  | 'statusPulse'    // Мягкий пульс индикаторов статусов
  | 'iconMotion'     // Микро-движение иконок при наведении
  | 'tabs'           // Плавный переход контента вкладок
  | 'toasts'         // Выезд toast-уведомлений
  | 'playerGlow'     // Свечение прогресс-бара плеера
  | 'accordions'     // Плавное раскрытие аккордеонов
;

export interface AnimGroup {
  key: AnimKey;
  label: string;
  desc: string;
  emoji: string;
}

export const ANIM_GROUPS: AnimGroup[] = [
  { key: 'hoverLift',    label: 'Подъём карточек',  desc: 'Карточки и элементы списков мягко приподнимаются при наведении.', emoji: '🎈' },
  { key: 'press',        label: 'Нажатие кнопок',   desc: 'Кнопки слегка «вдавливаются» при нажатии (эффект мембраны).', emoji: '🖱️' },
  { key: 'menus',        label: 'Всплытие меню',    desc: 'Контекстные меню появляются с пружинистым масштабом.', emoji: '🍽️' },
  { key: 'dialogs',      label: 'Диалоговые окна',  desc: 'Окна плавно выезжают и увеличиваются из центра.', emoji: '🪟' },
  { key: 'messages',     label: 'Появление сообщений', desc: 'Сообщения плавно всплывают при появлении в чате.', emoji: '💬' },
  { key: 'listEntrance', label: 'Появление списков', desc: 'Элементы списков проявляются друг за другом с лёгкой задержкой.', emoji: '📋' },
  { key: 'statusPulse',  label: 'Пульс статусов',   desc: 'Индикаторы «онлайн» мягко пульсируют.', emoji: '🟢' },
  { key: 'iconMotion',   label: 'Иконки при наведении', desc: 'Иконки слегка увеличиваются при наведении на кнопку.', emoji: '🌀' },
  { key: 'tabs',         label: 'Переход вкладок',  desc: 'Контент вкладок плавно проявляется при переключении.', emoji: '📑' },
  { key: 'toasts',       label: 'Всплывающие уведомления', desc: 'Toast-уведомления выезжают снизу с пружинкой.', emoji: '🍞' },
  { key: 'playerGlow',   label: 'Свечение плеера',  desc: 'Прогресс-бар музыкального плеера мягко светится.', emoji: '🎧' },
  { key: 'accordions',   label: 'Аккордеоны',       desc: 'Секции настроек и списков раскрываются плавно.', emoji: '🪗' },
];

type EnabledMap = Record<AnimKey, boolean>;

function defaultMap(): EnabledMap {
  const m = {} as EnabledMap;
  for (const g of ANIM_GROUPS) m[g.key] = true;
  return m;
}

/** camelCase -> kebab-case, чтобы атрибут был стабильным: hoverLift -> data-anim-off-hover-lift */
function attrName(key: AnimKey): string {
  const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `data-anim-off-${kebab}`;
}

function applyDom(enabled: EnabledMap) {
  try {
    const el = document.documentElement;
    for (const g of ANIM_GROUPS) {
      const attr = attrName(g.key);
      if (enabled[g.key]) el.removeAttribute(attr);
      else el.setAttribute(attr, '1');
    }
  } catch { /* SSR / тесты — ок */ }
}

interface AnimState {
  enabled: EnabledMap;
  isEnabled: (key: AnimKey) => boolean;
  set: (key: AnimKey, on: boolean) => void;
  setAll: (on: boolean) => void;
}

export const useAnimStore = create<AnimState>()(
  persist(
    (set, get) => ({
      enabled: defaultMap(),
      isEnabled: (key) => !!get().enabled[key],
      set: (key, on) => {
        const enabled = { ...get().enabled, [key]: on };
        set({ enabled });
        applyDom(enabled);
      },
      setAll: (on) => {
        const enabled = defaultMap();
        for (const g of ANIM_GROUPS) enabled[g.key] = on;
        set({ enabled });
        applyDom(enabled);
      },
    }),
    {
      name: 'vera-anim-prefs',
      version: 1,
      onRehydrateStorage: () => (state) => {
        // Подмешиваем недостающие ключи (новые группы по умолчанию включены).
        if (state?.enabled) {
          const merged = defaultMap();
          for (const g of ANIM_GROUPS) {
            if (typeof state.enabled[g.key] === 'boolean') merged[g.key] = state.enabled[g.key];
          }
          state.enabled = merged;
          applyDom(merged);
        }
      },
    }
  )
);

// Первичная синхронизация до первого рендера (persist может не успеть).
applyDom(useAnimStore.getState().enabled);