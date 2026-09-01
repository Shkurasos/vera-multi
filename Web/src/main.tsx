import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Box, Typography, Button } from '@mui/material';
import App from './App';
import './store/uiPrefsStore'; // применяет data-icon-pack / data-ui-style на <html>
import './store/animStore'; // глобальные анимации интерфейса (data-anim-off-* на <html>)


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
            this.setState({ hasError: false, error: '' });
            window.location.href = '#/';
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
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'rgba(255,255,255,0.075)',
            borderRadius: 999,
            '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
            '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
            '&.Mui-focused fieldset': { borderColor: '#00E5FF' },
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
        '@keyframes veraRarityPulse': { '0%,100%': { filter: 'brightness(1)' }, '50%': { filter: 'brightness(1.35)' } },
        '@keyframes veraRaritySpin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },

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
        // 1. Подъём карточек при наведении
        'html:not([data-anim-off-hover-lift]) .MuiListItemButton-root': {
          transition: 'transform .28s cubic-bezier(.34,1.56,.64,1), box-shadow .3s cubic-bezier(.16,1,.3,1), background-color .25s ease',
          willChange: 'transform',
        },
        'html:not([data-anim-off-hover-lift]) .MuiListItemButton-root:hover': { transform: 'translateY(-2px)' },
        'html:not([data-anim-off-hover-lift]) .MuiListItem-root': {
          transition: 'transform .28s cubic-bezier(.34,1.56,.64,1), box-shadow .3s cubic-bezier(.16,1,.3,1)',
        },
        'html:not([data-anim-off-hover-lift]) .MuiListItem-root:hover': { transform: 'translateY(-1px)' },
        'html:not([data-anim-off-hover-lift]) .MuiCard-root': {
          transition: 'transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .35s cubic-bezier(.16,1,.3,1)',
          willChange: 'transform',
        },
        'html:not([data-anim-off-hover-lift]) .MuiCard-root:hover': { transform: 'translateY(-3px)' },
        'html:not([data-anim-off-hover-lift]) [data-vera-hoverlift]': {
          transition: 'transform .28s cubic-bezier(.34,1.56,.64,1)',
        },
        'html:not([data-anim-off-hover-lift]) [data-vera-hoverlift]:hover': { transform: 'translateY(-2px)' },

        // 2. Нажатие кнопок (мембрана)
        'html:not([data-anim-off-press]) .MuiButtonBase-root': {
          transition: 'transform .18s cubic-bezier(.34,1.56,.64,1), filter .18s ease',
          willChange: 'transform',
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
          willChange: 'transform',
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
        },
        '#root': { width: '100%', maxWidth: '100%', minHeight: '100vh', overflowX: 'hidden' },
        '*': { boxSizing: 'border-box' },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': { background: 'rgba(0,229,255,.32)', borderRadius: 999 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },

        // ─── UI-стили из настроек ────────────────────────────────────────
        // Скруглённый: усиливаем радиусы у пузырей, кнопок, полей.
        'html[data-ui-style="rounded"] .MuiPaper-root': { borderRadius: 24 },
        'html[data-ui-style="rounded"] .MuiButton-root': { borderRadius: 999 },
        'html[data-ui-style="rounded"] .MuiOutlinedInput-root': { borderRadius: 999 },
        'html[data-ui-style="rounded"] [data-vera-bubble]': { borderRadius: 26 },

        // Строгий: прямые углы везде.
        'html[data-ui-style="square"] .MuiPaper-root': { borderRadius: 4 },
        'html[data-ui-style="square"] .MuiButton-root': { borderRadius: 4 },
        'html[data-ui-style="square"] .MuiOutlinedInput-root': { borderRadius: 4 },
        'html[data-ui-style="square"] [data-vera-bubble]': { borderRadius: 4 },
        'html[data-ui-style="square"] .MuiAvatar-root': { borderRadius: 6 },

        // Glass: полупрозрачные поверхности с блюром.
        'html[data-ui-style="glass"] .MuiPaper-root': {
          backdropFilter: 'blur(16px) saturate(1.4)',
          backgroundColor: 'rgba(255,255,255,0.06) !important',
          border: '1px solid rgba(255,255,255,0.12)',
        },
        'html[data-ui-style="glass"] [data-vera-bubble]': {
          backdropFilter: 'blur(12px) saturate(1.3)',
        },
        'html[data-ui-style="glass"] .MuiDialog-paper': {
          backgroundColor: 'rgba(15,18,30,0.72) !important',
        },

        // Компактный: уменьшаем отступы и высоту контролов.
        'html[data-ui-style="compact"] .MuiListItemButton-root': { paddingTop: 4, paddingBottom: 4 },
        'html[data-ui-style="compact"] .MuiListItem-root': { paddingTop: 2, paddingBottom: 2 },
        'html[data-ui-style="compact"] .MuiButton-root': { paddingTop: 4, paddingBottom: 4, minHeight: 30 },
        'html[data-ui-style="compact"] .MuiIconButton-root': { padding: 6 },
        'html[data-ui-style="compact"] [data-vera-bubble]': { padding: '6px 10px' },
        'html[data-ui-style="compact"] .MuiOutlinedInput-input': { paddingTop: 6, paddingBottom: 6 },

      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </HashRouter>,
);
