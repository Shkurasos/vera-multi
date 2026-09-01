import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, List, ListItemButton, ListItemText, Tooltip, LinearProgress,
} from '@mui/material';
import { PlayArrow, Pause, SkipNext, SkipPrevious, PushPin, Close } from '@mui/icons-material';
import { usersApi, musicApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useMusicStore } from '../store/musicStore';
import { usePlaylistStore } from '../store/playlistStore';
import type { Track } from '../types';

interface Props {
  /** Владелец профиля. Если совпадает с текущим — можно менять закреп. */
  ownerId: string;
  /** Идентификатор закреплённого плейлиста (у пользователя-владельца). */
  pinnedPlaylistId?: string | null;
}

/**
 * Мини-плеер закреплённого плейлиста на профиле пользователя.
 * - Читает playlist по API (`/playlists/:id`), играет через глобальный musicStore.
 * - Владельцу профиля показывает кнопку «Закрепить», открывающую диалог со списком его плейлистов.
 */
export default function ProfilePinnedPlaylistBar({ ownerId, pinnedPlaylistId }: Props) {
  const { user, setUser } = useAuthStore();
  const { currentTrack, isPlaying, play, togglePlay, next, prev, progress, duration } = useMusicStore();
  const { playlists, load: loadPlaylists } = usePlaylistStore();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const isOwner = user?.id === ownerId;

  useEffect(() => {
    let alive = true;
    if (!pinnedPlaylistId) { setTracks([]); setName(''); return; }
    (async () => {
      try {
        const res = await musicApi.getPlaylist(pinnedPlaylistId);
        if (!alive) return;
        const p = res.data as { name: string; tracks?: Array<{ track: Track; position: number }> };
        setName(p.name || '');
        const list = (p.tracks || []).slice().sort((a, b) => a.position - b.position).map(e => e.track).filter(Boolean);
        setTracks(list);
      } catch {
        if (alive) { setTracks([]); setName(''); }
      }
    })();
    return () => { alive = false; };
  }, [pinnedPlaylistId]);

  useEffect(() => { if (isOwner && pickerOpen) loadPlaylists(); }, [isOwner, pickerOpen, loadPlaylists]);

  const inPlaylistTrack = useMemo(() => tracks.find(t => t.id === currentTrack?.id) || null, [tracks, currentTrack]);
  const displayTrack = inPlaylistTrack || tracks[0] || null;

  const handlePlay = () => {
    if (!tracks.length) return;
    if (inPlaylistTrack) { togglePlay(); return; }
    play(tracks[0], tracks);
  };

  const pinPlaylist = async (id: string | null) => {
    try {
      const res = await usersApi.updateMe({ pinnedPlaylistId: id });
      const updated = res.data as any;
      setUser({ ...(user as any), ...updated });
      setPickerOpen(false);
    } catch (e) {
      // молча — снек-бар остаётся вне компонента
      console.error('pin playlist error', e);
    }
  };

  if (!pinnedPlaylistId && !isOwner) return null;

  return (
    <Box sx={{
      width: '100%', maxWidth: 480,
      mt: 1.5, px: 1.5, py: 1, borderRadius: 2,
      bgcolor: 'rgba(0,0,0,0.55)', color: '#fff',
      display: 'flex', alignItems: 'center', gap: 1,
      backdropFilter: 'blur(6px)',
    }}>
      {pinnedPlaylistId && tracks.length ? (
        <>
          <IconButton size="small" onClick={prev} sx={{ color: '#fff' }} disabled={!inPlaylistTrack}><SkipPrevious fontSize="small" /></IconButton>
          <IconButton size="small" onClick={handlePlay} sx={{ color: '#fff' }}>
            {inPlaylistTrack && isPlaying ? <Pause /> : <PlayArrow />}
          </IconButton>
          <IconButton size="small" onClick={next} sx={{ color: '#fff' }} disabled={!inPlaylistTrack}><SkipNext fontSize="small" /></IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 13, fontWeight: 600 }}>
              {(displayTrack?.title) || 'Нет треков'}
            </Typography>
            <Typography noWrap sx={{ fontSize: 11, opacity: 0.75 }}>
              {name} • {displayTrack?.artist || '—'}
            </Typography>
            {inPlaylistTrack && duration > 0 && (
              <LinearProgress variant="determinate"
                value={Math.min(100, (progress / duration) * 100)}
                sx={{ mt: 0.5, height: 2, bgcolor: 'rgba(255,255,255,0.15)', '& .MuiLinearProgress-bar': { bgcolor: '#fff' } }} />
            )}
          </Box>
        </>
      ) : (
        <Typography sx={{ flex: 1, fontSize: 13, opacity: 0.8 }}>
          {isOwner ? 'Закрепите плейлист на профиле' : 'Плейлист недоступен'}
        </Typography>
      )}
      {isOwner && (
        <Tooltip title="Закрепить плейлист">
          <IconButton size="small" onClick={() => setPickerOpen(true)} sx={{ color: '#fff' }}>
            <PushPin fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Закрепить плейлист</DialogTitle>
        <DialogContent dividers>
          {playlists.length === 0
            ? <Typography color="text.secondary">У вас пока нет плейлистов.</Typography>
            : <List dense>
              {playlists.map(p => (
                <ListItemButton key={p.id} selected={p.id === pinnedPlaylistId} onClick={() => pinPlaylist(p.id)}>
                  <ListItemText primary={p.name} secondary={`${p.tracks?.length || 0} треков`} />
                </ListItemButton>
              ))}
            </List>}
        </DialogContent>
        <DialogActions>
          {pinnedPlaylistId && (
            <Button startIcon={<Close />} color="warning" onClick={() => pinPlaylist(null)}>Снять закрепление</Button>
          )}
          <Button onClick={() => setPickerOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
