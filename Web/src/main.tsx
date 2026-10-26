import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, GlobalStyles, Box, Typography, Button } from '@mui/material';
import { useUserSettingsStore } from './store/userSettingsStore';
import { useThemeStore } from './store/themeStore';
import { muiPaletteFromTheme } from './utils/muiPalette';
import { CHAT_SHAPES, UI_STYLE_FLAT_TARGETS, UI_STYLE_SQUIRCLE_TARGETS } from './store/uiPrefsStore';
import { appFontStyles, resolveAppFont } from './utils/appFont';
import IconPackDefs from './components/IconPackDefs';
import TitleBar from './components/TitleBar';
import App from './App';

/**
 * CSS стилевых паков иконок. Ключ — хвост селектора после `.vera-ico`
 * ('' — сама иконка). Фильтры url(#…) объявлены в IconPackDefs.
 */
const ICON_PACK_STYLES: Record<string, Record<string, Record<string, string | number>>> = {
  relief: { '': { filter: 'url(#vera-ico-relief)', overflow: 'visible' } },
  puffy: { '': { filter: 'url(#vera-ico-puffy)', overflow: 'visible' } },
  sticker: { '': { filter: 'url(#vera-ico-sticker)', overflow: 'visible' } },
  // Неон: тонкий контур и двойное свечение цветом самой иконки.
  neon: {
    '': {
      filter: 'drop-shadow(0 0 1px currentColor) drop-shadow(0 0 4px color-mix(in srgb, currentColor 65%, transparent))',
      overflow: 'visible',
    },
  },
  // Плитки: скруглённая подложка цветом иконки, знак «вырезан» цветом фона
  // темы, поэтому читается и на светлых, и на тёмных темах.
  tile: {
    '': {
      fill: 'var(--vera-bg, #0B0B10)',
      background: 'linear-gradient(150deg, color-mix(in srgb, currentColor 70%, #fff) 0%, currentColor 100%)',
      borderRadius: '30%',
      padding: '0.14em',
      boxSizing: 'border-box',
      boxShadow: '0 1px 3px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.35)',
    },
    ' *': { fill: 'inherit' },
  },
};
import './store/uiPrefsStore'; // применяет data-icon-pack / data-ui-* / data-switch-style на <html>
import './store/animStore'; // глобальные анимации интерфейса (data-anim-off-* на <html>)
import './store/outboxStore'; // очередь исходящих сообщений (оффлайн-режим)


// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
    // Обновляем state чтобы показать стек
    this.setState({ error: (error.stack || error.message) + '\n\nComponent stack:' + info.componentStack });
  }
  render() {
    if (this.state.hasError) {
      return (
        <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center"
          height="100vh" gap={2} sx={{ bgcolor: '#1a1a2e', color: '#E0E0F0', p: 3 }}>
          <Typography variant="h5">Ошибка приложения</Typography>
          <Box sx={{ bgcolor: '#0d0d1a', border: '1px solid #f44336', borderRadius: 2, p: 2, maxWidth: 600, width: '100%', maxHeight: 400, overflowY: 'auto' }}>
            <Typography variant="body2" sx={{ color: '#f44336', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>
              {this.state.error}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#8A8AAA' }}>
            Скопируй текст выше и отправь разработчику
          </Typography>
          <Button variant="contained" onClick={() => {
            // React.lazy кэширует rejected promise; простого сброса state
            // недостаточно — нужен полный reload с новым Vite-модулем.
            window.location.reload();
          }} sx={{ bgcolor: '#7C6AF7' }}>
            Перезагрузить
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ─── MUI Theme ────────────────────────────────────────────────────────────────
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#00E5FF', light: '#7AF4FF', dark: '#008CFF' },
    secondary: { main: '#FF4FD8' },
    background: {
      default: '#000000',
      paper: 'rgba(8,12,24,0.86)',
    },
    text: {
      primary: '#F5F7FF',
      secondary: '#8B94AA',
    },
    divider: 'rgba(255,255,255,0.10)',
    action: {
      hover: 'rgba(255,255,255,0.06)',
      selected: 'rgba(255,255,255,0.1)',
    },
  },
  shape: { borderRadius: 18 },
  typography: {
    fontFamily: '"Manrope", "Inter", "SF Pro Display", "Segoe UI", sans-serif',
    fontSize: 14,
    h1: { fontFamily: '"Space Grotesk", "Manrope", sans-serif' },
    h2: { fontFamily: '"Space Grotesk", "Manrope", sans-serif' },
    h3: { fontFamily: '"Space Grotesk", "Manrope", sans-serif' },
    h4: { fontFamily: '"Space Grotesk", "Manrope", sans-serif' },
    h5: { fontFamily: '"Space Grotesk", "Manrope", sans-serif' },
    h6: { fontFamily: '"Space Grotesk", "Manrope", sans-serif' },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 999, fontWeight: 700 },
      },
    },
    // Размер иконок из редактора тем (--vera-icon-size, см. userSettingsStore).
    // small/large масштабируются пропорционально стандартным 20/24/35px.
    // Явный fontSize в sx по-прежнему важнее — точечные размеры не ломаются.
    MuiSvgIcon: {
      styleOverrides: {
        fontSizeSmall: { fontSize: 'calc(var(--vera-icon-size, 24px) * 20 / 24)' },
        fontSizeMedium: { fontSize: 'var(--vera-icon-size, 24px)' },
        fontSizeLarge: { fontSize: 'calc(var(--vera-icon-size, 24px) * 35 / 24)' },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'rgba(255,255,255,0.075)',
            borderRadius: 999,
            '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
            '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
            '&.Mui-focused fieldset': { borderColor: 'var(--vera-accent, #00E5FF)' },
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': {
          width: '100%',
          height: '100%',
          minHeight: '100%',
          margin: 0,
          overflow: 'hidden',
          overscrollBehavior: 'none',
        },
        '@keyframes veraRarityPulse': { '0%,100%': { filter: 'brightness(1)' }, '50%': { filter: 'brightness(1.35)' } },
        '@keyframes veraRaritySpin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },

        // ─── Кейфреймы анимированных обводок (магазин) ─────────────────────
        '@keyframes veraRingHue': { from: { backgroundPosition: '0% 50%' }, to: { backgroundPosition: '300% 50%' } },
        '@keyframes veraRingAurora': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        '@keyframes veraRingGlowPulse': { '0%,100%': { filter: 'brightness(1)' }, '50%': { filter: 'brightness(1.5)' } },

        // ─── Кейфреймы обоев (ChatWallpaper) ─────────────────────────────────
        '@keyframes veraWallpaperDrift': {
          from: { transform: 'translate3d(-4%, -3%, 0) scale(1)' },
          to:   { transform: 'translate3d(4%, 3%, 0) scale(1.12)' },
        },
        '@keyframes veraWallpaperRipple': {
          from: { transform: 'translate(-50%,-50%) scale(0)', opacity: 0.9 },
          to:   { transform: 'translate(-50%,-50%) scale(5)', opacity: 0 },
        },
        '@keyframes veraWallpaperFall': {
          from: { transform: 'translateY(-8%)' },
          to:   { transform: 'translateY(108%)' },
        },
        '@keyframes veraWallpaperRain': {
          from: { transform: 'translateY(-10vh)' },
          to:   { transform: 'translateY(110vh)' },
        },
        '@keyframes veraWallpaperTwinkle': {
          '0%,100%': { opacity: 0.25 },
          '50%':     { opacity: 1 },
        },
        '@keyframes veraWallpaperFloat': {
          from: { transform: 'translate3d(0,0,0)' },
          to:   { transform: 'translate3d(40px,-30px,0)' },
        },
        '@keyframes veraWallpaperWave': {
          from: { transform: 'translateY(6%) rotate(-3deg) scale(1.1)', borderRadius: '45% 55% 40% 60% / 60% 40% 60% 40%' },
          to:   { transform: 'translateY(-4%) rotate(4deg) scale(1.25)', borderRadius: '58% 42% 55% 45% / 45% 58% 42% 55%' },
        },
        '@keyframes veraWallpaperAurora': {
          from: { transform: 'translateX(-8%) skewX(-6deg) scaleY(1)', opacity: 0.7 },
          to:   { transform: 'translateX(8%) skewX(6deg) scaleY(1.25)', opacity: 1 },
        },
        '@keyframes veraWallpaperNoise': {
          '0%':   { transform: 'translate(0,0)' },
          '25%':  { transform: 'translate(-6%, 4%)' },
          '50%':  { transform: 'translate(4%, -6%)' },
          '75%':  { transform: 'translate(-3%, -3%)' },
          '100%': { transform: 'translate(0,0)' },
        },
        '@keyframes veraWallpaperBlob': {
          from: { transform: 'translate(0,0) scale(1)' },
          to:   { transform: 'translate(6%, -8%) scale(1.3)' },
        },
        '@keyframes veraWallpaperPan': {
          from: { backgroundPosition: '0% 50%' },
          to:   { backgroundPosition: '100% 50%' },
        },
        '@keyframes veraWallpaperGridPan': {
          from: { backgroundPosition: '0 0' },
          to:   { backgroundPosition: '56px 56px' },
        },

        // ─── Кейфреймы микроанимаций (Apple-like easing) ───────────────────
        '@keyframes veraFadeIn': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        '@keyframes veraFloatIn': {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes veraZoomIn': {
          from: { opacity: 0, transform: 'scale(.96) translateY(10px)' },
          to: { opacity: 1, transform: 'scale(1) translateY(0)' },
        },
        '@keyframes veraPopIn': {
          '0%': { opacity: 0, transform: 'scale(.92)' },
          '70%': { opacity: 1, transform: 'scale(1.015)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        '@keyframes veraMsgIn': {
          from: { opacity: 0, transform: 'translateY(6px) scale(.985)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        '@keyframes veraAuroraShift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        '@keyframes veraFadeOnly': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        '@keyframes veraPulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(76,175,80,.55)' },
          '70%': { boxShadow: '0 0 0 7px rgba(76,175,80,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(76,175,80,0)' },
        },
        '@keyframes veraGlowPulse': {
          '0%,100%': { boxShadow: '0 0 5px currentColor' },
          '50%': { boxShadow: '0 0 16px currentColor' },
        },
        '@keyframes veraSlideUp': {
          from: { opacity: 0, transform: 'translateY(26px) scale(.97)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        html: { width: '100%', maxWidth: '100%', overflowX: 'hidden' },
        // ─── Анимации (каждая группа выключается атрибутом data-anim-off-*) ─
        // 1. Подъём карточек при наведении.
        // will-change намеренно НЕ выставлен: он стоял глобально на всех
        // ListItemButton/Card/ButtonBase/SvgIcon и заставлял браузер держать
        // композитный слой для каждого элемента списка (сотни слоёв = расход
        // GPU-памяти и просадка FPS). Transform-анимации браузер поднимает на
        // слой сам на время перехода.
        'html:not([data-anim-off-hover-lift]) .MuiListItemButton-root': {
          transition: 'transform .28s cubic-bezier(.34,1.56,.64,1), box-shadow .3s cubic-bezier(.16,1,.3,1), background-color .25s ease',
        },
        'html:not([data-anim-off-hover-lift]) .MuiListItemButton-root:hover': { transform: 'translateY(-2px)' },
        'html:not([data-anim-off-hover-lift]) .MuiListItem-root': {
          transition: 'transform .28s cubic-bezier(.34,1.56,.64,1), box-shadow .3s cubic-bezier(.16,1,.3,1)',
        },
        'html:not([data-anim-off-hover-lift]) .MuiListItem-root:hover': { transform: 'translateY(-1px)' },
        'html:not([data-anim-off-hover-lift]) .MuiCard-root': {
          transition: 'transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .35s cubic-bezier(.16,1,.3,1)',
        },
        'html:not([data-anim-off-hover-lift]) .MuiCard-root:hover': { transform: 'translateY(-3px)' },
        'html:not([data-anim-off-hover-lift]) [data-vera-hoverlift]': {
          transition: 'transform .28s cubic-bezier(.34,1.56,.64,1)',
        },
        'html:not([data-anim-off-hover-lift]) [data-vera-hoverlift]:hover': { transform: 'translateY(-2px)' },

        // 2. Нажатие кнопок (мембрана)
        'html:not([data-anim-off-press]) .MuiButtonBase-root': {
          transition: 'transform .18s cubic-bezier(.34,1.56,.64,1), filter .18s ease',
        },
        'html:not([data-anim-off-press]) .MuiButtonBase-root:active': {
          transform: 'scale(.96)',
          filter: 'brightness(.97)',
        },

        // 3. Пружинное всплытие меню
        'html:not([data-anim-off-menus]) .MuiMenu-paper': {
          animation: 'veraPopIn .3s cubic-bezier(.34,1.56,.64,1)',
          transformOrigin: 'top left',
        },
        'html:not([data-anim-off-menus]) .MuiPopover-paper': {
          animation: 'veraPopIn .3s cubic-bezier(.34,1.56,.64,1)',
        },
        'html:not([data-anim-off-menus]) .MuiMenuItem-root': {
          transition: 'background-color .22s ease, padding-left .26s cubic-bezier(.16,1,.3,1)',
        },
        'html:not([data-anim-off-menus]) .MuiMenuItem-root:hover': { paddingLeft: '1.1rem' },

        // 4. Zoom-fade диалогов
        'html:not([data-anim-off-dialogs]) .MuiDialog-paper': {
          animation: 'veraZoomIn .34s cubic-bezier(.2,0,0,1)',
        },

        // 5. Появление сообщений
        'html:not([data-anim-off-messages]) [data-vera-bubble]': {
          animation: 'veraMsgIn .4s cubic-bezier(.16,1,.3,1)',
        },

        // 6. Появление элементов списков (только opacity — не ломают hover)
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root': {
          animation: 'veraFadeOnly .5s cubic-bezier(.16,1,.3,1) both',
        },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(1)': { animationDelay: '0ms' },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(2)': { animationDelay: '40ms' },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(3)': { animationDelay: '80ms' },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(4)': { animationDelay: '120ms' },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(5)': { animationDelay: '160ms' },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(6)': { animationDelay: '200ms' },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(7)': { animationDelay: '240ms' },
        'html:not([data-anim-off-list-entrance]) [data-vera-list] > .MuiListItem-root:nth-child(8)': { animationDelay: '280ms' },

        // 7. Пульс статусов (зелёная точка «онлайн»)
        'html:not([data-anim-off-status-pulse]) .MuiBadge-dot.MuiBadge-success': {
          animation: 'veraPulse 2.6s ease-in-out infinite',
        },

        // 8. Иконки при наведении
        'html:not([data-anim-off-icon-motion]) .MuiIconButton-root .MuiSvgIcon-root': {
          transition: 'transform .3s cubic-bezier(.34,1.56,.64,1)',
        },
        'html:not([data-anim-off-icon-motion]) .MuiIconButton-root:hover .MuiSvgIcon-root': { transform: 'scale(1.14)' },

        // 9. Плавный переход контента вкладок
        'html:not([data-anim-off-tabs]) [data-tab-panel]': {
          animation: 'veraFadeIn .3s cubic-bezier(.16,1,.3,1)',
        },
        'html:not([data-anim-off-tabs]) .MuiTabPanel-root': {
          animation: 'veraFadeIn .3s cubic-bezier(.16,1,.3,1)',
        },

        // 10. Toast-уведомления
        'html:not([data-anim-off-toasts]) .MuiSnackbar-root': {
          animation: 'veraSlideUp .42s cubic-bezier(.34,1.56,.64,1)',
        },

        // 11. Свечение прогресс-бара плеера
        'html:not([data-anim-off-player-glow]) .MuiLinearProgress-bar': {
          animation: 'veraGlowPulse 3.2s ease-in-out infinite',
        },

        // 12. Аккордеоны
        'html:not([data-anim-off-accordions]) .MuiAccordionSummary-root': {
          transition: 'background-color .25s ease, border-radius .3s ease',
        },
        'html:not([data-anim-off-accordions]) .MuiAccordionSummary-root:hover': {
          backgroundColor: 'rgba(255,255,255,0.035)',
        },
        'html:not([data-anim-off-accordions]) .MuiAccordionSummary-expandIconWrapper': {
          transition: 'transform .32s cubic-bezier(.34,1.56,.64,1)',
        },

        // ─── Контролы MUI следуют акценту активной темы (CSS-переменные из App.tsx) ───
        '.MuiSlider-root': {
          '& .MuiSlider-thumb': {
            backgroundColor: 'var(--vera-accent, #00E5FF)',
            transition: 'box-shadow .25s cubic-bezier(.16,1,.3,1), background-color .25s ease',
          },
          '& .MuiSlider-thumb:hover, & .MuiSlider-thumb.Mui-focusVisible': {
            boxShadow: '0 0 0 8px var(--vera-accent-soft, rgba(0,229,255,.2))',
          },
          '& .MuiSlider-track': { backgroundColor: 'var(--vera-accent, #00E5FF)', border: 'none' },
          '& .MuiSlider-rail': { opacity: 0.22 },
          '& .MuiSlider-mark.MuiSlider-markActive': { backgroundColor: 'var(--vera-accent, #00E5FF)' },
          '& .MuiSlider-valueLabel': { backgroundColor: 'var(--vera-accent, #00E5FF)' },
        },
        '.MuiSwitch-switchBase.Mui-checked': { color: 'var(--vera-accent, #00E5FF)' },
        '.MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--vera-accent, #00E5FF)' },
        // Обычные (MUI) переключатели — тоже в цветах темы, и во «вкл», и во
        // «выкл». Префикс html[...] поднимает специфичность над стилями MUI.
        'html[data-switch-style="base"] .MuiSwitch-switchBase': {
          color: 'var(--vera-text-sec, #bdbdbd)',
          '&:hover': { backgroundColor: 'color-mix(in srgb, var(--vera-text-sec, #bdbdbd) 10%, transparent)' },
        },
        'html[data-switch-style="base"] .MuiSwitch-switchBase + .MuiSwitch-track': {
          backgroundColor: 'var(--vera-text-sec, #bdbdbd)',
          opacity: 0.35,
        },
        'html[data-switch-style="base"] .MuiSwitch-switchBase.Mui-checked': {
          color: 'var(--vera-accent, #00E5FF)',
          '&:hover': { backgroundColor: 'var(--vera-accent-soft, rgba(0,229,255,.2))' },
        },
        'html[data-switch-style="base"] .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
          backgroundColor: 'var(--vera-accent, #00E5FF)',
          opacity: 0.5,
        },
        'html[data-switch-style="base"] .MuiSwitch-switchBase.Mui-disabled + .MuiSwitch-track': {
          opacity: 0.15,
        },
        '.MuiCheckbox-root.Mui-checked': { color: 'var(--vera-accent, #00E5FF)' },
        '.MuiRadio-root.Mui-checked': { color: 'var(--vera-accent, #00E5FF)' },
        '.MuiLinearProgress-root .MuiLinearProgress-bar': { backgroundColor: 'var(--vera-accent, #00E5FF)' },
        '.MuiTabs-indicator': { backgroundColor: 'var(--vera-accent, #00E5FF)' },
        '.MuiTab-root.Mui-selected': { color: 'var(--vera-accent, #00E5FF)' },
        '.MuiFormLabel-root.Mui-focused': { color: 'var(--vera-accent, #00E5FF)' },
        '.MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--vera-accent, #00E5FF)' },

        // ─── Системный reduced-motion: глушим всё ─────────────────────────
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
        body: {
          width: '100%', maxWidth: '100%', overflowX: 'hidden',
          background: '#000',
          fontFeatureSettings: '"cv02", "cv03", "cv04"',
          position: 'fixed', inset: 0, overflowY: 'hidden', touchAction: 'pan-y',
        },
        '#root': { width: '100%', maxWidth: '100%', height: '100%', minHeight: 0, overflow: 'hidden' },
        '*': { boxSizing: 'border-box' },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': { background: 'var(--vera-accent-soft, rgba(0,229,255,.32))', borderRadius: 999 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },

        // ─── Стиль интерфейса из настроек ────────────────────────────────
        // Три ползунка (uiPrefsStore → CSS-переменные на <html>) действуют
        // всегда: поверхности, аватарки и пузыри. Список поверхностей задан
        // один раз в сторе (UI_STYLE_SQUIRCLE_TARGETS).
        ...Object.fromEntries(UI_STYLE_SQUIRCLE_TARGETS.map((selector) => [
          `html[data-ui-style] ${selector}`,
          { borderRadius: 'var(--vera-sq-radius, 12px)' },
        ])),
        'html[data-ui-style] .MuiAvatar-root': { borderRadius: 'var(--vera-sq-avatar, 50%)' },
        // Пузыри и ПКМ-меню — не MUI-компоненты, у них свои маркеры. Пузыри
        // берут --vera-bubble-radius в sx (с «хвостиком»), здесь не трогаем.
        'html[data-ui-style] [data-vera-context-menu]': { borderRadius: 'var(--vera-sq-radius, 12px)' },
        // Вкладки «Все / Диалоги / Группы»: в sx у них таблетка (999), здесь
        // явно перебиваем радиусом из ползунка «Поверхности».
        'html[data-ui-style] .MuiButton-root[data-vera-sidebar-tab]': { borderRadius: 'var(--vera-sq-radius, 12px)' },

        // ─── Переключатели в тон стилю ───────────────────────────────────
        // При скруглённо-квадратных углах (data-switch-style="squircle")
        // рисуем дорожку и бегунок скруглёнными квадратами: выкл — ✕,
        // вкл — ○. Цвета — из акцента темы. Иначе остаётся вид MUI.
        // Размеры — только для обычного размера; size="small" сохраняет свои.
        'html[data-switch-style="squircle"] .MuiSwitch-root:not(.MuiSwitch-sizeSmall)': {
          width: 52, height: 32, padding: 4,
          '& .MuiSwitch-switchBase': { padding: 7 },
          '& .MuiSwitch-thumb': { width: 18, height: 18 },
        },
        'html[data-switch-style="squircle"] .MuiSwitch-sizeSmall .MuiSwitch-thumb::before': {
          fontSize: '9px !important',
        },
        'html[data-switch-style="squircle"] .MuiSwitch-track': {
          borderRadius: 'max(4px, calc(var(--vera-sq-radius, 12px) - 4px)) !important',
          opacity: '1 !important',
          backgroundColor: 'color-mix(in srgb, currentColor 22%, transparent) !important',
          border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
        },

        'html[data-switch-style="squircle"] .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
          backgroundColor: 'var(--vera-accent, #00E5FF) !important',
          borderColor: 'var(--vera-accent, #00E5FF)',
        },
        'html[data-switch-style="squircle"] .MuiSwitch-thumb': {
          boxShadow: 'none',
          borderRadius: 'max(3px, calc(var(--vera-sq-radius, 12px) - 7px))',
          backgroundColor: '#fff',
          position: 'relative',
          // Значок внутри бегунка: ✕ (выкл) / ○ (вкл).
          '&::before': {
            content: '"✕"', position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, lineHeight: 1, color: 'rgba(0,0,0,0.55)',
          },
        },
        'html[data-switch-style="squircle"] .MuiSwitch-switchBase.Mui-checked .MuiSwitch-thumb::before': {
          content: '"○"', fontSize: 13, color: 'var(--vera-accent, #00E5FF)',
        },
        'html[data-switch-style="squircle"] .MuiSwitch-switchBase.Mui-disabled + .MuiSwitch-track': {
          opacity: '0.4 !important',
        },

        // ─── Стилевые паки иконок ───────────────────────────────────────
        // Форму даёт базовый вариант MUI (ICON_PACK_BASE), вид — этот слой.
        // vera-ico ставит только шим, поэтому сторонние SVG не задеваются.
        // Превью в выборе пака ([data-icon-preview]) показывает СВОЙ пак, а
        // не текущий: сначала снимаем стиль текущего пака, затем кладём свой.
        // Специфичность у всех трёх групп одинаковая — решает порядок.
        ...Object.fromEntries(Object.entries(ICON_PACK_STYLES).flatMap(([pack, rules]) =>
          Object.entries(rules).map(([tail, style]) => [`html[data-icon-pack="${pack}"] .vera-ico${tail}`, style]))),
        'html [data-icon-preview] .vera-ico': { filter: 'none', background: 'none', boxShadow: 'none', padding: 0, fill: 'currentColor' },
        ...Object.fromEntries(Object.entries(ICON_PACK_STYLES).flatMap(([pack, rules]) =>
          Object.entries(rules).map(([tail, style]) => [`html [data-icon-preview="${pack}"] .vera-ico${tail}`, style]))),


        // Decorative avatar rings can extend beyond the avatar itself. The photo
        // must still follow the avatar shape instead of becoming a rectangle.
        '.MuiAvatar-root > .MuiAvatar-img': {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: 'inherit',
        },

        // Glass: полупрозрачные поверхности с блюром. Помимо бумаги и пузырей
        // накрываем выпадающие списки, поповеры и подсказки — иначе стиль
        // выглядел наполовину: окна стеклянные, а меню под ними матовые.
        'html[data-ui-glass="on"] .MuiPaper-root': {
          backdropFilter: 'blur(16px) saturate(1.4)',
          backgroundColor: 'rgba(255,255,255,0.06) !important',
          border: '1px solid rgba(255,255,255,0.12)',
        },
        'html[data-ui-glass="on"] [data-vera-bubble]': {
          backdropFilter: 'blur(12px) saturate(1.3)',
        },
        'html[data-ui-glass="on"] .MuiDialog-paper': {
          backgroundColor: 'rgba(15,18,30,0.72) !important',
        },
        'html[data-ui-glass="on"] .MuiMenu-paper, html[data-ui-glass="on"] .MuiPopover-paper': {
          backgroundColor: 'rgba(15,18,30,0.72) !important',
        },
        'html[data-ui-glass="on"] .MuiTooltip-tooltip': {
          backgroundColor: 'rgba(15,18,30,0.82) !important',
          backdropFilter: 'blur(12px)',
        },
        'html[data-ui-glass="on"] .MuiChip-root': {
          backgroundColor: 'rgba(255,255,255,0.10) !important',
        },

        // Плоский: убираем все тени, оставляя заливку и границы. Плоские
        // поверхности читаются за счёт контраста, а не объёма.
        ...Object.fromEntries(UI_STYLE_FLAT_TARGETS.map((selector) => [
          `html[data-ui-flat="on"] ${selector}`,
          { boxShadow: 'none' },
        ])),

        // Компактный: уменьшаем отступы и высоту контролов.
        'html[data-ui-compact="on"] .MuiListItemButton-root': { paddingTop: 4, paddingBottom: 4 },
        'html[data-ui-compact="on"] .MuiListItem-root': { paddingTop: 2, paddingBottom: 2 },
        'html[data-ui-compact="on"] .MuiButton-root': { paddingTop: 4, paddingBottom: 4, minHeight: 30 },
        'html[data-ui-compact="on"] .MuiIconButton-root': { padding: 6 },
        'html[data-ui-compact="on"] [data-vera-bubble]': { padding: '6px 10px' },
        'html[data-ui-compact="on"] .MuiOutlinedInput-input': { paddingTop: 6, paddingBottom: 6 },

        // ─── Вид карточек чатов в списке слева ─────────────────────────────
        // Vera — круглые «таблетки» (текущий вид), Telegram — умеренные,
        // VK — почти прямые углы. Радиусы берём из CHAT_SHAPES, чтобы подписи
        // в настройках и реальные значения не разошлись.
        // Селектор [data-vera-chat-row] (специфичность 0,2,1) перебивает
        // сгенерированную sx-классу (0,1,0), поэтому карточки одинаковые,
        // несмотря на borderRadius в sx. Пузыри сообщений не трогаем.
        ...Object.fromEntries(CHAT_SHAPES.map((shape) => [
          `html[data-chat-shape="${shape.id}"] [data-vera-chat-row]`,
          { borderRadius: shape.radius },
        ])),

        // Обводку карточек можно снять совсем. Гасим только цвет, а не саму
        // рамку: border-width остаётся 1px, поэтому высота строк не прыгает.
        // Активный чат при этом виден по заливке (theme.bgActive) и тени.
        'html[data-chat-border="off"] [data-vera-chat-row]': { borderColor: 'transparent' },

        // ─── Без заливки: простая полоса во всю ширину ────────────────────
        // Вертикальный список становится флекс-колонкой без боковых отступов,
        // строка теряет фон и скругление. Активный чат остаётся виден по
        // обводке (если включена) и мягкой тени.
        'html[data-chat-fill="off"] [data-vera-list][data-vera-list-layout="vertical"]': {
          display: 'flex', flexDirection: 'column',
          paddingLeft: 0, paddingRight: 0,
        },
        // Селектор с [data-vera-list] намеренно длиннее правила формы
        // (0,3,1 против 0,2,1): «без заливки» всегда даёт нулевой радиус,
        // независимо от порядка правил в объекте стилей.
        'html[data-chat-fill="off"] [data-vera-list] [data-vera-chat-row]': {
          background: 'transparent',
          // Прямоугольник во всю ширину: скругление «таблетки» на такой
          // полосе выглядит ломанным, поэтому здесь радиус всегда нулевой.
          borderRadius: 0,
        },
        // Единственный чат занимает всю высоту списка.
        'html[data-chat-fill="off"] [data-vera-list][data-vera-list-layout="vertical"] [data-vera-chat-row]:only-child': {
          flex: 1,
        },

      },
    },
  },
});

