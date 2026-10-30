import React, { useEffect, useState } from 'react';
import { Box, ButtonBase, ClickAwayListener, Tooltip, Typography } from '@mui/material';
import { botsApi } from '../services/botsApi';
import { openBotApp } from '../store/miniAppStore';
import type { BotCommand } from '../types/bots';
import type { Theme } from '../store/themeStore';

interface BotMenu {
  commands: BotCommand[];
  /** Подпись кнопки мини-приложения у поля ввода (/setmenubutton). */
  appButton: string | null;
}
const EMPTY: BotMenu = { commands: [], appButton: null };

// Меню бота меняется редко: держим его на время сессии, по нику.
const cache = new Map<string, Promise<BotMenu>>();

function loadMenu(username: string): Promise<BotMenu> {
  const key = username.toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = botsApi.getBot(username)
      .then((res) => ({
        commands: Array.isArray(res.data?.commands) ? res.data.commands : [],
        appButton: res.data?.menuButton?.text || null,
      }))
      .catch(() => { cache.delete(key); return EMPTY; });
    cache.set(key, pending);
  }
  return pending;
}

interface Props {
  username: string;
  /** Текущий текст поля ввода: «/…» включает подсказки. */
  text: string;
  theme: Theme;
  disabled?: boolean;
  onPick: (command: string) => void;
}

/**
 * Меню команд бота, как в Telegram: кнопка «/» слева от поля ввода и
 * подсказки над полем, когда сообщение начинается с «/».
 * Рендерится внутри строки ввода (position: relative), панель всплывает над ней.
 */
export default function BotCommandsMenu({ username, text, theme, disabled, onPick }: Props) {
  const [commands, setCommands] = useState<BotCommand[]>([]);
  const [appButton, setAppButton] = useState<string | null>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [appError, setAppError] = useState('');
  const [open, setOpen] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCommands([]);
    setAppButton(null);
    setAppError('');
    setOpen(false);
    void loadMenu(username).then((menu) => {
      if (!alive) return;
      setCommands(menu.commands);
      setAppButton(menu.appButton);
    });
    return () => { alive = false; };
  }, [username]);

  // Подсказки по набору: «/», затем начало команды без пробелов.
  const typed = /^\/[a-z0-9_]*$/i.test(text) ? text.slice(1).toLowerCase() : null;
  const typingMode = typed !== null && dismissedFor !== text;
  const visible = (open || typingMode) && !disabled;
  const list = typingMode && !open ? commands.filter((c) => c.command.startsWith(typed!)) : commands;

  if (!commands.length && !appButton) return null;

  const close = () => { setOpen(false); if (typed !== null) setDismissedFor(text); };
  const pick = (command: string) => { setOpen(false); setDismissedFor(null); onPick(command); };
  const launchApp = async () => {
    setAppError('');
    setAppBusy(true);
    try {
      await openBotApp(username);
    } catch (e: any) {
      setAppError(e?.response?.data?.message || 'Мини-приложение не открылось');
    } finally {
      setAppBusy(false);
    }
  };

  return (
    <>
      {appButton && (
        <Tooltip title={appError || 'Мини-приложение бота'}>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>
            <ButtonBase
              aria-label={`Открыть мини-приложение: ${appButton}`}
              disabled={disabled || appBusy}
              onClick={launchApp}
              sx={{
                height: 42, px: 1.6, borderRadius: 999, flexShrink: 0, maxWidth: 160,
                bgcolor: appError ? '#ff6b6b33' : theme.accent, color: appError ? '#ff6b6b' : '#fff',
                fontWeight: 700, fontSize: 14, opacity: appBusy ? 0.7 : 1,
                '&:hover': { filter: 'brightness(1.1)' },
              }}
            >
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {appButton}
              </Box>
            </ButtonBase>
          </span>
        </Tooltip>
      )}

      {commands.length > 0 && (
      <Tooltip title="Команды бота">
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <ButtonBase
            aria-label="Команды бота"
            aria-expanded={visible}
            aria-controls="bot-commands-list"
            disabled={disabled}
            onClick={() => (visible ? close() : setOpen(true))}
            sx={{
              height: 42, px: 1.4, borderRadius: 999, flexShrink: 0,
              bgcolor: visible ? theme.accent : theme.accent + '26',
              color: visible ? '#fff' : theme.accent,
              fontWeight: 700, fontSize: 14, gap: 0.5,
              transition: 'background 0.15s, color 0.15s',
              '&:hover': { bgcolor: visible ? theme.accent : theme.accent + '40' },
            }}
          >
            <Box component="span" aria-hidden sx={{ fontSize: 18, lineHeight: 1 }}>/</Box>
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Меню</Box>
          </ButtonBase>
        </span>
      </Tooltip>
      )}

      {visible && list.length > 0 && (
        <ClickAwayListener onClickAway={close}>
          <Box
            id="bot-commands-list"
            role="listbox"
            aria-label="Команды бота"
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
            sx={{
              position: 'absolute', left: { xs: 6, md: 12 }, right: { xs: 6, md: 12 }, bottom: 'calc(100% + 6px)',
              maxHeight: 280, overflowY: 'auto', zIndex: 5,
              bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 3,
              boxShadow: '0 12px 36px rgba(0,0,0,0.45)', py: 0.5,
            }}
          >
            {list.map((c) => (
              <ButtonBase
                key={c.command}
                role="option"
                aria-selected={false}
                onClick={() => pick(c.command)}
                sx={{
                  width: '100%', justifyContent: 'flex-start', gap: 1.5, px: 2, py: 1, textAlign: 'left',
                  '&:hover, &.Mui-focusVisible': { bgcolor: theme.bgHover },
                }}
              >
                <Typography sx={{ color: theme.accent, fontWeight: 600, fontSize: 14, flexShrink: 0 }}>/{c.command}</Typography>
                <Typography sx={{ color: theme.textSec, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.description}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
        </ClickAwayListener>
      )}
    </>
  );
}
