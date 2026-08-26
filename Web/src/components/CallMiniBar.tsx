/*
 * CallMiniBar — компактная плашка активного звонка (когда overlay свёрнут).
 * Discord-подобное поведение: показываем аватары говорящих + быстрые контролы.
 */
import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Mic, MicOff, Headset, HeadsetOff, CallEnd, Fullscreen } from '@mui/icons-material';
import { useCallStore } from '../store/callStore';
import { useAuthStore } from '../store/authStore';
import CallTile from './CallTile';

export default function CallMiniBar() {
  const activeChatId = useCallStore((s) => s.activeChatId);
  const minimized = useCallStore((s) => s.minimized);
  const peers = useCallStore((s) => s.peers);
  const local = useCallStore((s) => s.local);
  const { toggleMic, toggleDeaf, leaveCall, setMinimized } = useCallStore();
  const me = useAuthStore((s) => s.user);

  if (!activeChatId || !minimized) return null;

  const peerList = Object.values(peers);
  const meName = `${me?.firstName || ''} ${me?.lastName || ''}`.trim() || me?.username || 'Вы';

  return (
    <Box sx={{
      position: 'fixed', bottom: 12, left: 12, zIndex: 9997,
      bgcolor: '#1e1f22', color: '#fff',
      border: '1px solid #2b2d31', borderRadius: 2,
      px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1.5,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      minWidth: 260,
    }}>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <CallTile
          size="mini" isLocal displayName={meName} avatarUrl={me?.avatarUrl}
          camOn={false} micOn={local.mic} deaf={local.deaf} speaking={local.speaking}
        />
        {peerList.slice(0, 3).map((p) => {
          const dn = p.user
            ? (`${p.user.firstName || ''} ${p.user.lastName || ''}`.trim() || p.user.username || p.userId.slice(0, 6))
            : p.userId.slice(0, 6);
          return (
            <CallTile
              key={p.userId} size="mini" displayName={dn} avatarUrl={p.user?.avatarUrl}
              camOn={false} micOn={p.mic} deaf={p.deaf} speaking={p.speaking}
            />
          );
        })}
        {peerList.length > 3 && (
          <Box sx={{
            width: 32, height: 32, borderRadius: '50%',
            bgcolor: '#2b2d31', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
          }}>+{peerList.length - 3}</Box>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>Голос подключён</Typography>
        <Typography sx={{ fontSize: 11, color: '#b5bac1' }}>{peerList.length + 1} чел.</Typography>
      </Box>

      <Tooltip title={local.mic ? 'Выкл. микрофон' : 'Вкл. микрофон'}>
        <IconButton size="small" onClick={toggleMic} sx={{ color: local.mic ? '#fff' : '#ef4444' }}>
          {local.mic ? <Mic fontSize="small" /> : <MicOff fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Tooltip title={local.deaf ? 'Вкл. звук' : 'Оглушить'}>
        <IconButton size="small" onClick={toggleDeaf} sx={{ color: local.deaf ? '#ef4444' : '#fff' }}>
          {local.deaf ? <HeadsetOff fontSize="small" /> : <Headset fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Tooltip title="Развернуть">
        <IconButton size="small" onClick={() => setMinimized(false)} sx={{ color: '#fff' }}>
          <Fullscreen fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Завершить">
        <IconButton size="small" onClick={leaveCall} sx={{ color: '#ef4444' }}>
          <CallEnd fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
