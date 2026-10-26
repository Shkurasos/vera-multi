import { useEffect, useState } from 'react';
import {
  Box, Button, TextField, Typography, Paper, Stack, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import QRCode from 'qrcode';
import { authApi, devicesApi, getDeviceId } from '../services/api';
import { useThemeStore } from '../store/themeStore';

interface DeviceItem {
  id: string;
  deviceId: string;
  name: string;
  isPrimary: boolean;
  linkedViaQr: boolean;
  createdAt: string;
  lastSeenAt?: number;
}

interface LinkInvite {
  token: string;
  url: string;
  textUrl: string;
  expiresAt: number;
  ttlSeconds: number;
}

/**
 * DevicesPage — экран управления устройствами аккаунта (серверная версия).
 *
 * Мульти-система Vera_Multi: единый сервер хранит устройства. Правило:
 * «устройство 1 = 1» — новое устройство в аккаунт добавляется ТОЛЬКО через
 * QR-код/ссылку, созданную с уже привязанного устройства (макс. 2).
 */
export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [invite, setInvite] = useState<LinkInvite | null>(null);
  const [qrData, setQrData] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkDlg, setLinkDlg] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linking, setLinking] = useState(false);

  const devId = getDeviceId();

  async function refresh() {
    try {
      const res = await devicesApi.list();
      setDevices(res.data as DeviceItem[]);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Не удалось загрузить устройства');
    }
  }

  useEffect(() => { refresh(); }, []);

  // Генерируем настоящий QR-код из webUrl (сканируется с другого устройства).
  useEffect(() => {
    if (!invite) { setQrData(''); return; }
    const content = invite.textUrl || invite.url || invite.token;
    QRCode.toDataURL(content, { width: 220, margin: 1 })
      .then((url) => setQrData(url))
      .catch(() => { setQrData(''); });
  }, [invite]);

  async function makeInvite() {
    setError(null);
    setLoading(true);
    try {
      const res = await devicesApi.createLink();
      setInvite(res.data as LinkInvite);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Не удалось создать QR');
    } finally {
      setLoading(false);
    }
  }

  async function acceptLink() {
    setLinking(true);
    setError(null);
    try {
      const res = await devicesApi.acceptLink(linkInput.trim());
      localStorage.setItem('vera_token', res.data.accessToken);
      localStorage.setItem('vera_user', JSON.stringify(res.data.user));
      setLinkDlg(false);
      setLinkInput('');
      window.location.replace('/');
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Не удалось привязать устройство');
    } finally {
      setLinking(false);
    }
  }

  async function removeDevice(d: DeviceItem) {
    if (!window.confirm(`Отвязать устройство «${d.name}»?`)) return;
    setError(null);
    try {
      await devicesApi.remove(d.id);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Не удалось отвязать');
    }
  }

  const myDevice = devices.find((d) => d.deviceId === devId);
  // Лимит 2 устройства на аккаунт — QR доступен, пока не набрали лимит.
  const atLimit = false;
  const { theme } = useThemeStore();

  return (
    <Box p={4} maxWidth={900} mx="auto" pb={{ xs: 76, md: 4 }}>
      <Typography variant="h5" mb={2} fontWeight={700}>Мои устройства</Typography>
      <Alert severity="info" sx={{ mb: 3 }}>
        Войти на новом устройстве можно по нику и паролю или через QR-код / ссылку,
        созданную с уже привязанного устройства.
      </Alert>

      <Paper sx={{ 
        p: 2, mb: 3,
        bgcolor: theme.bgHeader,
        border: `1px solid ${theme.border}`,
      }}>
        <Typography variant="subtitle1" mb={1} sx={{ color: theme.text }}>
          Это устройство
        </Typography>
        {myDevice ? (
          <Stack direction="row" spacing={1} mt={1} flexWrap="wrap">
            <Chipish label={myDevice.name} />
            <Chipish label={'ID: ' + myDevice.deviceId.slice(0, 14)} />
            {myDevice.isPrimary ? <Chipish label="основное" accent /> : <Chipish label="привязано по QR" accent />}
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: theme.textSec }}>Определяется…</Typography>
        )}
      </Paper>

      <Paper sx={{ 
        p: 2, mb: 3,
        bgcolor: theme.bgHeader,
        border: `1px solid ${theme.border}`,
      }}>
        <Typography variant="subtitle1" mb={1} sx={{ color: theme.text }}>
          Добавить второе устройство
        </Typography>
        <Typography variant="body2" sx={{ color: theme.textSec, mb: 2 }}>
          Нажмите «Показать QR» — отсканируйте код на втором устройстве или скопируйте ссылку.
          Ссылка действует 5 минут и одноразовая.
        </Typography>
        <Button variant="contained" onClick={makeInvite} disabled={loading || atLimit}>
          {loading ? 'Создаём…' : (atLimit ? 'Достигнут лимит устройств' : 'Показать QR / ссылку')}
        </Button>
        {invite && (
          <Box mt={2}>
            {qrData && (
              <Box mb={1} sx={{ background: '#fff', borderRadius: 2, p: 1, display: 'inline-block' }}>
                <img src={qrData} alt="QR" width={220} height={220} />
              </Box>
            )}
            <TextField fullWidth multiline size="small" value={invite.textUrl} sx={{ mt: 1, '& .MuiOutlinedInput-root': { color: '#F5F7FF' } }} inputProps={{ readOnly: true }} />
            <Stack direction="row" spacing={1} mt={1}>
              <Button size="small" variant="outlined" onClick={() => { navigator.clipboard?.writeText(invite.textUrl); }}>Копировать</Button>
              <Button size="small" onClick={() => setInvite(null)}>Скрыть</Button>
            </Stack>
            <Typography variant="caption" sx={{ color: theme.textSec }}>
              Действует до {new Date(invite.expiresAt).toLocaleTimeString()}.
            </Typography>
          </Box>
        )}
      </Paper>

      <PasswordPanel />


      <Paper sx={{ 
        p: 2, mb: 3,
        bgcolor: theme.bgHeader,
        border: `1px solid ${theme.border}`,
      }}>
        <Typography variant="subtitle1" mb={1} sx={{ color: theme.text }}>
          Присоединиться к аккаунту (второе устройство)
        </Typography>
        <Typography variant="body2" sx={{ color: theme.textSec, mb: 2 }}>
          Если на другом устройстве уже есть VERA — откройте раздел «Устройства», создайте QR,
          а затем вставьте сюда ссылку или отсканируйте код.
        </Typography>
        <Button variant="outlined" onClick={() => setLinkDlg(true)}>Вставить ссылку привязки</Button>
      </Paper>

      <Paper sx={{ 
        p: 2,
        bgcolor: theme.bgHeader,
        border: `1px solid ${theme.border}`,
      }}>
        <Typography variant="subtitle1" mb={1} sx={{ color: theme.text }}>
          Связанные устройства
        </Typography>
        {devices.length === 0 ? (
          <Typography variant="body2" sx={{ color: theme.textSec }}>Загрузка…</Typography>
        ) : (
          <Stack spacing={1.5}>
            {devices.map((d) => (
              <Box 
                key={d.id} 
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: theme.bg,
                  border: `1px solid ${theme.border}`,
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, color: theme.text, flex: 1 }}>
                    {d.name}
                    {d.isPrimary && <Chipish label="основное" />}
                    {d.linkedViaQr && <Chipish label="QR" />}
                  </Typography>
                  {!d.isPrimary && (
                    <Button size="small" color="error" onClick={() => removeDevice(d)}>Отвязать</Button>
                  )}
                </Box>
                <Typography variant="caption" sx={{ color: theme.textSec }}>
                  ID: {d.deviceId.slice(0, 14)}… • {(d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : new Date(d.createdAt).toLocaleString())}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      <Dialog open={linkDlg} onClose={() => setLinkDlg(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ color: theme.text, bgcolor: theme.bgHeader }}>
          Привязать устройство
        </DialogTitle>
        <DialogContent sx={{ bgcolor: theme.bg }}>
          <Typography variant="body2" sx={{ color: theme.textSec, mb: 2, mt: 1 }}>
            Вставьте ссылку вида <b>vera://link?token=…</b> или <b>http://…/link?token=…</b>.
          </Typography>
          <TextField 
            fullWidth 
            multiline 
            size="small" 
            placeholder="vera://link?token=…" 
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            sx={{
              '& .MuiInputBase-root': { color: theme.text },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.border },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ bgcolor: theme.bgHeader }}>
          <Button onClick={() => setLinkDlg(false)}>Отмена</Button>
          <Button variant="contained" disabled={linking || !linkInput.trim()} onClick={acceptLink}>
            {linking ? 'Привязываем…' : 'Привязать'}
          </Button>
        </DialogActions>
      </Dialog>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </Box>
  );
}

