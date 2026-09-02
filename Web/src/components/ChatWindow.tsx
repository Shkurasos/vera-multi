import React, { useEffect, useRef, useState, useMemo, useCallback, Component, ErrorInfo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Avatar, IconButton, TextField,
  Menu, MenuItem, Tooltip, LinearProgress, Popover,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Slider, Select, Divider as MuiDivider, Snackbar, Alert,
} from '@mui/material';
import {
  Send, Send as SendIcon, AttachFile, MoreVert, Search, Mic, Stop,
  EmojiEmotions, InfoOutlined, Close, PushPin,
  Call, Videocam, NotificationsOff, NotificationsActive,
  FormatSize, ExitToApp, ArrowBack, Palette,
} from '@mui/icons-material';
import { CallModal } from './CallModal';
import { useCallStore } from '../store/callStore';
import { useChatStore } from '../store/chatStore';
import { useChatPrefsStore } from '../store/chatPrefsStore';
import { useChatSoundStore } from '../store/chatSoundStore';
import NotificationSettingsDialog from './NotificationSettingsDialog';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { useChatSettingsStore, BUILTIN_FONTS } from '../store/chatSettingsStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { sendTypingStart, sendTypingStop } from '../services/socket';
import { filesApi, messagesApi } from '../services/api';
import MessageBubble from './MessageBubble';
import { membranePressSx, motion } from '../styles/motion';
import ChatInfoPanel from './ChatInfoPanel';
import UserProfileModal from './UserProfileModal';
import { Message, User } from '../types';
import ChatThemeDialog from './ChatThemeDialog';
import { useChatThemeStore } from '../store/chatThemeStore';
import { useShopStore, SHOP_CATALOG } from '../store/shopStore';
import { useCustomEquipStore } from '../store/customEquipStore';
import { specToStyle, specAnimationClass } from '../utils/customStyle';
import { saveLiveBg, loadLiveBgUrl, clearLiveBg, hasLiveBg } from '../services/chatLiveBgStorage';
import ChatWallpaper, { type WallpaperSpec } from './ChatWallpaper';

