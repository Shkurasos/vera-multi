import type { ShopItem } from '../store/shopStore';
import { RARITY_META } from './rarityStyles';

/** Preserve geometry and animation while replacing the skin palette. */
export function skinColors(styles: Record<string, any>, item: ShopItem | undefined, accent: string, themeMode: boolean): Record<string, any> {
  if (!item) return styles;
  const stock = item.rarity ? RARITY_META[item.rarity].color : typeof item.previewColor === 'string' ? item.previewColor.match(/#[\da-f]{6}/i)?.[0] || '#ff4870' : '#ff4870';
  const color = themeMode ? accent : stock;
  const replace = (value: any): any => {
    if (typeof value === 'string') return themeMode
      ? value.split(stock).join(color)
      : value.split(accent).join(color);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
    return value;
  };
  return replace(styles);
}