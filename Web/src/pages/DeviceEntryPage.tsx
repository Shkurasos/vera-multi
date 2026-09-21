import { useState } from 'react';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { authApi } from '../services/api';

export default function DeviceEntryPage() {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      <Typography variant="h5" mb={2}>Vera — вход на устройстве</Typography>
      <Typography mb={2}>Уже есть аккаунт? На основном устройстве откройте «Устройства», создайте QR-код и отсканируйте его камерой этого телефона. Или вставьте ссылку ниже.</Typography>
      <TextField fullWidth label="Ссылка привязки" value={link} onChange={e => setLink(e.target.value)} disabled={busy} />
      <Button fullWidth variant="contained" sx={{ mt: 2 }} disabled={busy || !link.trim()} onClick={openLink}>Добавить в существующий аккаунт</Button>
      <Typography variant="body2" mt={3}>Если аккаунта ещё нет, создайте его для этого устройства.</Typography>
      <Button fullWidth sx={{ mt: 1 }} disabled={busy} onClick={createAccount}>{busy ? 'Входим…' : 'Создать аккаунт / восстановить вход'}</Button>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </Paper>
  </Box>;
}