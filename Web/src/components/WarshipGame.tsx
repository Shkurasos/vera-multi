import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, Typography, Button } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import {
  BOARD, GameState, Ship, newGame, playerFire, enemyFire,
  enemyCellState, playerCellState,
} from '../utils/warship';
import WarshipPlacement from './WarshipPlacement';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Вызывается один раз при завершении игры. winner: 'player' | 'computer'. */
  onFinish: (result: { winner: 'player' | 'computer'; durationMs: number; shots: number }) => void;
}

/** Цвета клеток по их состоянию. */
function cellColor(state: string, accent: string): { bg: string; mark: string } {
  switch (state) {
    case 'miss':  return { bg: 'rgba(120,160,200,0.18)', mark: '·' };
    case 'hit':   return { bg: '#e05545', mark: '✕' };
    case 'sunk':  return { bg: '#8b1e12', mark: '✕' };
    case 'ship':  return { bg: accent + 'cc', mark: '' };
    case 'empty': return { bg: 'rgba(40,70,100,0.35)', mark: '' };
    default:      return { bg: 'rgba(40,70,100,0.22)', mark: '' }; // hidden
  }
}

/** Одно поле 10×10 (используется и в дуэли — WarshipDuel). */
export function Grid({ state, side, onFire, disabled, label: labelOverride }: {
  state: GameState;
  side: 'player' | 'enemy';
  onFire?: (r: number, c: number) => void;
  disabled: boolean;
  label?: string;
}) {
  const theme = useThemeStore((s) => s.theme);
  const cells = useMemo(() => {
    const out: Array<Array<{ bg: string; mark: string; clickable: boolean }>> = [];
    for (let r = 0; r < BOARD; r++) {
      const row: Array<{ bg: string; mark: string; clickable: boolean }> = [];
      for (let c = 0; c < BOARD; c++) {
        const cs = side === 'enemy' ? enemyCellState(state, r, c) : playerCellState(state, r, c);
        const { bg, mark } = cellColor(cs, theme.accent);
        const clickable = side === 'enemy' && !disabled && cs === 'hidden' && state.turn === 'player' && !state.over;
        row.push({ bg, mark, clickable });
      }
      out.push(row);
    }
    return out;
  }, [state, side, theme.accent, disabled]);

  const label = labelOverride || (side === 'enemy' ? 'Флот противника' : 'Ваш флот');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'center' }}>
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text, opacity: 0.85, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${BOARD}, 26px)`,
        gridAutoRows: '26px',
        gap: '2px',
        p: '6px',
        borderRadius: 1.5,
        border: `1px solid ${theme.border}`,
        bgcolor: 'rgba(0,0,0,0.25)',
      }}>
        {cells.map((row, r) => row.map((cell, c) => (
          <Box
            key={`${r}-${c}`}
            onClick={cell.clickable ? () => onFire?.(r, c) : undefined}
            sx={{
              width: 26, height: 26, borderRadius: 0.5,
              bgcolor: cell.bg,
              border: `1px solid ${theme.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1,
              cursor: cell.clickable ? 'crosshair' : 'default',
              transition: 'background .12s, transform .08s',
              '&:hover': cell.clickable ? { transform: 'scale(1.12)', outline: `1px solid ${theme.accent}` } : {},
            }}
          >{cell.mark}</Box>
        )))}
      </Box>
    </Box>
  );
}

