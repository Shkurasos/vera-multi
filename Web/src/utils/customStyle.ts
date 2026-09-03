/**
 * Рендер спецификации кастомного предмета в CSS-объект (для MUI sx / style).
 * Спека проходит серверный санитайзер, поэтому на клиенте её можно использовать
 * без дополнительной проверки — все значения уже гарантированно валидны.
 */
import type { CSSProperties } from 'react';
import type { CustomSpec } from '../services/api';

export const DEFAULT_CUSTOM_SPEC: CustomSpec = {
  bg: { type: 'linear', color1: '#7c6af7', color2: '#4ea0ff', angle: 135 },
  border: { width: 0, color: '#ffffff', style: 'solid', radius: 16 },
  glow: { enabled: false, color: '#7c6af7', intensity: 12 },
  shadow: { enabled: true, x: 0, y: 6, blur: 18, color: '#00000066' },
  text: { color: '#ffffff', weight: '600' },
  animation: 'none',
  opacity: 1,
  padding: 12,
  emoji: '',
};

export function specToStyle(spec: CustomSpec): CSSProperties {
  const style: CSSProperties = {};
  const { bg, border, glow, shadow, text, opacity, padding } = spec;

  if (bg.type === 'solid') style.background = bg.color1;
  else if (bg.type === 'linear') style.background = `linear-gradient(${bg.angle}deg, ${bg.color1}, ${bg.color2})`;
  else style.background = `radial-gradient(circle at center, ${bg.color1}, ${bg.color2})`;

  if (border.width > 0) {
    style.border = `${border.width}px ${border.style} ${border.color}`;
  }
  style.borderRadius = border.radius;

  const shadows: string[] = [];
  if (shadow.enabled) shadows.push(`${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`);
  if (glow.enabled) shadows.push(`0 0 ${glow.intensity}px ${glow.color}`);
  if (shadows.length) style.boxShadow = shadows.join(', ');

  style.color = text.color;
  style.fontWeight = Number(text.weight);
  style.opacity = opacity;
  style.padding = padding;
  return style;
}

/** Класс для CSS-анимаций. Определён в глобальном css (см. index.css). */
export function specAnimationClass(spec: CustomSpec): string {
  if (spec.animation === 'none') return '';
  return `vera-anim-${spec.animation}`;
}
