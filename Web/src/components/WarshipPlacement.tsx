import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import {
  BOARD, Cell, Ship, FLEET, key, randomFleet, shipAt,
  shipCellsAt, canPlaceShip, remainingSizes, isValidFleet,
} from '../utils/warship';

interface Props {
  /** Флот полный и честный — игрок нажал «Готово». */
  onReady: (ships: Ship[]) => void;
  /** Идёт отправка — поле и кнопки заблокированы. */
  busy?: boolean;
  readyLabel?: string;
}

/** Буквы столбцов для подписей клеток (как на бумажном поле). */
const COLS = 'АБВГДЕЖЗИК';
/** Уникальные размеры кораблей по убыванию: 4, 3, 2, 1. */
const SIZES = [...new Set(FLEET)].sort((a, b) => b - a);

/**
 * Ручная расстановка флота на поле 10×10.
 * Клик по пустой клетке ставит текущий корабль носом в эту клетку
 * (вправо — горизонтально, вниз — вертикально). Клик по стоящему кораблю
 * снимает его и берёт «в руку» с той же длиной и ориентацией.
 * Повернуть: клавиша R (К в русской раскладке), правая кнопка мыши или кнопка.
 */
export default function WarshipPlacement({ onReady, busy = false, readyLabel = 'Готово' }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const [ships, setShips] = useState<Ship[]>([]);
  const [horizontal, setHorizontal] = useState(true);
  /** Размер, выбранный в палитре; null — берём самый крупный из оставшихся. */
  const [picked, setPicked] = useState<number | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  const remaining = useMemo(() => remainingSizes(ships), [ships]);
  const size = picked !== null && remaining.includes(picked) ? picked : (remaining[0] ?? null);
  const ready = useMemo(() => isValidFleet(ships), [ships]);

  // Подсветка корабля под курсором: зелёная — можно поставить, красная — нельзя.
  const preview = useMemo(() => {
    if (!hover || size === null || shipAt(ships, hover[0], hover[1])) return null;
    const cells = shipCellsAt(hover[0], hover[1], size, horizontal);
    return { cells: new Set(cells.map(([r, c]) => key(r, c))), ok: canPlaceShip(ships, cells) };
  }, [hover, size, horizontal, ships]);

  const rotate = useCallback(() => setHorizontal((h) => !h), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['r', 'R', 'к', 'К'].includes(e.key)) { e.preventDefault(); rotate(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotate]);

  const handleCell = (r: number, c: number) => {
    if (busy) return;
    const existing = shipAt(ships, r, c);
    if (existing) {
      setShips(ships.filter((s) => s !== existing));
      setPicked(existing.cells.length);
      if (existing.cells.length > 1) setHorizontal(existing.cells[0][0] === existing.cells[1][0]);
      return;
    }
    if (size === null) return;
    const cells = shipCellsAt(r, c, size, horizontal);
    if (!canPlaceShip(ships, cells)) return;
    setShips([...ships, { cells, sunk: false }]);
    setPicked(null);
  };

  const randomize = () => { setShips(randomFleet()); setPicked(null); };
  const clear = () => { setShips([]); setPicked(null); };

  const status = size !== null
    ? `Ставим ${size}-палубный · ${horizontal ? 'горизонтально →' : 'вертикально ↓'}`
    : 'Все корабли на месте — можно начинать';

  const btnSx = { textTransform: 'none', fontSize: 12, color: theme.text, borderColor: theme.border } as const;

  return (
    <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
      {/* Поле */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'center' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text, opacity: 0.85, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Ваш флот
        </Typography>
        <Box
          aria-label="Поле расстановки кораблей"
          onMouseLeave={() => setHover(null)}
          onContextMenu={(e) => { e.preventDefault(); rotate(); }}
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${BOARD}, 26px)`,
            gridAutoRows: '26px',
            gap: '2px',
            p: '6px',
            borderRadius: 1.5,
            border: `1px solid ${theme.border}`,
            bgcolor: 'rgba(0,0,0,0.25)',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {Array.from({ length: BOARD * BOARD }, (_, i) => {
            const r = Math.floor(i / BOARD);
            const c = i % BOARD;
            const occupied = !!shipAt(ships, r, c);
            const inPreview = !!preview?.cells.has(key(r, c));
            const bg = occupied
              ? theme.accent + 'cc'
              : inPreview
                ? (preview!.ok ? 'rgba(76,175,80,0.6)' : 'rgba(224,85,69,0.55)')
                : 'rgba(40,70,100,0.35)';
            return (
              <Box
                key={i}
                component="button"
                type="button"
                disabled={busy}
                aria-label={`${COLS[c]}${r + 1}${occupied ? ', корабль — снять' : ''}`}
                onClick={() => handleCell(r, c)}
                onMouseEnter={() => setHover([r, c])}
                onFocus={() => setHover([r, c])}
                sx={{
                  width: 26, height: 26, p: 0, m: 0, borderRadius: 0.5,
                  bgcolor: bg,
                  border: `1px solid ${theme.border}`,
                  cursor: busy ? 'default' : occupied ? 'pointer' : 'crosshair',
                  transition: 'background .1s',
                  '&:focus-visible': { outline: `2px solid ${theme.accent}`, outlineOffset: 1 },
                }}
              />
            );
          })}
        </Box>
      </Box>
      {/* Управление */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 190, maxWidth: 230 }}>
        <Typography aria-live="polite" sx={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
          {status}
        </Typography>

        {/* Палитра: какие корабли остались; клик — выбрать размер */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {SIZES.map((s) => {
            const left = remaining.filter((x) => x === s).length;
            const active = size === s;
            return (
              <Box
                key={s}
                component="button"
                type="button"
                disabled={!left || busy}
                aria-pressed={active}
                aria-label={`${s}-палубный, осталось ${left}`}
                onClick={() => setPicked(s)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, p: '4px 6px',
                  borderRadius: 1, bgcolor: 'transparent', color: theme.text,
                  border: `1px solid ${active ? theme.accent : 'transparent'}`,
                  opacity: left ? 1 : 0.35,
                  cursor: left && !busy ? 'pointer' : 'default',
                  '&:focus-visible': { outline: `2px solid ${theme.accent}` },
                }}
              >
                <Box sx={{ display: 'flex', gap: '2px' }}>
                  {Array.from({ length: s }, (_, k) => (
                    <Box key={k} sx={{ width: 14, height: 14, borderRadius: 0.4, bgcolor: theme.accent + 'cc' }} />
                  ))}
                </Box>
                <Typography component="span" sx={{ fontSize: 12, ml: 'auto', opacity: 0.8 }}>× {left}</Typography>
              </Box>
            );
          })}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={rotate} disabled={busy} sx={btnSx}>↻ Повернуть (R)</Button>
          <Button size="small" variant="outlined" onClick={randomize} disabled={busy} sx={btnSx}>🎲 Случайно</Button>
          <Button size="small" variant="outlined" onClick={clear} disabled={busy || !ships.length} sx={btnSx}>Очистить</Button>
        </Box>

        <Button
          variant="contained" disabled={!ready || busy} onClick={() => onReady(ships)}
          sx={{ textTransform: 'none', fontSize: 13, bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }}
        >
          {busy ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : readyLabel}
        </Button>

        <Typography sx={{ fontSize: 11, color: theme.textSec, opacity: 0.8, lineHeight: 1.4 }}>
          Клик — поставить корабль, клик по кораблю — снять.
          Правая кнопка или R — повернуть. Корабли не должны касаться даже углами.
        </Typography>
      </Box>
    </Box>
  );
}