export default function WarshipGame({ open, onClose, onFinish }: Props) {
  const theme = useThemeStore((s) => s.theme);
  // Сначала игрок сам расставляет флот, потом бой.
  const [phase, setPhase] = useState<'placement' | 'battle'>('placement');
  const [game, setGame] = useState<GameState>(() => newGame());
  const [now, setNow] = useState(Date.now());
  const finishedRef = useRef(false);

  // Таймер партии — только во время боя.
  useEffect(() => {
    if (!open || phase !== 'battle' || game.over) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [open, phase, game.over]);

  // Ход ИИ — с небольшой задержкой, чтобы было видно смену хода.
  // Зависимость от всего game: после попадания turn остаётся 'enemy',
  // и эффект должен перезапуститься ради следующего выстрела ИИ.
  useEffect(() => {
    if (!open || phase !== 'battle' || game.over || game.turn !== 'enemy') return;
    const t = setTimeout(() => {
      setGame((g) => {
        if (g.over || g.turn !== 'enemy') return g;
        enemyFire(g);
        return { ...g };
      });
    }, 550);
    return () => clearTimeout(t);
  }, [open, phase, game]);

  // Сообщаем результат ровно один раз.
  useEffect(() => {
    if (open && phase === 'battle' && game.over && !finishedRef.current) {
      finishedRef.current = true;
      onFinish({
        winner: game.winner === 'player' ? 'player' : 'computer',
        durationMs: Date.now() - game.startedAt,
        shots: game.shotsByPlayer,
      });
    }
    if (!open) finishedRef.current = false;
  }, [open, phase, game.over, game.winner, game.shotsByPlayer, game.startedAt, onFinish]);

  const handleFire = useCallback((r: number, c: number) => {
    setGame((g) => {
      if (g.over || g.turn !== 'player') return g;
      playerFire(g, r, c);
      return { ...g };
    });
  }, []);

  // Флот расставлен — начинаем бой: свой флот игрока, случайный у ИИ.
  const startBattle = useCallback((ships: Ship[]) => {
    finishedRef.current = false;
    const t = Date.now();
    setGame(newGame(t, ships));
    setNow(t);
    setPhase('battle');
  }, []);

  // Новая партия: снова расстановка.
  const restart = useCallback(() => {
    finishedRef.current = false;
    setPhase('placement');
  }, []);

  if (!open) return null;

  const elapsed = Math.max(0, Math.floor((now - game.startedAt) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const statusText = phase === 'placement'
    ? '🛠 Расставьте свои корабли'
    : game.over
      ? (game.winner === 'player' ? '🏆 Вы победили!' : '💻 Компьютер победил')
      : game.turn === 'player'
        ? '🎯 Ваш ход — стреляйте по полю противника'
        : '🤖 Ход компьютера…';

  const overlay = (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10150,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
    >
      <div style={{
        background: theme.sidebarGradient || theme.bgSidebar,
        color: theme.text,
        border: `1px solid ${theme.border}`,
        borderRadius: 16, padding: '18px 20px',
        boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
        maxWidth: '100%', maxHeight: '96vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: '14px',
      }}>
        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>⚓ Морской бой</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {phase === 'battle' && (
              <span style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>⏱ {mm}:{ss}</span>
            )}
            <button onClick={onClose} aria-label="Закрыть" style={{ background: 'none', border: 'none', color: theme.text, fontSize: 24, cursor: 'pointer', opacity: 0.6, lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Статус */}
        <div style={{
          textAlign: 'center', fontSize: 14, fontWeight: 600,
          padding: '8px 12px', borderRadius: 8,
          background: theme.bgHover, border: `1px solid ${theme.border}`,
        }}>{statusText}</div>

        {/* Расстановка или поля боя */}
        {phase === 'placement' ? (
          <WarshipPlacement onReady={startBattle} readyLabel="⚓ В бой" />
        ) : (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Grid state={game} side="enemy" onFire={handleFire} disabled={game.turn !== 'player' || game.over} />
            <Grid state={game} side="player" disabled />
          </div>
        )}

        {/* Кнопки */}
        {phase === 'battle' && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Button
              variant="outlined"
              onClick={restart}
              sx={{ textTransform: 'none', color: theme.text, borderColor: theme.border, fontSize: 13 }}
            >🔄 Новая партия</Button>
            {game.over && (
              <Button
                variant="contained"
                onClick={onClose}
                sx={{ textTransform: 'none', bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent }, fontSize: 13 }}
              >Закрыть</Button>
            )}
          </div>
        )}

        {/* Подсказка по легенде */}
        {phase === 'battle' && (
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', fontSize: 11.5, opacity: 0.6, flexWrap: 'wrap' }}>
            <span><span style={{ color: '#e05545' }}>✕</span> попадание</span>
            <span><span style={{ opacity: 0.9 }}>·</span> промах</span>
            <span>Ваш флот показан синим</span>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}
