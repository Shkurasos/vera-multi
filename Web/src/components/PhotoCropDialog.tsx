/**
 * Обрезка фото под обои: рамка фиксированных пропорций, картинку внутри неё
 * можно двигать мышью и приближать.
 *
 * Своего кроппера, а не библиотеки, по трём причинам: в проекте нет ни одной
 * кроп-зависимости, своя версия не тащит за собой 100+ КБ, и она умеет ровно
 * то, что нужно здесь — обрезать под соотношение сторон и отдать готовый Blob.
 * Геометрия вынесена в `cropMath.ts`, чтобы её можно было проверить тестами.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Slider, ToggleButtonGroup, ToggleButton, CircularProgress, Alert,
} from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import {
  CROP_ASPECTS, MAX_CROP_ZOOM, clampPan, clampZoom, coverZoom, cropSourceRect,
  drawnSize, frameSize, outputSize, type AspectKey, type CropSize,
} from '../utils/cropMath';

interface Props {
  open: boolean;
  /** Адрес исходника (object URL или data URL). */
  src: string;
  /** Заголовок — обычно имя файла. */
  title?: string;
  /** Готовый JPEG-блоб. Закрывать диалог должен вызывающий. */
  onDone: (blob: Blob) => void | Promise<void>;
  onClose: () => void;
}

/** Доступная под рамку область диалога. */
const BOX: CropSize = { width: 520, height: 460 };

