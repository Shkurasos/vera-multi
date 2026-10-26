import { Box, Button, Paper, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { useUpdateStore } from '../store/updateStore';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { applyUpdate } from '../services/appUpdate';

/**
 * Небольшая немодальная плашка «Доступно обновление».
 * «Обновить» перезагружает клиент, «Позже» прячет плашку — после этого
 * обновление остаётся доступным в настройках.
 * Цвета берутся только из палитры MUI (она уже собрана из темы).
 */
export default function UpdatePrompt({ aboveBottomNav = false }: { aboveBottomNav?: boolean }) {
  const available = useUpdateStore((s) => s.available);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const navHeight = useUiPrefsStore((s) => s.navHeight);
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('md'));

  if (!available || dismissed) return null;

  // На телефоне не перекрываем нижнюю навигацию.
  const bottom = isMobile && aboveBottomNav ? navHeight + 20 : 16;

  return (
    <Paper
      role="status"
      aria-live="polite"
      elevation={8}
      sx={{
        position: 'fixed', zIndex: 1450, bottom, right: 16,
        left: { xs: 16, sm: 'auto' }, maxWidth: { sm: 360 },
        p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5,
        bgcolor: 'background.paper', color: 'text.primary',
        border: 1, borderColor: 'divider', borderRadius: 3,
      }}
    >
      <Refresh sx={{ color: 'primary.main', flexShrink: 0 }} aria-hidden />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Доступно обновление</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Перезагрузите, чтобы получить новую версию</Typography>
      </Box>
      <Button size="small" onClick={dismiss} sx={{ color: 'text.secondary', flexShrink: 0 }}>Позже</Button>
      <Button size="small" variant="contained" onClick={applyUpdate} sx={{ flexShrink: 0 }}>Обновить</Button>
    </Paper>
  );
}
