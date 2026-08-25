import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box,
  List, ListItemButton, ListItemIcon, ListItemText, Divider, Slider, Switch,
  MenuItem, Select, TextField, Alert, Accordion, AccordionSummary, AccordionDetails, Stack,
} from '@mui/material';
import {
  Link as LinkIcon, DevicesOther, ChevronRight, ExpandMore,
  Brightness6, TextFields, Language, DataUsage, Notifications, Security, Lock, Public,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useUserSettingsStore, hashPassword, PrivacyScope, PreviewMode, AutoDeleteMonths } from '../store/userSettingsStore';
import InviteLinkDialog from './InviteLinkDialog';

const SCOPE_LABELS: Record<PrivacyScope, string> = {
  everyone: 'Все', contacts: 'Мои контакты', nobody: 'Никто',
};

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const s = useUserSettingsStore();

  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdOk, setPwdOk] = useState(false);

  async function saveAppLockPassword() {
    setPwdErr(null); setPwdOk(false);
    if (pwd1.length < 4) { setPwdErr('Минимум 4 символа'); return; }
    if (pwd1 !== pwd2) { setPwdErr('Пароли не совпадают'); return; }
    const h = await hashPassword(pwd1);
    s.set('appLockPasswordHash', h);
    s.set('appLockEnabled', true);
    setPwd1(''); setPwd2(''); setPwdOk(true);
  }
  function disableAppLock() {
    s.set('appLockEnabled', false);
    s.set('appLockPasswordHash', null);
    setPwdOk(false);
  }

  const sectionSx = { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, mb: 1 };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
        PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Настройки</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: theme.bgChat, p: 0 }}>
          <List sx={{ py: 0 }}>
            <ListItemButton onClick={() => setInviteOpen(true)} sx={{ py: 1.5 }}>
              <ListItemIcon sx={{ color: theme.accent, minWidth: 40 }}><LinkIcon /></ListItemIcon>
              <ListItemText primary="Моя ссылка для приглашения" secondary="Поделиться контактом или добавить друга"
                primaryTypographyProps={{ sx: { color: theme.text, fontWeight: 600 } }}
                secondaryTypographyProps={{ sx: { color: theme.textSec, fontSize: 12 } }} />
              <ChevronRight sx={{ color: theme.textSec }} />
            </ListItemButton>
            <Divider sx={{ borderColor: theme.border }} />
            <ListItemButton onClick={() => { onClose(); navigate('/devices'); }} sx={{ py: 1.5 }}>
              <ListItemIcon sx={{ color: theme.accent, minWidth: 40 }}><DevicesOther /></ListItemIcon>
              <ListItemText primary="Устройства" secondary="Привязанные устройства и QR-код"
                primaryTypographyProps={{ sx: { color: theme.text, fontWeight: 600 } }}
                secondaryTypographyProps={{ sx: { color: theme.textSec, fontSize: 12 } }} />
              <ChevronRight sx={{ color: theme.textSec }} />
            </ListItemButton>
          </List>

          <Box sx={{ p: 2 }}>
            <Accordion sx={sectionSx} disableGutters>
              <AccordionSummary expandIcon={<ExpandMore sx={{ color: theme.textSec }} />}>
                <Brightness6 sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Внешний вид</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Яркость</Typography>
                <Slider min={0.5} max={1.5} step={0.05} value={s.brightness}
                  onChange={(_, v) => s.set('brightness', Array.isArray(v) ? v[0] : v)}
                  valueLabelDisplay="auto" valueLabelFormat={(v) => `${Math.round(v * 100)}%`} />
                <Typography sx={{ fontSize: 13, color: theme.textSec, mt: 2, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextFields fontSize="small" /> Масштаб текста
                </Typography>
                <Slider min={0.8} max={1.6} step={0.05} value={s.textScale}
                  onChange={(_, v) => s.set('textScale', Array.isArray(v) ? v[0] : v)}
                  valueLabelDisplay="auto" valueLabelFormat={(v) => `${Math.round(v * 100)}%`} />
                <Typography sx={{ fontSize: 13, color: theme.textSec, mt: 2, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Language fontSize="small" /> Язык интерфейса
                </Typography>
                <Select fullWidth size="small" value={s.language}
                  onChange={(e) => s.set('language', e.target.value as any)}>
                  <MenuItem value="ru">Русский</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="uk">Українська</MenuItem>
                  <MenuItem value="es">Español</MenuItem>
                </Select>
                <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>
                  Полная локализация интерфейса добавляется постепенно — выбор сохраняется.
                </Alert>
              </AccordionDetails>
            </Accordion>

            <Accordion sx={sectionSx} disableGutters>
              <AccordionSummary expandIcon={<ExpandMore sx={{ color: theme.textSec }} />}>
                <Notifications sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Уведомления</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <RowToggle label="Звуки в приложении" checked={s.inAppSounds} onChange={(v) => s.set('inAppSounds', v)} />
                <RowToggle label="Вибрация в приложении" checked={s.inAppVibration} onChange={(v) => s.set('inAppVibration', v)} />
                <RowToggle label="Виброзвонок / вибрация" checked={s.vibrationEnabled} onChange={(v) => s.set('vibrationEnabled', v)} />
                <RowToggle label="LED-индикатор" checked={s.ledIndicator} onChange={(v) => s.set('ledIndicator', v)} />
                <RowToggle label="Приоритет закреплённых чатов" checked={s.pinnedPriority} onChange={(v) => s.set('pinnedPriority', v)} />
                <Typography sx={{ fontSize: 13, color: theme.textSec, mt: 2, mb: 0.5 }}>Всплывающие превью</Typography>
                <Select fullWidth size="small" value={s.popupPreview}
                  onChange={(e) => s.set('popupPreview', e.target.value as PreviewMode)}>
                  <MenuItem value="always">Всегда</MenuItem>
                  <MenuItem value="when_off">Если выкл</MenuItem>
                  <MenuItem value="never">Никогда</MenuItem>
                </Select>
                <Alert severity="info" sx={{ mt: 2, fontSize: 12 }}>
                  Исключения для конкретных чатов настраиваются в меню чата (три точки → «🔔 Уведомления чата»).
                </Alert>
              </AccordionDetails>
            </Accordion>
            <Accordion sx={sectionSx} disableGutters>
              <AccordionSummary expandIcon={<ExpandMore sx={{ color: theme.textSec }} />}>
                <DataUsage sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Данные и память</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <RowToggle label="Автозагрузка медиа" checked={s.autoDownloadMedia} onChange={(v) => s.set('autoDownloadMedia', v)} />
                <RowToggle label="Сжимать отправляемые файлы" checked={s.compressUploads} onChange={(v) => s.set('compressUploads', v)} />
                <RowToggle label="Стриминг в высоком качестве" checked={s.streamingHighQuality} onChange={(v) => s.set('streamingHighQuality', v)} />
                <Button size="small" sx={{ mt: 1 }} onClick={() => {
                  try {
                    Object.keys(localStorage).forEach((k) => {
                      if (k.startsWith('vera-cache-') || k.startsWith('vera-preview-')) localStorage.removeItem(k);
                    });
                    alert('Кэш очищен');
                  } catch { alert('Не удалось очистить кэш'); }
                }}>Очистить кэш</Button>
              </AccordionDetails>
            </Accordion>

            <Accordion sx={sectionSx} disableGutters>
              <AccordionSummary expandIcon={<ExpandMore sx={{ color: theme.textSec }} />}>
                <Public sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Настройки историй</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <ScopeRow label="Кто может видеть истории" value={s.storiesWhoCanView} onChange={(v) => s.set('storiesWhoCanView', v)} />
                <ScopeRow label="Кто может сохранять истории" value={s.storiesWhoCanSave} onChange={(v) => s.set('storiesWhoCanSave', v)} />
              </AccordionDetails>
            </Accordion>

            <Accordion sx={sectionSx} disableGutters>
              <AccordionSummary expandIcon={<ExpandMore sx={{ color: theme.textSec }} />}>
                <Security sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Конфиденциальность</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <ScopeRow label='Последняя активность и "В сети"' value={s.lastSeenScope} onChange={(v) => s.set('lastSeenScope', v)} />
                <ScopeRow label="Кто видит фото профиля" value={s.profilePhotoScope} onChange={(v) => s.set('profilePhotoScope', v)} />
                <ScopeRow label="Пересылка ваших сообщений" value={s.forwardScope} onChange={(v) => s.set('forwardScope', v)} />
                <ScopeRow label="Кто может звонить" value={s.callsScope} onChange={(v) => s.set('callsScope', v)} />
                <ScopeRow label="Peer-to-Peer для звонков" value={s.callsP2P} onChange={(v) => s.set('callsP2P', v)} />
                <ScopeRow label="Кто может добавлять в группы" value={s.groupsInviteScope} onChange={(v) => s.set('groupsInviteScope', v)} />
                <Button size="small" sx={{ mt: 1 }} onClick={() => alert('Черный список: раздел в разработке')}>
                  Заблокированные пользователи
                </Button>
              </AccordionDetails>
            </Accordion>
            <Accordion sx={sectionSx} disableGutters>
              <AccordionSummary expandIcon={<ExpandMore sx={{ color: theme.textSec }} />}>
                <Lock sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Безопасность</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography sx={{ fontWeight: 600, mb: 1 }}>Вход только по паролю</Typography>
                {s.appLockEnabled && s.appLockPasswordHash ? (
                  <Stack spacing={1}>
                    <Alert severity="success">Пароль установлен. При запуске VERA будет запрашивать его.</Alert>
                    <Button color="error" variant="outlined" onClick={disableAppLock}>Отключить пароль</Button>
                  </Stack>
                ) : (
                  <Stack spacing={1}>
                    <TextField size="small" type="password" label="Новый пароль" value={pwd1} onChange={(e) => setPwd1(e.target.value)} />
                    <TextField size="small" type="password" label="Повторите пароль" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
                    <TextField size="small" label="E-mail для восстановления (необязательно)"
                      value={s.appLockRecoveryEmail || ''} onChange={(e) => s.set('appLockRecoveryEmail', e.target.value || null)} />
                    {pwdErr && <Alert severity="error">{pwdErr}</Alert>}
                    {pwdOk && <Alert severity="success">Пароль сохранён</Alert>}
                    <Button variant="contained" onClick={saveAppLockPassword}>Установить пароль</Button>
                  </Stack>
                )}
                <Divider sx={{ my: 2, borderColor: theme.border }} />
                <RowToggle label="Облачный пароль (пассивный вход)" checked={s.cloudPasswordEnabled} onChange={(v) => s.set('cloudPasswordEnabled', v)} />
                <Divider sx={{ my: 2, borderColor: theme.border }} />
                <ListItemButton onClick={() => { onClose(); navigate('/devices'); }} sx={{ px: 0 }}>
                  <ListItemIcon sx={{ color: theme.accent, minWidth: 40 }}><DevicesOther /></ListItemIcon>
                  <ListItemText primary="Активные сессии" secondary="Все устройства, где открыта VERA" />
                  <ChevronRight sx={{ color: theme.textSec }} />
                </ListItemButton>
                <Divider sx={{ my: 2, borderColor: theme.border }} />
                <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Автоудаление аккаунта при неактивности</Typography>
                <Select fullWidth size="small" value={s.autoDeleteInactiveMonths}
                  onChange={(e) => s.set('autoDeleteInactiveMonths', Number(e.target.value) as AutoDeleteMonths)}>
                  <MenuItem value={0}>Отключено</MenuItem>
                  <MenuItem value={1}>1 месяц</MenuItem>
                  <MenuItem value={3}>3 месяца</MenuItem>
                  <MenuItem value={6}>6 месяцев</MenuItem>
                  <MenuItem value={12}>1 год</MenuItem>
                </Select>
              </AccordionDetails>
            </Accordion>
          </Box>

          <Box sx={{ px: 2, pb: 2 }}>
            <Typography sx={{ fontSize: 12, color: theme.textSec }}>
              Индивидуальные звуки уведомлений настраиваются в меню чата (три точки в шапке → «🔔 Уведомления чата»).
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: theme.textSec }}>Закрыть</Button>
        </DialogActions>
      </Dialog>
      <InviteLinkDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

function RowToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Typography sx={{ fontSize: 14 }}>{label}</Typography>
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Box>
  );
}

function ScopeRow({ label, value, onChange }: { label: string; value: PrivacyScope; onChange: (v: PrivacyScope) => void }) {
  return (
    <Box sx={{ py: 0.75 }}>
      <Typography sx={{ fontSize: 13, mb: 0.5 }}>{label}</Typography>
      <Select fullWidth size="small" value={value} onChange={(e) => onChange(e.target.value as PrivacyScope)}>
        {(['everyone', 'contacts', 'nobody'] as PrivacyScope[]).map((k) => (
          <MenuItem key={k} value={k}>{SCOPE_LABELS[k]}</MenuItem>
        ))}
      </Select>
    </Box>
  );
}

