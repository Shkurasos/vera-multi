import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Box, Typography, Avatar, IconButton, Tooltip, Slider, Popover, Button, CircularProgress } from '@mui/material';
import {
  Reply, Delete, ContentCopy, DoneAll, Done, AccessTime, GraphicEq, Pause, Download,
  PushPin, Forward, AddReaction, OpenInNew, Edit, Close, VolumeUp, VolumeOff,
  Image as ImageIcon, Videocam, AudioFile, PictureAsPdf,
  FolderZip, Description, TableChart, Slideshow,
  TextSnippet, Code, AttachFile, RecordVoiceOver,
  // Через шим: «Выделить» — слот редактора иконок, пак может его заменить.
  CheckCircleOutline,
} from '@mui/icons-material';
import { Message, User } from '../types';
import { useChatStore, MESSAGE_DELETE_EXIT_MS } from '../store/chatStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useChatSettingsStore } from '../store/chatSettingsStore';
import { useChatFontStore } from '../store/chatFontStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { useShopStore, SHOP_CATALOG, findShopItem } from '../store/shopStore';
import { useEquipmentStore } from '../store/equipmentStore';
import { useCustomEquipStore } from '../store/customEquipStore';
import { useChatSkinStore } from '../store/chatSkinStore';
import type { ChatSkinSlot, ChatSkinOverride } from '../store/chatSkinStore';
import { specToStyle, specAnimationClass } from '../utils/customStyle';
import { buildPlaqueSx, buildShopRingSx } from '../utils/rarityStyles';
import { skinColors } from '../utils/skinColors';
import { bubbleSkin, selfcardSkin } from '../utils/bubbleSkin';
import { mirrorBubble } from '../utils/mirrorBubble';
import { ringPoint, continueRingDrag } from '../utils/roundNote';
import { clampBubble, metaOnRight, normalizeMetaPos } from '../utils/bubbleSettings';
import type { BubbleMetaPos } from '../utils/bubbleSettings';
import { clampAlpha, withAlpha, isTranslucentColor } from '../utils/colorAlpha';
import { bubbleBackground } from '../utils/bubbleGradient';
import { useMessageHoverStore } from '../store/messageHoverStore';
import { useMessageSelectionStore } from '../store/messageSelectionStore';
import CheckCircle from '@mui/icons-material/CheckCircle';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import { messagesApi, voiceApi } from '../services/api';
import PlaylistMessageCard, { VeraPlaylistPayload } from './PlaylistMessageCard';
import GroupInviteCard from './GroupInviteCard';
import WarshipGameCard from './WarshipGameCard';
import TicTacToeCard from './TicTacToeCard';
import CallSummaryCard from './CallSummaryCard';
import ContextMenu from './ContextMenu';
import ChannelComments from './ChannelComments';
import { hasGroupRight } from '../services/groupPermissions';
import { spawnMessageDust } from '../utils/messageDust';
import { membranePressSx, motion } from '../styles/motion';
import { useClockAvoid } from '../hooks/useClockAvoid';
import { useReactionSkinStore, reactionLabel } from '../store/reactionSkinStore';
import ReactionGlyph from './ReactionGlyph';

interface Props {
  message: Message;
  isOwn: boolean;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  /** Редактирование перенесено в строку ввода ChatWindow — пузырь только сообщает, какое сообщение править. */
  onEdit?: (message: Message) => void;
  onAvatarClick?: (user: User) => void;
  onScrollToMessage?: (messageId: string) => void;
  /** theme.accent — вынесен в пропсы чтобы React.memo учитывал смену темы. */
  accent: string;
  /** Версия темы (инкремент при каждом применении) — принудительно перерисовывает пузыри при смене темы. */
  themeVersion: number;
  /** Фоны пузырей — вынесены в пропсы для реактивности при смене темы. */
  bubbleOwnGradient?: string;
  /** Градиент чужих пузырей; без него они остаются сплошным bgBubbleOther. */
  bubbleOtherGradient?: string;
  bgBubbleOwn: string;
  bgBubbleOther: string;
  bubbleOwnShadow?: string;
  bubbleOtherShadow?: string;
  /** Цвет времени в пузыре из темы; undefined — как раньше, цвет текста пузыря. */
  messageTimeColor?: string;
  /** Максимальная ширина сообщений (% от ширины окна чата), 35..95. */
  messageMaxWidth?: number;
  /** Сторона сообщений: auto | left | right. */
  messageAlign?: 'auto' | 'left' | 'right';
  bubbleEnabled?: boolean;
  bubbleTextSize?: number;
  bubblePadding?: number;
  /** Выравнивание по стенке: текст прижат к стороне пузыря (свои — вправо, чужие — влево). */
  bubbleWallAlign?: boolean;
  /** Где в пузыре время и галочки. */
  bubbleMetaPos?: BubbleMetaPos;
  /** Соседние сообщения того же автора в пределах одной даты. */
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
}


/**
 * Виртуальный якорь из снятого прямоугольника.
 *
 * Нужен, потому что панель быстрого доступа условно монтируется: как только
 * ховер сбрасывается, кнопка реакции исчезает из DOM. С настоящим элементом
 * MUI измерял бы уже отсоединённый узел (getBoundingClientRect() → нули) и
 * рисовал попап в левом верхнем углу экрана. Координаты не зависят от того,
 * жив элемент или нет, поэтому попап остаётся ровно там, где была кнопка.
 */
/**
 * Виртуальный якорь для Popover: прямоугольник, снятый с кнопки.
 *
 * Нужен, потому что панель быстрого доступа условно монтируется: как только
 * ховер сбрасывается, кнопка реакции исчезает из DOM. С настоящим элементом
 * MUI измерял бы уже отсоединённый узел (getBoundingClientRect() → нули) и
 * рисовал попап в левом верхнем углу экрана. Координаты не зависят от того,
 * жив элемент или нет, поэтому попап остаётся ровно там, где была кнопка.
 *
 * Форма — та, что ждёт MUI: getBoundingClientRect + nodeType.
 */
type VirtualAnchor = {
  top: number;
  left: number;
  width: number;
  height: number;
  getBoundingClientRect: () => DOMRect;
  /** MUI ждёт литеральный тип Node['ELEMENT_NODE'] (== 1). */
  nodeType: 1;
};

function anchorFromRect(r: DOMRect): VirtualAnchor {
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    getBoundingClientRect: () => r,
    nodeType: 1,
  };
}

// Превращает относительный /uploads/... URL в абсолютный, чтобы фото грузилось
// даже когда клиент открыт через туннель (ngrok / cloudflare / production).
// SEC: значение может прийти из чужого сообщения — в href/src пропускаем только
// http(s)/blob, data-медиа и относительные пути; javascript:/data:text/html → ''.
function resolveFileUrl(url?: string): string {
  if (!url) return '';
  const value = String(url).trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (/^data:(?:image|audio|video)\//i.test(value)) return value;
  if (value.startsWith('/')) return window.location.origin + value;
  return '';
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Разбивает текст на части: эмодзи и обычный текст, чтобы эмодзи можно было
// отрисовать с размером из настроек (emojiSize).
function splitEmoji(text: string): { type: 'emoji' | 'text'; value: string }[] {
  const parts: { type: 'emoji' | 'text'; value: string }[] = [];
  const emojiRe = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = emojiRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    parts.push({ type: 'emoji', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts.length ? parts : [{ type: 'text', value: text }];
}

function splitContent(text: string): Array<{ type: 'emoji' | 'text' | 'link'; value: string; href?: string }> {
  const parts: Array<{ type: 'emoji' | 'text' | 'link'; value: string; href?: string }> = [];
  const urlRe = /(?:https?:\/\/[^\s]+|\/#(?:\/|\?)[^\s]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(text)) !== null) {
    const raw = match[0];
    const trailing = raw.match(/[.,!?;:)\]}]+$/)?.[0] || '';
    const value = trailing ? raw.slice(0, -trailing.length) : raw;
    if (match.index > last) parts.push(...splitEmoji(text.slice(last, match.index)));
    if (value) parts.push({ type: 'link', value, href: value });
    if (trailing) parts.push(...splitEmoji(trailing));
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push(...splitEmoji(text.slice(last)));
  return parts.length ? parts : splitEmoji(text);
}

// ── Аудиоплеер ──────────────────────────────────────────────────────────────
function AudioPlayer({ src, fileName, accent, attachmentId }: { src: string; fileName?: string; accent: string; attachmentId?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [transcriptionError, setTranscriptionError] = useState('');

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => setDuration(audio.duration || 0);
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  };

  const handleSeek = (_: any, val: number | number[]) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const t = ((val as number) / 100) * audio.duration;
    audio.currentTime = t;
    setCurrentTime(t);
    setProgress(val as number);
  };

  const handleTranscribe = async () => {
    if (!attachmentId || transcribing) return;
    setTranscribing(true);
    setTranscriptionError('');

    try {
      const res = await voiceApi.transcribe(attachmentId);
      const text = (res.data as any).text;
      if (!text) {
        throw new Error(res.data.message || 'В аудио не удалось обнаружить речь');
      }
      setTranscription(text);
    } catch (e: any) {
      console.error('Transcription failed:', e?.message || e);
      // Показываем понятную ошибку
      const msg = e?.response?.data?.message || e?.message || '';
      setTranscriptionError(msg || 'Не удалось распознать аудио');
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
      bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 3, px: 1.5, py: 1,
      minWidth: 220, maxWidth: 320,
    }}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <IconButton size="small" onClick={togglePlay} sx={{
        bgcolor: accent, color: '#fff', width: 38, height: 38, flexShrink: 0,
        '&:hover': { bgcolor: accent + 'CC' },
      }}>
        {playing ? <Pause sx={{ fontSize: 20 }} /> : <GraphicEq sx={{ fontSize: 20 }} />}
      </IconButton>
      <Box flex={1} minWidth={0}>
        {fileName && (
          <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', mb: 0.3 }} noWrap>{fileName}</Typography>
        )}
        <Slider value={progress} onChange={handleSeek} size="small" sx={{
          color: accent, p: 0, height: 3,
          '& .MuiSlider-thumb': { width: 12, height: 12 },
        }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.2 }}>
          <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{formatDuration(currentTime)}</Typography>
          <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{formatDuration(duration)}</Typography>
        </Box>
      </Box>
      {attachmentId && (
        <Tooltip title={transcribing ? 'Распознавание...' : 'Распознать текст голосового сообщения'}>
          <IconButton size="small" disabled={transcribing} aria-label="Распознать текст" onClick={handleTranscribe} sx={{
            color: transcribing ? accent : 'rgba(255,255,255,0.4)',
            '&:hover': { color: accent },
          }}>
            {transcribing ? <CircularProgress size={16} sx={{ color: accent }} /> : <RecordVoiceOver sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
      )}
      {(transcription || transcriptionError) && <Typography role="status" sx={{ width: '100%', fontSize: 13, whiteSpace: 'pre-wrap', color: transcriptionError ? '#ff8a80' : 'inherit' }}>{transcriptionError || transcription}</Typography>}
      <a href={src} download style={{ textDecoration: 'none' }}>
        <IconButton size="small" sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#fff' } }}>
          <Download sx={{ fontSize: 16 }} />
        </IconButton>
      </a>
    </Box>
  );
}

