import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { Box, Typography, Avatar, IconButton, Tooltip, Slider, Popover, Button, CircularProgress } from '@mui/material';
import {
  Reply, Delete, ContentCopy, DoneAll, Done, GraphicEq, Pause, Download,
  PushPin, Forward, AddReaction, OpenInNew, Edit, Close,
  Image as ImageIcon, Videocam, AudioFile, PictureAsPdf,
  FolderZip, Description, TableChart, Slideshow,
  TextSnippet, Code, AttachFile, RecordVoiceOver,
} from '@mui/icons-material';
import { Message, User } from '../types';
import { useChatStore } from '../store/chatStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useChatSettingsStore } from '../store/chatSettingsStore';
import { useShopStore, SHOP_CATALOG } from '../store/shopStore';
import { useCustomEquipStore } from '../store/customEquipStore';
import { specToStyle, specAnimationClass } from '../utils/customStyle';
import { buildPlaqueSx, buildShopRingSx } from '../utils/rarityStyles';
import { voiceApi } from '../services/api';
import PlaylistMessageCard, { VeraPlaylistPayload } from './PlaylistMessageCard';
import ContextMenu from './ContextMenu';
import { membranePressSx, motion } from '../styles/motion';

interface Props {
  message: Message;
  isOwn: boolean;
  isHovered?: boolean;
  onHover?: (id: string | null) => void;
  onOpenActions?: (id: string) => void;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onAvatarClick?: (user: User) => void;
  onScrollToMessage?: (messageId: string) => void;
  /** theme.accent — вынесен в пропсы чтобы React.memo учитывал смену темы. */
  accent: string;
  /** Версия темы (инкремент при каждом применении) — принудительно перерисовывает пузыри при смене темы. */
  themeVersion: number;
  /** Фоны пузырей — вынесены в пропсы для реактивности при смене темы. */
  bubbleOwnGradient?: string;
  bgBubbleOwn: string;
  bgBubbleOther: string;
  bubbleOwnShadow?: string;
  bubbleOtherShadow?: string;
}

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '😡', '🎉', '👎', '⭐'];

// Превращает относительный /uploads/... URL в абсолютный, чтобы фото грузилось
// даже когда клиент открыт через туннель (ngrok / cloudflare / production).
function resolveFileUrl(url?: string): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) {
    return window.location.origin + url;
  }
  return url;
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

