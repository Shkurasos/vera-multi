/**
 * Геометрия панели быстрых действий, которая выезжает из пузыря сообщения.
 *
 * Здесь только чистые функции и константы: сам MessageBubble подставляет
 * результат в sx, а тесты проверяют поведение, а не текст разметки.
 */

/** Размер «уголка» пузыря, из которого выезжает панель (px). */
export const ACTIONS_CORNER = { width: 72, height: 32 };

/**
 * Высота выезжающей панели (px).
 *
 * Кнопки лежат в одну строку, поэтому высота постоянна — и «корпус» сообщения
 * компенсирует её ровно таким же отрицательным отступом. Панель занимает место
 * только визуально: лента не прыгает при открытии и закрытии.
 */
export const ACTIONS_PANEL_HEIGHT = 36;

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Курсор в «уголке вызова» панели.
 *
 * Панель — продолжение пузыря снизу, поэтому и зона наведения в его нижнем углу
 * со стороны сообщения: у чужих — левый нижний, у своих — правый нижний
 * (зеркально, как и весь остальной пузырь). Наводить нужно именно на уголок:
 * если открывать панель на любое наведение, она выскакивает при обычном чтении.
 *
 * @param rect прямоугольник пузыря в координатах окна.
 * @param slack насколько можно промахнуться мимо границы пузыря (px).
 */
export function inActionsCorner(
  rect: RectLike,
  clientX: number,
  clientY: number,
  ownSide: boolean,
  slack = 6,
): boolean {
  const fromSide = ownSide ? rect.right - clientX : clientX - rect.left;
  const fromBottom = rect.bottom - clientY;
  return fromSide >= -slack
    && fromSide <= ACTIONS_CORNER.width
    && fromBottom >= -slack
    && fromBottom <= ACTIONS_CORNER.height;
}

/**
 * Ключи скина, которые рисует «корпус» сообщения (фон, рамка, тень, анимация).
 * Остальное (цвет и начертание текста, отступы) остаётся на самом пузыре:
 * оттуда его сдвиг сломал бы раскладку сообщения.
 */
const SHELL_PREFIXES = [
  'background', 'border', 'boxShadow', 'backdropFilter', 'WebkitBackdropFilter',
  'opacity', 'animation', 'transition', 'transform', 'filter', 'clipPath',
  'imageRendering', 'mixBlendMode', 'outline',
];

export function isShellStyle(key: string): boolean {
  return SHELL_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Делит стиль скина пузыря на две части: `shell` — то, что рисует корпус
 * (фон, рамка, тень, скругление, анимация), `inner` — то, что относится к
 * содержимому (цвет текста, отступы, прозрачность текста).
 *
 * Нужно это потому, что пока закрыта панель действий, корпус и пузырь совпадают
 * по геометрии, а когда панель выезжает — корпус растёт вместе с ней. Фон,
 * рамка и тень должны рисоваться ОДИН раз, иначе на стыке появляется полоса от
 * двойной заливки (особенно на полупрозрачных и градиентных скинах).
 */
export function splitBubbleSkin(
  style: Record<string, any> | null | undefined,
): [Record<string, any>, Record<string, any>] {
  const shell: Record<string, any> = {};
  const inner: Record<string, any> = {};
  for (const [key, value] of Object.entries(style || {})) {
    if (value === undefined) continue;
    (isShellStyle(key) ? shell : inner)[key] = value;
  }
  return [shell, inner];
}