function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const font = useUserSettingsStore((state) => state.globalFontFamily);
  // Цвета берём из пользовательской темы: палитра MUI ниже собрана в режиме
  // 'dark' (text.primary = #F5F7FF, background.paper = тёмный). Пока она не
  // синхронизирована, любой компонент MUI без собственного `color`
  // (Typography, MenuItem, значение Select, DialogTitle…) рисует почти белый
  // текст — на светлых темах он просто пропадал («Мои скины в этом чате»,
  // пункты меню обоев). Фон paper синхронизируем обязательно: он же подложка
  // для выпадающих списков Select, иначе тёмный текст лёг бы на тёмный фон.
  const appTheme = useThemeStore((state) => state.theme);
  const theme = React.useMemo(() => {
    const fontFamily = resolveAppFont(font);
    return createTheme(darkTheme, {
      palette: muiPaletteFromTheme(appTheme),
      typography: {
        fontFamily,
        ...Object.fromEntries([
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'subtitle2',
          'body1', 'body2', 'button', 'caption', 'overline',
        ].map((variant) => [variant, { fontFamily }])),
      },
    });
  }, [font, appTheme]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={appFontStyles(font)} />
      <IconPackDefs />
      {children}
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <AppThemeProvider>
      {/* Своя панель окна (Electron / PWA без рамки) сверху, приложение под ней. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}>
        <TitleBar />
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </Box>
      </Box>
    </AppThemeProvider>
  </HashRouter>,
);
