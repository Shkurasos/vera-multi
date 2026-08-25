import { useEffect, useState } from 'react';
import {
  Box, Button, TextField, Typography, Paper, Stack, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import QRCode from 'qrcode';
import { devicesApi, getDeviceId } from '../services/api';

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
      await devicesApi.acceptLink(linkInput.trim());
      setLinkDlg(false);
      setLinkInput('');
      await refresh();
      alert('Устройство привязано! Теперь на этом устройстве можно войти в аккаунт.');
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
  const atLimit = devices.length >= 2;

  return (
    <Box p={4} maxWidth={900} mx="auto" pb={{ xs: 76, md: 4 }}>
      <Typography variant="h5" mb={2} fontWeight={700}>Мои устройства</Typography>
      <Alert severity="info" sx={{ mb: 3 }}>
        Один аккаунт — одно устройство. Второе (например, телефон рядом с VERA Desktop)
        добавляется только через QR-код или ссылку, созданную с первого устройства.
      </Alert>

      <Paper sx={{ p: 2, mb: 3 }} style={{ background: 'rgba(8,12,24,0.86)', color: '#F5F7FF', border: '1px solid rgba(255,255,255,0.10)' }}>
        <Typography variant="subtitle1" mb={1}>Это устройство</Typography>
        {myDevice ? (
          <Stack direction="row" spacing={1} mt={1} flexWrap="wrap">
            <Chipish label={myDevice.name} />
            <Chipish label={'ID: ' + myDevice.deviceId.slice(0, 14)} />
            {myDevice.isPrimary ? <Chipish label="основное" accent /> : <Chipish label="привязано по QR" accent />}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">Определяется…</Typography>
        )}
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} style={{ background: 'rgba(8,12,24,0.86)', color: '#F5F7FF', border: '1px solid rgba(255,255,255,0.10)' }}>
        <Typography variant="subtitle1" mb={1}>Добавить второе устройство</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
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
            <Typography variant="caption" color="text.secondary">
              Действует до {new Date(invite.expiresAt).toLocaleTimeString()}.
            </Typography>
          </Box>
        )}
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} style={{ background: 'rgba(8,12,24,0.86)', color: '#F5F7FF', border: '1px solid rgba(255,255,255,0.10)' }}>
        <Typography variant="subtitle1" mb={1}>Присоединиться к аккаунту (второе устройство)</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Если на другом устройстве уже есть VERA — откройте раздел «Устройства», создайте QR,
          а затем вставьте сюда ссылку или отсканируйте код.
        </Typography>
        <Button variant="outlined" onClick={() => setLinkDlg(true)}>Вставить ссылку привязки</Button>
      </Paper>

      <Paper sx={{ p: 2 }} style={{ background: 'rgba(8,12,24,0.86)', color: '#F5F7FF', border: '1px solid rgba(255,255,255,0.10)' }}>
        <Typography variant="subtitle1" mb={1}>Связанные устройства</Typography>
        {devices.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Загрузка…</Typography>
        ) : (
          <Stack spacing={1}>
            {devices.map((d) => (
              <Box key={d.id} display="flex" justifyContent="space-between" alignItems="center">
                <span>
                  {d.name}
                  {d.isPrimary ? ' · основное' : ''}
                  {d.linkedViaQr ? ' · QR' : ''}
                </span>
                <Typography variant="caption" color="text.secondary">
                  {d.deviceId.slice(0, 14)} • {(d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : new Date(d.createdAt).toLocaleString())}
                </Typography>
                {!d.isPrimary && (
                  <Button size="small" color="error" onClick={() => removeDevice(d)}>Отвязать</Button>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      <Dialog open={linkDlg} onClose={() => setLinkDlg(false)} fullWidth maxWidth="sm">
        <DialogTitle>Привязать устройство</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Вставьте ссылку вида <b>vera://link?token=…</b> или <b>http://…/link?token=…</b>.
          </Typography>
          <TextField fullWidth multiline size="small" placeholder="vera://link?token=…" value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)} />
        </DialogContent>
        <DialogActions>
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

function Chipish({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        px: 1, py: 0.2, borderRadius: 999,
        fontSize: 12,
        border: accent ? '1px solid #00E5FF' : '1px solid rgba(255,255,255,0.25)',
        color: accent ? '#00E5FF' : '#CBD5E1',
        background: accent ? 'rgba(0,229,255,0.10)' : 'rgba(255,255,255,0.04)',
      }}
    >
      {label}
    </Box>
  );
}