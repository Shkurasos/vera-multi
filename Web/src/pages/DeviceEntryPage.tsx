import { useEffect, useState } from 'react';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { appealsApi, authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

export default function DeviceEntryPage() {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Экран бана: вход не проходит, но апелляцию подать можно — иначе забаненный
  // останется без единого способа оспорить решение.
  const isBanned = useAuthStore((s) => s.isBanned);
  const [appeal, setAppeal] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [appealError, setAppealError] = useState('');
  const [appealSent, setAppealSent] = useState(false);
  const [appealBusy, setAppealBusy] = useState(false);

  useEffect(() => {
    if (!isBanned) return;
    // Статус спрашиваем по cookie установки: токена у забаненного нет.
    appealsApi.mineBanned()
      .then(({ data }) => setAppealSent(!!data?.appeal && data.appeal.status === 'open'))
      .catch(() => {});
  }, [isBanned]);

  const sendAppeal = async () => {
    setAppealBusy(true); setAppealError('');
    try {
      await appealsApi.sendBanned(appealText.trim());
      setAppealSent(true);
      setAppeal(false);
      setAppealText('');
    } catch (e: any) {
      setAppealError(e.response?.data?.message || 'Не удалось отправить апелляцию');
    } finally {
      setAppealBusy(false);
    }
  };

  async function createAccount() {
    setBusy(true); setError('');
    try {
      const { data } = await authApi.device(true);
      localStorage.setItem('vera_token', data.accessToken);
      window.location.replace('/');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось войти. Проверьте соединение.');
      setBusy(false);
    }
  }
  function openLink() {
    let token = link.trim();
    try { token = new URL(token).searchParams.get('token') || ''; } catch {}
    if (!/^vera-link-[a-f0-9]{32}$/.test(token)) { setError('Вставьте ссылку привязки из раздела «Устройства».'); return; }
    window.location.assign('/link?token=' + encodeURIComponent(token));
  }
  return <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center" p={2}>
    <Paper sx={{ p: 3, maxWidth: 440, width: '100%' }}>
      {isBanned ? (
        <>
          <Typography variant="h5" mb={2}>Аккаунт заблокирован</Typography>
          <Alert severity="error" sx={{ mb: 2 }}>
            Вход в аккаунт заблокирован администрацией. Сообщения и чаты недоступны.
          </Alert>
          {appealSent ? (
            <Alert severity="success">Апелляция отправлена и находится на рассмотрении. Решение придёт после её рассмотрения.</Alert>
          ) : appeal ? (
            <>
              <Typography mb={2}>Опишите, что считаете несправедливым. Апелляцию увидит администратор.</Typography>
              {appealError && <Alert severity="error" sx={{ mb: 2 }}>{appealError}</Alert>}
              <TextField
                fullWidth multiline minRows={4}
                label="Текст апелляции"
                value={appealText}
                onChange={(e) => setAppealText(e.target.value)}
                inputProps={{ maxLength: 4000 }}
              />
              <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                <Button onClick={() => { setAppeal(false); setAppealError(''); }}>Отмена</Button>
                <Button variant="contained" disabled={appealBusy || !appealText.trim()} onClick={sendAppeal}>
                  Отправить апелляцию
                </Button>
              </Box>
            </>
          ) : (
            <Button fullWidth variant="contained" onClick={() => setAppeal(true)}>
              Подать апелляцию
            </Button>
          )}
        </>
      ) : (
        <>
      <Typography variant="h5" mb={2}>Vera — вход на устройстве</Typography>
      <Typography mb={2}>Уже есть аккаунт? На основном устройстве откройте «Устройства», создайте QR-код и отсканируйте его камерой этого телефона. Или вставьте ссылку ниже.</Typography>
      <TextField fullWidth label="Ссылка привязки" value={link} onChange={e => setLink(e.target.value)} disabled={busy} />
      <Button fullWidth variant="contained" sx={{ mt: 2 }} disabled={busy || !link.trim()} onClick={openLink}>Добавить в существующий аккаунт</Button>
      <Typography variant="body2" mt={3}>Если аккаунта ещё нет, создайте его для этого устройства.</Typography>
      <Button fullWidth sx={{ mt: 1 }} disabled={busy} onClick={createAccount}>{busy ? 'Входим…' : 'Создать аккаунт / восстановить вход'}</Button>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </>
      )}
    </Paper>
  </Box>;
}