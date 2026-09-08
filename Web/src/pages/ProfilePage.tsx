import React, { useState, useRef, useEffect } from 'react';
import {
  Box, Typography, Avatar, IconButton, TextField, Button,
  Divider, CircularProgress, Snackbar, Alert, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Stack,
} from '@mui/material';
import {
  ArrowBack, Edit, PhotoCamera, Check, Close,
  Phone, Cake, Info, LocationOn, Palette, QrCode2, ContentCopy, Settings, Inventory2,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore, THEMES } from '../store/themeStore';
import { usersApi, devicesApi } from '../services/api';
import QRCode from 'qrcode';
import { peer, isPeerAvailable } from '../services/peer';
import { peerInfoToUser } from '../store/authStore';
import SettingsDialog from '../components/SettingsDialog';
import ProfilePinnedPlaylistBar from '../components/ProfilePinnedPlaylistBar';
import ProfileCustomizeDialog from '../components/ProfileCustomizeDialog';
import ProfileCommentsWall from '../components/ProfileCommentsWall';
import ActivityLine from '../components/ActivityLine';
import { useProfileCustomizationStore } from '../store/profileCustomizationStore';
import { useShopStore, SHOP_CATALOG } from '../store/shopStore';
import { useCustomEquipStore } from '../store/customEquipStore';
import { useProfileDraftStore } from '../store/profileDraftStore';
import { specToStyle } from '../utils/customStyle';
import { buildShopRingSx } from '../utils/rarityStyles';
import { useUserSettingsStore } from '../store/userSettingsStore';

