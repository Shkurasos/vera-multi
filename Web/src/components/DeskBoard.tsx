/**
 * Доска доказательств.
 *
 * Появляется вместо обычного чата у группы, название которой начинается с
 * «Desk». Раскладка полностью свободная: карточки таскаются мышью, связи
 * рисуются нитями, всё лежит на пробковой подложке.
 *
 * Холст больше экрана (BOARD_W×BOARD_H) и прокручивается, поэтому координаты
 * карточек задаются в его пикселях — тогда доска выглядит одинаково на любом
 * размере окна и не «съезжает» при повороте телефона.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Tooltip, MenuItem, IconButton, Popover, InputAdornment } from '@mui/material';
// Иконки берём только те, что есть в mui-icons-shim: шим собирается по
// фактически используемым, а сам он генерируется скриптом и руками не правится.
// «Папка» и «+/−» поэтому подписаны текстом, а не иконками.
import { PhotoCamera, TextSnippet, Close, EmojiEmotions, Search, Send } from '@mui/icons-material';
import {
  THREAD_COLORS, threadPath, itemCenter, boardSize, BOARD_STEP,
  countInFolder, foldersOf, type DeskItem, type DeskBoard,
} from '../utils/deskBoard';
import { useDeskBoard } from '../hooks/useDeskBoard';
import { usersApi } from '../services/api';
import DeskCard from './DeskCard';

interface Props {
  chatId: string;
  chatName: string;
}

/**
 * Смайлики для поля ввода на доске.
 *
 * Небольшой фиксированный набор, а не полная клавиатура: в доске эмодзи —
 * настроение («нашёл улику 🔍», «жара 🔥»), а не разговор, и двадцать символов
 * закрывают это лучше, чем поиск по сотне. Размер — два экрана на телефоне.
 */
const DESK_EMOJIS = [
  '😀', '😅', '😂', '😊', '😍', '🤔', '😐', '🙃',
  '😮', '😢', '😡', '😱', '🤯', '😴', '🤕', '🥶',
  '👍', '👎', '👌', '🙏', '💪', '✌️', '🤝', '👀',
  '🔍', '🔥', '💡', '⚠️', '❗', '❓', '✅', '❌',
];

