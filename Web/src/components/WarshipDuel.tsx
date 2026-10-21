import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, CircularProgress } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import { getSocket } from '../services/socket';
import { warshipsApi, WarshipDuelView } from '../services/api';
import { duelToGameState, Ship } from '../utils/warship';
import { Grid } from './WarshipGame';
import WarshipPlacement from './WarshipPlacement';

interface Props {
  open: boolean;
  onClose: () => void;
  /** id сообщения-сессии: по нему сервер ищет дуэль. */
  messageId: string;
  myId: string;
}

/**
 * Дуэль 1 на 1 в личном диалоге. Состояние целиком на сервере: окно
 * запрашивает свой вид (/state), стреляет через /fire и перечитывает вид
 * по сокет-событию warship:update после хода соперника.
 */
export default function WarshipDuel({ open, onClose, messageId, myId }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const [view, setView] = useState<WarshipDuelView | null>(null);
  const [error, setError] = useState('');
  const [firing, setFiring] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const res = await warshipsApi.state(messageId);
      setView(res.data);
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось загрузить игру');
    }
  }, [messageId]);

  // Первичная загрузка и подписка на ходы соперника.
  useEffect(() => {
    if (!open) return;
    void load();
    const socket = getSocket();
    if (!socket) return;
    const onUpdate = (data: { messageId?: string }) => {
      if (data?.messageId === messageId) void load();
    };
    // После переподключения сокета события могли потеряться — перечитываем.
    const onConnect = () => { void load(); };
    socket.on('warship:update', onUpdate);
    socket.on('connect', onConnect);
    return () => {
      socket.off('warship:update', onUpdate);
      socket.off('connect', onConnect);
    };
  }, [open, messageId, load]);

  // Таймер партии — только во время боя.
  useEffect(() => {
    if (!open || !view || view.over || view.phase === 'placement') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [open, view]);

  const game = useMemo(() => (view ? duelToGameState(view, myId) : null), [view, myId]);

  const handleFire = useCallback(async (r: number, c: number) => {
    if (firing) return;
    setFiring(true);
    try {
      const res = await warshipsApi.fire(messageId, r, c);
      setView(res.data.view);
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Выстрел не засчитан');
      void load();
    } finally {
      setFiring(false);
    }
  }, [firing, messageId, load]);

  // Отправить свою расстановку. Флот фиксируется на сервере; бой начнётся,
  // когда расставится и соперник (придёт warship:update).
  const [placingBusy, setPlacingBusy] = useState(false);
  const submitFleet = useCallback(async (ships: Ship[]) => {
    setPlacingBusy(true);
    try {
      const res = await warshipsApi.place(messageId, ships.map((s) => s.cells.map(([r, c]) => [r, c] as [number, number])));
      setView(res.data);
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось отправить расстановку');
      void load();
    } finally {
      setPlacingBusy(false);
    }
  }, [messageId, load]);

  const surrender = useCallback(async () => {
    if (!window.confirm('Сдаться? Победа будет засчитана сопернику.')) return;
    try {
      await warshipsApi.surrender(messageId);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось сдаться');
    }
  }, [messageId, load]);

  if (!open) return null;

  const placing = view?.phase === 'placement';
  const end = view?.finishedAt || now;
  const elapsed = view?.startedAt ? Math.max(0, Math.floor((end - view.startedAt) / 1000)) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const opponent = view?.opponentName || 'Соперник';

  const statusText = !view
    ? (error || 'Загрузка…')
    : view.over
      ? (view.winnerId === myId ? '🏆 Вы победили!' : `💥 Победил ${opponent}`)
      : placing
        ? (!view.myReady
          ? `🛠 Расставьте свои корабли${view.opponentReady ? ` — ${opponent} уже готов` : ''}`
          : `⏳ Ждём, пока ${opponent} расставит корабли…`)
        : view.myTurn
          ? '🎯 Ваш ход — стреляйте по полю соперника'
          : `⏳ Ходит ${opponent}…`;

  const overlay = (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10150,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Морской бой: дуэль"
        style={{
          background: theme.sidebarGradient || theme.bgSidebar,
          color: theme.text,
          border: `1px solid ${theme.border}`,
          borderRadius: 16, padding: '18px 20px',
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          maxWidth: '100%', maxHeight: '96vh', overflow: 'auto',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>⚔️ Дуэль: вы против {opponent}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {view && !placing && (
              <span style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>⏱ {mm}:{ss}</span>
            )}
            <button
              onClick={onClose}
              aria-label="Закрыть"
              style={{ background: 'none', border: 'none', color: theme.text, fontSize: 24, cursor: 'pointer', opacity: 0.6, lineHeight: 1 }}
            >×</button>
          </div>
        </div>

        {/* Статус */}
        <div
          aria-live="polite"
          style={{
            textAlign: 'center', fontSize: 14, fontWeight: 600,
            padding: '8px 12px', borderRadius: 8,
            background: theme.bgHover, border: `1px solid ${theme.border}`,
          }}
        >
          {statusText}
          {firing && <CircularProgress size={14} sx={{ ml: 1, color: theme.accent, verticalAlign: 'middle' }} />}
        </div>
        {view && error && (
          <div style={{ textAlign: 'center', fontSize: 12, color: '#e05545' }}>{error}</div>
        )}

        {/* Расстановка: свой флот ещё не отправлен */}
        {view && placing && !view.over && !view.myReady && (
          <WarshipPlacement onReady={submitFleet} busy={placingBusy} readyLabel="✅ Готов к бою" />
        )}

        {/* Расстановка: свой флот отправлен, ждём соперника */}
        {game && view && placing && !view.over && view.myReady && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Grid state={game} side="player" disabled label="Ваш флот · готов" />
          </div>
        )}

        {/* Поля боя */}
        {game && view && (!placing || view.over) && (
          <>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Grid
                state={game} side="enemy" onFire={handleFire}
                disabled={!view.myTurn || view.over || firing}
                label={`Флот: ${opponent} · осталось ${view.enemyShipsLeft}`}
              />
              <Grid state={game} side="player" disabled label={`Ваш флот · осталось ${view.myShipsLeft}`} />
            </div>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', fontSize: 12, opacity: 0.75 }}>
              <span>Ваших выстрелов: {view.myShotsCount}</span>
              <span>Выстрелов соперника: {view.enemyShotsCount}</span>
            </div>
          </>
        )}

        {/* Кнопки */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {view && !view.over && (
            <Button
              variant="outlined"
              onClick={surrender}
              sx={{ textTransform: 'none', color: theme.text, borderColor: theme.border, fontSize: 13 }}
            >🏳️ Сдаться</Button>
          )}
          <Button
            variant="contained"
            onClick={onClose}
            sx={{ textTransform: 'none', bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent }, fontSize: 13 }}
          >{view?.over ? 'Закрыть' : 'Свернуть'}</Button>
        </div>

        {view && !placing && (
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', fontSize: 11.5, opacity: 0.6, flexWrap: 'wrap' }}>
            <span><span style={{ color: '#e05545' }}>✕</span> попадание</span>
            <span>· промах</span>
            <span>Попал — стреляете ещё раз</span>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}
