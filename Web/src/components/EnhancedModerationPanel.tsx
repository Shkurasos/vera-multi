import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Card,
  CardContent,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Grid,
  Badge,
  FormControl,
  InputLabel,
  Select,
  Stack,
  Divider,
  Switch,
  FormControlLabel,
} from '@mui/material';
import AdminChatLookup from './AdminChatLookup';
import { 
  reportsApi, 
  Report, 
  ReportTargetType, 
  ReportStatus, 
  ModerationAction, 
  ReportStats,
  appealsApi,
  Appeal,
  AppealAction,
  AutoDeleteSetting,
} from '../services/api';

type TabType = 'all' | ReportTargetType;

const TAB_LABELS: Record<TabType, string> = {
  all: 'Все',
  user: 'Пользователи',
  bot: 'Боты',
  group: 'Группы',
  channel: 'Каналы',
  sticker: 'Стикеры',
  icon: 'Иконки',
};

const ACTION_LABELS: Record<ModerationAction, string> = {
  dismiss: 'Отклонить',
  warn: 'Предупреждение',
  temporary: 'Временный бан',
  permanent: 'Постоянный бан',
  ip: 'IP-бан',
  device: 'Бан всех устройств аккаунта',
  readonly: 'Только чтение',
  nobots: 'Запрет на ботов и приложения',
  delete: 'Удалить бота или приложение',
};

const APPEAL_ACTION_LABELS: Record<AppealAction, string> = {
  uphold: 'Отклонить апелляцию',
  overturn: 'Снять блокировку',
};

const TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
  user: 'Пользователь',
  bot: 'Бот',
  group: 'Группа',
  channel: 'Канал',
  sticker: 'Стикер',
  icon: 'Иконка',
};

// Решения со сроком в минутах (0 — бессрочно, кроме временного бана).
const TIMED_ACTIONS: ModerationAction[] = ['temporary', 'ip', 'device', 'readonly', 'nobots'];
// Решения, после которых аккаунт можно удалить автоматически.
const AUTO_DELETE_ACTIONS: ModerationAction[] = ['temporary', 'permanent', 'ip', 'device', 'readonly'];

