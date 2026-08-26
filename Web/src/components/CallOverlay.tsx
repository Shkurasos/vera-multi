/*
 * CallOverlay — полноэкранная панель активного звонка (Discord-style).
 * Сетка тайлов участников + контролы (mic/cam/screen/deaf/leave/minimize).
 */
import React, { useMemo } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import {
  Mic, MicOff, Videocam, VideocamOff, ScreenShare, StopScreenShare,
  Headset, HeadsetOff, CallEnd, Fullscreen, FullscreenExit,
} from '@mui/icons-material';
import { useCallStore } from '../store/callStore';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import CallTile from './CallTile';

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallOverlay() {
  const activeChatId = useCallStore((s) => s.activeChatId);
  const minimized = useCallStore((s) => s.minimized);
  const peers = useCallStore((s) => s.peers);
  const local = useCallStore((s) => s.local);
  const localStream = useCallStore((s) => s.localStream);
  const kind = useCallStore((s) => s.kind);
  const { toggleMic, toggleCam, toggleDeaf, toggleScreen, leaveCall, setMinimized } = useCallStore();
  const me = useAuthStore((s) => s.user);
  const chats = useChatStore((s) => s.chats);

  const chat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId]);
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!activeChatId) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [activeChatId]);
  React.useEffect(() => { if (!activeChatId) setElapsed(0); }, [activeChatId]);

  if (!activeChatId || minimized) return null;

  const peerList = Object.values(peers);
  const totalTiles = peerList.length + 1;
  const cols = totalTiles <= 1 ? 1 : totalTiles <= 4 ? 2 : totalTiles <= 9 ? 3 : 4;

  const meName = `${me?.firstName || ''} ${me?.lastName || ''}`.trim() || me?.username || 'Вы';
  const title = chat?.name || (chat?.type === 'direct' ? 'Личный звонок' : 'Голосовой канал');

  return (
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 9998,
      bgcolor: '#0e0f13', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <Box sx={{
        px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 2,
        borderBottom: '1px solid #1e1f22',
      }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>{title}</Typography>
          <Typography sx={{ color: '#22c55e', fontSize: 13 }}>
            ● {kind === 'video' ? 'Видео' : 'Аудио'} · {peerList.length + 1} участник(ов) · {fmt(elapsed)}
          </Typography>
        </Box>
        <Tooltip title="Свернуть">
          <IconButton onClick={() => setMinimized(true)} sx={{ color: '#b5bac1' }}>
            <FullscreenExit />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Grid */}
      <Box sx={{
        flex: 1, p: 3, overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 2, alignContent: 'start',
      }}>
        <CallTile
          isLocal
          displayName={meName}
          avatarUrl={me?.avatarUrl}
          stream={localStream || undefined}
          camOn={local.cam}
          micOn={local.mic}
          deaf={local.deaf}
          speaking={local.speaking}
        />
        {peerList.map((p) => {
          const dn = p.user
            ? (`${p.user.firstName || ''} ${p.user.lastName || ''}`.trim() || p.user.username || p.userId.slice(0, 8))
            : p.userId.slice(0, 8);
          return (
            <CallTile
              key={p.userId}
              peer={p}
              displayName={dn}
              avatarUrl={p.user?.avatarUrl}
              stream={p.stream}
              camOn={p.cam}
              micOn={p.mic}
              deaf={p.deaf}
              speaking={p.speaking}
            />
          );
        })}
      </Box>

      {/* Controls */}
      <Box sx={{
        py: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5,
        borderTop: '1px solid #1e1f22', bgcolor: '#0e0f13',
      }}>
        <ControlBtn active={local.mic} onClick={toggleMic}
          onIcon={<Mic />} offIcon={<MicOff />} label={local.mic ? 'Микрофон вкл.' : 'Микрофон выкл.'} />
        <ControlBtn active={local.cam} onClick={toggleCam}
          onIcon={<Videocam />} offIcon={<VideocamOff />} label={local.cam ? 'Камера вкл.' : 'Камера выкл.'} />
        <ControlBtn active={local.screen} onClick={toggleScreen}
          onIcon={<ScreenShare />} offIcon={<StopScreenShare />} label="Демонстрация экрана" activeColor="#3b82f6" />
        <ControlBtn active={!local.deaf} onClick={toggleDeaf}
          onIcon={<Headset />} offIcon={<HeadsetOff />} label={local.deaf ? 'Оглушено' : 'Звук вкл.'} />
        <Tooltip title="Завершить">
          <IconButton onClick={leaveCall} sx={{
            bgcolor: '#ef4444', color: '#fff', width: 56, height: 56, ml: 2,
            '&:hover': { bgcolor: '#dc2626' },
          }}>
            <CallEnd />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function ControlBtn({
  active, onClick, onIcon, offIcon, label, activeColor,
}: {
  active: boolean; onClick: () => void; onIcon: React.ReactNode; offIcon: React.ReactNode;
  label: string; activeColor?: string;
}) {
  return (
    <Tooltip title={label}>
      <IconButton
        onClick={onClick}
        sx={{
          width: 48, height: 48,
          bgcolor: active ? (activeColor || '#2b2d31') : '#ef4444',
          color: '#fff', '&:hover': { bgcolor: active ? (activeColor ? activeColor + 'dd' : '#3a3d43') : '#dc2626' },
        }}
      >
        {active ? onIcon : offIcon}
      </IconButton>
    </Tooltip>
  );
}
