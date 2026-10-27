/**
 * Выезд мобильных панелей сбоку: профиль, редактор темы, музыка.
 *
 * Все три панели используют одну длительность и кривую, чтобы ощущались
 * одинаково. На широком экране панели не ездят: там это окна, а не экраны.
 */
export const SLIDE_IN_MS = 260;
export const SLIDE_OUT_MS = 220;
export const SLIDE_EASE = 'cubic-bezier(.2,.8,.2,1)';
/** Совпадает с брейкпоинтом md у MUI: ниже него интерфейс мобильный. */
export const SLIDE_MEDIA = '(max-width: 899.95px)';

/** Те же кадры строкой — для панелей на inline-стилях (редактор темы). */
export const SLIDE_KEYFRAMES_CSS =
  '@keyframes veraSlideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }';

export function slideAllowed(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return window.matchMedia(SLIDE_MEDIA).matches;
}

/**
 * Увести страницу с `data-slide-page` вправо и только потом выполнить `then`
 * (обычно навигацию). Если такой страницы нет или анимация не нужна —
 * `then` выполняется сразу.
 */
export function leaveSlidePage(then: () => void): void {
  const el = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('[data-slide-page]')
    : null;
  if (!el || !slideAllowed() || el.hasAttribute('data-slide-leaving')) {
    then();
    return;
  }

  // The chat list is rendered by a *different* MainLayout instance every time
  // the slide page unmounts.  Its rows animate in with a staggered fade, so on
  // the way back from the profile they snap through in a visible flash.  Freeze
  // the list-entrance animation for the duration of the slide + a little slack,
  // then let it run again on the next real list mount.
  const freezeListEntrance = () => {
    try {
      delete (document.documentElement.dataset as DOMStringMap).animOffListEntrance;
    } catch {
      // No-op if the DOM API is not available (server-side / tests).
    }
  };
  document.documentElement.dataset.animOffListEntrance = '1';
  window.setTimeout(
    freezeListEntrance,
    SLIDE_OUT_MS + 900,
  );

  el.setAttribute('data-slide-leaving', '');
  window.setTimeout(then, SLIDE_OUT_MS);
}

/** sx для корня страницы, которая выезжает справа на телефоне. */
export const slidePageSx = {
  '@keyframes veraSlideInRight': {
    from: { transform: 'translateX(100%)' },
    to: { transform: 'translateX(0)' },
  },
  [`@media ${SLIDE_MEDIA}`]: {
    animation: `veraSlideInRight ${SLIDE_IN_MS}ms ${SLIDE_EASE}`,
    '&[data-slide-leaving]': {
      transform: 'translateX(100%)',
      transition: `transform ${SLIDE_OUT_MS}ms ${SLIDE_EASE}`,
      pointerEvents: 'none',
    },
  },
} as const;
