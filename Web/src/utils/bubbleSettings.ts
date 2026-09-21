export const bubbleLimits = { maxWidth: [35, 95], textSize: [12, 24], padding: [0, 28] } as const;
export interface BubbleSettings { enabled: boolean; maxWidth: number; textSize: number; padding: number }
export function clampBubble(key: keyof typeof bubbleLimits, value: number) {
  const [min, max] = bubbleLimits[key];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}