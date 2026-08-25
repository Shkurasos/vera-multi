import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Button, Paper, Alert, CircularProgress } from '@mui/material';
import { devicesApi, getDeviceId } from '../services/api';
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

  useEffect(() => {
    if (!token) { setState('error'); setMessage('В ссылке нет токена привязки.'); return; }
    setState('busy');
    devicesApi.acceptLink(token)
      .then(() => { setState('ok'); setMessage('Устройство привязано к аккаунту!'); })
      .catch((e: any) => {
        setState('error');
        setMessage(e?.response?.data?.message || e?.message || 'Не удалось привязать устройство.');
      });
  }, [token]);

  return (
    <Box minHeight="100vh" bgcolor="#000" display="flex" alignItems="center" justifyContent="center" px={2}
      sx={{ background: 'radial-gradient(circle at 30% 10%, rgba(0,229,255,0.14), transparent 40%), #000' }}>
      <Paper sx={{ p: 4, maxWidth: 420, width: '100%', textAlign: 'center', borderRadius: 3, background: 'rgba(8,12,24,0.9)', color: '#F5F7FF', border: '1px solid rgba(255,255,255,0.1)' }}>
        <Typography variant="h5" fontWeight={800} mb={2} sx={{ background: 'linear-gradient(135deg, #00E5FF, #7C6AF7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Vera Link
        </Typography>

        {state === 'busy' && (
          <Box py={3}>
            <CircularProgress sx={{ color: '#00E5FF' }} />
            <Typography mt={2} color="text.secondary">Привязываем это устройство к аккаунту…</Typography>
            <Typography variant="caption" color="text.secondary">deviceId: {getDeviceId()}</Typography>
          </Box>
        )}

        {state === 'ok' && (
          <Box>
            <Typography color="#7dffa8" mb={2}>✅ {message}</Typography>
            <Typography variant="body2" color="text.secondary" mb={3}>
              Устройство добавлено. Сейчас войдём в аккаунт автоматически.
            </Typography>
            <Button
              variant="contained"
              fullWidth
              onClick={async () => {
                // Теперь устройство в db.devices — /auth/device вернёт токен владельца.
                localStorage.removeItem('vera_token');
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