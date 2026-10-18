import { withAlpha } from '../utils/colorAlpha';

/**
 * «Матовое стекло» для всплывающих меню: фон полупрозрачный, а всё, что
 * под плашкой (сообщения, обои, панель), размывается через backdrop-filter.
 * Без прозрачного фона размытие не видно — поэтому цвет темы домножаем на alpha.
 */
export const FROSTED_BLUR = 'blur(18px) saturate(1.4)';

export function frostedPaperSx(background: string, border: string, alpha = 0.72) {
  return {
    background: withAlpha(background, alpha),
    backdropFilter: FROSTED_BLUR,
    WebkitBackdropFilter: FROSTED_BLUR,
    border: `1px solid ${border}`,
  };
}
