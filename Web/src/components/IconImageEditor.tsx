/**
 * Редактор картинки для слота иконки: нарисовать с нуля, загрузить фото
 * (прозрачный фон виден серой шахматкой), подвинуть/приблизить и обрезать в
 * квадрат, дорисовать поверх. На выходе — PNG data URL 128×128.
 *
 * Без библиотек: один холст-слой для рисунка + «фото в кадре», которое
 * впекается в слой кнопкой «Обрезать». Инструменты как у холста чата
 * (кисть, маркер, карандаш, фигуры) + «Выравнивание» — карандаш, который
 * сглаживает дрожащую линию. Белый/серый фон фото убирается автоматически.
 * Логика штрихов и удаления фона — utils/iconDrawing.ts.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Slider, ToggleButton, ToggleButtonGroup, Alert, Tooltip, FormControlLabel, Switch,
} from '@mui/material';
import { Edit, Delete, Undo, Upload } from '@mui/icons-material';
// Их нет в шиме — берём подпутём (см. iconShimImports.test.cjs).
import ZoomIn from '@mui/icons-material/ZoomIn';
import ZoomOut from '@mui/icons-material/ZoomOut';
// Этих иконок нет в шиме icon-паков — берём подпутём (см. iconShimImports.test.cjs).
import Brush from '@mui/icons-material/Brush';
import BorderColor from '@mui/icons-material/BorderColor';
import Gesture from '@mui/icons-material/Gesture';
import HorizontalRule from '@mui/icons-material/HorizontalRule';
import CropSquare from '@mui/icons-material/CropSquare';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import AutoFixNormal from '@mui/icons-material/AutoFixNormal';
import AutoFixHigh from '@mui/icons-material/AutoFixHigh';
import OpenWith from '@mui/icons-material/OpenWith';
import SelectAll from '@mui/icons-material/SelectAll';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import { useThemeStore } from '../store/themeStore';
import { ICON_IMAGE_SIDE, MAX_ICON_IMAGE_CHARS } from '../utils/iconPackFormat';
import { readableTextOn } from '../utils/contrast';
import {
  type DrawTool, type IconStroke, type Point, type ShapeObj,
  isShapeTool, removeLightBackground, renderIconStroke, renderIconShape, shapeFromStroke, SMOOTH_LEVEL_LABELS,
  findShapeAt, handleAt, resized, rotated, shapeHandles,
} from '../utils/iconDrawing';

const SIDE = ICON_IMAGE_SIDE;
/** Размер холста на экране (CSS px); на узком экране — по ширине диалога. */
const VIEW = 360;
const MAX_UNDO = 25;
/** Фото обрабатываем (удаление фона) не больше этой стороны — быстро и хватает для 128×128. */
const MAX_PHOTO_SIDE = 1024;

type Tool = DrawTool | 'move' | 'select';

/** Масштаб холста на экране: от 0.5× до 8×. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 8;
/** Допуск попадания в фигуру / ручку в пикселях экрана (растёт с зумом). */
const HIT_SCREEN = 7;

const TOOLS: Array<{ value: Tool; label: string; icon: React.ReactNode }> = [
  { value: 'select', label: 'Выделение — щёлкните фигуру, чтобы подвинуть, повернуть и растянуть её', icon: <SelectAll fontSize="small" /> },
  { value: 'brush', label: 'Кисть', icon: <Brush fontSize="small" /> },
  { value: 'marker', label: 'Маркер — полупрозрачный', icon: <BorderColor fontSize="small" /> },
  { value: 'pencil', label: 'Карандаш — тонкая линия', icon: <Edit fontSize="small" /> },
  { value: 'smooth', label: 'Выравнивание — карандаш, сглаживающий линию', icon: <Gesture fontSize="small" /> },
  { value: 'line', label: 'Линия', icon: <HorizontalRule fontSize="small" /> },
  { value: 'rectangle', label: 'Прямоугольник', icon: <CropSquare fontSize="small" /> },
  { value: 'circle', label: 'Круг', icon: <RadioButtonUnchecked fontSize="small" /> },
  { value: 'eraser', label: 'Ластик', icon: <AutoFixNormal fontSize="small" /> },
];

