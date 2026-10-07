import React, { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { appealsApi } from '../services/api';

/**
 * Апелляция заблокированного или забаненного пользователя.
 *
 * Попадает администраторам личным сообщением и появляется в админ-панели
 * (/admin?appeal=…). Повторно отправить, пока предыдущая на рассмотрении,
 * нельзя — об этом говорит и сервер, и статус под кнопкой.
 */
export default function AppealDialog({ open, onClose, onSent }: {
  open: boolean; onClose: () => void; onSent?: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [existing, setExisting] = useState<{ status: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setSent(false);
    // Уже поданная апелляция: не предлагаем отправить вторую.
    appealsApi.mine().then(({ data }) => setExisting(data)).catch(() => setExisting(null));
  }, [open]);

  const send = async () => {
    setBusy(true); setError('');
    try {
      await appealsApi.send(text.trim());
      setSent(true);
      setExisting({ status: 'open' });
      onSent?.();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Не удалось отправить апелляцию');
    } finally {
      setBusy(false);
    }
  };

  const pending = sent || existing?.status === 'open';
  return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>Апелляция</DialogTitle>
    <DialogContent>
      {pending ? (
        <Alert severity="success">
          Апелляция отправлена и находится на рассмотрении. Решение придёт вам сообщением.
        </Alert>
      ) : (
        <>
          <Typography sx={{ mb: 2 }}>
            Напишите, что считаете несправедливым. Апелляцию увидит администратор
            и сможет снять блокировку.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            fullWidth multiline minRows={4}
            label="Текст апелляции"
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputProps={{ maxLength: 4000 }}
            sx={{ my: 2 }}
          />
        </>
      )}
    </DialogContent>
    <DialogActions>
      <Button disabled={busy} onClick={onClose}>{pending ? 'Закрыть' : 'Отмена'}</Button>
      {!pending && (
        <Button variant="contained" disabled={busy || !text.trim()} onClick={send}>
          Отправить апелляцию
        </Button>
      )}
    </DialogActions>
  </Dialog>;
}
