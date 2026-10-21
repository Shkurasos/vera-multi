/*
 * CallOverlay — полноэкранная панель активного звонка (Discord-style).
 * Сетка тайлов участников + контролы (mic/cam/screen/deaf/leave/minimize).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import {
  Mic, MicOff, Videocam, VideocamOff, ScreenShare, StopScreenShare,
  Headset, HeadsetOff, CallEnd, Fullscreen, FullscreenExit, Check, Close,
} from '@mui/icons-material';
import { useCallStore } from '../store/callStore';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import CallTile from './CallTile';

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Отдельный компонент для отсчёта времени звонка: он рендерится сам,
// не заставляя весь CallOverlay (и все тайлы с видео) перерисовываться
// каждую секунду, иначе видео мигает чёрным.
function CallTimer({ activeChatId }: { activeChatId: string | null }) {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!activeChatId) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [activeChatId]);
  React.useEffect(() => { if (!activeChatId) setElapsed(0); }, [activeChatId]);
  return <Typography sx={{ color: '#22c55e', fontSize: 13 }}>{fmt(elapsed)}</Typography>;
}

export default function CallOverlay() {
  const activeChatId = useCallStore((s) => s.activeChatId);
  const minimized = useCallStore((s) => s.minimized);
  const peers = useCallStore((s) => s.peers);
  const local = useCallStore((s) => s.local);
  const localStream = useCallStore((s) => s.localStream);
  const localScreenStream = useCallStore((s) => s.localScreenStream);
  const kind = useCallStore((s) => s.kind);
  const { toggleMic, toggleCam, toggleDeaf, toggleScreen, leaveCall, setMinimized } = useCallStore();
  // Полноэкранный просмотр демонстрации экрана по клику на тайл.
  const [fullscreen, setFullscreen] = useState<{
    userId: string | null;
    kind: 'local' | 'peer';
    stream: MediaStream | null;
    name: string;
  } | null>(null);
  const openFullscreen = (userId: string | null, kind: 'local' | 'peer', stream: MediaStream | null, name: string) => {
    setFullscreen({ userId, kind, stream, name });
  };
  const closeFullscreen = () => setFullscreen(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  // Привязать поток к видеоэлементу полноэкранного просмотра.
  React.useEffect(() => {
    const el = fullscreenVideoRef.current;
    if (el && fullscreen?.stream && el.srcObject !== fullscreen.stream) {
      el.srcObject = fullscreen.stream;
    }
  }, [fullscreen?.stream]);
  // Закрыть полноэкранный просмотр по Esc.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFullscreen(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeFullscreen]);
  const me = useAuthStore((s) => s.user);
  const chats = useChatStore((s) => s.chats);

  const chat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId]);

  const audioInputId = useCallStore((s) => s.audioInputId);
  const audioOutputId = useCallStore((s) => s.audioOutputId);
  const setAudioInput = useCallStore((s) => s.setAudioInput);
  const setAudioOutput = useCallStore((s) => s.setAudioOutput);
  // Выбор устройств звука по ПКМ: микрофон — ввод, наушники — вывод.
  const [deviceMenu, setDeviceMenu] = useState<{ kind: 'input' | 'output'; anchor: HTMLElement } | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const openDeviceMenu = (kind: 'input' | 'output', anchor: HTMLElement) => {
    setDeviceMenu({ kind, anchor });
    // Список запрашиваем в момент открытия: устройства могли появиться/смениться.
    // 'default'-заглушки браузера фильтруем — вместо них пункт «По умолчанию».
    navigator.mediaDevices?.enumerateDevices?.().then((list) => {
      setInputDevices(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'));
      setOutputDevices(list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'));
    }).catch(() => {});
  };

  if (!activeChatId || minimized) return null;

  const peerList = Object.values(peers);
  const totalTiles = peerList.length + 1;
  const cols = totalTiles <= 1 ? 1 : totalTiles <= 4 ? 2 : totalTiles <= 9 ? 3 : 4;
  const rows = Math.ceil(totalTiles / cols);

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
            ● {kind === 'video' ? 'Видео' : 'Аудио'} · {peerList.length + 1} участник(ов) · <CallTimer activeChatId={activeChatId} />
          </Typography>
        </Box>
        <Tooltip title="Свернуть">
          <IconButton onClick={() => setMinimized(true)} sx={{ color: '#b5bac1' }}>
            <FullscreenExit />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Grid: тайлы делят высоту экрана поровну — без вертикальной прокрутки. */}
      <Box sx={{
        flex: 1, p: 2, minHeight: 0, overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gap: 2,
      }}>
        <CallTile
          isLocal
          displayName={meName}
          avatarUrl={me?.avatarUrl}
          stream={localStream || undefined}
          screenStream={localScreenStream || undefined}
          camOn={local.cam}
          screenOn={local.screen}
          micOn={local.mic}
          deaf={local.deaf}
          speaking={local.speaking}
          onClick={() => (local.screen && localScreenStream
            ? openFullscreen(null, 'local', localScreenStream, meName)
            : null)}
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
              screenStream={p.screenStream || undefined}
              camOn={p.cam}
              screenOn={p.screen}
              micOn={p.mic}
              deaf={p.deaf}
              speaking={p.speaking}
              onClick={() => (p.screen && p.screenStream
                ? openFullscreen(p.userId, 'peer', p.screenStream, dn)
                : null)}
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
          onIcon={<Mic />} offIcon={<MicOff />}
          label={(local.mic ? 'Микрофон вкл.' : 'Микрофон выкл.') + ' · ПКМ — устройство ввода'}
          onContextMenu={(e) => { e.preventDefault(); openDeviceMenu('input', e.currentTarget); }} />
        <ControlBtn active={local.cam} onClick={toggleCam}
          onIcon={<Videocam />} offIcon={<VideocamOff />} label={local.cam ? 'Камера вкл.' : 'Камера выкл.'} />
        <ControlBtn active={local.screen} onClick={toggleScreen}
          onIcon={<ScreenShare />} offIcon={<StopScreenShare />} label="Демонстрация экрана" activeColor="#3b82f6" />
        <ControlBtn active={!local.deaf} onClick={toggleDeaf}
          onIcon={<Headset />} offIcon={<HeadsetOff />}
          label={(local.deaf ? 'Оглушено' : 'Звук вкл.') + ' · ПКМ — устройство вывода'}
          onContextMenu={(e) => { e.preventDefault(); openDeviceMenu('output', e.currentTarget); }} />
        <Tooltip title="Завершить">
          <IconButton onClick={() => leaveCall()} sx={{
            bgcolor: '#ef4444', color: '#fff', width: 56, height: 56, ml: 2,
            '&:hover': { bgcolor: '#dc2626' },
          }}>
            <CallEnd />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Выбор устройств звука (ПКМ по кнопкам): микрофон — ввод, наушники — вывод. */}
      <Menu
        open={!!deviceMenu}
        anchorEl={deviceMenu?.anchor}
        onClose={() => setDeviceMenu(null)}
        // Поверх полноэкранного оверлея звонка (zIndex 9998).
        sx={{ zIndex: 13001 }}
        anchorOrigin={{ horizontal: 'center', vertical: 'top' }}
        transformOrigin={{ horizontal: 'center', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { bgcolor: '#1e1f22', color: '#fff', border: '1px solid #2b2d31', borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxHeight: 300, maxWidth: 'min(90vw, 420px)' } } }}
      >
        {deviceMenu && (() => {
          const isInput = deviceMenu.kind === 'input';
          const devices = isInput ? inputDevices : outputDevices;
          const currentId = isInput ? audioInputId : audioOutputId;
          const pick = (id: string | null) => {
            if (isInput) void setAudioInput(id); else setAudioOutput(id);
            setDeviceMenu(null);
          };
          return (
            <>
              <Box sx={{ px: 2, py: 0.75, fontSize: 11, color: '#b5bac1', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {isInput ? 'Микрофон (ввод)' : 'Звук звонка (вывод)'}
              </Box>
              <MenuItem onClick={() => pick(null)} sx={{ fontSize: 13 }}>
                <Box sx={{ width: 20, display: 'flex', flexShrink: 0 }}>{currentId === null && <Check sx={{ fontSize: 16 }} />}</Box>
                По умолчанию
              </MenuItem>
              {devices.map((d, i) => (
                <MenuItem key={d.deviceId} onClick={() => pick(d.deviceId)} sx={{ fontSize: 13 }}>
                  <Box sx={{ width: 20, display: 'flex', flexShrink: 0 }}>{currentId === d.deviceId && <Check sx={{ fontSize: 16 }} />}</Box>
                  <Box title={d.label || `Устройство ${i + 1}`} sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.label || `Устройство ${i + 1}`}
                  </Box>
                </MenuItem>
              ))}
              {!devices.length && (
                <MenuItem disabled sx={{ fontSize: 13 }}>Устройства не найдены</MenuItem>
              )}
            </>
          );
        })()}
      </Menu>

      {/* Полноэкранный просмотр демонстрации экрана (открывается по клику на тайл). */}
      {fullscreen && (
        <Box sx={{
          position: 'fixed', inset: 0, zIndex: 14000,
          bgcolor: '#0a0b0e', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Box sx={{
            position: 'relative', width: 'min(95vw, 95vh)', height: 'min(95vh, 95vw)',
            maxWidth: '100%', maxHeight: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {fullscreen.stream ? (
              <video
                ref={fullscreenVideoRef}
                autoPlay playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
              />
            ) : null}
            <Tooltip title="Закрыть (Esc)">
              <IconButton
                onClick={closeFullscreen}
                sx={{
                  position: 'absolute', top: 12, right: 12, zIndex: 1,
                  bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', width: 44, height: 44,
                }}
              >
                <Close />
              </IconButton>
            </Tooltip>
            <Typography sx={{
              position: 'absolute', bottom: 16, left: 0, right: 0, zIndex: 1,
              color: '#fff', textAlign: 'center',
              bgcolor: 'rgba(0,0,0,0.5)', px: 2, py: 0.5, borderRadius: 1,
            }}>
              Демонстрация экрана: {fullscreen.name}
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function ControlBtn({
  active, onClick, onIcon, offIcon, label, activeColor, onContextMenu,
}: {
  active: boolean; onClick: () => void; onIcon: React.ReactNode; offIcon: React.ReactNode;
  label: string; activeColor?: string; onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Tooltip title={label}>
      <IconButton
        onClick={onClick}
        onContextMenu={onContextMenu}
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
