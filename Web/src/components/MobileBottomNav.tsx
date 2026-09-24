import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Button, Badge,
} from '@mui/material';
import {
  Chat as ChatIcon,
  LibraryMusic,
  AccountCircle,
  Palette,
} from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatStore } from '../store/chatStore';
import MusicLibrary from './MusicLibrary';

const ThemeEditor = lazy(() => import('./ThemeEditor').then(m => ({ default: m.ThemeEditor })));

const HEIGHT = 70;
export const MOBILE_NAV = { HEIGHT };

export default function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useThemeStore();
  const unread = useChatStore((s) => s.chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0));
  const [musicOpen, setMusicOpen] = useState(false);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [hiding, setHiding] = useState(false);

  const activePath = location.pathname;
  const isChatSection = activePath === '/';
  const isActive = (path: string) => activePath === path;

  useEffect(() => {
    setMusicOpen(false);
    setThemeEditorOpen(false);
    setHiding(false);
  }, [activePath]);

  // Панель не должна «залипать» невидимой: как только оверлеи (Музыка/Темы)
  // закрыты, снимаем анимационное скрытие. Раньше закрытие «Тем» оставляло
  // hiding=true, и нижняя навигация исчезала до перезагрузки страницы.
  useEffect(() => {
    if (!musicOpen && !themeEditorOpen) setHiding(false);
  }, [musicOpen, themeEditorOpen]);

  // Мобильные браузеры восстанавливают страницу из bfcache, не пересоздавая
  // React-состояние: при возврате на вкладку принудительно показываем панель.
  useEffect(() => {
    const restore = () => setHiding(false);
    const onVisible = () => { if (document.visibilityState === 'visible') setHiding(false); };
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // В открытом чате нижняя навигация не должна перекрывать переписку.
  if (activePath.startsWith('/chat/')) return null;

  const hideForOpen = (callback: () => void) => {
    setHiding(true);
    window.setTimeout(callback, 220);
  };

  const openMusic = () => hideForOpen(() => setMusicOpen(true));
  const closeMusic = () => {
    setMusicOpen(false);
    setHiding(false);
  };
  const openThemeEditor = () => hideForOpen(() => setThemeEditorOpen(true));
  const openProfile = () => hideForOpen(() => navigate('/profile'));

  // Закрытие «Тем» обязано вернуть панель на место (иначе она «залипала» скрытой).
  const closeThemeEditor = () => { setThemeEditorOpen(false); setHiding(false); };

  // Пока оверлей открыт или идёт анимация — панель скрыта; во всех остальных
  // случаях она обязана быть видимой.
  const navHidden = hiding || musicOpen || themeEditorOpen;

  const item = (
    active: boolean,
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    badge?: React.ReactNode,
  ) => (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', position: 'relative' }}>
      <IconButton
        aria-label={label}
        onClick={onClick}
        sx={{
          width: '100%', maxWidth: 76, height: 58, borderRadius: 2.5,
          display: 'flex', flexDirection: 'column', gap: 0.25,
          color: active ? theme.accent : theme.textSec,
          bgcolor: active ? `${theme.accent}20` : 'transparent',
          '&:hover': { bgcolor: `${theme.accent}18` },
          '& .MuiSvgIcon-root': { fontSize: 25 },
        }}
      >
        {icon}
        <Box component="span" sx={{ fontSize: 10, lineHeight: 1, whiteSpace: 'nowrap' }}>{label}</Box>
      </IconButton>
      {badge}
    </Box>
  );

  if (!isChatSection) {
    return (
      <Box sx={{ display: { xs: 'flex', md: 'none' }, position: 'fixed', left: 12, bottom: 12, zIndex: 1400 }}>
        <Button
          aria-label="Вернуться в чаты"
          startIcon={<ChatIcon />}
          onClick={() => navigate('/')}
          sx={{
            minWidth: 48, height: 48, px: 1.5, color: theme.text, bgcolor: theme.bgSidebar,
            border: `1px solid ${theme.border}`, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          }}
        >
          Чаты
        </Button>
      </Box>
    );
  }

  return (
    <>
      <Box
        component="nav"
        aria-label="Навигация"
        sx={{
          display: { xs: 'flex', md: 'none' },
          position: 'fixed', left: 8, right: 8,
          bottom: 'max(8px, env(safe-area-inset-bottom))',
          minHeight: HEIGHT, px: 1, py: 0.75,
          zIndex: 1400, alignItems: 'center', justifyContent: 'space-around', gap: 0.5,
          borderRadius: 3,
          bgcolor: theme.bgSidebar,
          backgroundImage: `linear-gradient(180deg, ${theme.bgSidebar}f5, ${theme.bg}f2)`,
          backdropFilter: 'blur(22px) saturate(1.35)',
          border: `1px solid ${theme.border}`,
          boxShadow: '0 -6px 26px rgba(0,0,0,.28), 0 8px 24px rgba(0,0,0,.24)',
          transform: navHidden ? 'translateY(130%)' : 'translateY(0)',
          opacity: navHidden ? 0 : 1,
          pointerEvents: navHidden ? 'none' : 'auto',
          transition: 'transform 220ms ease, opacity 220ms ease',
        }}
      >
        {item(isActive('/'), 'Чаты', () => navigate('/'), <ChatIcon />, unread > 0 ? (
          <Badge badgeContent={unread} color="primary" sx={{ position: 'absolute', top: 2, right: 'calc(50% - 32px)' }} />
        ) : undefined)}
        {item(musicOpen, 'Музыка', openMusic, <LibraryMusic />)}
        {item(isActive('/profile'), 'Профиль', openProfile, <AccountCircle />)}
        {item(themeEditorOpen, 'Темы', openThemeEditor, <Palette />)}
      </Box>

      <Dialog open={musicOpen} onClose={closeMusic} fullScreen
        PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Музыка и плейлисты
          <Button onClick={closeMusic} startIcon={<ChatIcon />} sx={{ color: theme.accent }}>Чаты</Button>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}><MusicLibrary /></DialogContent>
        <DialogActions><Button onClick={closeMusic} sx={{ color: theme.textSec }}>Закрыть</Button></DialogActions>
      </Dialog>

      <Suspense fallback={null}>
        {themeEditorOpen && (
          <ThemeEditor
            onClose={closeThemeEditor}
            onGoChats={() => { closeThemeEditor(); navigate('/'); }}
          />
        )}
      </Suspense>
    </>
  );
}