import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Box, Typography, Button } from '@mui/material';
import App from './App';

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
        html: { width: '100%', maxWidth: '100%', overflowX: 'hidden' },
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