export default function DeskBoard({ chatId, chatName }: Props) {
  const bus = useDeskBoard(chatId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const editFileRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [threadColor, setThreadColor] = useState(THREAD_COLORS[0]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const [boardQuery, setBoardQuery] = useState('');
  const [editingItem, setEditingItem] = useState<DeskItem | null>(null);
  const [editText, setEditText] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editError, setEditError] = useState('');
  const [uploading, setUploading] = useState(false);
  const boardViewportRef = useRef<HTMLDivElement | null>(null);

  const boardMatches = useMemo(() => {
    const query = boardQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return bus.board.items.filter((item) => [item.text, item.caption, item.author, item.kind]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(query)));
  }, [boardQuery, bus.board.items]);

  const focusItem = (item?: DeskItem) => {
    if (!item) return;
    setSelected(item.id);
    bus.focus(item.id);
    const viewport = boardViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: Math.max(0, item.x + item.w / 2 - viewport.clientWidth / 2),
      top: Math.max(0, item.y + item.h / 2 - viewport.clientHeight / 2),
      behavior: 'smooth',
    });
  };

  // Переводим координаты указателя из окна в координаты большого холста.
  // Без scrollLeft/scrollTop карточка после прокрутки начинала бы «прыгать»
  // обратно к верхнему левому углу при первом движении.
  const toBoardPoint = (clientX: number, clientY: number) => {
    const viewport = boardViewportRef.current;
    if (!viewport) return { x: clientX, y: clientY };
    const rect = viewport.getBoundingClientRect();
    return {
      x: clientX - rect.left + viewport.scrollLeft,
      y: clientY - rect.top + viewport.scrollTop,
    };
  };

  // Нить создаётся вторым кликом: первый выбирает начало, второй — конец.
  const startLink = (id: string) => {
    if (linkFrom === null) { setLinkFrom(id); return; }
    if (linkFrom === id) { setLinkFrom(null); return; }
    bus.link(linkFrom, id, threadColor);
    setLinkFrom(null);
  };

  const pickFile = () => fileRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await bus.addPhoto(file);
  };

  const openEditor = (item: DeskItem) => {
    if (!bus.rights.canEdit || item.kind === 'folder') return;
    setEditingItem(item);
    setEditText(item.text || '');
    setEditAuthor(item.author || '');
    setEditCaption(item.caption || '');
    setEditError('');
  };

  const saveEditor = () => {
    if (!editingItem || !bus.rights.canEdit) return;
    const patch: Partial<DeskItem> = editingItem.kind === 'photo'
      ? { caption: editCaption.trim() }
      : { text: editText.trim(), ...(editingItem.kind === 'message' ? { author: editAuthor.trim() } : {}) };
    bus.patch(editingItem.id, patch);
    setEditingItem(null);
  };

  const onEditPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editingItem || editingItem.kind !== 'photo') return;
    setUploading(true);
    setEditError('');
    try {
      await bus.replacePhoto(editingItem.id, file);
    } catch (error: any) {
      setEditError(error?.response?.data?.message || 'Не удалось заменить фото');
    } finally {
      setUploading(false);
    }
  };

  const onBoardWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.altKey || !bus.rights.canEdit || e.deltaY === 0) return;
    const target = (e.target as HTMLElement).closest('[data-desk-card]') as HTMLElement | null;
    const item = target ? bus.board.items.find((candidate) => candidate.id === target.dataset.deskCard) : null;
    const current = item || bus.board.items.find((candidate) => candidate.id === selected && candidate.kind !== 'folder');
    if (!current) return;
    e.preventDefault();
    if (e.shiftKey) bus.rotate(current.id, e.deltaY < 0 ? 2 : -2);
    else bus.scale(current.id, e.deltaY < 0 ? 1.04 : 0.96);
  };

  const saveNote = () => {
    const text = noteText.trim();
    if (text) bus.addNote(text);
    setNoteText('');
    setNoteOpen(false);
  };

  return (
    <Box sx={{ position: 'relative', flex: 1, minHeight: 0, bgcolor: '#8a5a2b', overflow: 'hidden' }}>
      <Toolbar
        chatName={chatName}
        threadColor={threadColor}
        onThreadColor={setThreadColor}
        count={bus.board.items.length}
        threads={bus.board.threads.length}
        linking={linkFrom !== null}
        onCancelLink={() => setLinkFrom(null)}
        onAddPhoto={pickFile}
        onAddNote={() => setNoteOpen(true)}
        canEdit={bus.rights.canEdit}
        level={bus.rights.myLevel}
        onOpenAccess={() => setAccessOpen(true)}
        canManage={bus.rights.canManage}
      />
      <BoardHud
        canEdit={bus.rights.canEdit}
        width={boardSize(bus.board.width, bus.board.height).width}
        height={boardSize(bus.board.width, bus.board.height).height}
        query={boardQuery}
        onQuery={setBoardQuery}
        matchCount={boardMatches.length}
        onFocusMatch={() => focusItem(boardMatches[0])}
        onAddFolder={() => bus.addFolder()}
        onResize={(dw, dh) => bus.resize(dw, dh)}
      />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={editFileRef} type="file" accept="image/*" hidden onChange={onEditPhoto} />

      <Box
        // Клик по пустой пробке сбрасывает выбор и незавершённую связь.
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          setSelected(null);
          setLinkFrom(null);
        }}
        ref={boardViewportRef}
        onWheel={onBoardWheel}
        sx={{
          position: 'absolute', inset: 0, overflow: 'auto',
          ...CORK_SX,
        }}
      >
        <Box sx={{ position: 'relative', width: boardSize(bus.board.width, bus.board.height).width, height: boardSize(bus.board.width, bus.board.height).height, transform: 'translateZ(0)' }}>
          {/* Папки лежат ПОД карточками: иначе они закрывали бы то, что внутри. */}
          {foldersOf(bus.board).map((f) => (
            <DeskFolder
              key={f.id}
              folder={f}
              count={countInFolder(bus.board, f.id)}
              selected={selected === f.id}
              readOnly={!bus.rights.canEdit}
              toBoardPoint={toBoardPoint}
              onMove={(x, y) => bus.moveFolderTo(f.id, x, y)}
              onSelect={() => { setSelected(f.id); bus.focus(f.id); }}
              onDelete={() => bus.drop(f.id)}
              onRename={(name) => bus.patch(f.id, { text: name })}
            />
          ))}
          <Threads board={bus.board} />
          {bus.board.items.filter((i) => i.kind !== 'folder').map((item) => (
            <DeskCardWithPhoto
              key={item.id}
              item={item}
              selected={selected === item.id}
              linking={linkFrom === item.id}
              readOnly={!bus.rights.canEdit}
              toBoardPoint={toBoardPoint}
              onMove={(x, y) => bus.move(item.id, x, y)}
              // Отпускание мыши — это конец перетаскивания. Раньше здесь стояло
              // удаление, из-за чего карточка исчезала и по клику, и при отпускании.
              onDragEnd={(x, y) => bus.dropCard(item.id, x, y)}
              onSelect={() => { setSelected(item.id); bus.focus(item.id); }}
              onEdit={() => openEditor(item)}
              onScale={(factor) => bus.scale(item.id, factor)}
              onRotate={(delta) => bus.rotate(item.id, delta)}
              onDelete={() => bus.drop(item.id)}
              onStartLink={() => startLink(item.id)}
              onCancelLink={() => setLinkFrom(null)}
            />
          ))}
          {bus.ready && bus.board.items.length === 0 && !bus.error && <EmptyHint canEdit={bus.rights.canEdit} />}
          {bus.error && <BoardError text={bus.error} />}
        </Box>
      </Box>

      <Dialog open={noteOpen} onClose={() => setNoteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16 }}>Новая заметка</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth multiline minRows={4} value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Что известно по делу?"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={saveNote} disabled={!noteText.trim()}>Приколоть</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editingItem} onClose={() => { if (!uploading) setEditingItem(null); }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16 }}>Редактировать карточку</DialogTitle>
        <DialogContent>
          {editingItem?.kind === 'photo' ? (
            <>
              <TextField fullWidth multiline minRows={2} label="Подпись" value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)} sx={{ mt: 0.5 }} />
              <Button size="small" variant="outlined" onClick={() => editFileRef.current?.click()}
                disabled={uploading} sx={{ mt: 1.5, textTransform: 'none' }}>
                {uploading ? 'Загрузка...' : 'Заменить фото'}
              </Button>
            </>
          ) : (
            <>
              <TextField fullWidth multiline minRows={4} label={editingItem?.kind === 'message' ? 'Сообщение' : 'Текст'}
                value={editText} onChange={(e) => setEditText(e.target.value)} sx={{ mt: 0.5 }} />
              {editingItem?.kind === 'message' && (
                <TextField fullWidth label="Автор" value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} sx={{ mt: 1.5 }} />
              )}
            </>
          )}
          {editError && <Typography color="error" sx={{ fontSize: 12, mt: 1 }}>{editError}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingItem(null)} disabled={uploading}>Отмена</Button>
          <Button variant="contained" onClick={saveEditor} disabled={uploading || (editingItem?.kind !== 'photo' && !editText.trim())}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      <MessageComposer
        canEdit={bus.rights.canEdit}
        onSubmit={(text, author) => bus.addMessage(text, author)}
      />

      <AccessDialog open={accessOpen} onClose={() => setAccessOpen(false)} bus={bus} />
    </Box>
  );
}

