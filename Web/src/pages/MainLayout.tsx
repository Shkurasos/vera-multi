import React, { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Box, useMediaQuery } from '@mui/material';
import { useChatStore } from '../store/chatStore';
import { useThemeStore } from '../store/themeStore';
import { useMusicStore } from '../store/musicStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import Sidebar from '../components/Sidebar';
import ChatWindow from '../components/ChatWindow';
import WelcomeScreen from '../components/WelcomeScreen';
import BotFatherPage from './BotFatherPage';
import AdminToolsPage from './AdminToolsPage';
import ChatWallpaper from '../components/ChatWallpaper';
import { useActiveWallpaperSpec, isLightColor } from '../hooks/useActiveWallpaper';

// Реальные высоты плеера — синхронизированы с MusicPlayer.tsx
const PLAYER_EXPANDED = 60;
const PLAYER_COLLAPSED = 32;
const NAV_HEIGHT = 78; // место под нижней панелью на мобильном

export default function MainLayout() {
  const { loadChats } = useChatStore();
  const { theme } = useThemeStore();
  const { currentTrack, playerCollapsed } = useMusicStore();
  const layout = useUserSettingsStore((s) => s.layout);
  const location = useLocation();
  const isMobile = useMediaQuery('(max-width: 700px)');

  useEffect(() => { loadChats(); }, []);

  // Применяем плотность и радиус как CSS-переменные для всего приложения.
  useEffect(() => {
    const densityGap = layout.density === 'compact' ? 0.5 : layout.density === 'roomy' ? 1.6 : 1;
    const root = document.documentElement;
    root.style.setProperty('--vera-density', String(densityGap));
    root.style.setProperty('--vera-radius', `${layout.radius}px`);
    root.style.setProperty('--vera-bubble-radius', `${layout.bubbleRadius}px`);
    root.style.setProperty('--vera-nav-pos', layout.mobileNavPos);
  }, [layout.density, layout.radius, layout.bubbleRadius, layout.mobileNavPos]);

  const onChatList = location.pathname === '/';

  // Полноэкранные обои (категория «wallpaper» магазина / кастомные авторов).
  const wallpaperSpec = useActiveWallpaperSpec();

  // Позиция плеера: снизу → padding-bottom, сверху → padding-top
  let bottomPad = '0px';
  let topPad = '0px';
  if (currentTrack) {
    const size = playerCollapsed ? PLAYER_COLLAPSED : PLAYER_EXPANDED;
    if (layout.playerPos === 'top') topPad = `${size}px`;
    else bottomPad = `${size}px`;
  }

  const bg = {
    display: 'flex',
    flexDirection: (layout.sidebarSide === 'top' || layout.sidebarSide === 'bottom') ? 'column' as const : 'row' as const,
    height: '100dvh',
    maxHeight: '100dvh',
    overflow: 'hidden',
    bgcolor: '#000',
    background: `
      radial-gradient(circle at 8% 0%, ${theme.accent}24 0, transparent 32%),
      radial-gradient(circle at 88% 16%, rgba(255,79,216,0.16) 0, transparent 34%),
      radial-gradient(circle at 50% 120%, rgba(124,92,255,0.18) 0, transparent 36%),
      ${theme.bg}
    `,
    pt: topPad,
    pb: bottomPad,
    boxSizing: 'border-box',
    transition: 'padding 160ms ease, background 800ms cubic-bezier(0.22, 1, 0.36, 1), color 800ms cubic-bezier(0.22, 1, 0.36, 1)',
    position: 'relative',
    '&::after': {
      content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(circle at 50% 50%, transparent 0%, transparent 54%, rgba(0,0,0,0.22) 100%), linear-gradient(180deg, rgba(255,255,255,0.035), transparent 26%, rgba(255,255,255,0.018))`,
      mixBlendMode: 'screen',
      transition: 'background 800ms cubic-bezier(0.22, 1, 0.36, 1), opacity 800ms cubic-bezier(0.22, 1, 0.36, 1)',
    },
  };

  // Когда обои активны — панели (чат, сайдбар) становятся стеклом: обои просвечивают размытыми.
  const glassPanel = wallpaperSpec ? {
    bgcolor: 'rgba(0,0,0,0.22)',
    backdropFilter: 'blur(26px) saturate(150%)',
    WebkitBackdropFilter: 'blur(26px) saturate(150%)',
  } : {};

  // ── Мобильный вид: полноэкранный список чатов вместо сайдбара ──
  if (isMobile) {
    if (onChatList) {
      return (
        <Box sx={bg}>
          <Sidebar open mobile onToggle={() => {}} />
        </Box>
      );
    }
    return (
      <Box sx={bg}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, position: 'relative', zIndex: 1 }}>
          <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0, height: '100%', mb: `${NAV_HEIGHT}px` }}>
            <Routes>
              <Route path="/chat/:id" element={<ChatWindow />} />
              <Route path="/botfather" element={<BotFatherPage />} />
              <Route path="/admin" element={<AdminToolsPage />} />
            </Routes>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Десктопный вид ──
  const sidebar = <Sidebar open onToggle={() => {}} />;
  const mainArea = (
    <Box sx={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
      position: 'relative',
      zIndex: 1,
    }}>
      <Box sx={{
        flex: 1, overflow: 'hidden', minHeight: 0, height: '100%',
        m: { xs: 0, md: `${layout.chatOuterMargin}px` },
        borderRadius: { xs: 0, md: `${layout.radius}px` },
        border: { xs: 'none', md: `1px solid ${theme.border}` },
        boxShadow: { xs: 'none', md: '0 22px 70px rgba(0,0,0,0.42)' },
        transition: 'border-color 800ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 800ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 220ms ease',
      }}>
        <Routes>
          <Route path="/" element={<WelcomeScreen />} />
          <Route path="/chat/:id" element={<ChatWindow />} />
          <Route path="/botfather" element={<BotFatherPage />} />
          <Route path="/admin" element={<AdminToolsPage />} />
        </Routes>
      </Box>
    </Box>
  );

  return (
    <Box sx={bg}>
      {/* Полноэкранный слой обоев (категория wallpaper + кастомные от авторов). */}
      {wallpaperSpec && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            transition: 'opacity 800ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <ChatWallpaper spec={wallpaperSpec} isLight={!theme.bg.startsWith('#0') && theme.bg !== '#000000'} />
        </Box>
      )}
      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: (layout.sidebarSide === 'top' || layout.sidebarSide === 'bottom') ? 'column' : 'row', flex: 1, height: '100%' }}>
        {layout.sidebarSide === 'left' && (<>{sidebar}{mainArea}</>)}
        {layout.sidebarSide === 'right' && (<>{mainArea}{sidebar}</>)}
        {layout.sidebarSide === 'top' && (<>{sidebar}{mainArea}</>)}
        {layout.sidebarSide === 'bottom' && (<>{mainArea}{sidebar}</>)}
      </Box>
    </Box>
  );
}
