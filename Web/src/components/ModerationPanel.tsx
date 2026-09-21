import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { reportsApi } from '../services/api';

const actions: Record<string, string> = { dismiss: 'Отклонить жалобу', warn: 'Предупреждение', temporary: 'Временный бан аккаунта', permanent: 'Бан аккаунта навсегда', ip: 'Бан по IP', device: 'Бан устройств' };
export default function ModerationPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const reportFromUrl = new URLSearchParams(location.search).get('report') || '';
  const [reports, setReports] = useState<any[]>([]);
  const [selected, setSelected] = useState(reportFromUrl);
  const [report, setReport] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [photo, setPhoto] = useState('');
  const [action, setAction] = useState('warn');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('1440');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => reportsApi.list().then(r => setReports(r.data)).catch(e => setError(e.response?.data?.message || 'Не удалось загрузить жалобы'));
  useEffect(() => { load(); }, []);
  // Notifications use /admin?report=... . Keep the mounted panel in sync when
  // the hash changes instead of requiring a full page remount.
  useEffect(() => { setSelected(reportFromUrl); }, [reportFromUrl]);
  useEffect(() => {
    let cancelled = false; let url = '';
    setReport(null); setMessages([]); setPhoto(''); setReason(''); setError(''); setTotal(0);
    if (selected) {
      setBusy(true);
      (async () => {
        try {
          const [{ data: r }, { data: history }] = await Promise.all([reportsApi.get(selected), reportsApi.messages(selected)]);
          if (cancelled) return;
          setReport(r); setMessages(history.messages); setTotal(history.total);
          if (r.hasPhoto) {
            const { data } = await reportsApi.photo(selected);
            if (!cancelled) { url = URL.createObjectURL(data); setPhoto(url); }
          }
        } catch (e: any) { if (!cancelled) setError(e.response?.data?.message || 'Не удалось открыть жалобу'); }
        finally { if (!cancelled) setBusy(false); }
      })();
    }
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [selected]);
  const decide = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await reportsApi.decide(selected, action, reason, ['temporary','ip','device'].includes(action) ? Number(minutes) : 0);
      setReport(data); await load();
    } catch (e: any) { setError(e.response?.data?.message || 'Не удалось сохранить решение'); }
    finally { setBusy(false); }
  };
  return <Box sx={{ p: 2, mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    <Typography variant="h6">Жалобы пользователей</Typography>
    <Button disabled={busy} onClick={load}>Обновить</Button>
    {error && <Alert severity="error">{error}</Alert>}
    <TextField select fullWidth label="Жалоба" value={reports.some(r => r.id === selected) ? selected : ''} onChange={e => {
      const id = e.target.value;
      setSelected(id);
      navigate(id ? `/admin?report=${encodeURIComponent(id)}` : '/admin', { replace: true });
    }} sx={{ my: 2 }}>
      <MenuItem value="">Выберите жалобу</MenuItem>
      {reports.map(r => <MenuItem key={r.id} value={r.id}>@{r.target.username} — {r.status === 'open' ? 'Новая' : 'Рассмотрена'} — {new Date(r.createdAt).toLocaleString()}</MenuItem>)}
    </TextField>
    {report && <>
      <Typography>От @{report.reporter.username} на @{report.target.username}</Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', my: 2 }}>{report.comment}</Typography>
      {photo && <Box component="img" src={photo} alt="Фото к жалобе" sx={{ maxWidth: '100%', maxHeight: 400 }} />}
      {report.chatId && <Button href={`/#/chat/${encodeURIComponent(report.chatId)}`}>Ссылка на исходный чат</Button>}
      <Typography variant="subtitle1">История чата ({total}), включая удалённые сообщения</Typography>
      <Typography variant="caption">Архив удалений сохраняется с момента включения модерации.</Typography>
      <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
        {messages.map(m => <Box key={m.id} sx={{ p: 1, mb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption">@{m.sender.username} · {new Date(m.createdAt).toLocaleString()}{m.isDeleted ? ' · УДАЛЕНО' : ''}</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text || m.content}</Typography>
          {(m.attachments || []).map((a: any, i: number) => {
            const url = a.fileUrl || a.url || '';
            return /^\/uploads\//.test(url) ? <Button key={i} href={url} target="_blank" rel="noopener noreferrer">{a.fileName || a.originalName || 'Вложение'}</Button> : <Typography key={i} variant="caption">{a.fileName || a.mimeType || 'Вложение'}</Typography>;
          })}
        </Box>)}
      </Box>
      {messages.length < total && <Button disabled={busy} onClick={async () => {
        setBusy(true);
        try { const { data } = await reportsApi.messages(selected, messages.length); setMessages(v => [...v, ...data.messages]); setTotal(data.total); }
        catch { setError('Не удалось загрузить сообщения'); } finally { setBusy(false); }
      }}>Загрузить ещё</Button>}
      {report.status === 'open' ? <>
        <TextField select fullWidth label="Решение" value={action} onChange={e => setAction(e.target.value)} sx={{ my: 2 }}>
          {Object.entries(actions).map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
        </TextField>
        {['temporary','ip','device'].includes(action) && <TextField fullWidth type="number" label="Срок в минутах (0 — навсегда для IP/устройства)" value={minutes} onChange={e => setMinutes(e.target.value)} />}
        {action === 'ip' && <Alert severity="warning">Блокируются известные серверу IP пользователя. Общий IP затронет другие аккаунты.</Alert>}
        <TextField fullWidth multiline minRows={2} label="Причина решения" value={reason} onChange={e => setReason(e.target.value)} inputProps={{ maxLength: 1000 }} sx={{ my: 2 }} />
        <Button color="error" variant="contained" disabled={busy || !reason.trim()} onClick={decide}>Применить решение</Button>
      </> : <Alert severity="info">{actions[report.decision?.action]}: {report.decision?.reason}</Alert>}
    </>}
  </Box>;
}