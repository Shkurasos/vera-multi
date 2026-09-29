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
  /** id сообщения, чья панель действий сейчас открыта (в чате — не больше одной). */
  actionsId: string | null;
  setHoveredId: (id: string | null) => void;
  openActions: (id: string) => void;
  toggleActions: (id: string) => void;
}

export const useMessageHoverStore = create<MessageHoverState>((set, get) => ({
  hoveredId: null,
  actionsId: null,
  setHoveredId: (id) => {
    if (id === null) {
      // Сброс ховера попутно закрывает панель действий: она живёт, только пока
      // курсор (или палец) внутри сообщения. Один сброс в hoverNone закрывает
      // её во всех местах — и на мыши, и на таче, и в clearHover из ChatWindow.
      if (get().hoveredId !== null || get().actionsId !== null) set({ hoveredId: null, actionsId: null });
      return;
    }
    if (get().hoveredId !== id) set({ hoveredId: id });
  },
  openActions: (id) => {
    // Держим инвариант «панель открыта ⇒ на сообщении наведён курсор»: от него
    // зависят opacity панели и zIndex строки.
    if (get().actionsId !== id || get().hoveredId !== id) set({ actionsId: id, hoveredId: id });
  },
  toggleActions: (id) => {
    const open = get().hoveredId === id;
    set(open ? { hoveredId: null, actionsId: null } : { hoveredId: id });
  },
}));

