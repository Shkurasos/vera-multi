import React, { useMemo } from 'react';
import { Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useThemeStore, useBuiltinThemes, Theme } from '../store/themeStore';
import { useChatThemeStore } from '../store/chatThemeStore';
import { ThemeEditor } from './ThemeEditor';

interface Props {
  chatId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Редактор темы чата.
 *
 * Раньше он накрывал редактор ещё и полноэкранным Dialog, хотя тот уже
 * открывается плашкой поверх всего. Теперь слой один, а переключатель
 * «применять тему» передаётся в шапку плашки через headerExtra.
 */
export default function ChatThemeDialog({ chatId, open, onClose }: Props) {
  const { theme } = useThemeStore();
  // Встроенные темы — с правками админа (удалённые недоступны, новые видны).
  const builtinThemes = useBuiltinThemes();
  const current = useChatThemeStore((s) => (chatId ? s.themes[chatId] : undefined));
  const setChatTheme = useChatThemeStore((s) => s.setChatTheme);
  const enabled = current?.enabled !== false;

  const initialTheme = useMemo<Theme>(() => {
    const saved = current || {};
    const base = builtinThemes.find((item) => item.id === saved.sourceThemeId) || theme;
    return {
      ...base,
      ...saved,
      id: saved.id || base.id,
      name: saved.name || `${base.name} для чата`,
    };
  }, [current, theme, builtinThemes]);

  if (!open) return null;

  return (
    <ThemeEditor
      key={chatId || 'no-chat'}
      mode="chat"
      onClose={onClose}
      initialTheme={initialTheme}
      headerExtra={
        <FormControlLabel
          sx={{ mr: 0 }}
          control={
            <Checkbox
              checked={enabled}
              onChange={(event) => {
                if (!chatId) return;
                setChatTheme(chatId, { ...(current || initialTheme), enabled: event.target.checked });
              }}
            />
          }
          label={<Typography sx={{ color: theme.text, fontSize: 13 }}>Применять для этого чата</Typography>}
        />
      }
      onApply={(next) => {
        if (!chatId) return;
        setChatTheme(chatId, { ...next, enabled, sourceThemeId: next.id });
      }}
    />
  );
}