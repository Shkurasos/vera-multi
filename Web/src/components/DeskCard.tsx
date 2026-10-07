/**
 * Карточка на прото доске: фото, заметка или приколотое сообщение.
 *
 * Вынесена отдельно от доски, потому что ведёт себя самостоятельно: тянется
 * мышью, умеет быть началом нити и получает подсветку в режиме связывания.
 */
import React, { useRef, useState } from 'react';
import { Box, Typography, IconButton, Menu, MenuItem } from '@mui/material';
import { Close, Link as LinkIcon, MoreVert } from '@mui/icons-material';
import type { DeskItem } from '../utils/deskBoard';

interface Props {
  item: DeskItem;
  /** Адрес картинки. Фото лежат на сервере, поэтому это обычная ссылка. */
  photoUrl?: string | null;
  selected: boolean;
  /** Ждём вторую карточку для связи — эта уже выбрана как начало. */
  linking: boolean;
  /** Зритель: карточку нельзя ни двигать, ни убрать. */
  readOnly?: boolean;
  /** Перевод координат указателя из окна в большой прокручиваемый холст. */
  toBoardPoint: (clientX: number, clientY: number) => { x: number; y: number };
  onMove: (x: number, y: number) => void;
  /** Отпустили мышь. Не удаление — конец перетаскивания (нужны координаты). */
  onDragEnd: (x: number, y: number) => void;
  onSelect: () => void;
  onEdit: () => void;
  onScale: (factor: number) => void;
  onRotate: (delta: number) => void;
  onDelete: () => void;
  onStartLink: () => void;
  onCancelLink: () => void;
}

const CARD_SHADOW = '0 14px 32px rgba(0,0,0,0.45), 0 3px 8px rgba(0,0,0,0.3)';

