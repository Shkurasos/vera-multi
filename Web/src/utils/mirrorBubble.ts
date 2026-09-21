/** Reflect asymmetric bubble corners and borders without reflecting its text. */
export function mirrorBubble(style: Record<string, any>): Record<string, any> {
  const result = { ...style };
  if (typeof style.borderRadius === 'string') {
    result.borderRadius = style.borderRadius.split(/\s*\/\s*/).map((axis: string) => {
      const values = axis.match(/(?:[^\s()]+|\([^)]*\))+/g) || [];
      const [a, b = a, c = a, d = b] = values;
      return [b, a, d, c].join(' ');
    }).join(' / ');
  }
  for (const [left, right] of [
    ['borderLeft', 'borderRight'], ['borderLeftWidth', 'borderRightWidth'],
    ['borderLeftColor', 'borderRightColor'], ['borderLeftStyle', 'borderRightStyle'],
    ['borderTopLeftRadius', 'borderTopRightRadius'],
    ['borderBottomLeftRadius', 'borderBottomRightRadius'],
  ]) {
    if (left in style || right in style) {
      delete result[left]; delete result[right];
      if (left in style) result[right] = style[left];
      if (right in style) result[left] = style[right];
    }
  }
  return result;
}