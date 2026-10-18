// Геометрия перемотки кружка: позиция пальца на кольце → доля длительности.

/** Доля внешнего радиуса, с которой начинается зона перемотки (кольцо).
 *  Совпадает с ROUND_HIT = 14 в MessageBubble: (50 − 14) / 50. */
export const RING_HIT_FROM = 0.72;

export interface RingPoint {
  /** 0..1 по часовой стрелке от «12 часов». */
  fraction: number;
  /** Точка попала в кольцо, а не в центр кружка. */
  inRing: boolean;
}

export function ringPoint(x: number, y: number, rect: { left: number; top: number; width: number; height: number }): RingPoint {
  const radius = Math.min(rect.width, rect.height) / 2;
  const dx = x - (rect.left + rect.width / 2);
  const dy = y - (rect.top + rect.height / 2);
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) angle += Math.PI * 2;
  const distance = Math.hypot(dx, dy);
  return {
    fraction: angle / (Math.PI * 2),
    inRing: radius > 0 && distance >= radius * RING_HIT_FROM,
  };
}

/**
 * При перетаскивании через «12 часов» доля прыгала бы 0 ↔ 1 (конец ↔ начало).
 * Упираемся в край, с которого пришёл палец.
 */
export function continueRingDrag(prev: number, next: number): number {
  if (prev < 0.25 && next > 0.75) return 0;
  if (prev > 0.75 && next < 0.25) return 1;
  return next;
}