/** Копия картинки на холсте (≤ MAX_PHOTO_SIDE), по желанию — без светлого фона. */
function photoCanvas(source: CanvasImageSource, w: number, h: number, removeBg: boolean): HTMLCanvasElement {
  const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  if (removeBg) {
    const d = ctx.getImageData(0, 0, c.width, c.height);
    removeLightBackground(d.data, c.width, c.height);
    ctx.putImageData(d, 0, 0);
  }
  return c;
}

/** Серая шахматка под прозрачными пикселями. */
export const CHECKER_BG = {
  backgroundColor: '#bdbdbd',
  backgroundImage: 'linear-gradient(45deg,#8f8f8f 25%,transparent 25%,transparent 75%,#8f8f8f 75%),linear-gradient(45deg,#8f8f8f 25%,transparent 25%,transparent 75%,#8f8f8f 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

/**
 * Фото в кадре. `img` — обработанная копия (с удалённым фоном или без),
 * `source` — исходник, чтобы переключатель «Убрать фон» можно было снять.
 * Размер `img` от переключателя не зависит, поэтому scale/x/y сохраняются.
 */
interface Photo {
  source: HTMLImageElement; url: string;
  img: HTMLCanvasElement; scale: number; x: number; y: number;
}

interface Props {
  open: boolean;
  /** Текущая картинка слота (data URL) — редактируется поверх. */
  initial?: string | null;
  onDone: (dataUrl: string) => void;
  onClose: () => void;
}

/**
 * Что происходит с указателем: двигаем фигуру / тянем её ручку / крутим,
 * сдвигаем фото, панорамируем холст — или это обычный штрих (без dragRef).
 * `ox/oy` и `shape0` — состояние в момент взятия, чтобы не накапливать ошибку.
 */
type DragState =
  | { mode: 'shape'; idx: number; ox: number; oy: number; shape0: ShapeObj }
  | { mode: 'handle'; idx: number; ox: number; oy: number; shape0: ShapeObj; handle: { kx: number; ky: number }; keep: 'both' | 'x' | 'y' }
  | { mode: 'rot'; idx: number; ox: number; oy: number; shape0: ShapeObj; angle0: number }
  | { mode: 'photo'; ox: number; oy: number; px: number; py: number }
  | { mode: 'pan'; px: number; py: number };

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
  const undoRef = useRef<Array<{ layer: ImageData; shapes: ShapeObj[] }>>([]);
  /** Текущий штрих и снимок слоя до него: штрих перерисовывается целиком. */
  const strokeRef = useRef<{ stroke: IconStroke; base: ImageData } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(8);
  /** Сила «Выравнивания», 1–5. */
  const [smoothLevel, setSmoothLevel] = useState(3);
  const [photo, setPhoto] = useState<Photo | null>(null);
  /** Убирать белый/серый фон у загруженного фото. */
  const [removeBg, setRemoveBg] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  /** Скругление углов, % стороны: 0 — квадрат, 50 — круг. */
  const [corners, setCorners] = useState(0);
  /** Подвижные фигуры (линии, прямоугольники, круги) — живут над слоем. */
  const [shapes, setShapes] = useState<ShapeObj[]>([]);
  /** Индекс выделенной фигуры; -1 — ничего не выделено. */
  const [sel, setSel] = useState(-1);
  /** Масштаб холста на экране и центр взгляда в пикселях слоя. */
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: SIDE / 2, y: SIDE / 2 });
  /** Пока идёт тянуть/поворот, остальные фигуры гаснут — видно, что правим. */
  const [editingShape, setEditingShape] = useState(false);

  const layer = () => {
    if (!layerRef.current) {
      const c = document.createElement('canvas');
      c.width = SIDE; c.height = SIDE;
      layerRef.current = c;
    }
    return layerRef.current;
  };
  const layerCtx = () => layer().getContext('2d', { willReadFrequently: true })!;
  const redraw = () => setTick((t) => t + 1);

  // Открытие: чистый слой либо текущая картинка слота.
  useEffect(() => {
    if (!open) return;
    const ctx = layerCtx();
    ctx.clearRect(0, 0, SIDE, SIDE);
    undoRef.current = [];
    strokeRef.current = null;
    dragRef.current = null;
    setPhoto(null); setError(''); setTool('brush'); setCorners(0);
    setShapes([]); setSel(-1); setEditingShape(false);
    setZoom(1); setCenter({ x: SIDE / 2, y: SIDE / 2 });
    if (initial) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, SIDE, SIDE); redraw(); };
      img.src = initial;
    }
    redraw();
  }, [open, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Перерисовка видимого холста: слой + фото в кадре + подвижные фигуры +
   * рамка выделения. Холст показывается увеличенным (zoom) со сдвигом на
   * `center` — это и есть приближение.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ctx = view.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.save();
    // Масштаб: центр картинки сидит в центре окна, дальше сдвигаем на `center`.
    ctx.translate(view.width / 2, view.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-center.x, -center.y);
    ctx.drawImage(layer(), 0, 0);
    if (photo) ctx.drawImage(photo.img, photo.x, photo.y, photo.img.width * photo.scale, photo.img.height * photo.scale);
    // Фигуры: при правке остальные гаснут, чтобы выделенная читалась.
    ctx.globalAlpha = editingShape ? 0.35 : 1;
    shapes.forEach((s, i) => { if (i !== sel || !editingShape) renderIconShape(ctx, s); });
    ctx.globalAlpha = 1;
    // Превью скругления — та же маска, что впечётся при сохранении.
    applyCornerMask(ctx, SIDE, corners);
    const cur = sel >= 0 ? shapes[sel] : null;
    if (cur) {
      if (editingShape) renderIconShape(ctx, cur);
      // Рамка и ручки в системе координат фигуры — обводка ложится ровно по фигуре.
      ctx.save();
      ctx.translate(cur.cx, cur.cy);
      ctx.rotate(cur.angle);
      const stroke = Math.max(1, cur.width / zoom);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeRect(-cur.hw, -cur.hh, cur.hw * 2, cur.hh * 2);
      ctx.setLineDash([]);
      const h = 7 / zoom;
      for (const hk of shapeHandles(cur)) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(hk.kx * cur.hw - h / 2, hk.ky * cur.hh - h / 2, h, h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1 / zoom;
        ctx.strokeRect(hk.kx * cur.hw - h / 2, hk.ky * cur.hh - h / 2, h, h);
      }
      // Ручка поворота — над верхней стороной, тянется по кругу.
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.moveTo(0, -cur.hh - stroke / 2);
      ctx.lineTo(0, -cur.hh - 14 / zoom);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -cur.hh - 14 / zoom, 5 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }, [tick, photo, open, corners, zoom, center, shapes, sel, editingShape]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Шаг undo: снимок слоя и подвижных фигур — вместе, чтобы отменять и то и другое. */
  const pushUndo = () => {
    undoRef.current.push({ layer: layerCtx().getImageData(0, 0, SIDE, SIDE), shapes });
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
  };
  const undo = () => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    layerCtx().putImageData(snap.layer, 0, 0);
    setShapes(snap.shapes);
    setSel((i) => (i >= 0 && i < snap.shapes.length ? i : -1));
    redraw();
  };
  const clearAll = () => {
    pushUndo();
    layerCtx().clearRect(0, 0, SIDE, SIDE);
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setShapes([]); setSel(-1);
    if (tool === 'move' || tool === 'select') setTool('brush');
    redraw();
  };

  /**
   * Координаты указателя в пикселях слоя (SIDE×SIDE): экран → слой с учётом
   * зума и сдвига. Доля от CSS-размера холста умножается на SIDE, а не на
   * экранную ширину: холст на экране 360 px, а слой 128 px — раньше точки
   * уезжали за край, и выделение «не попадало» в фигуры.
   */
  const at = (e: React.PointerEvent): Point => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width - 0.5;
    const sy = (e.clientY - r.top) / r.height - 0.5;
    return { x: center.x + (sx * SIDE) / zoom, y: center.y + (sy * SIDE) / zoom };
  };

  /** Допуск попадания в пикселях слоя: ~HIT_SCREEN px экрана при любом зуме. */
  const hitTol = () => {
    const w = viewRef.current?.getBoundingClientRect().width || VIEW;
    return (HIT_SCREEN * SIDE) / (w * zoom);
  };

  /** Правка фигуры по индексу (замена или преобразование). */
  const updateShape = (i: number, fn: (s: ShapeObj) => ShapeObj) =>
    setShapes((prev) => prev.map((s, j) => (j === i ? fn(s) : s)));

  /** Отпустить фигуру: правка закончена, снимаем подсветку. */
  const endShapeEdit = () => { setEditingShape(false); dragRef.current = null; };

  /**
   * Впечь подвижные фигуры в слой. Зовётся перед свободным рисованием,
   * «Обрезать» и «Убрать фон»: иначе ластик и кисть шли бы ПОД фигурами.
   * Undo-шаг делает вызывающий код (снимок до впекания).
   */
  const flattenShapes = () => {
    if (!shapes.length) return;
    const ctx = layerCtx();
    for (const s of shapes) renderIconShape(ctx, s);
    setShapes([]);
    setSel(-1);
  };

  /** Слой = снимок до штриха + штрих целиком (маркер не копит альфу, фигуры тянутся). */
  const paintStroke = () => {
    const cur = strokeRef.current;
    if (!cur) return;
    const ctx = layerCtx();
    ctx.putImageData(cur.base, 0, 0);
    renderIconStroke(ctx, cur.stroke);
    redraw();
  };

  /**
   * Завершить штрих. Фигура (линия, прямоугольник, круг) НЕ остаётся в слое:
   * слой возвращается к снимку до штриха, а фигура становится подвижным
   * объектом поверх — её можно выделить, двигать, крутить и растягивать.
   * Раньше фигура оставалась и в слое, и объектом: после сдвига на старом
   * месте висела копия.
   */
  const commitStroke = (stroke: IconStroke, base: ImageData) => {
    const next = isShapeTool(stroke.tool) ? shapeFromStroke(stroke) : null;
    if (next && (next.hw > 0.5 || next.hh > 0.5)) {
      layerCtx().putImageData(base, 0, 0);
      setShapes((prev) => [...prev, next]);
      setSel(shapes.length);
      setEditingShape(false);
      setTool('select');
    } else if (isShapeTool(stroke.tool)) {
      // Просто щелчок фигурой — пустая фигура не нужна.
      layerCtx().putImageData(base, 0, 0);
      undoRef.current.pop();
    }
    redraw();
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = at(e);
    // Рисование: слой замораживается до старта штриха, дальше перерисовка целиком.
    if (tool !== 'move' && tool !== 'select') {
      if (strokeRef.current) return; // второй палец во время штриха
      pushUndo();
      // Кисть и ластик работают по слою — фигуры сперва впекаются, иначе
      // стёртое оказалось бы под ними. Новая фигура соседей не трогает.
      if (!isShapeTool(tool as DrawTool)) flattenShapes();
      setSel(-1);
      strokeRef.current = {
        base: layerCtx().getImageData(0, 0, SIDE, SIDE),
        stroke: { tool: tool as DrawTool, color, width: size, points: [p], smoothLevel },
      };
      paintStroke();
      return;
    }
    const hit = sel >= 0 ? shapes[sel] : null;
    const tol = hitTol();
    // Ручка поворота: тянется по кругу от начала.
    if (hit && tool === 'select') {
      const rotPos = rotHandlePos(hit);
      if (Math.hypot(p.x - rotPos.x, p.y - rotPos.y) <= Math.max(tol, 6 / zoom)) {
        pushUndo();
        // Запоминаем разницу «угол фигуры − угол ручки»: дальше новый угол =
        // разница + текущий угол указателя. Раньше знак был наоборот, и
        // поворот сразу перескакивал на 180°, а подпись угла врала.
        dragRef.current = { mode: 'rot', idx: sel, ox: 0, oy: 0, angle0: hit.angle - Math.atan2(p.y - hit.cy, p.x - hit.cx), shape0: hit };
        setEditingShape(true);
        return;
      }
      // Ручка размера: держим прежнюю полуось, чтобы поворот не дёргался.
      const handle = handleAt(p, hit, Math.max(tol, 6 / zoom));
      if (handle) {
        pushUndo();
        dragRef.current = { mode: 'handle', idx: sel, ox: 0, oy: 0, shape0: hit, handle, keep: 'both' as const };
        setEditingShape(true);
        return;
      }
    }
    if (tool === 'select') {
      // Щелчок по фигуре — выделить и двигать; мимо — снять выделение.
      const idx = findShapeAt(p, shapes, tol);
      if (idx >= 0) {
        pushUndo();
        setSel(idx);
        dragRef.current = { mode: 'shape', idx, ox: p.x - shapes[idx].cx, oy: p.y - shapes[idx].cy, shape0: shapes[idx] };
        setEditingShape(true);
        return;
      }
      setSel(-1);
    }
    if (tool === 'move') {
      if (photo) dragRef.current = { mode: 'photo', ox: photo.x, oy: photo.y, px: p.x, py: p.y };
      else dragRef.current = { mode: 'pan', px: p.x, py: p.y };
      return;
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = at(e);
    const d = dragRef.current;
    if (d) {
      if (d.mode === 'shape') {
        // Фигура двигается относительно того, где она была в момент взята.
        updateShape(d.idx, (s) => ({ ...s, cx: p.x - d.ox, cy: p.y - d.oy }));
        return;
      }
      if (d.mode === 'handle' && d.handle) {
        const keep: 'both' | 'x' | 'y' = d.handle.kx === 0 ? 'y' : d.handle.ky === 0 ? 'x' : 'both';
        updateShape(d.idx, (s) => resized(s, d.handle, p, keep));
        return;
      }
      if (d.mode === 'rot') {
        const ang = Math.atan2(p.y - d.shape0.cy, p.x - d.shape0.cx);
        updateShape(d.idx, (s) => rotated(s, d.angle0 + ang));
        return;
      }
      if (d.mode === 'photo' && photo) {
        setPhoto({ ...photo, x: d.ox + (p.x - d.px), y: d.oy + (p.y - d.py) });
        return;
      }
      if (d.mode === 'pan') {
        // Смотрим на другой край холста (движение строго обратное сдвигу взгляда).
        setCenter((c) => ({ x: c.x - (p.x - d.px), y: c.y - (p.y - d.py) }));
        d.px = p.x; d.py = p.y;
        return;
      }
    }
    if (tool === 'move') {
      if (photo) dragRef.current = { mode: 'photo', ox: photo.x, oy: photo.y, px: p.x, py: p.y };
      return;
    }
    const cur = strokeRef.current;
    if (!cur) return;
    const pts = cur.stroke.points;
    if (isShapeTool(cur.stroke.tool)) {
      cur.stroke.points = [pts[0], p];
    } else {
      // Субпиксельные дубли ничего не меняют, только утяжеляют перерисовку.
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.3) return;
      pts.push(p);
    }
    paintStroke();
  };
  const onUp = () => {
    const cur = strokeRef.current;
    strokeRef.current = null;
    if (cur) commitStroke(cur.stroke, cur.base);
    endShapeEdit();
    dragRef.current = null;
  };

  /**
   * Позиция ручки поворота — над верхней стороной фигуры, в системе слоя.
   * Должна совпадать с тем, где ручка нарисована: (0, -hh - 14/zoom) в
   * системе фигуры. Раньше знак был перевёрнут — ручка ловилась под фигурой.
   */
  const rotHandlePos = (s: ShapeObj): Point => {
    const c = Math.cos(s.angle);
    const sn = Math.sin(s.angle);
    const off = s.hh + 14 / zoom;
    return { x: s.cx + off * sn, y: s.cy - off * c };
  };


  const zoomPhoto = (scale: number) => {
    setPhoto((ph) => {
      if (!ph) return ph;
      const s = Math.max(0.01, Math.min(40, scale));
      // Держим центр кадра на месте.
      const cx = (SIDE / 2 - ph.x) / ph.scale;
      const cy = (SIDE / 2 - ph.y) / ph.scale;
      return { ...ph, scale: s, x: SIDE / 2 - cx * s, y: SIDE / 2 - cy * s };
    });
  };

  // Колесо: при приближении — зум холста (в любом режиме), в режиме «Двигать»
  // сначала масштабируется само фото. Слушатель непассивный, иначе вместе с
  // зумом прокрутился бы диалог.
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      if (tool === 'move' && photo) { zoomPhoto(photo.scale * k); return; }
      setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * k)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const loadFile = (file: File) => {
    setError('');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setError('Подойдёт PNG, JPEG, WebP или GIF'); return; }
    if (file.size > 15 * 1024 * 1024) { setError('Файл больше 15 МБ'); return; }
    const url = URL.createObjectURL(file);
    const source = new Image();
    source.onload = () => {
      try {
        const img = photoCanvas(source, source.naturalWidth, source.naturalHeight, removeBg);
        // Вписываем целиком (contain) по центру — дальше «Двигать» и масштаб.
        const scale = Math.min(SIDE / img.width, SIDE / img.height);
        if (photo) URL.revokeObjectURL(photo.url);
        setPhoto({ source, url, img, scale, x: (SIDE - img.width * scale) / 2, y: (SIDE - img.height * scale) / 2 });
        setTool('move');
      } catch {
        setError('Не удалось обработать картинку');
        URL.revokeObjectURL(url);
      }
    };
    source.onerror = () => { setError('Не удалось прочитать картинку'); URL.revokeObjectURL(url); };
    source.src = url;
  };

  /** Переключатель «Убрать фон»: пересобираем копию фото, кадр не сдвигается. */
  const toggleRemoveBg = (on: boolean) => {
    setRemoveBg(on);
    setPhoto((ph) => (ph
      ? { ...ph, img: photoCanvas(ph.source, ph.source.naturalWidth, ph.source.naturalHeight, on) }
      : ph));
  };

  /**
   * Убрать светлый фон у того, что уже впечено в слой (например, у картинки
   * слота, сохранённой раньше с белым фоном).
   */
  const removeLayerBg = () => {
    pushUndo();
    // Подвижные фигуры не трогаем: кисть по умолчанию белая, и белый
    // прямоугольник ушёл бы вместе с «фоном».
    const ctx = layerCtx();
    const d = ctx.getImageData(0, 0, SIDE, SIDE);
    if (!removeLightBackground(d.data, SIDE, SIDE)) {
      undoRef.current.pop();
      setError('Светлого фона по краям не нашлось');
      return;
    }
    setError('');
    ctx.putImageData(d, 0, 0);
    redraw();
  };

  const drawPhoto = (ctx: CanvasRenderingContext2D, ph: Photo) => {
    ctx.drawImage(ph.img, ph.x, ph.y, ph.img.width * ph.scale, ph.img.height * ph.scale);
  };

  /** Впечь фото в слой: то, что за краем кадра, обрезается. */
  const bake = useCallback(() => {
    if (!photo) return;
    pushUndo();
    // Фото ложится в слой, а фигуры были НАД ним — впекаем их следом, чтобы
    // порядок слоёв не поменялся.
    drawPhoto(layerCtx(), photo);
    flattenShapes();
    URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setTool('brush');
    redraw();
  }, [photo, shapes]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    try {
      // Собираем итог на отдельном холсте: слой + фото в кадре + фигуры +
      // маска углов. Сам слой не трогаем, чтобы ошибка сохранения не
      // испортила рисунок.
      const out = document.createElement('canvas');
      out.width = SIDE; out.height = SIDE;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(layer(), 0, 0);
      if (photo) drawPhoto(ctx, photo);
      for (const s of shapes) renderIconShape(ctx, s);
      applyCornerMask(ctx, SIDE, corners);
      onDone(canvasToIconDataUrl(out));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить картинку');
    }
  };

  const btnSx = {
    textTransform: 'none', color: theme.text, borderColor: theme.border, gap: 0.5,
    '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
    '&.Mui-selected:hover': { bgcolor: theme.accent + '35' },
  } as const;
  const photoBase = photo ? SIDE / Math.max(photo.img.width, photo.img.height) : 1;
  const labelSx = { fontSize: 12, color: theme.textSec, whiteSpace: 'nowrap', minWidth: 110 } as const;
  const rowSx = { display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' } as const;
  const drawing = tool !== 'move' && tool !== 'select';
  const curShape = tool === 'select' && sel >= 0 ? shapes[sel] : null;
  /** Угол поворота в градусах — для ползунка. */
  const curDeg = curShape ? Math.round(((curShape.angle * 180) / Math.PI + 180) % 360 - 180) : 0;


  /** Поворот фигуры ползунком (градусы вокруг центра). */
  const setShapeDeg = (deg: number) => {
    if (sel < 0) return;
    updateShape(sel, (s) => rotated(s, (deg * Math.PI) / 180));
  };
  const nudge = (dx: number, dy: number) => {
    if (sel < 0) return;
    updateShape(sel, (s) => ({ ...s, cx: s.cx + dx, cy: s.cy + dy }));
  };
  const deleteSel = () => {
    if (sel < 0) return;
    pushUndo();
    setShapes((prev) => prev.filter((_, i) => i !== sel));
    setSel(-1);
  };

  // Клавиатура: удалить фигуру, сдвиг стрелками, поворот [.]. Работает, пока
  // открыт диалог, режим — выделение и фокус не в поле ввода.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (tool !== 'select' || sel < 0) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'Delete' || e.key === 'Backspace') { deleteSel(); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft') { pushUndo(); nudge(-step, 0); e.preventDefault(); return; }
      if (e.key === 'ArrowRight') { pushUndo(); nudge(step, 0); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { pushUndo(); nudge(0, -step); e.preventDefault(); return; }
      if (e.key === 'ArrowDown') { pushUndo(); nudge(0, step); e.preventDefault(); return; }
      if (e.key === '[') { pushUndo(); setShapeDeg(curDeg - 5); e.preventDefault(); return; }
      if (e.key === ']') { pushUndo(); setShapeDeg(curDeg + 5); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomRow = (
    <Box sx={rowSx}>
      <Typography id="icon-zoom" sx={labelSx}>Приближение</Typography>
      <Button size="small" aria-label="Отдалить" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.3))}
        sx={{ textTransform: 'none', color: theme.text, minWidth: 0, px: 1 }}><ZoomOut fontSize="small" /></Button>
      {/* Шкала логарифмическая, чтобы 1× сидел посередине. */}
      <Slider size="small" min={Math.log2(ZOOM_MIN)} max={Math.log2(ZOOM_MAX)} step={0.01}
        value={Math.log2(zoom)} onChange={(_, v) => setZoom(Math.pow(2, v as number))}
        valueLabelDisplay="auto" valueLabelFormat={(v) => `${Math.pow(2, v as number).toFixed(1)}×`}
        aria-labelledby="icon-zoom" sx={{ color: theme.accent }} />
      <Button size="small" aria-label="Приблизить" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.3))}
        sx={{ textTransform: 'none', color: theme.text, minWidth: 0, px: 1 }}><ZoomIn fontSize="small" /></Button>
      <Button size="small" onClick={() => { setZoom(1); setCenter({ x: SIDE / 2, y: SIDE / 2 }); }}
        sx={{ textTransform: 'none', color: theme.textSec, minWidth: 0, whiteSpace: 'nowrap' }}>Сброс</Button>
    </Box>
  );

  // Окно прижато к верху: при выделении фигуры снизу появляются строки
  // «Поворот» и «Фигура», и центрированный диалог подпрыгивал — холст
  // уезжал из-под курсора, и фигуру было не схватить.
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, mt: 'max(16px, 4vh)' } }}>
      <DialogTitle sx={{ pb: 1 }}>Картинка иконки</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          ...CHECKER_BG, width: VIEW, maxWidth: '100%', aspectRatio: '1 / 1',
          borderRadius: 2, overflow: 'hidden', boxShadow: `0 0 0 1px ${theme.border}`,
        }}>
          <canvas ref={viewRef} width={SIDE} height={SIDE} aria-label="Холст иконки"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: drawing ? 'crosshair' : 'grab' }} />
        </Box>
        <Typography sx={{ fontSize: 11, color: theme.textSec, textAlign: 'center' }}>
          Серая шахматка — прозрачный фон. Всё за краем кадра и за скруглёнными углами обрежется.
        </Typography>

        <ToggleButtonGroup exclusive size="small" value={tool}
          onChange={(_, v) => {
            if (!v) return;
            setTool(v);
            // В «Выделении» последняя фигура остаётся выбранной — её сразу
            // видно с рамкой и ручками. Другие инструменты снимают выбор.
            setSel(v === 'select' && shapes.length ? shapes.length - 1 : -1);
            setEditingShape(false);
            dragRef.current = null;
          }}
          aria-label="Инструмент" sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {TOOLS.map((t) => (
            <Tooltip key={t.value} title={t.label}>
              <ToggleButton value={t.value} aria-label={t.label} sx={btnSx}>{t.icon}</ToggleButton>
            </Tooltip>
          ))}
          <ToggleButton value="move" aria-label="Двигать фото" title="Двигать фото" sx={btnSx} disabled={!photo}>
            <OpenWith fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography sx={{ fontSize: 12, color: theme.text, mt: -0.5 }}>
          {drawing
            ? TOOLS.find((t) => t.value === tool)?.label
            : tool === 'move'
              ? 'Фото: тяните мышью, колесо меняет масштаб'
              : 'Щёлкните фигуру — подвинете и повернёте её; колесо — приближение'}
        </Typography>

        {drawing && (
          <>
            <Box sx={rowSx}>
              <Typography id="icon-brush-size" sx={labelSx}>Толщина</Typography>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Цвет кисти"
                disabled={tool === 'eraser'} style={{ width: 36, height: 28, border: 0, background: 'transparent', padding: 0 }} />
              <Slider size="small" min={1} max={40} value={size} onChange={(_, v) => setSize(v as number)}
                valueLabelDisplay="auto" aria-labelledby="icon-brush-size" sx={{ color: theme.accent }} />
            </Box>
            {tool === 'smooth' && (
              <Box sx={rowSx}>
                <Typography id="icon-smooth-level" sx={labelSx}>Сила</Typography>
                <Slider size="small" min={1} max={5} step={1} value={smoothLevel}
                  onChange={(_, v) => setSmoothLevel(v as number)}
                  marks valueLabelDisplay="auto" valueLabelFormat={(v) => SMOOTH_LEVEL_LABELS[v - 1]}
                  getAriaValueText={(v) => SMOOTH_LEVEL_LABELS[v - 1]}
                  aria-labelledby="icon-smooth-level" sx={{ color: theme.accent }} />
                <Typography sx={{ fontSize: 12, color: theme.text, minWidth: 64 }}>
                  {SMOOTH_LEVEL_LABELS[smoothLevel - 1]}
                </Typography>
              </Box>
            )}
          </>
        )}

        {tool === 'move' && (
          <Box sx={rowSx}>
            <Typography id="icon-photo-zoom" sx={labelSx}>Масштаб</Typography>
            {/* Логарифмическая шкала: 0 — фото вписано целиком. */}
            <Slider size="small" min={-2} max={3} step={0.01}
              value={photo ? Math.log(photo.scale / photoBase) : 0}
              onChange={(_, v) => zoomPhoto(Math.exp(v as number) * photoBase)}
              aria-labelledby="icon-photo-zoom" sx={{ color: theme.accent }} />
            <Button size="small" onClick={bake} sx={{ textTransform: 'none', color: theme.accent, whiteSpace: 'nowrap' }}>Обрезать</Button>
          </Box>
        )}

        {curShape && (
          <>
            <Box sx={rowSx}>
              <Typography id="icon-shape-rot" sx={labelSx}>Поворот</Typography>
              <Slider size="small" min={-180} max={180} step={1} value={curDeg}
                onChange={(_, v) => setShapeDeg(v as number)}
                marks={[{ value: -180 }, { value: -90 }, { value: 0 }, { value: 90 }, { value: 180 }]}
                valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}°`}
                aria-labelledby="icon-shape-rot" sx={{ color: theme.accent }} />
              <Typography sx={{ fontSize: 12, color: theme.text, minWidth: 44, textAlign: 'right' }}>{curDeg}°</Typography>
            </Box>
            <Box sx={rowSx}>
              <Typography sx={labelSx}>Фигура</Typography>
              <Button size="small" onClick={() => { pushUndo(); setShapes((prev) => [...prev.filter((_, i) => i !== sel), prev[sel]]); setSel(shapes.length - 1); }}
                sx={{ textTransform: 'none', color: theme.text, whiteSpace: 'nowrap' }}>Наверх</Button>
              <Button size="small" onClick={deleteSel}
                sx={{ textTransform: 'none', color: theme.textSec, whiteSpace: 'nowrap' }}>Удалить</Button>
              <Typography sx={{ fontSize: 12, color: theme.textSec }}>
                Стрелки — сдвиг, [ ] — поворот, Del — удалить
              </Typography>
            </Box>
          </>
        )}

        {zoomRow}

        <Box sx={rowSx}>
          <Typography id="icon-corners" sx={labelSx}>Скругление углов</Typography>
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

        <FormControlLabel
          control={<Switch size="small" checked={removeBg} onChange={(e) => toggleRemoveBg(e.target.checked)}
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': { color: theme.accent },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: theme.accent },
            }} />}
          label={<Typography sx={{ fontSize: 12, color: theme.text }}>Убирать белый и серый фон у фото</Typography>}
          sx={{ alignSelf: 'flex-start', ml: 0 }} />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button size="small" startIcon={<Upload />} onClick={() => fileRef.current?.click()}
            sx={{ textTransform: 'none', color: theme.text }}>Загрузить фото</Button>
          <Tooltip title="Сделать прозрачным белый или серый фон у уже нарисованного">
            <Button size="small" startIcon={<AutoFixHigh />} onClick={removeLayerBg}
              sx={{ textTransform: 'none', color: theme.text }}>Убрать фон</Button>
          </Tooltip>
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
          sx={{ bgcolor: theme.accent, color: readableTextOn(theme.accent), textTransform: 'none', '&:hover': { bgcolor: theme.accent } }}>
          Готово
        </Button>
      </DialogActions>
    </Dialog>
  );
}

