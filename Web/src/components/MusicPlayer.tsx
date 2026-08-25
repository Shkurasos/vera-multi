import React, { useRef, useEffect, useState } from 'react';
import { Box, IconButton, Slider, Typography, Tooltip, Popover, List, ListItemButton, Avatar, Button } from '@mui/material';
import {
  GraphicEq, Pause, SkipNext, SkipPrevious,
  VolumeUp, VolumeOff, Shuffle, Repeat, RepeatOne, MusicNote,
  LibraryMusic, QueueMusic, Close, DeleteSweep, AutoAwesome,
} from '@mui/icons-material';
import { useMusicStore } from '../store/musicStore';
import { useThemeStore } from '../store/themeStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useMusicVisualizerStore } from '../store/musicVisualizerStore';
import MusicVisualizerOverlay from './MusicVisualizerOverlay';
import MusicVisualizerSettingsDialog from './MusicVisualizerSettingsDialog';

const resolveAudioUrl = (url: string): string => {
  if (!url) return '';
  // data:, blob:, http(s):, file: — отдаём как есть; относительные URL со старого HTTP-режима достраиваем к origin.
  if (/^(data:|blob:|https?:|file:)/i.test(url)) return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

interface Props {
  onOpenLibrary?: () => void;
  libraryOpen?: boolean;
}

export default function MusicPlayer({ onOpenLibrary, libraryOpen }: Props = {}) {
  const {
    currentTrack, isPlaying, volume, progress, duration, queue, currentIndex,
    repeat, shuffle, togglePlay, next, prev,
    setVolume, setProgress, setDuration, toggleRepeat, toggleShuffle,
    playerCollapsed, setPlayerCollapsed, playQueueIndex, removeFromQueue, clearQueue,
  } = useMusicStore();
  const { theme } = useThemeStore();
  const { playlists, getPlaylistTracks } = usePlaylistStore();
  const { settings: visualizerMap, getSettings, setSettings } = useMusicVisualizerStore();

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const systemSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [queueAnchor, setQueueAnchor] = useState<HTMLElement | null>(null);
  const [vizOpen, setVizOpen] = useState(false);
  const [vizSignal, setVizSignal] = useState({ level: 0, bass: 0, beat: 0 });
  const systemAudioReactive = useMusicVisualizerStore((s) => s.systemAudioReactive);
  const setSystemAudioReactive = useMusicVisualizerStore((s) => s.setSystemAudioReactive);

  const currentPlaylist = playlists.find((p) => {
    const ids = getPlaylistTracks(p).map((t) => t.id);
    return ids.length === queue.length && ids.every((id, i) => queue[i]?.id === id);
  });
  const playlistViz = getSettings('playlist', currentPlaylist?.id);
  const trackViz = getSettings('track', currentTrack?.id);
  const activeViz = trackViz.enabled ? trackViz : playlistViz;
  const activeVizScope = trackViz.enabled || !currentPlaylist ? 'track' : 'playlist';
  const activeVizId = activeVizScope === 'track' ? currentTrack?.id : currentPlaylist?.id;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    audio.src = resolveAudioUrl(currentTrack.fileUrl);
    audio.load();
    const tryPlay = () => {
      if (useMusicStore.getState().isPlaying) audio.play().catch(() => {});
    };
    audio.oncanplay = tryPlay;
    return () => { audio.oncanplay = null; };
  }, [currentTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      if (audio.readyState >= 2) audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    const wantSystem = systemAudioReactive;
    const wantPlayer = !!audio && !!currentTrack && activeViz.enabled && isPlaying;
    if (!wantSystem && !wantPlayer) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        if (wantSystem) {
          if (!systemStreamRef.current) {
            const stream = await (navigator.mediaDevices as any).getDisplayMedia({
              audio: true,
              video: true, // требуется, чтобы браузер разрешил захват; трек видео сразу глушим
            });
            // Глушим и убираем видео-треки: нам нужен только audio.
            stream.getVideoTracks().forEach((t: MediaStreamTrack) => { try { t.stop(); } catch {} });
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
              stream.getTracks().forEach((t: MediaStreamTrack) => { try { t.stop(); } catch {} });
              alert('Системный звук не был передан. При выборе источника отметьте «Поделиться звуком системы».');
              setSystemAudioReactive(false);
              return;
            }
            if (cancelled) { audioTracks.forEach((t) => t.stop()); return; }
            systemStreamRef.current = new MediaStream(audioTracks);
            systemSourceRef.current = ctx.createMediaStreamSource(systemStreamRef.current);
            audioTracks[0].onended = () => {
              // Пользователь остановил «Поделиться экраном» → выключаем режим.
              setSystemAudioReactive(false);
            };
          }
          if (!analyserRef.current) analyserRef.current = ctx.createAnalyser();
          // Отсоединяем плеерный источник, если он был подключён к анализатору,
          // и подключаем системный. К destination НЕ коннектим — иначе будет эхо.
          try { sourceRef.current?.disconnect(analyserRef.current); } catch {}
          try { systemSourceRef.current!.disconnect(); } catch {}
          systemSourceRef.current!.connect(analyserRef.current);
        } else {
          // Плеерный режим: гарантируем, что системный источник отключён и стрим остановлен.
          if (systemStreamRef.current) {
            try { systemSourceRef.current?.disconnect(); } catch {}
            systemStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
            systemStreamRef.current = null;
            systemSourceRef.current = null;
          }
          if (audio && !sourceRef.current) {
            sourceRef.current = ctx.createMediaElementSource(audio);
            analyserRef.current = ctx.createAnalyser();
            sourceRef.current.connect(analyserRef.current);
            analyserRef.current.connect(ctx.destination);
          } else if (audio && sourceRef.current && analyserRef.current) {
            try { sourceRef.current.connect(analyserRef.current); } catch {}
          }
        }

        const analyser = analyserRef.current!;
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.86;
        const data = new Uint8Array(analyser.frequencyBinCount);
        let prevBass = 0;
        let smoothLevel = 0;
        let smoothBass = 0;
        let smoothBeat = 0;
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = (from: number, to: number) => {
            let sum = 0; const end = Math.min(to, data.length);
            for (let i = from; i < end; i++) sum += data[i];
            return sum / Math.max(1, end - from) / 255;
          };
          const rawBass = avg(0, 14);
          const rawMid = avg(14, 58);
          const rawHigh = avg(58, data.length);
          const rawLevel = rawBass * 0.42 + rawMid * 0.38 + rawHigh * 0.20;
          const rawBeat = Math.max(0, rawBass - prevBass) * 4.4;
          prevBass = prevBass * 0.82 + rawBass * 0.18;

          const smooth = (prev: number, next: number, attack = 0.34, release = 0.075) =>
            prev + (next - prev) * (next > prev ? attack : release);
          smoothLevel = smooth(smoothLevel, Math.min(1, rawLevel * 1.45), 0.28, 0.055);
          smoothBass = smooth(smoothBass, Math.min(1, rawBass * 1.65), 0.38, 0.065);
          smoothBeat = smooth(smoothBeat, Math.min(1, rawBeat), 0.58, 0.10);

          setVizSignal({ level: smoothLevel, bass: smoothBass, beat: smoothBeat });
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        console.warn('visualizer init failed', e);
        if (wantSystem) setSystemAudioReactive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [currentTrack?.id, isPlaying, activeViz.enabled, activeViz.mode, activeViz.sensitivity, visualizerMap, systemAudioReactive]);

  // Полная зачистка системного стрима при размонтировании
  useEffect(() => () => {
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      systemStreamRef.current = null;
    }
  }, []);

  const handleSeek = (_: unknown, val: number | number[]) => {
    const t = Array.isArray(val) ? val[0] : val;
    if (audioRef.current) audioRef.current.currentTime = t;
    setProgress(t);
  };

  if (!currentTrack) return null;

  const queueOpen = Boolean(queueAnchor);

  const audioNode = (
    <audio
      ref={audioRef}
      src={currentTrack ? resolveAudioUrl(currentTrack.fileUrl) : ''}
      onTimeUpdate={() => setProgress(audioRef.current?.currentTime || 0)}
      onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
      onEnded={next}
      style={{ display: 'none' }}
    />
  );

  if (playerCollapsed) {
    return (
      <>
        {audioNode}
        <Box
          sx={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1300,
            height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            px: 2, bgcolor: theme.bgHeader, borderBottom: `1px solid ${theme.border}`,
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            gap: 1,
          }}
        >
          <Box
            onClick={() => setPlayerCollapsed(false)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', flex: 1, minWidth: 0 }}
          >
            <MusicNote sx={{ fontSize: 15, color: theme.accent, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13, color: theme.text, fontWeight: 500 }} noWrap>
              {currentTrack.title}
            </Typography>
            <Typography sx={{ fontSize: 12, color: theme.textSec }} noWrap>
              — {currentTrack.artist || ''}
            </Typography>
          </Box>
          <Tooltip title="Развернуть плеер">
            <IconButton size="small" onClick={() => setPlayerCollapsed(false)}
              sx={{ color: theme.textSec, '&:hover': { color: theme.text } }}>
              <MusicNote sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </>
    );
  }

  return (
    <>
      {audioNode}
      <MusicVisualizerOverlay settings={activeViz} {...vizSignal} />

      <Box sx={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100,
        height: 60, display: 'flex', alignItems: 'center', px: 1.5, gap: 1,
        bgcolor: theme.bgHeader, borderTop: `1px solid ${theme.border}`,
        boxShadow: '0 -3px 10px rgba(0,0,0,0.25)',
      }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 1.5, bgcolor: theme.bgInput,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, overflow: 'hidden',
        }}>
          {currentTrack.coverUrl ? (
            <img src={currentTrack.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <MusicNote sx={{ fontSize: 18, color: theme.accent }} />
          )}
        </Box>

        <Box sx={{ minWidth: 0, width: 160, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text, lineHeight: 1.2 }} noWrap>
            {currentTrack.title}
          </Typography>
          <Typography sx={{ fontSize: 11, color: theme.textSec, lineHeight: 1.2 }} noWrap>
            {currentTrack.artist || 'Неизвестный'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
          <Tooltip title={shuffle ? 'Shuffle: on' : 'Shuffle: off'}>
            <IconButton size="small" onClick={toggleShuffle}
              sx={{ color: shuffle ? theme.accent : theme.textSec, p: 0.5 }}>
              <Shuffle sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={prev} sx={{ color: theme.textSec, p: 0.5, '&:hover': { color: theme.text } }}>
            <SkipPrevious sx={{ fontSize: 20 }} />
          </IconButton>
          <IconButton
            onClick={togglePlay}
            sx={{ bgcolor: theme.accent, color: '#fff', width: 34, height: 34,
              '&:hover': { bgcolor: theme.accent + 'CC' } }}
          >
            {isPlaying ? <Pause sx={{ fontSize: 18 }} /> : <GraphicEq sx={{ fontSize: 18 }} />}
          </IconButton>
          <IconButton size="small" onClick={next} sx={{ color: theme.textSec, p: 0.5, '&:hover': { color: theme.text } }}>
            <SkipNext sx={{ fontSize: 20 }} />
          </IconButton>
          <Tooltip title={repeat === 'one' ? 'Repeat: one' : repeat === 'all' ? 'Repeat: all' : 'Repeat'}>
            <IconButton size="small" onClick={toggleRepeat}
              sx={{ color: repeat !== 'none' ? theme.accent : theme.textSec, p: 0.5 }}>
              {repeat === 'one' ? <RepeatOne sx={{ fontSize: 14 }} /> : <Repeat sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography sx={{ fontSize: 11, color: theme.textSec, flexShrink: 0, minWidth: 32, textAlign: 'right' }}>{fmt(progress)}</Typography>
          <Slider
            size="small" min={0} max={duration || 1} value={progress}
            onChange={handleSeek}
            sx={{ color: theme.accent, flex: 1,
              '& .MuiSlider-thumb': { width: 10, height: 10 },
              '& .MuiSlider-track': { bgcolor: theme.accent },
              '& .MuiSlider-rail': { bgcolor: theme.border } }}
          />
          <Typography sx={{ fontSize: 11, color: theme.textSec, flexShrink: 0, minWidth: 32 }}>{fmt(duration)}</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <IconButton size="small" onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
            sx={{ color: theme.textSec, p: 0.5, '&:hover': { color: theme.text } }}>
            {volume === 0 ? <VolumeOff sx={{ fontSize: 16 }} /> : <VolumeUp sx={{ fontSize: 16 }} />}
          </IconButton>
          <Slider size="small" min={0} max={1} step={0.01} value={volume}
            onChange={(_, v) => setVolume((Array.isArray(v) ? v[0] : v) as number)}
            sx={{ width: 70, color: theme.accent,
              '& .MuiSlider-thumb': { width: 10, height: 10 },
              '& .MuiSlider-track': { bgcolor: theme.accent },
              '& .MuiSlider-rail': { bgcolor: theme.border } }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="Queue">
            <IconButton size="small" onClick={(e) => setQueueAnchor(e.currentTarget)}
              sx={{ color: queueOpen ? theme.accent : theme.textSec, p: 0.5, '&:hover': { color: theme.text } }}>
              <QueueMusic sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          {onOpenLibrary && (
            <Tooltip title="Библиотека музыки">
              <IconButton size="small" onClick={onOpenLibrary}
                sx={{ color: libraryOpen ? theme.accent : theme.textSec, p: 0.5, '&:hover': { color: theme.text } }}>
                <LibraryMusic sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Подсветка музыки">
            <IconButton size="small" onClick={() => setVizOpen(true)}
              sx={{ color: activeViz.enabled ? theme.accent : theme.textSec, p: 0.5, '&:hover': { color: theme.text } }}>
              <AutoAwesome sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Свернуть плеер">
            <IconButton size="small" onClick={() => setPlayerCollapsed(true)}
              sx={{ color: theme.textSec, p: 0.5, '&:hover': { color: theme.text } }}>
              <MusicNote sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Popover
        open={queueOpen}
        anchorEl={queueAnchor}
        onClose={() => setQueueAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        PaperProps={{
          sx: {
            width: 360,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 420,
            bgcolor: theme.bgHeader,
            color: theme.text,
            border: `1px solid ${theme.border}`,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: `1px solid ${theme.border}` }}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Queue</Typography>
            <Typography sx={{ fontSize: 11, color: theme.textSec }}>{queue.length} tracks</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button size="small" startIcon={<DeleteSweep sx={{ fontSize: 16 }} />} onClick={clearQueue}
              sx={{ color: theme.textSec, textTransform: 'none', fontSize: 12 }}>
              Clear
            </Button>
            <IconButton size="small" onClick={() => setQueueAnchor(null)} sx={{ color: theme.textSec }}>
              <Close sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>
        <List dense sx={{ py: 0, maxHeight: 350, overflowY: 'auto' }}>
          {queue.map((track, index) => {
            const active = index === currentIndex || track.id === currentTrack.id;
            return (
              <ListItemButton key={`${track.id}-${index}`} onClick={() => playQueueIndex(index)}
                sx={{ gap: 1, bgcolor: active ? `${theme.accent}22` : 'transparent', '&:hover': { bgcolor: active ? `${theme.accent}33` : 'rgba(255,255,255,0.06)' } }}>
                <Avatar src={track.coverUrl || ''} variant="rounded" sx={{ width: 34, height: 34, bgcolor: theme.bgInput }}>
                  <MusicNote sx={{ fontSize: 16, color: theme.accent }} />
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? theme.accent : theme.text }} noWrap>
                    {track.title}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: theme.textSec }} noWrap>
                    {track.artist || 'Unknown'}{track.duration ? ` - ${fmt(track.duration)}` : ''}
                  </Typography>
                </Box>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeFromQueue(track.id); }} sx={{ color: theme.textSec }}>
                  <Close sx={{ fontSize: 16 }} />
                </IconButton>
              </ListItemButton>
            );
          })}
        </List>
      </Popover>
      {activeVizId && <MusicVisualizerSettingsDialog
        open={vizOpen}
        title={activeVizScope === 'playlist' ? `Подсветка плейлиста: ${currentPlaylist?.name}` : `Подсветка трека: ${currentTrack.title}`}
        settings={activeVizScope === 'playlist' ? playlistViz : trackViz}
        onChange={(patch) => setSettings(activeVizScope, activeVizId, patch)}
        onClose={() => setVizOpen(false)}
        systemAudioReactive={systemAudioReactive}
        onSystemAudioReactiveChange={setSystemAudioReactive}
      />}
    </>
  );
}