import React, { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { reportsApi } from '../services/api';

export default function ReportUserDialog({ targetId, onClose, onSent }: { targetId: string; onClose: () => void; onSent: () => void }) {
  const [chats, setChats] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [chatId, setChatId] = useState('');
  const [comment, setComment] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    reportsApi.sharedChats(targetId).then(({ data }) => {
      if (!cancelled) { setChats(data); setChatId(data[0]?.id || ''); setLoaded(true); }
    }).catch(() => { if (!cancelled) setError('Не удалось загрузить чаты'); });
    return () => { cancelled = true; };
  }, [targetId]);
  const send = async () => {
    setBusy(true); setError('');
    try {
      const data = new FormData(); data.append('targetId', targetId); data.append('chatId', chatId); data.append('comment', comment.trim());
      if (photo) data.append('photo', photo);
      await reportsApi.create(data); onSent();
    } catch (e: any) { setError(e.response?.data?.message || 'Не удалось отправить жалобу'); }
    finally { setBusy(false); }
  };
  return <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>Пожаловаться на пользователя</DialogTitle>
    <DialogContent>
      <Typography sx={{ mb: 2 }}>Комментарий и фото необязательны. Для рассмотрения администрации будет доступна история выбранного чата, включая сохранённые удалённые сообщения.</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {chats.length > 0 ? <TextField select fullWidth label="Чат" value={chatId} onChange={e => setChatId(e.target.value)} sx={{ my: 2 }}>
        {chats.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.type})</MenuItem>)}
      </TextField> : loaded && <Alert severity="info">Общих чатов нет. Жалоба будет отправлена на профиль.</Alert>}
      <TextField fullWidth multiline minRows={4} label="Комментарий (необязательно)" value={comment} onChange={e => setComment(e.target.value)} inputProps={{ maxLength: 4000 }} sx={{ my: 2 }} />
      <Button component="label" disabled={busy}>Прикрепить фото (до 5 МБ)
        <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f && f.size > 5 * 1024 * 1024) { setError('Фото должно быть не больше 5 МБ'); return; }
          setPhoto(f || null);
        }} />
      </Button>
      {photo && <Button onClick={() => setPhoto(null)}>{photo.name} — убрать</Button>}
    </DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>Отмена</Button><Button disabled={busy || !loaded} onClick={send}>Отправить жалобу</Button></DialogActions>
  </Dialog>;
}