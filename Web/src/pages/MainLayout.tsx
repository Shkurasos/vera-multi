import React, { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Box, Button, IconButton, Typography, useMediaQuery } from '@mui/material';
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
import { usePetStore } from '../store/petStore';
import PetArtwork from '../components/PetArtwork';

// �������� ������ ������ � ���������������� � MusicPlayer.tsx
const PLAYER_EXPANDED = 60;
const PLAYER_COLLAPSED = 32;
const PLAYER_SIDE_MIN = 280;
const PLAYER_SIDE_COLLAPSED = 44;

// Питомец живёт на экране и может быть до 1/5 экрана. Ограничение
// viewport-ориентированное, поэтому работает одинаково на любых мониторах
// (включая мультимониторные рабочие области; на мобильных учитываем
// visualViewport, на десктопе — window-метрики, в т.ч. весь размер окна).
function getMaxPetSize(): number {
  if (typeof window === 'undefined') return 120;
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  return Math.max(48, Math.min(vw, vh) / 5);
}

export default function MainLayout({ onPlayerHost }: { onPlayerHost: (node: HTMLDivElement | null) => void }) {
  // �������� ���������: ����� �����/������ ������ �� ������ ��������������
  // �� ������ (Sidebar + ���� ����) ��� ������ ���������� musicStore.
  const loadChats = useChatStore((s) => s.loadChats);
  const theme = useThemeStore((s) => s.theme);
  const currentTrack = useMusicStore((s) => s.currentTrack);
  const playerCollapsed = useMusicStore((s) => s.playerCollapsed);
  // ������ ������ ���� layout: �������� �� ���� ������ �������������� ��
  // ������ (������� + ���� ����) ��� ����� ������ �������� � �������
  // �������������� ������ ��������, ��� ��� 60+ ���������� � �������.
  const density = useUserSettingsStore((s) => s.layout.density);
  const radius = useUserSettingsStore((s) => s.layout.radius);
  const bubbleRadius = useUserSettingsStore((s) => s.layout.bubbleRadius);
  const mobileNavPos = useUserSettingsStore((s) => s.layout.mobileNavPos);
  const playerPos = useUserSettingsStore((s) => s.layout.playerPos);
  const playerWidth = useUserSettingsStore((s) => s.layout.playerWidth);
  const sidebarSide = useUserSettingsStore((s) => s.layout.sidebarSide);
  const chatOuterMargin = useUserSettingsStore((s) => s.layout.chatOuterMargin);
  const location = useLocation();
  const isMobile = useMediaQuery('(max-width: 700px)');
  const equippedPet = usePetStore((s) => s.equippedPet);
  const updatePetSettings = usePetStore((s) => s.updateSettings);
  // Максимальный размер питомца зависит от размера монитора (1/5 экрана,
  // viewport-ориентированно, с учётом мультимониторных рабочих областей).
  const [maxPetSize, setMaxPetSize] = useState<number>(getMaxPetSize);
  // Размер питомца ограничен 1/5 экрана (viewport-ориентированно, мультимониторно).
  const petSize = equippedPet ? Math.min(equippedPet.settings.size, maxPetSize) : 0;
  const [petPosition, setPetPosition] = useState<{ x: number; y: number } | null>(null);
  // Питомец живёт на экране: сам не пропадает, его можно только убрать (×)
  // и вернуть чипом внизу. Скрытие локальное — настройки и экипировка не меняются.
  const [petHidden, setPetHidden] = useState(false);

  useEffect(() => { loadChats(); }, []);
  useEffect(() => {
    setPetPosition(equippedPet ? { x: equippedPet.settings.x, y: equippedPet.settings.y } : null);
  }, [equippedPet?.id, equippedPet?.settings.x, equippedPet?.settings.y]);
  // Смена/снятие питомца сбрасывает скрытие — новый питомец появляется сразу.
  useEffect(() => { setPetHidden(false); }, [equippedPet?.id]);

  // Размер питомца пересчитывается при изменении окна (переход между
  // мониторами, изменение разрешения, появление/скрытие панели задач и т.п.).
  useEffect(() => {
    const onResize = () => setMaxPetSize(getMaxPetSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const petOverlay = equippedPet ? (
    petHidden ? (
      <Button
        size="small"
        onClick={() => setPetHidden(false)}
        sx={{
          position: 'fixed', right: 12, bottom: 12, zIndex: 31,
          color: theme.text, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
          borderRadius: 999, px: 1.5, textTransform: 'none', fontSize: 12, lineHeight: 1.6,
          boxShadow: '0 6px 18px rgba(0,0,0,.28)',
          '&:hover': { bgcolor: theme.bgHover },
        }}
      >
        Вернуть питомца
      </Button>
    ) : (
    <Box
      onPointerDown={(event) => {
        const startX = event.clientX;
        const startY = event.clientY;
        const initial = petPosition || equippedPet.settings;
        let nextPosition = initial;
        const move = (moveEvent: PointerEvent) => {
          const dx = ((moveEvent.clientX - startX) / Math.max(window.innerWidth, 1)) * 100;
          const dy = ((moveEvent.clientY - startY) / Math.max(window.innerHeight, 1)) * 100;
          // Чтобы питомец всегда оставался виден на экране любого монитора,
          // при перетаскивании не выходим за границы viewport.
          const half = (petSize / 2) / Math.max(window.innerWidth, 1) * 100;
          nextPosition = {
            x: Math.max(half, Math.min(100 - half, initial.x + dx)),
            y: Math.max(half, Math.min(100 - half, initial.y + dy)),
          };
          setPetPosition(nextPosition);
        };
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
          if (nextPosition.x !== initial.x || nextPosition.y !== initial.y) void updatePetSettings(nextPosition);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
      }}
      sx={{
        position: 'fixed',
        left: `${petPosition?.x ?? equippedPet.settings.x}%`,
        top: `${petPosition?.y ?? equippedPet.settings.y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: 30,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      >
      <Box sx={{ position: 'relative', width: petSize, height: petSize }}>
        <PetArtwork petId={equippedPet.id} size={petSize} />
        <IconButton
          size="small"
          aria-label="Скрыть питомца"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPetHidden(true)}
          sx={{ position: 'absolute', top: 0, right: 0, color: theme.text, bgcolor: theme.bgHeader, width: 20, height: 20, fontSize: 14 }}
        >
          ×
        </IconButton>
      </Box>
      {equippedPet.settings.name && (
        <Typography sx={{ color: theme.text, textAlign: 'center', fontSize: 11, fontFamily: equippedPet.settings.font }}>
          {equippedPet.settings.name}
        </Typography>
      )}
    </Box>
    )
  ) : null;

  // ��������� ��������� � ������ ��� CSS-���������� ��� ����� ����������.
  useEffect(() => {
    const densityGap = density === 'compact' ? 0.5 : density === 'roomy' ? 1.6 : 1;
    const root = document.documentElement;
    root.style.setProperty('--vera-density', String(densityGap));
    root.style.setProperty('--vera-radius', `${radius}px`);
    root.style.setProperty('--vera-bubble-radius', `${bubbleRadius}px`);
    root.style.setProperty('--vera-nav-pos', mobileNavPos);
  }, [density, radius, bubbleRadius, mobileNavPos]);

  const onChatList = location.pathname === '/';
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);

  // ���������� ������ visualViewport, ���� ����� ������ �������� ������� �������.
  // ������ ���� ������� �� ������� �������, � �� �� ������ ��� ������ ����.
  useEffect(() => {
    const visibleViewport = window.visualViewport;
    if (!isMobile || onChatList || !visibleViewport) {
      setViewport(null);
      return;
    }
    const updateViewport = () => {
      setViewport({ height: visibleViewport.height, top: visibleViewport.offsetTop });
    };
    updateViewport();
    visibleViewport.addEventListener('resize', updateViewport);
    visibleViewport.addEventListener('scroll', updateViewport);
    return () => {
      visibleViewport.removeEventListener('resize', updateViewport);
      visibleViewport.removeEventListener('scroll', updateViewport);
    };
  }, [isMobile, onChatList]);

  // ������������� ���� (��������� �wallpaper� �������� / ��������� �������).
  const wallpaperSpec = useActiveWallpaperSpec();

  // ������� ������: �����/������ �������� ������������ �����, ������� ������
  // ����������� ����� ������ �������� ������� ����.
  let bottomPad = '0px';
  let topPad = '0px';
  const sidePlayer = !isMobile && playerPos === 'left';
  const effectiveVerticalPos = isMobile && (playerPos === 'left' || playerPos === 'right')
    ? 'bottom'
    : playerPos;
  const maxSidePlayerWidth = Math.max(PLAYER_SIDE_MIN, Math.floor(window.innerWidth / 2));
  const sidePlayerWidth = Math.min(
    Math.max(Number(playerWidth) || 300, PLAYER_SIDE_MIN),
    maxSidePlayerWidth,
  );
  const sidePlayerPad = currentTrack && sidePlayer
    ? `${playerCollapsed ? PLAYER_SIDE_COLLAPSED : sidePlayerWidth}px`
    : '0px';
  if (currentTrack) {
    const size = playerCollapsed ? PLAYER_COLLAPSED : PLAYER_EXPANDED;
    if (effectiveVerticalPos === 'top') topPad = `${size}px`;
    else if (effectiveVerticalPos === 'bottom') bottomPad = `${size}px`;
  }

  const bg = {
    display: 'flex',
    flexDirection: (sidebarSide === 'top' || sidebarSide === 'bottom') ? 'column' as const : 'row' as const,
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    width: '100%',
    maxHeight: '100dvh',
    overflow: 'hidden',
    bgcolor: '#000',
    background: theme.disableBackgroundGlow ? theme.bg : `
      radial-gradient(circle at 8% 0%, ${theme.backgroundGlowColor || '#8FE3CF'}${Math.round((theme.backgroundGlowIntensity ?? 0.18) * 0.75 * 255).toString(16).padStart(2, '0')} 0, transparent 32%),
      radial-gradient(circle at 88% 16%, ${theme.backgroundGlowColor || '#8FE3CF'}${Math.round((theme.backgroundGlowIntensity ?? 0.18) * 0.9 * 255).toString(16).padStart(2, '0')} 0, transparent 34%),
      radial-gradient(circle at 50% 120%, ${theme.backgroundGlowColor || '#8FE3CF'}${Math.round((theme.backgroundGlowIntensity ?? 0.18) * 255).toString(16).padStart(2, '0')} 0, transparent 36%),
      ${theme.bg}
    `,
    pt: topPad,
    pb: bottomPad,
    ...(sidePlayer ? (playerPos === 'left'
      ? { pl: sidePlayerPad }
      : { pr: sidePlayerPad }) : {}),
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

  // ����� ���� ������� � ������ (���, �������) ���������� �������: ���� ������������ ���������.
  const glassPanel = wallpaperSpec ? {
    bgcolor: 'rgba(0,0,0,0.22)',
    backdropFilter: 'blur(26px) saturate(150%)',
    WebkitBackdropFilter: 'blur(26px) saturate(150%)',
  } : {};

  // -- ��������� ���: ������������� ������ ����� ������ �������� --
  if (isMobile) {
    if (onChatList) {
      return (
        <Box sx={{ ...bg, height: '100dvh', minHeight: 0 }}>
          <Sidebar key="vera-sidebar-mobile" open mobile onToggle={() => {}} />
          {petOverlay}
        </Box>
      );
    }
    // �������� ��� � ���������, ��� ������ ��������� (��� � Telegram).
    return (
      <Box sx={{ ...bg, ...(viewport ? {
        position: 'fixed', left: 0, right: 0, top: viewport.top,
        height: viewport.height, maxHeight: viewport.height,
      } : {}) }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, height: '100%', position: 'relative', zIndex: 1 }}>
          <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0, height: '100%' }}>
            <Routes>
              <Route path="/chat/:id" element={<ChatWindow onPlayerHost={onPlayerHost} />} />
              <Route path="/botfather" element={<BotFatherPage />} />
              <Route path="/admin" element={<AdminToolsPage />} />
            </Routes>
          </Box>
        </Box>
        {petOverlay}
      </Box>
    );
  }

  // -- ���������� ��� --
  // ���������� key: ������ ����� ���� ������������ ������� (�����/������/
  // ������/�����), � ��� key React ����������� �� �� �� ������� � �� �����
  // ������� ������� �������������� �� �������, � ������ � ��� �������� ��
  // ��� ��������� ���������: �������� �������� ���, ���������� �����������
  // ������, �������, ������� ���������. � key React ��������� ��� �� ���������.
  const sidebar = <Sidebar key="vera-sidebar" open onToggle={() => {}} />;
  const mainArea = (
    <Box key="vera-main" sx={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
      minWidth: 0,
      position: 'relative',
      zIndex: 1,
    }}>
      <Box sx={{
        flex: 1, overflow: 'hidden', minHeight: 0, height: '100%',
        m: { xs: 0, md: `${chatOuterMargin}px` },
        borderRadius: { xs: 0, md: `${radius}px` },
        border: { xs: 'none', md: `1px solid ${theme.border}` },
        boxShadow: { xs: 'none', md: '0 22px 70px rgba(0,0,0,0.42)' },
        transition: 'border-color 800ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 800ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 220ms ease',
      }}>
        <Routes>
          <Route path="/" element={<WelcomeScreen />} />
          <Route path="/chat/:id" element={<ChatWindow onPlayerHost={onPlayerHost} />} />
          <Route path="/botfather" element={<BotFatherPage />} />
          <Route path="/admin" element={<AdminToolsPage />} />
        </Routes>
      </Box>
    </Box>
  );

  return (
    <Box sx={bg}>
      {/* ������������� ���� ����� (��������� wallpaper + ��������� �� �������). */}
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
      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: (sidebarSide === 'top' || sidebarSide === 'bottom') ? 'column' : 'row', flex: 1, minWidth: 0, minHeight: 0, width: '100%', height: '100%' }}>
        {(sidebarSide === 'right' || sidebarSide === 'bottom') ? [mainArea, sidebar] : [sidebar, mainArea]}
      </Box>
      {petOverlay}
    </Box>
  );
}
