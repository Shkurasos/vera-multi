import React, { useEffect, useState, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Typography, Box, Slider, IconButton, Tooltip, Stack,
} from '@mui/material';
import { PlayCircleOutline, StopCircle, Delete, Upload, VolumeUp, VolumeOff } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatSoundStore } from '../store/chatSoundStore';
import { playChimePreview } from '../utils/notificationSound';

const MAX_SOUND_SIZE = 1.5 * 1024 * 1024;

/**
 * Содержимое настройки глобального звука уведомлений.
 * Используется и диалогом, и вкладкой «Звук» редактора темы.
 */
export function GlobalSoundSettingsContent() {
  const { theme } = useThemeStore();
  const { globalSound, setGlobalSound, globalVolume, setGlobalVolume } = useChatSoundStore();
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Превью не должно «пережить» размонтирование вкладки/диалога.
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

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
      // Стандартный звук: тот же синтез, что и в уведомлениях (раньше здесь
      // была ещё одна копия beep'а с новым AudioContext на каждое нажатие).
      if (playChimePreview(globalVolume)) setPlaying(true);
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
    <>
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
          {globalSound ? globalSound.name : 'Стандартный «тинг»'}
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
    </>
  );
}

/**
 * Диалог для настройки глобального звука уведомлений (по умолчанию для всех чатов).
 */
export default function GlobalSoundSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme } = useThemeStore();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs"
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 17 }}>Звук уведомлений по умолчанию</DialogTitle>
      <DialogContent dividers sx={{ bgcolor: theme.bgChat }}>
        <GlobalSoundSettingsContent />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: theme.textSec, textTransform: 'none' }}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
}