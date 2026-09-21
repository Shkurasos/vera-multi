import { useEffect, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(media.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    const done = () => { setInstalled(true); setPrompt(null); };
    update();
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    media.addEventListener('change', update);
    return () => {
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', done);
      media.removeEventListener('change', update);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    setBusy(true); setError('');
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { setError('Откройте меню браузера и выберите установку приложения.'); }
    finally { setPrompt(null); setBusy(false); }
  };
  return <Box sx={{ p: 3, mb: 3, border: '1px solid rgba(192,132,252,0.4)', borderRadius: 3 }}>
    <Typography variant="h6">VERA для Android и iPhone</Typography>
    <Typography sx={{ mb: 2 }}>Установите сайт на главный экран: он будет открываться отдельным приложением. APK и App Store не нужны.</Typography>
    {installed ? <Alert severity="success">VERA уже открыта как установленное приложение.</Alert> : <>
      {!window.isSecureContext && <Alert severity="warning">Для установки откройте сайт по HTTPS.</Alert>}
      {prompt && <Button variant="contained" disabled={busy} onClick={() => void install()} sx={{ mb: 2 }}>Установить VERA</Button>}
      <Typography><b>Android:</b> откройте сайт в Chrome → меню ⋮ → «Установить приложение» или «Добавить на главный экран».</Typography>
      <Typography sx={{ mt: 1 }}><b>iPhone / iPad:</b> откройте сайт в Safari → «Поделиться» → «На экран “Домой”» → «Добавить». Если есть переключатель «Открывать как веб-приложение», включите его.</Typography>
    </>}
    {error && <Alert severity="info">{error}</Alert>}
    <Typography variant="body2" sx={{ mt: 2 }}>На телефоне нужен доступный HTTPS-адрес сервера. localhost на телефоне — это сам телефон, не ваш компьютер. Для переписки нужен интернет; установка не добавляет фоновые звонки или push-уведомления автоматически.</Typography>
  </Box>;
}