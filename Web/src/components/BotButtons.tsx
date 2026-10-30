import React, { useState } from 'react';
import { Box, Button, CircularProgress } from '@mui/material';
import type { InlineButton, Message } from '../types';
import { botButtonsApi } from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { useMiniAppStore, APP_LINK_RE, openBotApp } from '../store/miniAppStore';

/** Адрес встроенного мини-приложения стикеров (его ставит только /hub). */
export const STICKERS_APP_URL = 'vera://stickers';

/**
 * Inline-кнопки под сообщением бота: callback_data уходит боту событием,
 * web_app открывает мини-приложение.
 */
export default function BotButtons({ message }: { message: Message }) {
  const theme = useThemeStore((s) => s.theme);
  const openMiniApp = useMiniAppStore((s) => s.open);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const rows = message.replyMarkup?.inline_keyboard || [];
  if (!rows.length) return null;

  async function press(button: InlineButton, key: string) {
    setError('');
    if (button.web_app?.url === STICKERS_APP_URL) {
      openMiniApp({ kind: 'stickers' });
      return;
    }
    setBusy(key);
    try {
      const appLink = button.web_app?.url.match(APP_LINK_RE);
      if (appLink) {
        await openBotApp(appLink[1], appLink[2]);
      } else if (button.web_app?.url) {
        const { data } = await botButtonsApi.webAppInit(message.id, button.web_app.url);
        const url = `${button.web_app.url.split('#')[0]}#vgWebAppData=${encodeURIComponent(data.initData)}`;
        openMiniApp({ kind: 'web', url, title: data.bot.name || button.text });
      } else if (button.callback_data) {
        await botButtonsApi.callback(message.id, button.callback_data);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Кнопка не сработала');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
      {rows.map((row, r) => (
        <Box key={r} sx={{ display: 'flex', gap: 0.5 }}>
          {row.map((button, c) => {
            const key = `${r}:${c}`;
            return (
              <Button
                key={key}
                size="small"
                variant="outlined"
                disabled={busy !== null}
                onClick={() => press(button, key)}
                sx={{
                  flex: 1, minWidth: 0, textTransform: 'none', fontSize: 13, lineHeight: 1.3,
                  color: theme.accent, borderColor: theme.accent + '66', bgcolor: theme.accent + '14',
                  '&:hover': { borderColor: theme.accent, bgcolor: theme.accent + '24' },
                }}
              >
                {busy === key ? <CircularProgress size={14} sx={{ color: theme.accent }} /> : button.text}
                {button.web_app && busy !== key ? ' ↗' : ''}
              </Button>
            );
          })}
        </Box>
      ))}
      {error && <Box role="alert" sx={{ fontSize: 11.5, color: '#ff6b6b' }}>{error}</Box>}
    </Box>
  );
}
