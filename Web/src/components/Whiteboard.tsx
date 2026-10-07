import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, MenuItem, Select, Slider, Stack, Tooltip, Typography } from '@mui/material';
import { Delete, Edit, Fullscreen, FullscreenExit, Undo } from '@mui/icons-material';
import { protoBoardApi } from '../services/api';
import { useThemeStore } from '../store/themeStore';

type Tool = 'brush' | 'marker' | 'pencil' | 'line' | 'rectangle' | 'circle';
type Stroke = { points: Array<{ x: number; y: number }>; color: string; width: number; erase?: boolean; tool?: Tool };
const tools: Array<{ value: Tool; label: string }> = [
  { value: 'brush', label: 'Кисть' }, { value: 'marker', label: 'Маркер' },
  { value: 'pencil', label: 'Карандаш' }, { value: 'line', label: 'Линия' },
  { value: 'rectangle', label: 'Прямоугольник' }, { value: 'circle', label: 'Круг' },
];
const isShape = (s: Stroke) => !s.erase && ['line', 'rectangle', 'circle'].includes(s.tool || 'brush');

function renderStroke(ctx: CanvasRenderingContext2D, s: Stroke, from = 1) {
  if (!s.points.length) return;
  const first = s.points[0]; const last = s.points[s.points.length - 1];
  ctx.save();
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
  ctx.lineWidth = s.tool === 'pencil' && !s.erase ? Math.max(1, s.width / 3) : s.width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha = s.tool === 'marker' && !s.erase ? 0.35 : 1;
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  ctx.beginPath();
  if (isShape(s)) {
    if (s.tool === 'rectangle') ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
    else if (s.tool === 'circle') {
      const radius = Math.min(Math.abs(last.x - first.x), Math.abs(last.y - first.y)) / 2;
      ctx.arc(first.x + Math.sign(last.x - first.x) * radius, first.y + Math.sign(last.y - first.y) * radius, radius, 0, Math.PI * 2);
    } else { ctx.moveTo(first.x, first.y); ctx.lineTo(last.x, last.y); }
    ctx.stroke();
  } else if (s.points.length === 1) {
    ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    const start = Math.max(1, from);
    ctx.moveTo(s.points[start - 1].x, s.points[start - 1].y);
    for (let i = start; i < s.points.length; i += 1) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

export default function Whiteboard({ chatId }: { chatId: string }) {
  const theme = useThemeStore((s) => s.theme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const undoStack = useRef<Stroke[][]>([]);
  const redoStack = useRef<Stroke[][]>([]);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const current = useRef<Stroke | null>(null);
  const [color, setColor] = useState('#000000');
  const [width, setWidth] = useState(5);
  const [erase, setErase] = useState(false);
  const [tool, setTool] = useState<Tool>('brush');
  const [readOnly, setReadOnly] = useState(true);
  const [full, setFull] = useState(false);
  const canvasRect = useRef<DOMRect | null>(null);
  const draw = () => {
    const c = canvasRef.current; const ctx = c?.getContext('2d'); if (!c || !ctx) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    for (const s of strokes.current) renderStroke(ctx, s);
    ctx.globalCompositeOperation = 'source-over';
  };
  const drawStrokePart = (stroke: Stroke, from: number) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) renderStroke(ctx, stroke, from);
  };
  const clearPreview = () => {
    const c = previewRef.current;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };
  const resize = () => { const c = canvasRef.current; if (!c) return; const r = c.getBoundingClientRect(); canvasRect.current = r; c.width = Math.max(1, Math.floor(r.width)); c.height = Math.max(1, Math.floor(r.height)); const preview = previewRef.current; if (preview) { preview.width = c.width; preview.height = c.height; } draw(); };
  useEffect(() => { resize(); }, [full]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; protoBoardApi.saveDrawing(chatId, strokes.current).catch(() => {}); }, 500);
  };
  const updateHistory = () => setHistory({ undo: undoStack.current.length > 0, redo: redoStack.current.length > 0 });
  const remember = () => {
    // Completed strokes are immutable; snapshots share point arrays.
    undoStack.current.push(strokes.current);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    updateHistory();
  };
  const restoreHistory = (redo = false) => {
    if (readOnly || current.current) return;
    const source = redo ? redoStack.current : undoStack.current;
    const target = redo ? undoStack.current : redoStack.current;
    const previous = source.pop();
    if (!previous) return;
    target.push(strokes.current);
    strokes.current = previous;
    updateHistory(); clearPreview(); draw(); save();
  };
  useEffect(() => { let alive = true; protoBoardApi.get(chatId).then(r => { if (!alive) return; strokes.current = r.data?.drawing || []; setReadOnly(!r.data?.canEdit); requestAnimationFrame(resize); }).catch(() => requestAnimationFrame(resize)); window.addEventListener('resize', resize); return () => { alive = false; if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; protoBoardApi.saveDrawing(chatId, strokes.current).catch(() => {}); } window.removeEventListener('resize', resize); }; }, [chatId]);
  const pos = (e: React.PointerEvent) => { const r = canvasRect.current || canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  return <Box onKeyDown={e => {
    if (readOnly || e.defaultPrevented || e.altKey || !(e.ctrlKey || e.metaKey)) return;
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
    if (e.code !== 'KeyZ' && e.code !== 'KeyY') return;
    e.preventDefault(); e.stopPropagation();
    restoreHistory(e.code === 'KeyY' || e.shiftKey);
  }} sx={{ position: full ? 'fixed' : 'relative', inset: full ? 0 : undefined, zIndex: full ? 20 : 1, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, bgcolor: '#ffffff' }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, flexWrap: 'wrap', gap: 1, bgcolor: theme.bgHeader, borderBottom: `1px solid ${theme.border}` }}>
      <Select size="small" value={tool} disabled={readOnly} inputProps={{ 'aria-label': 'Кисть или фигура' }} onChange={e => { setTool(e.target.value as Tool); setErase(false); }} sx={{ minWidth: 155, color: theme.text }}>
        {tools.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
      </Select>
      <Tooltip title="Кисть"><IconButton disabled={readOnly} onClick={() => setErase(false)} sx={{ color: !erase ? color : theme.textSec }}><Edit /></IconButton></Tooltip>
      <Tooltip title="Ластик"><IconButton disabled={readOnly} onClick={() => setErase(true)} sx={{ color: erase ? theme.accent : theme.textSec }}><Delete /></IconButton></Tooltip>
      <input aria-label="Цвет кисти" type="color" value={color} disabled={readOnly} onChange={e => { setColor(e.target.value); setErase(false); }} />
      <Slider aria-label="Размер кисти" disabled={readOnly} value={width} min={1} max={40} onChange={(_, v) => setWidth(v as number)} sx={{ width: 110, color }} />
      <Tooltip title="Отменить (Ctrl+Z)"><span><IconButton aria-label="Отменить" disabled={readOnly || !history.undo} onClick={() => restoreHistory()} sx={{ color: theme.textSec }}><Undo /></IconButton></span></Tooltip>
      <Tooltip title="Повторить (Ctrl+Y)"><span><IconButton aria-label="Повторить" disabled={readOnly || !history.redo} onClick={() => restoreHistory(true)} sx={{ color: theme.textSec }}><Undo sx={{ transform: 'scaleX(-1)' }} /></IconButton></span></Tooltip>
      <Tooltip title="Очистить холст"><span><IconButton disabled={readOnly} onClick={() => { if (current.current || !strokes.current.length) return; remember(); strokes.current = []; draw(); save(); }} sx={{ color: theme.textSec }}><Delete /></IconButton></span></Tooltip>
      <Box sx={{ flex: 1 }} /><Typography variant="caption" sx={{ color: theme.textSec }}>{readOnly ? 'Только просмотр' : 'Совместный холст'}</Typography>
      <Tooltip title={full ? 'Выйти из полноэкранного режима' : 'На весь экран'}><IconButton onClick={() => setFull(v => !v)} sx={{ color: theme.textSec }}>{full ? <FullscreenExit /> : <Fullscreen />}</IconButton></Tooltip>
    </Stack>
    <Box sx={{ flex: 1, minHeight: 280, m: 1, position: 'relative', bgcolor: '#ffffff' }}>
      <canvas ref={previewRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} />
      <canvas ref={canvasRef} tabIndex={0} aria-label="Холст для рисования" style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', backgroundColor: '#ffffff' }}
        onPointerDown={e => {
          if (readOnly || current.current) return;
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          current.current = { points: [pos(e)], color, width, erase, tool };
          if (!isShape(current.current)) drawStrokePart(current.current, 1);
        }}
        onPointerMove={e => {
          const s = current.current; if (!s) return;
          if (isShape(s)) {
            s.points = [s.points[0], pos(e)];
            clearPreview(); const ctx = previewRef.current?.getContext('2d');
            if (ctx) renderStroke(ctx, s);
          } else {
            const next = pos(e); const previous = s.points[s.points.length - 1];
            // Pointer events can arrive faster than a frame. Skip sub-pixel
            // duplicates; they add JSON/database work without changing pixels.
            if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) < 0.75) return;
            const previousLength = s.points.length; s.points.push(next); drawStrokePart(s, previousLength);
          }
        }}
        onPointerUp={e => {
          const s = current.current; if (!s) return;
          if (isShape(s)) { s.points = [s.points[0], pos(e)]; drawStrokePart(s, 1); }
          remember(); strokes.current = [...strokes.current, s]; current.current = null; clearPreview(); save();
        }}
        onPointerCancel={() => { current.current = null; clearPreview(); draw(); }} />
    </Box>
  </Box>;
}