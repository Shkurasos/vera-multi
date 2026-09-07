import React, { useState, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Typography, Box, Slider, IconButton, Tooltip, Stack,
} from '@mui/material';
import { PlayCircleOutline, StopCircle, Delete, Upload, VolumeUp, VolumeOff } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatSoundStore } from '../store/chatSoundStore';

const MAX_SOUND_SIZE = 1.5 * 1024 * 1024;

/**
 * Диалог для настройки глобального звука уведомлений (по умолчанию для всех чатов).
 * Открывается из Настроек → «Звук уведомлений по умолчанию».
 */
export default function GlobalSoundSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme } = useThemeStore();
  const { globalSound, setGlobalSound, globalVolume, setGlobalVolume } = useChatSoundStore();
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stopPreview() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  }

  function playPreview() {
    if (playing) { stopPreview(); return; }
    if (globalSound?.url) {
      const a = new Audio(globalSound.url);
      a.volume = globalVolume;
      a.onended = () => setPlaying(false);
      audioRef.current = a;
      setPlaying(true);
      a.play().catch(() => setPlaying(false));
    } else {
      // Play default beep
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3 * globalVolume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
        setPlaying(true);
        setTimeout(() => setPlaying(false), 320);
      } catch { /* ignore */ }
    }
  }

  function onPickFile(file?: File | null) {
    if (!file || busy) return;
    if (file.size > MAX_SOUND_SIZE) { alert('Файл слишком большой (макс. 1.5 МБ)'); return; }
    if (!file.type.startsWith('audio/')) { alert('Это не аудиофайл'); return; }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      setGlobalSound({ url: String(reader.result || ''), name: file.name });
      setBusy(false);
    };
    reader.onerror = () => { setBusy(false); alert('Не удалось прочитать файл'); };
    reader.readAsDataURL(file);
  }

  return (
    <Dialog open={open} onClose={() => { stopPreview(); onClose(); }} fullWidth maxWidth="xs"
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 17 }}>Звук уведомлений по умолчанию</DialogTitle>
      <DialogContent dividers sx={{ bgcolor: theme.bgChat }}>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>
          Применяется ко всем чатам, если в чате не установлен свой звук.
        </Typography>

        <Typography sx={{ fontSize: 13, color: theme.textSec, mt: 2, mb: 0.5 }}>
          Громкость: {Math.round(globalVolume * 100)}%
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <VolumeOff sx={{ fontSize: 18, color: theme.textSec }} />
          <Slider size="small"
            value={Math.round(globalVolume * 100)}
            onChange={(_, v) => setGlobalVolume((Array.isArray(v) ? v[0] : v) / 100)}
            min={0} max={100}
            sx={{ color: theme.accent }} />
          <VolumeUp sx={{ fontSize: 18, color: theme.textSec }} />
        </Stack>

        <Typography sx={{ fontSize: 13, color: theme.textSec, mt: 2, mb: 0.5 }}>
          Звук уведомления
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{
            flex: 1, fontSize: 14, color: globalSound ? theme.accent : theme.textSec,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {globalSound ? globalSound.name : 'Стандартный beep'}
          </Typography>
          <Tooltip title={playing ? 'Стоп' : 'Прослушать'}>
            <IconButton size="small" onClick={playPreview} sx={{ color: theme.textSec }}>
              {playing ? <StopCircle /> : <PlayCircleOutline />}
            </IconButton>
          </Tooltip>
          <Tooltip title={globalSound ? 'Заменить файл' : 'Выбрать файл'}>
            <IconButton size="small" component="label" disabled={busy} sx={{ color: theme.text }}>
              <Upload fontSize="small" />
              <input type="file" accept="audio/*" hidden
                onChange={(e) => { onPickFile(e.target.files?.[0]); e.target.value = ''; }} />
            </IconButton>
          </Tooltip>
          {globalSound && (
            <Tooltip title="Сбросить на стандартный">
              <IconButton size="small" onClick={() => setGlobalSound(null)} sx={{ color: theme.textSec }}>
                <Delete fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Typography sx={{ fontSize: 11, color: theme.textSec, mt: 1 }}>
          Файл до 1.5 МБ, только audio/*. Хранится локально на этом устройстве.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { stopPreview(); onClose(); }} sx={{ color: theme.textSec, textTransform: 'none' }}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
}