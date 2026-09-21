import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, TextField, Button, List, ListItem, ListItemText,
  Chip, Divider, CircularProgress, Alert,
} from '@mui/material';
import { useAuthStore } from '../store/authStore';
import { adminApi, aiLmmApi } from '../services/botsApi';
import { adminApi as walletAdminApi } from '../services/api';
import { ScanResult, ProxyLogEntry, RepeaterEntry } from '../types/bots';
import ModerationPanel from '../components/ModerationPanel';

export default function AdminToolsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [scanUrl, setScanUrl] = useState('');
  const [grantUsername, setGrantUsername] = useState('');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantResult, setGrantResult] = useState<{ error: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [logs, setLogs] = useState<ProxyLogEntry[]>([]);
  const [proxyRunning, setProxyRunning] = useState(false);
  const [repeaterMethod, setRepeaterMethod] = useState('GET');
  const [repeaterUrl, setRepeaterUrl] = useState('');
  const [repeaterBody, setRepeaterBody] = useState('');
  const [repeaterResult, setRepeaterResult] = useState<any>(null);
  const [history, setHistory] = useState<RepeaterEntry[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // LLM panel
  const [llmHealth, setLlmHealth] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmPrompt, setLlmPrompt] = useState('');
  const [llmAnswer, setLlmAnswer] = useState('');
  const [llmChatLoading, setLlmChatLoading] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [trainMsg, setTrainMsg] = useState('');
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState('');
  const [learnUrl, setLearnUrl] = useState('');
  const [learnLoading, setLearnLoading] = useState(false);
  const [learnMessage, setLearnMessage] = useState('');
  const [learnError, setLearnError] = useState('');

  const loadAll = async () => {
    try { setScans((await adminApi.getScans()).data || []); } catch {}
    try { setProxyRunning((await adminApi.proxyStatus()).data?.running || false); } catch {}
    try { setLogs((await adminApi.proxyLogs(20)).data || []); } catch {}
  };

  const loadLlmHealth = async () => {
    setLlmLoading(true);
    try {
      const res = await aiLmmApi.health();
      setLlmHealth(res.data);
    } catch {
      setLlmHealth({ status: 'offline', error: 'Недоступен' });
    } finally {
      setLlmLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.isAdmin) return;
    loadAll();
    loadLlmHealth();
  }, [user?.isAdmin]);

  const handleScan = async () => {
    if (!scanUrl.trim()) return;
    setScanning(true);
    try {
      await adminApi.scan(scanUrl.trim());
      setScanUrl('');
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Ошибка сканирования');
    } finally { setScanning(false); }
  };

  const handleAnalyze = async (scanId: string) => {
    setAiLoading(true);
    try {
      await adminApi.analyzeScan(scanId);
      await loadAll();
    } catch {} finally { setAiLoading(false); }
  };

  const handlePurge = async (kind: 'chats' | 'users') => {
    const phrase = kind === 'chats' ? 'DELETE_ALL_CHATS' : 'DELETE_ALL_USERS';
    if (purgeConfirmation !== phrase) {
      setPurgeMessage(`Для подтверждения введите ${phrase}`);
      return;
    }
    if (!window.confirm(kind === 'chats' ? 'Удалить все чаты и сообщения?' : 'Удалить всех пользователей и их данные?')) return;
    setPurgeLoading(true);
    setPurgeMessage('');
    try {
      const response = kind === 'chats' ? await adminApi.deleteAllChats() : await adminApi.deleteAllUsers();
      const counts = response.data?.counts || {};
      setPurgeMessage(`Готово: пользователей ${counts.users ?? 0}, чатов ${counts.chats ?? 0}, сообщений ${counts.messages ?? 0}, файлов ${counts.files ?? 0}`);
      setPurgeConfirmation('');
    } catch (e: any) {
      setPurgeMessage(e?.response?.data?.message || 'Не удалось выполнить очистку');
    } finally { setPurgeLoading(false); }
  };

  const toggleProxy = async () => {
    try {
      if (proxyRunning) { await adminApi.stopProxy(); }
      else { await adminApi.startProxy(8080); }
      setProxyRunning((await adminApi.proxyStatus()).data?.running || false);
      await loadAll();
    } catch (e: any) { alert(e?.response?.data?.message || 'Ошибка прокси'); }
  };

  const handleRepeater = async () => {
    if (!repeaterUrl.trim()) return;
    try {
      const res = await adminApi.repeater(repeaterMethod, repeaterUrl.trim(), {}, repeaterBody);
      setRepeaterResult(res.data);
      setHistory((await adminApi.repeaterHistory()).data || []);
    } catch (e: any) { alert(e?.response?.data?.message || 'Ошибка repeater'); }
  };

  const handleLlmChat = async () => {
    if (!llmPrompt.trim()) return;
    setLlmChatLoading(true);
    setLlmAnswer('');
    try {
      const res = await aiLmmApi.chat(llmPrompt.trim());
      setLlmAnswer(res.data?.answer || 'Нет ответа');
    } catch (e: any) {
      setLlmAnswer('❌ ' + (e?.response?.data?.message || e?.message || 'Движок недоступен'));
    } finally {
      setLlmChatLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    try {
      const res = await aiLmmApi.search(searchQ.trim());
      setSearchResults(res.data?.results || []);
    } catch {
      setSearchResults([{ error: 'Поиск недоступен — запусти ai-engine' }]);
    }
  };

  const handleTrainLlm = async () => {
    setTrainMsg('⏳ Обучение запущено (может занять долго)...');
    try {
      const res = await aiLmmApi.train();
      if (res.data?.error) setTrainMsg('❌ ' + res.data.error);
      else setTrainMsg(`✅ Готово. Файлов: ${res.data?.files ?? '?'}, сэмплов: ${res.data?.samples ?? '?'}`);
    } catch (e: any) {
      setTrainMsg('❌ ' + (e?.response?.data?.message || e?.message || 'Ошибка'));
    }
  };

  const handleLearnUrl = async () => {
    const url = learnUrl.trim();
    if (!url) return;
    setLearnLoading(true);
    setLearnMessage('');
    setLearnError('');
    try {
      const res = await aiLmmApi.learnUrl(url);
      const source = res.data?.source;
      setLearnMessage(`Источник сохранён${source?.title ? `: ${source.title}` : ''}${source?.textLength ? ` (${source.textLength} символов)` : ''}.`);
      setLearnUrl('');
    } catch (e: any) {
      setLearnError(e?.response?.data?.message || e?.message || 'Не удалось загрузить страницу');
    } finally {
      setLearnLoading(false);
    }
  };

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': return 'error';
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'default';
    }
  };

  const llmOnline = llmHealth?.status === 'ok';
  if (!user?.isAdmin) return <Box sx={{ p: 4 }}><Typography>🔒 Доступ только для администратора.</Typography></Box>;

  return (
    <Box sx={{ p: 3, color: '#fff', maxWidth: 900, mx: 'auto' }}>
      <ModerationPanel />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">Панель администратора</Typography>
        <Button variant="outlined" onClick={() => navigate('/')} aria-label="Закрыть панель администратора">Закрыть (X)</Button>
      </Box>
      <Box sx={{ bgcolor: 'rgba(180,30,40,0.12)', borderRadius: 3, p: 2, mb: 3, border: '1px solid rgba(255,80,90,0.35)' }}>
        <Typography variant="h6" sx={{ color: '#ff9a9f' }}>Опасные операции</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Удаление необратимо. Полное удаление пользователей оставляет текущего администратора.
        </Typography>
        <TextField fullWidth size="small" label="Фраза подтверждения" value={purgeConfirmation} onChange={(e) => setPurgeConfirmation(e.target.value)} sx={{ mb: 1.5 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button color="error" variant="outlined" disabled={purgeLoading} onClick={() => handlePurge('chats')}>Удалить все чаты</Button>
          <Button color="error" variant="contained" disabled={purgeLoading} onClick={() => handlePurge('users')}>Удалить всех пользователей</Button>
          {purgeLoading && <CircularProgress size={24} sx={{ mt: 1 }} />}
        </Box>
        {purgeMessage && <Alert severity="info" sx={{ mt: 1.5 }}>{purgeMessage}</Alert>}
      </Box>
      <Box sx={{ p: 2, mb: 3, borderRadius: 3, border: '1px solid #ffffff22' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Выдать ВП по нику</Typography>
        <TextField fullWidth label="Ник пользователя (@username)" value={grantUsername} onChange={e => setGrantUsername(e.target.value)} sx={{ mb: 2 }} />
        <TextField fullWidth label="Количество ВП" type="number" inputProps={{ min: 1, max: 1000000, step: 1 }} value={grantAmount} onChange={e => setGrantAmount(e.target.value)} sx={{ mb: 2 }} />
        <Button variant="contained" disabled={grantBusy || !grantUsername.trim() || !Number.isSafeInteger(Number(grantAmount)) || Number(grantAmount) < 1 || Number(grantAmount) > 1000000} onClick={async () => {
          setGrantBusy(true); setGrantResult(null);
          try {
            const { data } = await walletAdminApi.grantVp(grantUsername, Number(grantAmount));
            setGrantResult({ error: false, text: `@${data.username}: начислено ${data.amount} ВП. Баланс: ${data.balance} ВП` });
            setGrantAmount('');
          } catch (e: any) {
            setGrantResult({ error: true, text: e?.response?.data?.message || 'Не удалось выдать ВП' });
          } finally { setGrantBusy(false); }
        }}>{grantBusy ? 'Начисляем…' : 'Выдать ВП'}</Button>
        {grantResult && <Alert sx={{ mt: 2 }} severity={grantResult.error ? 'error' : 'success'}>{grantResult.text}</Alert>}
      </Box>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>🛡 Admin Tools</Typography>
      <Typography sx={{ color: 'text.secondary', mb: 3 }}>
        LLM, багбаунти и доступ к ПК. Только для администраторов.
      </Typography>

      {/* ── LLM ── */}
      <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, p: 2, border: '1px solid rgba(255,255,255,0.08)', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">🧠 Локальная нейросеть (LLM)</Typography>
          <Button size="small" onClick={loadLlmHealth} disabled={llmLoading}>
            {llmLoading ? <CircularProgress size={16} /> : 'Обновить'}
          </Button>
        </Box>

        {llmHealth && (
          <Alert
            severity={llmOnline ? 'success' : 'warning'}
            sx={{ mb: 2, bgcolor: llmOnline ? 'rgba(46,125,50,0.15)' : 'rgba(237,108,2,0.15)' }}
          >
            {llmOnline ? (
              <>
                Online · {llmHealth.model || 'model'}
                {llmHealth.cuda?.available
                  ? ` · GPU: ${llmHealth.cuda.gpu || 'CUDA'}`
                  : ' · CPU'}
                {llmHealth.model_loaded ? ' · модель загружена' : ' · модель ещё не в VRAM'}
                {llmHealth.training ? ' · ⏳ идёт обучение' : ''}
              </>
            ) : (
              <>Offline. Запусти: <code>python ai-engine/server.py</code>
                {llmHealth.error ? ` (${llmHealth.error})` : ''}
              </>
            )}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField
            fullWidth size="small"
            placeholder="Вопрос к нейросети..."
            value={llmPrompt}
            onChange={(e) => setLlmPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleLlmChat()}
            disabled={!llmOnline || llmChatLoading}
          />
          <Button variant="contained" onClick={handleLlmChat} disabled={!llmOnline || llmChatLoading}>
            {llmChatLoading ? '...' : 'Спросить'}
          </Button>
        </Box>

        {llmAnswer && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'rgba(124,92,255,0.12)', p: 1.5, borderRadius: 2, mb: 2, maxHeight: 240, overflowY: 'auto' }}>
            {llmAnswer}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField
            fullWidth size="small"
            placeholder="Поиск в интернете..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            disabled={!llmOnline}
          />
          <Button variant="outlined" onClick={handleSearch} disabled={!llmOnline}>🔍</Button>
        </Box>

        {searchResults.length > 0 && (
          <List dense sx={{ mb: 1, maxHeight: 160, overflowY: 'auto' }}>
            {searchResults.map((r, i) => (
              <ListItem key={i} sx={{ py: 0.25 }}>
                <ListItemText
                  primary={<Typography variant="body2" noWrap>{r.title || r.error || '—'}</Typography>}
                  secondary={r.href || r.body || ''}
                />
              </ListItem>
            ))}
          </List>
        )}

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
          <Button variant="outlined" color="secondary" onClick={handleTrainLlm} disabled={!llmOnline}>
            🎓 Дообучить LoRA
          </Button>
          {trainMsg && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{trainMsg}</Typography>}
        </Box>

        <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.secondary' }}>
          Чат с админом: /llm, /search, /file, /list, /run, /trainllm · см. ai-engine/README.md
        </Typography>
      </Box>

      {/* Сканер */}
      <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, p: 2, border: '1px solid rgba(255,255,255,0.08)', mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>🔍 Сканер сайтов</Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField fullWidth size="small" placeholder="https://example.com" value={scanUrl}
            onChange={(e) => setScanUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} />
          <Button variant="contained" disabled={scanning} onClick={handleScan}>
            {scanning ? 'Сканирую...' : 'Сканировать'}
          </Button>
        </Box>
        <List sx={{ maxHeight: 300, overflowY: 'auto' }}>
          {scans.map((s) => (
            <Box key={s.id} sx={{ mb: 1, p: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography fontWeight={600} noWrap>{s.url}</Typography>
                <Chip label={`HTTP ${s.statusCode || 'err'}`} size="small" />
              </Box>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
                Найдено проблем: {s.findings?.length || 0} | {s.responseTimeMs || 0}мс
              </Typography>
              {s.findings?.slice(0, 3).map((f, i) => (
                <Chip key={i} size="small" color={severityColor(f.severity) as any}
                  label={`[${f.severity}] ${f.title}`} sx={{ mr: 0.5, mb: 0.5 }} />
              ))}
              <Box sx={{ mt: 1 }}>
                <Button size="small" onClick={() => handleAnalyze(s.id)} disabled={aiLoading}>
                  🧠 AI-анализ
                </Button>
              </Box>
              {s.aiAnalysis && (
                <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', bgcolor: 'rgba(124,92,255,0.1)', p: 1, borderRadius: 2 }}>
                  {s.aiAnalysis}
                </Typography>
              )}
            </Box>
          ))}
        </List>
      </Box>

      {/* Обучение Vera контекстом сайта */}
      <Box sx={{ bgcolor: 'rgba(124,92,255,0.10)', borderRadius: 3, p: 2, border: '1px solid rgba(124,92,255,0.28)', mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>📚 Знания Vera из сайта</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Укажите публичную страницу. Сервер загрузит и очистит её текст, после чего будет добавлять его в контекст ответов Vera.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            fullWidth size="small" type="url" label="URL страницы"
            placeholder="https://example.com/about"
            value={learnUrl} onChange={(e) => setLearnUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLearnUrl(); }}
            disabled={learnLoading}
          />
          <Button variant="contained" onClick={handleLearnUrl} disabled={learnLoading || !learnUrl.trim()}>
            {learnLoading ? <CircularProgress size={20} color="inherit" /> : 'Загрузить'}
          </Button>
        </Box>
        {learnMessage && <Alert severity="success" sx={{ mt: 2 }}>{learnMessage}</Alert>}
        {learnError && <Alert severity="error" sx={{ mt: 2 }}>{learnError}</Alert>}
      </Box>

      {/* Прокси */}
      <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, p: 2, border: '1px solid rgba(255,255,255,0.08)', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">🌐 Перехват трафика</Typography>
          <Button variant={proxyRunning ? 'outlined' : 'contained'} color={proxyRunning ? 'error' : 'success'} onClick={toggleProxy}>
            {proxyRunning ? 'Остановить' : 'Запустить'}
          </Button>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {proxyRunning
            ? 'Прокси запущен на 127.0.0.1:8080. Настрой браузер или инструменты на этот адрес — трафик будет перехвачен.'
            : 'Запусти прокси, чтобы перехватывать HTTP-трафик как в Burp Suite.'}
        </Typography>
        <List sx={{ maxHeight: 250, overflowY: 'auto' }}>
          {logs.map((l) => (
            <ListItem key={l.id} sx={{ py: 0.5 }}>
              <ListItemText
                primary={<Typography variant="body2" noWrap>[{l.method}] {l.url}</Typography>}
                secondary={`${l.statusCode || 'err'} | ${new Date(l.createdAt).toLocaleTimeString()}`}
              />
            </ListItem>
          ))}
          {logs.length === 0 && <ListItem><ListItemText primary="Логов пока нет" /></ListItem>}
        </List>
      </Box>

      {/* Repeater */}
      <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, p: 2, border: '1px solid rgba(255,255,255,0.08)' }}>
        <Typography variant="h6" sx={{ mb: 1 }}>🔁 Repeater</Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField size="small" sx={{ width: 100 }} value={repeaterMethod} onChange={(e) => setRepeaterMethod(e.target.value.toUpperCase())} />
          <TextField fullWidth size="small" placeholder="https://example.com/api" value={repeaterUrl} onChange={(e) => setRepeaterUrl(e.target.value)} />
          <Button variant="contained" onClick={handleRepeater}>Отправить</Button>
        </Box>
        <TextField fullWidth size="small" multiline rows={2} placeholder="Тело запроса (для POST/PUT)" value={repeaterBody} onChange={(e) => setRepeaterBody(e.target.value)} sx={{ mb: 2 }} />
        {repeaterResult && (
          <Box sx={{ bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 2, p: 1.5, mb: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              HTTP {repeaterResult.statusCode || 'err'} | {repeaterResult.responseTimeMs || 0}мс
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 1, maxHeight: 200, overflowY: 'auto' }}>
              {repeaterResult.responseBody || 'Нет ответа'}
            </Typography>
          </Box>
        )}
        {history.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>История:</Typography>
            <List dense>
              {history.slice(0, 5).map((h) => (
                <ListItem key={h.id} sx={{ py: 0 }}>
                  <ListItemText primary={<Typography variant="body2" noWrap>[{h.method}] {h.url} → {h.statusCode}</Typography>} />
                </ListItem>
              ))}
            </List>
          </>
        )}
      </Box>
    </Box>
  );
}