// ── Просмотр картинки во весь экран ──────────────────────────────────────────
/** Копирует изображение в буфер обмена как PNG (для не-PNG — через canvas). */
async function copyImageToClipboard(url: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
    const resp = await fetch(url);
    const blob = await resp.blob();
    let png: Blob = blob;
    if (blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!converted) return false;
      png = converted;
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

/** Скачивание картинки: URL тот же-origin, поэтому <a download> работает. */
function downloadImage(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface ImageViewerProps {
  src: string;
  border: string;
  /** Плитка VK-коллажа: квадратный кроп, картинка заполняет ячейку сетки. */
  tile?: boolean;
  /** Ячейка растягивается по высоте соседей (первый кадр в коллаже из 3 фото). */
  fill?: boolean;
  /** Все изображения сообщения — для листания в полноэкранном режиме. */
  gallery?: string[];
  /** Индекс этой картинки в галерее (с него открывается просмотр). */
  index?: number;
  /** ПКМ по картинке: (событие, src картинки, на которую кликнули). */
  onContextMenu?: (e: React.MouseEvent, src: string) => void;
}

/** Просмотр картинки: клик открывает полноэкранный лайтбокс (зум, поворот, листание галереи). */
export function ImageViewer({ src, border, tile = false, fill = false, gallery, index = 0, onContextMenu }: ImageViewerProps) {
  const images = gallery && gallery.length ? gallery : [src];
  const safeIndex = Math.min(Math.max(index, 0), images.length - 1);
  const [idx, setIdx] = useState(safeIndex);
  const [open, setOpen] = useState(false);
  // Поворот только в полноэкранном просмотре. Угол копится (−90, 360…), чтобы
  // анимация всегда шла кратчайшим путём, а не крутилась назад через 0.
  const [rotation, setRotation] = useState(0);
  const quarterTurned = (((rotation / 90) % 2) + 2) % 2 === 1;
  const current = images[Math.min(Math.max(idx, 0), images.length - 1)] || src;
  // Новое фото в галерее открывается без поворота.
  useEffect(() => { setRotation(0); }, [idx, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К')) setRotation((r) => r + (e.shiftKey ? -90 : 90));
      else if (images.length > 1 && e.key === 'ArrowRight') setIdx((i) => (i + 1) % images.length);
      else if (images.length > 1 && e.key === 'ArrowLeft') setIdx((i) => (i - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    // блокируем скролл фона пока открыт просмотр
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, images.length]);
  const openAtOwn = () => { setIdx(safeIndex); setOpen(true); };
  // preventDefault/stopPropagation делает обработчик меню (openImageMenu):
  // для тач-долгого нажатия (button !== 2) событие должно всплыть к пузырю,
  // чтобы сработала обычная панель действий сообщения.
  const handleCtx = (e: React.MouseEvent, ctxSrc: string) => {
    if (!onContextMenu) return;
    onContextMenu(e, ctxSrc);
  };
  return (
    <>
      <Box
        onClick={openAtOwn}
        onContextMenu={(e) => handleCtx(e, src)}
        sx={tile ? {
          position: 'relative', display: 'block', width: '100%', minWidth: 0,
          // Растянутая ячейка (коллаж из 3 фото) берёт высоту строк сетки,
          // квадратная — задаёт её сама через aspect-ratio.
          height: fill ? '100%' : undefined,
          aspectRatio: fill ? undefined : '1 / 1',
          cursor: 'zoom-in', overflow: 'hidden', borderRadius: 2,
          border: `1px solid ${border}`,
        } : {
          mt: 0.75, cursor: 'zoom-in',
          display: 'block', maxWidth: '100%',
          overflow: 'hidden', borderRadius: 2,
          border: `1px solid ${border}`,
        }}>
        <Box component="img" src={src} loading="lazy" decoding="async" sx={tile ? {
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', display: 'block',
        } : {
          width: '100%', height: 'auto', maxHeight: 420,
          objectFit: 'contain', display: 'block',
        }} />
      </Box>
      {open && createPortal((
        <Box
          onClick={() => setOpen(false)}
          onContextMenu={(e) => handleCtx(e, current)}
          sx={{
          position: 'fixed', inset: 0, zIndex: 13000,
          bgcolor: 'rgba(0,0,0,0.94)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'zoom-out',
        }}>
          <IconButton onClick={(e) => { e.stopPropagation(); setOpen(false); }} sx={{
            position: 'absolute', top: 16, right: 16, color: '#fff',
            bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }, zIndex: 2,
          }}>
            <Close />
          </IconButton>
          <IconButton
            component="a" href={current} download
            onClick={(e) => e.stopPropagation()}
            sx={{
              position: 'absolute', top: 16, right: 72, color: '#fff',
              bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }, zIndex: 2,
            }}>
            <Download />
          </IconButton>
          {[
            { label: 'Повернуть влево', delta: -90, right: 184, path: 'M7.11 8.53 5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z' },
            { label: 'Повернуть вправо', delta: 90, right: 128, path: 'M15.55 5.55 11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42 1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z' },
          ].map((btn) => (
            <Tooltip key={btn.label} title={`${btn.label} (${btn.delta < 0 ? 'Shift+R' : 'R'})`} PopperProps={{ sx: { zIndex: 13001 } }}>
              <IconButton
                aria-label={btn.label}
                onClick={(e) => { e.stopPropagation(); setRotation((r) => r + btn.delta); }}
                sx={{
                  position: 'absolute', top: 16, right: btn.right, color: '#fff',
                  bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }, zIndex: 2,
                }}>
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d={btn.path} fill="currentColor" /></svg>
              </IconButton>
            </Tooltip>
          ))}
          {images.length > 1 && (
            <>
              <IconButton
                aria-label="Предыдущее фото"
                onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + images.length) % images.length); }}
                sx={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: '#fff', bgcolor: 'rgba(0,0,0,0.5)', zIndex: 2,
                  fontSize: 28, lineHeight: 1, '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                }}>
                ‹
              </IconButton>
              <IconButton
                aria-label="Следующее фото"
                onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % images.length); }}
                sx={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  color: '#fff', bgcolor: 'rgba(0,0,0,0.5)', zIndex: 2,
                  fontSize: 28, lineHeight: 1, '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                }}>
                ›
              </IconButton>
              <Typography
                sx={{
                  position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
                  color: 'rgba(255,255,255,0.85)', fontSize: 13, px: 1.25, py: 0.4,
                  borderRadius: 999, bgcolor: 'rgba(0,0,0,0.5)', zIndex: 2, pointerEvents: 'none',
                }}>
                {Math.min(Math.max(idx, 0), images.length - 1) + 1} / {images.length}
              </Typography>
            </>
          )}
          <Box component="img" src={current} onClick={(e) => e.stopPropagation()}
            sx={{
              // При повороте на 90°/270° ширина и высота меняются местами —
              // меняем и ограничения, чтобы фото целиком влезало в экран.
              maxWidth: quarterTurned ? '94vh' : '96vw',
              maxHeight: quarterTurned ? '96vw' : '94vh',
              objectFit: 'contain', borderRadius: 1, boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              transform: `rotate(${rotation}deg)`,
              transition: 'transform 250ms ease, max-width 250ms ease, max-height 250ms ease',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }} />
        </Box>
      ), document.body)}
    </>
  );
}

// ── Кружок (видеосообщение) ─────────────────────────────────────────────────
// Голый круг без пузыря: видео заполняет круг целиком (cover, края кадра
// обрезаются), прогресс — кольцом поверх края. Кольцо — ещё и перемотка.
const ROUND_SIZE = 320;
const ROUND_RING = 3; // толщина кольца в единицах viewBox (из 100)
const ROUND_HIT = 14; // толщина невидимой зоны захвата для перемотки
const ROUND_CIRCUMFERENCE = Math.PI * (100 - ROUND_RING);
const ROUND_SEEK_STEP = 5; // секунд на стрелку

function RoundVideoNote({ src, accent }: { src: string; accent: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  // Доля, на которой сейчас палец; null — перетаскивания нет.
  const drag = useRef<number | null>(null);
  const ringRadius = 50 - ROUND_RING / 2;

  // У webm из MediaRecorder нет длительности в заголовке (duration = Infinity):
  // перематываем в «бесконечность», браузер дочитывает файл и узнаёт длину.
  const resolveDuration = () => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration) && v.duration > 0) { setDuration(v.duration); return; }
    const onFixed = () => {
      if (!Number.isFinite(v.duration)) return;
      v.removeEventListener('durationchange', onFixed);
      setDuration(v.duration);
      v.currentTime = 0;
    };
    v.addEventListener('durationchange', onFixed);
    v.currentTime = 1e101;
  };

  // Плавное кольцо: rAF вместо редкого timeupdate (~4 раза в секунду).
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && duration > 0 && drag.current === null) {
        setProgress(Math.min(1, v.currentTime / duration));
        setElapsed(v.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const seekTo = (fraction: number) => {
    const v = videoRef.current;
    if (!v || duration <= 0) return;
    const f = Math.max(0, Math.min(1, fraction));
    // Ровно в конец не прыгаем, иначе сработает ended и кольцо сбросится.
    const time = Math.min(f * duration, Math.max(0, duration - 0.05));
    v.currentTime = time;
    setProgress(f);
    setElapsed(time);
  };

  const fractionAt = (e: React.PointerEvent) => {
    const rect = rootRef.current?.getBoundingClientRect();
    return rect ? ringPoint(e.clientX, e.clientY, rect).fraction : 0;
  };

  const onSeekDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (duration <= 0) return; // длина ещё не известна — клик просто запустит видео
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const f = fractionAt(e);
    drag.current = f;
    seekTo(f);
  };
  const onSeekMove = (e: React.PointerEvent<SVGCircleElement>) => {
    if (drag.current === null) return;
    e.stopPropagation();
    const f = continueRingDrag(drag.current, fractionAt(e));
    drag.current = f;
    seekTo(f);
  };
  const onSeekEnd = (e: React.PointerEvent<SVGCircleElement>) => {
    if (drag.current === null) return;
    e.stopPropagation();
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const flipMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const toggleMute = (e: React.MouseEvent) => { e.stopPropagation(); flipMute(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
      e.preventDefault(); e.stopPropagation(); flipMute(); return;
    }
    const v = videoRef.current;
    if (!v || duration <= 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      const delta = e.key === 'ArrowLeft' ? -ROUND_SEEK_STEP : ROUND_SEEK_STEP;
      seekTo((v.currentTime + delta) / duration);
    }
  };

  const shown = playing || elapsed > 0 ? elapsed : duration;
  const label = `${Math.floor(shown / 60)}:${String(Math.floor(shown % 60)).padStart(2, '0')}`;

  return (
    <Box
      ref={rootRef}
      role="button"
      tabIndex={0}
      aria-label={`${playing ? 'Пауза видеосообщения' : 'Воспроизвести видеосообщение'}. Стрелки — перемотка, M — звук`}
      aria-pressed={playing}
      onClick={toggle}
      onKeyDown={onKeyDown}
      sx={{
        position: 'relative', width: ROUND_SIZE, maxWidth: '100%', aspectRatio: '1',
        cursor: 'pointer', borderRadius: '50%', overflow: 'hidden', outline: 'none',
        bgcolor: '#000',
        '&:focus-visible': { boxShadow: `0 0 0 3px ${accent}88` },
      }}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        onLoadedMetadata={resolveDuration}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={() => { if (videoRef.current) setMuted(videoRef.current.muted); }}
        onEnded={() => { setPlaying(false); setProgress(0); setElapsed(0); if (videoRef.current) videoRef.current.currentTime = 0; }}
        style={{
          // Край видео = край круга: кадр обрезается cover'ом, кольцо лежит поверх.
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          borderRadius: '50%', objectFit: 'cover', display: 'block',
        }}
      />
      <svg viewBox="0 0 100 100" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
        <circle cx="50" cy="50" r={ringRadius} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={ROUND_RING} />
        <circle
          cx="50" cy="50" r={ringRadius} fill="none" stroke={accent} strokeWidth={ROUND_RING}
          strokeLinecap="round" strokeDasharray={ROUND_CIRCUMFERENCE}
          strokeDashoffset={ROUND_CIRCUMFERENCE * (1 - progress)}
          style={{ opacity: progress > 0 ? 1 : 0, transition: 'opacity 150ms' }}
        />
        {/* Ручка перемотки на конце прогресса */}
        {duration > 0 && (playing || progress > 0) && (
          <circle
            cx={50 + ringRadius * Math.cos(2 * Math.PI * progress)}
            cy={50 + ringRadius * Math.sin(2 * Math.PI * progress)}
            r={ROUND_RING * 1.4} fill="#fff" stroke={accent} strokeWidth={1}
          />
        )}
        {/* Невидимая зона захвата: кольцо шире видимого, чтобы попадать пальцем */}
        <circle
          data-testid="round-seek"
          cx="50" cy="50" r={50 - ROUND_HIT / 2} fill="none" stroke="transparent" strokeWidth={ROUND_HIT}
          pointerEvents="stroke"
          style={{ cursor: duration > 0 ? 'grab' : 'pointer', touchAction: 'none' }}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekEnd}
          onPointerCancel={onSeekEnd}
          onClick={(e) => { if (duration > 0) e.stopPropagation(); }}
        />
      </svg>
      {/* Время и звук — в нижней части круга, внутри (вне зоны перемотки). */}
      <Box sx={{
        position: 'absolute', left: '50%', bottom: '18%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 0.75,
      }}>
        {duration > 0 && (
          <Box sx={{
            px: 0.8, py: 0.2, borderRadius: 2,
            bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 12, lineHeight: 1.4, pointerEvents: 'none',
          }}>
            {label}
          </Box>
        )}
        <IconButton
          size="small"
          aria-label={muted ? 'Включить звук' : 'Выключить звук'}
          aria-pressed={muted}
          onClick={toggleMute}
          onKeyDown={(e) => e.stopPropagation()}
          sx={{
            p: 0.5, bgcolor: 'rgba(0,0,0,0.5)', color: '#fff',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
            '&:focus-visible': { outline: `2px solid ${accent}` },
          }}
        >
          {muted ? <VolumeOff sx={{ fontSize: 18 }} /> : <VolumeUp sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>
      {!playing && (
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 52, height: 52, borderRadius: '50%', bgcolor: 'rgba(0,0,0,0.45)',
          display: 'grid', placeItems: 'center', pointerEvents: 'none',
        }}>
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#fff" /></svg>
        </Box>
      )}
    </Box>
  );
}

