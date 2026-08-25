import React, { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Typography, Box } from '@mui/material';
import { Lock } from '@mui/icons-material';
import { useUserSettingsStore, hashPassword } from '../store/userSettingsStore';
import { useThemeStore } from '../store/themeStore';

const SESSION_KEY = 'vera-app-unlocked';

/**
 * Гейт по паролю. Если app-lock включён и в текущей сессии ещё не был введён
 * пароль, показываем полноэкранный оверлей с полем ввода. Разблокировка
 * держится в sessionStorage, чтобы не спрашивать пароль при HMR-перезагрузке.
 */
export default function AppLockGate({ children }: { children: React.ReactNode }) {
  const { theme } = useThemeStore();
  const enabled = useUserSettingsStore((s) => s.appLockEnabled);
  const hash = useUserSettingsStore((s) => s.appLockPasswordHash);

  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
  });
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !hash) {
      setUnlocked(true);
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch {}
    }
  }, [enabled, hash]);

  async function submit() {
    setErr(null);
    if (!pwd) { setErr('Введите пароль'); return; }
    const h = await hashPassword(pwd);
    if (h === hash) {
      setUnlocked(true);
      setPwd('');
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch {}
    } else {
      setErr('Неверный пароль');
    }
  }

  if (!enabled || !hash || unlocked) return <>{children}</>;

  return (
    <>
      {children}
      <Dialog open fullScreen
        PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
          <Lock /> Введите пароль
        </DialogTitle>
        <DialogContent>
          <Box sx={{ maxWidth: 360, mx: 'auto', mt: 6 }}>
            <Typography sx={{ color: theme.textSec, mb: 2, fontSize: 14 }}>
              VERA заблокирована. Введите пароль, чтобы продолжить.
            </Typography>
            <TextField
              autoFocus fullWidth type="password" value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              error={!!err} helperText={err || ''}
              placeholder="Пароль"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 4 }}>
          <Button variant="contained" onClick={submit}>Разблокировать</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
