import React, { useMemo } from 'react';
import { Checkbox, Dialog, DialogContent, FormControlLabel, Stack, Typography } from '@mui/material';
import { useThemeStore, THEMES, Theme } from '../store/themeStore';
import { useChatThemeStore } from '../store/chatThemeStore';
import { ThemeEditor } from './ThemeEditor';

interface Props {
  chatId: string | null;
  open: boolean;
  onClose: () => void;
}

/** Полный редактор Theme, работающий только с выбранным чатом. */
export default function ChatThemeDialog({ chatId, open, onClose }: Props) {
  const { theme } = useThemeStore();
  const current = useChatThemeStore((s) => (chatId ? s.themes[chatId] : undefined));
  const setChatTheme = useChatThemeStore((s) => s.setChatTheme);
  const enabled = current?.enabled !== false;

  const initialTheme = useMemo<Theme>(() => {
    const saved = current || {};
    const base = THEMES.find((item) => item.id === saved.sourceThemeId) || theme;
    return {
      ...base,
      ...saved,
      id: saved.id || base.id,
      name: saved.name || `${base.name} для чата`,
    };
  }, [current, theme]);

  return (
    <Dialog open={open} onClose={onClose} fullScreen
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text } }}>
      <DialogContent sx={{ p: 0 }}>
        <Stack direction="row" alignItems="center" sx={{ px: 3, pt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={enabled}
                onChange={(event) => {
                  if (!chatId) return;
                  setChatTheme(chatId, { ...(current || initialTheme), enabled: event.target.checked });
                }}
              />
            }
            label={<Typography sx={{ color: theme.text }}>Применять персональную тему для этого чата</Typography>}
          />
        </Stack>
        <ThemeEditor
          key={chatId || 'no-chat'}
          onClose={onClose}
          initialTheme={initialTheme}
          onApply={(next) => {
            if (!chatId) return;
            setChatTheme(chatId, { ...next, enabled, sourceThemeId: next.id });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}