/** Пробковая подложка: цвет + мелкое зерно, чтобы не выглядела «пластиковой». */
const CORK_SX = {
  backgroundColor: '#b98a52',
  backgroundImage: [
    'radial-gradient(circle at 18% 22%, rgba(255,255,255,0.06), transparent 45%)',
    'radial-gradient(circle at 78% 68%, rgba(0,0,0,0.10), transparent 50%)',
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='c'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23c)' opacity='0.22'/%3E%3C/svg%3E\")",
  ].join(','),
  boxShadow: 'inset 0 0 140px rgba(60,30,0,0.55)',
} as const;

/**
 * Папка на доске: рамка с ярлыком, в которую можно перетащить карточки.
 *
 * Отдельная отрисовка, а не ещё одна карточка: папка должна быть ПОД карточками
 * и не иметь нити/подписи/фото — иначе она закрывала бы то, что в ней лежит.
 * За папку цепляются только за ярлык, поэтому случайно сдвинуть её нельзя.
 */
function DeskFolder(p: {
  folder: DeskItem;
  count: number;
  selected: boolean;
  readOnly?: boolean;
  toBoardPoint: (clientX: number, clientY: number) => { x: number; y: number };
  onMove: (x: number, y: number) => void;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const f = p.folder;
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.text || 'Папка');
  const grabRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });

  useEffect(() => { setName(f.text || 'Папка'); }, [f.text]);

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-desk-nodrag]')) return;
    p.onSelect();
    if (p.readOnly) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const point = p.toBoardPoint(e.clientX, e.clientY);
    grabRef.current = { x: point.x - f.x, y: point.y - f.y };
    startClientRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    setDragging(true);
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!dragging) return;
    if (!movedRef.current
      && Math.abs(e.clientX - startClientRef.current.x) < 3
      && Math.abs(e.clientY - startClientRef.current.y) < 3) return;
    movedRef.current = true;
    const point = p.toBoardPoint(e.clientX, e.clientY);
    p.onMove(point.x - grabRef.current.x, point.y - grabRef.current.y);
  };

  const endDrag = () => setDragging(false);

  const commitName = () => {
    const clean = name.trim() || 'Папка';
    if (clean !== (f.text || '')) p.onRename(clean);
    setName(clean);
    setEditing(false);
  };

  return (
    <Box
      data-desk-folder={f.id}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      sx={{
        position: 'absolute', left: f.x, top: f.y, width: f.w, height: f.h,
        // Ниже карточек (они кладут item.z + 10), но выше нитей.
        zIndex: f.z,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none', userSelect: 'none',
        transition: dragging ? 'none' : 'box-shadow 180ms ease',
        border: '2px dashed rgba(255,240,210,0.45)',
        borderRadius: 1,
        bgcolor: 'rgba(255, 246, 220, 0.07)',
        boxShadow: p.selected ? '0 0 0 2px #4facfe inset' : 'none',
      }}
    >
      {/* Ярлык с названием: за него цепляемся мышью и он же показывает счётчик. */}
      <Box sx={{
        position: 'absolute', top: -13, left: 10,
        display: 'flex', alignItems: 'center', gap: 0.5,
        px: 1, py: 0.2, borderRadius: '4px 8px 8px 4px',
        bgcolor: '#d9a441', color: '#3a2a08',
        boxShadow: '0 3px 8px rgba(0,0,0,0.45)',
        fontSize: 13, fontWeight: 700, maxWidth: f.w - 20,
      }}>
        {editing && !p.readOnly ? (
          <input
            autoFocus value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') { setName(f.text || 'Папка'); setEditing(false); }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ width: 120, border: 'none', outline: 'none', background: 'transparent', font: 'inherit', color: 'inherit' }}
          />
        ) : (
          <span
            onDoubleClick={() => { if (!p.readOnly) setEditing(true); }}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {f.text || 'Папка'}
          </span>
        )}
        <span style={{ opacity: 0.75, fontWeight: 400 }}>({p.count})</span>
        {!p.readOnly && (
          <IconButton data-desk-nodrag size="small" aria-label="Удалить папку" onClick={p.onDelete}
            sx={{ color: '#3a2a08', p: 0.1 }}>
            <Close sx={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>
    </Box>
  );
}

/** Нити доски. Лежит ПОД карточками (zIndex 1 против item.z+10). */
function Threads({ board }: { board: DeskBoard }) {
  const byId = useMemo(
    () => Object.fromEntries(board.items.map((i) => [i.id, i])) as Record<string, DeskItem>,
    [board.items],
  );
  if (!board.threads.length) return null;
  // Размер svg берём у доски, а не у константы: с настраиваемым холстом нить
  // на широкой доске иначе обрывалась бы по старому краю.
  const size = boardSize(board.width, board.height);
  return (
    <svg
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}
    >
      {board.threads.map((t) => {
        const a = byId[t.from];
        const b = byId[t.to];
        // Оборванный конец не рисуем: модель связи чистит, но данные прежних
        // версий могли доехать — падать на этом нельзя.
        if (!a || !b) return null;
        const path = threadPath(a, b);
        if (!path) return null;
        const ca = itemCenter(a);
        const cb = itemCenter(b);
        return (
          <g key={t.id}>
            {/* Тень отдельной линией: придаёт нити объём над пробкой. */}
            <path d={path} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={4}
              transform="translate(1.5 3)" strokeLinecap="round" />
            <path d={path} fill="none" stroke={t.color} strokeWidth={2.5} strokeLinecap="round" />
            <circle cx={ca.x} cy={ca.y} r={3.5} fill={t.color} opacity={0.9} />
            <circle cx={cb.x} cy={cb.y} r={3.5} fill={t.color} opacity={0.9} />
          </g>
        );
      })}
    </svg>
  );
}

/** Карточка: фото приходит прямой ссылкой с сервера, свой загрузчик не нужен. */

function DeskCardWithPhoto(props: {
  item: DeskItem;
  selected: boolean;
  linking: boolean;
  readOnly?: boolean;
  toBoardPoint: (clientX: number, clientY: number) => { x: number; y: number };
  onMove: (x: number, y: number) => void;
  /** Отпустили мышь: это конец жеста, а не удаление карточки. */
  onDragEnd: (x: number, y: number) => void;
  onSelect: () => void;
  onEdit: () => void;
  onScale: (factor: number) => void;
  onRotate: (delta: number) => void;
  onDelete: () => void;
  onStartLink: () => void;
  onCancelLink: () => void;
}) {
  const { item } = props;
  // Фото доски лежат на сервере в /uploads/proto, поэтому это обычная
  // ссылка — свой загрузчик больше не нужен.
  return <DeskCard {...props} photoUrl={item.photoUrl || null} />;
}

/**
 * HUD доски: папки и размер холста.
 *
 * Отдельная панель, а не ещё две кнопки в Toolbar: там и так много всего, а
 * размер доски — вещь, которой пользуются редко и прицельно. Панель живёт
 * справа снизу, рядом с полем ввода, чтобы не наезжать на карточки.
 *
 * Кнопки «−» не отключаются при достижении пола, но и ничего не делают:
 * resizeBoard сама упирается в BOARD_MIN_*, и подсказка «уже минимальный» здесь
 * полезнее, чем серая кнопка без объяснений.
 */
function BoardHud(p: {
  canEdit: boolean;
  width: number;
  height: number;
  query: string;
  onQuery: (query: string) => void;
  matchCount: number;
  onFocusMatch: () => void;
  onAddFolder: () => void;
  onResize: (dw: number, dh: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = {
    color: '#f2e2c8', textTransform: 'none', minWidth: 34,
    bgcolor: 'rgba(255,255,255,0.08)', '&:hover': { bgcolor: 'rgba(255,255,255,0.16)' },
  } as const;

  return (
    <Box sx={{
      position: 'absolute', right: 14, bottom: 70, zIndex: 101,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5,
    }}>
      {open && (
        <Box sx={{
          display: 'flex', flexDirection: 'column', gap: 0.75, p: 1,
          width: { xs: 'min(300px, calc(100vw - 28px))', sm: 300 },
          borderRadius: 2, bgcolor: 'rgba(20,14,8,0.92)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 10px 26px rgba(0,0,0,0.5)',
        }}>
          <TextField
            size="small" value={p.query} onChange={(e) => p.onQuery(e.target.value)}
            placeholder="Найти улику…"
            onKeyDown={(e) => { if (e.key === 'Enter' && p.matchCount) p.onFocusMatch(); }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search sx={{ color: 'rgba(255,240,220,0.65)', fontSize: 18 }} /></InputAdornment>,
            }}
            sx={{
              '& .MuiInputBase-root': { color: '#f2e2c8', bgcolor: 'rgba(255,255,255,0.07)' },
              '& .MuiInputBase-input::placeholder': { color: 'rgba(255,240,220,0.55)', opacity: 1 },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.18)' },
            }}
          />
          {p.query && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography sx={{ color: '#f2e2c8', fontSize: 11, flex: 1 }}>
                {p.matchCount ? `Найдено: ${p.matchCount}` : 'Ничего не найдено'}
              </Typography>
              <Button size="small" disabled={!p.matchCount} onClick={p.onFocusMatch} sx={btn}>
                К первой
              </Button>
            </Box>
          )}
          <Typography sx={{ color: '#f2e2c8', fontSize: 11, px: 0.5 }}>
            Доска: {p.width}×{p.height}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" disabled={!p.canEdit} onClick={p.onAddFolder} sx={btn}>Папка</Button>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ color: '#f2e2c8', fontSize: 11, flex: 1 }}>Размер</Typography>
            <Button size="small" disabled={!p.canEdit}
              onClick={() => p.onResize(-BOARD_STEP, -BOARD_STEP)} sx={btn}
              title="Уменьшить доску">−</Button>
            <Button size="small" disabled={!p.canEdit}
              onClick={() => p.onResize(BOARD_STEP, BOARD_STEP)} sx={btn}
              title="Увеличить доску">+</Button>
          </Box>
          {!p.canEdit && (
            <Typography sx={{ color: '#f2e2c8', fontSize: 10, opacity: 0.7, px: 0.5 }}>
              Только просмотр
            </Typography>
          )}
        </Box>
      )}
      {/* Подпись, а не иконка: в mui-icons-shim нет подходящей иконки для «HUD»,
          а руками этот генерируемый файл не правится. */}
      <Button size="small" onClick={() => setOpen((v) => !v)} sx={{ ...btn, px: 1 }}>
        {open ? 'Скрыть' : 'Доска'}
      </Button>
    </Box>
  );
}

