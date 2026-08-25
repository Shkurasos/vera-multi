import { useEffect, useState } from 'react';
import {
  Box, Typography, List, ListItem, ListItemText, ListItemButton, Chip, Paper,
  TextField, Button, Alert, Stack, IconButton, Divider, Snackbar,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import { useNavigate } from 'react-router-dom';
import { peer, isPeerAvailable } from '../services/peer';
import { useChatStore } from '../store/chatStore';

function buildInviteLink(pubkey: string, name?: string): string {
  const params = new URLSearchParams();
  params.set('pk', pubkey);
  if (name) params.set('name', name);
  return `vera://add?${params.toString()}`;
}

function parseInviteLink(raw: string): { pubkey: string; name?: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^vera:\/\/add\?(.+)$/i);
  if (m) {
    const params = new URLSearchParams(m[1]);
    const pk = (params.get('pk') || '').trim();
    if (!pk) return null;
    return { pubkey: pk, name: params.get('name') || undefined };
  }
  if (/^[a-zA-Z0-9_\-]{16,}$/.test(s)) return { pubkey: s };
  return null;
}


function directChatId(myPk: string, otherPk: string) {
  return [String(myPk), String(otherPk)].sort().join('|');
}

export default function ContactsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [myPk, setMyPk] = useState<string>('');
  const [myName, setMyName] = useState<string>('');
  const [inviteInput, setInviteInput] = useState('');
  const [manualPk, setManualPk] = useState('');
  const [manualName, setManualName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try { setItems(await peer.listContacts()); }
    catch (e: any) { setError(e.message); }
  }

  useEffect(() => {
    if (!isPeerAvailable()) return;
    reload();
    peer.info().then(info => {
      setMyPk(info.nostrPk || '');
      setMyName(info.profile?.username || info.name || '');
    }).catch(() => {});
  }, []);

  if (!isPeerAvailable()) {
    return <Box p={4}><Alert severity="warning">Контакты работают только в приложении Vera.</Alert></Box>;
  }

  const myLink = myPk ? buildInviteLink(myPk, myName || undefined) : '';

  async function copyText(text: string, msg: string) {
    try { await navigator.clipboard.writeText(text); setToast(msg); }
    catch { setError('Не удалось скопировать. Скопируйте вручную.'); }
  }

  async function pasteFromClipboard() {
    try { const t = await navigator.clipboard.readText(); setInviteInput(t); }
    catch { setError('Разрешите доступ к буферу или вставьте вручную (Ctrl+V).'); }
  }

  async function addAndOpen(pubkey: string, name?: string) {
    await peer.addContact({ pubkey, nodeId: pubkey, name });
    await reload();
    // Перезагружаем список чатов (peer.addContact уже создал direct-чат)
    try { await useChatStore.getState().loadChats(); } catch {}
    if (myPk) navigate('/chat/' + directChatId(myPk, pubkey));
  }

  async function handleAddByInvite() {
    setError(null);
    const parsed = parseInviteLink(inviteInput);
    if (!parsed) { setError('Не похоже на ссылку Vera. Формат: vera://add?pk=...'); return; }
    if (myPk && parsed.pubkey === myPk) { setError('Это ваша собственная ссылка.'); return; }
    setBusy(true);
    try { await addAndOpen(parsed.pubkey, parsed.name); setInviteInput(''); }
    catch (e: any) { setError(e.message || 'Не удалось добавить контакт'); }
    finally { setBusy(false); }
  }

  async function handleAddManual() {
    setError(null);
    const pk = manualPk.trim();
    if (!pk) { setError('Введите публичный ключ собеседника'); return; }
    setBusy(true);
    try { await addAndOpen(pk, manualName.trim() || undefined); setManualPk(''); setManualName(''); }
    catch (e: any) { setError(e.message || 'Не удалось добавить контакт'); }
    finally { setBusy(false); }
  }

  async function handleRemove(id: string) {
    try { await peer.removeContact(id); await reload(); }
    catch (e: any) { setError(e.message); }
  }

  return (
    <Box p={4} maxWidth={800} mx="auto">
      <Typography variant="h5" mb={2}>Контакты</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>Моя ссылка-приглашение</Typography>
        <Typography variant="body2" color="text.secondary" mb={1.5}>
          Отправьте эту ссылку другу любым способом. Когда он её вставит у себя — вы окажетесь в контактах друг у друга и откроется чат.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField size="small" fullWidth value={myLink} InputProps={{ readOnly: true }} placeholder={myPk ? '' : 'Ключ ещё не готов…'} />
          <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={() => copyText(myLink, 'Ссылка скопирована')} disabled={!myLink}>
            Скопировать
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>Добавить по ссылке друга</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField size="small" fullWidth placeholder="vera://add?pk=..." value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddByInvite(); }} />
          <Button variant="outlined" startIcon={<ContentPasteIcon />} onClick={pasteFromClipboard}>Вставить</Button>
          <Button variant="contained" onClick={handleAddByInvite} disabled={busy || !inviteInput.trim()}>
            Добавить и открыть чат
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2" color="text.secondary" mb={1.5}>
          Или вручную — введите публичный ключ и имя.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField label="Публичный ключ" value={manualPk} onChange={(e) => setManualPk(e.target.value)} size="small" fullWidth />
          <TextField label="Имя (опционально)" value={manualName} onChange={(e) => setManualName(e.target.value)} size="small" sx={{ minWidth: 200 }} />
          <Button variant="outlined" onClick={handleAddManual} disabled={busy}>Добавить</Button>
        </Stack>
      </Paper>

      <Divider sx={{ my: 2 }} />

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>Мои контакты</Typography>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Пока никого нет.</Typography>
        ) : (
          <List>
            {items.map((c) => (
              <ListItem key={c.nodeId || c.pubkey || c.id} disablePadding
                secondaryAction={<>
                  <Chip label={c.online ? 'online' : 'offline'} size="small" sx={{ mr: 1 }} />
                  <IconButton edge="end" onClick={() => handleRemove(c.nodeId || c.pubkey)}><DeleteIcon fontSize="small" /></IconButton>
                </>}>
                <ListItemButton onClick={() => navigate('/chat/' + (myPk ? directChatId(myPk, c.pubkey || c.nodeId) : (c.nodeId || c.pubkey)))}>
                  <ListItemText primary={c.name || (c.pubkey || c.nodeId || '').slice(0, 12)} secondary={c.pubkey || c.nodeId} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <Snackbar open={!!toast} autoHideDuration={2000} onClose={() => setToast(null)}
        message={toast || ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}


