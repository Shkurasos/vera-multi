import { useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Button, Paper, Alert, CircularProgress, alpha } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { devicesApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

/**
 * AcceptLinkPage — публичная страница привязки устройства.
 * Срабатывает, когда пользователь открывает `vera://link?token=...`
 * или `http://host/link?token=...` на «новом» устройстве.
 *
 * Привязывает ЭТО устройство (deviceId из localStorage) к аккаунту владельца QR.
 * После успеха — предлагает войти в аккаунт на этом устройстве.
 */
export default function AcceptLinkPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const submitting = useRef(false);

  async function accept() {
    if (submitting.current) return;
    if (!token) { setState('error'); setMessage('В ссылке нет токена привязки.'); return; }
    submitting.current = true;
    setState('busy');
    await devicesApi.acceptLink(token)
      .then((res) => {
        localStorage.setItem('vera_token', res.data.accessToken);
        localStorage.setItem('vera_user', JSON.stringify(res.data.user));
        setState('ok'); setMessage('Устройство привязано к аккаунту!');
        window.location.replace('/');
      })
      .catch((e: any) => {
        setState('error');
        setMessage(e?.response?.data?.message || e?.message || 'Не удалось привязать устройство.');
      }).finally(() => { submitting.current = false; });
  }

  return (
    // Цвета — из палитры MUI (тема пользователя, см. muiPalette.ts).
    <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center" px={2}
      sx={{ background: (t: Theme) => `radial-gradient(circle at 30% 10%, ${alpha(t.palette.primary.main, 0.14)}, transparent 40%), ${t.palette.background.default}` }}>
      <Paper sx={{ p: 4, maxWidth: 420, width: '100%', textAlign: 'center', borderRadius: 3, bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider' }}>
        <Typography variant="h5" fontWeight={800} mb={2} sx={{ background: (t: Theme) => `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.secondary.main})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Vera Link
        </Typography>

        {state === 'idle' && <Box>
          <Typography mb={2}>Добавить это устройство в аккаунт, с которого создана ссылка? Подтверждайте только ссылку, созданную вами на своём устройстве.</Typography>
          <Button fullWidth variant="contained" onClick={accept}>Подтвердить привязку</Button>
          <Button fullWidth onClick={() => navigate('/')}>Отмена</Button>
        </Box>}

        {state === 'busy' && (
          <Box py={3}>
            <CircularProgress />
            <Typography mt={2} color="text.secondary">Привязываем это устройство к аккаунту…</Typography>
          </Box>
        )}

        {state === 'ok' && (
          <Box>
            <Typography color="success.main" mb={2}>✅ {message}</Typography>
            <Typography variant="body2" color="text.secondary" mb={3}>
              Устройство добавлено. Сейчас войдём в аккаунт автоматически.
            </Typography>
            <Button
              variant="contained"
              fullWidth
              onClick={async () => {
                // Теперь устройство в db.devices — /auth/device вернёт токен владельца.
                await useAuthStore.getState().checkAuth();
                navigate('/');
              }}
            >
              Войти в аккаунт
            </Button>
          </Box>
        )}

        {state === 'error' && (
          <Box>
            <Alert severity="error" sx={{ mb: 2 }}>{message}</Alert>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Попросите владельца создать новую ссылку в разделе «Устройства».
            </Typography>
            <Button variant="outlined" fullWidth onClick={() => navigate('/')}>На главную</Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
}