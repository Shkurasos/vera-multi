import React, { useEffect, useRef, useState, useMemo, useCallback, Component, ErrorInfo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Avatar, IconButton, TextField,
  Menu, MenuItem, Tooltip, LinearProgress, Popover,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Slider, Select, Divider as MuiDivider, Snackbar, Alert, Checkbox, FormControlLabel,
} from '@mui/material';
import {
  Send, Send as SendIcon, AttachFile, MoreVert, Search,
  EmojiEmotions, InfoOutlined, Close, PushPin,
  Call, Videocam, NotificationsOff, NotificationsActive,
  FormatSize, ExitToApp, ArrowBack, Palette, KeyboardArrowDown,
} from '@mui/icons-material';
import HowToVote from '@mui/icons-material/HowToVote';
import { CallModal } from './CallModal';
import { useCallStore } from '../store/callStore';
import { useChatStore } from '../store/chatStore';
import { useChatPrefsStore } from '../store/chatPrefsStore';
import { useChatSoundStore } from '../store/chatSoundStore';
import NotificationSettingsDialog from './NotificationSettingsDialog';
import { useAuthStore } from '../store/authStore';
import { useThemeStore, getFinishStyles } from '../store/themeStore';
import { useChatSettingsStore, BUILTIN_FONTS } from '../store/chatSettingsStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { useDraftsStore } from '../store/draftsStore';
import { useChatFontStore, STOCK_FONTS } from '../store/chatFontStore';
import { sendTypingStart, sendTypingStop, getSocket } from '../services/socket';
import { chatsApi, filesApi, messagesApi } from '../services/api';
import MessageBubble from './MessageBubble';
import HoldRecorder from './HoldRecorder';
import BubbleSettingsControls from './BubbleSettingsControls';
import { membranePressSx, motion } from '../styles/motion';
import ChatInfoPanel from './ChatInfoPanel';
import UserProfileModal from './UserProfileModal';
import { Message, User } from '../types';
import ChatThemeDialog from './ChatThemeDialog';
import { useChatThemeStore } from '../store/chatThemeStore';
import { useChatBgPrefsStore, STOCK_WALLPAPERS } from '../store/chatBgPrefsStore';
import { useShopStore, SHOP_CATALOG } from '../store/shopStore';
import { useCustomEquipStore } from '../store/customEquipStore';
import { specToStyle, specAnimationClass } from '../utils/customStyle';
import { resolveChatTheme } from '../utils/chatTheme';
import { saveLiveBg, loadLiveBgUrl, clearLiveBg, getLiveBgBlob } from '../services/chatLiveBgStorage';
import ChatWallpaper, { type WallpaperSpec } from './ChatWallpaper';