// ── Видеоплеер ───────────────────────────────────────────────────────────────
function VideoPlayer({ src }: { src: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <>
      <Box onClick={() => setModalOpen(true)} sx={{
        position: 'relative', cursor: 'pointer', borderRadius: 2, overflow: 'hidden',
        maxWidth: '100%', display: 'block', height: 'auto',
        '&:hover .play-overlay': { opacity: 1 },
      }}>
        <video src={src} style={{
          display: 'block', width: '100%', height: '100%',
          maxHeight: 420, objectFit: 'contain', background: '#000',
        }} preload="metadata" />
        <Box className="play-overlay" sx={{
          position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 0.7, transition: 'opacity 0.2s',
        }}>
          <GraphicEq sx={{ fontSize: 52, color: '#fff' }} />
        </Box>
      </Box>
      {modalOpen && createPortal((
        <Box onClick={() => setModalOpen(false)} sx={{
          position: 'fixed', inset: 0, zIndex: 13000,
          bgcolor: 'rgba(0,0,0,0.94)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconButton onClick={(e) => { e.stopPropagation(); setModalOpen(false); }} sx={{
            position: 'absolute', top: 16, right: 16, color: '#fff',
            bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }, zIndex: 2,
          }}>
            <Close />
          </IconButton>
          <IconButton
            component="a" href={src} download
            onClick={(e) => e.stopPropagation()}
            sx={{
              position: 'absolute', top: 16, right: 72, color: '#fff',
              bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }, zIndex: 2,
            }}>
            <Download />
          </IconButton>
          <video src={src} controls autoPlay onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '96vw', maxHeight: '94vh', borderRadius: 8, background: '#000' }} />
        </Box>
      ), document.body)}
    </>
  );
}

// Распарсить payload плейлиста из attachment (data — JSON-строка).
function parsePlaylistPayload(attachment: any): VeraPlaylistPayload {
  const fallback: VeraPlaylistPayload = {
    playlistId: '',
    name: attachment?.fileName || 'Плейлист',
    tracks: [],
  };
  const raw = attachment?.data;
  if (!raw) return fallback;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      playlistId: String(parsed.playlistId || ''),
      name: String(parsed.name || fallback.name),
      ownerName: parsed.ownerName ? String(parsed.ownerName) : undefined,
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks.map((t: any) => ({
        id: String(t.id || ''),
        title: String(t.title || ''),
        artist: t.artist ? String(t.artist) : undefined,
      })) : [],
    };
  } catch {
    return fallback;
  }
}

// ── Документ ────────────────────────────────────────────────────────────────
function DocumentPreview({ url, fileName, mimeType, accent }: { url: string; fileName?: string; mimeType?: string; accent: string }) {
  const isImage = mimeType?.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5,
      bgcolor: 'rgba(0,0,0,0.25)', borderRadius: 3, px: 1.5, py: 1.2,
      maxWidth: 320, border: `1px solid ${accent}44`,
    }}>
      <Avatar sx={{ bgcolor: accent + '33', color: accent, width: 38, height: 38 }}>
        {isImage ? <ImageIcon /> : isPdf ? <PictureAsPdf /> : <Description />}
      </Avatar>
      <Box flex={1} minWidth={0}>
        <Typography sx={{ fontSize: 13, color: '#fff', fontWeight: 500 }} noWrap>{fileName || 'Документ'}</Typography>
        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }} noWrap>{mimeType || 'application/octet-stream'}</Typography>
      </Box>
      <Button size="small" variant="outlined" href={url} target="_blank" rel="noreferrer" sx={{ color: accent, borderColor: accent + '66', textTransform: 'none', fontSize: 12 }}>
        Открыть
      </Button>
    </Box>
  );
}

