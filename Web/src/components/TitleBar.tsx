import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import { TITLE_BAR_HEIGHT, titleBarColors } from '../utils/titleBar';

interface DesktopTitleBarApi {
  /** Высота области системных кнопок, px. */
  height: number;
  platform: string;
  setColors: (colors: { color: string; symbolColor: string }) => void;
}

type Mode = 'electron' | 'wco' | null;

function electronApi(): DesktopTitleBarApi | null {
  const api = (window as any).veraDesktop?.titleBar;
  return api && typeof api.setColors === 'function' ? api : null;
}

function wco(): any {
  return (navigator as any).windowControlsOverlay || null;
}

/** Где мы: Electron без рамки, PWA с Window Controls Overlay или ни то ни другое. */
function useTitleBarMode(): Mode {
  const [mode, setMode] = useState<Mode>(() => (electronApi() ? 'electron' : wco()?.visible ? 'wco' : null));
  useEffect(() => {
    if (electronApi()) return;
    const overlay = wco();
    if (!overlay) return;
    // Пользователь может включать/выключать заголовок кнопкой браузера.
    const update = () => setMode(overlay.visible ? 'wco' : null);
    overlay.addEventListener?.('geometrychange', update);
    return () => overlay.removeEventListener?.('geometrychange', update);
  }, []);
  return mode;
}

/**
 * Верхняя панель окна в цветах темы. Тянется мышью (app-region: drag),
 * двойной клик разворачивает окно; кнопки окна рисует система поверх справа.
 */
export default function TitleBar() {
  const mode = useTitleBarMode();
  const theme = useThemeStore((s) => s.theme);
  const { color, symbolColor } = titleBarColors(theme);

  // Системные кнопки следуют теме: в Electron — по IPC, в PWA — через theme-color.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color);
    electronApi()?.setColors({ color, symbolColor });
  }, [color, symbolColor]);

  if (!mode) return null;
  const api = electronApi();
  const mac = api?.platform === 'darwin';
  const height = mode === 'electron' ? (api?.height || TITLE_BAR_HEIGHT) : `env(titlebar-area-height, ${TITLE_BAR_HEIGHT}px)`;

  return (
    <Box
      component="header"
      aria-label="Заголовок окна"
      sx={{
        flexShrink: 0, height, display: 'flex', alignItems: 'center',
        bgcolor: color, color: theme.textSec,
        borderBottom: `1px solid ${theme.border}`,
        userSelect: 'none', WebkitUserSelect: 'none',
        // Вся полоса — ручка перетаскивания окна.
        WebkitAppRegion: 'drag', appRegion: 'drag',
        transition: 'background-color 800ms cubic-bezier(0.22, 1, 0.36, 1)',
        ...(mode === 'wco'
          ? {
            // Полоса занимает только свободную область, кнопки браузера справа.
            pl: 'calc(env(titlebar-area-x, 0px) + 12px)',
            width: 'env(titlebar-area-width, 100%)',
          }
          // На macOS слева «светофор», на Windows/Linux справа кнопки (~140px).
          : mac ? { pl: '78px' } : { pl: '12px', pr: '140px' }),
      } as any}
    >
      <Box component="img" src="./vera.svg" alt="" aria-hidden="true" sx={{ width: 16, height: 16, mr: 1, flexShrink: 0 }} />
      <Typography component="span" noWrap sx={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.2, color: symbolColor, opacity: 0.85 }}>
        Vera Messenger
      </Typography>
    </Box>
  );
}
