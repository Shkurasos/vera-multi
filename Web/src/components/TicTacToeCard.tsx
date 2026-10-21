import React, { useMemo, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { ticTacToeApi } from '../services/api';

type Mark = 'X' | 'O';
interface Player { id: string; name: string }

export interface TicTacToePayload {
  type: 'vera-tictactoe';
  /** 'pvp' — 1 на 1, 'ai' — против компьютера (в «Избранном»). */
  mode: 'pvp' | 'ai';
  creatorId: string;
  creatorName: string;
  inviteeId: string | null;
  state: 'pending' | 'accepted' | 'finished' | 'declined';
  players: { X: Player; O: Player } | null;
  /** 9 клеток слева направо, сверху вниз: '' | 'X' | 'O'. */
  board: string[];
  turn: Mark | null;
  winner: Mark | 'draw' | null;
  winLine: number[] | null;
}

function parsePayload(attachment: any): TicTacToePayload | null {
  const raw = attachment?.data;
  if (!raw) return null;
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!p || p.type !== 'vera-tictactoe') return null;
    const board = Array.isArray(p.board) && p.board.length === 9
      ? p.board.map((v: unknown) => (v === 'X' || v === 'O' ? v : ''))
      : Array(9).fill('');
    return {
      type: p.type,
      mode: p.mode === 'ai' ? 'ai' : 'pvp',
      creatorId: String(p.creatorId),
      creatorName: String(p.creatorName || 'Игрок'),
      inviteeId: p.inviteeId == null ? null : String(p.inviteeId),
      state: ['pending', 'accepted', 'finished', 'declined'].includes(p.state) ? p.state : 'pending',
      players: p.players?.X && p.players?.O ? p.players : null,
      board,
      turn: p.turn === 'X' || p.turn === 'O' ? p.turn : null,
      winner: p.winner === 'X' || p.winner === 'O' || p.winner === 'draw' ? p.winner : null,
      winLine: Array.isArray(p.winLine) ? p.winLine : null,
    };
  } catch { return null; }
}

const MARK_SYMBOL: Record<Mark, string> = { X: '✕', O: '◯' };

/** Карточка партии в крестики-нолики внутри сообщения. */
export default function TicTacToeCard({ attachment, messageId }: { attachment: any; messageId: string }) {
  const theme = useThemeStore((s) => s.theme);
  const user = useAuthStore((s) => s.user);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const payload = useMemo(() => parsePayload(attachment), [attachment]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!payload) return null;

  const myId = user?.id;
  const players = payload.players;
  const myMark: Mark | null = players && myId
    ? (players.X.id === myId ? 'X' : players.O.id === myId ? 'O' : null)
    : null;
  const canRespond = !!myId && payload.state === 'pending' && (
    payload.inviteeId ? payload.inviteeId === myId : myId !== payload.creatorId
  );
  const myTurn = payload.state === 'accepted' && !!myMark && payload.turn === myMark;

  async function run(kind: string, action: () => Promise<{ data: unknown }>) {
    setBusy(kind);
    setError('');
    try {
      const res = await action();
      updateMessage(res.data as any);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  }

  const nameOf = (mark: Mark) => (players?.[mark].id === myId ? 'Вы' : players?.[mark].name || mark);

  let status = '';
  if (payload.state === 'pending') status = canRespond ? `${payload.creatorName} зовёт сыграть` : 'Ожидает ответа';
  else if (payload.state === 'declined') status = 'Вызов отклонён.';
  else if (payload.state === 'finished') {
    status = payload.winner === 'draw'
      ? 'Ничья'
      : payload.winner ? `🏆 Победа: ${nameOf(payload.winner)}` : 'Партия завершена';
  } else if (payload.turn) {
    status = myTurn
      ? `Ваш ход (${MARK_SYMBOL[payload.turn]})`
      : `Ходит ${nameOf(payload.turn)} (${MARK_SYMBOL[payload.turn]})`;
  }

  const showBoard = payload.state === 'accepted' || payload.state === 'finished';
  const winCells = new Set(payload.winLine || []);

  return (
    <Box sx={{
      mt: 0.75, p: 1.25, borderRadius: 2,
      border: `1px solid ${theme.border}`,
      bgcolor: theme.bgHover,
      minWidth: 220, maxWidth: 300,
      display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      <Box>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: theme.text, lineHeight: 1.3 }} noWrap>
          ❌⭕ Крестики-нолики
        </Typography>
        {players && (
          <Typography sx={{ fontSize: 11.5, color: theme.textSec }} noWrap>
            {MARK_SYMBOL.X} {nameOf('X')} · {MARK_SYMBOL.O} {nameOf('O')}
          </Typography>
        )}
      </Box>

      {showBoard && (
        <Box
          role="group"
          aria-label="Поле крестики-нолики"
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 54px)', gap: 0.5, alignSelf: 'center' }}
        >
          {payload.board.map((value, cell) => {
            const disabled = !myTurn || !!value || busy !== null;
            const won = winCells.has(cell);
            const label = value ? (value === 'X' ? 'крестик' : 'нолик') : 'пусто';
            return (
              <Box
                key={cell}
                component="button"
                type="button"
                disabled={disabled}
                aria-label={`Ряд ${Math.floor(cell / 3) + 1}, столбец ${(cell % 3) + 1}: ${label}`}
                onClick={() => run('move', () => ticTacToeApi.move(messageId, cell))}
                sx={{
                  width: 54, height: 54, p: 0,
                  borderRadius: 1,
                  border: `1px solid ${won ? theme.accent : theme.border}`,
                  bgcolor: won ? theme.accent + '33' : 'rgba(255,255,255,0.04)',
                  color: value === 'X' ? theme.accent : theme.text,
                  fontSize: 26, fontWeight: 700, lineHeight: 1, fontFamily: 'inherit',
                  cursor: disabled ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background-color .15s',
                  '&:hover:not(:disabled)': { bgcolor: theme.accent + '22' },
                  '&:focus-visible': { outline: `2px solid ${theme.accent}`, outlineOffset: 1 },
                }}
              >
                {value ? MARK_SYMBOL[value as Mark] : ''}
              </Box>
            );
          })}
        </Box>
      )}

      <Typography
        aria-live="polite"
        sx={{ fontSize: 12, color: theme.textSec, fontWeight: payload.state === 'finished' ? 700 : 400 }}
      >
        {busy === 'move' ? 'Ход…' : status}
      </Typography>

      {canRespond && (
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <Button
            size="small" variant="contained" disabled={busy !== null}
            onClick={() => run('accept', () => ticTacToeApi.accept(messageId))}
            sx={{ flex: 1, textTransform: 'none', fontSize: 13, bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }}
          >
            {busy === 'accept' ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Принять'}
          </Button>
          <Button
            size="small" variant="outlined" disabled={busy !== null}
            onClick={() => run('decline', () => ticTacToeApi.decline(messageId))}
            sx={{ flex: 1, textTransform: 'none', fontSize: 13, color: theme.textSec, borderColor: theme.border }}
          >
            {busy === 'decline' ? <CircularProgress size={16} sx={{ color: theme.textSec }} /> : 'Отклонить'}
          </Button>
        </Box>
      )}

      {error && (
        <Typography role="alert" sx={{ fontSize: 11.5, color: '#ff6b6b' }}>{error}</Typography>
      )}
    </Box>
  );
}
