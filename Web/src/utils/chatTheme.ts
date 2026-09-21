import type { Theme } from '../store/themeStore';
import type { ChatThemeOverride } from '../store/chatThemeStore';

/**
 * Собирает тему окна чата из общей темы и персонального переопределения.
 *
 * Персональная тема чата самодостаточна: раньше она просто накладывалась на
 * текущую общую тему через spread, поэтому поля, которых в переопределении нет
 * (в первую очередь градиент и тени своих пузырей), продолжали следовать за
 * общей темой — при смене общей темы свои пузыри в персонализированном чате
 * перекрашивались. Теперь заданный персональный цвет пузырей окончательный и
 * общая тема его не перебивает; всё остальное по-прежнему берётся из общей темы.
 */
export function resolveChatTheme(baseTheme: Theme, override?: ChatThemeOverride | null): Theme {
  if (!override || override.enabled === false) return baseTheme;

  const ownColor = override.bgBubbleOwn || override.bubbleOwn;
  const otherColor = override.bgBubbleOther || override.bubbleOther;

  return {
    ...baseTheme,
    ...override,
    // Старый формат хранил только accent / bubbleOwn / bubbleOther / bg.
    bgChat: override.bgChat || override.bg || baseTheme.bgChat,
    bgBubbleOwn: ownColor || baseTheme.bgBubbleOwn,
    bgBubbleOther: otherColor || baseTheme.bgBubbleOther,
    // Свой цвет пузырей отменяет градиент и тень общей темы, иначе смена
    // общей темы меняет цвет своих пузырей в этом чате.
    bubbleOwnGradient: override.bubbleOwnGradient || (ownColor ? undefined : baseTheme.bubbleOwnGradient),
    bubbleOwnShadow: override.bubbleOwnShadow || (ownColor ? undefined : baseTheme.bubbleOwnShadow),
    bubbleOtherShadow: override.bubbleOtherShadow || (otherColor ? undefined : baseTheme.bubbleOtherShadow),
  } as Theme;
}