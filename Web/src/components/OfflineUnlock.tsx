import { useState } from 'react';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { useAuthStore } from '../store/authStore';
import type { OfflineLockInfo } from '../services/offlineAuth';

/**
 * Экран входа без сети. Ник не спрашиваем: открыть можно только аккаунт
 * последнего пользователя этого устройства, по его паролю.
 */
export default function OfflineUnlock({ info }: { info: OfflineLockInfo }) {
  const unlockOffline = useAuthStore((s) => s.unlockOffline);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) { setError('Введите пароль'); return; }
    setBusy(true);
    setError('');
    const ok = await unlockOffline(password).catch(() => false);
    if (!ok) {
      setError('Неверный пароль');
      setPassword('');
      setBusy(false);
    }
  }

  return <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center" p={2}>
    <Paper sx={{ p: 3, maxWidth: 440, width: '100%' }}>
      <Typography variant="h5" mb={1}>Vera</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Нет подключения к серверу. Без сети доступны последние сообщения чатов и сохранённая музыка.
      </Alert>
      {info.hasCredential ? (
        <Box component="form" onSubmit={submit} noValidate>
          <Typography mb={2}>
            {info.displayName}{info.username ? ` · @${info.username}` : ''}
          </Typography>
          <TextField
            fullWidth autoFocus type="password" label="Пароль" value={password} disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" inputProps={{ maxLength: 256 }}
            sx={{ mb: 2 }}
          />
          <Button fullWidth type="submit" variant="contained" disabled={busy}>
            {busy ? 'Проверяем…' : 'Войти'}
          </Button>
        </Box>
      ) : (
        <Typography mb={1}>
          На этом устройстве ещё не входили по паролю, поэтому без сети его не открыть.
          Подключитесь к интернету и войдите по нику и паролю один раз.
        </Typography>
      )}
      {error && <Alert severity="error" sx={{ mt: 2 }} role="alert">{error}</Alert>}
      <Button fullWidth sx={{ mt: 1 }} disabled={busy} onClick={() => { void checkAuth(); }}>
        Проверить подключение
      </Button>
    </Paper>
  </Box>;
}
