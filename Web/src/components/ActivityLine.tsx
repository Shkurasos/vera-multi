import React from 'react';
import { Box, Typography } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useProfileCustomizationStore } from '../store/profileCustomizationStore';
import { useMusicStore } from '../store/musicStore';

/**
 * Discord-подобная строка активности. Отображается только у «моего»
 * профиля, потому что настройки activity живут в локальном сторе.
 * Режим 'auto' подхватывает текущий трек из musicStore.
 */
export default function ActivityLine({ userId }: { userId?: string }) {
  const { user: me } = useAuthStore();
  const { theme } = useThemeStore();
  const activityKind = useProfileCustomizationStore((s) => s.activityKind);
  const activityText = useProfileCustomizationStore((s) => s.activityText);
  const currentTrack = useMusicStore((s) => s.currentTrack);
  const isPlaying = useMusicStore((s) => s.isPlaying);

  const isMe = !!me && userId === me.id;
  if (!isMe || activityKind === 'off') return null;

  let verb = '';
  let label = '';
  if (activityKind === 'auto') {
    if (currentTrack && isPlaying) {
      verb = 'Слушает';
      label = `${currentTrack.artist ? currentTrack.artist + ' — ' : ''}${currentTrack.title}`;
    } else {
      return null;
    }
  } else {
    verb = activityKind === 'playing' ? 'Играет в'
      : activityKind === 'watching' ? 'Смотрит'
      : activityKind === 'listening' ? 'Слушает'
      : '';
    label = activityText;
  }
  if (!label) return null;

  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 1,
      px: 1.5, py: 0.5, borderRadius: 999,
      bgcolor: theme.accent + '22', border: `1px solid ${theme.accent}55`,
      mt: 1,
    }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#43b581' }} />
      <Typography sx={{ fontSize: 12, color: theme.text }}>
        {verb ? <b>{verb} </b> : null}{label}
      </Typography>
    </Box>
  );
}