export default function PhotoCropDialog({ open, src, title, onDone, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<CropSize | null>(null);
  const [aspect, setAspect] = useState<AspectKey>('9:16');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const frame = frameSize(
    BOX,
    CROP_ASPECTS.find((a) => a.key === aspect)?.ratio ?? null,
    natural,
  );
  const minZoom = natural ? coverZoom(natural, frame) : 1;

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Новое фото — начинаем сначала, иначе остался бы зум от прошлого снимка.
  useEffect(() => {
    if (!open) return;
    setNatural(null);
    setError('');
    reset();
  }, [src, open, reset]);

  const onLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    // Событие load иногда приходит раньше, чем React навесил ref, — особенно
    // на object URL из кэша. Тогда размеры берём прямо из события.
    const el = imgRef.current || e.currentTarget;
    if (el?.naturalWidth) setNatural({ width: el.naturalWidth, height: el.naturalHeight });
  }, []);

  const onError = useCallback(() => setError('Не удалось прочитать фото'), []);

  // Смена пропорций меняет рамку — пересобираем зум и сдвиг под неё, иначе
  // картинка на кадр уехала бы за края.
  useLayoutEffect(() => {
    if (!natural) return;
    const min = coverZoom(natural, frame);
    const nextZoom = clampZoom(zoom, min);
    setZoom(nextZoom);
    setOffset((o) => clampPan(o, drawnSize(natural, frame, nextZoom), frame));
  }, [natural, frame.width, frame.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Колесо над рамкой меняет зум. Слушатель непассивный: иначе страница
  // прокрутится под курсором и выбьет картинку из кадра.
  useEffect(() => {
    if (!open || !natural) return;
    const el = imgRef.current?.parentElement;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), minZoom));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, minZoom, natural]);

  const startDrag = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !natural) return;
    const drawn = drawnSize(natural, frame, zoom);
    setOffset(clampPan({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, drawn, frame));
  };
  const endDrag = () => { dragRef.current = null; };

  const applyZoom = (value: number) => {
    const next = clampZoom(value, minZoom);
    setZoom(next);
    if (natural) setOffset((o) => clampPan(o, drawnSize(natural, frame, next), frame));
  };

  const cut = async () => {
    const img = imgRef.current;
    if (!img || !natural || busy) return;
    setBusy(true);
    setError('');
    try {
      const rect = cropSourceRect(natural, frame, zoom, offset);
      const out = outputSize(rect);
      const canvas = document.createElement('canvas');
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Браузер не дал доступ к canvas');
      ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Не удалось сохранить обрезанное фото');
      await onDone(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обрезать фото');
    } finally {
      setBusy(false);
    }
  };

  const drawn = natural ? drawnSize(natural, frame, zoom) : null;

  return <CropLayout
    open={open}
    theme={theme}
    frame={frame}
    drawn={drawn}
    offset={offset}
    zoom={zoom}
    minZoom={minZoom}
    aspect={aspect}
    busy={busy}
    error={error}
    title={title}
    src={src}
    imgRef={imgRef}
    onLoad={onLoad}
    onError={onError}
    onPointerDown={startDrag}
    onPointerMove={onDrag}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    onAspect={(v) => { setAspect(v); setOffset({ x: 0, y: 0 }); }}
    onZoom={applyZoom}
    onReset={reset}
    onCut={cut}
    onClose={onClose}
  />;
}
/** Разметка кроппера вынесена, чтобы основной компонент оставался про логику. */
function CropLayout(p: {
  open: boolean;
  theme: any;
  frame: CropSize;
  drawn: CropSize | null;
  offset: { x: number; y: number };
  zoom: number;
  minZoom: number;
  aspect: AspectKey;
  busy: boolean;
  error: string;
  title?: string;
  src: string;
  imgRef: React.RefObject<HTMLImageElement>;
  onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  onError: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onAspect: (v: AspectKey) => void;
  onZoom: (v: number) => void;
  onReset: () => void;
  onCut: () => void;
  onClose: () => void;
}) {
  const { theme, frame, drawn, offset } = p;
  return (
    <Dialog open={p.open} onClose={p.busy ? undefined : p.onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: theme.text, pb: 1 }}>
        Обрезка фото
        {p.title ? <Typography sx={{ fontSize: 12, color: theme.textSec }} noWrap>{p.title}</Typography> : null}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
        <Box
          onPointerDown={p.onPointerDown}
          onPointerMove={p.onPointerMove}
          onPointerUp={p.onPointerUp}
          onPointerCancel={p.onPointerCancel}
          sx={{
            width: frame.width,
            height: frame.height,
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 2,
            cursor: 'grab',
            // Без этого телефон прокрутит страницу вместо сдвига картинки.
            touchAction: 'none',
            bgcolor: '#000',
            boxShadow: `0 0 0 1px ${theme.border}, 0 12px 40px rgba(0,0,0,.45)`,
            '&:active': { cursor: 'grabbing' },
          }}
        >
          {/* img рендерим ВСЕГДА, а спиннер показываем поверх, пока нет natural.
              Раньше img рисовался только при готовом `drawn`, а `drawn` появлялся
              лишь после onLoad того же img: картинка не монтировалась вовсе и
              кроппер висел на вечном спиннере. */}
          <img
            ref={p.imgRef}
            src={p.src}
            alt="Кадрируемое фото"
            onLoad={p.onLoad}
            onError={p.onError}
            draggable={false}
            style={{
              position: 'absolute',
              width: drawn ? drawn.width : 'auto',
              height: drawn ? drawn.height : 'auto',
              left: drawn ? (frame.width - drawn.width) / 2 + offset.x : '50%',
              top: drawn ? (frame.height - drawn.height) / 2 + offset.y : '50%',
              transform: drawn ? 'none' : 'translate(-50%, -50%)',
              maxWidth: 'none',
              maxHeight: 'none',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
          {!drawn && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          )}
        </Box>

        <Typography sx={{ fontSize: 12, color: theme.textSec, textAlign: 'center' }}>
          Тяните картинку мышью, колесо — приближение
        </Typography>

        <ToggleButtonGroup exclusive size="small" value={p.aspect} onChange={(_, v: AspectKey) => v && p.onAspect(v)}
          sx={{ flexWrap: 'wrap', gap: 0.5, justifyContent: 'center' }}>
          {CROP_ASPECTS.map((a) => (
            <ToggleButton key={a.key} value={a.key}
              sx={{
                textTransform: 'none', color: theme.text, borderColor: theme.border, fontSize: 12,
                '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
              }}>
              {a.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Box sx={{ width: '100%', px: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: theme.textSec, whiteSpace: 'nowrap' }}>Масштаб</Typography>
          <Slider
            size="small"
            min={p.minZoom}
            max={MAX_CROP_ZOOM}
            step={0.01}
            value={Math.max(p.minZoom, p.zoom)}
            onChange={(_, v) => p.onZoom(Array.isArray(v) ? v[0] : v)}
            sx={{ color: theme.accent }}
          />
          <Button size="small" onClick={p.onReset} sx={{ color: theme.textSec, textTransform: 'none', minWidth: 0 }}>
            Сброс
          </Button>
        </Box>

        {p.error ? <Alert severity="error" sx={{ fontSize: 12, width: '100%' }}>{p.error}</Alert> : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={p.onClose} disabled={p.busy} sx={{ color: theme.text }}>Отмена</Button>
        <Button variant="contained" onClick={p.onCut} disabled={!drawn || p.busy}
          sx={{ bgcolor: theme.accent, textTransform: 'none', '&:hover': { bgcolor: theme.accent } }}>
          {p.busy ? 'Сохраняем…' : 'Обрезать и применить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}