// Крупные разные тайлы не дают SVG-паттернам превращаться в мелкую сетку.
function patternBackgroundSize(pattern?: string, min = 860, max = 1400): string | undefined {
  if (!pattern) return undefined;
  const layers = Math.max(1, (pattern.match(/url\(/g) || []).length);
  const low = Math.max(200, Math.min(min, max));
  const high = Math.max(low, Math.max(min, max));
  return Array.from({ length: layers }, (_, index) => {
    const size = layers === 1 ? high : low + ((high - low) * index) / (layers - 1);
    return `${size}px ${size}px`;
  }).join(', ');
}

// Память скролла НЕ используем: чат всегда должен открываться на последнем
// сообщении — независимо от того, как он был закрыт/перезагружен.

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
    chats, messages, activeChat, setActiveChat, updateChatList,
    sendMessage, sendMessageWithFile, typingUsers,
    leaveChat, onlineUsers,
  } = useChatStore();
  const {
    toggleMute, isMuted, pinnedMessages,
  } = useChatPrefsStore();
  const mutedChats = { has: (id: string) => isMuted(id) };
  const { user } = useAuthStore();
    const { theme: baseTheme, setChatPhoto, setChatBgImage, chatPhoto: chatPhotoGlobal, themeVersion } = useThemeStore();
  const chatBgBrightness = useChatBgPrefsStore((s) => id ? s.getBrightness(id) : s.defaultBrightness);
  const setBgBrightness = useChatBgPrefsStore((s) => s.setBrightness);
  const getChatWallpaper = useChatBgPrefsStore((s) => s.getChatWallpaper);
  const perChatOverrides = useChatBgPrefsStore((s) => s.perChatOverrides);
  const globalStockWallpaper = useChatBgPrefsStore((s) => s.globalStockWallpaper);
  const userPhotoWallpaper = useChatBgPrefsStore((s) => s.userPhotoWallpaper);
  const setChatWallpaper = useChatBgPrefsStore((s) => s.setChatWallpaper);
  const clearChatWallpaper = useChatBgPrefsStore((s) => s.clearChatWallpaper);
  const liveBgStamp = useChatBgPrefsStore((s) => s.liveBgStamp);

  const { getDraft, setDraft, clearDraft } = useDraftsStore();
  const { getChatFont, setChatFont, clearChatFont } = useChatFontStore();
  const globalFontFamily = useUserSettingsStore((s) => s.globalFontFamily);
  const chatLayout = useUserSettingsStore((s) => s.layout);
  const bubblePrefs = useChatPrefsStore((s) => s.bubbleSettings[id || ''] || {});
  const setBubbleSettings = useChatPrefsStore((s) => s.setBubbleSettings);
  const effectiveBubble = {
    enabled: bubblePrefs.enabled ?? chatLayout.bubbleEnabled ?? true,
    textSize: bubblePrefs.textSize ?? chatLayout.bubbleTextSize ?? 15,
    padding: bubblePrefs.padding ?? chatLayout.bubblePadding ?? 6,
    maxWidth: bubblePrefs.maxWidth ?? chatLayout.messageMaxWidth,
  };
  const [text, setText] = useState('');
  const [keepSendButton, setKeepSendButton] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const forwardBusyRef = useRef(false);
  const [forwardError, setForwardError] = useState('');
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
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollSubmitting, setPollSubmitting] = useState(false);
  const pollSubmittingRef = useRef(false);
  useEffect(() => { setPollOpen(false); setPollQuestion(''); setPollOptions(['', '']); setPollMultiple(false); }, [id]);

  const createPoll = async () => {
    if (!id || activeChat?.type !== 'channel' || channelReadOnly || uploading || pollSubmittingRef.current) return;
    const question = pollQuestion.trim();
    const options = pollOptions.map(option => option.trim());
    if (!question || options.length < 2 || options.some(option => !option)) { setToast({ message: 'Укажите вопрос и заполните все варианты.', severity: 'warning' }); return; }
    pollSubmittingRef.current = true;
    setPollSubmitting(true);
    try {
      const result = await messagesApi.send(id, { type: 'poll', poll: { question, options: options.map((text, index) => ({ id: String(index + 1), text })), multiple: pollMultiple } });
      useChatStore.getState().replaceOrAddMessage(result.data);
      setPollOpen(false); setPollQuestion(''); setPollOptions(['', '']); setPollMultiple(false);
    } catch { setToast({ message: 'Не удалось создать опрос.', severity: 'error' }); }
    finally { pollSubmittingRef.current = false; setPollSubmitting(false); }
  };

  const {
    fontSize, emojiSize, fontFamily, customFonts,
    setFontSize, setEmojiSize, setFontFamily,
    addCustomFont, removeCustomFont,
  } = useChatSettingsStore();
  const layout = useUserSettingsStore((st) => st.layout);
  const fontInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBgInputRef = useRef<HTMLInputElement>(null);
  const liveBgInputRef = useRef<HTMLInputElement>(null);
  const [liveBgUrl, setLiveBgUrl] = useState<string | null>(null);
  const [loadedLiveBgKey, setLoadedLiveBgKey] = useState<string | null>(null);
  const [liveBgVersion, setLiveBgVersion] = useState(0);
  const [settingsOfferSent, setSettingsOfferSent] = useState(false);
  
  // Состояние для кнопки "прокрутить вниз"
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadAtBottom, setUnreadAtBottom] = useState(0);

  const currentWallpaper = useMemo(() => {
    if (!id) return null;
    if (perChatOverrides[id]) return perChatOverrides[id];
    if (activeChat?.id === id && activeChat.wallpaper) return activeChat.wallpaper;
    return getChatWallpaper(id);
  }, [id, activeChat?.id, activeChat?.wallpaper, getChatWallpaper, perChatOverrides, globalStockWallpaper, userPhotoWallpaper]);
  const liveWallpaperScope = currentWallpaper?.type === 'live' ? currentWallpaper.value : null;
  const liveWallpaperKey = `${id}:${liveWallpaperScope}:${liveBgVersion}:${liveBgStamp}`;

  // Перезагружаем видео при смене чата и освобождаем URL предыдущего фона.
  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    (async () => {
      setLiveBgUrl(null);
      if (!liveWallpaperScope) return;
      const url = await loadLiveBgUrl(liveWallpaperScope);
      if (cancelled) { if (url) URL.revokeObjectURL(url); return; }
      currentUrl = url;
      setLiveBgUrl(url);
      setLoadedLiveBgKey(liveWallpaperKey);
    })();
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [liveWallpaperScope, liveWallpaperKey]);
  const prevMsgCountRef = useRef<number>(0);


  // URL для рендера: stock из каталога, photo из per-chat override, или live video
  const wallpaperPhotoUrl = useMemo(() => {
    if (!currentWallpaper) return null;
    if (currentWallpaper.type === 'stock') {
      const stock = STOCK_WALLPAPERS.find(w => w.id === currentWallpaper.value);
      return stock?.url || null;
    }
    if (currentWallpaper.type === 'photo') {
      return resolveFileUrl(currentWallpaper.value); // dataURL или URL
    }
    return null;
  }, [currentWallpaper]);

  const hasLiveWallpaper = currentWallpaper?.type === 'live' && loadedLiveBgKey === liveWallpaperKey;

  const offerChatSettings = async () => {
    if (!id || !getSocket()?.connected) {
      setToast({ message: 'Собеседник недоступен для предложения', severity: 'warning' });
      return;
    }
    try {
      const wallpaper = currentWallpaper ? { ...currentWallpaper } : null;
      const settings: any = {
        theme: useChatThemeStore.getState().getTheme(id) || null,
        wallpaper,
        brightness: useChatBgPrefsStore.getState().getBrightness(id),
      };
      if (wallpaper?.type === 'live') {
        const blob = await getLiveBgBlob(wallpaper.value);
        if (blob) {
          settings.videoDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        }
      }
      getSocket()?.emit('chat:settings_offer', { chatId: id, settings });
      setSettingsOfferSent(true);
      setToast({ message: 'Предложение отправлено собеседнику', severity: 'info' });
    } catch (error) {
      console.error('settings offer error:', error);
      setToast({ message: 'Не удалось подготовить настройки', severity: 'error' });
    }
  };

  useEffect(() => {
    setKeepSendButton(false);
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
      // Загружаем черновик для этого чата
      const draft = getDraft(id);
      setText(draft);
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

  const channelReadOnly = activeChat?.type === 'channel' && !activeChat.members.some(m => m.userId === user?.id && (m.role === 'owner' || m.role === 'admin'));
  const chatMessages = (messages[id || ''] || []).filter(m => activeChat?.type !== 'channel' || !m.replyToId);

  // Звук при новом сообщении от другого пользователя обрабатывается глобально
  // в App.tsx (слушатель socket 'message-new'). Здесь только сбрасываем счётчик
  // при смене чата, чтобы старый локальный триггер не повторял звук.
  useEffect(() => {
    prevMsgCountRef.current = chatMessages.length;
  }, [id]);

  // ── Скролл ─────────────────────────────────────────────────────────────────
  // ПРАВИЛО: чат ВСЕГДА открывается на последнем сообщении (низ). Никакой
  // памяти позиции, никаких анимаций. При новых сообщениях автоскроллим
  // ТОЛЬКО если пользователь и так был внизу.
  const atBottomRef = useRef<boolean>(true);
  const lastChatIdRef = useRef<string | null>(null);
  const restoredRef = useRef<boolean>(false);
  const prevMsgLenRef = useRef<number>(0);

  // (1) Открытие чата — ВСЕГДА показываем последнее сообщение (низ).
  // Jump to bottom + УДЕРЖИВАЕМ низ, пока медиа/шрифты догружаются и меняют
  // высоту. ResizeObserver на контейнере НЕ ловит рост scrollHeight при
  // догрузке картинок, поэтому поллим высоту вручную + MutationObserver.
  React.useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!id || !container || chatMessages.length === 0) return;

    // Сброс при смене чата.
    if (lastChatIdRef.current !== id) {
      lastChatIdRef.current = id;
      restoredRef.current = false;
      atBottomRef.current = true;
    }

    const pinToBottom = () => {
      try { messagesEndRef.current?.scrollIntoView({ block: 'end' }); } catch {}
      container.scrollTop = container.scrollHeight;
    };

    pinToBottom();
    atBottomRef.current = true;
    restoredRef.current = true;
    prevMsgLenRef.current = chatMessages.length;
    setShowScrollButton(false);

    // 1) rAF-цикл — пока layout устаканивается (до ~1.5 сек).
    let raf = 0;
    let frames = 0;
    const tick = () => {
      if (!atBottomRef.current) return;
      pinToBottom();
      if (++frames < 90) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // 2) Поллинг scrollHeight каждые 50 мс — ловит догрузку картинок/видео/
    //    аудио/шрифтов, которые растягивают контент после нашего jump'а.
    let ticks = 0;
    const timer = setInterval(() => {
      if (!atBottomRef.current) { clearInterval(timer); return; }
      const bottom = container.scrollHeight - container.clientHeight;
      // Первые 5 тиков жмём безусловно (гарантированная фиксация низа),
      // дальше — только если контент реально вырос ниже текущей позиции.
      if (ticks <= 4 || container.scrollTop < bottom - 2) pinToBottom();
      if (++ticks >= 120) clearInterval(timer); // ≈6 сек максимум
    }, 50);

    // 3) MutationObserver — в DOM добавились новые сообщения/медиа — дожать низ.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => { if (atBottomRef.current) pinToBottom(); });
      observer.observe(container, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['src', 'style', 'class'],
      });
    }

    const cleanup = () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      observer?.disconnect();
    };
    const stopTimer = setTimeout(cleanup, 6000);
    return () => { cleanup(); clearTimeout(stopTimer); };
  }, [id, chatMessages.length]);

  // (2) Новые сообщения — автоскролл ТОЛЬКО если были внизу.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !restoredRef.current) return;
    const prev = prevMsgLenRef.current;
    const curr = chatMessages.length;
    if (curr > prev && atBottomRef.current) {
      // Плавно докатываемся до низа при новом сообщении.
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
    prevMsgLenRef.current = curr;
  }, [chatMessages.length]);

  // (3) Отслеживание позиции + кнопка «вниз» + непрочитанные.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      atBottomRef.current = distanceFromBottom < 40;
      setShowScrollButton(distanceFromBottom > 200);

      if (distanceFromBottom > 200) {
        const lastReadIndex = chatMessages.findIndex(msg => msg.senderId !== user?.id && !msg.readBy?.includes(user?.id || ''));
        if (lastReadIndex !== -1) {
          const unreadCount = chatMessages.slice(lastReadIndex).filter(msg =>
            msg.senderId !== user?.id && !msg.readBy?.includes(user?.id || '')
          ).length;
          setUnreadAtBottom(unreadCount);
        } else {
          setUnreadAtBottom(0);
        }
      } else {
        setUnreadAtBottom(0);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [chatMessages, user?.id]);

  // Память позиции не храним — чат всегда открывается на последнем сообщении.

  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
    atBottomRef.current = true;
    setShowScrollButton(false);
    setUnreadAtBottom(0);
  };

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
    if (channelReadOnly || uploading) return;
    if ((!text.trim() && pendingFiles.length === 0) || !id) return;
    if (activeChat?.type === 'channel' && pendingFiles.length) {
      if (pendingFiles.length > 20) {
        setToast({ message: 'В одном посте можно прикрепить до 20 файлов.', severity: 'warning' });
        return;
      }
      setUploading(true); setUploadProgress(0);
      try {
        const attachments = [];
        for (let i = 0; i < pendingFiles.length; i++) {
          const file = pendingFiles[i];
          const result = await filesApi.uploadWithProgress(file, progress => {
            setUploadProgress(Math.round(((i + progress / 100) / pendingFiles.length) * 100));
          });
          const attachment = toMessageAttachment(result.data, file);
          if (!attachment.fileUrl) throw new Error('Missing file URL');
          attachments.push(attachment);
        }
        const result = await messagesApi.send(id, { text: text.trim(), attachments, type: 'document' });
        useChatStore.getState().replaceOrAddMessage(result.data);
        setText(''); clearDraft(id); setReplyTo(null);
        pendingPreviews.forEach(url => { if (url) URL.revokeObjectURL(url); });
        setPendingFiles([]); setPendingPreviews([]);
      } catch {
        setToast({ message: 'Не удалось опубликовать пост. Текст и файлы сохранены — попробуйте ещё раз.', severity: 'error' });
      } finally {
        setUploading(false); setUploadProgress(0);
      }
      return;
    }
    const msg = text.trim();
    // Не переключаем кнопку на микрофон сразу после очистки поля: на мобильных
    // такая перестройка composer может забрать фокус и закрыть клавиатуру.
    setKeepSendButton(true);
    setText('');
    messageInputRef.current?.focus({ preventScroll: true });
    if (id) clearDraft(id); // Очищаем черновик после отправки
    if (typingTimer.current) clearTimeout(typingTimer.current);
    try { sendTypingStop(id); } catch {}
    if (msg) {
      await sendMessage(id, msg, activeChat?.type === 'channel' ? undefined : replyTo?.id);
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
    if (id) setDraft(id, value); // Сохраняем черновик при каждом изменении
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
    // Добавляем в pending — показываем превью перед отправкой
    const newFiles = Array.from(files);
    e.target.value = '';
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

  const sendRecordedFile = async (file: File, round: boolean) => {
    if (!id) return;
    setUploading(true);
    try {
      const upload = await filesApi.uploadWithProgress(file, setUploadProgress);
      const attachment: any = toMessageAttachment(upload.data, file);
      if (!attachment.fileUrl) throw new Error('Upload response does not contain a file URL');
      await sendMessageWithFile(id, attachment, undefined, round ? 'video' : 'voice');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Загрузить массив File[] и отправить
  const uploadAndSendFiles = async (files: File[]) => {
    if (channelReadOnly || !files.length || !id) return;
    setUploading(true); setUploadProgress(0);
    let sentCount = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(Math.round((i / files.length) * 100));
        // Upload the binary first. The message API stores attachment metadata,
        // while the file itself must be sent as multipart/form-data.
        const upload = await filesApi.uploadWithProgress(file, (progress) => {
          setUploadProgress(Math.round(((i + progress / 100) / files.length) * 100));
        });
        const attachment: any = toMessageAttachment(upload.data, file);
        if (!attachment.fileUrl) throw new Error('Upload response does not contain a file URL');
        const mime = attachment.mimeType || '';
        let msgType = 'document';
        if (mime.startsWith('image/')) msgType = 'photo';
        else if (mime.startsWith('video/')) msgType = 'video';
        else if (mime.startsWith('audio/')) msgType = 'audio';
        await sendMessageWithFile(id, attachment, activeChat?.type === 'channel' ? undefined : replyTo?.id, msgType);
        sentCount++;
      }
      setReplyTo(null);
    } catch (err) {
      console.error('uploadAndSendFiles error:', err);
      setToast({ message: 'Ошибка загрузки файла. Проверьте подключение к серверу.', severity: 'error' });
    } finally {
      setUploading(false); setUploadProgress(0);
      pendingPreviews.slice(0, sentCount).forEach(url => { if (url) URL.revokeObjectURL(url); });
      setPendingFiles(current => current.slice(sentCount));
      setPendingPreviews(current => current.slice(sentCount));
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
  const handleReply = useCallback((m: Message) => {
    if (activeChat?.type !== 'channel') setReplyTo(m);
  }, [activeChat?.type]);
  const handleForward = useCallback((m: Message) => { setForwardError(''); setForwardMsg(m); }, []);
  const handleSetProfileUser = useCallback((u: User) => setProfileUser(u), []);
  const handleScrollToMessage = useCallback((msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s';
      el.style.background = theme.accent + '30';
      setTimeout(() => { el.style.background = ''; }, 1500);
    }
  }, [baseTheme.accent]);

  const handleAvatarClick = () => {
    const partner = getPartnerUser();
    if (partner) setProfileUser(partner);
    else setShowInfo(v => !v);
  };

  // ── Хуки для магазинных возможностей (должны вызываться ДО ранних return, иначе React error #310) ──
  const chatThemeOverride = useChatThemeStore((s) => (id ? s.themes[id] : undefined));
  // Персональная тема имеет приоритет только внутри текущего окна чата.
  // Цвет своих пузырей из персональной темы не должен следовать за общей темой
  // (см. resolveChatTheme) — иначе смена общей темы перекрашивает свои пузыри.
  const theme = resolveChatTheme(baseTheme, chatThemeOverride);
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
        onPointerDown={(e) => {
          const target = e.target as Element;
          if (!target.closest('[data-chat-composer]')) {
            setKeepSendButton(false);
            messageInputRef.current?.blur();
          }
        }}
        sx={{
          display: 'flex', flexDirection: 'column',
          flex: 1, height: '100%',
          bgcolor: 'transparent',
          background: theme.disableBackgroundGlow || theme.disableBackgroundBlobs
            ? theme.bgChat
            : `radial-gradient(circle at 78% 0%, ${theme.backgroundGlowColor || '#8FE3CF'}14 0, transparent 30%), radial-gradient(circle at 8% 100%, ${theme.backgroundGlowColor || '#8FE3CF'}10 0, transparent 34%), ${theme.bgChat}`,
          overflow: 'hidden',
          position: 'relative',
          transformOrigin: '50% 72%',
          animation: `chatDepthIn 420ms ${motion.emphasized} both`,
          '@keyframes chatDepthIn': {
            '0%': { opacity: 0, transform: 'translateY(18px) scale(.972) rotateX(3deg)', filter: 'blur(12px)' },
            '100%': { opacity: 1, transform: 'translateY(0) scale(1) rotateX(0)', filter: 'blur(0)' },
          },
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
        {smartWpSpec && !customWallpaperSpec && !currentWallpaper && !theme.chatBgImage && (
          <Box sx={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <ChatWallpaper spec={smartWpSpec} isLight={isLightTheme} />
          </Box>
        )}
        {customWallpaperSpec && !currentWallpaper && !theme.chatBgImage && (
          <Box sx={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: (specToStyle(customWallpaperSpec).background as string | undefined) || undefined,
          }} className={specAnimationClass(customWallpaperSpec)} />
        )}
        {/* ── Живые обои (видео-слой, приоритет выше фото) ── */}
        {hasLiveWallpaper && liveBgUrl && (
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
              bgcolor: `rgba(0,0,0,${1 - chatBgBrightness})`,
              pointerEvents: 'none',
            }} />
          </>
        )}

        {/* ── Фото-фон чата (стоковые или per-chat) ── */}
        {!hasLiveWallpaper && wallpaperPhotoUrl && (
          <>
            {/* само фото */}
            <Box sx={{
              position: 'absolute', inset: 0, zIndex: 0,
              backgroundImage: `url(${wallpaperPhotoUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              pointerEvents: 'none',
            }} />
            {/* затемнение */}
            <Box sx={{
              position: 'absolute', inset: 0, zIndex: 1,
              bgcolor: `rgba(0,0,0,${1 - chatBgBrightness})`,
              pointerEvents: 'none',
            }} />
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
          px: { xs: 0.75, md: 2.5 }, py: { xs: 0.65, md: 1.5 }, gap: { xs: 0.5, md: 2 },
          background: theme.headerGradient || theme.bgHeader,
          backdropFilter: 'blur(22px)',
          borderBottom: layout.chatHeaderPos === 'bottom' ? 'none' : `1px solid ${theme.border}`,
          borderTop: layout.chatHeaderPos === 'bottom' ? `1px solid ${theme.border}` : 'none',
          boxShadow: '0 16px 44px rgba(0,0,0,0.22)',
          flexShrink: 0,
          position: 'relative', zIndex: 2,
          order: { xs: 0, md: layout.chatHeaderPos === 'bottom' ? 3 : 0 },
          ...getFinishStyles(theme),
          '& .mobile-secondary-action': { display: { xs: 'none', md: 'inline-flex' } },
        }}>
          {/* Avatar — клик открывает профиль/инфо */}
          <Tooltip title="К списку чатов">
            <IconButton
              onClick={() => navigate('/')}
              sx={{ color: theme.textSec, mr: -0.25, p: 0.75, display: { xs: 'inline-flex', md: 'none' } }}
            >
              <ArrowBack />
            </IconButton>
          </Tooltip>
          <Avatar
            src={chatAvatar || undefined}
            onClick={handleAvatarClick}
            sx={{
              width: { xs: 40, md: 46 }, height: { xs: 40, md: 46 }, fontSize: { xs: 15, md: 17 },
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
            <Typography sx={{ fontWeight: 700, fontSize: { xs: 15, md: 17 }, color: theme.text }} noWrap>
              {chatName}
            </Typography>
            <Typography sx={{
              fontSize: { xs: 11, md: 13 },
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
              <Tooltip title="РђСѓРґРёРѕ Р·РІРѕРЅРѕРє">
                <span>
                  <IconButton className="mobile-secondary-action"
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
                <IconButton className="mobile-secondary-action"
                  onClick={() => useCallStore.getState().startCall(id!, 'video')}
                  sx={{ color: theme.textSec, '&:hover': { color: '#3b82f6' } }}
                >
                  <Videocam sx={{ fontSize: 22 }} />
                </IconButton>
              </Tooltip>
            </>
          )}

          <Tooltip title="РџРѕРёСЃРє РїРѕ СЃРѕРѕР±С‰РµРЅРёСЏРј">
            <IconButton className="mobile-secondary-action" onClick={() => { setShowSearch(v => !v); setSearchQuery(''); }}
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
            <MenuItem onClick={() => { setAnchorEl(null); setShowSearch(true); setSearchQuery(''); }}
              sx={{
                gap: 1.5, py: 1.2, px: 2,
                color: theme.text, fontSize: 14, fontWeight: 500,
                display: { xs: 'flex', md: 'none' },
                '&:hover': { bgcolor: theme.bgHover },
              }}>
              <Search sx={{ fontSize: 18, color: theme.textSec }} />
              Поиск по сообщениям
            </MenuItem>
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
            <MenuItem onClick={() => { setAnchorEl(null); void offerChatSettings(); }}
              sx={{ gap: 1.5, py: 1.2, px: 2, color: theme.text, fontSize: 14, fontWeight: 500, '&:hover': { bgcolor: theme.bgHover } }}>
              <Palette sx={{ fontSize: 18, color: theme.textSec }} />
              {settingsOfferSent ? 'Предложение отправлено' : 'Предложить настройки собеседнику'}
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
              if (!id) return;
              await clearLiveBg(id);
              setLiveBgVersion((v) => v + 1);
              if (id) {
                setChatWallpaper(id, { type: 'stock', value: 'none' });
                chatsApi.update(id, { wallpaper: { type: 'stock', value: 'none' } }).then((res) => updateChatList(res.data)).catch((err) => console.error('clear wallpaper error:', err));
              }
              setToast({ message: 'Живые обои убраны из этого чата', severity: 'info' });
            }}>
              🗑 Убрать живые обои
            </MenuItem>
            <MuiDivider sx={{ borderColor: theme.border, my: 0.5 }} />
            {/* Яркость фона чата */}
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>
                Яркость фона ({Math.round(chatBgBrightness * 100)}%)
              </Typography>
              <Slider
                value={chatBgBrightness}
                onChange={(_, v) => id && setBgBrightness(id, v as number)}
                min={0}
                max={1}
                step={0.05}
                size="small"
                sx={{
                  color: theme.accent,
                  '& .MuiSlider-thumb': { width: 14, height: 14 },
                }}
              />
            </Box>
            <MuiDivider sx={{ borderColor: theme.border, my: 0.5 }} />
            <MenuItem onClick={() => { 
              setAnchorEl(null); 
              if (id) {
                setChatWallpaper(id, { type: 'stock', value: 'none' });
                chatsApi.update(id, { wallpaper: { type: 'stock', value: 'none' } }).then((res) => updateChatList(res.data)).catch((err) => console.error('clear wallpaper error:', err));
              }
              setToast({ message: 'Обои убраны из этого чата', severity: 'info' }); 
            }}>
              🗑 Убрать обои из этого чата
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
                if (!id) return;
                await saveLiveBg(file, id);
                setLiveBgVersion((v) => v + 1);
                // Сохраняем как per-chat override типа 'live'
                setChatWallpaper(id, { type: 'live', value: id });
                setToast({ message: 'Живые обои установлены для этого чата', severity: 'success' });
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
                const upload = await filesApi.uploadWithProgress(file, setUploadProgress);
                const url = upload.data?.url;
                if (!url || !id) throw new Error('no uploaded url');
                const saved = await chatsApi.update(id, { wallpaper: { type: 'photo', value: url } });
                setChatWallpaper(id, { type: 'photo', value: url });
                updateChatList(saved.data);
                setToast({ message: 'Фото чата установлено для этого чата', severity: 'success' });
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
                <Typography sx={{ fontSize: effectiveBubble.textSize, fontFamily, color: theme.text, lineHeight: 1.5 }}>
                  Пример текста сообщения
                </Typography>
                <Typography component="span" sx={{ fontSize: emojiSize, lineHeight: 1 }}>😀🎉❤️</Typography>
              </Box>

              <Typography sx={{ color: theme.textSec, mb: 1 }}>Пузыри только для этого чата</Typography>
              <BubbleSettingsControls value={effectiveBubble} onChange={patch => id && setBubbleSettings(id, patch)} />
              <Button onClick={() => id && useChatPrefsStore.getState().clearBubbleSettings(id)}>Использовать общие настройки</Button>

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

              {/* Шрифт для этого чата */}
              <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1, fontWeight: 600 }}>
                Шрифт для этого чата
              </Typography>
              <Select
                value={id ? (getChatFont(id) || 'default') : 'default'}
                onChange={(e) => {
                  if (!id) return;
                  const val = e.target.value;
                  if (val === 'default') {
                    clearChatFont(id);
                  } else {
                    setChatFont(id, val);
                  }
                }}
                size="small"
                fullWidth
                sx={{
                  color: theme.text, bgcolor: theme.bgInput, borderRadius: 2, mb: 1,
                  fontFamily: id ? (getChatFont(id) || globalFontFamily) : globalFontFamily,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.border },
                  '& .MuiSvgIcon-root': { color: theme.textSec },
                  '& .MuiSelect-select': { py: 1 },
                }}
                MenuProps={{ PaperProps: { sx: { bgcolor: theme.bgHeader, border: `1px solid ${theme.border}` } } }}
              >
                {STOCK_FONTS.map(f => (
                  <MenuItem key={f.id} value={f.id === 'default' ? 'default' : f.family} sx={{ fontFamily: f.family, color: theme.text }}>
                    {f.name}
                  </MenuItem>
                ))}
              </Select>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 2, fontStyle: 'italic' }}>
                💡 Шрифт применяется только к этому чату. Глобальные настройки шрифта можно изменить в настройках приложения.
              </Typography>

              {/* Шрифт */}
              <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1, fontWeight: 600 }}>
                Шрифт сообщений (устаревшее, для совместимости)
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
            position: 'relative', zIndex: 2, order: { xs: 1, md: 1 },
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
            width: '100%', minWidth: 0, maxWidth: '100%',
            overflow: 'hidden', boxSizing: 'border-box',
            cursor: 'pointer',
            position: 'relative', zIndex: 2, order: { xs: 1, md: 1 },
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
            <Box flex={1} minWidth={0} maxWidth="100%" overflow="hidden">
              <Typography sx={{ fontSize: 12, color: theme.accent, fontWeight: 600 }}>Закреплённое сообщение</Typography>
              <Typography sx={{ fontSize: 13, color: theme.textSec, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              position: 'relative', zIndex: 2, order: { xs: 1, md: 1 },
            }}
          />
        )}

        {/* ── Messages ── */}
        <Box sx={{
          // overflowY:'scroll' + scrollbarGutter → скроллбар виден ВСЕГДА
          // (а не только при наведении/прокрутке), бегунок при открытии
          // чата стоит в самом низу — чат открывается на последнем сообщении.
          flex: 1, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable',
          WebkitOverflowScrolling: 'touch', touchAction: 'pan-y',
          px: { xs: 1, md: 2.5 }, py: { xs: 1.25, md: 2 },
          pb: { xs: 'calc(1.25rem + env(safe-area-inset-bottom))', md: 2 },
          backgroundImage: theme.chatPattern,
          backgroundSize: patternBackgroundSize(theme.chatPattern, theme.chatPatternSizeMin, theme.chatPatternSizeMax),
          backgroundBlendMode: 'screen',
          fontFamily: id ? (getChatFont(id) || globalFontFamily) : globalFontFamily,
          '&::-webkit-scrollbar': { width: { xs: 0, md: 5 } },
          '&::-webkit-scrollbar-track': { bgcolor: theme.bgChat ? theme.bgChat + '55' : 'rgba(255,255,255,0.04)' },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: theme.accent + '30', borderRadius: 4,
            '&:hover': { bgcolor: theme.accent + '60' },
          },
          position: 'relative', zIndex: 2, order: 2,
        }}
          ref={messagesContainerRef}
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
              {msgs.map((msg, index) => {
                const previous = msgs[index - 1];
                const next = msgs[index + 1];
                const isGroupStart = !previous || previous.senderId !== msg.senderId;
                const isGroupEnd = !next || next.senderId !== msg.senderId;
                return (
                                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={activeChat.type !== 'channel' && msg.senderId === user?.id}
                  isHovered={hoveredMsgId === msg.id}
                  onHover={handleHover}
                  onOpenActions={handleOpenActions}
                  onReply={handleReply}
                  onForward={handleForward}
                  onAvatarClick={handleSetProfileUser}
                  onScrollToMessage={handleScrollToMessage}
                  accent={theme.accent}
                  themeVersion={themeVersion}
                  bubbleOwnGradient={theme.bubbleOwnGradient}
                  bgBubbleOwn={theme.bgBubbleOwn}
                  bgBubbleOther={theme.bgBubbleOther}
                  bubbleOwnShadow={theme.bubbleOwnShadow}
                  bubbleOtherShadow={theme.bubbleOtherShadow}
                  messageMaxWidth={effectiveBubble.maxWidth}
                  messageAlign={chatLayout.messageAlign}
                  bubbleEnabled={effectiveBubble.enabled}
                  bubbleTextSize={effectiveBubble.textSize}
                  bubblePadding={effectiveBubble.padding}
                  isGroupStart={isGroupStart}
                  isGroupEnd={isGroupEnd}
                />
                );
              })}
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

        {/* ── Кнопка "Прокрутить вниз" ── */}
        {showScrollButton && (
          <Box
            onClick={scrollToBottom}
            sx={{
              position: 'absolute',
              bottom: { xs: 80, sm: 90 },
              right: { xs: 16, sm: 24 },
              width: 48,
              height: 48,
              borderRadius: '50%',
              bgcolor: theme.accent,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: `0 4px 12px ${theme.accent}66`,
              transition: 'all 0.25s ease',
              zIndex: 10,
              '&:hover': {
                transform: 'scale(1.1)',
                boxShadow: `0 6px 16px ${theme.accent}88`,
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
            }}
          >
            <KeyboardArrowDown sx={{ fontSize: 28 }} />
            {unreadAtBottom > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  minWidth: 20,
                  height: 20,
                  borderRadius: '10px',
                  bgcolor: theme.online || '#4CAF50',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  px: 0.5,
                  border: `2px solid ${theme.bg}`,
                }}
              >
                {unreadAtBottom > 99 ? '99+' : unreadAtBottom}
              </Box>
            )}
          </Box>
        )}

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
                onClick={() => activeChat?.type === 'channel' ? handleSend() : uploadAndSendFiles(pendingFiles)}
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
        <Box data-chat-composer sx={{
          display: 'flex', alignItems: 'flex-end', gap: 0.85,
          px: { xs: 0.65, md: 1.6 }, py: { xs: 0.55, md: 1.25 },
          pb: { xs: 'calc(0.55rem + env(safe-area-inset-bottom))', md: 1.25 },
          bgcolor: theme.bgHeader,
          backdropFilter: 'blur(22px)',
          borderTop: layout.chatInputPos === 'top' ? 'none' : `1px solid ${theme.border}`,
          borderBottom: layout.chatInputPos === 'top' ? `1px solid ${theme.border}` : 'none',
          boxShadow: layout.chatInputPos === 'top' ? '0 18px 46px rgba(0,0,0,0.28)' : '0 -18px 46px rgba(0,0,0,0.28)',
          flexShrink: 0,
          position: 'relative', zIndex: 2,
          order: { xs: 4, md: layout.chatInputPos === 'top' ? 1 : 4 },
        }}>

          {activeChat?.type === 'channel' && !channelReadOnly && (
            <Tooltip title="Создать опрос">
              <IconButton aria-label="Создать опрос" onClick={() => setPollOpen(true)} disabled={uploading} sx={{ width: 42, height: 42, bgcolor: theme.bgInput, color: theme.textSec, flexShrink: 0, '&:hover': { bgcolor: theme.bgHover, color: theme.text } }}><HowToVote sx={{ fontSize: 21 }} /></IconButton>
            </Tooltip>
          )}
          {/* Кнопка скрепки */}
          <Tooltip title="Прикрепить файл">
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>
              <IconButton
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Прикрепить файл"
                sx={{
                  width: 42, height: 42,
                  bgcolor: theme.bgInput,
                  color: uploading ? theme.border : theme.textSec,
                  transform: 'none',
                  transition: 'background 0.15s, color 0.15s',
                  '&:hover': { bgcolor: theme.bgHover, color: theme.text },
                }}
              >
                <AttachFile sx={{ fontSize: 22 }} />
              </IconButton>
            </span>
          </Tooltip>
          <input
            id="chat-file-input"
            ref={fileInputRef}
            type="file"
            multiple
            accept="*/*"
            disabled={uploading}
            onChange={handleFileUpload}
            style={{
              display: 'none',
            }}
          />

          <Tooltip title="Эмодзи">
            <IconButton
              onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget)}
              sx={{
                width: 42, height: 42,
                color: emojiAnchor ? theme.accent : theme.textSec,
                transform: 'none',
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

          <TextField
              fullWidth multiline maxRows={6}
              key="message-composer-input"
              disabled={channelReadOnly}
              placeholder={channelReadOnly ? "Комментарии доступны под публикациями" : activeChat.type === "channel" ? "Публикация от имени канала..." : "Сообщение..."}
              value={text}
              inputRef={messageInputRef}
              onFocus={() => setKeepSendButton(true)}
              onChange={(e) => handleTyping(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              variant="outlined" size="small"
              inputProps={{ maxLength: 10000 }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: theme.bgInput, borderRadius: 999, fontSize: { xs: 16, md: 15 },
                  color: theme.text,
                  backdropFilter: 'blur(16px)',
                  transition: `transform 220ms ${motion.spring}, box-shadow 240ms ${motion.easeOut}, border-color 180ms ${motion.easeOut}`,
                  boxShadow: keepSendButton ? `0 0 0 4px ${theme.accent}12, 0 14px 32px rgba(0,0,0,.24)` : '0 8px 22px rgba(0,0,0,.16)',
                  '&:active': { transform: 'scale(.992)' },
                  '& fieldset': { borderColor: theme.border },
                  '&:hover fieldset': { borderColor: theme.accent + '40' },
                  '&.Mui-focused fieldset': { borderColor: theme.accent + '80' },
                  ...getFinishStyles(theme),
                },
                '& .MuiInputBase-input::placeholder': { color: theme.textSec },
              }}
            />

          {(text.trim() || pendingFiles.length > 0 || keepSendButton) ? (
            <Tooltip title="Отправить (Enter)">
              <IconButton
                onPointerDown={(e) => {
                  e.preventDefault();
                  messageInputRef.current?.focus({ preventScroll: true });
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSend}
                sx={{
                width: 42, height: 42,
                bgcolor: theme.accent, color: '#fff',
                transform: 'none',
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
              }} disabled={channelReadOnly || uploading || (!text.trim() && pendingFiles.length === 0)}>
                <SendIcon sx={{ fontSize: 22 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <HoldRecorder
              key={id}
              disabled={channelReadOnly || uploading}
              onSend={sendRecordedFile}
              onError={(message) => setToast({ message, severity: 'warning' })}
            />
          )}
        </Box>
      </Box>

      <Dialog open={pollOpen} onClose={() => { if (!pollSubmitting) setPollOpen(false); }} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3 } }}>
        <DialogTitle>Новый опрос канала</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField autoFocus label="Вопрос" value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} inputProps={{ maxLength: 500 }} fullWidth />
          {pollOptions.map((option, index) => <TextField key={index} label={`Вариант ${index + 1}`} value={option} onChange={e => setPollOptions(current => current.map((item, i) => i === index ? e.target.value : item))} inputProps={{ maxLength: 200 }} fullWidth />)}
          {pollOptions.length < 10 && <Button onClick={() => setPollOptions(current => [...current, ''])}>Добавить вариант</Button>}
          {pollOptions.length > 2 && <Button color="inherit" onClick={() => setPollOptions(current => current.slice(0, -1))}>Удалить последний вариант</Button>}
          <FormControlLabel control={<Checkbox checked={pollMultiple} onChange={e => setPollMultiple(e.target.checked)} />} label="Разрешить выбрать несколько вариантов" />
        </DialogContent>
        <DialogActions><Button disabled={pollSubmitting} onClick={() => setPollOpen(false)}>Отмена</Button><Button variant="contained" disabled={pollSubmitting || !pollQuestion.trim() || pollOptions.some(option => !option.trim())} onClick={createPoll}>{pollSubmitting ? 'Публикация…' : 'Опубликовать'}</Button></DialogActions>
      </Dialog>

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
        onClose={() => { if (!forwardBusy) setForwardMsg(null); }}
        PaperProps={{ sx: { bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 3, minWidth: 360, maxWidth: 480 } }}
      >
        <DialogTitle sx={{ color: theme.text, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Переслать сообщение
          <IconButton size="small" disabled={forwardBusy} onClick={() => setForwardMsg(null)} sx={{ color: theme.textSec }}>
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
          {forwardError && <Alert severity="error">{forwardError}</Alert>}
          {forwardBusy && <LinearProgress />}
          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
            {chats.filter(c => c && c.id && c.id !== 'vera-ai' && (c.type !== 'channel' || c.members.some(m => m.userId === user?.id && ['owner', 'admin'].includes(m.role)))).map((c) => {
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
                    if (!forwardMsg || forwardBusyRef.current) return;
                    forwardBusyRef.current = true;
                    setForwardBusy(true); setForwardError('');
                    try {
                      await useChatStore.getState().forwardMessage(c.id, forwardMsg);
                      setForwardMsg(null);
                      setToast({ message: 'Сообщение переслано', severity: 'success' });
                    } catch (error: any) {
                      setForwardError(error?.response?.data?.message || error?.message || 'Не удалось переслать сообщение');
                    } finally {
                      forwardBusyRef.current = false; setForwardBusy(false);
                    }
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