// ── ErrorBoundary ─────────────────────────────────────────────────────────────
class ChatErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('ChatWindow error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <Box display="flex" alignItems="center" justifyContent="center" height="100%"
          sx={{ bgcolor: '#1A1928', flexDirection: 'column', gap: 2, p: 3 }}>
          <Typography sx={{ fontSize: 40 }}>⚠️</Typography>
          <Typography sx={{ color: '#E0DEFF', fontSize: 16, textAlign: 'center' }}>
            Ошибка загрузки чата
          </Typography>
          <Typography sx={{ color: '#8A88AA', fontSize: 13, textAlign: 'center', maxWidth: 400 }}>
            {this.state.error}
          </Typography>
          <Button onClick={() => this.setState({ error: null })}
            sx={{ bgcolor: '#7C6AF7', color: '#fff', borderRadius: 2, px: 3, textTransform: 'none', '&:hover': { bgcolor: '#6a58e5' } }}>
            Попробовать снова
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

const EMOJI_LIST = [
  '😀','😂','🥰','😍','🤔','😢','😡','👍','👎','❤️',
  '🔥','🎉','🎊','🎁','✅','❌','⭐','💯','🙏','👏',
  '😎','🤣','😭','😱','🤗','💪','🤝','👋','🙌','💥',
  '🌟','💫','✨','🎵','🎶','🎸','🎤','🎮','🏆','🥇',
  '🍕','🍔','🍣','🍦','☕','🍺','🥂','🎂','🍭','🍫',
  '🐶','🐱','🦊','🐼','🦁','🐸','🦋','🌸','🌺','🌈',
];

// Генерируем звук уведомления через Web Audio API.
// Используем один переиспользуемый AudioContext, чтобы не создавать новый
// на каждое сообщение (это вызывало подтормаживания).
let notificationCtx: AudioContext | null = null;

function playNotificationSound(chatId?: string) {
  try {
    if (chatId) {
      const store = useChatSoundStore.getState();
      const volume = store.getVolume(chatId);
      if (volume <= 0) return;
      const custom = store.sounds[chatId];
      if (custom?.url) {
        const a = new Audio(custom.url);
        a.volume = volume;
        a.play().catch(() => {});
        return;
      }
      // fallback beep с громкостью
      try {
        if (!notificationCtx) {
          const Ctx = window.AudioContext || (window as any).webkitAudioContext;
          if (!Ctx) return;
          notificationCtx = new Ctx();
        }
        if (notificationCtx.state === 'suspended') notificationCtx.resume().catch(() => {});
        const ctx = notificationCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3 * volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
      } catch {}
      return;
    }
  } catch {}
  try {
    if (!notificationCtx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      notificationCtx = new Ctx();
    }
    if (notificationCtx.state === 'suspended') {
      notificationCtx.resume().catch(() => {});
    }
    const ctx = notificationCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

// Освобождаем ресурсы AudioContext при выгрузке страницы
window.addEventListener('pagehide', () => {
  try {
    notificationCtx?.close();
    notificationCtx = null;
  } catch {}
});

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

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

function ChatWindowInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    chats, messages, activeChat, setActiveChat,
    sendMessage, sendMessageWithFile, typingUsers,
    leaveChat, onlineUsers,
  } = useChatStore();
  const {
    toggleMute, isMuted, pinnedMessages,
  } = useChatPrefsStore();
  const mutedChats = { has: (id: string) => isMuted(id) };
  const { user } = useAuthStore();
    const { theme, setChatPhoto, setChatBgImage, chatPhoto: chatPhotoGlobal, themeVersion } = useThemeStore();

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [chatPhotoInputRef] = useState<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  // Pending files (превью перед отправкой)
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<null | HTMLElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSearchResults, setServerSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [chatThemeOpen, setChatThemeOpen] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<{ type: 'audio' | 'video' } | null>(null);
  const callActive = useCallStore((s) => s.activeChatId === id);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'info' | 'warning' | 'error' } | null>(null);

  const {
    fontSize, emojiSize, fontFamily, customFonts,
    setFontSize, setEmojiSize, setFontFamily,
    addCustomFont, removeCustomFont,
  } = useChatSettingsStore();
  const layout = useUserSettingsStore((st) => st.layout);
  const fontInputRef = useRef<HTMLInputElement>(null);

  // Голосовые сообщения
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBgInputRef = useRef<HTMLInputElement>(null);
  const liveBgInputRef = useRef<HTMLInputElement>(null);
  const [liveBgUrl, setLiveBgUrl] = useState<string | null>(null);
  const [liveBgVersion, setLiveBgVersion] = useState(0);

  // Загружаем живые обои (видео) из IndexedDB при монтировании и при смене версии
  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    (async () => {
      if (!hasLiveBg()) { setLiveBgUrl(null); return; }
      const url = await loadLiveBgUrl();
      if (cancelled) { if (url) URL.revokeObjectURL(url); return; }
      currentUrl = url;
      setLiveBgUrl(url);
    })();
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [liveBgVersion]);
  const prevMsgCountRef = useRef<number>(0);

  useEffect(() => {
    if (id) {
      // Always load messages for this chat id
      useChatStore.getState().loadMessages(id);
      const chat = chats.find((c) => c && c.id === id);
      if (chat) {
        setActiveChat(chat);
      } else {
        // chats not loaded yet — load them first
        useChatStore.getState().loadChats().then(() => {
          const found = useChatStore.getState().chats.find((c) => c && c.id === id);
          if (found) setActiveChat(found);
          else setChatNotFound(true);
        });
      }
    }
  }, [id]);

  const [chatNotFound, setChatNotFound] = useState(false);
  useEffect(() => { setChatNotFound(false); }, [id]);

  // When chats list updates (e.g. after loadChats), sync activeChat
  useEffect(() => {
    if (id && !activeChat && chats.length > 0) {
      const chat = chats.find((c) => c && c.id === id);
      if (chat) setActiveChat(chat);
    }
  }, [chats, id]);

  const chatMessages = messages[id || ''] || [];

  // Звук при новом сообщении от другого пользователя
  useEffect(() => {
    const prev = prevMsgCountRef.current;
    const curr = chatMessages.length;
    if (curr > prev && prev > 0) {
      const lastMsg = chatMessages[curr - 1];
      if (lastMsg?.senderId !== user?.id) {
        if (!(id && mutedChats.has(id))) playNotificationSound(id);
      }
    }
    prevMsgCountRef.current = curr;
  }, [chatMessages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const typingList = typingUsers[id || ''] || [];

  const getChatName = () => {
    if (!activeChat) return '';
    if (activeChat.name) return activeChat.name;
    if (activeChat.type === 'private' || (activeChat as any).type === 'direct') {
      const other = activeChat.members?.find((m) => m.userId !== user?.id);
      if (!other) {
        // Запасной вариант — пробуем из chats найти по id
        const chatFromList = chats.find(c => c.id === activeChat.id);
        const otherFallback = chatFromList?.members?.find(m => m.userId !== user?.id);
        return otherFallback?.user
          ? `${otherFallback.user.firstName || ''} ${otherFallback.user.lastName || ''}`.trim() || otherFallback.user.username || 'Чат'
          : 'Чат';
      }
      return other.user
        ? `${other.user.firstName || ''} ${other.user.lastName || ''}`.trim() || other.user.username || 'Чат'
        : 'Чат';
    }
    return activeChat.name || 'Группа';
  };

  const getChatAvatar = () => {
    if (!activeChat) return undefined;
    if (activeChat.avatarUrl) return resolveFileUrl(activeChat.avatarUrl);
    if (activeChat.type === 'private') {
      return resolveFileUrl(activeChat.members?.find(m => m.userId !== user?.id)?.user?.avatarUrl || undefined);
    }
    return undefined;
  };

  const getPartnerUser = (): User | null => {
    if (activeChat?.type !== 'private' && activeChat?.type !== 'direct') return null;
    return activeChat.members?.find((m) => m.userId !== user?.id)?.user || null;
  };

  const getPartnerOnline = () => {
    const partner = getPartnerUser();
    if (!partner) return false;
    return onlineUsers.has(partner.id);
  };

  const handleSend = async () => {
    if ((!text.trim() && pendingFiles.length === 0) || !id) return;
    const msg = text.trim();
    setText('');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    try { sendTypingStop(id); } catch {}
    if (msg) {
      await sendMessage(id, msg, replyTo?.id);
    }
    if (pendingFiles.length > 0) {
      await uploadAndSendFiles(pendingFiles);
    } else {
      setReplyTo(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleTyping = (value: string) => {
    setText(value);
    if (!id) return;
    try {
      sendTypingStart(id);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => { try { sendTypingStop(id); } catch {} }, 2000);
    } catch {}
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    e.target.value = '';
    // Добавляем в pending — показываем превью перед отправкой
    const newFiles = Array.from(files);
    const previews = newFiles.map(f =>
      f.type.startsWith('image/') ? URL.createObjectURL(f) : ''
    );
    setPendingFiles(prev => [...prev, ...newFiles]);
    setPendingPreviews(prev => [...prev, ...previews]);
  };

  const toMessageAttachment = (raw: any, fallbackFile: File) => ({
    fileUrl: raw?.url || raw?.fileUrl || '',
    fileName: raw?.originalName || raw?.fileName || fallbackFile.name,
    fileSize: raw?.size ?? raw?.fileSize ?? fallbackFile.size,
    mimeType: raw?.mimeType || fallbackFile.type || 'application/octet-stream',
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recordChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) recordChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: 'audio/webm' });
        const voiceFile = new File([blob], 'voice.webm', { type: 'audio/webm' });
        if (id) {
          setUploading(true);
          try {
            // P2P: читаем blob в data URL и сохраняем как attachment локально
            // (mesh пока не передаёт бинарные вложения).
            const dataUrl: string = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(new Error('read error'));
              reader.readAsDataURL(voiceFile);
            });
            const attachment = {
              url: dataUrl,
              fileUrl: dataUrl,
              name: voiceFile.name,
              fileName: voiceFile.name,
              mime: 'audio/webm',
              mimeType: 'audio/webm',
              size: voiceFile.size,
              duration: recordTime,
            };
            await sendMessageWithFile(id, attachment, undefined, 'voice');
          } catch (err) { console.error('voice send error:', err); }
          setUploading(false);
        }
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true); setRecordTime(0);
      recordTimerRef.current = setInterval(() => setRecordTime((t) => t + 1), 1000);
    } catch {
      setToast({ message: 'Нет доступа к микрофону. Разрешите запись звука в браузере.', severity: 'warning' });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    setRecording(false); setRecordTime(0);
  };

  // Загрузить массив File[] и отправить
  const uploadAndSendFiles = async (files: File[]) => {
    if (!files.length || !id) return;
    setUploading(true); setUploadProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(Math.round((i / files.length) * 100));
        // P2P: сохраняем файл как data URL прямо в attachment (mesh не передаёт бинарь).
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('read error'));
          reader.readAsDataURL(file);
        });
        const attachment: any = {
          url: dataUrl,
          fileUrl: dataUrl,
          fileName: file.name,
          name: file.name,
          fileSize: file.size,
          size: file.size,
          mimeType: file.type,
          mime: file.type,
        };
        const mime = attachment.mimeType || '';
        let msgType = 'document';
        if (mime.startsWith('image/')) msgType = 'photo';
        else if (mime.startsWith('video/')) msgType = 'video';
        else if (mime.startsWith('audio/')) msgType = 'audio';
        await sendMessageWithFile(id, attachment, replyTo?.id, msgType);
      }
      setReplyTo(null);
    } catch (err) {
      console.error('uploadAndSendFiles error:', err);
      setToast({ message: 'Ошибка загрузки файла. Проверьте подключение к серверу.', severity: 'error' });
    } finally {
      setUploading(false); setUploadProgress(0);
      setPendingFiles([]); setPendingPreviews([]);
    }
  };

  // Обработчик Paste (Ctrl+V скопированные картинки/файлы)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      // Показать превью и добавить в pending
      const previews = files.map(f =>
        f.type.startsWith('image/') ? URL.createObjectURL(f) : ''
      );
      setPendingFiles(prev => [...prev, ...files]);
      setPendingPreviews(prev => [...prev, ...previews]);
    }
  };

  // Drag & drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const previews = files.map(f =>
        f.type.startsWith('image/') ? URL.createObjectURL(f) : ''
      );
      setPendingFiles(prev => [...prev, ...files]);
      setPendingPreviews(prev => [...prev, ...previews]);
    }
  };

  useEffect(() => {
    const q = searchQuery.trim();
    if (!showSearch || !id || q.length < 2) {
      setServerSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      messagesApi.search(id, q)
        .then((res) => { if (!cancelled) setServerSearchResults(res.data || []); })
        .catch((err) => { console.error('message search error:', err); if (!cancelled) setServerSearchResults([]); })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showSearch, searchQuery, id]);

  const localSearchResults = searchQuery.trim()
    ? chatMessages.filter(m => m.content?.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : chatMessages;
  const visibleMessages = showSearch && searchQuery.trim()
    ? (serverSearchResults.length ? serverSearchResults.slice().reverse() : localSearchResults)
    : chatMessages;

  const groupedMessages = useMemo(() => {
    if (!visibleMessages.length) return [];
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    for (const msg of visibleMessages) {
      const date = new Date(msg.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      if (date !== currentDate) {
        groups.push({ date, messages: [msg] });
        currentDate = date;
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  }, [visibleMessages]);

  const handleHover = useCallback((id: string | null) => setHoveredMsgId(id), []);
  const handleOpenActions = useCallback((id: string) => {
    setHoveredMsgId((current) => current === id ? null : id);
  }, []);
  const handleReply = useCallback((m: Message) => setReplyTo(m), []);
  const handleForward = useCallback((m: Message) => setForwardMsg(m), []);
  const handleSetProfileUser = useCallback((u: User) => setProfileUser(u), []);
  const handleScrollToMessage = useCallback((msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s';
      el.style.background = theme.accent + '30';
      setTimeout(() => { el.style.background = ''; }, 1500);
    }
  }, [theme.accent]);

  const handleAvatarClick = () => {
    const partner = getPartnerUser();
    if (partner) setProfileUser(partner);
    else setShowInfo(v => !v);
  };

  // ── Хуки для магазинных возможностей (должны вызываться ДО ранних return, иначе React error #310) ──
  const chatThemeOverride = useChatThemeStore((s) => (id ? s.themes[id] : undefined));
  const smartWpActiveId = useShopStore((s) => s.activeWallpaper);
  const smartWpOwned = useShopStore((s) => s.owned);
  const smartWpItem = React.useMemo(() => {
    if (!smartWpActiveId) return undefined;
    const it = SHOP_CATALOG.find((i) => i.id === smartWpActiveId && i.applyKey === 'smartWallpaper');
    if (!it) return undefined;
    // Проверяем владение через единый isOwned (учитывает dev-режим и серверные покупки).
    if (!useShopStore.getState().isOwned(it.id)) return undefined;
    return it;
  }, [smartWpActiveId, smartWpOwned]);
  const smartWpSpec = React.useMemo<WallpaperSpec | null>(() => {
    if (!smartWpItem || !smartWpItem.value?.type) return null;
    return { type: smartWpItem.value.type as WallpaperSpec['type'], gradient: smartWpItem.value.gradient };
  }, [smartWpItem]);

  // Кастомные обои от авторов (перебивают smart-обои).
  const customWallpaperSpec = useCustomEquipStore((s) => s.equipped.wallpaper ? s.items[s.equipped.wallpaper]?.spec : undefined);

  if (!activeChat) {
    // If there's a chat id in URL — we're loading, not waiting for selection
    if (id) {
      if (chatNotFound) {
        return (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%"
            sx={{ bgcolor: theme.bgChat }}>
            <Box textAlign="center" sx={{ p: 3, maxWidth: 420 }}>
              <Typography sx={{ fontSize: 48, mb: 1 }}>🔗</Typography>
              <Typography sx={{ color: theme.text, fontSize: 17, mb: 1 }}>
                Чат не найден
              </Typography>
              <Typography sx={{ color: theme.textSec, fontSize: 14, mb: 2 }}>
                Похоже, приглашение не сработало или ссылка устарела. Попросите отправителя прислать инвайт ещё раз.
              </Typography>
              <Button
                onClick={() => { setChatNotFound(false); useChatStore.getState().loadChats(); navigate('/'); }}
                sx={{ bgcolor: theme.accent, color: '#fff', borderRadius: 2, px: 3, textTransform: 'none' }}
              >
                На главную
              </Button>
            </Box>
          </Box>
        );
      }
      return (
        <Box display="flex" alignItems="center" justifyContent="center" height="100%"
          sx={{ bgcolor: theme.bgChat }}>
          <Box textAlign="center">
            <Box sx={{
              width: 48, height: 48, borderRadius: '50%', mx: 'auto', mb: 2,
              border: `3px solid ${theme.accent}`,
              borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
              '@keyframes spin': { '100%': { transform: 'rotate(360deg)' } },
            }} />
            <Typography sx={{ color: theme.textSec, fontSize: 15 }}>Загрузка чата...</Typography>
          </Box>
        </Box>
      );
    }
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100%"
        sx={{ bgcolor: theme.bgChat }}>
        <Box textAlign="center">
          <Typography sx={{ fontSize: 56, mb: 2 }}>💬</Typography>
          <Typography sx={{ color: theme.textSec, fontSize: 17 }}>Выберите чат</Typography>
        </Box>
      </Box>
    );
  }

  const chatName = getChatName();
  const chatAvatar = getChatAvatar();
  const partnerOnline = getPartnerOnline();
  const isLightTheme = (() => {
    const m = String(theme.bg).match(/#([0-9a-f]{6})/i);
    if (!m) return false;
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 140;
  })();

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', background: theme.bgChat, position: 'relative', perspective: 1200 }}>
      {/* ── Main chat area ── */}
      <Box
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        sx={{
          display: 'flex', flexDirection: 'column',
          flex: 1, height: '100%',
          bgcolor: 'transparent',
          background: `radial-gradient(circle at 78% 0%, ${theme.accent}14 0, transparent 30%), radial-gradient(circle at 8% 100%, rgba(255,79,216,0.10) 0, transparent 34%), ${theme.bgChat}`,
          overflow: 'hidden',
          position: 'relative',
          transformOrigin: '50% 72%',
          animation: `chatDepthIn 420ms ${motion.emphasized} both`,
          '@keyframes chatDepthIn': {
            '0%': { opacity: 0, transform: 'translateY(18px) scale(.972) rotateX(3deg)', filter: 'blur(12px)' },
            '100%': { opacity: 1, transform: 'translateY(0) scale(1) rotateX(0)', filter: 'blur(0)' },
          },
          // паттерн применяем только если нет фото (иначе фото-слой рисуется ниже)
          ...(!theme.chatBgImage && theme.chatPattern ? {
            backgroundImage: theme.chatPattern,
            backgroundRepeat: 'repeat',
            backgroundSize: 'auto',
          } : {}),
        }}>

        <Snackbar
          open={Boolean(toast)}
          autoHideDuration={3500}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          sx={{ zIndex: 2000 }}
        >
          <Alert
            onClose={() => setToast(null)}
            severity={toast?.severity || 'info'}
            variant="filled"
            sx={{
              borderRadius: 3,
              bgcolor: toast?.severity === 'error' ? '#EF4444' : toast?.severity === 'warning' ? '#F59E0B' : theme.accent,
              color: '#fff',
              boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
            }}
          >
            {toast?.message || ''}
          </Alert>
        </Snackbar>

        {/* ── Обои чата: smart-обои (движок) → кастом авторов → персональная тема → живые → фото ── */}
        {smartWpSpec && !customWallpaperSpec && !liveBgUrl && !theme.chatBgImage && (
          <Box sx={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <ChatWallpaper spec={smartWpSpec} isLight={isLightTheme} />
          </Box>
        )}
        {customWallpaperSpec && !liveBgUrl && !theme.chatBgImage && (
          <Box sx={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: (specToStyle(customWallpaperSpec).background as string | undefined) || undefined,
          }} className={specAnimationClass(customWallpaperSpec)} />
        )}
        {chatThemeOverride?.bg && !customWallpaperSpec && !smartWpSpec && !liveBgUrl && !theme.chatBgImage && (
          <Box sx={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: `linear-gradient(135deg, ${chatThemeOverride.bg}, ${chatThemeOverride.accent || chatThemeOverride.bg})`,
            transition: 'background 800ms ease',
          }} />
        )}

        {/* ── Живые обои (видео-слой, приоритет выше фото) ── */}
        {liveBgUrl && (
          <>
            <Box component="video" src={liveBgUrl}
              autoPlay muted loop playsInline
              sx={{
                position: 'absolute', inset: 0, zIndex: 0,
                width: '100%', height: '100%', objectFit: 'cover',
                pointerEvents: 'none',
              }}
            />
            <Box sx={{
              position: 'absolute', inset: 0, zIndex: 1,
              bgcolor: `rgba(0,0,0,${1 - (theme.chatBgImageOpacity ?? 0.35)})`,
              pointerEvents: 'none',
            }} />
          </>
        )}

        {/* ── Фото-фон чата (абсолютный слой) ── */}
        {!liveBgUrl && theme.chatBgImage && (
          <>
            {/* само фото */}
            <Box sx={{
              position: 'absolute', inset: 0, zIndex: 0,
              backgroundImage: `url(${resolveFileUrl(theme.chatBgImage)})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              pointerEvents: 'none',
            }} />
            {/* затемнение */}
            <Box sx={{
              position: 'absolute', inset: 0, zIndex: 1,
              bgcolor: `rgba(0,0,0,${1 - (theme.chatBgImageOpacity ?? 0.35)})`,
              pointerEvents: 'none',
            }} />
            {/* паттерн поверх фото */}
            {theme.chatPattern && (
              <Box sx={{
                position: 'absolute', inset: 0, zIndex: 2,
                backgroundImage: theme.chatPattern,
                backgroundRepeat: 'repeat',
                pointerEvents: 'none',
              }} />
            )}
          </>
        )}

        {/* Drag overlay */}
        {dragOver && (
          <Box sx={{
            position: 'absolute', inset: 0, zIndex: 100,
            bgcolor: theme.accent + '20',
            border: `3px dashed ${theme.accent}`,
            borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <Typography sx={{ fontSize: 22, color: theme.accent, fontWeight: 700 }}>
              📎 Отпустите файл для прикрепления
            </Typography>
          </Box>
        )}
        {/* ── Header ── */}
        <Box sx={{
          display: 'flex', alignItems: 'center',
          px: 2.5, py: 1.5, gap: 2,
          background: theme.headerGradient || theme.bgHeader,
          backdropFilter: 'blur(22px)',
          borderBottom: layout.chatHeaderPos === 'bottom' ? 'none' : `1px solid ${theme.border}`,
          borderTop: layout.chatHeaderPos === 'bottom' ? `1px solid ${theme.border}` : 'none',
          boxShadow: '0 16px 44px rgba(0,0,0,0.22)',
          flexShrink: 0,
          position: 'relative', zIndex: 2,
          order: layout.chatHeaderPos === 'bottom' ? 3 : 0,
        }}>
          {/* Avatar — клик открывает профиль/инфо */}
          <Tooltip title="К списку чатов">
            <IconButton
              onClick={() => navigate('/')}
              sx={{ color: theme.textSec, mr: -0.5, display: { xs: 'inline-flex', md: 'none' } }}
            >
              <ArrowBack />
            </IconButton>
          </Tooltip>
          <Avatar
            src={chatAvatar || undefined}
            onClick={handleAvatarClick}
            sx={{
              width: 46, height: 46, fontSize: 17,
              bgcolor: theme.accent + '60',
              cursor: 'pointer',
              border: `2px solid ${theme.accent}40`,
              '&:hover': { border: `2px solid ${theme.accent}`, opacity: 0.9 },
              transition: 'all 0.15s',
            }}
          >
            {getInitials(chatName)}
          </Avatar>

          <Box flex={1} minWidth={0}>
            <Typography sx={{ fontWeight: 700, fontSize: 17, color: theme.text }} noWrap>
              {chatName}
            </Typography>
            <Typography sx={{
              fontSize: 13,
              color: typingList.length > 0 ? theme.accent
                : partnerOnline ? theme.online
                : theme.textSec,
            }}>
              {typingList.length > 0
                ? 'печатает...'
                : partnerOnline
                  ? 'в сети'
                  : activeChat.type === 'group'
                    ? `${activeChat.members?.length || 0} участников`
                    : ''}
            </Typography>
          </Box>

          {/* Кнопки звонка — 1:1 и группы (Discord-style) */}
          {(activeChat.type === 'private' || activeChat.type === 'direct' || activeChat.type === 'group') && (
            <>
              <Tooltip title={callActive ? 'Идёт звонок' : 'Аудио звонок'}>
                <span>
                  <IconButton
                    onClick={() => useCallStore.getState().startCall(id!, 'audio')}
                    disabled={callActive}
                    sx={{
                      color: callActive ? '#22c55e' : theme.textSec,
                      '&:hover': { color: '#22c55e' },
                    }}
                  >
                    <Call sx={{ fontSize: 22 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Видео звонок">
                <IconButton
                  onClick={() => useCallStore.getState().startCall(id!, 'video')}
                  sx={{ color: theme.textSec, '&:hover': { color: '#3b82f6' } }}
                >
                  <Videocam sx={{ fontSize: 22 }} />
                </IconButton>
              </Tooltip>
            </>
          )}

          <Tooltip title="Поиск по сообщениям">
            <IconButton onClick={() => { setShowSearch(v => !v); setSearchQuery(''); }}
              sx={{ color: showSearch ? theme.accent : theme.textSec, '&:hover': { color: theme.text } }}>
              <Search sx={{ fontSize: 22 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Информация">
            <IconButton
              onClick={() => setShowInfo(v => !v)}
              sx={{ color: showInfo ? theme.accent : theme.textSec, '&:hover': { color: theme.text } }}
            >
              <InfoOutlined sx={{ fontSize: 22 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Ещё">
            <IconButton sx={{ color: theme.textSec, '&:hover': { color: theme.text } }}
              onClick={(e) => setAnchorEl(e.currentTarget)}>
              <MoreVert sx={{ fontSize: 22 }} />
            </IconButton>
          </Tooltip>

          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}
            PaperProps={{
              sx: {
                bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
                borderRadius: 2.5, minWidth: 220,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                py: 0.5,
              }
            }}>
            <MenuItem onClick={() => { setAnchorEl(null); setShowInfo(true); }}
              sx={{
                gap: 1.5, py: 1.2, px: 2,
                color: theme.text, fontSize: 14, fontWeight: 500,
                '&:hover': { bgcolor: theme.bgHover },
              }}>
              <InfoOutlined sx={{ fontSize: 18, color: theme.textSec }} />
              Информация о чате
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); setNotifSettingsOpen(true); }}
              sx={{
                gap: 1.5, py: 1.2, px: 2,
                color: theme.text, fontSize: 14, fontWeight: 500,
                '&:hover': { bgcolor: theme.bgHover },
              }}>
              {(id && mutedChats.has(id))
                ? <><NotificationsOff sx={{ fontSize: 18, color: theme.textSec }} />Уведомления чата</>
                : <><NotificationsActive sx={{ fontSize: 18, color: theme.textSec }} />Уведомления чата</>
              }
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); setShowDisplaySettings(true); }}
              sx={{
                gap: 1.5, py: 1.2, px: 2,
                color: theme.text, fontSize: 14, fontWeight: 500,
                '&:hover': { bgcolor: theme.bgHover },
              }}>
              <FormatSize sx={{ fontSize: 18, color: theme.textSec }} />
              Настройки отображения
            </MenuItem>
            <MuiDivider sx={{ borderColor: theme.border, my: 0.5 }} />
            <MenuItem onClick={() => { setAnchorEl(null); setChatThemeOpen(true); }}
              sx={{
                gap: 1.5, py: 1.2, px: 2,
                color: theme.text, fontSize: 14, fontWeight: 500,
                '&:hover': { bgcolor: theme.bgHover },
              }}>
              <Palette sx={{ fontSize: 18, color: theme.textSec }} />
              Персональная тема чата
            </MenuItem>
            <MuiDivider sx={{ borderColor: theme.border, my: 0.5 }} />
            <MenuItem onClick={() => { setAnchorEl(null); setLeaveConfirmOpen(true); }}
              sx={{
                gap: 1.5, py: 1.2, px: 2,
                color: '#f44336', fontSize: 14, fontWeight: 500,
                '&:hover': { bgcolor: 'rgba(244,67,54,0.08)' },
              }}>
              <ExitToApp sx={{ fontSize: 18, color: '#f44336' }} />
              Покинуть чат
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); setTimeout(() => chatBgInputRef.current?.click(), 0); }}>
              🖼 Фото чата
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); setTimeout(() => liveBgInputRef.current?.click(), 0); }}>
              🎬 Живые обои (видео)
            </MenuItem>
            <MenuItem onClick={async () => {
              setAnchorEl(null);
              await clearLiveBg();
              setLiveBgVersion((v) => v + 1);
              setToast({ message: 'Живые обои убраны', severity: 'info' });
            }}>
              🗑 Убрать живые обои
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); setChatBgImage(undefined); setToast({ message: 'Обои чата убраны', severity: 'info' }); }}>
              🗑 Убрать фото-фон
            </MenuItem>
          </Menu>

          {/* Input для живых обоев (видео) */}
          <input
            ref={liveBgInputRef}
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              // Разумный предел, чтобы не забить IndexedDB. 30 МБ ≈ короткий loop.
              if (file.size > 30 * 1024 * 1024) {
                setToast({ message: 'Видео слишком большое. Максимум 30 МБ.', severity: 'warning' });
                return;
              }
              try {
                setUploading(true);
                await saveLiveBg(file);
                setLiveBgVersion((v) => v + 1);
                setToast({ message: 'Живые обои установлены', severity: 'success' });
              } catch (err) {
                console.error('live bg save error:', err);
                setToast({ message: 'Не удалось сохранить видео: ' + ((err as any)?.message || err), severity: 'error' });
              } finally {
                setUploading(false);
              }
            }}
          />
          <input
            ref={chatBgInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                setToast({ message: 'Файл слишком большой. Максимум 5 МБ.', severity: 'warning' });
                return;
              }
              e.target.value = '';
              try {
                setUploading(true);
                // P2P: читаем файл в data URL и сохраняем прямо в themeStore.
                // Для больших изображений уменьшаем разрешение до 1280px,
                // чтобы влезло в localStorage (квота ~5МБ на origin).
                const rawUrl: string = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result || ''));
                  reader.onerror = () => reject(new Error('read error'));
                  reader.readAsDataURL(file);
                });
                const url: string = await new Promise((resolve) => {
                  const img = new Image();
                  img.onload = () => {
                    const maxSide = 1280;
                    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                    const w = Math.round(img.width * scale);
                    const h = Math.round(img.height * scale);
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return resolve(rawUrl);
                    ctx.drawImage(img, 0, 0, w, h);
                    try { resolve(canvas.toDataURL('image/jpeg', 0.85)); }
                    catch { resolve(rawUrl); }
                  };
                  img.onerror = () => resolve(rawUrl);
                  img.src = rawUrl;
                });
                if (!url) throw new Error('no url');
                setChatPhoto(url);
                setChatBgImage(url);
                setToast({ message: 'Фото чата обновлено', severity: 'success' });
              } catch (err) {
                console.error('chat photo upload error:', err);
                setToast({ message: 'Ошибка загрузки фото: ' + ((err as any)?.message || err), severity: 'error' });
              } finally {
                setUploading(false);
              }
            }}
          />

          {/* ── Диалог настроек отображения ── */}
          <Dialog
            open={showDisplaySettings}
            onClose={() => setShowDisplaySettings(false)}
            PaperProps={{ sx: { bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 3, minWidth: 380, maxWidth: 480 } }}
          >
            <DialogTitle sx={{ color: theme.text, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
              🎨 Настройки отображения
              <IconButton size="small" onClick={() => setShowDisplaySettings(false)} sx={{ color: theme.textSec }}>
                <Close sx={{ fontSize: 18 }} />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ pt: 0 }}>
              {/* Превью */}
              <Box sx={{ bgcolor: theme.bgChat, borderRadius: 2, p: 1.5, mb: 2.5, border: `1px solid ${theme.border}` }}>
                <Typography sx={{ fontSize: fontSize, fontFamily, color: theme.text, lineHeight: 1.5 }}>
                  Пример текста сообщения
                </Typography>
                <Typography component="span" sx={{ fontSize: emojiSize, lineHeight: 1 }}>😀🎉❤️</Typography>
              </Box>

              {/* Размер текста */}
              <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5, fontWeight: 600 }}>
                Размер текста: {fontSize}px
              </Typography>
              <Slider
                value={fontSize}
                onChange={(_, v) => setFontSize(v as number)}
                min={12} max={24} step={1}
                sx={{ color: theme.accent, mb: 2.5 }}
              />

              {/* Размер эмодзи */}
              <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5, fontWeight: 600 }}>
                Размер эмодзи: {emojiSize}px
              </Typography>
              <Slider
                value={emojiSize}
                onChange={(_, v) => setEmojiSize(v as number)}
                min={16} max={48} step={2}
                sx={{ color: theme.accent, mb: 2.5 }}
              />

              <MuiDivider sx={{ borderColor: theme.border, my: 1.5 }} />

              {/* Шрифт */}
              <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1, fontWeight: 600 }}>
                Шрифт чата
              </Typography>
              <Select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                size="small"
                fullWidth
                sx={{
                  color: theme.text, bgcolor: theme.bgInput, borderRadius: 2, mb: 2,
                  fontFamily,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.border },
                  '& .MuiSvgIcon-root': { color: theme.textSec },
                  '& .MuiSelect-select': { py: 1 },
                }}
                MenuProps={{ PaperProps: { sx: { bgcolor: theme.bgHeader, border: `1px solid ${theme.border}` } } }}
              >
                {[...BUILTIN_FONTS, ...customFonts.map(f => ({ label: f.name, value: f.name }))].map(f => (
                  <MenuItem key={f.value} value={f.value} sx={{ fontFamily: f.value, color: theme.text }}>
                    {f.label}
                  </MenuItem>
                ))}
              </Select>

              {/* Загрузка своего шрифта */}
              <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1, fontWeight: 600 }}>
                Добавить свой шрифт (.ttf / .otf / .woff)
              </Typography>
              <input
                ref={fontInputRef}
                type="file"
                hidden
                accept=".ttf,.otf,.woff,.woff2"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  e.target.value = '';
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string;
                    const fontName = file.name.replace(/\.[^.]+$/, '');
                    const styleEl = document.createElement('style');
                    styleEl.textContent = `@font-face { font-family: '${fontName}'; src: url('${dataUrl}'); }`;
                    document.head.appendChild(styleEl);
                    addCustomFont({ name: fontName, url: dataUrl });
                    setFontFamily(fontName);
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  variant="outlined" size="small"
                  onClick={() => fontInputRef.current?.click()}
                  sx={{ color: theme.accent, borderColor: theme.accent + '60', textTransform: 'none', borderRadius: 2 }}
                >
                  📁 Загрузить шрифт
                </Button>
                {customFonts.map(f => (
                  <Box key={f.name} sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    bgcolor: theme.bgChat, border: `1px solid ${theme.border}`,
                    borderRadius: 2, px: 1.2, py: 0.4,
                  }}>
                    <Typography sx={{ fontSize: 13, color: theme.text, fontFamily: f.name }}>{f.name}</Typography>
                    <IconButton size="small" onClick={() => {
                      removeCustomFont(f.name);
                      if (fontFamily === f.name) setFontFamily('inherit');
                    }} sx={{ color: theme.textSec, p: 0.2 }}>
                      <Close sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setShowDisplaySettings(false)}
                sx={{ bgcolor: theme.accent, color: '#fff', textTransform: 'none', borderRadius: 2, px: 3, '&:hover': { bgcolor: theme.accent + 'CC' } }}>
                Готово
              </Button>
            </DialogActions>
          </Dialog>
        </Box>

        {/* ── Поиск по чату ── */}
        {showSearch && (
          <Box sx={{
            px: 2.5, py: 1.25,
            bgcolor: theme.bgHeader,
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 1.5,
            position: 'relative', zIndex: 2, order: 1,
          }}>
            <Search sx={{ color: theme.textSec, fontSize: 20 }} />
            <TextField
              fullWidth autoFocus
              placeholder="Поиск по сообщениям..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              size="small" variant="standard"
              sx={{
                '& .MuiInput-root': { color: theme.text, fontSize: 15 },
                '& .MuiInput-root:before': { borderColor: theme.border },
                '& .MuiInput-root:after': { borderColor: theme.accent },
                '& input::placeholder': { color: theme.textSec },
              }}
            />
            {searchQuery && (
              <Typography sx={{ fontSize: 13, color: theme.textSec, whiteSpace: 'nowrap' }}>
                {searchLoading
                  ? 'поиск...'
                  : `${visibleMessages.length} найдено`}
              </Typography>
            )}
            <IconButton size="small" onClick={() => { setShowSearch(false); setSearchQuery(''); }}
              sx={{ color: theme.textSec }}>
              <Close sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        )}

        {/* ── Закреплённое сообщение ── */}
        {activeChat && pinnedMessages[activeChat.id] && (
          <Box sx={{
            px: 2.5, py: 0.75,
            bgcolor: theme.accent + '12',
            borderBottom: `1px solid ${theme.accent}30`,
            display: 'flex', alignItems: 'center', gap: 1.5,
            cursor: 'pointer',
            position: 'relative', zIndex: 2, order: 1,
          }}
            onClick={() => {
              const pinned = pinnedMessages[activeChat.id];
              if (pinned) {
                const el = document.getElementById(`msg-${pinned.id}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }}
          >
            <PushPin sx={{ fontSize: 16, color: theme.accent }} />
            <Box flex={1} minWidth={0}>
              <Typography sx={{ fontSize: 12, color: theme.accent, fontWeight: 600 }}>Закреплённое сообщение</Typography>
              <Typography sx={{ fontSize: 13, color: theme.textSec }} noWrap>
                {pinnedMessages[activeChat.id]?.content || '📎 Вложение'}
              </Typography>
            </Box>
          </Box>
        )}

        {/* Прогресс загрузки */}
        {uploading && (
          <LinearProgress
            variant={uploadProgress > 0 ? 'determinate' : 'indeterminate'}
            value={uploadProgress}
            sx={{
              height: 3,
              bgcolor: theme.accent + '20',
              '& .MuiLinearProgress-bar': { bgcolor: theme.accent },
              position: 'relative', zIndex: 2, order: 1,
            }}
          />
        )}

        {/* ── Messages ── */}
        <Box sx={{
          flex: 1, overflowY: 'auto', px: { xs: 1.25, md: 2.5 }, py: 2,
          backgroundImage: theme.chatPattern,
          backgroundBlendMode: 'screen',
          scrollBehavior: 'smooth',
          '&::-webkit-scrollbar': { width: 5 },
          '&::-webkit-scrollbar-thumb': { bgcolor: theme.accent + '30', borderRadius: 4 },
          position: 'relative', zIndex: 2, order: 2,
        }}
          onClick={() => setHoveredMsgId(null)}
          onContextMenu={() => setHoveredMsgId(null)}
        >
          {chatMessages.length === 0 && !searchQuery.trim() && (
            <Box display="flex" justifyContent="center" mt={6}>
              <Typography sx={{ fontSize: 15, color: theme.textSec }}>Нет сообщений. Напишите первым!</Typography>
            </Box>
          )}
          {showSearch && searchQuery.trim() && !searchLoading && visibleMessages.length === 0 && (
            <Box display="flex" justifyContent="center" mt={6}>
              <Typography sx={{ fontSize: 15, color: theme.textSec }}>Ничего не найдено</Typography>
            </Box>
          )}
          {groupedMessages.map(({ date, messages: msgs }) => (
            <Box key={date}>
              <Box display="flex" justifyContent="center" my={2}>
                <Typography sx={{
                  fontSize: 13, color: theme.textSec,
                  bgcolor: 'rgba(255,255,255,0.075)',
                  border: `1px solid ${theme.border}`,
                  backdropFilter: 'blur(14px)',
                  px: 2, py: 0.45, borderRadius: 999,
                }}>
                  {date}
                </Typography>
              </Box>
              {msgs.map((msg) => (
                                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.senderId === user?.id}
                  isHovered={hoveredMsgId === msg.id}
                  onHover={handleHover}
                  onOpenActions={handleOpenActions}
                  onReply={handleReply}
                  onForward={handleForward}
                  onAvatarClick={handleSetProfileUser}
                  onScrollToMessage={handleScrollToMessage}
                  accent={theme.accent}
                  themeVersion={themeVersion}
                />
              ))}
            </Box>
          ))}
          {typingList.length > 0 && (
            <Box display="flex" alignItems="center" gap={1} ml={1} mt={0.5}>
              <Box sx={{
                bgcolor: theme.bgBubbleOther, borderRadius: 3, px: 2, py: 1.2,
                backdropFilter: 'blur(14px)',
                border: `1px solid ${theme.border}`,
              }}>
                <Typography sx={{ fontSize: 14, color: theme.textSec, fontStyle: 'italic' }}>
                  печатает...
                </Typography>
              </Box>
            </Box>
          )}
          <div ref={messagesEndRef} />
        </Box>

        {/* ── Reply bar ── */}
        {replyTo && (
          <Box sx={{
            px: 2.5, py: 1,
            bgcolor: theme.accent + '15',
            borderTop: `2px solid ${theme.accent}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0,
          }}>
            <Box minWidth={0} flex={1}>
              <Typography sx={{ fontSize: 13, color: theme.accent, fontWeight: 600 }}>
                Ответ → {replyTo.sender?.firstName || replyTo.sender?.username}
              </Typography>
              <Typography sx={{ fontSize: 14, color: theme.textSec }} noWrap>{replyTo.content}</Typography>
            </Box>
            <IconButton size="small" onClick={() => setReplyTo(null)} sx={{ color: theme.textSec, ml: 1 }}>
              ✕
            </IconButton>
          </Box>
        )}

        {/* ── Pending files preview ── */}
        {pendingFiles.length > 0 && (
          <Box sx={{
            px: 2, py: 1.5,
            bgcolor: theme.bgHeader,
            backdropFilter: 'blur(20px)',
            borderTop: `1px solid ${theme.border}`,
            flexShrink: 0,
          }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              {pendingFiles.map((file, idx) => (
                <Box key={idx} sx={{
                  position: 'relative',
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: `1px solid ${theme.border}`,
                  bgcolor: theme.bgInput,
                }}>
                  {pendingPreviews[idx] ? (
                    <Box
                      component="img"
                      src={pendingPreviews[idx]}
                      sx={{ width: 80, height: 80, objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <Box sx={{ width: 80, height: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 1 }}>
                      <Typography sx={{ fontSize: 24 }}>📄</Typography>
                      <Typography sx={{ fontSize: 10, color: theme.textSec, textAlign: 'center', wordBreak: 'break-all' }} noWrap>
                        {file.name.slice(0, 12)}
                      </Typography>
                    </Box>
                  )}
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (pendingPreviews[idx]) URL.revokeObjectURL(pendingPreviews[idx]);
                      setPendingFiles(prev => prev.filter((_, i) => i !== idx));
                      setPendingPreviews(prev => prev.filter((_, i) => i !== idx));
                    }}
                    sx={{
                      position: 'absolute', top: 2, right: 2,
                      width: 20, height: 20,
                      bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', p: 0,
                      '&:hover': { bgcolor: '#f44336' },
                    }}
                  >
                    <Close sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                size="small"
                onClick={() => uploadAndSendFiles(pendingFiles)}
                disabled={uploading}
                sx={{ bgcolor: theme.accent, color: '#fff', textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: theme.accent + 'CC' } }}
              >
                {uploading ? `Отправка...` : `Отправить ${pendingFiles.length > 1 ? `(${pendingFiles.length})` : ''}`}
              </Button>
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  pendingPreviews.forEach(p => p && URL.revokeObjectURL(p));
                  setPendingFiles([]); setPendingPreviews([]);
                }}
                sx={{ color: theme.textSec, textTransform: 'none', borderRadius: 2 }}
              >
                Отмена
              </Button>
            </Box>
          </Box>
        )}

        {/* ── Input ── */}
        <Box sx={{
          display: 'flex', alignItems: 'flex-end', gap: 0.85,
          px: { xs: 1.15, md: 1.6 }, py: 1.25,
          bgcolor: theme.bgHeader,
          backdropFilter: 'blur(22px)',
          borderTop: layout.chatInputPos === 'top' ? 'none' : `1px solid ${theme.border}`,
          borderBottom: layout.chatInputPos === 'top' ? `1px solid ${theme.border}` : 'none',
          boxShadow: layout.chatInputPos === 'top' ? '0 18px 46px rgba(0,0,0,0.28)' : '0 -18px 46px rgba(0,0,0,0.28)',
          flexShrink: 0,
          position: 'relative', zIndex: 2,
          order: layout.chatInputPos === 'top' ? 1 : 4,
        }}>

          {/* Кнопка скрепки */}
          <Tooltip title="Прикрепить файл">
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>
              <IconButton
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                sx={{
                  width: 42, height: 42,
                  bgcolor: theme.bgInput,
                  color: uploading ? theme.border : theme.textSec,
                  transform: 'translateX(3px)',
                  transition: 'background 0.15s, color 0.15s',
                  '&:hover': { bgcolor: theme.bgHover, color: theme.text },
                }}
              >
                <AttachFile sx={{ fontSize: 22 }} />
              </IconButton>
            </span>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="*/*"
            disabled={uploading}
            onChange={handleFileUpload}
            style={{
              position: 'fixed', top: 0, left: 0,
              width: 1, height: 1, opacity: 0,
              pointerEvents: 'none',
            }}
          />

          <Tooltip title="Эмодзи">
            <IconButton
              onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget)}
              sx={{
                width: 42, height: 42,
                color: emojiAnchor ? theme.accent : theme.textSec,
                transform: 'translateX(1px)',
                flexShrink: 0,
                '&:hover': { color: theme.text },
              }}
            >
              <EmojiEmotions sx={{ fontSize: 22 }} />
            </IconButton>
          </Tooltip>

          {/* Эмодзи попап */}
          <Popover
            open={Boolean(emojiAnchor)}
            anchorEl={emojiAnchor}
            onClose={() => setEmojiAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            PaperProps={{
              sx: {
                bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
                borderRadius: 3, p: 1.5, width: 300,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }
            }}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
              {EMOJI_LIST.map((emoji) => (
                <Box
                  key={emoji}
                  onClick={() => { setText(prev => prev + emoji); setEmojiAnchor(null); }}
                  sx={{
                    fontSize: 24, cursor: 'pointer', p: 0.5, borderRadius: 1.5,
                    transition: 'transform 0.1s',
                    '&:hover': { transform: 'scale(1.3)', bgcolor: theme.bgHover },
                  }}
                >
                  {emoji}
                </Box>
              ))}
            </Box>
          </Popover>

          {recording ? (
            <Box sx={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 1.5,
              bgcolor: theme.bgInput, borderRadius: 999, px: 2.5, py: 1.25,
              backdropFilter: 'blur(16px)',
              border: `1px solid rgba(244,67,54,0.4)`,
            }}>
              <Box sx={{
                width: 10, height: 10, borderRadius: '50%', bgcolor: '#f44336',
                animation: 'blink 1s infinite',
                '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.2 } },
              }} />
              <Typography sx={{ fontSize: 15, color: theme.text }}>
                🎙 {Math.floor(recordTime / 60)}:{(recordTime % 60).toString().padStart(2, '0')}
              </Typography>
            </Box>
          ) : (
            <TextField
              fullWidth multiline maxRows={6}
placeholder="Сообщение..."
              value={text}
              onChange={(e) => handleTyping(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              variant="outlined" size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: theme.bgInput, borderRadius: 999, fontSize: 15,
                  color: theme.text,
                  backdropFilter: 'blur(16px)',
                  transition: `transform 220ms ${motion.spring}, box-shadow 240ms ${motion.easeOut}, border-color 180ms ${motion.easeOut}`,
                  boxShadow: text.trim() ? `0 0 0 4px ${theme.accent}12, 0 14px 32px rgba(0,0,0,.24)` : '0 8px 22px rgba(0,0,0,.16)',
                  '&:active': { transform: 'scale(.992)' },
                  '& fieldset': { borderColor: theme.border },
                  '&:hover fieldset': { borderColor: theme.accent + '40' },
                  '&.Mui-focused fieldset': { borderColor: theme.accent + '80' },
                },
                '& .MuiInputBase-input::placeholder': { color: theme.textSec },
              }}
            />
          )}

          {(text.trim() || pendingFiles.length > 0) ? (
            <Tooltip title="Отправить (Enter)">
              <IconButton onClick={handleSend} sx={{
                width: 42, height: 42,
                bgcolor: theme.accent, color: '#fff',
                transform: 'translateX(-3px)',
                flexShrink: 0,
                position: 'relative', overflow: 'hidden',
                borderRadius: 4,
                boxShadow: `0 12px 32px ${theme.accent}42`,
                animation: `morphSend 260ms ${motion.spring} both`,
                '@keyframes morphSend': {
                  '0%': { borderRadius: '50%', transform: 'scale(.78) rotate(-18deg)', filter: 'blur(2px)' },
                  '100%': { borderRadius: '16px', transform: 'scale(1) rotate(0deg)', filter: 'blur(0)' },
                },
                '&::after': { content: '""', position: 'absolute', inset: -16, background: 'radial-gradient(circle, rgba(255,255,255,.45), transparent 58%)', opacity: 0, transform: 'scale(.4)', transition: `opacity 220ms ${motion.easeOut}, transform 420ms ${motion.easeOut}` },
                '&:active::after': { opacity: 1, transform: 'scale(1)' },
                '&:hover': { bgcolor: theme.accent + 'CC' },
                ...membranePressSx,
              }} disabled={uploading}>
                <SendIcon sx={{ fontSize: 22 }} />
              </IconButton>
            </Tooltip>
          ) : recording ? (
            <Tooltip title="Стоп и отправить">
              <IconButton onClick={stopRecording} sx={{
                width: 42, height: 42, bgcolor: '#f44336', color: '#fff', transform: 'translateX(-3px)', flexShrink: 0,
                '&:hover': { bgcolor: '#d32f2f' },
                ...membranePressSx,
              }}>
                <Stop sx={{ fontSize: 22 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Голосовое сообщение">
              <IconButton onClick={startRecording} sx={{
                width: 42, height: 42,
                bgcolor: theme.bgInput, color: theme.textSec,
                transform: 'translateX(-3px)',
                flexShrink: 0,
                '&:hover': { bgcolor: theme.bgHover, color: theme.text },
                borderRadius: '50%',
                animation: `morphMic 240ms ${motion.spring} both`,
                '@keyframes morphMic': {
                  '0%': { borderRadius: '16px', transform: 'scale(.82) rotate(12deg)' },
                  '100%': { borderRadius: '50%', transform: 'scale(1) rotate(0deg)' },
                },
                ...membranePressSx,
              }}>
                <Mic sx={{ fontSize: 22 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* ── Info panel ── */}
      {showInfo && activeChat && (
        <ChatInfoPanel
          chat={activeChat}
          onClose={() => setShowInfo(false)}
          onViewProfile={(userId) => {
            const member = activeChat.members?.find(m => m.userId === userId);
            if (member?.user) setProfileUser(member.user);
          }}
        />
      )}

      {/* ── User profile modal ── */}
      <UserProfileModal
        user={profileUser}
        open={!!profileUser}
        onClose={() => setProfileUser(null)}
      />

      {/* ── Диалог подтверждения выхода из чата ── */}
      <Dialog
        open={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        PaperProps={{ sx: { bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 3, minWidth: 320 } }}
      >
        <DialogTitle sx={{ color: theme.text, fontSize: 18, fontWeight: 700 }}>
          Покинуть чат?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: theme.textSec, fontSize: 15 }}>
            Вы уверены, что хотите покинуть «{chatName}»? Вы больше не будете получать сообщения.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setLeaveConfirmOpen(false)}
            sx={{ color: theme.textSec, textTransform: 'none', fontSize: 15 }}>
            Отмена
          </Button>
          <Button
            onClick={async () => {
              setLeaveConfirmOpen(false);
              if (id) {
                await leaveChat(id);
                navigate('/');
              }
            }}
            sx={{
              bgcolor: '#f44336', color: '#fff', textTransform: 'none', fontSize: 15,
              borderRadius: 2, px: 3,
              '&:hover': { bgcolor: '#d32f2f' },
            }}
          >
            Покинуть
          </Button>
        </DialogActions>
      </Dialog>

      <NotificationSettingsDialog
        open={notifSettingsOpen}
        chatId={id}
        onClose={() => setNotifSettingsOpen(false)}
      />

      <ChatThemeDialog
        open={chatThemeOpen}
        chatId={id || null}
        onClose={() => setChatThemeOpen(false)}
      />

      {/* ── Активный звонок (legacy 1:1 CallModal больше не показываем — используется CallOverlay) ── */}

      {/* ── Диалог пересылки сообщения ── */}
      <Dialog
        open={!!forwardMsg}
        onClose={() => setForwardMsg(null)}
        PaperProps={{ sx: { bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 3, minWidth: 360, maxWidth: 480 } }}
      >
        <DialogTitle sx={{ color: theme.text, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Переслать сообщение
          <IconButton size="small" onClick={() => setForwardMsg(null)} sx={{ color: theme.textSec }}>
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          {forwardMsg && (
            <Box sx={{ bgcolor: theme.bgChat, borderRadius: 2, p: 1.5, mb: 2, border: `1px solid ${theme.border}` }}>
              <Typography sx={{ fontSize: 13, color: theme.accent, fontWeight: 600, mb: 0.3 }}>
                {forwardMsg.sender?.firstName || forwardMsg.sender?.username}
              </Typography>
              <Typography sx={{ fontSize: 14, color: theme.textSec }} noWrap>
                {forwardMsg.content || '📎 Вложение'}
              </Typography>
            </Box>
          )}
          <Typography sx={{ fontSize: 14, color: theme.textSec, mb: 1.5 }}>Выберите чат для пересылки:</Typography>
          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
            {chats.filter(c => c && c.id).map((c) => {
              const cName = c.name || (c.type === 'private'
                ? c.members?.find(m => m.userId !== user?.id)?.user?.firstName || 'Чат'
                : 'Группа');
              const cAvatar = resolveFileUrl(c.avatarUrl || (c.type === 'private'
                ? c.members?.find(m => m.userId !== user?.id)?.user?.avatarUrl
                : undefined));
              return (
                <Box
                  key={c.id}
                  onClick={async () => {
                    if (forwardMsg) {
                      await sendMessage(c.id, forwardMsg.content || '', undefined);
                    }
                    setForwardMsg(null);
                  }}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    px: 1.5, py: 1.2, borderRadius: 2, cursor: 'pointer',
                    '&:hover': { bgcolor: theme.bgHover },
                    transition: 'background 0.15s',
                  }}
                >
                  <Avatar src={cAvatar} sx={{ width: 38, height: 38, bgcolor: theme.accent + '60', fontSize: 14 }}>
                    {cName[0]?.toUpperCase()}
                  </Avatar>
                  <Typography sx={{ color: theme.text, fontSize: 15 }}>{cName}</Typography>
                </Box>
              );
            })}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default function ChatWindow() {
  return (
    <ChatErrorBoundary>
      <ChatWindowInner />
    </ChatErrorBoundary>
  );
}