/**
 * Пароль аккаунта. Аккаунтам, созданным раньше «по устройству», пароля нет —
 * без него войти на новом устройстве можно только по QR. Здесь его можно задать.
 */
function PasswordPanel() {
  const { theme } = useThemeStore();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    authApi.me()
      .then(({ data }) => { setHasPassword(!!data?.hasPassword); setUsername(data?.username || ''); })
      .catch(() => setHasPassword(null));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 12) { setMsg({ ok: false, text: 'Пароль должен содержать не менее 12 символов' }); return; }
    if (next !== next2) { setMsg({ ok: false, text: 'Пароли не совпадают' }); return; }
    setBusy(true);
    try {
      await authApi.setPassword(next, hasPassword ? current : undefined);
      setHasPassword(true);
      setCurrent(''); setNext(''); setNext2('');
      setMsg({ ok: true, text: 'Пароль сохранён. Теперь можно войти по нику и паролю на любом устройстве.' });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.message || 'Не удалось сохранить пароль' });
    } finally {
      setBusy(false);
    }
  }

  if (hasPassword === null) return null;
  const fieldSx = {
    mb: 1.5,
    '& .MuiInputBase-root': { color: theme.text },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.border },
  };
  return (
    <Paper sx={{ p: 2, mb: 3, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}` }}>
      <Typography variant="subtitle1" mb={1} sx={{ color: theme.text }}>
        {hasPassword ? 'Сменить пароль' : 'Задать пароль'}
      </Typography>
      <Typography variant="body2" sx={{ color: theme.textSec, mb: 2 }}>
        {hasPassword
          ? <>Вход на новом устройстве: ник <b>@{username}</b> и пароль.</>
          : <>У аккаунта нет пароля. Задайте его, чтобы входить по нику <b>@{username}</b> на других устройствах без QR-кода.</>}
      </Typography>
      <Box component="form" onSubmit={save} noValidate maxWidth={420}>
        {/* Скрытое поле с ником помогает менеджерам паролей сохранить пару логин/пароль. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        {hasPassword && (
          <TextField fullWidth size="small" type="password" label="Текущий пароль" value={current}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" disabled={busy} sx={fieldSx} />
        )}
        <TextField fullWidth size="small" type="password" label="Новый пароль" value={next}
          onChange={(e) => setNext(e.target.value)} autoComplete="new-password" disabled={busy}
          helperText="Не менее 12 символов" sx={fieldSx} inputProps={{ maxLength: 256 }} />
        <TextField fullWidth size="small" type="password" label="Повторите пароль" value={next2}
          onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" disabled={busy} sx={fieldSx} inputProps={{ maxLength: 256 }} />
        <Button type="submit" variant="contained" disabled={busy || !next}>
          {busy ? 'Сохраняем…' : 'Сохранить пароль'}
        </Button>
        {msg && <Alert severity={msg.ok ? 'success' : 'error'} sx={{ mt: 2 }} role="status">{msg.text}</Alert>}
      </Box>
    </Paper>
  );
}

function Chipish({ label, accent }: { label: string; accent?: boolean }) {
  const { theme } = useThemeStore();
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        px: 1, py: 0.2, 
        ml: 0.5,
        borderRadius: 999,
        fontSize: 11,
        border: accent ? `1px solid ${theme.accent}` : `1px solid ${theme.border}`,
        color: accent ? theme.accent : theme.textSec,
        bgcolor: accent ? theme.accent + '15' : theme.bgHeader,
      }}
    >
      {label}
    </Box>
  );
}