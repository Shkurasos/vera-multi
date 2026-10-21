/* Карточка итогов звонка в ленте сообщений: тип, длительность, участники.
 * Данные приходят в attachment.data (пишет сервер при завершении звонка). */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { Call, Videocam } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';

interface CallData {
  kind?: string;
  durationMs?: number;
  participants?: Array<{ id?: string; name?: string }>;
}

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallSummaryCard({ attachment }: { attachment: any }) {
  const theme = useThemeStore((s) => s.theme);
  let data: CallData = {};
  try {
    const raw = attachment?.data;
    data = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {};
  } catch { /* битый payload — покажем хотя бы заголовок */ }
  const isVideo = data.kind === 'video';
  const names = (data.participants || []).map((p) => p?.name).filter(Boolean).join(', ');

  return (
    <Box sx={{
      mt: 0.75, display: 'flex', alignItems: 'center', gap: 1.25,
      px: 1.25, py: 1, borderRadius: 2, maxWidth: 320,
      border: `1px solid ${theme.border}`, bgcolor: 'rgba(255,255,255,0.04)',
    }}>
      <Box sx={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: `${theme.accent}22`,
      }}>
        {isVideo
          ? <Videocam sx={{ fontSize: 20, color: theme.accent }} />
          : <Call sx={{ fontSize: 20, color: theme.accent }} />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
          {isVideo ? 'Видеозвонок' : 'Аудиозвонок'}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: theme.textSec }} noWrap>
          {typeof data.durationMs === 'number' ? `Длительность: ${fmtMs(data.durationMs)}` : 'Звонок завершён'}
          {names ? ` · ${names}` : ''}
        </Typography>
      </Box>
    </Box>
  );
}