/**
 * Поле ввода сообщения прямо на доске.
 *
 * Раньше надо было сначала приколоть кнопкой, потом выбрать из списка в диалоге —
 * три действия вместо одного и лишний шаг, на котором человек терялся. Теперь
 * пишешь — и карточка появляется сразу.
 *
 * Enter отправляет, Shift+Enter переносит строку. Отдельной кнопки «приколоть»
 * нет: она бы только напоминала старый шаг. Смайлики — кнопка слева: в доске
 * карточки-эмодзи обычное дело, а лезть в отдельное окно за ними лень.
 */
function MessageComposer({ canEdit, onSubmit }: {
  canEdit: boolean;
  onSubmit: (text: string, author: string) => void;
}) {
  const [text, setText] = useState('');
  // Позиция курсора, чтобы вставленный смайлик попал туда, где печатали, а не
  // в конец строки: иначе дописывание в середину ломалось бы.
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const selRef = useRef<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<null | HTMLElement>(null);

  const rememberCaret = () => {
    const el = inputRef.current;
    selRef.current = el ? ((el as HTMLInputElement).selectionStart ?? null) : null;
  };

  const insertEmoji = (emoji: string) => {
    const at = selRef.current ?? text.length;
    const next = text.slice(0, at) + emoji + text.slice(at);
    setText(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const caret = at + emoji.length;
      el.setSelectionRange(caret, caret);
      selRef.current = caret;
    });
  };

  if (!canEdit) {
    return (
      <Box sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
        <Chip size="small" label="Просмотр: добавлять карточки нельзя"
          sx={{ bgcolor: 'rgba(20,14,8,0.86)', color: '#f2e2c8' }} />
      </Box>
    );
  }
  const send = () => {
    const clean = text.trim();
    if (!clean) return;
    // Подпись — «Я»: в доске важно, что это написал один человек. Имя
    // подставлять нечем: источником карточки больше не является сообщение чата.
    onSubmit(clean, 'Я');
    setText('');
  };
  return (
    <>
      <Box sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 100, width: 'min(600px, calc(100% - 24px))', display: 'flex', gap: 0.5, alignItems: 'flex-end' }}>
        <IconButton
          aria-label="Смайлики"
          onClick={(e) => { rememberCaret(); setEmojiAnchor(e.currentTarget); setEmojiOpen((v) => !v); }}
          sx={{ bgcolor: 'rgba(20,14,8,0.9)', color: '#f2e2c8', flexShrink: 0 }}
        >
          <EmojiEmotions sx={{ fontSize: 20 }} />
        </IconButton>
        <TextField
          fullWidth
          size="small"
          multiline
          minRows={1}
          maxRows={4}
          inputRef={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onSelect={rememberCaret}
          onKeyDown={(e) => {
            // Shift+Enter — перенос строки, иначе многострочное сообщение
            // написать было бы нечем.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Напишите сообщение — оно сразу станет карточкой (Enter)"
          sx={{
            '& .MuiOutlinedInput-root': { bgcolor: 'rgba(20,14,8,0.9)', color: '#f2e2c8' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
          }}
        />
        <IconButton
          aria-label="Добавить сообщение на доску"
          disabled={!text.trim()}
          onClick={send}
          sx={{
            bgcolor: text.trim() ? '#d9a441' : 'rgba(20,14,8,0.65)',
            color: text.trim() ? '#3a2a08' : 'rgba(255,240,220,0.45)',
            flexShrink: 0,
            '&:hover': { bgcolor: '#edbd58' },
          }}
        >
          <Send sx={{ fontSize: 19 }} />
        </IconButton>
      </Box>
      <Popover
        open={emojiOpen}
        anchorEl={emojiAnchor}
        onClose={() => setEmojiOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { bgcolor: '#241a10', border: '1px solid rgba(255,255,255,0.16)' } } }}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 34px)', p: 0.75, gap: 0.25 }}>
          {DESK_EMOJIS.map((e) => (
            <IconButton key={e} aria-label={`Вставить ${e}`} onClick={() => insertEmoji(e)}
              sx={{ fontSize: 19, color: '#f2e2c8', p: 0, borderRadius: 1, '&:hover': { bgcolor: 'rgba(255,255,255,0.14)' } }}>
              {e}
            </IconButton>
          ))}
        </Box>
      </Popover>
    </>
  );
}