export default function DeskCard({
  item, photoUrl, selected, linking, readOnly, toBoardPoint, onMove, onDragEnd, onSelect, onEdit, onScale, onRotate, onDelete, onStartLink, onCancelLink,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const runMenuAction = (action: () => void) => {
    setMenuAnchor(null);
    action();
  };
  // Смещение курсора внутри карточки: без него карточка прыгала бы так, чтобы
  // её левый верхний угол оказался под мышью.
  const grabRef = useRef({ x: 0, y: 0 });
  // Сдвиг, который накопился за текущий жест. Копим в ref, а не в state:
  // пересчёт координат на каждом движении иначе вызывал бы setState в цикле
  // и дёргал карточку назад.
  const movedRef = useRef(false);
  // Порог клика измеряем в экранных координатах, а саму позицию — в координатах холста.
  const startClientRef = useRef({ x: 0, y: 0 });
  // Последняя известная позиция карточки: props обновляются родителем, но между
  // последним движением и отпусканием мыши надёжнее опереться на ref.
  const latestRef = useRef({ x: item.x, y: item.y });
  latestRef.current = { x: item.x, y: item.y };
  // Pointer events позволяют одновременно поддержать мышь, стилус и два пальца.
  // В Map храним экранные координаты активных пальцев, чтобы не зависеть от
  // того, какой из них браузер прислал первым.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{ distance: number; angle: number } | null>(null);
  const tapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const pointerPair = () => Array.from(pointersRef.current.values()).slice(0, 2);
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  const angle = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const angleDelta = (next: number, previous: number) => {
    let delta = next - previous;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Кнопки в углу не должны начинать перетаскивание.
    if ((e.target as HTMLElement).closest('[data-desk-nodrag]')) return;
    onSelect();
    // Зритель может выделить карточку (например, чтобы начать нить), но не
    // двигает её.
    if (readOnly) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch' && pointersRef.current.size >= 2) {
      const pair = pointerPair();
      if (pair.length === 2) {
        gestureRef.current = { distance: distance(pair[0], pair[1]), angle: angle(pair[0], pair[1]) };
        movedRef.current = true;
        setDragging(false);
      }
      return;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const point = toBoardPoint(e.clientX, e.clientY);
    grabRef.current = { x: point.x - item.x, y: point.y - item.y };
    startClientRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (gestureRef.current && pointersRef.current.size >= 2) {
      const pair = pointerPair();
      if (pair.length === 2) {
        const nextDistance = distance(pair[0], pair[1]);
        const nextAngle = angle(pair[0], pair[1]);
        const previous = gestureRef.current;
        if (previous.distance > 1 && nextDistance > 1) onScale(nextDistance / previous.distance);
        const delta = angleDelta(nextAngle, previous.angle);
        if (Math.abs(delta) > 0.05) onRotate(delta);
        gestureRef.current = { distance: nextDistance, angle: nextAngle };
      }
      return;
    }
    if (!dragging) return;
    // Порог в 3 пикселя: иначе обычный клик по карточке считался бы
    // перетаскиванием на ноль пикселей и дёргал её в исходное место.
    if (!movedRef.current && Math.abs(e.clientX - startClientRef.current.x) < 3 && Math.abs(e.clientY - startClientRef.current.y) < 3) return;
    movedRef.current = true;
    const point = toBoardPoint(e.clientX, e.clientY);
    onMove(point.x - grabRef.current.x, point.y - grabRef.current.y);
  };

  const endDrag = (e?: React.PointerEvent) => {
    if (e) pointersRef.current.delete(e.pointerId);
    if (gestureRef.current) {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      setDragging(false);
      return;
    }
    if (!dragging) return;
    setDragging(false);
    // Только завершение жеста. Раньше здесь стоял вызов удаления карточки,
    // из-за чего она исчезала и при обычном клике, и после отпускания мыши.
    // Координаты отдаём наружу: по ним доска решает, не попала ли карточка
    // в папку. Считаем из последней позиции карточки, а не из курсора —
    // иначе при отпускании за пределами холста точка уехала бы мимо.
    if (movedRef.current) {
      const last = latestRef.current;
      onDragEnd(last.x, last.y);
      return;
    }
    // Mobile Safari does not consistently emit a native dblclick for a card.
    // A short second tap has the same meaning as a desktop double click.
    if (e?.pointerType === 'touch' && !readOnly) {
      const now = Date.now();
      const previous = tapRef.current;
      if (previous && now - previous.time < 360 && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 28) {
        tapRef.current = null;
        onEdit();
      } else {
        tapRef.current = { time: now, x: e.clientX, y: e.clientY };
      }
    }
  };

  return (
    <Box
      data-desk-card={item.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-desk-nodrag]')) return;
        if (!readOnly) onEdit();
      }}
      sx={{
        position: 'absolute',
        left: item.x,
        top: item.y,
        width: item.w,
        minHeight: item.h,
        transform: `rotate(${item.rotation}deg)`,
        zIndex: item.z + 10,
        cursor: dragging ? 'grabbing' : 'grab',
        // Пока тянем — никаких переходов: они делают перетаскивание «пьяным».
        transition: dragging ? 'none' : 'box-shadow 180ms ease',
        // touchAction обязателен, иначе телефон прокрутит холст вместо сдвига.
        touchAction: 'none',
        userSelect: 'none',
        boxShadow: selected ? `0 0 0 2px #4facfe, ${CARD_SHADOW}` : CARD_SHADOW,
      }}
    >
      <CardBody item={item} photoUrl={photoUrl} />

      {/* «Канцелярская кнопка» сверху: держит карточку визуально. */}
      <Box sx={{
        position: 'absolute', top: -9, left: '50%', ml: '-7px',
        width: 14, height: 14, borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, #ffe9a8, #d9a441 60%, #8a5f16)',
        boxShadow: '0 3px 5px rgba(0,0,0,0.5)',
      }} />

      {linking && (
        <Box sx={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          boxShadow: '0 0 0 3px #f39c12 inset',
        }} />
      )}

      {/* Кнопки в углу. Зрителю не показываем: он всё равно не может ни
          связать, ни убрать карточку, а серые кнопки только обещали бы
          возможность, которой нет. */}
      {!readOnly && (
        <Box data-desk-nodrag sx={{ position: 'absolute', top: -14, right: -14, display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap' }}>
          <IconButton
            size="small" aria-label="Настройки карточки" aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)}
            onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); }}
            sx={{ width: 28, height: 28, p: 0, flex: '0 0 28px', borderRadius: '50%', bgcolor: 'rgba(20,20,20,0.85)', color: '#fff', '&:hover': { bgcolor: '#2980b9' } }}
          ><MoreVert sx={{ fontSize: 18 }} /></IconButton>
          <IconButton
            size="small"
            aria-label={linking ? 'Отменить связывание' : 'Связать нитью'}
            onClick={(e) => { e.stopPropagation(); if (linking) onCancelLink(); else onStartLink(); }}
            sx={{
              width: 28, height: 28, p: 0, flex: '0 0 28px', borderRadius: '50%', bgcolor: linking ? '#f39c12' : 'rgba(20,20,20,0.85)', color: '#fff',
              '&:hover': { bgcolor: linking ? '#e08e0b' : '#000' },
            }}
          >
            <LinkIcon sx={{ fontSize: 15 }} />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Убрать карточку"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            sx={{ width: 28, height: 28, p: 0, flex: '0 0 28px', borderRadius: '50%', bgcolor: 'rgba(20,20,20,0.85)', color: '#fff', '&:hover': { bgcolor: '#c0392b' } }}
          >
            <Close sx={{ fontSize: 15 }} />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { minWidth: 190, borderRadius: 1 } } }}
          >
            <MenuItem onClick={() => runMenuAction(onEdit)}>Редактировать</MenuItem>
            <MenuItem onClick={() => runMenuAction(() => onRotate(-5))}>Повернуть влево</MenuItem>
            <MenuItem onClick={() => runMenuAction(() => onRotate(5))}>Повернуть вправо</MenuItem>
            <MenuItem onClick={() => runMenuAction(() => onScale(0.9))}>Уменьшить</MenuItem>
            <MenuItem onClick={() => runMenuAction(() => onScale(1.1))}>Увеличить</MenuItem>
          </Menu>
        </Box>
      )}
    </Box>
  );
}

