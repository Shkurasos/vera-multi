import React, { useMemo, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
// Gamepad нет в mui-icons-shim (bare-импорт уходит в шим) — берём подпуть напрямую.
import Gamepad from '@mui/icons-material/Gamepad';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { warshipsApi } from '../services/api';
import WarshipGame from './WarshipGame';
import WarshipDuel from './WarshipDuel';

export interface WarshipPayload {
  type: 'vera-warship';
  sessionId: string;
  chatId: string;
  creatorId: string;
  creatorName: string;
  inviteeId: string | null;
  /** 'ai' — против компьютера, 'pvp' — дуэль 1 на 1 в личке. Старые сессии без поля — 'ai'. */
  mode: 'ai' | 'pvp';
  state: 'pending' | 'accepted' | 'finished' | 'declined';
  acceptedById?: string | null;
  acceptedByName?: string | null;
  declinedBy?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  result?: {
    winner: 'player' | 'computer'; winnerName: string; durationMs: number; shots: number;
    winnerId?: string; surrendered?: boolean;
  };
  createdAt: string;
}

function parsePayload(attachment: any): WarshipPayload | null {
  const raw = attachment?.data;
  if (!raw) return null;
  try { const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!p || p.type !== 'vera-warship') return null;
    return { type: p.type, sessionId: String(p.sessionId), chatId: String(p.chatId),
      creatorId: String(p.creatorId), creatorName: String(p.creatorName || 'Игрок'),
      inviteeId: p.inviteeId === null || p.inviteeId === undefined ? null : String(p.inviteeId),
      mode: p.mode === 'pvp' ? 'pvp' : 'ai',
      state: ['pending','accepted','finished','declined'].includes(p.state) ? p.state : 'pending',
      acceptedById: p.acceptedById === null || p.acceptedById === undefined ? null : String(p.acceptedById),
      acceptedByName: p.acceptedByName || null,
      declinedBy: p.declinedBy || null,
      startedAt: p.startedAt || null, finishedAt: p.finishedAt || null,
      result: p.result || null, createdAt: String(p.createdAt) };
  } catch { return null; }
}

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms/1000));
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
}