/** Доска недоступна: не открыта или не загрузилась. */
function BoardError({ text }: { text: string }) {
  return (
    <Box sx={{ position: 'absolute', top: 120, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', color: '#f2e2c8', pointerEvents: 'none' }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 0.5 }}>{text}</Typography>
      <Typography sx={{ fontSize: 13, opacity: 0.8 }}>Попросите владельца доски открыть её вам.</Typography>
    </Box>
  );
}

/**
 * Кто и с какими правами на доске: выдача, смена уровня и отзыв.
 *
 * Отдельный диалог, а не постоянная панель: состав меняет владелец, а это
 * редкая операция — держать её постоянно на экране незачем.
 */
function AccessDialog({ open, onClose, bus }: {
  open: boolean; onClose: () => void; bus: ReturnType<typeof useDeskBoard>;
}) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<'viewer' | 'editor'>('viewer');
  const [found, setFound] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async (q: string) => {
    if (q.trim().length < 2) { setFound([]); return; }
    try {
      const res = await usersApi.search(q.trim());
      const list = (res.data?.users || res.data || []).map((u: any) => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id,
      }));
      setFound(list);
    } catch {
      setFound([]);
    }
  };

  const grant = async (userId: string) => {
    setBusy(true);
    setErr(null);
    try {
      await bus.grant(userId, level);
      setQuery(''); setFound([]);
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Не удалось выдать доступ');
    } finally {
      setBusy(false);
    }
  };

  const levelOf = (userId: string) => bus.rights.members.find((m) => m.userId === userId)?.level;
  const nameOf = (userId: string) => {
    const u = bus.rights.members.find((x) => x.userId === userId)?.user;
    return u ? ([u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id) : 'Участник';
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 16 }}>Доступ к доске</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12, opacity: 0.7, mb: 1.5 }}>
          Выберите, что сможет человек: только смотреть или также редактировать карточки.
        </Typography>
        <TextField
          fullWidth size="small" label="Кого пригласить" value={query}
          onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }}
          placeholder="Имя или ник"
        />
        <TextField select size="small" label="Право" value={level} onChange={(e) => setLevel(e.target.value as any)}
          fullWidth sx={{ mt: 1 }}>
          <MenuItem value="viewer">Только просмотр</MenuItem>
          <MenuItem value="editor">Редактирование</MenuItem>
        </TextField>
        {found.length > 0 && (
          <Box sx={{ mt: 1, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1 }}>
            {found.map((u) => (
              <Box key={u.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75 }}>
                <Typography sx={{ fontSize: 13, flex: 1 }}>{u.name}</Typography>
                {levelOf(u.id) ? (
                  <Chip size="small" label={levelOf(u.id) === 'editor' ? 'редактор' : 'зритель'} />
                ) : (
                  <Button size="small" disabled={busy} onClick={() => grant(u.id)}>Выдать</Button>
                )}
              </Box>
            ))}
          </Box>
        )}
        {err && <Typography sx={{ fontSize: 12, color: 'error.main', mt: 1 }}>{err}</Typography>}

        <Typography sx={{ fontSize: 13, fontWeight: 700, mt: 2 }}>Уже имеют доступ</Typography>
        <Typography sx={{ fontSize: 12, opacity: 0.7 }}>Вы — владелец, у вас все права.</Typography>
        {bus.rights.members.length === 0 ? (
          <Typography sx={{ fontSize: 12, opacity: 0.6, mt: 1 }}>Пока никто, кроме вас.</Typography>
        ) : (
          bus.rights.members.map((m) => (
            <Box key={m.userId} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
              <Typography sx={{ fontSize: 13, flex: 1 }}>{nameOf(m.userId)}</Typography>
              <TextField select size="small" value={m.level} onChange={(e) => bus.setLevel(m.userId, e.target.value as any)} sx={{ minWidth: 140 }}>
                <MenuItem value="viewer">Только просмотр</MenuItem>
                <MenuItem value="editor">Редактирование</MenuItem>
              </TextField>
              <IconButton size="small" onClick={() => bus.revoke(m.userId)} aria-label="Отобрать доступ">
                <Close fontSize="small" />
              </IconButton>
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Подсказка на пустой доске: без неё непонятно, что вообще можно делать.
 *
 * Зрителю текст другой: совет «перетащите мышью» был бы бессмысленным,
 * ведь двигать ему нельзя.
 */
function EmptyHint({ canEdit }: { canEdit: boolean }) {
  return (
    <Box sx={{
      position: 'absolute', left: '50%', top: 120, transform: 'translateX(-50%)',
      textAlign: 'center', color: 'rgba(255,240,220,0.85)', pointerEvents: 'none',
      textShadow: '0 2px 8px rgba(0,0,0,0.6)', maxWidth: 380,
    }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 0.5 }}>Прото доска пуста</Typography>
      <Typography sx={{ fontSize: 13, lineHeight: 1.5 }}>
        {canEdit
          ? 'Напишите сообщение в поле внизу — появится карточка. Добавьте фото или заметку, тяните карточки мышью. Чтобы связать улики — нажмите иконку 🔗 на карточке, затем кликните вторую.'
          : 'Здесь пока нет улик. Вы смотрите доску — добавлять и менять карточки нельзя.'}
      </Typography>
    </Box>
  );
}

/** Панель инструментов над пробкой. */
function Toolbar(p: {
  chatName: string;
  threadColor: string;
  onThreadColor: (c: string) => void;
  count: number;
  threads: number;
  linking: boolean;
  onCancelLink: () => void;
  onAddPhoto: () => void;
  onAddNote: () => void;
  canEdit: boolean;
  level: 'owner' | 'editor' | 'viewer' | null;
  canManage: boolean;
  onOpenAccess: () => void;
}) {
  const levelLabel = p.level === 'owner' ? 'владелец' : p.level === 'editor' ? 'редактор' : 'зритель';
  return (
    <Box sx={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
      px: { xs: 1, sm: 1.5 }, py: 0.75, bgcolor: 'rgba(20,14,8,0.82)', backdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(255,255,255,0.12)',
    }}>
      <Typography sx={{ color: '#f2e2c8', fontWeight: 700, fontSize: { xs: 12, sm: 14 }, mr: { xs: 0, sm: 1 }, maxWidth: { xs: 150, sm: 'none' } }} noWrap>
        🕵 {p.chatName}
      </Typography>
      <Chip size="small" label={`улик: ${p.count}`}
        sx={{ height: 20, fontSize: 11, bgcolor: 'rgba(255,255,255,0.12)', color: '#f2e2c8' }} />
      <Chip size="small" label={`нитей: ${p.threads}`}
        sx={{ height: 20, fontSize: 11, bgcolor: 'rgba(255,255,255,0.08)', color: '#f2e2c8', display: { xs: 'none', sm: 'inline-flex' } }} />
      {/* Кнопки создания есть только у тех, кто правда может их использовать:
          зрителю серые кнопки только обещали бы возможность, которой нет. */}
      {p.canEdit && (
        <>
          <Button size="small" startIcon={<PhotoCamera />} onClick={p.onAddPhoto}
            sx={{ color: '#f2e2c8', textTransform: 'none' }}>Фото</Button>
          <Button size="small" startIcon={<TextSnippet />} onClick={p.onAddNote}
            sx={{ color: '#f2e2c8', textTransform: 'none' }}>Заметка</Button>
        </>
      )}
      <Chip size="small" label={levelLabel}
        sx={{ height: 20, fontSize: 11, bgcolor: p.level === 'viewer' ? 'rgba(200,120,40,0.35)' : 'rgba(255,255,255,0.12)', color: '#f2e2c8' }} />
      {p.canManage && (
        <Button size="small" onClick={p.onOpenAccess} sx={{ color: '#f2e2c8', textTransform: 'none' }}>
          Доступ
        </Button>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
        <Typography sx={{ color: '#f2e2c8', fontSize: 11, mr: 0.5 }}>Нить:</Typography>
        {THREAD_COLORS.map((c) => (
          <Tooltip key={c} title={c}>
            <Box onClick={() => p.onThreadColor(c)} sx={{
              width: 16, height: 16, borderRadius: '50%', bgcolor: c, cursor: 'pointer',
              boxShadow: p.threadColor === c ? '0 0 0 2px #fff' : '0 0 0 1px rgba(0,0,0,0.4)',
            }} />
          </Tooltip>
        ))}
      </Box>
      {p.linking && (
        <Button size="small" color="warning" onClick={p.onCancelLink} sx={{ textTransform: 'none' }}>
          Выберите вторую карточку
        </Button>
      )}
    </Box>
  );
}