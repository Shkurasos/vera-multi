import React, { useEffect, useState } from 'react';
import {
  Box, Typography, IconButton, Tooltip, LinearProgress, Snackbar,
} from '@mui/material';
import { PlayArrow, Pause, SkipNext, SkipPrevious, Download, PlaylistAdd } from '@mui/icons-material';
import { useMusicStore } from '../store/musicStore';
import { musicApi } from '../services/api';
import { useThemeStore } from '../store/themeStore';
import type { Track } from '../types';

function downloadZip(playlistId: string) {
  try {
    const res = musicApi.downloadPlaylistZip(playlistId);
    res.then((r) => {
      const blob = r.data as Blob;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `playlist-${playlistId}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    }).catch((e) => console.error('download zip error', e));
  } catch (e) { console.error('download zip error', e); }
}

/** Полезная нагрузка плейлиста внутри attachment (data). */
export interface VeraPlaylistPayload {
  playlistId: string;
  name: string;
  ownerName?: string;
  tracks: Array<{ id: string; title: string; artist?: string }>;
}

/**
 * Карточка плейлиста в сообщении. Воспроизводит треки прямо из чата
 * (через глобальный musicStore), умеет скачивать zip и сохранять себе.
 */
export default function PlaylistMessageCard({ payload }: { payload: VeraPlaylistPayload }) {
  const theme = useThemeStore((s) => s.theme);
  const {
    currentTrack, isPlaying, togglePlay, next, prev, progress, duration,
    play,
  } = useMusicStore();
  const [savedMsg, setSavedMsg] = useState('');
  const [fullTracks, setFullTracks] = useState<Track[] | null>(null);

  // Достаём настоящие fileUrl, чтобы карточка могла играть треки
  // чужого плейлиста (у получателя нет прямых /uploads ссылок).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await musicApi.getPlaylist(payload.playlistId);
        if (!alive) return;
        const p = res.data as { tracks?: Array<{ track: Track }> };
        const list = (p.tracks || []).map(e => e.track).filter(Boolean);
        setFullTracks(list);
      } catch {
        if (alive) setFullTracks([]);
      }
    })();
    return () => { alive = false; };
  }, [payload.playlistId]);

  const playbackSource: Track[] = (fullTracks ?? [])
    .filter(t => t.id && t.fileUrl)
    .map(t => ({ ...t }));

  const isCurrent = currentTrack && playbackSource.some(t => t.id === currentTrack.id);
  const displayTrack = isCurrent ? currentTrack : playbackSource[0];
  const playableAny = !!isCurrent || playbackSource.length > 0;

  const handlePlay = () => {
    if (!playableAny) return;
    if (isCurrent) { togglePlay(); return; }
    play(playbackSource[0], playbackSource);
  };

  const handleSaveToMe = async () => {
    try {
      await musicApi.copyPlaylist(payload.playlistId);
      setSavedMsg('Плейлист сохранён себе');
    } catch (e: any) {
      setSavedMsg(e?.response?.data?.message || 'Не удалось сохранить плейлист');
    }
  };

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', gap: 0.75,
      bgcolor: theme.bgHeader, border: `1px solid ${theme.accent}40`,
      borderRadius: 2, p: 1, maxWidth: 280, minWidth: 220,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton size="small" onClick={handlePlay} disabled={!playableAny} sx={{ color: theme.accent }}>
          {isCurrent && isPlaying ? <Pause /> : <PlayArrow />}
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
            {payload.name}
          </Typography>
          <Typography noWrap sx={{ fontSize: 12, color: theme.textSec }}>
            {payload.tracks.length} треков{payload.ownerName ? ` • ${payload.ownerName}` : ''}
          </Typography>
        </Box>
      </Box>
      <Typography noWrap sx={{ fontSize: 13, color: theme.text, opacity: 0.9 }}>
        {displayTrack?.title}{displayTrack?.artist ? ` — ${displayTrack.artist}` : ''}
      </Typography>
      {isCurrent && duration > 0 && (
        <LinearProgress variant="determinate"
          value={Math.min(100, (progress / duration) * 100)}
          sx={{ height: 2, bgcolor: theme.border, '& .MuiLinearProgress-bar': { bgcolor: theme.accent } }} />
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
        <Tooltip title="Предыдущий">
          <IconButton size="small" onClick={prev} disabled={!isCurrent}><SkipPrevious fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Следующий">
          <IconButton size="small" onClick={next} disabled={!isCurrent}><SkipNext fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Сохранить себе">
          <IconButton size="small" onClick={handleSaveToMe}><PlaylistAdd fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Скачать ZIP">
          <IconButton size="small" onClick={() => downloadZip(payload.playlistId)}><Download fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
      {savedMsg && <Snackbar autoHideDuration={4000} open message={savedMsg} onClose={() => setSavedMsg('')} />}
    </Box>
  );
}