/** Содержимое карточки: вид зависит от типа. */
function CardBody({ item, photoUrl }: { item: DeskItem; photoUrl?: string | null }) {
  if (item.kind === 'photo') {
    return (
      <Box sx={{ bgcolor: '#fdfaf3', p: '10px 10px 0', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}>
        <Box sx={{
          width: '100%', height: Math.max(60, item.h - 44), bgcolor: '#2b2b2b', overflow: 'hidden',
          backgroundImage: photoUrl ? `url(${photoUrl})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
        {/* Полоска под подпись — как у полароида. */}
        <Typography sx={{
          fontFamily: '"Caveat", "Segoe Script", cursive, sans-serif',
          fontSize: 17, lineHeight: '34px', color: '#2b2b2b', textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {item.caption || ' '}
        </Typography>
      </Box>
    );
  }

  if (item.kind === 'message') {
    return (
      <Box sx={{
        bgcolor: '#f3ecd8', p: 1.25, minHeight: item.h,
        // Рваный низ: лист будто вырван из блокнота.
        clipPath: 'polygon(0 0, 100% 0, 100% 94%, 96% 100%, 88% 95%, 78% 100%, 66% 95%, 54% 100%, 42% 95%, 30% 100%, 20% 95%, 10% 100%, 0 96%)',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.10)',
      }}>
        <Typography sx={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#8a6d3b', mb: 0.5 }}>
          Сообщение
        </Typography>
        <Typography sx={{ fontSize: 13, color: '#2b2b2b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {item.text}
        </Typography>
        {item.author && (
          <Typography sx={{ fontSize: 11, color: '#6b6b6b', mt: 0.75, textAlign: 'right' }}>
            — {item.author}
          </Typography>
        )}
      </Box>
    );
  }

  // Заметка на клейкой ленте.
  return (
    <Box sx={{
      bgcolor: '#f7e58c', p: 1.25, minHeight: item.h,
      backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(0,0,0,0.03))',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
    }}>
      <Typography sx={{ fontSize: 14, lineHeight: 1.45, color: '#3a3320', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {item.text || 'Пустая заметка'}
      </Typography>
    </Box>
  );
}