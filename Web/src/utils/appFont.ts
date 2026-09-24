export const DEFAULT_APP_FONT = '"Manrope", "Inter", "SF Pro Display", "Segoe UI", sans-serif';

/**
 * Варианты «Шрифт всего приложения». Свои шрифты (см. `customFontsStore`)
 * компонент `FontPicker` добавляет к этому списку сам.
 */
export const APP_FONT_OPTIONS: { value: string; label: string }[] = [
  { value: 'inherit', label: 'По умолчанию' },
  { value: "'Inter', sans-serif", label: 'Inter' },
  { value: "'Roboto', sans-serif", label: 'Roboto' },
  { value: "'Montserrat', sans-serif", label: 'Montserrat' },
  { value: "'Source Code Pro', monospace", label: 'Source Code Pro' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: "'Comic Sans MS', cursive", label: 'Comic Sans' },
];

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
    // MessageBubble (data-vera-bubble) is intentionally excluded so per-chat and
    // chat-level fontFamily (set via sx on the chat container) are not clobbered
    // by !important — covers both canned fonts and custom @font-face ones.
    ...(value && value !== 'inherit' ? {
      'body, body *:not([data-vera-bubble]):not([data-vera-bubble] *):not([data-font-preview]):not([data-font-preview] *)': {
        fontFamily: 'var(--vera-app-font) !important',
      },
    } : {}),
  };
}