import React, { useState, useRef, useEffect } from 'react';
import {
  Box, Typography, Avatar, IconButton, TextField, Button,
  Divider, CircularProgress, Snackbar, Alert, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Stack,
} from '@mui/material';
import {
  ArrowBack, Edit, PhotoCamera, Check, Close,
  Phone, Cake, Info, LocationOn, Palette, QrCode2, ContentCopy, Settings, Storefront, Inventory2,
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
import { specToStyle } from '../utils/customStyle';
import { buildShopRingSx } from '../utils/rarityStyles';

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
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const handleBannerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setSnack({ open: true, message: 'Файл больше 4 МБ', severity: 'error' });
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
        <Tooltip title="Магазин VERA">
          <IconButton onClick={() => useShopStore.getState().setOpen(true)}
            sx={{ color: theme.textSec }}>
            <Storefront />
          </IconButton>
        </Tooltip>
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
            <IconButton onClick={() => setEditing(false)} sx={{ color: theme.textSec }}>
              <Close />
            </IconButton>
            <IconButton onClick={handleSave} disabled={saving} sx={{ color: '#4CAF50' }}>
              {saving ? <CircularProgress size={20} /> : <Check />}
            </IconButton>
          </Box>
        )}
      </Box>


      {/* ── Banner (клик = сменить фон шапки, платно/бесплатно решает магазин) ── */}
      <Box
        onClick={() => bannerInputRef.current?.click()}
        sx={{
          height: 180, position: 'relative', cursor: 'pointer',
          background: customization.bannerUrl
            ? `url(${customization.bannerUrl}) center/cover no-repeat`
            : `linear-gradient(135deg, ${customization.bannerColor || theme.accent} 0%, ${theme.bgChat} 100%)`,
          flexShrink: 0,
          '&:hover .banner-edit': { opacity: 1 },
        }}>
        <Box className="banner-edit" sx={{
          position: 'absolute', inset: 0, opacity: 0, transition: 'opacity 0.2s',
          bgcolor: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', gap: 1, fontSize: 14, fontWeight: 600,
        }}>
          <PhotoCamera sx={{ fontSize: 20 }} /> Сменить шапку
        </Box>
        <input ref={bannerInputRef} type="file" hidden accept="image/*"
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

        {/* ── Косметика из магазина VERA: минималистичные Инвентарь / Магазин ── */}
        <Box sx={{
          mt: 2, maxWidth: 480, width: '100%',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
        }}>
          {([
            { label: 'Инвентарь', hint: 'Моя косметика', icon: <Inventory2 sx={{ fontSize: 19 }} />, tab: 'inventory' as const },
            { label: 'Магазин', hint: 'Новинки VERA', icon: <Storefront sx={{ fontSize: 19 }} />, tab: 'shop' as const },
          ]).map((c) => (
            <Box key={c.label}
              onClick={() => { useShopStore.getState().setTab(c.tab); useShopStore.getState().setOpen(true); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.2,
                px: 1.5, py: 1.2, borderRadius: 2.5, cursor: 'pointer',
                bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
                transition: 'border-color .25s cubic-bezier(.16,1,.3,1), background .25s cubic-bezier(.16,1,.3,1), transform .25s cubic-bezier(.34,1.56,.64,1)',
                '&:hover': { borderColor: theme.accent + '66', transform: 'translateY(-1px)' },
                '&:active': { transform: 'scale(.98)' },
              }}>
              <Box sx={{
                width: 34, height: 34, borderRadius: 2, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: theme.bgInput, border: `1px solid ${theme.border}`,
                color: theme.accent,
              }}>
                {c.icon}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, color: theme.text, fontWeight: 600, lineHeight: 1.2 }}>{c.label}</Typography>
                <Typography sx={{ fontSize: 11, color: theme.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.hint}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
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
                { icon: <Storefront sx={{ fontSize: 18 }} />, label: 'Магазин VERA', onClick: () => useShopStore.getState().setOpen(true) },
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
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProfileCustomizeDialog open={customizeOpen} onClose={() => setCustomizeOpen(false)} />
    </Box>
  );
}