/** Карточка сессии морского боя внутри сообщения. */
export default function WarshipGameCard({ attachment, messageId }: { attachment: any; messageId: string }) {
  const theme = useThemeStore((s) => s.theme);
  const user = useAuthStore((s) => s.user);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const payload = useMemo(() => parsePayload(attachment), [attachment]);
  const [busy, setBusy] = useState<{ kind: string } | null>(null);
  const [gameOpen, setGameOpen] = useState(false);

  if (!payload) return null;

  const myId = user?.id;
  const isCreator = myId === payload.creatorId;
  const canRespond = !!myId && payload.state === 'pending' && (
    payload.inviteeId ? payload.inviteeId === myId : myId !== payload.creatorId
  );
  const isPvp = payload.mode === 'pvp';
  // Против ИИ играет только принявший; в дуэли — оба участника.
  const canPlay = !!myId && payload.state === 'accepted' && (
    isPvp ? myId === payload.creatorId || myId === payload.acceptedById : myId === payload.acceptedById
  );
  // После дуэли участники могут открыть поля и посмотреть итоговую расстановку.
  const canPlayFinished = !!myId && (myId === payload.creatorId || myId === payload.acceptedById);

  async function respond(nextState: 'accepted' | 'declined') {
    if (!payload) return;
    setBusy({ kind: nextState });
    try {
      const res = nextState === 'accepted'
        ? await warshipsApi.accept(messageId)
        : await warshipsApi.decline(messageId);
      updateMessage(res.data as any);
      // Принявший дуэль сразу попадает на поле.
      if (nextState === 'accepted' && isPvp) setGameOpen(true);
    } catch (e: any) {
      setBusy(null);
    } finally {
      setBusy(null);
    }
  }

  async function finishGame(result: { winner: 'player' | 'computer'; durationMs: number; shots: number }) {
    if (!payload) return;
    setBusy({ kind: 'finish' });
    try {
      const res = await warshipsApi.finish(messageId, result);
      updateMessage(res.data as any);
    } catch (e: any) {
      setBusy(null);
    } finally {
      setBusy(null);
    }
  }

  const busyKind = busy?.kind;

  return (
    <>
    <Box sx={{
      mt: 0.75, p: 1.25, borderRadius: 2,
      border: `1px solid ${theme.border}`,
      bgcolor: theme.bgHover,
      minWidth: 240, maxWidth: 340,
      display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: theme.accent + '55' }}>
          <Gamepad sx={{ color: theme.accent, fontSize: 24 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: theme.text, lineHeight: 1.3 }} noWrap>
            ⚓ Морской бой
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: theme.textSec }} noWrap>
            {isCreator ? 'Вы создали сессию' : payload.creatorName + ' создал сессию'}
          </Typography>
        </Box>
      </Box>

      {/* Статус и действия */}
      {payload.state === 'pending' && canRespond && (
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1 }}>
          <Button
            size="small" variant="contained" disabled={busyKind === 'accepted'}
            onClick={() => respond('accepted')}
            sx={{
              flex: 1, textTransform: 'none', fontSize: 13,
              bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent },
              opacity: busyKind === 'accepted' ? 0.6 : 1,
            }}
          >
            {busyKind === 'accepted' ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Принять'}
          </Button>
          <Button
            size="small" variant="outlined" disabled={busyKind === 'declined'}
            onClick={() => respond('declined')}
            sx={{
              flex: 1, textTransform: 'none', fontSize: 13,
              color: theme.textSec, borderColor: theme.border,
              opacity: busyKind === 'declined' ? 0.6 : 1,
            }}
          >
            {busyKind === 'declined' ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Отклонить'}
          </Button>
        </Box>
      )}
      {payload.state === 'pending' && !canRespond && (
        <Typography sx={{ mt: 1, fontSize: 11.5, color: theme.textSec, fontStyle: 'italic' }}>
          Ожидает ответа
        </Typography>
      )}
      {payload.state === 'accepted' && (
        <>
          <Typography sx={{ mt: 1, fontSize: 11.5, color: theme.textSec }}>
            {isPvp
              ? `Дуэль: ${payload.creatorName} против ${payload.acceptedByName || 'соперника'}.`
              : `Игра началась — ${payload.acceptedByName || 'соперник'} принимает вызов.`}
          </Typography>
          <Button
            size="small" variant="outlined" disabled={!canPlay || busyKind === 'finish'}
            onClick={() => setGameOpen(true)}
            sx={{ mt: 1, textTransform: 'none', fontSize: 13, color: theme.text, borderColor: theme.border }}
          >
            {busyKind === 'finish' ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Играть'}
          </Button>
          {canPlay && (
            <Typography sx={{ mt: 0.5, fontSize: 10.5, color: theme.textSec, opacity: 0.7 }}>
              Нажмите «Играть», чтобы открыть поле.
            </Typography>
          )}
        </>
      )}
      {payload.state === 'declined' && (
        <Typography sx={{ mt: 1, fontSize: 11.5, color: theme.textSec, fontStyle: 'italic' }}>
          Сессия отклонена.
        </Typography>
      )}
      {payload.state === 'finished' && payload.result && (
        <Box sx={{ mt: 1, p: 1, borderRadius: 1, border: `1px solid ${theme.accent}60`, bgcolor: 'rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: theme.text }}>
            🏆 Победа: {payload.result.winnerName || (payload.result.winner === 'player' ? 'Вы' : 'Компьютер')}
          </Typography>
          <Typography sx={{ fontSize: 11, color: theme.textSec }}>
            Время: {fmtMs(payload.result.durationMs)} · Выстрелов: {payload.result.shots}
            {payload.result.surrendered ? ' · соперник сдался' : ''}
          </Typography>
        </Box>
      )}
      {payload.state === 'finished' && isPvp && canPlayFinished && (
        <Button
          size="small" variant="text" onClick={() => setGameOpen(true)}
          sx={{ textTransform: 'none', fontSize: 12, color: theme.textSec, alignSelf: 'flex-start' }}
        >Смотреть результаты</Button>
      )}
      {payload.state === 'finished' && !payload.result && (
        <Typography sx={{ mt: 1, fontSize: 11.5, color: theme.textSec, fontStyle: 'italic' }}>
          Игра завершена без результата.
        </Typography>
      )}
    </Box>
    {gameOpen && isPvp && myId && (
      <WarshipDuel
        open={gameOpen}
        onClose={() => setGameOpen(false)}
        messageId={messageId}
        myId={myId}
      />
    )}
    {gameOpen && !isPvp && (
      <WarshipGame
        open={gameOpen}
        onClose={() => setGameOpen(false)}
        onFinish={finishGame}
      />
    )}
    </>
  );
}
