import React, { useState, useRef, useEffect } from 'react';
import {
  Box, Typography, Avatar, IconButton, TextField, Button,
  Divider, CircularProgress, Snackbar, Alert, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Stack,
} from '@mui/material';
import {
  ArrowBack, Edit, PhotoCamera, Check, Close,
  Phone, Cake, Info, LocationOn, Palette, QrCode2, ContentCopy,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore, THEMES } from '../store/themeStore';
import { usersApi, devicesApi } from '../services/api';
import QRCode from 'qrcode';
import { peer, isPeerAvailable } from '../services/peer';
import { peerInfoToUser } from '../store/authStore';

export default function ProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser } = useAuthStore();
  const { theme, themeId, setTheme } = useThemeStore();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    username: user?.username || '',
    bio: user?.bio || '',
    birthDate: user?.birthDate ? user.birthDate.slice(0, 10) : '',
    country: user?.country || '',
    region: user?.region || '',
    city: user?.city || '',
  });
  const [usernameError, setUsernameError] = useState('');

  // QR-код привязки нового устройства (правило "1 аккаунт = 2 устройства через QR").
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrInvite, setQrInvite] = useState<{ token: string; url: string; textUrl: string; expiresAt: number } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  async function openLinkQr() {
    setQrError(null);
    setQrOpen(true);
    setQrLoading(true);
    setQrDataUrl('');
    setQrInvite(null);
    try {
      const res = await devicesApi.createLink();
      const inv = res.data as { token: string; url: string; textUrl: string; expiresAt: number };
      setQrInvite(inv);
      const content = inv.textUrl || inv.url || inv.token;
      const dataUrl = await QRCode.toDataURL(content, { width: 240, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch (e: any) {
      setQrError(e?.response?.data?.message || e?.message || 'Не удалось создать QR-код');
    } finally {
      setQrLoading(false);
    }
  }

  function copyInviteLink() {
    if (!qrInvite) return;
    const text = qrInvite.textUrl || qrInvite.url || qrInvite.token;
    navigator.clipboard?.writeText(text).then(
      () => setSnack({ open: true, message: 'Ссылка скопирована', severity: 'success' }),
      () => setSnack({ open: true, message: 'Не удалось скопировать', severity: 'error' }),
    );
  }

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username
    : '';

  function getInitials(name: string) {
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  }

  const handleEdit = () => {
    setUsernameError('');
    setForm({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      username: user?.username || '',
      bio: user?.bio || '',
      birthDate: user?.birthDate ? user.birthDate.slice(0, 10) : '',
      country: user?.country || '',
      region: user?.region || '',
      city: user?.city || '',
    });
    setEditing(true);
  };

  // Автоматически открывать редактирование, если пришли по /profile?edit=1
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wantEdit = params.get('edit') === '1' || (location.state as any)?.edit;
    if (wantEdit && user) {
      handleEdit();
      // Убираем ?edit из URL, чтобы кнопка «назад» не открывала форму повторно.
      window.history.replaceState(null, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSave = async () => {
    // Валидация username
    if (form.username && !/^[a-zA-Z0-9_]{3,32}$/.test(form.username)) {
      setUsernameError('3–32 символа: латиница, цифры, подчёркивание');
      return;
    }
    setUsernameError('');
    // Валидация даты
    if (form.birthDate) {
      const d = new Date(form.birthDate);
      const now = new Date();
      if (isNaN(d.getTime()) || d > now) {
        setSnack({ open: true, message: 'Некорректная дата рождения', severity: 'error' });
        return;
      }
    }
    setSaving(true);
    try {
      if (isPeerAvailable()) {
        const info = await peer.updateProfile(form);
        setUser(peerInfoToUser(info));
      } else {
        const res = await usersApi.updateMe(form);
        setUser(res.data);
      }
      setEditing(false);
      setSnack({ open: true, message: 'Профиль сохранён', severity: 'success' });
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Ошибка сохранения';
      setSnack({ open: true, message: Array.isArray(msg) ? msg.join(', ') : msg, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    e.target.value = '';
    setUploadingAvatar(true);
    try {
      if (isPeerAvailable()) {
        // В P2P аватар хранится локально как data-URL внутри зашифрованного стора.
        // Никакой загрузки на сервер — просто читаем файл и сохраняем.
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('read error'));
          r.readAsDataURL(file);
        });
        const info = await peer.setAvatar(dataUrl);
        setUser(peerInfoToUser(info));
        setSnack({ open: true, message: 'Аватар обновлён', severity: 'success' });
      } else {
        const formData = new FormData();
        formData.append('avatar', file);
        const res = await usersApi.uploadAvatar(formData);
        const updatedUser = {
          ...res.data,
          avatarUrl: res.data.avatarUrl
            ? res.data.avatarUrl + '?t=' + Date.now()
            : res.data.avatarUrl,
        };
        setUser(updatedUser);
        setSnack({ open: true, message: 'Аватар обновлён', severity: 'success' });
      }
    } catch {
      setSnack({ open: true, message: 'Ошибка загрузки аватара', severity: 'error' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const inputSx = {
    '& .MuiOutlinedInput-root': {
      bgcolor: theme.bgInput, color: theme.text, borderRadius: 2, fontSize: 15,
      '& fieldset': { borderColor: theme.border },
      '&:hover fieldset': { borderColor: theme.accent + '50' },
      '&.Mui-focused fieldset': { borderColor: theme.accent },
    },
    '& .MuiInputLabel-root': { color: theme.textSec },
    '& .MuiInputLabel-root.Mui-focused': { color: theme.accent },
    '& .MuiInputBase-input::placeholder': { color: theme.textSec },
  };

  return (
    <Box sx={{
      height: '100%', bgcolor: theme.bgChat,
      display: 'flex', flexDirection: 'column', overflowY: 'auto',
      '&::-webkit-scrollbar': { width: 5 },
      '&::-webkit-scrollbar-thumb': { bgcolor: theme.accent + '30', borderRadius: 4 },
    }}>
      {/* ── Header ── */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5,
        bgcolor: theme.bgHeader, borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}>
        <IconButton onClick={() => navigate(-1)} sx={{ color: theme.textSec }}>
          <ArrowBack />
        </IconButton>
        <Typography sx={{ flex: 1, fontSize: 18, fontWeight: 700, color: theme.text }}>
          Мой профиль
        </Typography>
        <Tooltip title="Редактор тем">
          <IconButton onClick={() => navigate('/theme-editor')}
            sx={{ color: theme.textSec }}>
            <Palette />
          </IconButton>
        </Tooltip>
        {!editing ? (
          <Tooltip title="Редактировать">
            <IconButton onClick={handleEdit} sx={{ color: theme.accent }}>
              <Edit />
            </IconButton>
          </Tooltip>
        ) : (
          <Box display="flex" gap={0.5}>
            <IconButton onClick={() => setEditing(false)} sx={{ color: theme.textSec }}>
              <Close />
            </IconButton>
            <IconButton onClick={handleSave} disabled={saving} sx={{ color: '#4CAF50' }}>
              {saving ? <CircularProgress size={20} /> : <Check />}
            </IconButton>
          </Box>
        )}
      </Box>


      {/* ── Avatar section ── */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        py: 4, px: 2,
        background: `linear-gradient(180deg, ${theme.accent}20 0%, ${theme.bgChat} 100%)`,
      }}>
        <Box sx={{ position: 'relative' }}>
          {uploadingAvatar ? (
            <Box sx={{
              width: 110, height: 110, borderRadius: '50%',
              bgcolor: theme.accent + '40',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CircularProgress size={36} sx={{ color: theme.accent }} />
            </Box>
          ) : (
            <Avatar
              src={user?.avatarUrl || undefined}
              sx={{
                width: 110, height: 110, fontSize: 40,
                bgcolor: theme.accent + '80',
                border: `4px solid ${theme.accent}`,
                boxShadow: `0 0 24px ${theme.accent}50`,
              }}
            >
              {getInitials(displayName)}
            </Avatar>
          )}
          <Tooltip title="Изменить фото">
            <IconButton
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              sx={{
                position: 'absolute', bottom: 2, right: 2,
                bgcolor: theme.accent, color: '#fff', width: 34, height: 34,
                '&:hover': { bgcolor: theme.accent + 'CC' },
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}
            >
              <PhotoCamera sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
          <input ref={avatarInputRef} type="file" hidden accept="image/*" onChange={handleAvatarChange} />
        </Box>

        <Typography sx={{ mt: 2, fontSize: 22, fontWeight: 700, color: theme.text }}>
          {displayName}
        </Typography>
        <Typography sx={{ fontSize: 15, color: theme.accent, mt: 0.5 }}>
          @{user?.username}
        </Typography>
        <Typography sx={{ fontSize: 14, color: user?.isOnline ? theme.online : theme.textSec, mt: 0.5 }}>
          {user?.isOnline ? '● в сети' : '○ не в сети'}
        </Typography>
      </Box>

      <Divider sx={{ borderColor: theme.border }} />

      {/* ── Info / Edit form ── */}
      <Box sx={{ px: 2.5, py: 2, flex: 1 }}>
        {editing ? (
          <Box display="flex" flexDirection="column" gap={2}>
            <Typography sx={{ fontSize: 14, color: theme.accent, fontWeight: 700 }}>
              Редактирование профиля
            </Typography>
            <TextField
              label="Имя пользователя"
              fullWidth size="small"
              value={form.username}
              error={!!usernameError}
              helperText={usernameError || 'Только латиница, цифры и _ (3–32 символа)'}
              inputProps={{ maxLength: 32 }}
              onChange={e => {
                setUsernameError('');
                setForm(f => ({ ...f, username: e.target.value }));
              }}
              sx={{
                ...inputSx,
                '& .MuiFormHelperText-root': { color: usernameError ? '#f44336' : theme.textSec, fontSize: 12 },
              }}
            />
            <Box display="flex" gap={1.5}>
              <TextField label="Имя" fullWidth size="small"
                value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                sx={inputSx} />
              <TextField label="Фамилия" fullWidth size="small"
                value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                sx={inputSx} />
            </Box>
            <TextField label="О себе" fullWidth multiline rows={3} size="small"
              value={form.bio} inputProps={{ maxLength: 300 }}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              sx={inputSx} />
            <TextField
              label="Дата рождения"
              fullWidth size="small"
              type="date"
              value={form.birthDate}
              onChange={e => setForm(f => ({ ...f, birthDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: new Date().toISOString().slice(0, 10) }}
              sx={{
                ...inputSx,
                '& input::-webkit-calendar-picker-indicator': { filter: 'invert(0.7)' },
              }}
            />
            <Box display="flex" gap={1.5}>
              <TextField label="Страна" fullWidth size="small"
                value={form.country}
                onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                sx={inputSx} />
              <TextField label="Город" fullWidth size="small"
                value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                sx={inputSx} />
            </Box>
            <Box display="flex" gap={1.5}>
              <Button variant="outlined" fullWidth onClick={() => setEditing(false)}
                sx={{
                  color: theme.textSec, borderColor: theme.border, borderRadius: 2.5, fontSize: 15,
                  '&:hover': { borderColor: theme.textSec },
                }}>
                Отмена
              </Button>
              <Button variant="contained" fullWidth onClick={handleSave} disabled={saving}
                sx={{
                  bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent + 'CC' },
                  borderRadius: 2.5, fontSize: 15,
                }}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box>
            <Typography sx={{ fontSize: 14, color: theme.accent, fontWeight: 700, mb: 2 }}>
              Информация
            </Typography>

            {user?.phone && (
              <Box display="flex" alignItems="flex-start" gap={2} mb={2}>
                <Phone sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
                <Box>
                  <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>Телефон</Typography>
                  <Typography sx={{ fontSize: 15, color: theme.text }}>{user.phone}</Typography>
                </Box>
              </Box>
            )}

            {user?.bio && (
              <Box display="flex" alignItems="flex-start" gap={2} mb={2}>
                <Info sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
                <Box>
                  <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>О себе</Typography>
                  <Typography sx={{ fontSize: 15, color: theme.text, whiteSpace: 'pre-wrap' }}>{user.bio}</Typography>
                </Box>
              </Box>
            )}

            {user?.birthDate && (
              <Box display="flex" alignItems="flex-start" gap={2} mb={2}>
                <Cake sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
                <Box>
                  <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>Дата рождения</Typography>
                  <Typography sx={{ fontSize: 15, color: theme.text }}>{user.birthDate}</Typography>
                </Box>
              </Box>
            )}

            {(user?.country || user?.city) && (
              <Box display="flex" alignItems="flex-start" gap={2} mb={2}>
                <LocationOn sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
                <Box>
                  <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>Местоположение</Typography>
                  <Typography sx={{ fontSize: 15, color: theme.text }}>
                    {[user?.city, user?.region, user?.country].filter(Boolean).join(', ')}
                  </Typography>
                </Box>
              </Box>
            )}

            {!user?.firstName && !user?.bio && (
              <Box onClick={handleEdit} sx={{
                border: `1px dashed ${theme.accent}40`,
                borderRadius: 2.5, p: 2.5, textAlign: 'center', cursor: 'pointer',
                '&:hover': { bgcolor: theme.accent + '08' },
                transition: 'all 0.15s',
              }}>
                <Typography sx={{ fontSize: 15, color: theme.textSec }}>
                  ✏️ Нажмите, чтобы заполнить профиль
                </Typography>
              </Box>
            )}

            <Divider sx={{ borderColor: theme.border, my: 2.5 }} />

            <Typography sx={{ fontSize: 14, color: theme.accent, fontWeight: 700, mb: 1.5 }}>
              Аккаунт
            </Typography>
            <Box mb={1.5}>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>Имя пользователя</Typography>
              <Typography sx={{ fontSize: 15, color: theme.text }}>@{user?.username}</Typography>
            </Box>
            {user?.createdAt && (
              <Box mb={1.5}>
                <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>Дата регистрации</Typography>
                <Typography sx={{ fontSize: 15, color: theme.text }}>
                  {new Date(user.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Typography>
              </Box>
            )}

            <Divider sx={{ borderColor: theme.border, my: 2.5 }} />

            <Button
              fullWidth
              variant="outlined"
              startIcon={<QrCode2 />}
              onClick={openLinkQr}
              sx={{
                color: theme.accent, borderColor: theme.accent + '50',
                borderRadius: 2.5, fontSize: 15, py: 1.2, mb: 1.5,
                '&:hover': { bgcolor: theme.accent + '10', borderColor: theme.accent },
                textTransform: 'none',
              }}
            >
              QR для привязки устройства
            </Button>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<Palette />}
              onClick={() => navigate('/theme-editor')}
              sx={{
                color: theme.accent, borderColor: theme.accent + '50',
                borderRadius: 2.5, fontSize: 15, py: 1.2,
                '&:hover': { bgcolor: theme.accent + '10', borderColor: theme.accent },
                textTransform: 'none',
              }}
            >
              Редактор тем
            </Button>
          </Box>
        )}
      </Box>

      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ bgcolor: theme.bgHeader, color: theme.text }}>
          QR для привязки устройства
        </DialogTitle>
        <DialogContent sx={{ bgcolor: theme.bgHeader, color: theme.text }}>
          <Typography variant="body2" sx={{ color: theme.textSec, mb: 2 }}>
            Отсканируйте этот код с нового устройства (или откройте ссылку на нём).
            Правило: к одному аккаунту можно привязать не более 2 устройств.
            Ссылка одноразовая и действует ограниченное время.
          </Typography>
          {qrLoading && (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          )}
          {!qrLoading && qrError && (
            <Alert severity="error" sx={{ mb: 2 }}>{qrError}</Alert>
          )}
          {!qrLoading && qrDataUrl && qrInvite && (
            <Stack spacing={2} alignItems="center">
              <Box
                component="img"
                src={qrDataUrl}
                alt="QR"
                sx={{ width: 240, height: 240, borderRadius: 2, background: '#fff', p: 1 }}
              />
              <TextField
                fullWidth
                size="small"
                value={qrInvite.textUrl}
                InputProps={{ readOnly: true }}
              />
              <Typography variant="caption" sx={{ color: theme.textSec }}>
                Действует до {new Date(qrInvite.expiresAt).toLocaleTimeString()}
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ bgcolor: theme.bgHeader }}>
          {qrInvite && (
            <Button onClick={copyInviteLink} startIcon={<ContentCopy />} sx={{ color: theme.accent }}>
              Копировать ссылку
            </Button>
          )}
          <Button onClick={() => setQrOpen(false)} sx={{ color: theme.text }}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.severity}
          sx={{ bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}` }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
