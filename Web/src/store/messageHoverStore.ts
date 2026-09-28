import { create } from 'zustand';

/**
 * Микро-стор ховера сообщений.
 *
 * Раньше `hoveredMsgId` жил в состоянии ChatWindow: каждое наведение курсора
 * на пузырь перерисовывывало ВСЁ окно чата (шапка, инпут, список целиком).
 * Теперь ховер читают только затронутые MessageBubble (по стабильному булеву
 * селектору `hoveredId === message.id`), а окно чата остаётся спокойным.
 *
 * Выбор булева-селектора сознательный: zustand сравнивает результат селектора,
 * и пузырю приходит `true`/`false` — он перерисовывается только при СМЕНЕ
 * собственного ховера, а не при каждом изменении `hoveredId`.
 */
interface MessageHoverState {
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  toggleActions: (id: string) => void;
}

export const useMessageHoverStore = create<MessageHoverState>((set, get) => ({
  hoveredId: null,
  setHoveredId: (id) => {
    if (get().hoveredId !== id) set({ hoveredId: id });
  },
  toggleActions: (id) => {
    set({ hoveredId: get().hoveredId === id ? null : id });
  },
}));