export default function ProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser } = useAuthStore();
  const { theme, themeId, setTheme } = useThemeStore();
  const layout = useUserSettingsStore((s) => s.layout);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const aboutMediaInputRef = useRef<HTMLInputElement>(null);

  const handleBannerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isVideo = /^video\//i.test(file.type);
    const maxMb = isVideo ? 16 : 4;
    if (file.size > maxMb * 1024 * 1024) {
      setSnack({ open: true, message: `Файл больше ${maxMb} МБ`, severity: 'error' });
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('read'));
        r.readAsDataURL(file);
      });
      customization.set('bannerUrl', dataUrl);
      setSnack({ open: true, message: 'Шапка обновлена', severity: 'success' });
    } catch {
      setSnack({ open: true, message: 'Не удалось загрузить', severity: 'error' });
    }
  };

  const handleAboutMediaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isVideo = /^video\//i.test(file.type);
    const isImage = /^image\//i.test(file.type);
    if (!isVideo && !isImage) {
      setSnack({ open: true, message: 'Только картинки или видео', severity: 'error' });
      return;
    }
    const maxMb = isVideo ? 8 : 2;
    if (file.size > maxMb * 1024 * 1024) {
      setSnack({ open: true, message: `Файл больше ${maxMb} МБ`, severity: 'error' });
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('read'));
        r.readAsDataURL(file);
      });
      customization.set('aboutMediaUrl', dataUrl);
      setSnack({ open: true, message: 'Медиа добавлено', severity: 'success' });
    } catch {
      setSnack({ open: true, message: 'Не удалось загрузить', severity: 'error' });
    }
  };

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

  // ── Черновик редактора профиля (localStorage + синхронизация между устройствами) ──
  const formFromUser = () => ({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    username: user?.username || '',
    bio: user?.bio || '',
    birthDate: user?.birthDate ? user.birthDate.slice(0, 10) : '',
    country: user?.country || '',
    region: user?.region || '',
    city: user?.city || '',
  });

  const isSameAsUser = (f: typeof form) =>
    f.firstName === (user?.firstName || '') &&
    f.lastName === (user?.lastName || '') &&
    f.username === (user?.username || '') &&
    f.bio === (user?.bio || '') &&
    f.birthDate === (user?.birthDate ? user.birthDate.slice(0, 10) : '') &&
    f.country === (user?.country || '') &&
    f.region === (user?.region || '') &&
    f.city === (user?.city || '');

  // Общее обновление формы + автосохранение черновика (только если форма отличается от профиля)
  const updateForm = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (!editing) return;
    const draftStore = useProfileDraftStore.getState();
    if (isSameAsUser(next)) {
      // Всё вернулось к данным профиля — черновик не нужен (первый заход будет стандартным)

      draftStore.clearDraft();
    } else {
      draftStore.saveDraft(next);
    }
  };

  // Намеренная отмена: чистим черновик, чтобы при первом заходе был стандартный вид
  const cancelEdit = () => {
    useProfileDraftStore.getState().clearDraft();
    setEditing(false);
  };

  // QR-код привязки нового устройства (правило "1 аккаунт = 2 устройства через QR").
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrInvite, setQrInvite] = useState<{ token: string; url: string; textUrl: string; expiresAt: number } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customization = useProfileCustomizationStore();
  const shopActiveRing = useShopStore((s) => s.activeRing);
  const ringItem = SHOP_CATALOG.find(i => i.applyKey === 'avatarRing' && i.id === shopActiveRing);
  const ringVal = ringItem?.value as any;
  const customProfileSpec = useCustomEquipStore((s) => s.equipped.profile ? s.items[s.equipped.profile]?.spec : undefined);

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
    setUsernameError("");
    const draft = useProfileDraftStore.getState().draft;
    if (draft?.form) {
      // Восстанавливаем черновик (обновили страницу в редакторе / вышли нечайно)
      setForm(draft.form);
    } else {
      setForm(formFromUser());
    }
    setEditing(true);
  };

  // Восстановить черновик редактора при повторном заходе (после refresh или случайного выхода)
  useEffect(() => {
    const draft = useProfileDraftStore.getState().draft;
    if (draft?.form && user) {
      setForm(draft.form);
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
    if (form.username && !/^[a-zA-Z0-9_.]{3,32}$/.test(form.username)) {
      setUsernameError('3–32 символа: латиница, цифры, _ и .');
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
      useProfileDraftStore.getState().clearDraft();
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
      height: '100%', bgcolor: theme.bg,
      display: 'flex', flexDirection: 'column', overflowY: 'auto',
      pb: { xs: 76, md: 0 }, // запас под мобильную нижнюю панель
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
        <Tooltip title="Настройки">
          <IconButton onClick={() => setSettingsOpen(true)}
            sx={{ color: theme.textSec }}>
            <Settings />
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
            <IconButton onClick={cancelEdit} sx={{ color: theme.textSec }}>
              <Close />
            </IconButton>
            <IconButton onClick={handleSave} disabled={saving} sx={{ color: '#4CAF50' }}>
              {saving ? <CircularProgress size={20} /> : <Check />}
            </IconButton>
          </Box>
        )}
      </Box>


      {/* ── Banner (клик = сменить фон шапки; доступно только в режиме редактирования) ── */}
      <Box
        onClick={() => { if (editing) bannerInputRef.current?.click(); }}
        sx={{
          height: 180, position: 'relative', cursor: editing ? 'pointer' : 'default', overflow: 'hidden',
          background: (customization.bannerUrl && !/^data:video\//i.test(customization.bannerUrl) && !/\.(mp4|webm|mov)$/i.test(customization.bannerUrl))
            ? `url(${customization.bannerUrl}) center/cover no-repeat`
            : (customization.bannerUrl ? 'transparent' : `linear-gradient(135deg, ${customization.bannerColor || theme.accent} 0%, ${theme.bgChat} 100%)`),
          flexShrink: 0,
          '&:hover .banner-edit': { opacity: 1 },
        }}>
        {customization.bannerUrl && (/^data:video\//i.test(customization.bannerUrl) || /\.(mp4|webm|mov)$/i.test(customization.bannerUrl)) && (
          <video
            src={customization.bannerUrl}
            autoPlay loop muted playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {editing && (
        <Box className="banner-edit" sx={{
          position: 'absolute', inset: 0, opacity: 0, transition: 'opacity 0.2s',
          bgcolor: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', gap: 1, fontSize: 14, fontWeight: 600,
        }}>
          <PhotoCamera sx={{ fontSize: 20 }} /> Сменить шапку
        </Box>
      )}
        <input ref={bannerInputRef} type="file" hidden accept="image/*,video/*"
          onChange={handleBannerChange} />
      </Box>

      {/* ── Avatar section ── */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        pt: 0, pb: 3, px: 2, mt: -7,
      }}>
        <Box sx={{ position: 'relative' }}>
          {uploadingAvatar ? (
            <Box sx={{
              width: { xs: 90, sm: 110 }, height: { xs: 90, sm: 110 }, borderRadius: '50%',
              bgcolor: theme.accent + '40',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CircularProgress size={36} sx={{ color: theme.accent }} />
            </Box>
          ) : (
            <Avatar
              src={user?.avatarUrl || undefined}
              sx={{
                width: { xs: 90, sm: 110 }, 
                height: { xs: 90, sm: 110 }, 
                fontSize: { xs: 32, sm: 40 },
                bgcolor: theme.accent + '80',
                border: `4px solid ${theme.accent}`,
                boxShadow: `0 0 24px ${theme.accent}50`,
                ...(ringVal ? {
                  // Единый стиль обводки из магазина (с анимациями для gradient/glow/pulse/aurora).
                  ...buildShopRingSx(ringVal, theme.accent, false, 4),
                } : {}),
                ...(customProfileSpec ? (() => {
                  const st = specToStyle(customProfileSpec);
                  return {
                    border: st.border || `4px solid ${theme.accent}`,
                    background: st.background,
                    boxShadow: st.boxShadow || `0 0 24px ${theme.accent}50`,
                  };
                })() : {}),
              }}
            >
              {getInitials(displayName)}
            </Avatar>
          )}
          {editing && (
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
          )}
          <input ref={avatarInputRef} type="file" hidden accept="image/*" onChange={handleAvatarChange} />
        </Box>

        {/* Инвентарь — по центру под аватаркой */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
          <Box
            onClick={() => { useShopStore.getState().setTab('inventory'); useShopStore.getState().setOpen(true); }}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 1,
              px: 1.5, py: 0.7, borderRadius: 2.5, cursor: 'pointer',
              bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
              transition: 'border-color .25s, background .25s, transform .25s',
              '&:hover': { borderColor: theme.accent + '66', transform: 'translateY(-1px)' },
              '&:active': { transform: 'scale(.98)' },
            }}>
            <Inventory2 sx={{ fontSize: 18, color: theme.accent }} />
            <Typography sx={{ fontSize: 13, color: theme.text, fontWeight: 600 }}>Инвентарь</Typography>
          </Box>
        </Box>

        <Typography sx={{ mt: 2, fontSize: { xs: 19, sm: 22 }, fontWeight: 700, color: theme.text }}>
          {displayName}
        </Typography>
        <Typography sx={{ fontSize: { xs: 14, sm: 15 }, color: theme.accent, mt: 0.5 }}>
          @{user?.username}
        </Typography>
        <Typography sx={{ fontSize: { xs: 13, sm: 14 }, color: user?.isOnline ? theme.online : theme.textSec, mt: 0.5 }}>
          {user?.isOnline ? '● в сети' : '○ не в сети'}
        </Typography>
        {user?.id && <Box sx={{ mt: 1 }}><ActivityLine userId={user.id} /></Box>}
        {user?.id && <ProfilePinnedPlaylistBar ownerId={user.id} pinnedPlaylistId={user.pinnedPlaylistId} />}
        {customization.showcase && (
          <Box sx={{
            mt: 2, px: 2, py: 1.5, borderRadius: 2,
            bgcolor: theme.bgHeader,
            border: `1px solid ${(customization.cardAccent || theme.accent) + '40'}`,
            maxWidth: 480, width: '100%',
            opacity: (customization.cardOpacity ?? 100) / 100,
          }}>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>Витрина</Typography>
            <Typography sx={{ fontSize: 14, color: theme.text, whiteSpace: 'pre-wrap' }}>
              {customization.showcase}
            </Typography>
          </Box>
        )}

      </Box>

      <Divider sx={{ borderColor: theme.border }} />

      {/* ── Info / Edit form ── */}
      <Box sx={{ px: 2.5, py: 2, flex: 1 }}>
        {editing ? (
          <Box sx={{ 
            bgcolor: theme.bgHeader, 
            borderRadius: 3, 
            p: 2.5,
            border: `1px solid ${theme.border}`,
          }}>
            <Typography sx={{ fontSize: 16, color: theme.text, fontWeight: 700, mb: 2 }}>
              Профиль
            </Typography>
            
            <Box display="flex" flexDirection="column" gap={1.5}>
              <TextField
                label="Имя пользователя"
                fullWidth size="small"
                value={form.username}
                error={!!usernameError}
                helperText={usernameError || 'Латиница, цифры и _ (3–32 символа)'}
                inputProps={{ maxLength: 32 }}
                onChange={e => {
                  setUsernameError('');
                  updateForm({ username: e.target.value });
                }}
                sx={{
                  ...inputSx,
                  '& .MuiFormHelperText-root': { color: usernameError ? '#f44336' : theme.textSec, fontSize: 11 },
                }}
              />
              <Box display="flex" gap={1}>
                <TextField label="Имя" fullWidth size="small"
                  value={form.firstName}
                  onChange={e => updateForm({ firstName: e.target.value })}
                  sx={inputSx} />
                <TextField label="Фамилия" fullWidth size="small"
                  value={form.lastName}
                  onChange={e => updateForm({ lastName: e.target.value })}
                  sx={inputSx} />
              </Box>
              <TextField label="О себе" fullWidth multiline rows={2.5} size="small"
                value={form.bio} inputProps={{ maxLength: 300 }}
                onChange={e => updateForm({ bio: e.target.value })}
                sx={inputSx} />
              <TextField
                label="Дата рождения"
                fullWidth size="small"
                type="date"
                value={form.birthDate}
                onChange={e => updateForm({ birthDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                inputProps={{ max: new Date().toISOString().slice(0, 10) }}
                sx={{
                  ...inputSx,
                  '& input::-webkit-calendar-picker-indicator': { filter: 'invert(0.7)' },
                }}
              />
              <Box display="flex" gap={1}>
                <TextField label="Страна" fullWidth size="small"
                  value={form.country}
                  onChange={e => updateForm({ country: e.target.value })}
                  sx={inputSx} />
                <TextField label="Город" fullWidth size="small"
                  value={form.city}
                  onChange={e => updateForm({ city: e.target.value })}
                  sx={inputSx} />
              </Box>
            <Stack direction="row" spacing={1} mt={2}>
              <Button fullWidth variant="contained" startIcon={<Check />} onClick={handleSave} disabled={saving}
                sx={{ 
                  bgcolor: theme.accent, 
                  '&:hover': { bgcolor: theme.accent + 'CC' }, 
                  textTransform: 'none', 
                  borderRadius: 2,
                  py: 1,
                  fontWeight: 600,
                }}>
                {saving ? 'Сохраняем...' : 'Сохранить'}
              </Button>
              <Button variant="outlined" startIcon={<Close />} onClick={cancelEdit}
                sx={{ 
                  borderColor: theme.border, 
                  color: theme.textSec, 
                  textTransform: 'none', 
                  borderRadius: 2,
                  minWidth: 110,
                  '&:hover': { borderColor: theme.accent, bgcolor: theme.accent + '10' }
                }}>
                Отмена
              </Button>
            </Stack>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 720, mx: 'auto', width: '100%' }}>
            {/* ── Карточка: О себе (Steam-style) ── */}
            <Box sx={{
              bgcolor: theme.bgHeader, borderRadius: 3, p: 2.5,
              border: `1px solid ${theme.border}`,
            }}>
              <Typography sx={{ fontSize: 12, color: theme.textSec, textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.5, fontWeight: 700 }}>
                О себе
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, rowGap: 1.5, columnGap: 2.5 }}>
                {user?.phone && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Phone sx={{ fontSize: 18, color: theme.textSec }} />
                    <Box>
                      <Typography sx={{ fontSize: 11, color: theme.textSec }}>Телефон</Typography>
                      <Typography sx={{ fontSize: 14, color: theme.text }}>{user.phone}</Typography>
                    </Box>
                  </Box>
                )}
                {user?.birthDate && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Cake sx={{ fontSize: 18, color: theme.textSec }} />
                    <Box>
                      <Typography sx={{ fontSize: 11, color: theme.textSec }}>Дата рождения</Typography>
                      <Typography sx={{ fontSize: 14, color: theme.text }}>{user.birthDate}</Typography>
                    </Box>
                  </Box>
                )}
                {(user?.country || user?.city) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <LocationOn sx={{ fontSize: 18, color: theme.textSec }} />
                    <Box>
                      <Typography sx={{ fontSize: 11, color: theme.textSec }}>Местоположение</Typography>
                      <Typography sx={{ fontSize: 14, color: theme.text }}>
                        {[user?.city, user?.region, user?.country].filter(Boolean).join(', ')}
                      </Typography>
                    </Box>
                  </Box>
                )}
                {user?.createdAt && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Info sx={{ fontSize: 18, color: theme.textSec }} />
                    <Box>
                      <Typography sx={{ fontSize: 11, color: theme.textSec }}>С нами</Typography>
                      <Typography sx={{ fontSize: 14, color: theme.text }}>
                        {new Date(user.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </Typography>
                    </Box>
                  </Box>
                )}
              </Box>
              {user?.bio && (
                <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${theme.border}` }}>
                  <Typography sx={{ fontSize: 14, color: theme.text, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                    {user.bio}
                  </Typography>
                </Box>
              )}
              {customization.aboutMediaUrl && (
                <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${theme.border}`, position: 'relative' }}>
                  {/^data:video\//i.test(customization.aboutMediaUrl) || /\.(mp4|webm|mov)$/i.test(customization.aboutMediaUrl) ? (
                    <video
                      src={customization.aboutMediaUrl}
                      autoPlay loop muted playsInline
                      style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8 }}
                    />
                  ) : (
                    <Box
                      component="img"
                      src={customization.aboutMediaUrl}
                      alt="О себе"
                      sx={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 2 }}
                    />
                  )}
                  {editing && (
                    <IconButton
                      onClick={() => customization.set('aboutMediaUrl', '')}
                      sx={{
                        position: 'absolute', top: 10, right: 10,
                        bgcolor: 'rgba(0,0,0,0.6)', color: '#fff',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' },
                      }}
                    >
                      <Close sx={{ fontSize: 18 }} />
                    </IconButton>
                  )}
                </Box>
              )}
              {editing && !customization.aboutMediaUrl && (
                <Box
                  onClick={() => aboutMediaInputRef.current?.click()}
                  sx={{
                    mt: 2, border: `1px dashed ${theme.accent}40`,
                    borderRadius: 2, p: 2, textAlign: 'center', cursor: 'pointer',
                    '&:hover': { bgcolor: theme.accent + '08' },
                  }}
                >
                  <PhotoCamera sx={{ fontSize: 20, color: theme.textSec, mb: 0.5 }} />
                  <Typography sx={{ fontSize: 14, color: theme.textSec }}>
                    Добавить картинку/анимацию в "О себе"
                  </Typography>
                </Box>
              )}
              <input ref={aboutMediaInputRef} type="file" hidden accept="image/*,video/*"
                onChange={handleAboutMediaChange} />
              {!user?.bio && !user?.firstName && (
                <Box onClick={handleEdit} sx={{
                  mt: 1, border: `1px dashed ${theme.accent}40`,
                  borderRadius: 2, p: 2, textAlign: 'center', cursor: 'pointer',
                  '&:hover': { bgcolor: theme.accent + '08' },
                }}>
                  <Typography sx={{ fontSize: 14, color: theme.textSec }}>
                    Нажмите, чтобы заполнить профиль
                  </Typography>
                </Box>
              )}
            </Box>

            {/* ── Карточка: Действия (компактные chip-кнопки) ── */}
            <Box sx={{
              bgcolor: theme.bgHeader, borderRadius: 3, p: 2,
              border: `1px solid ${theme.border}`,
              display: 'flex', flexWrap: 'wrap', gap: 1,
            }}>
              {[
                { icon: <QrCode2 sx={{ fontSize: 18 }} />, label: 'QR-привязка', onClick: openLinkQr },
                { icon: <Palette sx={{ fontSize: 18 }} />, label: 'Оформление', onClick: () => setCustomizeOpen(true) },
                { icon: <Palette sx={{ fontSize: 18 }} />, label: 'Редактор тем', onClick: () => navigate('/theme-editor') },
              ].map((a, i) => (
                <Button key={i} onClick={a.onClick} startIcon={a.icon} size="small"
                  sx={{
                    color: theme.text, bgcolor: theme.bgHover, textTransform: 'none',
                    borderRadius: 999, px: 1.5, py: 0.6, fontSize: 13,
                    border: `1px solid ${theme.border}`,
                    '&:hover': { bgcolor: theme.accent + '18', borderColor: theme.accent + '55' },
                  }}>
                  {a.label}
                </Button>
              ))}
            </Box>

            {/* ── Карточка: Стена комментариев (без отдельного чёрного блока внизу) ── */}
            {user?.id && (
              <Box sx={{
                bgcolor: theme.bgHeader, borderRadius: 3, p: 2.5,
                border: `1px solid ${theme.border}`,
              }}>
                <Typography sx={{ fontSize: 12, color: theme.textSec, textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.5, fontWeight: 700 }}>
                  Комментарии
                </Typography>
                <ProfileCommentsWall targetUserId={user.id} targetUserName={displayName} />
              </Box>
            )}
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
          <Button onClick={() => setQrOpen(false)} sx={{ color: theme.textSec }}>Закрыть</Button>
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
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProfileCustomizeDialog open={customizeOpen} onClose={() => setCustomizeOpen(false)} />
    </Box>
  );
}
