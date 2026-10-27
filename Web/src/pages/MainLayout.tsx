import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Box, Typography, useMediaQuery } from '@mui/material';
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
import GapWallpaper from '../components/GapWallpaper';
import { useActiveWallpaperSpec, isLightColor } from '../hooks/useActiveWallpaper';
import { usePetStore } from '../store/petStore';
import PetArtwork from '../components/PetArtwork';
import useMaxPetSize from '../hooks/useMaxPetSize';
import useWindowWidth from '../hooks/useWindowWidth';
import usePetInteraction, { getPetDock } from '../hooks/usePetInteraction';

// �������� ������ ������ � ���������������� � MusicPlayer.tsx
const PLAYER_EXPANDED = 60;
const PLAYER_COLLAPSED = 32;
const PLAYER_SIDE_MIN = 280;
const PLAYER_SIDE_COLLAPSED = 44;

// Питомец живёт на экране и может быть до 1/5 экрана. Ограничение
// viewport-ориентированное, поэтому работает одинаково на любых мониторах
// (включая мультимониторные рабочие области; на мобильных учитываем
// visualViewport, на десктопе — window-метрики, в т.ч. весь размер окна).

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
  const mobileNavPos = useUserSettingsStore((s) => s.layout.mobileNavPos);
  const playerPos = useUserSettingsStore((s) => s.layout.playerPos);
  const playerWidth = useUserSettingsStore((s) => s.layout.playerWidth);
  const sidebarSide = useUserSettingsStore((s) => s.layout.sidebarSide);
  const chatOuterMargin = useUserSettingsStore((s) => s.layout.chatOuterMargin);
  const location = useLocation();
  const isMobile = useMediaQuery('(max-width: 700px)');
  // Ширина окна с подпиской на resize: отступ под боковой плеер должен
  // пересчитываться при изменении размера окна, а не только при ререндере.
  const windowWidth = useWindowWidth();
  const equippedPet = usePetStore((s) => s.equippedPet);
  const updatePetSettings = usePetStore((s) => s.updateSettings);
  // Максимальный размер питомца зависит от размера монитора (1/5 экрана,
  // viewport-ориентированно, с учётом мультимониторных рабочих областей).
  const maxPetSize = useMaxPetSize();
  // Размер питомца ограничен 1/5 экрана (viewport-ориентированно, мультимониторно).
  const petSize = equippedPet ? Math.min(equippedPet.settings.size, maxPetSize) : 0;
  const [petPosition, setPetPosition] = useState<{ x: number; y: number } | null>(null);
  const [petReaction, setPetReaction] = useState(0);
  const petOverlayRef = useRef<HTMLDivElement | null>(null);
  const petBodyRef = useRef<HTMLDivElement | null>(null);
  const petDock = getPetDock(petPosition || equippedPet?.settings || { x: 50, y: 50 });
  const togglePlay = useMusicStore((s) => s.togglePlay);
  const nextTrack = useMusicStore((s) => s.next);
  const prevTrack = useMusicStore((s) => s.prev);
  const applyPetPosition = useCallback((position: { x: number; y: number }) => {
    const dock = getPetDock(position);
    const overlay = petOverlayRef.current;
    const body = petBodyRef.current;
    if (overlay) {
      overlay.style.left = `${position.x}%`;
      overlay.style.top = `${position.y}%`;
      overlay.style.transform = dock === 'top'
        ? 'translate(-50%, -25%)'
        : dock === 'bottom' ? 'translate(-50%, -75%)' : 'translate(-50%, -50%)';
    }
    if (body) body.style.transform = `rotate(${dock === 'left' ? 45 : dock === 'right' ? -45 : 0}deg)`;
  }, []);
  const petInteraction = usePetInteraction({
    position: petPosition || equippedPet?.settings || { x: 50, y: 50 },
    size: petSize,
    onMove: applyPetPosition,
    onSave: (position) => {
      setPetPosition(position);
      void updatePetSettings(position).catch(console.error);
    },
    onTap: () => {
      setPetReaction((value) => value + 1);
      togglePlay();
    },
    // Двойной тап: правая половина — следующий трек, левая — предыдущий.
    // Первый тап уже переключил play/pause: next()/prev() сами ставят
    // isPlaying: true, а если переключать некуда — возвращаем состояние,
    // которое было до первого тапа.
    onDoubleTap: (side) => {
      setPetReaction((value) => value + 1);
      const music = useMusicStore.getState();
      if (!music.currentTrack || !music.queue.length) { togglePlay(); return; }
      if (side === 'left') {
        // prev() после 3 секунд лишь перематывает в начало — сбрасываем
        // прогресс, чтобы двойной тап всегда уходил на предыдущий трек.
        music.setProgress(0);
        prevTrack();
      } else nextTrack();
    },
  });

  useEffect(() => { loadChats(); }, []);
  useEffect(() => {
    setPetPosition(equippedPet ? { x: equippedPet.settings.x, y: equippedPet.settings.y } : null);
    if (equippedPet) applyPetPosition(equippedPet.settings);
  }, [equippedPet?.id, equippedPet?.settings.x, equippedPet?.settings.y, applyPetPosition]);

  const petOverlay = equippedPet ? (
    <Box
      {...petInteraction}
      ref={petOverlayRef}
      role="button"
      tabIndex={0}
      aria-label="Питомец: нажмите — пауза/play, двойное нажатие справа — следующий трек, слева — предыдущий; можно перетащить"
      sx={{
        position: 'fixed',
        left: `${petPosition?.x ?? equippedPet.settings.x}%`,
        top: `${petPosition?.y ?? equippedPet.settings.y}%`,
        transform: petDock === 'top' ? 'translate(-50%, -25%)' : petDock === 'bottom' ? 'translate(-50%, -75%)' : 'translate(-50%, -50%)',
        width: petSize,
        height: petSize,
        overflow: 'visible',
        zIndex: 30,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        // Не даём браузеру рисовать белую рамку фокуса вокруг питомца:
        // он фокусируется по клику/Tab, а после нажатия любой клавиши
        // :focus-visible подсвечивает его квадратом — жалоба: «около него
        // появляется квадратная белая рамка».
        outline: 'none',
        '&:focus, &:focus-visible': { outline: 'none' },
      }}
      >
      <Box ref={petBodyRef} sx={{
        position: 'relative', width: petSize, height: petSize, overflow: 'visible',
        transform: `rotate(${petDock === 'left' ? 45 : petDock === 'right' ? -45 : 0}deg)`,
        transition: 'transform 180ms ease-out',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}>
        <PetArtwork key={equippedPet.id} petId={equippedPet.id} size={petSize} reaction={petReaction} />
      </Box>
      {equippedPet.settings.name && !petDock && (
        <Typography sx={{ position: 'absolute', top: '100%', width: '100%', color: theme.text, textAlign: 'center', fontSize: 11, fontFamily: equippedPet.settings.font }}>
          {equippedPet.settings.name}
        </Typography>
      )}
    </Box>
  ) : null;

  // ��������� ��������� � ������ ��� CSS-���������� ��� ����� ����������.
  useEffect(() => {
    const densityGap = density === 'compact' ? 0.5 : density === 'roomy' ? 1.6 : 1;
    const root = document.documentElement;
    root.style.setProperty('--vera-density', String(densityGap));
    root.style.setProperty('--vera-radius', `${radius}px`);
    root.style.setProperty('--vera-nav-pos', mobileNavPos);
  }, [density, radius, mobileNavPos]);

  const onChatList = location.pathname === '/';
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);

  // ���������� ������ visualViewport, ���� ����� ������ �������� ������� �������.
  // ������ ���� ������� �� ������� �������, � �� �� ������ ��� ������ ����.
  useEffect(() => {
    const visibleViewport = window.visualViewport;
    // В десктопном приложении экранной клавиатуры нет, а fixed-позиция от
    // top: 0 залезла бы под свою верхнюю панель окна (TitleBar).
    const desktopApp = !!(window as any).veraDesktop;
    if (!isMobile || onChatList || !visibleViewport || desktopApp) {
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
  const sidePlayer = !isMobile && (playerPos === 'left' || playerPos === 'right');
  const effectiveVerticalPos = isMobile && (playerPos === 'left' || playerPos === 'right' || playerPos === 'info')
    ? 'bottom'
    : playerPos;
  const maxSidePlayerWidth = Math.max(PLAYER_SIDE_MIN, Math.floor(windowWidth / 2));
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
        <Box sx={{ ...bg, height: '100%', minHeight: 0 }}>
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
      <GapWallpaper margin={chatOuterMargin} />
      <Box sx={{
        flex: 1, overflow: 'hidden', minHeight: 0, height: '100%',
        // Над полосами фото промежутков (они absolute и иначе легли бы сверху).
        position: 'relative', zIndex: 1,
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
