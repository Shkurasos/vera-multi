import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import { useChatStore } from '../store/chatStore';
import { useThemeStore } from '../store/themeStore';
import { useMusicStore } from '../store/musicStore';
import Sidebar from '../components/Sidebar';
import ChatWindow from '../components/ChatWindow';
import WelcomeScreen from '../components/WelcomeScreen';
import BotFatherPage from './BotFatherPage';
import AdminToolsPage from './AdminToolsPage';

// Реальные высоты плеера — синхронизированы с MusicPlayer.tsx
const PLAYER_EXPANDED = 60;
const PLAYER_COLLAPSED = 32;

export default function MainLayout() {
  const { loadChats } = useChatStore();
  const { theme } = useThemeStore();
  const { currentTrack, playerCollapsed } = useMusicStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => { loadChats(); }, []);

  // Нижний отступ зависит от РЕАЛЬНОГО состояния плеера
  let bottomPad = '0px';
  let topPad = '0px';
  if (currentTrack) {
    if (playerCollapsed) {
      // Плеер свёрнут → он СВЕРХУ, отступ сверху; снизу не нужен
      topPad = `${PLAYER_COLLAPSED}px`;
      bottomPad = '0px';
    } else {
      // Плеер развёрнут внизу → отступ снизу
      topPad = '0px';
      bottomPad = `${PLAYER_EXPANDED}px`;
    }
  }

  return (
    <Box sx={{
      display: 'flex',
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
    }}>
      {/* Сайдбар */}
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* Основная область */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
        position: 'relative',
        zIndex: 1,
      }}>
        <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0, height: '100%', m: { xs: 0, md: 1 }, borderRadius: { xs: 0, md: 4 }, border: { xs: 'none', md: `1px solid ${theme.border}` }, boxShadow: { xs: 'none', md: '0 22px 70px rgba(0,0,0,0.42)' }, transition: 'border-color 800ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 800ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
          <Routes>
            <Route path="/" element={<WelcomeScreen />} />
            <Route path="/chat/:id" element={<ChatWindow />} />
            <Route path="/botfather" element={<BotFatherPage />} />
            <Route path="/admin" element={<AdminToolsPage />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}
