import { useEffect, useState } from 'react';
import { Alert, Box, Button, Paper, Tab, Tabs, TextField, Typography } from '@mui/material';
import { appealsApi, authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

type Mode = 'login' | 'register' | 'link';

export default function DeviceEntryPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
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

  async function finishAuth(data: any) {
    localStorage.setItem('vera_token', data.accessToken);
    if (data.user) localStorage.setItem('vera_user', JSON.stringify(data.user));
    window.location.replace('/');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const nick = username.trim().replace(/^@+/, '');
    if (mode === 'register') {
      if (!/^[a-zA-Z0-9_.]{3,32}$/.test(nick)) { setError('Ник: 3–32 символа, латиница, цифры, _ и .'); return; }
      if (password.length < 12) { setError('Пароль должен содержать не менее 12 символов'); return; }
      if (password !== password2) { setError('Пароли не совпадают'); return; }
    } else if (!nick || !password) {
      setError('Введите ник и пароль'); return;
    }
    setBusy(true);
    try {
      const { data } = mode === 'register'
        ? await authApi.register(nick, password, email.trim() || undefined, phone.trim() || undefined)
        : await authApi.login(nick, password);
      await finishAuth(data);
    } catch (err: any) {
      if (err?.response?.data?.code === 'ACCOUNT_BANNED') { useAuthStore.setState({ isBanned: true }); }
      setError(err?.response?.data?.message || 'Не удалось войти. Проверьте соединение.');
      setBusy(false);
    }
  }

  function openLink() {
    let token = link.trim();
    try { token = new URL(token).searchParams.get('token') || ''; } catch {}
    if (!/^vera-link-[a-f0-9]{32}$/.test(token)) { setError('Вставьте ссылку привязки из раздела «Устройства».'); return; }
    window.location.assign('/link?token=' + encodeURIComponent(token));
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setPassword('');
    setPassword2('');
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
          <Typography variant="h5" mb={2}>Vera</Typography>
          <Tabs value={mode} onChange={(_, v) => switchMode(v)} variant="fullWidth" sx={{ mb: 2 }}>
            <Tab value="login" label="Вход" />
            <Tab value="register" label="Регистрация" />
            <Tab value="link" label="По ссылке" />
          </Tabs>

          {mode === 'link' ? (
            <>
              <Typography mb={2}>На устройстве, где вы уже вошли, откройте «Устройства», создайте QR-код и отсканируйте его камерой. Или вставьте ссылку ниже.</Typography>
              <TextField fullWidth label="Ссылка привязки" value={link} onChange={e => setLink(e.target.value)} disabled={busy} />
              <Button fullWidth variant="contained" sx={{ mt: 2 }} disabled={busy || !link.trim()} onClick={openLink}>Добавить это устройство</Button>
            </>
          ) : (
            <Box component="form" onSubmit={submit} noValidate>
              <TextField
                fullWidth label="Ник" value={username} disabled={busy}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username" inputProps={{ maxLength: 33, autoCapitalize: 'none', spellCheck: false }}
                helperText={mode === 'register' ? '3–32 символа: латиница, цифры, _ и .' : undefined}
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth type="password" label="Пароль" value={password} disabled={busy}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                inputProps={{ maxLength: 256 }}
                helperText={mode === 'register' ? 'Не менее 12 символов' : undefined}
                sx={{ mb: 2 }}
              />
              {mode === 'register' && (
                <>
                  <TextField
                    fullWidth type="password" label="Повторите пароль" value={password2} disabled={busy}
                    onChange={e => setPassword2(e.target.value)}
                    autoComplete="new-password" inputProps={{ maxLength: 256 }}
                    sx={{ mb: 2 }}
                  />
                  <TextField
                    fullWidth label="E-mail (необязательно)" value={email} disabled={busy}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email" inputProps={{ maxLength: 256 }}
                    sx={{ mb: 2 }}
                  />
                  <TextField
                    fullWidth label="Телефон (необязательно)" value={phone} disabled={busy}
                    onChange={e => setPhone(e.target.value)}
                    autoComplete="tel" inputProps={{ maxLength: 20 }}
                    sx={{ mb: 2 }}
                  />
                </>
              )}
              <Button fullWidth type="submit" variant="contained" disabled={busy}>
                {busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}
              </Button>
            </Box>
          )}
          {error && <Alert severity="error" sx={{ mt: 2 }} role="alert">{error}</Alert>}
        </>
      )}
    </Paper>
  </Box>;
}