export default function EnhancedModerationPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [statusFilter, setStatusFilter] = useState<ReportStatus | 'all'>('open');
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  const [action, setAction] = useState<ModerationAction>('dismiss');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [submitting, setSubmitting] = useState(false);
  // Автоудаление аккаунта: по умолчанию включено только для бана по IP.
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState(false);
  const [autoDeleteDays, setAutoDeleteDays] = useState('7');
  const [autoDeleteSaving, setAutoDeleteSaving] = useState(false);
  // Пусто — удалить бота целиком, иначе только его мини-приложение.
  const [appShortName, setAppShortName] = useState('');
  const [chatRequest, setChatRequest] = useState<{ link: string; n: number } | null>(null);

  // Appeals state
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [selectedAppealId, setSelectedAppealId] = useState('');
  const [appealAction, setAppealAction] = useState<AppealAction>('uphold');
  const [appealNote, setAppealNote] = useState('');
  const [appealError, setAppealError] = useState('');
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const loadReports = async () => {
    setLoading(true);
    setError('');
    try {
      const filters: { type?: ReportTargetType | 'all'; status?: ReportStatus | 'all' } = {};
      if (activeTab !== 'all') filters.type = activeTab;
      if (statusFilter !== 'all') filters.status = statusFilter;
      
      const { data } = await reportsApi.list(filters);
      setReports(data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Не удалось загрузить жалобы');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const { data } = await reportsApi.stats();
      setStats(data);
    } catch (e: any) {
      console.error('Не удалось загрузить статистику:', e);
    }
  };

  useEffect(() => {
    loadReports();
  }, [activeTab, statusFilter]);

  useEffect(() => {
    loadStats();
  }, []);

  // Notifications link to /admin?report=ID and /admin?appeal=ID.
  const reportFromUrl = new URLSearchParams(location.search).get('report') || '';
  const appealFromUrl = new URLSearchParams(location.search).get('appeal') || '';

  const loadAppeals = async () => {
    try {
      const { data } = await appealsApi.adminList();
      setAppeals(data);
    } catch (e: any) {
      setAppealError(e.response?.data?.message || 'Не удалось загрузить апелляции');
    }
  };

  useEffect(() => {
    loadAppeals();
  }, []);

  useEffect(() => {
    if (!reportFromUrl) return;
    reportsApi.get(reportFromUrl)
      .then(({ data }) => openDetails(data))
      .catch((e: any) => setError(e.response?.data?.message || 'Жалоба не найдена'));
  }, [reportFromUrl]);

  useEffect(() => {
    if (!appealFromUrl) return;
    setSelectedAppealId(appealFromUrl);
    setAppealAction('uphold');
    setAppealNote('');
    setAppealError('');
  }, [appealFromUrl]);

  const selectedAppeal = appeals.find((a) => a.id === selectedAppealId);

  const decideAppeal = async () => {
    if (!selectedAppealId) return;
    setAppealSubmitting(true);
    setAppealError('');
    try {
      await appealsApi.decide(selectedAppealId, appealAction, appealNote.trim());
      setSelectedAppealId('');
      setAppealNote('');
      if (appealFromUrl) navigate('/admin', { replace: true });
      await loadAppeals();
    } catch (e: any) {
      setAppealError(e.response?.data?.message || 'Не удалось сохранить решение');
    } finally {
      setAppealSubmitting(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!selectedReport) return;
    setMessagesLoading(true);
    try {
      const { data } = await reportsApi.messages(selectedReport.id, messages.length);
      setMessages((prev) => [...prev, ...(data.messages || [])]);
      setTotalMessages(data.total || 0);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Не удалось загрузить сообщения');
    } finally {
      setMessagesLoading(false);
    }
  };

  const openDetails = async (report: Report) => {
    setSelectedReport(report);
    setDetailsOpen(true);
    setLoadingDetails(true);
    setPhoto(null);
    setMessages([]);
    setTotalMessages(0);
    setAction('dismiss');
    setReason('');
    setMinutes('60');
    setAutoDeleteEnabled(report.decision?.autoDelete?.enabled ?? false);
    setAutoDeleteDays(String(report.decision?.autoDelete?.days ?? 7));
    setAppShortName('');

    try {
      if (report.hasPhoto) {
        const { data: blob } = await reportsApi.photo(report.id);
        setPhoto(URL.createObjectURL(blob));
      }
      const { data: msgData } = await reportsApi.messages(report.id, 0);
      setMessages(msgData.messages || []);
      setTotalMessages(msgData.total || 0);
    } catch (e) {
      console.error('Ошибка загрузки деталей:', e);
    } finally {
      setLoadingDetails(false);
    }
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    if (reportFromUrl) navigate('/admin', { replace: true });
    if (photo) {
      URL.revokeObjectURL(photo);
      setPhoto(null);
    }
    setSelectedReport(null);
  };

  const handleDecide = async () => {
    if (!selectedReport || !reason.trim()) {
      setError('Укажите причину решения');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const minutesNum = TIMED_ACTIONS.includes(action) ? Number(minutes) || 0 : 0;
      const extra: { autoDelete?: AutoDeleteSetting; appShortName?: string } = {};
      if (AUTO_DELETE_ACTIONS.includes(action)) {
        extra.autoDelete = { enabled: autoDeleteEnabled, days: Number(autoDeleteDays) || 7 };
      }
      if (action === 'delete' && appShortName.trim()) extra.appShortName = appShortName.trim();
      await reportsApi.decide(selectedReport.id, action, reason.trim(), minutesNum, extra);
      await loadReports();
      await loadStats();
      closeDetails();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Не удалось сохранить решение');
    } finally {
      setSubmitting(false);
    }
  };

  // Включить, выключить или перенести автоудаление уже принятого решения.
  const saveAutoDelete = async () => {
    if (!selectedReport) return;
    setAutoDeleteSaving(true);
    setError('');
    try {
      const { data } = await reportsApi.setAutoDelete(selectedReport.id, {
        enabled: autoDeleteEnabled, days: Number(autoDeleteDays) || 7,
      });
      setSelectedReport(data);
      await loadReports();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Не удалось сохранить автоудаление');
    } finally {
      setAutoDeleteSaving(false);
    }
  };

  const autoDeleteControls = (
    <Stack direction="row" spacing={2} alignItems="center">
      <FormControlLabel
        control={<Switch checked={autoDeleteEnabled} onChange={(e) => setAutoDeleteEnabled(e.target.checked)} />}
        label="Удалить аккаунт автоматически"
      />
      <TextField
        size="small" type="number" label="Через, дней" sx={{ width: 140 }}
        value={autoDeleteDays} disabled={!autoDeleteEnabled}
        onChange={(e) => setAutoDeleteDays(e.target.value)}
        inputProps={{ min: 1, max: 365 }}
      />
    </Stack>
  );

  const availableActions = (): ModerationAction[] => {
    if (!selectedReport) return ['dismiss'];
    const type = selectedReport.targetType;
    if (type === 'user' || type === 'bot') {
      // Для бота все наказания, кроме удаления, получает его владелец.
      const actions: ModerationAction[] = ['dismiss', 'warn', 'temporary', 'permanent', 'ip', 'device', 'readonly', 'nobots'];
      return type === 'bot' ? [...actions, 'delete'] : actions;
    }
    return ['dismiss', 'delete'];
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Typography variant="h5" gutterBottom>Панель модерации</Typography>
        {stats && (
          <Grid container spacing={1}>
            <Grid item><Chip label={`Всего: ${stats.total}`} size="small" /></Grid>
            <Grid item><Chip label={`Открытых: ${stats.open}`} size="small" color="warning" /></Grid>
            {Object.entries(stats.byType).map(([type, count]) => (
              <Grid item key={type}>
                <Chip label={`${TARGET_TYPE_LABELS[type as ReportTargetType]}: ${count}`} size="small" color="primary" variant="outlined" />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/* Tabs + Filters */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ px: 2 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
            {(Object.keys(TAB_LABELS) as TabType[]).map((tab) => (
              <Tab key={tab} label={
                <Badge badgeContent={tab === 'all' ? stats?.open : stats?.byType[tab as ReportTargetType] || 0} color="error" max={999}>
                  {TAB_LABELS[tab]}
                </Badge>
              } value={tab} />
            ))}
          </Tabs>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Статус</InputLabel>
            <Select value={statusFilter} label="Статус" onChange={(e) => setStatusFilter(e.target.value as ReportStatus | 'all')}>
              <MenuItem value="all">Все</MenuItem>
              <MenuItem value="open">Открытые</MenuItem>
              <MenuItem value="resolved">Решённые</MenuItem>
            </Select>
          </FormControl>
          <Button onClick={loadReports} disabled={loading} variant="outlined" size="small">Обновить</Button>
        </Stack>
      </Box>

      {/* Слева жалобы, справа просмотр чата по ссылке */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
        ) : reports.length === 0 ? (
          <Alert severity="info">Нет жалоб по выбранным фильтрам</Alert>
        ) : (
          <Grid container spacing={2}>
            {reports.map((report) => (
              <Grid item xs={12} sm={6} md={12} lg={6} xl={4} key={report.id}>
                <Card 
                  sx={{ 
                    cursor: 'pointer', 
                    '&:hover': { boxShadow: 4 },
                    border: report.status === 'resolved' ? '1px solid' : 'none',
                    borderColor: 'success.main',
                    height: '100%',
                  }}
                  onClick={() => openDetails(report)}
                >
                  <CardContent>
                    <Stack spacing={1}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Chip label={TARGET_TYPE_LABELS[report.targetType]} size="small" color="primary" />
                        <Chip label={report.status === 'open' ? 'Новая' : 'Решена'} size="small" color={report.status === 'open' ? 'warning' : 'success'} />
                      </Stack>
                      
                      <Typography variant="subtitle2" noWrap>
                        {report.targetType === 'user' || report.targetType === 'bot' 
                          ? `@${report.target?.username || report.targetId}`
                          : report.target?.name || report.targetName || report.targetId
                        }
                      </Typography>
                      
                      <Typography variant="caption" color="text.secondary">
                        От: @{report.reporter.username}
                      </Typography>
                      
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {report.comment}
                      </Typography>
                      
                      <Typography variant="caption" color="text.secondary">
                        {new Date(report.createdAt).toLocaleString('ru-RU')}
                      </Typography>

                      {report.decision && (
                        <Chip 
                          label={ACTION_LABELS[report.decision.action]}
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
      <Box sx={{
        width: { xs: '100%', md: '45%' }, minHeight: { xs: 400, md: 0 }, overflow: 'hidden', p: 2,
        borderLeft: { md: 1 }, borderTop: { xs: 1, md: 0 }, borderColor: 'divider', bgcolor: 'background.paper',
      }}>
        <AdminChatLookup request={chatRequest} />
      </Box>
      </Box>

      {/* Details Dialog - next */}
      <Dialog open={detailsOpen} onClose={closeDetails} maxWidth="md" fullWidth>
        <DialogTitle>
          Детали жалобы
          {selectedReport && (
            <Typography variant="caption" display="block" color="text.secondary">
              {TARGET_TYPE_LABELS[selectedReport.targetType]} • {new Date(selectedReport.createdAt).toLocaleString('ru-RU')}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          {loadingDetails ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
          ) : selectedReport && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" gutterBottom>Объект жалобы:</Typography>
                <Typography>
                  {selectedReport.targetType === 'user' || selectedReport.targetType === 'bot'
                    ? `@${selectedReport.target?.username || selectedReport.targetId}`
                    : selectedReport.target?.name || selectedReport.targetName || selectedReport.targetId
                  }
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>От пользователя:</Typography>
                <Typography>@{selectedReport.reporter.username}</Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>Комментарий:</Typography>
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{selectedReport.comment}</Typography>
              </Box>

              {selectedReport.chatId && (
                <Stack direction="row" spacing={1}>
                  <Button href={`/#/chat/${encodeURIComponent(selectedReport.chatId)}`} size="small">Ссылка на исходный чат</Button>
                  <Button size="small" variant="outlined" onClick={() => {
                    const link = `/#/chat/${encodeURIComponent(selectedReport.chatId!)}`;
                    closeDetails();
                    setChatRequest((prev) => ({ link, n: (prev?.n || 0) + 1 }));
                  }}>Открыть в просмотре справа</Button>
                </Stack>
              )}

              {photo && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>Прикреплённое фото:</Typography>
                  <Box component="img" src={photo} alt="Доказательство" sx={{ maxWidth: '100%', maxHeight: 400, borderRadius: 1 }} />
                </Box>
              )}

              {messages.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>История сообщений ({messages.length}/{totalMessages}):</Typography>
                  <Stack spacing={1} sx={{ maxHeight: 300, overflow: 'auto', p: 1, bgcolor: 'background.default', borderRadius: 1 }}>
                    {messages.map((msg: any, idx: number) => (
                      <Box key={idx} sx={{ p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          @{msg.sender?.username || msg.senderId} • {msg.createdAt ? new Date(msg.createdAt).toLocaleString('ru-RU') : ''}
                        </Typography>
                        <Typography variant="body2">{msg.text || msg.content || '(сообщение без текста)'}</Typography>
                        {(msg.attachments || []).map((a: any, i: number) => {
                          const url = a.fileUrl || a.url || '';
                          return /^\/uploads\//.test(url)
                            ? <Button key={i} size="small" href={url} target="_blank" rel="noopener noreferrer">{a.fileName || a.originalName || 'Вложение'}</Button>
                            : <Typography key={i} variant="caption">{a.fileName || a.mimeType || 'Вложение'}</Typography>;
                        })}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}

              {messages.length < totalMessages && (
                <Button onClick={loadMoreMessages} disabled={messagesLoading} size="small">Загрузить ещё</Button>
              )}

              {selectedReport.decision ? (
                <Alert severity="success">
                  <Typography variant="subtitle2">Решение принято:</Typography>
                  <Typography>{ACTION_LABELS[selectedReport.decision.action]}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>{selectedReport.decision.reason}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(selectedReport.decision.at).toLocaleString('ru-RU')}
                  </Typography>
                  {selectedReport.decision.overturned && (
                    <Typography variant="body2" sx={{ mt: 1 }}>Отменено по апелляции</Typography>
                  )}
                  {selectedReport.decision.autoDeletedAt && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Аккаунт удалён {new Date(selectedReport.decision.autoDeletedAt).toLocaleString('ru-RU')}
                    </Typography>
                  )}
                  {selectedReport.decision.autoDelete && !selectedReport.decision.overturned && !selectedReport.decision.autoDeletedAt && (
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {autoDeleteControls}
                      <Box>
                        <Button size="small" variant="outlined" disabled={autoDeleteSaving} onClick={saveAutoDelete}>
                          {autoDeleteSaving ? 'Сохранение...' : 'Сохранить автоудаление'}
                        </Button>
                      </Box>
                    </Stack>
                  )}
                </Alert>
              ) : (
                <>
                  <FormControl fullWidth>
                    <InputLabel>Решение</InputLabel>
                    <Select value={action} label="Решение" onChange={(e) => {
                      const next = e.target.value as ModerationAction;
                      setAction(next);
                      setAutoDeleteEnabled(next === 'ip');
                    }}>
                      {availableActions().map((act) => (
                        <MenuItem key={act} value={act}>{ACTION_LABELS[act]}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {TIMED_ACTIONS.includes(action) && (
                    <TextField
                      fullWidth
                      type="number"
                      label={action === 'temporary' ? 'Срок в минутах' : 'Срок в минутах (0 — бессрочно)'}
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      helperText={action === 'ip' ? 'Блокируются аккаунт и все известные IP пользователя'
                        : action === 'device' ? 'Блокируются аккаунт и все устройства, когда-либо привязанные к нему'
                        : action === 'readonly' ? 'Вход открыт, но писать, редактировать и создавать нельзя'
                        : ''}
                    />
                  )}

                  {AUTO_DELETE_ACTIONS.includes(action) && autoDeleteControls}

                  {action === 'delete' && (
                    <TextField
                      fullWidth
                      label="Короткое имя мини-приложения"
                      value={appShortName}
                      onChange={(e) => setAppShortName(e.target.value)}
                      helperText="Пусто — удалить бота целиком. Владелец сможет обжаловать удаление."
                    />
                  )}

                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    label="Причина решения *"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    inputProps={{ maxLength: 1000 }}
                    helperText={`${reason.length}/1000`}
                  />

                  {error && <Alert severity="error">{error}</Alert>}
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDetails}>Закрыть</Button>
          {selectedReport && !selectedReport.decision && (
            <Button
              variant="contained"
              color="error"
              onClick={handleDecide}
              disabled={submitting || !reason.trim()}
            >
              {submitting ? 'Сохранение...' : 'Применить решение'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Appeals */}
      <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', p: 2 }}>
        <Typography variant="h6" gutterBottom>Апелляции</Typography>
        {appealError && <Alert severity="error" sx={{ mb: 2 }}>{appealError}</Alert>}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Апелляция</InputLabel>
          <Select
            value={selectedAppeal ? selectedAppealId : ''}
            label="Апелляция"
            onChange={(e) => {
              const id = e.target.value as string;
              setSelectedAppealId(id);
              setAppealAction('uphold');
              setAppealNote('');
              setAppealError('');
              navigate(id ? `/admin?appeal=${encodeURIComponent(id)}` : '/admin', { replace: true });
            }}
          >
            <MenuItem value="">Выберите апелляцию</MenuItem>
            {appeals.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                @{a.user.username} — {a.reason} — {a.status === 'open' ? 'Новая' : 'Рассмотрена'} — {new Date(a.createdAt).toLocaleString('ru-RU')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {selectedAppeal && (
          <Stack spacing={2}>
            <Typography>От @{selectedAppeal.user.username} ({selectedAppeal.reason})</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selectedAppeal.text}</Typography>
            {selectedAppeal.status === 'open' ? (
              <>
                <FormControl fullWidth>
                  <InputLabel>Решение по апелляции</InputLabel>
                  <Select value={appealAction} label="Решение по апелляции" onChange={(e) => setAppealAction(e.target.value as AppealAction)}>
                    {(Object.keys(APPEAL_ACTION_LABELS) as AppealAction[]).map((act) => (
                      <MenuItem key={act} value={act}>{APPEAL_ACTION_LABELS[act]}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {appealAction === 'overturn' && (
                  <Alert severity="warning">Блокировка аккаунта будет снята, апелляция станет рассмотренной.</Alert>
                )}
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Комментарий (необязательно)"
                  value={appealNote}
                  onChange={(e) => setAppealNote(e.target.value)}
                  inputProps={{ maxLength: 1000 }}
                />
                <Box>
                  <Button variant="contained" color="error" disabled={appealSubmitting} onClick={decideAppeal}>
                    {appealSubmitting ? 'Сохранение...' : 'Применить решение'}
                  </Button>
                </Box>
              </>
            ) : (
              <Alert severity="info">
                {selectedAppeal.decision ? APPEAL_ACTION_LABELS[selectedAppeal.decision.action] : 'Рассмотрено'}
                {selectedAppeal.decision?.note ? `: ${selectedAppeal.decision.note}` : ''}
              </Alert>
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
