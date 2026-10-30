import { useMemo } from 'react';
import { useThemeStore } from '../store/themeStore';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { avatarPalette, avatarColorFor, avatarFill, type AvatarFill } from '../utils/avatarColors';

/**
 * Текущая палитра аватарок без фото: режим и свои цвета из uiPrefsStore,
 * акцент — из активной темы. Пересчитывается только при их изменении.
 */
export function useAvatarPalette(): { palette: string[]; gradient: boolean } {
  const accent = useThemeStore((s) => s.theme.accent);
  const mode = useUiPrefsStore((s) => s.avatarPalette);
  const custom = useUiPrefsStore((s) => s.avatarColors);
  const gradient = useUiPrefsStore((s) => s.avatarGradient);
  const palette = useMemo(() => avatarPalette(mode, accent, custom), [mode, accent, custom]);
  return { palette, gradient };
}

/**
 * Заливка и цвет инициалов для аватарки без фото.
 * key — стабильный id (пользователя или чата): один ключ — один цвет везде.
 * Результат кладётся в sx Avatar поверх прежних размеров/рамок.
 */
export function useAvatarFill(key: string | null | undefined): AvatarFill {
  const { palette, gradient } = useAvatarPalette();
  return useMemo(() => avatarFill(avatarColorFor(key, palette), gradient), [key, palette, gradient]);
}
