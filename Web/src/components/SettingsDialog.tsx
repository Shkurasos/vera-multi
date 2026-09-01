import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box,
  List, ListItemButton, ListItemIcon, ListItemText, Divider, Slider, Switch,
  MenuItem, Select, TextField, Alert, Accordion, AccordionSummary, AccordionDetails, Stack,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import {
  Link as LinkIcon, DevicesOther, ChevronRight, ExpandMore, AutoAwesome,
  Brightness6, TextFields, Language, DataUsage, Notifications, Security, Lock, Public,
  ViewSidebar, RestartAlt, Storefront, Palette,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import {
  useUserSettingsStore, hashPassword,
  PrivacyScope, PreviewMode, AutoDeleteMonths,
  SidePos, VertPos, Density,
} from '../store/userSettingsStore';
import InviteLinkDialog from './InviteLinkDialog';
import LayoutDesignerDialog from './LayoutDesignerDialog';
import { useShopStore } from '../store/shopStore';
import { useUiPrefsStore, ICON_PACKS, UI_STYLES, IconPack, UiStyle } from '../store/uiPrefsStore';
import { useAnimStore, ANIM_GROUPS } from '../store/animStore';


const SCOPE_LABELS: Record<PrivacyScope, string> = {
  everyone: 'Все', contacts: 'Мои контакты', nobody: 'Никто',
};

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const shopSetOpen = useShopStore((x) => x.setOpen);
  const s = useUserSettingsStore();
  const { iconPack, uiStyle, setIconPack, setUiStyle } = useUiPrefsStore();
  const { enabled: animEnabled, set: setAnim, setAll: setAllAnims } = useAnimStore();
  const allAnimsOn = ANIM_GROUPS.every((g) => animEnabled[g.key]);


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
                <Palette sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Иконки и стиль интерфейса</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>
                  Пак иконок
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={iconPack}
                  onChange={(_, v) => v && setIconPack(v as IconPack)}
                  sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}
                >
                  {ICON_PACKS.map((p) => (
                    <ToggleButton
                      key={p.id}
                      value={p.id}
                      sx={{
                        flex: '1 1 45%', textTransform: 'none', color: theme.text,
                        borderColor: theme.border,
                        '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
                      }}
                    >
                      {p.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 2 }}>
                  {ICON_PACKS.find((p) => p.id === iconPack)?.desc}
                </Typography>

                <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>
                  Стиль интерфейса
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={uiStyle}
                  onChange={(_, v) => v && setUiStyle(v as UiStyle)}
                  sx={{ flexWrap: 'wrap', gap: 0.5 }}
                >
                  {UI_STYLES.map((u) => (
                    <ToggleButton
                      key={u.id}
                      value={u.id}
                      sx={{
                        flex: '1 1 30%', textTransform: 'none', color: theme.text,
                        borderColor: theme.border,
                        '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
                      }}
                    >
                      {u.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 1 }}>
                  {UI_STYLES.find((u) => u.id === uiStyle)?.desc}
                </Typography>
                <Alert severity="info" sx={{ mt: 1.5, fontSize: 12 }}>
                  Изменения применяются сразу и работают поверх любой темы.
                </Alert>
              </AccordionDetails>
            </Accordion>

            <Accordion sx={sectionSx} disableGutters>
              <AccordionSummary expandIcon={<ExpandMore sx={{ color: theme.textSec }} />}>
                <AutoAwesome sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Анимации</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Box minWidth={0}>
                    <Typography sx={{ fontSize: 14 }}>Анимации интерфейса</Typography>
                    <Typography sx={{ fontSize: 12, color: theme.textSec }}>
                      Плавные микровзаимодействия в стиле Apple
                    </Typography>
                  </Box>
                  <Switch checked={allAnimsOn} onChange={(e) => setAllAnims(e.target.checked)} />
                </Box>
                <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 1 }}>
                  Выключите только те, которые не нравятся, — остальные продолжат работать.
                </Typography>
                {ANIM_GROUPS.map((g) => (
                  <RowToggle
                    key={g.key}
                    label={`${g.emoji} ${g.label}`}
                    hint={g.desc}
                    checked={animEnabled[g.key]}
                    onChange={(v) => setAnim(g.key, v)}
                  />
                ))}
                <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>
                  Если в системе включен режим Reduce Motion, все анимации автоматически отключаются.
                </Alert>
              </AccordionDetails>
            </Accordion>

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
                <ViewSidebar sx={{ mr: 1, color: theme.accent }} />
                <Typography sx={{ fontWeight: 600 }}>Макет</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Button variant="outlined" startIcon={<Storefront />} onClick={() => { setDesignerOpen(false); shopSetOpen(true); }}
                    sx={{ color: theme.accent, borderColor: theme.accent + '55', textTransform: 'none', borderRadius: 2,
                          '&:hover': { bgcolor: theme.accent + '10', borderColor: theme.accent } }}>
                    Магазин VERA
                  </Button>

                  <Button variant="contained" onClick={() => setDesignerOpen(true)}
                    sx={{ bgcolor: theme.accent, textTransform: 'none', borderRadius: 2,
                          '&:hover': { bgcolor: theme.accent } }}>
                    🎨 Открыть визуальный конструктор
                  </Button>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Сторона панели чатов (десктоп)</Typography>
                    <ToggleButtonGroup
                      exclusive size="small" fullWidth
                      value={s.layout.sidebarSide}
                      onChange={(_, v) => v && s.setLayout('sidebarSide', v as SidePos)}
                    >
                      <ToggleButton value="left">Слева</ToggleButton>
                      <ToggleButton value="right">Справа</ToggleButton>
                      <ToggleButton value="top">Сверху</ToggleButton>
                      <ToggleButton value="bottom">Снизу</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
                      Ширина панели чатов — {s.layout.sidebarWidth}px
                    </Typography>
                    <Slider min={200} max={520} step={5} value={s.layout.sidebarWidth}
                      onChange={(_, v) => s.setLayout('sidebarWidth', Array.isArray(v) ? v[0] : v)} />
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Нижняя навигация (мобильный)</Typography>
                    <ToggleButtonGroup exclusive size="small" fullWidth
                      value={s.layout.mobileNavPos}
                      onChange={(_, v) => v && s.setLayout('mobileNavPos', v as VertPos)}>
                      <ToggleButton value="bottom">Снизу</ToggleButton>
                      <ToggleButton value="top">Сверху</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Плеер</Typography>
                    <ToggleButtonGroup exclusive size="small" fullWidth
                      value={s.layout.playerPos}
                      onChange={(_, v) => v && s.setLayout('playerPos', v as VertPos)}>
                      <ToggleButton value="bottom">Снизу</ToggleButton>
                      <ToggleButton value="top">Сверху</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Шапка чата</Typography>
                    <ToggleButtonGroup exclusive size="small" fullWidth
                      value={s.layout.chatHeaderPos}
                      onChange={(_, v) => v && s.setLayout('chatHeaderPos', v as VertPos)}>
                      <ToggleButton value="top">Сверху</ToggleButton>
                      <ToggleButton value="bottom">Снизу</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Поле ввода чата</Typography>
                    <ToggleButtonGroup exclusive size="small" fullWidth
                      value={s.layout.chatInputPos}
                      onChange={(_, v) => v && s.setLayout('chatInputPos', v as VertPos)}>
                      <ToggleButton value="bottom">Снизу</ToggleButton>
                      <ToggleButton value="top">Сверху</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Плотность интерфейса</Typography>
                    <ToggleButtonGroup exclusive size="small" fullWidth
                      value={s.layout.density}
                      onChange={(_, v) => v && s.setLayout('density', v as Density)}>
                      <ToggleButton value="compact">Компактно</ToggleButton>
                      <ToggleButton value="cozy">Обычно</ToggleButton>
                      <ToggleButton value="roomy">Просторно</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
                      Скругление углов окна чата и панелей — {s.layout.radius}px
                    </Typography>
                    <Slider min={0} max={28} step={1} value={s.layout.radius}
                      onChange={(_, v) => s.setLayout('radius', Array.isArray(v) ? v[0] : v)} />
                  </Box>

                  <RowToggle label="Показывать вкладки (Диалоги / Архив / Группы)"
                    checked={s.layout.showTabs}
                    onChange={(v) => s.setLayout('showTabs', v)} />
                  <RowToggle label="Показывать аватары в списке чатов"
                    checked={s.layout.showAvatarsInList}
                    onChange={(v) => s.setLayout('showAvatarsInList', v)} />

                  <Alert severity="info" sx={{ fontSize: 12 }}>
                    Панель чатов можно также перетаскивать за правый край мышью — ширина сохранится.
                  </Alert>
                  <Button variant="outlined" startIcon={<RestartAlt />}
                    onClick={() => s.resetLayout()}>
                    Сбросить макет по умолчанию
                  </Button>
                </Stack>
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
      <LayoutDesignerDialog open={designerOpen} onClose={() => setDesignerOpen(false)} />
    </>
  );
}

function RowToggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Box minWidth={0}>
        <Typography sx={{ fontSize: 14 }}>{label}</Typography>
        {hint && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{hint}</Typography>}
      </Box>
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

