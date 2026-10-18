export const bubbleLimits = { maxWidth: [35, 95], textSize: [12, 24], padding: [0, 28] } as const;
/**
 * Где в пузыре стоят время и галочки:
 * inlineRight — в строке с коротким текстом справа;
 * inlineLeft  — в строке с текстом слева;
 * belowRight / belowLeft — отдельной строкой под текстом справа / слева
 *   (belowLeft — по умолчанию);
 * belowWall   — отдельной строкой со стороны стенки (свои справа, чужие слева).
 */
export type BubbleMetaPos = 'inlineRight' | 'inlineLeft' | 'belowRight' | 'belowLeft' | 'belowWall';
export const BUBBLE_META_POSITIONS: readonly BubbleMetaPos[] = ['inlineRight', 'inlineLeft', 'belowRight', 'belowLeft', 'belowWall'];
export const DEFAULT_BUBBLE_META_POS: BubbleMetaPos = 'belowLeft';
export function normalizeMetaPos(value: unknown): BubbleMetaPos {
  return BUBBLE_META_POSITIONS.includes(value as BubbleMetaPos) ? value as BubbleMetaPos : DEFAULT_BUBBLE_META_POS;
}
/** Сторона, к которой прижимается время: true — вправо. */
export function metaOnRight(pos: BubbleMetaPos, isOwnSide: boolean) {
  if (pos === 'belowWall') return isOwnSide;
  return pos === 'inlineRight' || pos === 'belowRight';
}
export interface BubbleSettings {
  enabled: boolean; maxWidth: number; textSize: number; padding: number;
  /** Выравнивание по стенке: текст прижимается к стороне пузыря (свои — вправо, чужие — влево). */
  wallAlign: boolean;
  metaPos: BubbleMetaPos;
}
export function clampBubble(key: keyof typeof bubbleLimits, value: number) {
  const [min, max] = bubbleLimits[key];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}