export const bubbleLimits = { maxWidth: [35, 95], textSize: [12, 24], padding: [0, 28] } as const;
/**
 * Где в пузыре стоят время и галочки — сетка 3×3, как у часов на обоях:
 * сверху / по середине / снизу × слева / по центру / справа.
 */
export type BubbleMetaPos =
  | 'topLeft' | 'top' | 'topRight'
  | 'middleLeft' | 'center' | 'middleRight'
  | 'bottomLeft' | 'bottom' | 'bottomRight';
export const BUBBLE_META_POSITIONS: readonly BubbleMetaPos[] = [
  'topLeft', 'top', 'topRight',
  'middleLeft', 'center', 'middleRight',
  'bottomLeft', 'bottom', 'bottomRight',
];
export const DEFAULT_BUBBLE_META_POS: BubbleMetaPos = 'bottomLeft';

/** Старые значения (до сетки 3×3) переводятся на ближайшую клетку. */
const LEGACY_META_POS: Record<string, BubbleMetaPos> = {
  inlineRight: 'middleRight',
  inlineLeft: 'middleLeft',
  belowRight: 'bottomRight',
  belowLeft: 'bottomLeft',
  belowWall: 'bottomRight',
};

export function normalizeMetaPos(value: unknown): BubbleMetaPos {
  if (BUBBLE_META_POSITIONS.includes(value as BubbleMetaPos)) return value as BubbleMetaPos;
  if (typeof value === 'string' && LEGACY_META_POS[value]) return LEGACY_META_POS[value];
  return DEFAULT_BUBBLE_META_POS;
}

/** Клетка сетки → вертикаль и горизонталь. */
export function metaAnchor(pos: BubbleMetaPos): { v: 'top' | 'middle' | 'bottom'; h: 'left' | 'center' | 'right' } {
  const p = normalizeMetaPos(pos);
  const v = p.startsWith('top') ? 'top' : p.startsWith('bottom') ? 'bottom' : 'middle';
  const h = p.endsWith('Left') ? 'left' : p.endsWith('Right') ? 'right' : 'center';
  return { v, h };
}

/** Сторона, к которой прижимается время: true — вправо. */
export function metaOnRight(pos: BubbleMetaPos) {
  return metaAnchor(pos).h === 'right';
}
/**
 * Позиции отдельно для своих и чужих пузырей.
 * Старое общее поле metaPos — запасное: если своё/чужое не задано, берётся оно.
 */
export function resolveMetaPair(source: { metaPos?: unknown; metaPosOwn?: unknown; metaPosOther?: unknown } | undefined): { own: BubbleMetaPos; other: BubbleMetaPos } {
  const fallback = source?.metaPos !== undefined ? normalizeMetaPos(source.metaPos) : DEFAULT_BUBBLE_META_POS;
  return {
    own: source?.metaPosOwn !== undefined ? normalizeMetaPos(source.metaPosOwn) : fallback,
    other: source?.metaPosOther !== undefined ? normalizeMetaPos(source.metaPosOther) : fallback,
  };
}

export interface BubbleSettings {
  enabled: boolean; maxWidth: number; textSize: number; padding: number;
  /** Выравнивание текста по стенке (свои — вправо, чужие — влево). */
  wallAlign: boolean;
  /** Время и галочки в своём пузыре. */
  metaPosOwn: BubbleMetaPos;
  /** Время и галочки в чужом пузыре. */
  metaPosOther: BubbleMetaPos;
}
export function clampBubble(key: keyof typeof bubbleLimits, value: number) {
  const [min, max] = bubbleLimits[key];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}