import { useMemo } from 'react';
import { SHOP_CATALOG, useShopStore } from '../store/shopStore';
import { useCustomEquipStore } from '../store/customEquipStore';
import { useThemeStore } from '../store/themeStore';
import type { WallpaperSpec } from '../components/ChatWallpaper';

/** Светлый ли цвет (по относительной яркости) — для выбора тона панелей поверх обоев. */
export function isLightColor(color: string): boolean {
  const c = color.replace('#', '').trim();
  if (c.length === 3) {
    const [r, g, b] = c.split('').map((ch) => parseInt(ch + ch, 16));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
  }
  if (c.length >= 6) {
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
  }
  return false;
}

/**
 * Активные обои приложения: кастомные от авторов → smart-обои из магазина.
 * Возвращает null, если обоев нет или их перекрывает фото-фон темы.
 * Используется и в MainLayout (полноэкранный слой), и в ChatWindow.
 */
export function useActiveWallpaperSpec(): WallpaperSpec | null {
  const theme = useThemeStore((s) => s.theme);
  const activeWallpaper = useShopStore((s) => s.activeWallpaper);
  const owned = useShopStore((s) => s.owned);
  const customWallpaper = useCustomEquipStore((s) => s.equipped.wallpaper ? s.items[s.equipped.wallpaper]?.spec : undefined);

  return useMemo<WallpaperSpec | null>(() => {
    // Фото-фон темы имеет приоритет — обои не показываем.
    if (theme.chatBgImage) return null;
    // Кастомные обои от авторов: background → градиентный тип.
    if (customWallpaper?.background) return { type: 'gradient', gradient: customWallpaper.background };
    if (!activeWallpaper) return null;
    const item = SHOP_CATALOG.find((i) => i.id === activeWallpaper && i.category === 'wallpaper');
    if (!item || !item.value?.type) return null;
    // Проверяем владение (dev-режим / серверная покупка).
    if (!useShopStore.getState().isOwned(item.id)) return null;
    return { type: item.value.type as WallpaperSpec['type'], gradient: item.value.gradient };
  }, [theme.chatBgImage, customWallpaper, activeWallpaper, owned]);
}
