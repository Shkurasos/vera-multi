import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useThemeStore } from '../store/themeStore';

interface Props {
  open: boolean;
  /** Идёт применение (скачивание обоев) — блокируем кнопки, чтобы не дублировать загрузку. */
  busy?: boolean;
  senderName: string;
  onAccept: () => void;
  onReject: () => void;
}

export default function ChatSettingsOfferDialog({ open, busy = false, senderName, onAccept, onReject }: Props) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Dialog open={open} onClose={() => { if (!busy) onReject(); }} PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}` } }}>
      <DialogTitle sx={{ color: theme.text, fontWeight: 700 }}>Предложение настроек чата</DialogTitle>
      <DialogContent>
        <Typography sx={{ color: theme.textSec }}>
          {senderName} предлагает применить к этому чату свою тему, фон, фото и видео обоев.
          Другие настройки аккаунта изменены не будут.
        </Typography>
        {busy && (
          <Typography sx={{ color: theme.textSec, fontSize: 13, mt: 1.5 }}>
            ⏳ Применяем настройки и загружаем обои…
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={onReject} disabled={busy} sx={{ color: theme.textSec }}>Отклонить</Button>
        <Button onClick={onAccept} disabled={busy} variant="contained" sx={{ bgcolor: theme.accent }}>
          {busy ? 'Применяем…' : 'Принять'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}