// ── Аудиоплеер ──────────────────────────────────────────────────────────────
function AudioPlayer({ src, fileName, accent, attachmentId, onTranscribe }: { src: string; fileName?: string; accent: string; attachmentId?: string; onTranscribe?: (id: string) => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcribing, setTranscribing] = useState(false);

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

    try {
      const res = await voiceApi.transcribe(attachmentId);
      const text = (res.data as any).text;
      if (!text) {
        throw new Error('Пустой ответ от сервера');
      }
      if (onTranscribe) onTranscribe(text);
    } catch (e: any) {
      console.error('Transcription failed:', e?.message || e);
      // Показываем понятную ошибку
      const msg = e?.response?.data?.message || e?.message || '';
      alert(
        msg.includes('ECONNREFUSED') || msg.includes('localhost:5000')
          ? '⚠️ AI Engine (Whisper) не запущен.\n\nЗапустите в папке ai-engine:\n  python server.py'
          : `Не удалось распознать голосовое сообщение.\n\n${msg}`
      );
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5,
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
          <IconButton size="small" onClick={handleTranscribe} sx={{
            color: transcribing ? accent : 'rgba(255,255,255,0.4)',
            '&:hover': { color: accent },
          }}>
            {transcribing ? <CircularProgress size={16} sx={{ color: accent }} /> : <RecordVoiceOver sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
      )}
      <a href={src} download style={{ textDecoration: 'none' }}>
        <IconButton size="small" sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#fff' } }}>
          <Download sx={{ fontSize: 16 }} />
        </IconButton>
      </a>
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
        maxWidth: 280, '&:hover .play-overlay': { opacity: 1 },
      }}>
        <video src={src} style={{ display: 'block', width: '100%', borderRadius: 8 }} preload="metadata" />
        <Box className="play-overlay" sx={{
          position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 0.7, transition: 'opacity 0.2s',
        }}>
          <GraphicEq sx={{ fontSize: 52, color: '#fff' }} />
        </Box>
      </Box>
      {modalOpen && (
        <Box onClick={() => setModalOpen(false)} sx={{
          position: 'fixed', inset: 0, zIndex: 9999,
          bgcolor: 'rgba(0,0,0,0.92)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <video src={src} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8 }} />
        </Box>
      )}
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
  isHovered,
  onHover,
  onOpenActions,
  onReply,
  onForward,
  onAvatarClick,
  onScrollToMessage,
  accent,
  themeVersion,
  bubbleOwnGradient,
  bgBubbleOwn,
  bgBubbleOther,
  bubbleOwnShadow,
  bubbleOtherShadow,
}: Props) {
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const { addReaction, pinMessage, editMessage, deleteMessage, sendMessage, addMessage } = useChatStore();
  const { fontSize, emojiSize, fontFamily } = useChatSettingsStore();

  // Активные покупки из магазина: обводка аватара и «плашка» своих сообщений.
  const shopActiveRing = useShopStore((s) => s.activeRing);
  const shopActiveSelfCard = useShopStore((s) => s.activeSelfCard);
  const ringItem = SHOP_CATALOG.find(i => i.applyKey === 'avatarRing' && i.id === shopActiveRing);
  const selfCardItem = SHOP_CATALOG.find(i => i.applyKey === 'selfCard' && i.id === shopActiveSelfCard);
  const shopActiveBubble = useShopStore((s) => s.activeBubble);
  const bubbleItem = SHOP_CATALOG.find(i => i.applyKey === 'bubbleStyle' && i.id === shopActiveBubble);

  // Кастомные предметы от авторов (перебивают выбор из фиксированного каталога).
  const customProfileSpec = useCustomEquipStore((s) => s.equipped.profile ? s.items[s.equipped.profile]?.spec : undefined);
  const customSelfcardSpec = useCustomEquipStore((s) => s.equipped.selfcard ? s.items[s.equipped.selfcard]?.spec : undefined);
  const customBubbleSpec = useCustomEquipStore((s) => s.equipped.bubble ? s.items[s.equipped.bubble]?.spec : undefined);

  const [showActions, setShowActions] = useState(false);
  const [openReply, setOpenReply] = useState(false);
  const [openForward, setOpenForward] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [forwardChatId, setForwardChatId] = useState('');
  const [chatListAnchor, setChatListAnchor] = useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [reactionAnchor, setReactionAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [transcribedText, setTranscribedText] = useState<string | null>(null);

  // Мемоизируем разбиение текста на эмодзи/текст, чтобы не делать это
  // на каждый рендер каждого сообщения (устраняет лаги в больших чатах).
  const contentParts = useMemo(
    () => (message.content ? splitEmoji(message.content) : []),
    [message.content]
  );

  const sender = message.sender;
  const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username : 'Бот';
  const senderAvatar = sender?.avatarUrl ? resolveFileUrl(sender.avatarUrl) : undefined;

  const attachment = message.attachments?.[0];
  const isAudio = attachment?.mimeType?.startsWith('audio/') || message.type === 'voice';
  const isVideo = attachment?.mimeType?.startsWith('video/') || message.type === 'video';
  const isImage = attachment?.mimeType?.startsWith('image/') || message.type === 'photo';
  const isDocument = !isAudio && !isVideo && !isImage && attachment;

  const attachmentUrl = attachment?.fileUrl ? resolveFileUrl(attachment.fileUrl) : '';

  const handleAddReaction = (emoji: string) => {
    addReaction(message.chatId, message.id, emoji);
    setReactionAnchor(null);
  };

  const handleTogglePin = () => {
    pinMessage(message.chatId, message.isPinned ? null : message.id);
  };

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.content) {
      editMessage(message.id, trimmed);
    }
    setEditing(false);
  };

  const handleDelete = () => {
    deleteMessage(message.id, message.chatId);
    setContextMenu(null);
  };

  const handleTranscribedText = (text: string) => {
    // Показываем распознанный текст как текст сообщения в чате
    setTranscribedText(text);
    // Отправляем распознанный текст как новое сообщение в этот же чат
    sendMessage(message.chatId, `🎤 Расшифровка: ${text}`);
  };

  const bubbleTextColor = isOwn ? (theme.bubbleOwnText || '#fff') : theme.text;

  // ── Стиль пузырей из магазина (перебивает тему; кастом авторов перебивает магазин) ──
  const shopBubbleVal = isOwn ? (bubbleItem?.value as any) : undefined;
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
      shopBubbleSx.background = customGradient || bubbleOwnGradient || bgBubbleOwn;
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

  // ── Обводка аватара из магазина ──────────────────────────────────────
  const ringVal = ringItem?.value as any;
  const avatarSx: Record<string, any> = {
    width: 38, height: 38, cursor: 'pointer', flexShrink: 0,
    bgcolor: accent + '70',
    border: `2px solid ${isOwn ? accent : 'transparent'}`,
    transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
  };
  if (ringVal) {
    // Единый стиль обводки из магазина (с анимациями для gradient/glow/pulse/aurora).
    Object.assign(avatarSx, buildShopRingSx(ringVal, accent, false));
  }
  // Кастомная обводка (spec от авторов) — только для собственной аватарки.
  if (isOwn && customProfileSpec) {
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
      selfPlaqueSx.background = `linear-gradient(90deg, ${accent}, ${accent}80)`;
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
  // Кастомная плашка от авторов перебивает.
  let selfPlaqueClass = '';
  if (customSelfcardSpec) {
    Object.assign(selfPlaqueSx, specToStyle(customSelfcardSpec));
    selfPlaqueClass = specAnimationClass(customSelfcardSpec);
  }

  return (
    <Box
      id={`msg-${message.id}`}
      onMouseEnter={() => onHover?.(message.id)}
      onMouseLeave={() => onHover?.(null)}
      sx={{
        display: 'flex', flexDirection: isOwn ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 1,
        px: 2.5, py: 1.2, position: 'relative',
        '&:hover .msg-actions': { opacity: 1 },
      }}
    >
      <Avatar
        src={senderAvatar}
        sx={avatarSx}
        onClick={() => onAvatarClick?.(sender as User)}
      >
        {senderName[0]?.toUpperCase()}
      </Avatar>

      <Box sx={{ maxWidth: '72%', minWidth: 0 }}>
        {!isOwn && (
          <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3, ml: 0.5 }}>
            {senderName}
          </Typography>
        )}
        {isOwn && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.4 }}>
            <Typography component="span" sx={selfPlaqueSx} className={selfPlaqueClass}>
              Вы
            </Typography>
          </Box>
        )}

        <Box
          data-vera-bubble
          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
          className={isOwn && customBubbleSpec ? specAnimationClass(customBubbleSpec) : ''}
          sx={{
            position: 'relative',
            background: isOwn
              ? bubbleOwnGradient || bgBubbleOwn
              : bgBubbleOther,
            color: shopBubbleText || bubbleTextColor,
            boxShadow: isOwn
              ? bubbleOwnShadow
              : bubbleOtherShadow,
            borderRadius: isOwn
              ? `var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) 4px var(--vera-bubble-radius, 16px)`
              : `var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) 4px`,
            px: 1.75, py: 1.25,
            border: `1px solid ${isOwn ? accent + '28' : theme.border}`,
            backdropFilter: 'blur(18px)',
            transition: `background 220ms ${motion.easeOut}, transform 220ms ${motion.spring}, box-shadow 220ms ${motion.easeOut}`,
            transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
            ...(isOwn
              ? { boxShadow: `${bubbleOwnShadow || ''}, 0 0 0 1px ${accent}18 inset` }
              : {}),
            // Кастомный «пузырь» от авторов — перекрывает базовый стиль (только для своих).
            // Стиль пузырей из магазина — между темой и кастомом авторов.
            ...(isOwn ? shopBubbleSx : {}),
            ...(isOwn && customBubbleSpec ? specToStyle(customBubbleSpec) : {}),
          }}
        >
          {message.replyToId && (
            <Box sx={{
              mb: 1, p: 1, borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.08)',
              borderLeft: `3px solid ${theme.accent}`,
            }}>
              <Typography sx={{ fontSize: 12, color: theme.accent, fontWeight: 600 }}>
                {message.replyTo?.sender?.firstName || message.replyTo?.sender?.username || 'Сообщение'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: theme.textSec }} noWrap>
                {message.replyTo?.content || '📎 Вложение'}
              </Typography>
            </Box>
          )}

          {editing ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                  if (e.key === 'Escape') setEditing(false);
                }}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'none',
                  background: 'rgba(0,0,0,0.15)', color: bubbleTextColor,
                  border: `1px solid ${theme.accent}66`, borderRadius: 8,
                  padding: '8px 10px', fontSize, fontFamily,
                }}
              />
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => setEditing(false)} sx={{ color: bubbleTextColor, textTransform: 'none', fontSize: 12, opacity: 0.8 }}>Отмена</Button>
                <Button size="small" onClick={handleSaveEdit} sx={{ bgcolor: theme.accent, color: '#fff', textTransform: 'none', fontSize: 12, borderRadius: 2 }}>Сохранить</Button>
              </Box>
            </Box>
          ) : (
            <>
              {message.content && (
                <Typography sx={{ fontSize, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily }}>
                  {contentParts.map((part, i) =>
                    part.type === 'emoji'
                      ? <span key={i} style={{ fontSize: emojiSize, lineHeight: 1.2 }}>{part.value}</span>
                      : <span key={i}>{part.value}</span>
                  )}
                </Typography>
              )}

              {isAudio && attachment && (
                <AudioPlayer src={attachmentUrl} fileName={attachment.fileName} accent={theme.accent} attachmentId={attachment.id} onTranscribe={handleTranscribedText} />
              )}

              {isVideo && attachment && (
                <VideoPlayer src={attachmentUrl} />
              )}

              {isImage && attachment && (
                <Box component="img" src={attachmentUrl} sx={{
                  maxWidth: '100%',
                  maxHeight: 320,
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  borderRadius: 2, mt: 0.75, cursor: 'pointer',
                  border: `1px solid ${theme.border}`,
                  display: 'block',
                }} onClick={() => window.open(attachmentUrl, '_blank')} />
              )}

              {isDocument && attachment && (
                <Box sx={{ mt: 0.75 }}>
                  {attachment.mimeType === 'application/x-vera-playlist' ? (
                    <PlaylistMessageCard payload={parsePlaylistPayload(attachment)} />
                  ) : (
                    <DocumentPreview url={attachmentUrl} fileName={attachment.fileName} mimeType={attachment.mimeType} accent={theme.accent} />
                  )}
                </Box>
              )}

              {message.isEdited && (
                <Typography sx={{ fontSize: 11, color: bubbleTextColor, opacity: 0.6, mt: 0.3, fontStyle: 'italic' }}>
                  (изменено)
                </Typography>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, justifyContent: 'flex-end' }}>
                <Typography sx={{ fontSize: 11, color: bubbleTextColor, opacity: 0.75 }}>
                  {formatTime(message.createdAt)}
                </Typography>
                {isOwn && (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    {(message as any).status === 'read' ? <DoneAll sx={{ fontSize: 16, color: theme.accent }} /> : <Done sx={{ fontSize: 16 }} />}
                  </Box>
                )}
              </Box>
            </>
          )}
        </Box>

        {/* Реакции */}
        {message.reactions && message.reactions.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.4, flexWrap: 'wrap', justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
            {message.reactions.map((r) => (
              <Box
                key={r.emoji}
                onClick={() => addReaction(message.chatId, message.id, r.emoji)}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.4,
                  bgcolor: 'rgba(255,255,255,0.10)', border: `1px solid ${theme.border}`,
                  borderRadius: 999, px: 0.8, py: 0.2, cursor: 'pointer',
                  fontSize: emojiSize * 0.85,
                  '&:hover': { bgcolor: theme.bgHover },
                }}
              >
                <span>{r.emoji}</span>
                <span style={{ fontSize: 12, color: theme.textSec }}>{r.count}</span>
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.4, justifyContent: isOwn ? 'flex-end' : 'flex-start', opacity: isHovered ? 1 : 0, transition: 'opacity 180ms' }} className="msg-actions">
          <Tooltip title="Ответить">
            <IconButton size="small" onClick={() => onReply(message)} sx={{ color: theme.textSec, ...membranePressSx }}><Reply sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title="Переслать">
            <IconButton size="small" onClick={() => { onForward(message); setOpenForward(true); }} sx={{ color: theme.textSec, ...membranePressSx }}><Forward sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title="Копировать">
            <IconButton size="small" onClick={() => { navigator.clipboard.writeText(message.content || ''); }} sx={{ color: theme.textSec, ...membranePressSx }}><ContentCopy sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title="Реакция">
            <IconButton size="small" onClick={(e) => setReactionAnchor(e.currentTarget)} sx={{ color: theme.textSec, ...membranePressSx }}><AddReaction sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title={message.isPinned ? 'Открепить' : 'Закрепить'}>
            <IconButton size="small" onClick={handleTogglePin} sx={{ color: message.isPinned ? theme.accent : theme.textSec, ...membranePressSx }}><PushPin sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          {isOwn && !editing && (
            <Tooltip title="Редактировать">
              <IconButton size="small" onClick={() => { setEditText(message.content || ''); setEditing(true); }} sx={{ color: theme.textSec, ...membranePressSx }}><Edit sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
          )}
          {isOwn && (
            <Tooltip title="Удалить">
              <IconButton size="small" onClick={handleDelete} sx={{ color: '#f44336', ...membranePressSx }}><Delete sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Попап выбора реакции */}
      <Popover
        open={Boolean(reactionAnchor)}
        anchorEl={reactionAnchor}
        onClose={() => setReactionAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        PaperProps={{
          sx: {
            bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
            borderRadius: 3, p: 1, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.25, flexWrap: 'wrap', maxWidth: 260 }}>
          {REACTION_EMOJIS.map((emoji) => (
            <Box
              key={emoji}
              onClick={() => handleAddReaction(emoji)}
              sx={{
                fontSize: emojiSize, cursor: 'pointer', p: 0.5, borderRadius: 1.5,
                transition: 'transform 0.1s',
                '&:hover': { transform: 'scale(1.3)', bgcolor: theme.bgHover },
              }}
            >
              {emoji}
            </Box>
          ))}
        </Box>
      </Popover>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { key: 'reply', label: 'Ответить', icon: <Reply />, onClick: () => onReply(message) },
            { key: 'forward', label: 'Переслать', icon: <Forward />, onClick: () => onForward(message) },
            { key: 'copy', label: 'Копировать', icon: <ContentCopy />, onClick: () => navigator.clipboard.writeText(message.content || '') },
            { key: 'pin', label: message.isPinned ? 'Открепить' : 'Закрепить', icon: <PushPin />, onClick: () => handleTogglePin() },
            { key: 'react', label: 'Реакция', icon: <AddReaction />, onClick: () => setReactionAnchor({ getBoundingClientRect: () => ({ left: contextMenu.x, top: contextMenu.y, right: contextMenu.x, bottom: contextMenu.y, width: 0, height: 0, x: contextMenu.x, y: contextMenu.y, toJSON: () => ({}) }) } as any) },
            ...(isOwn ? [{ key: 'edit', label: 'Редактировать', icon: <Edit />, onClick: () => { setEditText(message.content || ''); setEditing(true); } }] : []),
            { key: 'delete', label: 'Удалить', icon: <Delete />, danger: true, divider: true, onClick: handleDelete },
          ]}
        />
      )}
    </Box>
  );
}

// Мемоизируем пузырь: перерисовка только когда message/isOwn/isHovered НЕ изменились,
// но принудительно при смене темы (accent / themeVersion).
export default memo(
  MessageBubble,
  (prev, next) =>
    prev.message === next.message &&
    prev.isOwn === next.isOwn &&
    prev.isHovered === next.isHovered &&
    prev.accent === next.accent &&
    prev.themeVersion === next.themeVersion
);
