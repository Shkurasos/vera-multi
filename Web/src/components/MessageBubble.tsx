import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { Box, Typography, Avatar, IconButton, Tooltip, Slider, Popover, Button, CircularProgress } from '@mui/material';
import {
  Reply, Delete, ContentCopy, DoneAll, Done, AccessTime, GraphicEq, Pause, Download,
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
import { useEquipmentStore } from '../store/equipmentStore';
import { useCustomEquipStore } from '../store/customEquipStore';
import { specToStyle, specAnimationClass } from '../utils/customStyle';
import { buildPlaqueSx, buildShopRingSx } from '../utils/rarityStyles';
import { skinColors } from '../utils/skinColors';
import { bubbleSkin, selfcardSkin } from '../utils/bubbleSkin';
import { mirrorBubble } from '../utils/mirrorBubble';
import { clampBubble } from '../utils/bubbleSettings';
import { messagesApi, voiceApi } from '../services/api';
import PlaylistMessageCard, { VeraPlaylistPayload } from './PlaylistMessageCard';
import GroupInviteCard from './GroupInviteCard';
import ContextMenu from './ContextMenu';
import ChannelComments from './ChannelComments';
import { hasGroupRight } from '../services/groupPermissions';
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
  /** Максимальная ширина сообщений (% от ширины окна чата), 35..95. */
  messageMaxWidth?: number;
  /** Сторона сообщений: auto | left | right. */
  messageAlign?: 'auto' | 'left' | 'right';
  bubbleEnabled?: boolean;
  bubbleTextSize?: number;
  bubblePadding?: number;
  /** Соседние сообщения того же автора в пределах одной даты. */
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
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
function ImageViewer({ src, border }: { src: string; border: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    // блокируем скролл фона пока открыт просмотр
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);
  return (
    <>
      <Box onClick={() => setOpen(true)} sx={{
        mt: 0.75, cursor: 'zoom-in',
        display: 'block', maxWidth: '100%',
        overflow: 'hidden', borderRadius: 2,
        border: `1px solid ${border}`,
      }}>
        <Box component="img" src={src} sx={{
          width: '100%', height: 'auto', maxHeight: 420,
          objectFit: 'contain', display: 'block',
        }} />
      </Box>
      {open && createPortal((
        <Box onClick={() => setOpen(false)} sx={{
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
            component="a" href={src} download
            onClick={(e) => e.stopPropagation()}
            sx={{
              position: 'absolute', top: 16, right: 72, color: '#fff',
              bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }, zIndex: 2,
            }}>
            <Download />
          </IconButton>
          <Box component="img" src={src} onClick={(e) => e.stopPropagation()}
            sx={{ maxWidth: '96vw', maxHeight: '94vh', objectFit: 'contain', borderRadius: 1, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }} />
        </Box>
      ), document.body)}
    </>
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
  messageMaxWidth,
  messageAlign,
  bubbleEnabled = true,
  bubbleTextSize,
  bubblePadding = 6,
  isGroupStart = true,
  isGroupEnd = true,
}: Props) {
  const { user } = useAuthStore();
  const groupChat = useChatStore(s => s.chats.find(c => c.id === message.chatId));
  const channelPost = groupChat?.type === 'channel' && !message.replyToId;
  const canEdit = isOwn || hasGroupRight(groupChat?.members.find(m => m.userId === user?.id), 'editMessages');
  const canDelete = isOwn || hasGroupRight(groupChat?.members.find(m => m.userId === user?.id), 'deleteMessages');
  const senderTitle = groupChat?.members.find(m => m.userId === message.senderId && m.role === 'admin')?.adminTitle;
  const { theme } = useThemeStore();
  const { addReaction, pinMessage, editMessage, deleteMessage, sendMessage, addMessage, updateMessage } = useChatStore();
  const { fontSize, emojiSize, fontFamily } = useChatSettingsStore();

  // На какой стороне показывать сообщение.
  // auto — как обычно (свои справа, чужие слева); left/right — все с одной стороны.
  const isOwnSide = messageAlign === 'left' ? false : messageAlign === 'right' ? true : isOwn;
  const maxWidthPct = Math.min(95, Math.max(35, messageMaxWidth || 72));

  // Активные покупки из магазина: обводка аватара и «плашка» своих сообщений.
  const shopActiveRing = useShopStore((s) => s.activeRing);
  const shopActiveSelfCard = useShopStore((s) => s.activeSelfCard);
  const ringItem = SHOP_CATALOG.find(i => i.applyKey === 'avatarRing' && i.id === shopActiveRing);
  const shopActiveBubble = useShopStore((s) => s.activeBubble);

  // Кастомные предметы от авторов (перебивают выбор из фиксированного каталога).
  const customProfileSpec = useCustomEquipStore((s) => s.equipped.profile ? s.items[s.equipped.profile]?.spec : undefined);
  const customSelfcardSpec = useCustomEquipStore((s) => s.equipped.selfcard ? s.items[s.equipped.selfcard]?.spec : undefined);
  const customBubbleSpec = useCustomEquipStore((s) => s.equipped.bubble ? s.items[s.equipped.bubble]?.spec : undefined);

  const [showActions, setShowActions] = useState(false);
  const [openReply, setOpenReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [forwardChatId, setForwardChatId] = useState('');
  const [chatListAnchor, setChatListAnchor] = useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [reactionAnchor, setReactionAnchor] = useState<HTMLElement | null>(null);
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
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
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
    if (!channelPost && !isOwn && message.senderId) void useEquipmentStore.getState().refresh(message.senderId);
  }, [isOwn, message.senderId, message.chatId]);
  const sender = freshSender && !channelPost && !isOwn && equipment ? { ...freshSender, ...equipment } : freshSender;
  const selfCardItem = SHOP_CATALOG.find(i => i.applyKey === 'selfCard' && i.id === (isOwn ? shopActiveSelfCard : sender?.activeSelfCard));
  const bubbleItem = SHOP_CATALOG.find(i => i.applyKey === 'bubbleStyle' && i.id === (isOwn ? shopActiveBubble : sender?.activeBubble));
  const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username : 'Бот';
  // Добавляем cache-busting параметр по themeVersion, чтобы браузер перечитал
  // картинку аватара после смены (иначе кэш держит старую).
  const senderAvatar = sender?.avatarUrl ? resolveFileUrl(sender.avatarUrl) : undefined;

  const attachment = message.attachments?.[0];

  const handleAddReaction = (emoji: string) => {
    void runAction(async () => {
      await addReaction(message.chatId, message.id, emoji);
      setReactionAnchor(null);
    });
  };

  const handleTogglePin = () => {
    void runAction(() => pinMessage(message.chatId, message.isPinned ? null : message.id));
  };

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    void runAction(async () => {
      if (trimmed !== (message.content || '')) {
        if (!trimmed && !message.attachments?.length) throw new Error('Сообщение не может быть пустым');
        await editMessage(message.id, trimmed);
      }
      setEditing(false);
    });
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

  if (shopBubbleVal) {
    Object.assign(shopBubbleSx, bubbleSkin(bubbleItem, accent, colorModes[bubbleItem!.id] === 'theme'));
    shopBubbleText = shopBubbleSx.color;
  }
  const equippedBubbleSx = {
    ...shopBubbleSx,
    ...(isOwn && customBubbleSpec ? specToStyle(customBubbleSpec) : {}),
  };
  // ── Обводка аватара из магазина ──────────────────────────────────────
  // Обводка аватара: для своих сообщений — своя покупка; для чужих — обводка ОТПРАВИТЕЛЯ,
  // переданная сервером (sender.activeRing). Так обводка привязана к аккаунту покупателя.
  const ownRingId = useShopStore((s) => s.activeRing);
  const ringIdForAvatar = isOwn ? ownRingId : (sender?.activeRing || '');
  const ringItemForAvatar = SHOP_CATALOG.find(i => i.applyKey === 'avatarRing' && i.id === (isOwn ? ownRingId : (sender?.activeRing || '')));
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
  // Кастомная плашка от авторов перебивает.
  let selfPlaqueClass = '';
  if (isOwn && customSelfcardSpec) {
    Object.assign(selfPlaqueSx, specToStyle(customSelfcardSpec));
    selfPlaqueClass = specAnimationClass(customSelfcardSpec);
  }

  return (
    <Box
      id={`msg-${message.id}`}
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
        pt: isGroupStart ? { xs: 0.75, md: 1.1 } : 0.15,
        pb: isGroupEnd ? { xs: 1.2, md: 1.6 } : 0.15,
        position: 'relative',
        touchAction: 'pan-y',
        zIndex: isHovered ? 20 : 'auto',
      }}
    >
      {isGroupEnd ? <Avatar
          src={senderAvatar}
          sx={avatarSx}
          onClick={() => !channelPost && onAvatarClick?.(sender as User)}
        >
          {senderName[0]?.toUpperCase()}
        </Avatar> : <Box sx={{ width: 34, flexShrink: 0 }} />}

      <Box
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') { onHover?.(message.id); updateActionsPlacement(e.currentTarget); }
        }}
        onTouchStart={(e) => {
          cancelHold();
          suppressTouchClick.current = false;
          touchOrigin.current = null;
          if (e.touches.length !== 1 || (e.target as HTMLElement).closest('button, a, input, textarea, video, audio, [role="slider"]')) return;
          onHover?.(null);
          const touch = e.touches[0];
          touchOrigin.current = { x: touch.clientX, y: touch.clientY };
          const target = e.currentTarget;
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            suppressTouchClick.current = true;
            updateActionsPlacement(target);
            onHover?.(message.id);
          }, 550);
        }}
        onTouchMove={(e) => {
          const start = touchOrigin.current;
          const touch = e.touches[0];
          if (!start) return;
          if (!touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) {
            cancelHold();
            onHover?.(null);
          }
        }}
        onTouchEnd={cancelHold}
        onTouchCancel={() => { cancelHold(); onHover?.(null); }}
        onClickCapture={(e) => {
          if (!suppressTouchClick.current) return;
          suppressTouchClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') onHover?.(null); }}
        sx={{
          // Редактор не должен наследовать пользовательское ограничение ширины
          // обычных пузырей (например, 35%): на узком окне оно делает поле
          // ввода практически непригодным для текста.
          width: editing ? { xs: '100%', sm: 'min(640px, 100%)' } : 'auto',
          maxWidth: editing ? '100%' : `${maxWidthPct}%`,
          minWidth: 0,
          position: 'relative',
        }}
      >
        {!isOwn && !selfCardItem && isGroupStart && (
          <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3, ml: 0.5 }}>
            {senderName}{senderTitle ? ` · ${senderTitle}` : ''}
          </Typography>
        )}
        {(isOwn || selfCardItem) && isGroupStart && (
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
              onHover?.(message.id);
            } else if (e.button === 2) setContextMenu({ x: e.clientX, y: e.clientY });
          }}
          onPointerDown={(e) => { if (e.pointerType === 'mouse') touchOrigin.current = null; }}
          className={bubbleEnabled && isOwn && customBubbleSpec ? specAnimationClass(customBubbleSpec) : ''}
          sx={{
            position: 'relative',
            '@media (pointer: coarse)': {
              userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
              '& input, & textarea': { userSelect: 'text', WebkitUserSelect: 'text', WebkitTouchCallout: 'default' },
            },
            background: !bubbleEnabled ? 'transparent' : (isOwn
              ? bubbleOwnGradient || bgBubbleOwn
              : bgBubbleOther),
            color: shopBubbleText || bubbleTextColor,
            boxShadow: isOwn
              ? bubbleOwnShadow
              : bubbleOtherShadow,
            borderRadius: isOwnSide
              ? `var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) 4px var(--vera-bubble-radius, 16px)`
              : `var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) var(--vera-bubble-radius, 16px) 4px`,
            maxWidth: '100%', boxSizing: 'border-box',
            border: `1px solid ${isOwn ? accent + '28' : theme.border}`,
            backdropFilter: 'blur(18px)',
            transition: `background 220ms ${motion.easeOut}, transform 220ms ${motion.spring}, box-shadow 220ms ${motion.easeOut}`,
            transform: { xs: 'none', md: isHovered ? 'translateY(-2px)' : 'translateY(0)' },
            ...(isOwn
              ? { boxShadow: `${bubbleOwnShadow || ''}, 0 0 0 1px ${accent}18 inset` }
              : {}),
            // Кастомный «пузырь» от авторов — перекрывает базовый стиль (только для своих).
            // Стиль пузырей из магазина — между темой и кастомом авторов.
            ...(bubbleEnabled ? (isOwnSide ? equippedBubbleSx : mirrorBubble(equippedBubbleSx)) : {}),
            paddingLeft: bubbleEnabled && !channelPost ? '14px' : 0,
            paddingRight: bubbleEnabled && !channelPost ? '14px' : 0,
            paddingTop: bubbleEnabled && !channelPost ? `${clampBubble('padding', bubblePadding)}px` : 0,
            paddingBottom: bubbleEnabled && !channelPost ? `${clampBubble('padding', bubblePadding)}px` : 0,
            minWidth: 0, overflowWrap: 'anywhere',
            '& > *': { maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' },
            ...(!bubbleEnabled ? { background: 'transparent', backgroundImage: 'none', border: 'none', boxShadow: 'none', backdropFilter: 'none', color: theme.text, animation: 'none', '&::before': { display: 'none' }, '&::after': { display: 'none' } } : {}),
          }}
        >
          <Box sx={channelPost ? {
            px: bubbleEnabled ? '14px' : 0,
            py: bubbleEnabled ? `${clampBubble('padding', bubblePadding)}px` : 0,
          } : { display: 'contents' }}>
          {message.forwardFromId && <Typography sx={{ fontSize: 12, color: theme.accent, mb: 0.5 }}>
            Переслано от {message.forwardFromName || 'пользователя'}
          </Typography>}
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
                  width: '100%', minHeight: 96, boxSizing: 'border-box', resize: 'vertical',
                  background: 'rgba(0,0,0,0.15)', color: bubbleTextColor,
                  border: `1px solid ${theme.accent}66`, borderRadius: 8,
                  padding: '8px 10px', fontSize, lineHeight: 1.5, fontFamily,
                }}
              />
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => setEditing(false)} sx={{ color: bubbleTextColor, textTransform: 'none', fontSize: 12, opacity: 0.8 }}>Отмена</Button>
                <Button size="small" onClick={handleSaveEdit} sx={{ bgcolor: theme.accent, color: '#fff', textTransform: 'none', fontSize: 12, borderRadius: 2 }}>Сохранить</Button>
              </Box>
            </Box>
          ) : (
            <Box sx={message.content && !attachment && !message.replyToId && !message.isEdited ? { display: 'flex', alignItems: 'center', gap: 1 } : {}}>
              {message.content && (
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: bubbleTextSize || fontSize, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontFamily }}>
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
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>{message.poll.question}</Typography>
                  {message.poll.options.map(option => {
                    const selected = voted ? !!option.voterIds?.includes(user?.id || '') : pollSelection.includes(option.id);
                    const percent = totalVotes ? Math.round(option.votes / totalVotes * 100) : 0;
                    return <Button fullWidth key={option.id} disabled={pollBusy || voted} aria-pressed={selected} onClick={() => setPollSelection(current => message.poll?.multiple ? (selected ? current.filter(id => id !== option.id) : [...current, option.id]) : [option.id])} sx={{ display: 'block', textAlign: 'left', textTransform: 'none', color: 'inherit', '&.Mui-disabled': { color: 'inherit' }, position: 'relative', overflow: 'hidden', border: `1px solid ${selected ? theme.accent : theme.border}`, borderRadius: 1.5, p: 0.8, mb: 0.7 }}>
                      <Box sx={{ position: 'absolute', inset: 0, width: `${percent}%`, bgcolor: `${theme.accent}22` }} />
                      <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 1 }}><span>{selected ? '✓ ' : ''}{option.text}</span><span>{percent}%</span></Box>
                    </Button>;
                  })}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                    <Typography sx={{ fontSize: 12, opacity: 0.7 }}>Участников: {totalVotes}{message.poll.multiple ? ' · Несколько вариантов' : ''}</Typography>
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

              {(message.attachments?.length || 0) > 1 && <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <IconButton aria-label="Предыдущее вложение" onClick={e => { e.stopPropagation(); const el = attachmentsRef.current; el?.scrollBy({ left: -el.clientWidth, behavior: 'smooth' }); }} sx={{ color: 'inherit' }}>←</IconButton>
                <IconButton aria-label="Следующее вложение" onClick={e => { e.stopPropagation(); const el = attachmentsRef.current; el?.scrollBy({ left: el.clientWidth, behavior: 'smooth' }); }} sx={{ color: 'inherit' }}>→</IconButton>
              </Box>}
              <Box ref={attachmentsRef} tabIndex={message.attachments?.length ? 0 : undefined} role="region" aria-label="Вложения поста" sx={{ display: 'flex', width: message.attachments?.length ? 360 : undefined, maxWidth: '100%', overflowX: 'auto', scrollSnapType: 'x mandatory', gap: 1 }}>
              {(message.attachments || []).map((attachment, index, attachments) => {
                const attachmentUrl = resolveFileUrl(attachment.fileUrl);
                const isAudio = attachment.mimeType?.startsWith('audio/') || (attachments.length === 1 && message.type === 'voice');
                const isVideo = attachment.mimeType?.startsWith('video/') || (attachments.length === 1 && message.type === 'video');
                const isImage = attachment.mimeType?.startsWith('image/') || (attachments.length === 1 && message.type === 'photo');
                const isDocument = !isAudio && !isVideo && !isImage;
                return <Box key={attachment.id || index} sx={{ flex: '0 0 100%', minWidth: 0, scrollSnapAlign: 'start' }}>
                  {attachments.length > 1 && <Typography sx={{ fontSize: 12, opacity: 0.75, mb: 0.5 }}>{index + 1} / {attachments.length} · Листайте →</Typography>}
              {isAudio && attachment && (
                <AudioPlayer src={attachmentUrl} fileName={attachment.fileName} accent={theme.accent} attachmentId={attachment.id} />
              )}

              {isVideo && attachment && (
                /^video-note\.(webm|mp4)$/.test(attachment.fileName || '') ?
                  <video src={attachmentUrl} controls playsInline preload="metadata" style={{ width: 240, maxWidth: '100%', aspectRatio: '1', borderRadius: '50%', objectFit: 'cover' }} /> :
                  <VideoPlayer src={attachmentUrl} />
              )}

              {isImage && attachment && (
                <ImageViewer src={attachmentUrl} border={theme.border} />
              )}

              {isDocument && attachment && (
                <Box sx={{ mt: 0.75 }}>
                  {attachment.mimeType === 'application/x-vera-playlist' ? (
                    <PlaylistMessageCard payload={parsePlaylistPayload(attachment)} />
                  ) : attachment.mimeType === 'application/x-vera-group-invite' ? (
                    <GroupInviteCard attachment={attachment} />
                  ) : (
                    <DocumentPreview url={attachmentUrl} fileName={attachment.fileName} mimeType={attachment.mimeType} accent={theme.accent} />
                  )}
                </Box>
              )}
                </Box>;
              })}
              </Box>

              {message.isEdited && (
                <Typography sx={{ fontSize: 11, color: bubbleTextColor, opacity: 0.6, mt: 0.3, fontStyle: 'italic' }}>
                  (изменено)
                </Typography>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 1, mt: message.content && !attachment && !message.replyToId && !message.isEdited ? 0 : 0.75, justifyContent: 'flex-end' }}>
                <Typography sx={{ fontSize: 11, color: bubbleTextColor, opacity: 0.75 }}>
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
                          ? <DoneAll sx={{ fontSize: 14, color: theme.accent }} />
                          : <Done sx={{ fontSize: 14, color: theme.textSec }} />}
                      </Box>
                    </Tooltip>
                  );
                })()}
              </Box>
            </Box>
          )}
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
                <span>{r.emoji}</span>
                <span style={{ fontSize: 12, color: theme.textSec }}>{r.count}</span>
              </Box>
            ))}
          </Box>
        )}

        {actionError && <Typography role="alert" color="error" sx={{ fontSize: 13, mt: 0.5 }}>{actionError}</Typography>}
        <Box
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onMouseEnter={(e) => { onHover?.(message.id); updateActionsPlacement(e.currentTarget.parentElement as HTMLElement); }}
          onMouseLeave={() => onHover?.(null)}
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
          opacity: isHovered ? 1 : 0, transition: 'opacity 180ms',
          p: 0.25,
          // Панель под пузырём. Держим её вплотную (top:100%) и с невидимой
          // «зоной наведения» сверху через padding — чтобы курсор не терял
          // hover при переходе с пузыря на панель. Плюс собственные mouse-
          // хендлеры удерживают isHovered, пока курсор над панелью.
          // top немного «залезает» внутрь родителя, а pt возвращает визуальный
          // отступ — так между пузырём и панелью нет разрыва, на котором курсор
          // покидал бы родительский Box и mouseleave гасил панель.
          position: 'absolute',
          top: actionsPlacement === 'below' ? 'calc(100% - 8px)' : 'auto',
          bottom: actionsPlacement === 'above' ? 'calc(100% - 8px)' : 'auto',
          left: isOwnSide ? 'auto' : 0,
          right: isOwnSide ? 0 : 'auto',
          pt: actionsPlacement === 'below' ? '12px' : 0,
          pb: actionsPlacement === 'above' ? '12px' : 0,
          bgcolor: theme.bgHeader,
          border: `1px solid ${theme.border}`,
          borderRadius: 2,
          boxShadow: '0 5px 18px rgba(0,0,0,0.35)',
          zIndex: 10,
          pointerEvents: isHovered ? 'auto' : 'none',
          visibility: isHovered ? 'visible' : 'hidden',
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
            <IconButton size="small" onClick={(e) => setReactionAnchor(e.currentTarget)} sx={{ color: theme.textSec, flexShrink: 0, ...membranePressSx }}><AddReaction sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          <Tooltip title={message.isPinned ? 'Открепить' : 'Закрепить'}>
            <IconButton size="small" onClick={handleTogglePin} sx={{ color: message.isPinned ? theme.accent : theme.textSec, flexShrink: 0, ...membranePressSx }}><PushPin sx={{ fontSize: 16 }} /></IconButton>
          </Tooltip>
          {canEdit && !editing && (
            <Tooltip title="Редактировать">
              <IconButton size="small" onClick={() => { setEditText(message.content || ''); setEditing(true); }} sx={{ color: theme.textSec, ...membranePressSx }}><Edit sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
          )}
          {canDelete && (
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
            ...(!channelPost ? [{ key: 'reply', label: 'Ответить', icon: <Reply />, onClick: () => onReply(message) }] : []),
            { key: 'forward', label: 'Переслать', icon: <Forward />, onClick: () => onForward(message) },
            { key: 'copy', label: 'Копировать', icon: <ContentCopy />, onClick: () => navigator.clipboard.writeText(message.content || '') },
            { key: 'pin', label: message.isPinned ? 'Открепить' : 'Закрепить', icon: <PushPin />, onClick: () => handleTogglePin() },
            ...(canEdit ? [{ key: 'edit', label: 'Редактировать', icon: <Edit />, onClick: () => { setEditText(message.content || ''); setEditing(true); } }] : []),
            ...(canDelete ? [{ key: 'delete', label: 'Удалить', icon: <Delete />, danger: true, divider: true, onClick: handleDelete }] : []),
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
    prev.themeVersion === next.themeVersion &&
    prev.messageMaxWidth === next.messageMaxWidth &&
    prev.bubbleEnabled === next.bubbleEnabled &&
    prev.bubbleTextSize === next.bubbleTextSize &&
    prev.bubblePadding === next.bubblePadding &&
    prev.messageAlign === next.messageAlign
    && prev.isGroupStart === next.isGroupStart
    && prev.isGroupEnd === next.isGroupEnd
);
