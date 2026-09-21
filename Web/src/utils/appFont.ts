export const DEFAULT_APP_FONT = '"Manrope", "Inter", "SF Pro Display", "Segoe UI", sans-serif';

export function resolveAppFont(value: string): string {
  return value && value.trim() && value !== 'inherit' ? value : DEFAULT_APP_FONT;
}

export function appFontStyles(value: string) {
  const fontFamily = resolveAppFont(value);
  return {
    ':root': { '--vera-app-font': fontFamily },
    'body, button, input, textarea, select': { fontFamily },
    // Include portals and explicit component/skin fonts, not just inherited text.
    // Font-picker samples retain their own family for a useful preview.
    ...(value && value !== 'inherit' ? {
      'body, body *:not([data-font-preview]):not([data-font-preview] *)': {
        fontFamily: 'var(--vera-app-font) !important',
      },
    } : {}),
  };
}