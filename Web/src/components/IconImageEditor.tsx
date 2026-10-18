/**
 * Редактор картинки для слота иконки: нарисовать с нуля, загрузить фото
 * (прозрачный фон виден серой шахматкой), подвинуть/приблизить и обрезать в
 * квадрат, дорисовать поверх. На выходе — PNG data URL 128×128.
 *
 * Без библиотек: один холст-слой для рисунка + «фото в кадре», которое
 * впекается в слой кнопкой «Вписать».
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Slider, ToggleButton, ToggleButtonGroup, Alert,
} from '@mui/material';
import { Edit, Delete, Undo, Upload } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { ICON_IMAGE_SIDE, MAX_ICON_IMAGE_CHARS } from '../utils/iconPackFormat';

const SIDE = ICON_IMAGE_SIDE;
const VIEW = 256;
const MAX_UNDO = 25;

/** Серая шахматка под прозрачными пикселями. */
export const CHECKER_BG = {
  backgroundColor: '#bdbdbd',
  backgroundImage: 'linear-gradient(45deg,#8f8f8f 25%,transparent 25%,transparent 75%,#8f8f8f 75%),linear-gradient(45deg,#8f8f8f 25%,transparent 25%,transparent 75%,#8f8f8f 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

type Tool = 'brush' | 'eraser' | 'move';
interface Photo { img: HTMLImageElement; scale: number; x: number; y: number }

interface Props {
  open: boolean;
  /** Текущая картинка слота (data URL) — редактируется поверх. */
  initial?: string | null;
  onDone: (dataUrl: string) => void;
  onClose: () => void;
}

/** Холст → data URL в пределах лимита: PNG, а если велик — WebP. */
export function canvasToIconDataUrl(canvas: HTMLCanvasElement): string {
  const png = canvas.toDataURL('image/png');
  if (png.length <= MAX_ICON_IMAGE_CHARS) return png;
  const webp = canvas.toDataURL('image/webp', 0.85);
  if (webp.startsWith('data:image/webp') && webp.length <= MAX_ICON_IMAGE_CHARS) return webp;
  throw new Error('Картинка слишком сложная — упростите рисунок');
}

/**
 * Скругление углов: всё за скруглённым квадратом становится прозрачным.
 * `percent` — радиус в процентах стороны, 50 — круг. Путь строим через arcTo,
 * а не ctx.roundRect: последний есть не во всех версиях Chromium/Electron.
 */
export function applyCornerMask(ctx: CanvasRenderingContext2D, side: number, percent: number) {
  const r = Math.min(side / 2, (side * Math.max(0, percent)) / 100);
  if (r <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(side, 0, side, side, r);
  ctx.arcTo(side, side, 0, side, r);
  ctx.arcTo(0, side, 0, 0, r);
  ctx.arcTo(0, 0, side, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export default function IconImageEditor({ open, initial, onDone, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const undoRef = useRef<ImageData[]>([]);
  const strokeRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(8);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  /** Скругление углов, % стороны: 0 — квадрат, 50 — круг. */
  const [corners, setCorners] = useState(0);

  const layer = () => {
    if (!layerRef.current) {
      const c = document.createElement('canvas');
      c.width = SIDE; c.height = SIDE;
      layerRef.current = c;
    }
    return layerRef.current;
  };

  // Открытие: чистый слой либо текущая картинка слота.
  useEffect(() => {
    if (!open) return;
    const c = layer();
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, SIDE, SIDE);
    undoRef.current = [];
    setPhoto(null); setError(''); setTool('brush'); setCorners(0);
    if (initial) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, SIDE, SIDE); setTick((t) => t + 1); };
      img.src = initial;
    }
    setTick((t) => t + 1);
  }, [open, initial]);

  // Перерисовка видимого холста: слой + фото в кадре.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ctx = view.getContext('2d')!;
    ctx.clearRect(0, 0, SIDE, SIDE);
    ctx.drawImage(layer(), 0, 0);
    if (photo) {
      ctx.drawImage(photo.img, photo.x, photo.y, photo.img.naturalWidth * photo.scale, photo.img.naturalHeight * photo.scale);
    }
    // Превью скругления — та же маска, что впечётся при сохранении.
    applyCornerMask(ctx, SIDE, corners);
  }, [tick, photo, open, corners]);

  const pushUndo = () => {
    const ctx = layer().getContext('2d')!;
    undoRef.current.push(ctx.getImageData(0, 0, SIDE, SIDE));
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
  };
  const undo = () => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    layer().getContext('2d')!.putImageData(snap, 0, 0);
    setTick((t) => t + 1);
  };
  const clearAll = () => {
    pushUndo();
    layer().getContext('2d')!.clearRect(0, 0, SIDE, SIDE);
    setPhoto(null);
    setTick((t) => t + 1);
  };

  /** Координаты указателя в пикселях слоя. */
  const at = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIDE, y: ((e.clientY - r.top) / r.height) * SIDE };
  };

  const line = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = layer().getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    ctx.restore();
    setTick((t) => t + 1);
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = at(e);
    if (tool === 'move') {
      if (photo) dragRef.current = { x: p.x, y: p.y, px: photo.x, py: photo.y };
      return;
    }
    pushUndo();
    strokeRef.current = p;
    line(p, p);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = at(e);
    if (tool === 'move') {
      const d = dragRef.current;
      if (d && photo) setPhoto({ ...photo, x: d.px + (p.x - d.x), y: d.py + (p.y - d.y) });
      return;
    }
    if (!strokeRef.current) return;
    line(strokeRef.current, p);
    strokeRef.current = p;
  };
  const onUp = () => { strokeRef.current = null; dragRef.current = null; };

  const zoomPhoto = (scale: number) => {
    setPhoto((ph) => {
      if (!ph) return ph;
      const s = Math.max(0.01, Math.min(20, scale));
      // Держим центр кадра на месте.
      const cx = (SIDE / 2 - ph.x) / ph.scale;
      const cy = (SIDE / 2 - ph.y) / ph.scale;
      return { ...ph, scale: s, x: SIDE / 2 - cx * s, y: SIDE / 2 - cy * s };
    });
  };

  // Колесо в режиме «Двигать» — масштаб фото. Слушатель непассивный, иначе
  // вместе с зумом прокрутился бы диалог.
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      if (tool !== 'move' || !photo) return;
      e.preventDefault();
      zoomPhoto(photo.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const loadFile = (file: File) => {
    setError('');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setError('Подойдёт PNG, JPEG, WebP или GIF'); return; }
    if (file.size > 15 * 1024 * 1024) { setError('Файл больше 15 МБ'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Вписываем целиком (contain) по центру — дальше «Двигать» и масштаб.
      const scale = Math.min(SIDE / img.naturalWidth, SIDE / img.naturalHeight);
      setPhoto({ img, scale, x: (SIDE - img.naturalWidth * scale) / 2, y: (SIDE - img.naturalHeight * scale) / 2 });
      setTool('move');
    };
    img.onerror = () => { setError('Не удалось прочитать картинку'); URL.revokeObjectURL(url); };
    img.src = url;
  };

  const drawPhoto = (ph: Photo) => {
    layer().getContext('2d')!.drawImage(ph.img, ph.x, ph.y, ph.img.naturalWidth * ph.scale, ph.img.naturalHeight * ph.scale);
  };

  /** Впечь фото в слой: то, что за краем кадра, обрезается. */
  const bake = useCallback(() => {
    if (!photo) return;
    pushUndo();
    drawPhoto(photo);
    URL.revokeObjectURL(photo.img.src);
    setPhoto(null);
    setTool('brush');
    setTick((t) => t + 1);
  }, [photo]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    try {
      // Собираем итог на отдельном холсте: слой + фото в кадре + маска углов.
      // Сам слой не трогаем, чтобы ошибка сохранения не испортила рисунок.
      const out = document.createElement('canvas');
      out.width = SIDE; out.height = SIDE;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(layer(), 0, 0);
      if (photo) ctx.drawImage(photo.img, photo.x, photo.y, photo.img.naturalWidth * photo.scale, photo.img.naturalHeight * photo.scale);
      applyCornerMask(ctx, SIDE, corners);
      onDone(canvasToIconDataUrl(out));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить картинку');
    }
  };

  const btnSx = {
    textTransform: 'none', color: theme.text, borderColor: theme.border, gap: 0.5,
    '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
  } as const;
  const photoBase = photo ? SIDE / Math.max(photo.img.naturalWidth, photo.img.naturalHeight) : 1;


  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}` } }}>
      <DialogTitle sx={{ pb: 1 }}>Картинка иконки</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ ...CHECKER_BG, width: VIEW, height: VIEW, borderRadius: 2, overflow: 'hidden', boxShadow: `0 0 0 1px ${theme.border}` }}>
          <canvas ref={viewRef} width={SIDE} height={SIDE} aria-label="Холст иконки"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            style={{ width: VIEW, height: VIEW, display: 'block', touchAction: 'none', cursor: tool === 'move' ? 'grab' : 'crosshair' }} />
        </Box>
        <Typography sx={{ fontSize: 11, color: theme.textSec, textAlign: 'center' }}>
          Серая шахматка — прозрачный фон. Всё за краем кадра и за скруглёнными углами обрежется.
        </Typography>

        <ToggleButtonGroup exclusive size="small" value={tool} onChange={(_, v) => v && setTool(v)}>
          <ToggleButton value="brush" sx={btnSx}><Edit fontSize="small" />Кисть</ToggleButton>
          <ToggleButton value="eraser" sx={btnSx}>Ластик</ToggleButton>
          <ToggleButton value="move" sx={btnSx} disabled={!photo}>Двигать фото</ToggleButton>
        </ToggleButtonGroup>

        {tool !== 'move' ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Цвет кисти"
              disabled={tool === 'eraser'} style={{ width: 36, height: 28, border: 0, background: 'transparent', padding: 0 }} />
            <Typography id="icon-brush-size" sx={{ fontSize: 12, color: theme.textSec, whiteSpace: 'nowrap' }}>Толщина</Typography>
            <Slider size="small" min={1} max={40} value={size} onChange={(_, v) => setSize(v as number)}
              aria-labelledby="icon-brush-size" sx={{ color: theme.accent }} />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
            <Typography id="icon-photo-zoom" sx={{ fontSize: 12, color: theme.textSec, whiteSpace: 'nowrap' }}>Масштаб</Typography>
            {/* Логарифмическая шкала: 0 — фото вписано целиком. */}
            <Slider size="small" min={-2} max={3} step={0.01}
              value={photo ? Math.log(photo.scale / photoBase) : 0}
              onChange={(_, v) => zoomPhoto(Math.exp(v as number) * photoBase)}
              aria-labelledby="icon-photo-zoom" sx={{ color: theme.accent }} />
            <Button size="small" onClick={bake} sx={{ textTransform: 'none', color: theme.accent, whiteSpace: 'nowrap' }}>Обрезать</Button>
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
          <Typography id="icon-corners" sx={{ fontSize: 12, color: theme.textSec, whiteSpace: 'nowrap' }}>Скругление углов</Typography>
          <Slider size="small" min={0} max={50} step={1} value={corners}
            onChange={(_, v) => setCorners(v as number)}
            marks={[{ value: 0 }, { value: 25 }, { value: 50 }]}
            valueLabelDisplay="auto" valueLabelFormat={(v) => (v >= 50 ? 'круг' : `${v}%`)}
            aria-labelledby="icon-corners" sx={{ color: theme.accent }} />
          <Button size="small" onClick={() => setCorners(corners >= 50 ? 0 : 50)}
            sx={{ textTransform: 'none', color: theme.textSec, minWidth: 0, whiteSpace: 'nowrap' }}>
            {corners >= 50 ? 'Квадрат' : 'Круг'}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button size="small" startIcon={<Upload />} onClick={() => fileRef.current?.click()}
            sx={{ textTransform: 'none', color: theme.text }}>Загрузить фото</Button>
          <Button size="small" startIcon={<Undo />} onClick={undo} sx={{ textTransform: 'none', color: theme.text }}>Отменить</Button>
          <Button size="small" startIcon={<Delete />} onClick={clearAll} sx={{ textTransform: 'none', color: theme.textSec }}>Очистить</Button>
          <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
        </Box>
        {error && <Alert severity="error" sx={{ fontSize: 12, width: '100%' }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: theme.text }}>Отмена</Button>
        <Button variant="contained" onClick={save}
          sx={{ bgcolor: theme.accent, textTransform: 'none', '&:hover': { bgcolor: theme.accent } }}>
          Готово
        </Button>
      </DialogActions>
    </Dialog>
  );
}

