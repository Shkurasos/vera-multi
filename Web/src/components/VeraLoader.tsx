import { Box, GlobalStyles } from '@mui/material';
import { useThemeStore } from '../store/themeStore';

/**
 * VeraLoader — минималистичный загрузчик приложения.
 *
 * Берёт живые цвета активной темы (accent / bg / text), поэтому всегда «под
 * тему». Композиция намеренно спокойная: статичная иконка-треугольник Vera
 * одним цветом + мягкое «дыхание» прозрачности и тонкая indeterminate-линия
 * под ней. Никаких переливов и вращающихся колец.
 *
 * Уважает prefers-reduced-motion: при включённом анимации выключаются.
 */

interface Props {
  /** Полноэкранный режим (стартовая загрузка). false → вписывается в родителя (Suspense). */
  fullscreen?: boolean;
  /** Размер иконки в px. */
  size?: number;
}

export default function VeraLoader({ fullscreen = false, size = 56 }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const accent = theme.accent || '#7C6AF7';
  const bg = theme.bg || '#1E1D2B';
  const text = theme.text || '#EEF3FF';

  return (
    <Box
      sx={{
        position: fullscreen ? 'fixed' : 'relative',
        inset: fullscreen ? 0 : 'auto',
        width: fullscreen ? '100vw' : '100%',
        minHeight: fullscreen ? '100vh' : '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2.75,
        bgcolor: fullscreen ? bg : 'transparent',
        overflow: 'hidden',
        zIndex: fullscreen ? 1400 : 'auto',
      }}
    >
      {/* Анимации лоадера живут локально, чтобы компонент был самодостаточным. */}
      <GlobalStyles
        styles={{
          '@keyframes vera-load-breathe': {
            '0%,100%': { opacity: 0.55 },
            '50%': { opacity: 1 },
          },
          '@keyframes vera-load-bar': {
            '0%': { left: '-40%', width: '40%' },
            '50%': { width: '55%' },
            '100%': { left: '100%', width: '40%' },
          },
          '@media (prefers-reduced-motion: reduce)': {
            '.vera-load-anim': { animation: 'none !important', opacity: '1 !important' },
          },
        }}
      />

      {/* Иконка-треугольник Vera, одним цветом темы, с мягким дыханием */}
      <Box
        className="vera-load-anim"
        component="svg"
        viewBox="0 0 64 64"
        sx={{
          width: size,
          height: size,
          animation: 'vera-load-breathe 1.9s ease-in-out infinite',
        }}
      >
        {/* Форма повторяет polygon из public/vera.svg */}
        <g fill={text}>
          <polygon points="6,9 39,9 21,31 45,40 34,58" />
          <polygon points="47,9 60.5,9 52,29" />
        </g>
      </Box>

      {/* Тонкая indeterminate-линия в акцентном цвете */}
      <Box
        sx={{
          position: 'relative',
          width: size * 1.6,
          height: 2,
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: `${accent}22`,
        }}
      >
        <Box
          className="vera-load-anim"
          sx={{
            position: 'absolute',
            top: 0,
            height: '100%',
            borderRadius: 2,
            bgcolor: accent,
            animation: 'vera-load-bar 1.4s ease-in-out infinite',
          }}
        />
      </Box>
    </Box>
  );
}