// ── Основной пузырь ─────────────────────────────────────────────────────────
function MessageBubble({
  message,
  isOwn,
  onReply,
  onForward,
  onEdit,
  onAvatarClick,
  onScrollToMessage,
  accent,
  themeVersion,
  bubbleOwnGradient,
  bubbleOtherGradient,
  bgBubbleOwn,
  bgBubbleOther,
  bubbleOwnShadow,
  bubbleOtherShadow,
  messageTimeColor,
  messageMaxWidth,
  messageAlign,
  bubbleEnabled = true,
  bubbleTextSize,
  bubblePadding = 6,
  bubbleWallAlign = false,
  bubbleMetaPos = 'belowLeft',
  isGroupStart = true,
  isGroupEnd = true,
}: Props) {
  const user = useAuthStore((s) => s.user);
  // Узкая подписка на ЧАСТИ чата, а не на весь объект: chats.map в addMessage
  // пересоздаёт объект чата на КАЖДОЕ новое сообщение, и прежний селектор
  // отдавал новую ссылку -> перерисовывались ВСЕ пузыри чата. Через shallow
  // перерисовка случается только при реальном изменении полей чата.
  const groupChat = useChatStore(useShallow((s) => {
    const c = s.chats.find(x => x.id === message.chatId);
    if (!c) return null;
    return {
      type: c.type,
      members: c.members,
      id: c.id,
      name: c.name,
      avatarUrl: c.avatarUrl,
      activeRing: c.activeRing,
      activeSelfCard: c.activeSelfCard,
      activeBubble: c.activeBubble,
    };
  }));
  const channelPost = groupChat?.type === 'channel' && !message.replyToId;
  const canEdit = isOwn || hasGroupRight(groupChat?.members?.find(m => m.userId === user?.id), 'editMessages');
  const canDelete = isOwn || hasGroupRight(groupChat?.members?.find(m => m.userId === user?.id), 'deleteMessages');
  const senderTitle = groupChat?.members?.find(m => m.userId === message.senderId && m.role === 'admin')?.adminTitle;
  // Ховер живёт в отдельном микро-сторе: булев селектор трогает только два
  // затронутых пузыря, а не перерисовывает всё окно чата (как было раньше).
  const isHovered = useMessageHoverStore((s) => s.hoveredId === message.id);
  // Экшены стора стабильны: подписка только на них не вызывает лишних
  // перерисовок при каждом изменении сообщений/печати/присутствия.
  const addReaction = useChatStore((s) => s.addReaction);
  const pinMessage = useChatStore((s) => s.pinMessage);
  const unpinMessage = useChatStore((s) => s.unpinMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  // Флаг анимации удаления: как только стор пометил сообщение удаляемым,
  // пузырь рассыпается на частицы и строка схлопывается до реального remove.
  const isDeleting = useChatStore((s) => s.deletingMessageIds.has(message.id));
  const sendMessage = useChatStore((s) => s.sendMessage);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const theme = useThemeStore((s) => s.theme);
  const fontSize = useChatSettingsStore((s) => s.fontSize);
  const emojiSize = useChatSettingsStore((s) => s.emojiSize);
  // 10 слотов быстрых реакций пользователя (сток или скины из кейса).
  const reactionSlots = useReactionSkinStore((s) => s.slots);
  // Шрифт конкретного чата: при смене перерисовываются только пузыри этого чата.
  const chatFont = useChatFontStore((s) => s.perChatFonts[message.chatId]);
  const globalFontFamily = useUserSettingsStore((s) => s.globalFontFamily);
  const fontFamily = chatFont || globalFontFamily;

  // На какой стороне показывать сообщение.
  // auto — как обычно (свои справа, чужие слева); left/right — все с одной стороны.
  const isOwnSide = messageAlign === 'left' ? false : messageAlign === 'right' ? true : isOwn;
  const maxWidthPct = Math.min(95, Math.max(35, messageMaxWidth || 72));
  // Время и галочки: в строке с текстом (справа/слева) или отдельной строкой снизу.
  const metaPos = normalizeMetaPos(bubbleMetaPos);
  const metaInline = metaPos === 'inlineRight' || metaPos === 'inlineLeft';
  const metaRight = metaOnRight(metaPos, isOwnSide);
  // «По стенке»: текст прижат к стороне, где стоит пузырь, а не к центру ленты.
  const wallTextAlign = bubbleWallAlign ? (isOwnSide ? 'right' : 'left') : undefined;

  // Активные покупки из магазина: обводка аватара и «плашка» своих сообщений.
  const shopActiveRing = useShopStore((s) => s.activeRing);
  const shopActiveSelfCard = useShopStore((s) => s.activeSelfCard);
  const ringItem = findShopItem('avatarRing', shopActiveRing);
  const shopActiveBubble = useShopStore((s) => s.activeBubble);

  // «Мои скины» этого чата (инфопанель): переопределяют глобальные скины
  // ТОЛЬКО для моих собственных сообщений. Ключа нет — как в профиле,
  // '' — без скина, id — конкретный свой скин.
  const chatSkinOverride = useChatSkinStore((s) => (message.chatId ? s.overrides[message.chatId] : undefined));
  const ownOverrideSet = (slot: ChatSkinSlot) => !!chatSkinOverride && slot in chatSkinOverride;
  const ownSkinId = (slot: ChatSkinSlot, globalId: string) =>
    ownOverrideSet(slot) ? (chatSkinOverride![slot] as string) : globalId;

  // Кастомные предметы от авторов (перебивают выбор из фиксированного каталога).
  const customProfileSpec = useCustomEquipStore((s) => s.equipped.profile ? s.items[s.equipped.profile]?.spec : undefined);
  const customSelfcardSpec = useCustomEquipStore((s) => s.equipped.selfcard ? s.items[s.equipped.selfcard]?.spec : undefined);
  const customBubbleSpec = useCustomEquipStore((s) => s.equipped.bubble ? s.items[s.equipped.bubble]?.spec : undefined);

  // Ховер-микро-стор: пишем напрямую (стабильные ссылки на действия), не
  // прокидывая колбэки через props из окна чата.
  const setHoveredId = useMessageHoverStore((s) => s.setHoveredId);
  const hoverSelf = () => setHoveredId(message.id);
  const hoverNone = () => setHoveredId(null);
  // Панель действий живёт отдельно от ховера: ховер поднимает пузырь на любое
  // наведение, а панель открывается только из уголка (мышь) или по долгому
  // тапу (тач). Стор хранит id открытой панели — в чате максимум одна такая,
  // а сброс ховера (setHoveredId(null)) её попутно закрывает.
  const actionsOpen = useMessageHoverStore((s) => s.actionsId === message.id);
  // Режим выделения: булевы селекторы — клик по галочке перерисовывает один пузырь.
  const selectionActive = useMessageSelectionStore((s) => s.chatId === message.chatId);
  const selected = useMessageSelectionStore((s) => !!s.ids[message.id]);
  const storeOpenActions = useMessageHoverStore((s) => s.openActions);
  const openActions = () => storeOpenActions(message.id);
  // Прямоугольник сообщения снимается РОВНО один раз на вход указателя и дальше
  // только читается из памяти. Повторный getBoundingClientRect на каждом
  // pointermove (как в сломанной версии) читал уже сдвинутую подъёмом рамку:
  // тест уголка переворачивался туда-сюда, панель мигала сама по себе,
  // сообщение дрожало, а постоянные layout-пересчёты съедали FPS.
  const bubbleRectRef = useRef<DOMRect | null>(null);

  // Отодвигание от часов: считается по строкам сообщений, поэтому подключается
  // одинаково для своих и чужих — перекрывают часы они оба.
  const rowRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const clockAvoid = useClockAvoid(bubbleRef, rowRef);
  const clockAvoidOn = useUserSettingsStore((st) => st.wallClockAvoid);

  const [showActions, setShowActions] = useState(false);
  const [openReply, setOpenReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [forwardChatId, setForwardChatId] = useState('');
  const [chatListAnchor, setChatListAnchor] = useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // ПКМ по картинке (VK-стиль): отдельное меню с копированием изображения.
  // В состоянии src — конкретная картинка, на которую кликнули.
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number; src: string } | null>(null);
  // Якорь попапа реакций — виртуальный (координаты кнопки на момент клика), а не
  // живой DOM-узел. Панель быстрого доступа условно монтируется ({actionsVisible &&…})
  // и размонтируется, как только сбрасывается ховер. С живым якорем MUI звал
  // getBoundingClientRect() у уже отсоединённой кнопки, получал нули и уводил
  // попап в левый верхний угол экрана. Координаты переживают размонтирование.
  const [reactionAnchor, setReactionAnchor] = useState<VirtualAnchor | null>(null);
  // Пока открыт выбор реакции, панель остаётся смонтированной: попап должен
  // висеть рядом с той панелью, из которой открыт, а не отдельно от неё.
  const actionsVisible = actionsOpen || reactionAnchor !== null;
  const [actionsPlacement, setActionsPlacement] = useState<'above' | 'below'>('below');
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressTouchClick = useRef(false);
  const attachmentsRef = useRef<HTMLDivElement>(null);
  const cancelHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => cancelHold, []);
  const [pollSelection, setPollSelection] = useState<string[]>([]);
  const [pollBusy, setPollBusy] = useState(false);
  const [pollError, setPollError] = useState('');
  const [actionError, setActionError] = useState('');
  const actionBusy = useRef(false);
  const runAction = async (action: () => Promise<void>) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setActionError('');
    try { await action(); }
    catch (error: any) { setActionError(error?.response?.data?.message || error?.message || 'Не удалось сохранить изменение'); }
    finally { actionBusy.current = false; }
  };

  // Мемоизируем разбиение текста на эмодзи/текст, чтобы не делать это
  // на каждый рендер каждого сообщения (устраняет лаги в больших чатах).
  const contentParts = useMemo(
    () => (message.content ? splitContent(message.content) : []),
    [message.content]
  );

  // Актуальные данные отправителя: message.sender — это снапшот на момент отправки,
  // поэтому старый avatarUrl «залипает» на прошлых сообщениях. Берём свежие данные:
  //  • для своих сообщений — из authStore (текущий пользователь);
  //  • для чужих — из members активного чата (там обновляемый avatarUrl).
  const activeChatMembers = useChatStore((s) => s.activeChat?.members);
  const freshSender = useMemo(() => {
    if (channelPost) return { ...message.sender, id: groupChat.id, firstName: groupChat.name, lastName: '', avatarUrl: groupChat.avatarUrl, activeRing: groupChat.activeRing, activeSelfCard: groupChat.activeSelfCard, activeBubble: groupChat.activeBubble };
    if (isOwn && user) return user as any;
    const m = activeChatMembers?.find((mm: any) => mm.userId === message.senderId);
    return (m?.user as any) || message.sender || null;
  }, [isOwn, user, activeChatMembers, message.senderId, message.sender, channelPost, groupChat]);
  const equipment = useEquipmentStore(s => message.senderId ? s.users[message.senderId] : undefined);
  useEffect(() => {
    if (channelPost || isOwn || !message.senderId) return;
    // Загружаем образ отправителя только если его ещё нет в кэше: раньше каждый
    // маунт пузыря слал запрос (throttle отсутствовал), при 200+ сообщениях в чате
    // это десятки одинаковых запросов к /users/:id.
    const cache = useEquipmentStore.getState().users;
    if (cache[message.senderId]) return;
    void useEquipmentStore.getState().refresh(message.senderId);
  }, [isOwn, message.senderId, message.chatId]);
  // «Мои скины» отправителя в этом чате (настраиваются им в инфопанели):
  // переопределяют глобальные скины на ЕГО сообщениях. '' — без скина,
  // ключа нет — как в профиле.
  const senderChatSkins = !isOwn && !channelPost
    ? ((activeChatMembers?.find((mm: any) => mm.userId === message.senderId) as any)?.skins as ChatSkinOverride | undefined)
    : undefined;
  const baseSender = freshSender && !channelPost && !isOwn && equipment ? { ...freshSender, ...equipment } : freshSender;
  const sender = baseSender && senderChatSkins ? {
    ...baseSender,
    activeRing: 'ring' in senderChatSkins ? senderChatSkins.ring : (baseSender as any).activeRing,
    activeSelfCard: 'selfcard' in senderChatSkins ? senderChatSkins.selfcard : (baseSender as any).activeSelfCard,
    activeBubble: 'bubble' in senderChatSkins ? senderChatSkins.bubble : (baseSender as any).activeBubble,
  } : baseSender;
  const selfCardItem = findShopItem('selfCard', isOwn ? ownSkinId('selfcard', shopActiveSelfCard) : sender?.activeSelfCard);
  const bubbleItem = findShopItem('bubbleStyle', isOwn ? ownSkinId('bubble', shopActiveBubble) : sender?.activeBubble);
  const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username : 'Бот';
  // Добавляем cache-busting параметр по themeVersion, чтобы браузер перечитал
  // картинку аватара после смены (иначе кэш держит старую).
  const senderAvatar = sender?.avatarUrl ? resolveFileUrl(sender.avatarUrl) : undefined;

  const attachment = message.attachments?.[0];
  // Кружок без подписи/ответа рисуем без пузыря: только круг и время под ним.
  const isRoundNote = message.attachments?.length === 1
    && /^video-note\.(webm|mp4)$/.test(attachment?.fileName || '')
    && !message.content && !message.replyToId && !message.forwardFromId && !channelPost;

  // ── VK-альбом: все вложения сообщения — картинки ──────────────────────────
  const messageAttachments = message.attachments || [];
  const isImageAttachment = (a: { mimeType?: string }) =>
    a.mimeType?.startsWith('image/') || (messageAttachments.length === 1 && message.type === 'photo');
  const imageAttachments = messageAttachments.filter(isImageAttachment);
  // Альбом рисуем сеткой-коллажем, а не каруселью: так, как в ВК.
  const isPhotoAlbum = messageAttachments.length > 1
    && imageAttachments.length === messageAttachments.length;
  const albumUrls = imageAttachments.map((a) => resolveFileUrl(a.fileUrl));
  // Сколько плиток показывать в сетке (ВК ограничивает альбом, дальше — «ещё»).
  const albumTiles = albumUrls.slice(0, 9);

  // ПКМ/долгое нажатие по картинке: отдельное меню (копировать, сохранить…).
  const openImageMenu = (e: React.MouseEvent, src: string) => {
    // Тач-долгое нажатие (button !== 2) не трогаем — у сообщения своя панель.
    if (e.button !== 2 || !src) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null);
    setImageMenu({ x: e.clientX, y: e.clientY, src });
  };

  const handleAddReaction = (emoji: string) => {
    void runAction(async () => {
      await addReaction(message.chatId, message.id, emoji);
      setReactionAnchor(null);
    });
  };

  const handleTogglePin = () => {
    // Как в Telegram: «Закрепить» добавляет сообщение к списку закреплённых,
    // «Открепить» убирает только это сообщение, остальные остаются.
    void runAction(() => (message.isPinned
      ? unpinMessage(message.chatId, message.id)
      : pinMessage(message.chatId, message.id)));
  };

  const handleDelete = () => {
    void runAction(() => deleteMessage(message.id, message.chatId));
    setContextMenu(null);
  };

  const updateActionsPlacement = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const actionBarHeight = 52;
    const gap = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setActionsPlacement(spaceBelow < actionBarHeight + gap && spaceAbove > spaceBelow ? 'above' : 'below');
  };

  // Зона открытия — 72×32 у нижнего угла: слева у чужих сообщений, справа у
  // своих, то есть там же, где и выезжает панель. Читает только сохранённый
  // прямоугольник и не трогает DOM — открытие панели не может изменить
  // собственный результат проверки и вызвать мигание.
  const inActionsCorner = (clientX: number, clientY: number) => {
    const rect = bubbleRectRef.current;
    if (!rect) return false;
    const fromBottom = rect.bottom - clientY;
    const fromSide = isOwnSide ? rect.right - clientX : clientX - rect.left;
    return fromBottom <= 32 && fromSide >= 0 && fromSide <= 72;
  };


  const bubbleTextColor = isOwn ? (theme.bubbleOwnText || '#fff') : (theme.bubbleOtherText || theme.text);

  // ── Стиль пузырей из магазина (перебивает тему; кастом авторов перебивает магазин) ──
  const shopBubbleVal = bubbleItem?.value as any;
  const ownColorModes = useShopStore(s => s.colorModes);
  const colorModes = isOwn ? ownColorModes : {};
  const shopBubbleSx: Record<string, any> = {};
  let shopBubbleText: string | undefined;
  if (shopBubbleVal) {
    const t = shopBubbleVal.type;
    if (t === 'neon') {
      shopBubbleSx.boxShadow = `0 0 14px ${theme.accent}aa, 0 0 34px ${theme.accent}55`;
      shopBubbleSx.border = `1px solid ${theme.accent}`;
    } else if (t === 'glass') {
      shopBubbleSx.background = 'rgba(255,255,255,0.10)';
      shopBubbleSx.backdropFilter = 'blur(24px) saturate(160%)';
      shopBubbleSx.border = '1px solid rgba(255,255,255,0.22)';
      shopBubbleSx.boxShadow = '0 8px 32px rgba(0,0,0,0.18)';
    } else if (t === 'shadow') {
      shopBubbleSx.boxShadow = '0 14px 34px rgba(0,0,0,0.38), 0 4px 10px rgba(0,0,0,0.22)';
      shopBubbleSx.transform = isHovered ? 'translateY(-3px)' : 'translateY(0)';
    } else if (t === 'gradient') {
      // Градиентные пузыри из магазина: если есть свой градиент (закат/океан/лес),
      // используем его; иначе — градиент текущей темы.
      const customGradient = shopBubbleVal.gradient;
      shopBubbleSx.background = customGradient || bubbleBackground(bgBubbleOwn, bubbleOwnGradient);
      shopBubbleSx.border = 'none';
      shopBubbleSx.boxShadow = '0 6px 18px rgba(0,0,0,0.25)';
    } else if (t === 'minimal') {
      shopBubbleSx.background = 'transparent';
      shopBubbleSx.border = `1px solid ${theme.border}`;
      shopBubbleSx.boxShadow = 'none';
      shopBubbleSx.backdropFilter = 'none';
    } else if (t === 'rounded') {
      shopBubbleSx.borderRadius = 24;
    } else if (t === 'sharp') {
      shopBubbleSx.borderRadius = 2;
    } else if (t === 'retro') {
      shopBubbleSx.background = '#fffde7';
      shopBubbleSx.border = '1px solid #e0d98c';
      shopBubbleText = '#3e3a2a';
    } else if (t === 'candy') {
      let h = 0; for (let i = 0; i < message.id.length; i++) h = (h * 31 + message.id.charCodeAt(i)) >>> 0;
      const pastels = ['#fbcfe8', '#a5f3fc', '#bbf7d0', '#fde68a', '#ddd6fe', '#fecaca', '#c7d2fe'];
      const c = pastels[h % pastels.length];
      shopBubbleSx.background = c;
      shopBubbleSx.border = `1px solid ${c}`;
      shopBubbleText = '#1f2937';
    } else if (t === 'mono') {
      shopBubbleSx.background = '#161616';
      shopBubbleSx.border = '1px solid #3d3d3d';
      shopBubbleSx.boxShadow = '0 6px 16px rgba(0,0,0,0.35)';
      shopBubbleText = '#f5f5f5';
    } else if (t === 'aurora') {
      shopBubbleSx.background = 'linear-gradient(120deg,#43e97b,#38f9d7,#4facfe,#a18cd1,#43e97b)';
      shopBubbleSx.backgroundSize = '300% 300%';
      shopBubbleSx.animation = 'veraAuroraShift 8s ease infinite';
      shopBubbleSx.border = 'none';
      shopBubbleText = '#06283d';
    } else if (t === 'cyber') {
      shopBubbleSx.background = 'rgba(13,13,26,0.92)';
      shopBubbleSx.border = '1px solid #00f0ff';
      shopBubbleSx.boxShadow = '0 0 10px rgba(0,240,255,0.35), inset 0 0 14px rgba(0,240,255,0.12)';
      shopBubbleText = '#e8fdff';
    }
  }

  if (shopBubbleVal) {
    Object.assign(shopBubbleSx, bubbleSkin(bubbleItem, accent, colorModes[bubbleItem!.id] === 'theme'));
    shopBubbleText = shopBubbleSx.color;
  }
  const equippedBubbleSx = {
    ...shopBubbleSx,
    ...(isOwn && customBubbleSpec && !ownOverrideSet('bubble') ? specToStyle(customBubbleSpec) : {}),
  };
  // backdrop-filter реально виден только если сквозь фон что-то просвечивает.
  // За непрозрачной заливкой блюр(18px) не даёт картинки, но заставляет браузер
  // каждый кадр скролла считать блюр для каждого пузыря. Скины из магазина
  // переопределяют и фон, и блюр ниже (их стиль идёт последним), поэтому здесь
  // достаточно смотреть на ИТОГОВЫЙ фон.
  const themeBubbleBackground = isOwn
    ? bubbleBackground(bgBubbleOwn, bubbleOwnGradient)
    : bubbleBackground(bgBubbleOther, bubbleOtherGradient);
  const finalBubbleBackground = (equippedBubbleSx as any).background
    || (!bubbleEnabled ? 'transparent' : themeBubbleBackground);
  const bubbleNeedsBackdropBlur = bubbleEnabled && isTranslucentColor(finalBubbleBackground);
  // Панель действий больше не красится в цвет пузыря: это отдельная прозрачная
  // «стеклянная» плашка (см. sx панели), поэтому скины и градиенты на неё не
  // влияют вообще.
  // ── Цвет времени и «(изменено)» ──────────────────────────────────────
  // Приоритет: настройка темы (персональной темы чата, затем глобальной).
  // Если цвет не задан — как раньше, цвет текста пузыря (с учётом стиля из магазина).
  const timeColor = messageTimeColor || theme.messageTimeColor;
  const messageTimeText = timeColor || shopBubbleText || bubbleTextColor;
  const messageTimeOpacity = timeColor ? 1 : 0.75;
  // «(изменено)» — тот же цвет времени, но чуть приглушённее, когда цвет не задан.
  const editedTextOpacity = timeColor ? 0.85 : 0.6;
  // ── Обводка аватара из магазина ──────────────────────────────────────
  // Обводка аватара: для своих сообщений — своя покупка; для чужих — обводка ОТПРАВИТЕЛЯ,
  // переданная сервером (sender.activeRing). Так обводка привязана к аккаунту покупателя.
  const ownRingId = ownSkinId('ring', shopActiveRing);
  const ringIdForAvatar = isOwn ? ownRingId : (sender?.activeRing || '');
  const ringItemForAvatar = findShopItem('avatarRing', ringIdForAvatar);
  const ringValForAvatar = ringItemForAvatar?.value as any;
  const avatarSx: Record<string, any> = {
    width: 34, height: 34, cursor: 'pointer', flexShrink: 0,
    bgcolor: accent + '70',
    border: `2px solid ${isOwn ? accent : 'transparent'}`,
    transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
  };
  if (ringValForAvatar) {
    // Единый стиль обводки из магазина (с анимациями для gradient/glow/pulse/aurora).
    Object.assign(avatarSx, skinColors(buildShopRingSx(ringValForAvatar, accent, false, 1), ringItemForAvatar, accent, isOwn && colorModes[ringItemForAvatar!.id] === 'theme'));
  }
  // Кастомная обводка (spec от авторов) — только для собственной аватарки
  // и только если в этом чате не выбран явный свой скин.
  if (isOwn && customProfileSpec && !ownOverrideSet('ring')) {
    const st = specToStyle(customProfileSpec);
    avatarSx.border = st.border || avatarSx.border;
    avatarSx.background = st.background;
    avatarSx.boxShadow = st.boxShadow || avatarSx.boxShadow;
  }

  // ─── «Плашка» своих сообщений (вид у других) ────────────────────────
  // Использует accent из пропсов (React.memo корректно реагирует) — а не напрямую из стора.
  const selfPlaqueSx: Record<string, any> = {
    fontSize: 11, lineHeight: 1, px: 0.6, py: 0.4, borderRadius: 1,
    color: accent, bgcolor: accent + '14',
    border: `1px solid ${accent}2E`,
    fontWeight: 600,
  };
  const selfVal = selfCardItem?.value;
  if (selfVal) {
    if (selfVal.type === 'rarity') {
      Object.assign(selfPlaqueSx, buildPlaqueSx(selfVal.rarity, accent));
    } else if (selfVal.type === 'gradient') {
      // Градиентная плашка строится из текущего акцента темы — под тему, а не фиксированный цвет.
      selfPlaqueSx.background = selfVal.gradient || `linear-gradient(90deg, ${accent}, ${accent}80)`;
      selfPlaqueSx.color = '#fff';
      selfPlaqueSx.border = 'none';
      selfPlaqueSx.boxShadow = `0 2px 8px ${accent}44`;
    } else if (selfVal.type === 'badge') {
      selfPlaqueSx.bgcolor = accent;
      selfPlaqueSx.color = '#fff';
      selfPlaqueSx.border = 'none';
      selfPlaqueSx.borderRadius = 999;
      selfPlaqueSx.px = 0.8;
    }
  }
  Object.assign(selfPlaqueSx, skinColors(selfPlaqueSx, selfCardItem, accent, !!selfCardItem && colorModes[selfCardItem.id] === 'theme'));
  if (selfVal?.pack) Object.assign(selfPlaqueSx, selfcardSkin(selfCardItem!, SHOP_CATALOG, accent, colorModes[selfCardItem!.id] === 'theme'));
  // Кастомная плашка от авторов перебивает, если в чате не выбран свой скин.
  let selfPlaqueClass = '';
  if (isOwn && customSelfcardSpec && !ownOverrideSet('selfcard')) {
    Object.assign(selfPlaqueSx, specToStyle(customSelfcardSpec));
    selfPlaqueClass = specAnimationClass(customSelfcardSpec);
  }
  // ─── «По стенке»: пузырь по ширине самой длинной строки ───
  // Перенесённый текст CSS держит на полной max-width, и у прижатого к стенке
  // текста с другой стороны остаётся пустое поле. Меряем реальные строки
  // (Range.getClientRects) и сужаем блок текста до самой широкой из них.
  // Переносы не меняются: новая ширина не меньше любой строки.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const reset = () => { el.style.width = ''; el.style.flex = ''; };
    if (!bubbleWallAlign) { reset(); return; }
    const fit = () => {
      reset();
      const range = document.createRange();
      range.selectNodeContents(el);
      let left = Infinity;
      let right = -Infinity;
      for (const r of Array.from(range.getClientRects())) {
        if (r.width === 0) continue;
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      }
      const width = Math.ceil(right - left) + 1;
      if (Number.isFinite(width) && width > 0 && width < el.clientWidth) {
        el.style.width = `${width}px`;
        el.style.flex = '0 0 auto';
      }
    };
    fit();
    // Ширина ленты меняется (окно, панель) — переносы другие, мерим заново.
    // Следим за строкой, а не за текстом: её ширина от нашей правки не зависит.
    const host = rowRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return reset;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
    ro.observe(host);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); reset(); };
  }, [bubbleWallAlign, message.content, bubbleTextSize, fontSize, fontFamily, maxWidthPct, emojiSize]);



  // ─── Анимация удаления: распад пузыря на частицы + схлопывание строки ───
  // Стор держит флаг MESSAGE_DELETE_EXIT_MS и только потом убирает сообщение
  // из состояния. Частицы спавнятся в портал document.body, поэтому долетают,
  // даже когда строка уже размонтировалась. При reduced-motion стор удаляет
  // мгновенно, флаг не выставляется — эффект не срабатывает.
  useLayoutEffect(() => {
    if (!isDeleting) return;
    const row = rowRef.current;
    const bubble = bubbleRef.current;
    if (bubble) {
      spawnMessageDust(bubble.getBoundingClientRect(), [accent, bubbleTextColor, theme.textSec]);
      bubble.style.transition = `opacity 180ms ${motion.easeOut}, filter 220ms ${motion.easeOut}`;
      bubble.style.opacity = '0';
      bubble.style.filter = 'blur(8px)';
    }
    if (row) {
      // Высота замеряется ДО каких-либо правок — строка схлопывается ровно
      // на свою фактическую высоту, соседи подтягиваются плавно.
      row.style.overflow = 'hidden';
      row.style.height = `${row.scrollHeight}px`;
      void row.offsetHeight; // форсируем reflow, иначе transition не стартует
      row.style.transition = [
        `height ${MESSAGE_DELETE_EXIT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        `padding ${MESSAGE_DELETE_EXIT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        'opacity 160ms ease-out',
      ].join(', ');
      row.style.height = '0px';
      row.style.paddingTop = '0px';
      row.style.paddingBottom = '0px';
      row.style.opacity = '0';
    }
    return () => {
      // Откат (размонтирование/гонка loadMessages до конца анимации):
      // снимаем инлайн-стили, чтобы сообщение не вернулось «сжатым».
      if (row) {
        row.style.transition = '';
        row.style.height = '';
        row.style.paddingTop = '';
        row.style.paddingBottom = '';
        row.style.overflow = '';
        row.style.opacity = '';
      }
      if (bubble) {
        bubble.style.transition = '';
        bubble.style.opacity = '';
        bubble.style.filter = '';
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeleting]);

  return (
    <Box
      id={`msg-${message.id}`}
      ref={rowRef}
      // В режиме выделения вся строка — одна большая кнопка: клик ставит или
      // снимает галочку и не доходит до ссылок, картинок и плееров внутри.
      onClickCapture={selectionActive ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        useMessageSelectionStore.getState().toggle(message.id);
      } : undefined}
      aria-selected={selectionActive ? selected : undefined}
      onContextMenu={selectionActive ? (e) => e.preventDefault() : undefined}
      sx={{
        display: 'flex',
        flexDirection: isOwnSide ? 'row-reverse' : 'row',
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        gap: 0.5,
        // Больший вертикальный ритм между сообщениями и место под панель действий,
        // чтобы соседние сообщения не «ловили» hover пустой плоскостью строки.
        width: '100%', boxSizing: 'border-box',
        px: { xs: 1, md: 1.5 },
        // Слева освобождаем место под кружок выделения.
        ...(selectionActive ? { pl: { xs: 5, md: 5.5 }, cursor: 'pointer' } : {}),
        pt: isGroupStart ? { xs: 0.75, md: 1.1 } : 0.15,
        pb: isGroupEnd ? { xs: 1.2, md: 1.6 } : 0.15,
        position: 'relative',
        touchAction: 'pan-y',
        zIndex: isHovered ? 20 : 'auto',
        bgcolor: selectionActive && selected ? accent + '1F' : undefined,
        transition: 'background-color 150ms ease, padding 150ms ease',
        // Внутренние элементы не перехватывают указатель — иначе hover-эффекты
        // и панели действий мешали бы выделению.
        ...(selectionActive ? { '& > *': { pointerEvents: 'none' } } : {}),
      }}
    >
      {selectionActive && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute', left: { xs: 8, md: 12 }, bottom: isGroupEnd ? { xs: 14, md: 18 } : 6,
            width: 24, height: 24, display: 'grid', placeItems: 'center',
            color: selected ? accent : theme.textSec,
            pointerEvents: 'none',
            '& svg': { fontSize: 24, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.45))' },
          }}
        >
          {selected
            ? <CheckCircle />
            : <RadioButtonUnchecked />}
        </Box>
      )}
      {isGroupEnd ? <Avatar
          src={senderAvatar}
          sx={avatarSx}
          onClick={() => !channelPost && onAvatarClick?.(sender as User)}
        >
          {senderName[0]?.toUpperCase()}
        </Avatar> : <Box sx={{ width: 34, flexShrink: 0 }} />}

      <Box
        ref={bubbleRef}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          // Единственный замер геометрии на весь цикл ховера.
          bubbleRectRef.current = e.currentTarget.getBoundingClientRect();
          hoverSelf();
          updateActionsPlacement(e.currentTarget);
          // Панель действий открывается, только если вход пришёлся в уголок.
          if (inActionsCorner(e.clientX, e.clientY)) openActions();
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse' || actionsOpen) return;
          // Сравниваем координаты с прямоугольником, снятым на вход, — никаких
          // обращений к DOM. Из-за них набор стилей при открытии панели
          // «переворачивал» проверку, панель мигала, и сообщение дрожало.
          if (inActionsCorner(e.clientX, e.clientY)) openActions();
        }}
        onTouchStart={(e) => {
          cancelHold();
          suppressTouchClick.current = false;
          touchOrigin.current = null;
          if (e.touches.length !== 1 || (e.target as HTMLElement).closest('button, a, input, textarea, video, audio, [role="slider"]')) return;
          hoverNone();
          const touch = e.touches[0];
          touchOrigin.current = { x: touch.clientX, y: touch.clientY };
          const target = e.currentTarget;
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            suppressTouchClick.current = true;
            updateActionsPlacement(target);
            hoverSelf();
            openActions();
          }, 550);
        }}
        onTouchMove={(e) => {
          const start = touchOrigin.current;
          const touch = e.touches[0];
          if (!start) return;
          if (!touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) {
            cancelHold();
            hoverNone();
          }
        }}
        onTouchEnd={cancelHold}
        onTouchCancel={() => { cancelHold(); hoverNone(); }}
        onClickCapture={(e) => {
          if (!suppressTouchClick.current) return;
          suppressTouchClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') { hoverNone(); bubbleRectRef.current = null; } }}
        sx={{
          width: 'auto',
          maxWidth: `${maxWidthPct}%`,
          minWidth: 0,
          position: 'relative',
          // Отодвижение от часов — сдвиг вбок трансформацией, а не зазором.
          // Трансформация не участвует в раскладке: лента не растёт, полоса
          // прокрутки не уезжает, и самое нижнее сообщение остаётся на экране.
          // Зазор (margin/padding) тут ломал: высота ленты росла на величину
          // отступа, и нижнее сообщение уходило за край.
          transform: `translateX(${clockAvoid}px)`,
          transition: clockAvoidOn
            ? 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)'
            : 'none',
        }}
      >
        {!isOwn && !selfCardItem && isGroupStart && (
          <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3, ml: 0.5 }}>
            {senderName}{senderTitle ? ` · ${senderTitle}` : ''}
          </Typography>
        )}
        {!isDeleting && (isOwn || selfCardItem) && isGroupStart && (
          <Box sx={{ display: 'flex', justifyContent: isOwnSide ? 'flex-end' : 'flex-start', mb: 0.4 }}>
            <Typography component="span" sx={{ ...selfPlaqueSx, display: 'inline-flex', alignItems: 'center' }} className={selfPlaqueClass}>
              {isOwn ? 'Вы' : senderName}{senderTitle ? ` · ${senderTitle}` : ''}
            </Typography>
          </Box>
        )}

        <Box
          data-vera-bubble
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('input, textarea')) return;
            e.preventDefault();
            e.stopPropagation();
            if (touchOrigin.current) {
              cancelHold();
              suppressTouchClick.current = true;
              updateActionsPlacement(e.currentTarget);
              hoverSelf();
              openActions();
            } else if (e.button === 2) setContextMenu({ x: e.clientX, y: e.clientY });
          }}
          onPointerDown={(e) => { if (e.pointerType === 'mouse') touchOrigin.current = null; }}
          className={bubbleEnabled && isOwn && customBubbleSpec && !ownOverrideSet('bubble') ? specAnimationClass(customBubbleSpec) : ''}
          sx={{
            position: 'relative',
            // Экономим layout/paint сообщений, которые сейчас вне экрана.
            // 'auto' в contain-intrinsic-size заставляет браузер запомнить
            // реальную высоту после первой отрисовки — оценка в 72px нужна
            // только до этого, поэтому длина ленты не «прыгает» при скролле.
            // Важно: это ИМЕННО пузырь, а не строка сообщения — у строки есть
            // панель действий, выходящая за её пределы, и paint containment
            // (часть content-visibility) её бы обрезал.
            contentVisibility: bubbleEnabled ? 'auto' : 'visible',
            containIntrinsicSize: 'auto 72px',
            '@media (pointer: coarse)': {
              userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
              '& input, & textarea': { userSelect: 'text', WebkitUserSelect: 'text', WebkitTouchCallout: 'default' },
            },
            background: !bubbleEnabled ? 'transparent' : themeBubbleBackground,
            color: shopBubbleText || bubbleTextColor,
            boxShadow: isOwn
              ? bubbleOwnShadow
              : bubbleOtherShadow,
            maxWidth: '100%', boxSizing: 'border-box',
            border: `1px solid ${isOwn ? accent + '28' : theme.border}`,
            backdropFilter: bubbleNeedsBackdropBlur ? 'blur(18px)' : 'none',
            transition: `background 220ms ${motion.easeOut}, transform 220ms ${motion.spring}, box-shadow 220ms ${motion.easeOut}`,
            transform: { xs: 'none', md: isHovered ? 'translateY(-2px)' : 'translateY(0)' },
            ...(isOwn
              ? { boxShadow: `${bubbleOwnShadow || ''}, 0 0 0 1px ${accent}18 inset` }
              : {}),
            // Кастомный «пузырь» от авторов — перекрывает базовый стиль (только для своих).
            // Стиль пузырей из магазина — между темой и кастомом авторов.
            ...(bubbleEnabled ? (isOwnSide ? equippedBubbleSx : mirrorBubble(equippedBubbleSx)) : {}),
            // Скругление — строго ПОСЛЕ скина: у скинов магазина и кастомов
            // авторов свой фиксированный borderRadius, и раньше он перебивал
            // ползунок «Скругление сообщений». Шорткат идёт последним, поэтому
            // перекрывает и угловые borderTopLeftRadius и т.п. из скина.
            borderRadius: isOwnSide
              ? `var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) 4px var(--vera-bubble-radius, 16px)`
              : `var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) 4px`,
            paddingLeft: bubbleEnabled && !channelPost ? '14px' : 0,
            paddingRight: bubbleEnabled && !channelPost ? '14px' : 0,
            paddingTop: bubbleEnabled && !channelPost ? `${clampBubble('padding', bubblePadding)}px` : 0,
            paddingBottom: bubbleEnabled && !channelPost ? `${clampBubble('padding', bubblePadding)}px` : 0,
            minWidth: 0, overflowWrap: 'anywhere',
            '& > *': { maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' },
            ...(!bubbleEnabled || isRoundNote ? { background: 'transparent', backgroundImage: 'none', border: 'none', boxShadow: 'none', backdropFilter: 'none', color: theme.text, animation: 'none', '&::before': { display: 'none' }, '&::after': { display: 'none' } } : {}),
            ...(isRoundNote ? { padding: 0, transform: 'none', contentVisibility: 'visible' } : {}),
          }}
        >
          <Box sx={channelPost ? {
            px: bubbleEnabled ? '14px' : 0,
            py: bubbleEnabled ? `${clampBubble('padding', bubblePadding)}px` : 0,
          } : { display: 'contents' }}>
          {message.forwardFromId && <Typography sx={{ fontSize: 12, color: theme.accent, mb: 0.5, fontFamily }}>
            Переслано от {message.forwardFromName || 'пользователя'}
          </Typography>}
          {message.replyToId && (
            <Box sx={{
              mb: 1, p: 1, borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.08)',
              borderLeft: `3px solid ${theme.accent}`,
            }}>
              <Typography sx={{ fontSize: 12, color: theme.accent, fontWeight: 600, fontFamily }}>
                {message.replyTo?.sender?.firstName || message.replyTo?.sender?.username || 'Сообщение'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: theme.textSec, fontFamily }} noWrap>
                {message.replyTo?.content || '📎 Вложение'}
              </Typography>
            </Box>
          )}

          <Box data-vera-meta-pos={metaPos} sx={metaInline && message.content && !attachment && !message.replyToId && !message.isEdited
            ? { display: 'flex', flexDirection: metaPos === 'inlineLeft' ? 'row-reverse' : 'row', alignItems: 'center', gap: 1 }
            : {}}>
              {message.content && (
                <Typography ref={textRef} sx={{ flex: 1, minWidth: 0, textAlign: wallTextAlign, fontSize: bubbleTextSize || fontSize, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontFamily }}>
                  {contentParts.map((part, i) => part.type === 'emoji'
                    ? <span key={i} style={{ fontSize: emojiSize, lineHeight: 1.2 }}>{part.value}</span>
                    : part.type === 'link'
                      ? <a key={i} href={part.href} target={part.href?.startsWith('http') ? '_blank' : undefined}
                        rel={part.href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                        onClick={(event) => event.stopPropagation()}
                        style={{ color: theme.accent, textDecoration: 'underline', overflowWrap: 'anywhere' }}>
                        {part.value}
                      </a>
                      : <span key={i}>{part.value}</span>
                  )}
                </Typography>
              )}

              {message.type === 'poll' && message.poll && (() => {
                const totalVotes = new Set(message.poll.options.flatMap(option => option.voterIds || [])).size;
                const voted = message.poll.options.some(option => option.voterIds?.includes(user?.id || ''));
                return <Box sx={{ mt: 1, p: 1.25, border: `1px solid ${theme.border}`, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.05)' }}>
                  <Typography sx={{ fontWeight: 700, mb: 1, fontFamily }}>{message.poll.question}</Typography>
                  {message.poll.options.map(option => {
                    const selected = voted ? !!option.voterIds?.includes(user?.id || '') : pollSelection.includes(option.id);
                    const percent = totalVotes ? Math.round(option.votes / totalVotes * 100) : 0;
                    return <Button fullWidth key={option.id} disabled={pollBusy || voted} aria-pressed={selected} onClick={() => setPollSelection(current => message.poll?.multiple ? (selected ? current.filter(id => id !== option.id) : [...current, option.id]) : [option.id])} sx={{ display: 'block', textAlign: 'left', textTransform: 'none', color: 'inherit', '&.Mui-disabled': { color: 'inherit' }, position: 'relative', overflow: 'hidden', border: `1px solid ${selected ? theme.accent : theme.border}`, borderRadius: 1.5, p: 0.8, mb: 0.7 }}>
                      <Box sx={{ position: 'absolute', inset: 0, width: `${percent}%`, bgcolor: `${theme.accent}22` }} />
                      <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 1 }}><span>{selected ? '✓ ' : ''}{option.text}</span><span>{percent}%</span></Box>
                    </Button>;
                  })}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                    <Typography sx={{ fontSize: 12, opacity: 0.7, fontFamily }}>Участников: {totalVotes}{message.poll.multiple ? ' · Несколько вариантов' : ''}</Typography>
                    <Button size="small" disabled={voted || !pollSelection.length || pollBusy} onClick={async () => {
                      setPollBusy(true);
                      setPollError('');
                      try { const result = await messagesApi.votePoll(message.id, pollSelection); updateMessage(result.data); setPollSelection([]); }
                      catch (error: any) { setPollError(error.response?.data?.message || 'Не удалось сохранить голос. Попробуйте ещё раз.'); }
                      finally { setPollBusy(false); }
                    }}>{voted ? 'Вы проголосовали' : pollBusy ? 'Отправка…' : 'Проголосовать'}</Button>
                  </Box>
                  {pollError && <Typography role="alert" color="error">{pollError}</Typography>}
                </Box>;
              })()}

              {isPhotoAlbum ? (
                /* VK-альбом: сетка-коллаж вместо карусели (листание — в лайтбоксе). */
                <Box sx={{
                  mt: 0.75, display: 'grid', width: 360, maxWidth: '100%', gap: 0.5,
                  gridTemplateColumns: albumTiles.length >= 5 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
                  // Из 3 фото первое кадрируется вертикально на две строки слева.
                  gridTemplateRows: albumTiles.length === 3 ? 'repeat(2, auto)' : undefined,
                }}>
                  {albumTiles.map((url, i) => (
                    <Box key={`${url}#${i}`} sx={albumTiles.length === 3 && i === 0 ? { gridRow: 'span 2', position: 'relative' } : { position: 'relative' }}>
                      <ImageViewer
                        src={url}
                        border={theme.border}
                        tile
                        fill={albumTiles.length === 3 && i === 0}
                        gallery={albumUrls}
                        index={i}
                        onContextMenu={openImageMenu}
                      />
                      {i === albumTiles.length - 1 && albumUrls.length > albumTiles.length && (
                        <Box sx={{
                          position: 'absolute', inset: 0, zIndex: 1, borderRadius: 2,
                          bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', pointerEvents: 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 22, fontWeight: 700,
                        }}>
                          +{albumUrls.length - albumTiles.length}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              ) : (
                <>
              {(message.attachments?.length || 0) > 1 && <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <IconButton aria-label="Предыдущее вложение" onClick={e => { e.stopPropagation(); const el = attachmentsRef.current; el?.scrollBy({ left: -el.clientWidth, behavior: 'smooth' }); }} sx={{ color: 'inherit' }}>←</IconButton>
                <IconButton aria-label="Следующее вложение" onClick={e => { e.stopPropagation(); const el = attachmentsRef.current; el?.scrollBy({ left: el.clientWidth, behavior: 'smooth' }); }} sx={{ color: 'inherit' }}>→</IconButton>
              </Box>}
              <Box ref={attachmentsRef} tabIndex={message.attachments?.length ? 0 : undefined} role="region" aria-label="Вложения поста" sx={{ display: 'flex', width: message.attachments?.length && !isRoundNote ? 360 : undefined, maxWidth: '100%', overflowX: 'auto', scrollSnapType: 'x mandatory', gap: 1 }}>
              {(message.attachments || []).map((attachment, index, attachments) => {
                const attachmentUrl = resolveFileUrl(attachment.fileUrl);
                const isAudio = attachment.mimeType?.startsWith('audio/') || (attachments.length === 1 && message.type === 'voice');
                // Старые кружки сохранены с mimeType text/plain — узнаём их по имени файла.
                const isVideo = attachment.mimeType?.startsWith('video/') || (attachments.length === 1 && message.type === 'video') || /^video-note\.(webm|mp4)$/.test(attachment.fileName || '');
                const isImage = attachment.mimeType?.startsWith('image/') || (attachments.length === 1 && message.type === 'photo');
                const isDocument = !isAudio && !isVideo && !isImage;
                return <Box key={attachment.id || index} sx={{ flex: '0 0 100%', minWidth: 0, scrollSnapAlign: 'start' }}>
                  {attachments.length > 1 && <Typography sx={{ fontSize: 12, opacity: 0.75, mb: 0.5 }}>{index + 1} / {attachments.length} · Листайте →</Typography>}
              {isAudio && attachment && (
                <AudioPlayer src={attachmentUrl} fileName={attachment.fileName} accent={theme.accent} attachmentId={attachment.id} />
              )}

              {isVideo && attachment && (
                /^video-note\.(webm|mp4)$/.test(attachment.fileName || '') ?
                  <RoundVideoNote src={attachmentUrl} accent={theme.accent} /> :
                  <VideoPlayer src={attachmentUrl} />
              )}

              {isImage && attachment && (
                <ImageViewer src={attachmentUrl} border={theme.border} onContextMenu={openImageMenu} />
              )}

              {isDocument && attachment && (
                <Box sx={{ mt: 0.75 }}>
                  {attachment.mimeType === 'application/x-vera-playlist' ? (
                    <PlaylistMessageCard payload={parsePlaylistPayload(attachment)} />
                  ) : attachment.mimeType === 'application/x-vera-group-invite' ? (
                    <GroupInviteCard attachment={attachment} />
                  ) : attachment.mimeType === 'application/x-vera-warship' ? (
                    <WarshipGameCard attachment={attachment} messageId={message.id} />
                  ) : attachment.mimeType === 'application/x-vera-tictactoe' ? (
                    <TicTacToeCard attachment={attachment} messageId={message.id} />
                  ) : attachment.mimeType === 'application/x-vera-call' ? (
                    <CallSummaryCard attachment={attachment} />
                  ) : (
                    <DocumentPreview url={attachmentUrl} fileName={attachment.fileName} mimeType={attachment.mimeType} accent={theme.accent} />
                  )}
                </Box>
              )}
                </Box>;
              })}
              </Box>
                </>
              )}

              {message.isEdited && (
                <Typography sx={{ fontSize: 11, color: messageTimeText, opacity: editedTextOpacity, mt: 0.3, fontStyle: 'italic', fontFamily }}>
                  (изменено)
                </Typography>
              )}

              <Box sx={{
                display: 'flex', alignItems: 'center', flexShrink: 0, gap: 1,
                // Галочки ставим со стороны края пузыря: у «слева» они идут перед временем.
                flexDirection: metaRight ? 'row' : 'row-reverse',
                mt: metaInline && message.content && !attachment && !message.replyToId && !message.isEdited ? 0 : metaInline ? 0.75 : 0.25,
                justifyContent: metaRight ? 'flex-end' : 'flex-start',
              }}>
                <Typography sx={{ fontSize: 11, color: messageTimeText, opacity: messageTimeOpacity, fontFamily }}>
                  {formatTime(message.createdAt)}
                </Typography>
                {isOwn && (() => {
                  const status = (message as any).status as string | undefined;
                  if (status === 'pending' || status === 'sending' || status === 'failed') {
                    const tip = status === 'failed'
                      ? 'Не удалось отправить — попробуем снова'
                      : 'Ожидает отправки (нет сети или сервер недоступен)';
                    return (
                      <Tooltip title={tip}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <AccessTime sx={{ fontSize: 14, color: status === 'failed' ? '#ff8a80' : theme.textSec }} />
                        </Box>
                      </Tooltip>
                    );
                  }
                  const readBy = message.readBy || [];
                  const readByOthers = readBy.filter(id => id !== message.senderId);
                  const isRead = readByOthers.length > 0;
                  const tooltipText = isRead
                    ? `Прочитано ${readByOthers.length === 1 ? '1 чел.' : `${readByOthers.length} чел.`}`
                    : 'Отправлено';
                  return (
                    <Tooltip title={tooltipText}>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {isRead
                          ? <DoneAll sx={{ fontSize: 14, color: messageTimeText }} />
                          : <Done sx={{ fontSize: 14, color: messageTimeText }} />}
                      </Box>
                    </Tooltip>
                  );
                })()}
              </Box>
            </Box>
          </Box>
          {channelPost && <ChannelComments post={message} />}
        </Box>

        {/* Реакции */}
        {message.reactions && message.reactions.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.4, flexWrap: 'wrap', justifyContent: isOwnSide ? 'flex-end' : 'flex-start' }}>
            {message.reactions.map((r) => (
              <Box
                key={r.emoji}
                onClick={() => handleAddReaction(r.emoji)}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.4,
                  bgcolor: 'rgba(255,255,255,0.10)', border: `1px solid ${theme.border}`,
                  borderRadius: 999, px: 0.8, py: 0.2, cursor: 'pointer',
                  fontSize: emojiSize * 0.85,
                  '&:hover': { bgcolor: theme.bgHover },
                }}
              >
                <ReactionGlyph value={r.emoji} />
                <span style={{ fontSize: 12, color: theme.textSec }}>{r.count}</span>
              </Box>
            ))}
          </Box>
        )}

        {actionError && <Typography role="alert" color="error" sx={{ fontSize: 13, mt: 0.5 }}>{actionError}</Typography>}
        {/* Панель монтируется ТОЛЬКО когда открыта (вход в уголок пузыря или
            долгий тап): раньше она висела в DOM скрытой для каждого сообщения —
            7 IconButton + 7 Tooltip на пузырь, то есть ~2800 лишних узлов на
            200 сообщений — и участвовала в каждом цикле reconcile. Раз
            позиционируется относительно родителя, порядок в DOM не меняется. */}
        {actionsVisible && (
        <Box
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          // Панель — потомок строки сообщения, поэтому pointerleave на неё не
          // срабатывает при переходе курсора с пузыря на кнопки: ховер и панель
          // держит сама строка, размонтирования на шве нет.
          onMouseEnter={(e) => { openActions(); updateActionsPlacement(e.currentTarget.parentElement as HTMLElement); }}
          sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          justifyContent: isOwnSide ? 'flex-end' : 'flex-start',
          alignSelf: isOwnSide ? 'flex-end' : 'flex-start',
          width: 'max-content',
          maxWidth: 'calc(100vw - 24px)',
          boxSizing: 'border-box',
          flexWrap: 'nowrap',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          touchAction: 'pan-x',
          opacity: isHovered || reactionAnchor ? 1 : 0, transition: 'opacity 180ms',
          p: 0.25,
          // Панель под пузырём и ни на что не давит: position:absolute держит
          // раскладку ленты прежней. Видимую плашку рисует ::before, а сама
          // панель сверху остаётся прозрачной полосой-мостиком — на ней курсор
          // не теряет ховер при переходе с пузыря на кнопки.
          position: 'absolute',
          top: actionsPlacement === 'below' ? 'calc(100% - 2px)' : 'auto',
          bottom: actionsPlacement === 'above' ? 'calc(100% - 2px)' : 'auto',
          left: isOwnSide ? 'auto' : 0,
          right: isOwnSide ? 0 : 'auto',
          pt: actionsPlacement === 'below' ? '12px' : 0,
          pb: actionsPlacement === 'above' ? '12px' : 0,
          // Прозрачная «стеклянная» плашка: подложка с полупрозрачным фоном и
          // размытием, скругление со всех сторон, тонкая рамка и мягкая тень.
          // isolation удерживает слой внутри панели, чтобы ::before с z-index:-1
          // не уехал под фон чата.
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
          isolation: 'isolate',
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0, right: 0,
            top: actionsPlacement === 'above' ? 0 : '12px',
            bottom: actionsPlacement === 'above' ? '12px' : 0,
            zIndex: -1,
            pointerEvents: 'none',
            background: withAlpha(theme.bgInput, 0.72),
            backdropFilter: 'blur(16px) saturate(1.25)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.25)',
            border: `1px solid ${theme.border}`,
            borderRadius: 14,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          },
          zIndex: 10,
          pointerEvents: 'auto',
        }} className="msg-actions">
          {!channelPost && <Tooltip title="Ответить">
            <IconButton size="small" onClick={() => onReply(message)} sx={{ color: theme.textSec, flexShrink: 0, ...membranePressSx }}><Reply sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>}
          <Tooltip title="Переслать">
            <IconButton size="small" onClick={() => onForward(message)} sx={{ color: theme.textSec, flexShrink: 0, ...membranePressSx }}><Forward sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title="Копировать">
            <IconButton size="small" onClick={() => { navigator.clipboard.writeText(message.content || ''); }} sx={{ color: theme.textSec, flexShrink: 0, ...membranePressSx }}><ContentCopy sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title="Реакция">
            <IconButton size="small" onClick={(e) => {
              // Снимаем прямоугольник кнопки ЗДЕСЬ, пока она ещё в DOM.
              setReactionAnchor(anchorFromRect(e.currentTarget.getBoundingClientRect()));
            }} sx={{ color: theme.textSec, flexShrink: 0, ...membranePressSx }}><AddReaction sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title={message.isPinned ? 'Открепить' : 'Закрепить'}>
            <IconButton size="small" onClick={handleTogglePin} sx={{ color: message.isPinned ? theme.accent : theme.textSec, flexShrink: 0, ...membranePressSx }}><PushPin sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          {/* На таче нет ПКМ — выделение запускается из панели долгого тапа. */}
          <Tooltip title="Выделить">
            <IconButton size="small" onClick={() => { hoverNone(); useMessageSelectionStore.getState().start(message.chatId, message.id); }} sx={{ color: theme.textSec, flexShrink: 0, ...membranePressSx }}><CheckCircleOutline sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          {canEdit && (
            <Tooltip title="Редактировать">
              <IconButton size="small" onClick={() => onEdit?.(message)} sx={{ color: theme.textSec, ...membranePressSx }}><Edit sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip title="Удалить">
              <IconButton size="small" onClick={handleDelete} sx={{ color: '#f44336', ...membranePressSx }}><Delete sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
          )}
        </Box>
        )}
      </Box>

      {/* Попап выбора реакции: открывается НАД строкой панели, начинаясь от
          правого края кнопки-триггера. Панель и триггер остаются видимыми
          СЛЕВА от эмодзи (раньше попап падал под кнопкой и перекрывал
          панель с сообщениями снизу). MUI сам прижимает попап к краю
          экрана, если справа не хватает места. */}
      <Popover
        open={Boolean(reactionAnchor)}
        anchorEl={reactionAnchor}
        onClose={() => setReactionAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{
          sx: {
            bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
            borderRadius: 3, p: 1, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.25, flexWrap: 'wrap', maxWidth: 260 }}>
          {reactionSlots.map((emoji) => (
            <Box
              key={emoji}
              role="button"
              aria-label={`Поставить реакцию ${reactionLabel(emoji)}`}
              onClick={() => handleAddReaction(emoji)}
              sx={{
                fontSize: emojiSize, cursor: 'pointer', p: 0.5, borderRadius: 1.5,
                transition: 'transform 0.1s',
                '&:hover': { transform: 'scale(1.3)', bgcolor: theme.bgHover },
              }}
            >
              <ReactionGlyph value={emoji} />
            </Box>
          ))}
        </Box>
      </Popover>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          header={
            // Быстрые реакции прямо в ПКМ-меню: те же 10 слотов, что и в попапе «Реакция».
            <Box role="group" aria-label="Реакции" data-vera-context-reactions
              sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25, px: 0.5, py: 0.25, maxWidth: 260 }}>
              {reactionSlots.map((emoji) => (
                <Box
                  key={emoji}
                  component="button"
                  type="button"
                  aria-label={`Поставить реакцию ${reactionLabel(emoji)}`}
                  title={reactionLabel(emoji)}
                  onClick={() => { handleAddReaction(emoji); setContextMenu(null); }}
                  sx={{
                    fontSize: emojiSize, lineHeight: 1, cursor: 'pointer', p: 0.5, borderRadius: 1.5,
                    border: 0, bgcolor: 'transparent', color: 'inherit',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'transform 0.1s',
                    '&:hover': { transform: 'scale(1.3)', bgcolor: theme.bgHover },
                    '&:focus-visible': { outline: `2px solid ${theme.accent}`, outlineOffset: 1 },
                  }}
                >
                  <ReactionGlyph value={emoji} />
                </Box>
              ))}
            </Box>
          }
          items={[
            ...(!channelPost ? [{ key: 'reply', label: 'Ответить', icon: <Reply />, onClick: () => onReply(message) }] : []),
            { key: 'forward', label: 'Переслать', icon: <Forward />, onClick: () => onForward(message) },
            { key: 'copy', label: 'Копировать', icon: <ContentCopy />, onClick: () => navigator.clipboard.writeText(message.content || '') },
            { key: 'pin', label: message.isPinned ? 'Открепить' : 'Закрепить', icon: <PushPin />, onClick: () => handleTogglePin() },
            { key: 'select', label: 'Выделить', icon: <CheckCircleOutline />, onClick: () => { hoverNone(); useMessageSelectionStore.getState().start(message.chatId, message.id); } },
            ...(canEdit ? [{ key: 'edit', label: 'Редактировать', icon: <Edit />, onClick: () => onEdit?.(message) }] : []),
            ...(canDelete ? [{ key: 'delete', label: 'Удалить', icon: <Delete />, danger: true, divider: true, onClick: handleDelete }] : []),
          ]}
        />
      )}

      {imageMenu && (
        <ContextMenu
          x={imageMenu.x}
          y={imageMenu.y}
          zIndex={14000}
          onClose={() => setImageMenu(null)}
          title="Изображение"
          items={[
            {
              key: 'copy-image',
              label: 'Копировать изображение',
              icon: <ContentCopy />,
              onClick: () => {
                void copyImageToClipboard(imageMenu.src).then((ok) => {
                  if (!ok) void navigator.clipboard?.writeText(imageMenu.src);
                });
              },
            },
            {
              key: 'copy-link',
              label: 'Копировать ссылку',
              icon: <OpenInNew />,
              onClick: () => navigator.clipboard.writeText(imageMenu.src),
            },
            { key: 'open', label: 'Открыть в новой вкладке', icon: <OpenInNew />, onClick: () => window.open(imageMenu.src, '_blank', 'noopener,noreferrer') },
            { key: 'save', label: 'Сохранить', icon: <Download />, onClick: () => downloadImage(imageMenu.src) },
            ...(!channelPost ? [{ key: 'reply', label: 'Ответить', icon: <Reply />, divider: true, onClick: () => onReply(message) }] : []),
            { key: 'forward', label: 'Переслать', icon: <Forward />, divider: !!channelPost, onClick: () => onForward(message) },
          ]}
        />
      )}
    </Box>
  );
}

// Мемоизируем пузырь: перерисовка только когда message/isOwn НЕ изменились,
// но принудительно при смене темы (accent / themeVersion). isHovered больше не
// проп — ховер приходит из микро-стора и меняет ровно два пузыря.
export default memo(
  MessageBubble,
  (prev, next) =>
    prev.message === next.message &&
    prev.isOwn === next.isOwn &&
    prev.accent === next.accent &&
    prev.themeVersion === next.themeVersion &&
    prev.messageMaxWidth === next.messageMaxWidth &&
    prev.bubbleEnabled === next.bubbleEnabled &&
    prev.bubbleTextSize === next.bubbleTextSize &&
    prev.bubblePadding === next.bubblePadding &&
    prev.messageTimeColor === next.messageTimeColor &&
    prev.messageAlign === next.messageAlign
    && prev.bubbleWallAlign === next.bubbleWallAlign
    && prev.bubbleMetaPos === next.bubbleMetaPos
    && prev.isGroupStart === next.isGroupStart
    && prev.isGroupEnd === next.isGroupEnd
);
