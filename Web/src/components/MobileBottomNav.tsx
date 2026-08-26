import React, { useState, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button, Badge,
  useMediaQuery,
} from '@mui/material';
import {
  Chat as ChatIcon,
  Group,
  LibraryMusic,
  Storefront,
  AccountCircle,
  DevicesOther,
} from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatStore } from '../store/chatStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import MusicLibrary from './MusicLibrary';
const ThemeMarketplace = lazy(() => import('./ThemeMarketplace').then(m => ({ default: m.ThemeMarketplace })));

const HEIGHT = 68;
export const MOBILE_NAV = { HEIGHT };

export default function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useThemeStore();
  const unread = useChatStore((s) => s.chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0));
  const isMobile = useMediaQuery('(max-width: 700px)');
  const navPos = useUserSettingsStore((s) => s.layout.mobileNavPos);
  const [musicOpen, setMusicOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);

  const activePath = location.pathname;
  const isActive = (p: string) => activePath === p;

  const item = (active: boolean, label: string, onClick: () => void, icon: React.ReactNode, badge?: React.ReactNode) => (
    <Tooltip title={label} placement="top">
      <Box sx={{ position: 'relative' }}>
        <IconButton
          onClick={onClick}
          sx={{
            flex: '0 0 auto',
            width: 50, height: 50, borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: active ? '#fff' : theme.textSec,
            bgcolor: active ? theme.accent : 'transparent',
            boxShadow: active ? `0 8px 18px ${theme.accent}55` : 'none',
            transition: 'transform 220ms cubic-bezier(0.34, 1.3, 0.64, 1), background 220ms ease, color 220ms ease',
            '&:active': { transform: 'scale(0.9)' },
          }}
        >
          {icon}
        </IconButton>
        {badge}
      </Box>
    </Tooltip>
  );

  if (!isMobile) return null;

  return (
    <>
      <Box
        sx={{
          position: 'fixed',
          left: 10, right: 10,
          ...(navPos === 'top' ? { top: 10 } : { bottom: 10 }),
          zIndex: 1400,
          height: HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          borderRadius: 20,
          background: 'linear-gradient(180deg, rgba(30,32,48,0.92), rgba(20,22,36,0.94))',
          backdropFilter: 'blur(20px) saturate(1.4)',
          border: `1px solid ${theme.border}`,
          boxShadow: '0 16px 34px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3)',
          pb: navPos === 'bottom' ? 'env(safe-area-inset-bottom)' : 0,
          pt: navPos === 'top' ? 'env(safe-area-inset-top)' : 0,
          '&::before': {
            content: '""',
            position: 'absolute', inset: 0, borderRadius: 20, pointerEvents: 'none',
            background: `radial-gradient(circle at 12% 0%, ${theme.accent}26 0, transparent 42%), radial-gradient(circle at 90% 100%, rgba(255,79,216,0.16) 0, transparent 40%)`,
          },
        }}
      >
        {item(isActive('/'), 'Чаты', () => navigate('/'), <ChatIcon fontSize="medium" />,
          unread > 0 ? <Badge badgeContent={unread} color="error" sx={{ position: 'absolute', top: 2, right: 0, '& .MuiBadge-badge': { fontSize: 9, minWidth: 16, height: 16, p: 0 } }} /> : undefined)}
        {item(isActive('/contacts'), 'Контакты', () => navigate('/contacts'), <Group fontSize="medium" />)}
        {item(false, 'Музыка', () => setMusicOpen(true), <LibraryMusic fontSize="medium" />)}
        {item(false, 'Темы', () => setMarketplaceOpen(true), <Storefront fontSize="medium" />)}
        {item(isActive('/profile'), 'Профиль', () => navigate('/profile'), <AccountCircle fontSize="medium" />)}
        {item(isActive('/devices'), 'Устройства', () => navigate('/devices'), <DevicesOther fontSize="medium" />)}
      </Box>

      {/* Музыка и плейлисты */}
      <Dialog open={musicOpen} onClose={() => setMusicOpen(false)} fullScreen
        PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Музыка и плейлисты
          <IconButton onClick={() => setMusicOpen(false)} sx={{ color: theme.textSec }}><span style={{ fontSize: 22 }}>✕</span></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}><MusicLibrary /></DialogContent>
        <DialogActions><Button onClick={() => setMusicOpen(false)}>Закрыть</Button></DialogActions>
      </Dialog>

      {/* Магазин тем */}
      <Suspense fallback={null}>{marketplaceOpen && <ThemeMarketplace onClose={() => setMarketplaceOpen(false)} />}</Suspense>
    </>
  );
}