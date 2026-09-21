import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, List, ListItemButton, ListItemText, Tooltip, LinearProgress, Tabs, Tab,
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
  /** Идентификатор закреплённого одиночного трека. Взаимоисключимо с плейлистом. */
  pinnedTrackId?: string | null;
}

/**
 * Мини-плеер закреплённого плейлиста на профиле пользователя.
 * - Читает playlist по API (`/playlists/:id`), играет через глобальный musicStore.
 * - Владельцу профиля показывает кнопку «Закрепить», открывающую диалог со списком его плейлистов.
 */
export default function ProfilePinnedPlaylistBar({ ownerId, pinnedPlaylistId, pinnedTrackId }: Props) {
  const { user, setUser } = useAuthStore();
  const { currentTrack, isPlaying, play, togglePlay, next, prev, progress, duration, tracks: myTracks, loadTracks } = useMusicStore();
  const { playlists, load: loadPlaylists } = usePlaylistStore();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState<string>('');
  const [singleTrack, setSingleTrack] = useState<Track | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<0 | 1>(pinnedTrackId ? 1 : 0);

  const isOwner = user?.id === ownerId;
  const mode: 'playlist' | 'track' | 'none' =
    pinnedTrackId ? 'track' : pinnedPlaylistId ? 'playlist' : 'none';

  useEffect(() => {
    let alive = true;
    if (mode !== 'playlist' || !pinnedPlaylistId) { setTracks([]); setName(''); return; }
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
  }, [pinnedPlaylistId, mode]);

  useEffect(() => {
    let alive = true;
    if (mode !== 'track' || !pinnedTrackId) { setSingleTrack(null); return; }
    (async () => {
      try {
        const res = await musicApi.getTrack(pinnedTrackId);
        if (!alive) return;
        setSingleTrack(res.data as Track);
      } catch { if (alive) setSingleTrack(null); }
    })();
    return () => { alive = false; };
  }, [pinnedTrackId, mode]);

  useEffect(() => {
    if (isOwner && pickerOpen) { loadPlaylists(); loadTracks(); }
  }, [isOwner, pickerOpen, loadPlaylists, loadTracks]);

  const inPlaylistTrack = useMemo(
    () => (mode === 'playlist' ? tracks.find(t => t.id === currentTrack?.id) || null : null),
    [tracks, currentTrack, mode],
  );
  const isSingleActive = mode === 'track' && !!singleTrack && currentTrack?.id === singleTrack.id;
  const displayTrack: Track | null =
    mode === 'playlist' ? (inPlaylistTrack || tracks[0] || null)
    : mode === 'track' ? singleTrack
    : null;

  const handlePlay = () => {
    if (mode === 'playlist') {
      if (!tracks.length) return;
      if (inPlaylistTrack) { togglePlay(); return; }
      play(tracks[0], tracks);
      return;
    }
    if (mode === 'track' && singleTrack) {
      if (isSingleActive) { togglePlay(); return; }
      play(singleTrack, [singleTrack]);
    }
  };

  const pinPlaylist = async (id: string | null) => {
    try {
      const res = await usersApi.updateMe({ pinnedPlaylistId: id, pinnedTrackId: id ? null : (user as any)?.pinnedTrackId ?? null });
      const updated = res.data as any;
      setUser({ ...(user as any), ...updated });
      setPickerOpen(false);
    } catch (e) { console.error('pin playlist error', e); }
  };

  const pinTrack = async (id: string | null) => {
    try {
      const res = await usersApi.updateMe({ pinnedTrackId: id, pinnedPlaylistId: id ? null : (user as any)?.pinnedPlaylistId ?? null });
      const updated = res.data as any;
      setUser({ ...(user as any), ...updated });
      setPickerOpen(false);
    } catch (e) { console.error('pin track error', e); }
  };

  const showActiveProgress = (mode === 'playlist' && !!inPlaylistTrack) || isSingleActive;
  const showPlayerButtons = mode === 'playlist' ? tracks.length > 0 : mode === 'track' && !!singleTrack;

  if (mode === 'none' && !isOwner) return null;

  return (
    <Box sx={{
      width: '100%', maxWidth: 480,
      mt: 1.5, px: 1.5, py: 1, borderRadius: 2,
      bgcolor: 'rgba(0,0,0,0.55)', color: '#fff',
      display: 'flex', alignItems: 'center', gap: 1,
      backdropFilter: 'blur(6px)',
    }}>
      {showPlayerButtons ? (
        <>
          {mode === 'playlist' && (
            <IconButton size="small" onClick={prev} sx={{ color: '#fff' }} disabled={!inPlaylistTrack}><SkipPrevious fontSize="small" /></IconButton>
          )}
          <IconButton size="small" onClick={handlePlay} sx={{ color: '#fff' }}>
            {((mode === 'playlist' && inPlaylistTrack && isPlaying) || (isSingleActive && isPlaying)) ? <Pause /> : <PlayArrow />}
          </IconButton>
          {mode === 'playlist' && (
            <IconButton size="small" onClick={next} sx={{ color: '#fff' }} disabled={!inPlaylistTrack}><SkipNext fontSize="small" /></IconButton>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 13, fontWeight: 600 }}>
              {displayTrack?.title || 'Нет треков'}
            </Typography>
            <Typography noWrap sx={{ fontSize: 11, opacity: 0.75 }}>
              {mode === 'playlist' ? `${name} • ${displayTrack?.artist || '—'}` : (displayTrack?.artist || '—')}
            </Typography>
            {showActiveProgress && duration > 0 && (
              <LinearProgress variant="determinate"
                value={Math.min(100, (progress / duration) * 100)}
                sx={{ mt: 0.5, height: 2, bgcolor: 'rgba(255,255,255,0.15)', '& .MuiLinearProgress-bar': { bgcolor: '#fff' } }} />
            )}
          </Box>
        </>
      ) : (
        <Typography sx={{ flex: 1, fontSize: 13, opacity: 0.8 }}>
          {isOwner ? 'Закрепите плейлист или трек на профиле' : 'Контент недоступен'}
        </Typography>
      )}
      {isOwner && (
        <Tooltip title="Закрепить плейлист или трек">
          <IconButton size="small" onClick={() => { setPickerTab(pinnedTrackId ? 1 : 0); setPickerOpen(true); }} sx={{ color: '#fff' }}>
            <PushPin fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Закрепить на профиле</DialogTitle>
        <Tabs value={pickerTab} onChange={(_, v) => setPickerTab(v)} variant="fullWidth">
          <Tab label="Плейлист" />
          <Tab label="Трек" />
        </Tabs>
        <DialogContent dividers>
          {pickerTab === 0 && (
            playlists.length === 0
              ? <Typography color="text.secondary">У вас пока нет плейлистов.</Typography>
              : <List dense>
                {playlists.map(p => (
                  <ListItemButton key={p.id} selected={p.id === pinnedPlaylistId} onClick={() => pinPlaylist(p.id)}>
                    <ListItemText primary={p.name} secondary={`${p.tracks?.length || 0} треков`} />
                  </ListItemButton>
                ))}
              </List>
          )}
          {pickerTab === 1 && (
            myTracks.length === 0
              ? <Typography color="text.secondary">У вас пока нет загруженных треков.</Typography>
              : <List dense>
                {myTracks.map(t => (
                  <ListItemButton key={t.id} selected={t.id === pinnedTrackId} onClick={() => pinTrack(t.id)}>
                    <ListItemText primary={t.title} secondary={t.artist || '—'} />
                  </ListItemButton>
                ))}
              </List>
          )}
        </DialogContent>
        <DialogActions>
          {(pinnedPlaylistId || pinnedTrackId) && (
            <Button startIcon={<Close />} color="warning" onClick={() => { if (pinnedTrackId) pinTrack(null); else pinPlaylist(null); }}>Снять закрепление</Button>
          )}
          <Button onClick={() => setPickerOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
