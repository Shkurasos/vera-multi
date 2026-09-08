import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Stack, Divider, Typography, Alert, Snackbar,
} from '@mui/material';
import { ContentCopy, ContentPaste } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { peer, isPeerAvailable } from '../services/peer';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useThemeStore } from '../store/themeStore';

/**
 * Самодостаточный диалог «Моя ссылка / Добавить по ссылке».
 * Используется и в Sidebar, и в SettingsDialog.
 */
export default function InviteLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { loadChats, setActiveChat } = useChatStore();
  const { theme } = useThemeStore();

  const [myPk, setMyPk] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteToast, setInviteToast] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    if (!open || !isPeerAvailable()) return;
    peer.info().then((info: any) => setMyPk(info?.nostrPk || '')).catch(() => {});
  }, [open]);

  const myInviteLink = myPk
    ? `vera://add?pk=${encodeURIComponent(myPk)}${user?.username ? `&name=${encodeURIComponent(user.username)}` : ''}`
    : '';

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

  async function copyMyInvite() {
    if (!myInviteLink) return;
    try { await navigator.clipboard.writeText(myInviteLink); setInviteToast('Ссылка скопирована'); }
    catch { setInviteError('Не удалось скопировать. Скопируйте вручную.'); }
  }

  async function pasteInvite() {
    try { const t = await navigator.clipboard.readText(); setInviteInput(t); setInviteError(null); }
    catch { setInviteError('Разрешите доступ к буферу или вставьте вручную (Ctrl+V).'); }
  }

  async function handleAddByInvite() {
    setInviteError(null);
    const parsed = parseInviteLink(inviteInput);
    if (!parsed) { setInviteError('Не похоже на ссылку Vera. Формат: vera://add?pk=...'); return; }
    if (myPk && parsed.pubkey === myPk) { setInviteError('Это ваша собственная ссылка.'); return; }
    setInviteBusy(true);
    try {
      await peer.addContact({ pubkey: parsed.pubkey, nodeId: parsed.pubkey, name: parsed.name });
      setInviteInput('');
      await loadChats();
      const chatId = myPk ? [myPk, parsed.pubkey].sort().join('|') : parsed.pubkey;
      const freshChats = useChatStore.getState().chats;
      const target = freshChats.find(c => c && c.id === chatId);
      if (target) {
        setActiveChat(target);
        navigate('/chat/' + chatId);
        onClose();
      } else {
        setInviteError('Контакт добавлен, но чат ещё не создан. Попробуйте открыть его из списка.');
      }
    } catch (e: any) {
      setInviteError(e?.message || 'Не удалось добавить контакт');
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, borderRadius: 3 } }}>
        <DialogTitle sx={{ color: theme.text, bgcolor: theme.bg, borderBottom: `1px solid ${theme.border}` }}>Моя ссылка для добавления в друзья</DialogTitle>
        <DialogContent sx={{ bgcolor: theme.bg, color: theme.text }}>
          <Typography variant="body2" sx={{ color: theme.textSec, mb: 2 }}>
            Отправьте эту ссылку другу любым способом. Когда он её вставит у себя — вы окажетесь в контактах друг у друга и откроется чат.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField
              size="small"
              fullWidth
              value={myInviteLink}
              InputProps={{ readOnly: true }}
              placeholder={myPk ? '' : 'Ключ ещё не готов…'}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: theme.text,
                  backgroundColor: theme.bgInput,
                  fontSize: 14,
                  borderRadius: 1.5,
                  '& fieldset': { borderColor: theme.border },
                  '&:hover fieldset': { borderColor: theme.textSec + '80' },
                  '&.Mui-focused fieldset': { borderColor: theme.accent },
                },
              }}
            />
            <Button
              variant="contained"
              startIcon={<ContentCopy />}
              onClick={copyMyInvite}
              disabled={!myInviteLink}
              sx={{ minWidth: 140 }}
            >
              Скопировать
            </Button>
          </Stack>

          <Divider sx={{ my: 2, borderColor: theme.border }} />

          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: theme.text }}>Добавить по ссылке друга</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField size="small" fullWidth placeholder="vera://add?pk=..." value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddByInvite(); }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: theme.text,
                  backgroundColor: theme.bgInput,
                  fontSize: 14,
                  borderRadius: 1.5,
                  '& fieldset': { borderColor: theme.border },
                  '&:hover fieldset': { borderColor: theme.textSec + '80' },
                  '&.Mui-focused fieldset': { borderColor: theme.accent },
                },
              }} />
            <Button variant="outlined" startIcon={<ContentPaste />} onClick={pasteInvite} sx={{ minWidth: 120 }}>
              Вставить
            </Button>
          </Stack>
          <Button
            fullWidth
            variant="contained"
            onClick={handleAddByInvite}
            disabled={inviteBusy || !inviteInput.trim()}
          >
            {inviteBusy ? 'Добавляем...' : 'Добавить и открыть чат'}
          </Button>
          {inviteError && <Alert severity="error" sx={{ mt: 2 }}>{inviteError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ bgcolor: theme.bg, borderTop: `1px solid ${theme.border}`, px: 3, py: 1.5 }}>
          <Button onClick={onClose}>Закрыть</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!inviteToast} autoHideDuration={2000} onClose={() => setInviteToast(null)}
        message={inviteToast || ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        ContentProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}` } }} />
    </>
  );
}
