import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
const ThemeEditor = lazy(() => import('./ThemeEditor').then(m => ({ default: m.ThemeEditor })));
const ThemeMarketplace = lazy(() => import('./ThemeMarketplace').then(m => ({ default: m.ThemeMarketplace })));
import {
  Box, List, ListItem, ListItemText, Avatar,
  Typography, TextField, IconButton, Badge, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, InputAdornment, Alert, Snackbar, Stack, Divider, Checkbox, FormControlLabel,
} from '@mui/material';
import {
  Search, Group, PersonAdd, Archive,
  PinDropOutlined as Pin, NotificationsOffOutlined as Mute, DeleteForever, Palette,
  LibraryMusic, AccountCircle, SmartToy, Security, ChevronLeft,
  ContentCopy, ContentPaste, QrCode, Link,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useChatStore, chatActivityAt } from '../store/chatStore';
import { useChatPrefsStore } from '../store/chatPrefsStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore, getFinishStyles, type Theme } from '../store/themeStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import {
  UI_NAV_RADIUS, navPanelBackground, useUiPrefsStore,
  compactNavPanelPx, compactNavButtonPx, compactNavIconPx, compactNavBackground,
} from '../store/uiPrefsStore';
import { useDraftsStore } from '../store/draftsStore';
import { useSidebarViewStore } from '../store/sidebarViewStore';
import { useChatBgPrefsStore } from '../store/chatBgPrefsStore';
import { usePhotoBgUrl } from '../hooks/usePhotoBgUrl';
import useWindowWidth from '../hooks/useWindowWidth';
import { creationKind } from '../utils/deskBoard';

/** Подсказка в диалоге создания: какой чат получится из введённого названия. */
function creationHint(name: string): string {
  if (!name.trim()) return 'Начните с /desk — получится доска, с /canvas — холст, с ! — публичный канал';
  const kind = creationKind(name);
  if (kind === 'desk') return 'Это будет доска вместо обычного чата';
  if (kind === 'whiteboard') return 'Это будет совместный холст для рисования';
  if (kind === 'channel') return 'Это будет публичный канал';
  return 'Обычная группа. /desk — доска, /canvas — холст, ! — канал';
}
import { externalSiteUrl } from '../utils/externalSite';
import ExternalSiteDialog from './ExternalSiteDialog';
import { chatsApi, usersApi } from '../services/api';
import { peer, isPeerAvailable } from '../services/peer';
import { Chat, User } from '../types';
import ContextMenu from './ContextMenu';
import VeraLogo from './VeraLogo';
import MusicLibrary from './MusicLibrary';
import SidebarNavButtons from './SidebarNavButtons';
import SidebarNavDock from './SidebarNavDock';
import StarIcon from './StarIcon';
import { membranePressSx, motion } from '../styles/motion';

interface Props { open: boolean; onToggle: () => void; mobile?: boolean; }

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (m < 1) return 'сейчас';
  if (m < 60) return `${m} мин`;
  if (h < 24) return `${h} ч`;
  if (day < 7) return `${day} д`;
  return new Date(d).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// Фильтр списка по типу чата. Архив вынесен из вкладок в отдельный режим
// (useSidebarViewStore.archiveView) — его открывает кнопка «Архив».
// «Группы» объединяет и группы, и каналы, «Диалоги» — только личные чаты
// (включая «Избранное» и Vera AI), «Все» — всё неархивное.
type SidebarTab = 'all' | 'chats' | 'groups';
const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'chats', label: 'Диалоги' },
  { id: 'groups', label: 'Группы' },
];

const SIDEBAR_MIN = 72;
/** Ширина одной кнопки нижней панели в строке иконок (IconButton 40 + gap 4). */
const NAV_ICON_PX = 44;
/** Поля строки иконок (p: 1 с обеих сторон). */
const NAV_COMPACT_CHROME_PX = 16;
/** Минимум на кнопку с подписью: «Редактор» мельче не читается. */
const NAV_PHONE_ITEM_MIN_PX = 60;
/** Отступы «телефонной» плашки: mx: 1 + px: 1 с обеих сторон. */
const NAV_PHONE_CHROME_PX = 32;

/**
 * Строка списка чатов — вынесена в отдельный memo-компонент.
 *
 * Раньше она рендерилась инлайн внутри map(), поэтому ЛЮБОЕ изменение стора
 * (новое сообщение в другом чате, набор текста в поле ввода, присутствие
 * собеседника) пересоздавало JSX для всех строк сразу. Теперь строка
 * подписана только на свои данные: конкретный черновик и онлайн-статус
 * именно этого чата. Черновик и присутствие вынесены внутрь компонента
 * сознательно — иначе набор текста в поле ввода перерисовывал бы весь сайдбар.
 */
interface SidebarChatRowProps {
  chat: Chat;
  name: string;
  avatarUrl?: string;
  active: boolean;
  pinned: boolean;
  unreadCount?: number;
  updatedAt: string;
  theme: Theme;
  ringSx: Record<string, any>[];
  avatarOnly: boolean;
  horizontal: boolean;
  open: boolean;
  showAvatars: boolean;
  userId?: string;
  /** Тик раз в минуту: пересчитывает «5 мин назад» без перерисовки всего списка. */
  nowTick: number;
  onSelect: (chat: Chat) => void;
  onContextMenu: (e: React.MouseEvent, chat: Chat) => void;
}

const SidebarChatRow = React.memo(function SidebarChatRow(props: SidebarChatRowProps) {
  const {
    chat, name, avatarUrl, active, pinned, unreadCount, updatedAt, theme, ringSx,
    avatarOnly, horizontal, open, showAvatars, userId, onSelect, onContextMenu,
  } = props;
  // Свои подписки строки: булевы селекторы не меняют ссылку при посторонних
  // событиях, поэтому ререндерится только реально затронутая строка.
  const draft = useDraftsStore((s) => s.drafts[chat.id] || '');
  const online = useChatStore((s) => {
    const other = chat.members?.find(m => m.userId !== userId);
    return !!other && s.onlineUsers.has(other.userId);
  });

  const lastText = draft
    ? `Черновик: ${draft}`
    : chat.lastMessage?.content
      ? chat.lastMessage.content
      : (chat.lastMessage?.attachments?.length ? '📎 Вложение' : 'Нет сообщений');

  return (
    <Tooltip title={avatarOnly ? name : ''} placement="right">
      <ListItem
        onClick={() => onSelect(chat)}
        onContextMenu={(e) => onContextMenu(e, chat)}
        // Метка для настройки «Вид чатов» (CHAT_SHAPES): правило в main.tsx
        // бьёт по ней, а не по .MuiListItem-root — тот же класс используется
        // в списках участников и настройках.
        data-vera-chat-row="true"
        sx={{
          cursor: 'pointer',
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 64px',
          ...(horizontal
            ? { flexDirection: 'column', width: 84, minWidth: 84, mr: .5, py: 1, px: .5, alignItems: 'center', textAlign: 'center' }
            : avatarOnly
              ? { justifyContent: 'center', px: .5, py: .65, mb: .4 }
              : { px: open ? 1.15 : .65, py: .85, mb: .55 }),
          bgcolor: active ? theme.bgActive : 'rgba(255,255,255,0.026)',
          border: `1px solid ${active ? theme.accent + '66' : 'rgba(255,255,255,0.045)'}`,
          boxShadow: active ? `0 12px 34px ${theme.accent}22` : 'none',
          overflow: 'hidden',
          '&:hover': { bgcolor: theme.bgHover, transform: 'translateY(-1px)' },
          transition: `background .22s ${motion.easeOut}, transform .28s ${motion.spring}, box-shadow .22s ${motion.easeOut}`,
        }}
      >
        {avatarOnly || showAvatars ? (
            chat.type === 'saved' ? (
              <Avatar sx={{ width: horizontal ? 52 : 46, height: horizontal ? 52 : 46, bgcolor: theme.accent, ...ringSx[active ? 1 : 0] }}>
                <StarIcon sx={{ fontSize: 28, color: '#fff' }} />
              </Avatar>
            ) : (
              <Avatar src={avatarUrl} sx={{ width: horizontal ? 52 : 46, height: horizontal ? 52 : 46, bgcolor: theme.accent, ...ringSx[active ? 1 : 0] }}>
                {getInitials(name)}
              </Avatar>
            )
          ) : (
            <Box sx={{ width: horizontal ? 46 : 6, height: horizontal ? 4 : 46, borderRadius: 3, bgcolor: active ? theme.accent : 'transparent' }} />
          )}
        {horizontal
          ? <Typography noWrap sx={{ mt: .6, color: theme.text, fontSize: 12, fontWeight: pinned ? 700 : 600, maxWidth: 76 }}>{pinned ? '📌 ' : ''}{name}</Typography>
          : (!avatarOnly && open && (
            <ListItemText
              sx={{ ml: 1.25, minWidth: 0 }}
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: .5 }}>
                  <Typography noWrap sx={{ color: theme.text, fontWeight: pinned ? 700 : 600, flex: 1 }}>{pinned ? '📌 ' : ''}{name}</Typography>
                  <Typography sx={{ color: theme.chatTimeColor || theme.textSec, fontSize: 11 }}>{timeAgo(updatedAt)}</Typography>
                </Box>
              }
              secondary={<Typography noWrap sx={{ color: theme.textSec, fontSize: 13 }}>{lastText}</Typography>}
            />
          ))}
      </ListItem>
    </Tooltip>
  );
});

export default function Sidebar({ open, onToggle, mobile }: Props) {
  const experimentalExternalSites = useUserSettingsStore((s) => s.experimentalExternalSites);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  // Точечные селекторы: перерисовка только при изменениях, влияющих на список чатов.
  const chats = useChatStore((s) => s.chats);
  const activeChat = useChatStore((s) => s.activeChat);
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const loadChats = useChatStore((s) => s.loadChats);
  const togglePin = useChatPrefsStore((s) => s.togglePin);
  const toggleArchive = useChatPrefsStore((s) => s.toggleArchive);
  const toggleMute = useChatPrefsStore((s) => s.toggleMute);
  // Подписка на сами списки закрепов/архива/мутов: перерисовка — только при их изменении.
  const pinnedIds = useChatPrefsStore((s) => s.pinnedIds);
  const archivedIds = useChatPrefsStore((s) => s.archivedIds);
  const mutedIds = useChatPrefsStore((s) => s.mutedIds);
  const isPinned = useCallback((chatId: string) => pinnedIds.includes(chatId), [pinnedIds]);
  const isArchived = useCallback((chatId: string) => archivedIds.includes(chatId), [archivedIds]);
  const isMuted = useCallback((chatId: string) => mutedIds.includes(chatId), [mutedIds]);
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.theme);
  // Фон списка чатов: отдельная от чатовых настройка (см. CHAT_LIST_SCOPE).
  const chatListBg = useChatBgPrefsStore((s) => s.chatListBg);
  const chatListDim = useChatBgPrefsStore((s) => s.chatListDim);
  const chatListBlur = useChatBgPrefsStore((s) => s.chatListBlur);
  const listWallpaperUrl = usePhotoBgUrl(chatListBg?.type === 'photo' ? chatListBg.value : null);
  // Заливку панели убираем только когда адрес реально подгрузился: иначе на
  // первом кадре мелькнёт «пустой» сайдбар, пока IndexedDB ещё отдаёт блоб.
  const hasListWallpaper = !!listWallpaperUrl;
  const navigate = useNavigate();
  const location = useLocation();

  // Обводка аватарок в списке чатов — только базовая, от активного чата.
  // Скины (кольцо из магазина и кастомный «профиль») здесь НЕ применяются:
  // они принадлежат конкретному аккаунту, а в строке списка аватарка чужого
  // собеседника или группы. Раньше сюда попадало МОЁ кольцо — и у всех чатов
  // в списке оказывалась одна и та же обводка, хотя поставил её один человек.
  // Скин виден там, где аватарка именно его: в сообщениях и в профиле.
  // Стиль зависит только от «активен ли чат», поэтому обе вариации считаются
  // один раз на смену темы, а не для каждой строки списка на каждый рендер.
  const ringSx = useMemo(() => {
    const build = (active: boolean): Record<string, any> => ({
      boxShadow: `0 0 0 2px ${active ? theme.accent + '55' : 'rgba(255,255,255,0.08)'}`,
    });
    return [build(false), build(true)];
  }, [theme.accent]);

  // По умолчанию «Все»: раньше вкладка «Диалоги» показывала всё неархивное,
  // и после переименования первой вкладки вид списка не должен измениться.
  const [tab, setTab] = useState<SidebarTab>('all');
  // Режим архива включается кнопкой «Архив» — она есть и в нижней панели
  // сайдбара на ПК, и в нижней навигации на телефоне, поэтому состояние
  // общее. Имя toggleArchiveView, а не toggleArchive: последнее в
  // chatPrefsStore архивирует конкретный чат, это другое действие.
  const archiveView = useSidebarViewStore((s) => s.archiveView);
  const setArchiveView = useSidebarViewStore((s) => s.setArchiveView);
  const toggleArchiveView = useSidebarViewStore((s) => s.toggleArchiveView);
  const navOpacity = useUiPrefsStore((s) => s.navOpacity);
  const navHeight = useUiPrefsStore((s) => s.navHeight);
  const [search, setSearch] = useState('');
  const [channelsFound, setChannelsFound] = useState<Pick<Chat, 'id' | 'name' | 'avatarUrl'>[]>([]);
  useEffect(() => {
    let cancelled = false;
    setChannelsFound([]);
    if (!search.trim().startsWith('!')) return;
    const timer = setTimeout(() => {
      chatsApi.searchChannels(search.trim()).then(res => { if (!cancelled) setChannelsFound(res.data); }).catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);
  async function openChannel(channelId: string) {
    try {
      const res = await chatsApi.joinChannel(channelId);
      await loadChats(); setActiveChat(res.data); navigate('/chat/' + channelId); setSearch('');
    } catch (e: any) { alert(e.response?.data?.message || 'Не удалось открыть канал'); }
  }
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<Record<string, boolean>>({});
  const [contactsForGroup, setContactsForGroup] = useState<Array<{ pubkey: string; name?: string }>>([]);
  const [searchUser, setSearchUser] = useState('');
  const [foundUsers, setFoundUsers] = useState<User[]>([]);
  const [lastUserSearch, setLastUserSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  const [myPk, setMyPk] = useState<string>('');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteToast, setInviteToast] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    if (!isPeerAvailable()) return;
    peer.info().then((info: any) => setMyPk(info?.nostrPk || '')).catch(() => {});
  }, []);

  const myInviteLink = myPk
    ? `vera://add?pk=${encodeURIComponent(myPk)}${user?.username ? `&name=${encodeURIComponent(user.username)}` : ''}`
    : '';

  function parseInviteLink(raw: string): { pubkey: string; name?: string } | null {
    const s = raw.trim();
    if (!s) return null;
    const m = s.match(/^vera:\/\/add\?(.+)$/i);
    if (m) {
      const params = new URLSearchParams(m[1]);
      const pk = (params.get('pk') || '').trim();
      if (!pk) return null;
      return { pubkey: pk, name: params.get('name') || undefined };
    }
    if (/^[a-zA-Z0-9_\-]{16,}$/.test(s)) return { pubkey: s };
    return null;
  }

  async function copyMyInvite() {
    if (!myInviteLink) return;
    try { await navigator.clipboard.writeText(myInviteLink); setInviteToast('Ссылка скопирована'); }
    catch { setInviteError('Не удалось скопировать. Скопируйте вручную.'); }
  }

  async function pasteInvite() {
    try { const t = await navigator.clipboard.readText(); setInviteInput(t); setInviteError(null); }
    catch { setInviteError('Разрешите доступ к буферу или вставьте вручную (Ctrl+V).'); }
  }

  async function handleAddByInvite() {
    setInviteError(null);
    const parsed = parseInviteLink(inviteInput);
    if (!parsed) { setInviteError('Не похоже на ссылку Vera. Формат: vera://add?pk=...'); return; }
    if (myPk && parsed.pubkey === myPk) { setInviteError('Это ваша собственная ссылка.'); return; }
    setInviteBusy(true);
    try {
      await peer.addContact({ pubkey: parsed.pubkey, nodeId: parsed.pubkey, name: parsed.name });
      setInviteInput('');
      setAddContactOpen(false);
      await loadChats();
      const chatId = myPk ? [myPk, parsed.pubkey].sort().join('|') : parsed.pubkey;
      // Ищем созданный direct-чат в актуальном сторе и делаем его активным,
      // иначе ChatWindow будет показывать прежний activeChat (например, группу),
      // а пользователь визуально «попадёт» не туда.
      const freshChats = useChatStore.getState().chats;
      const target = freshChats.find(c => c && c.id === chatId);
      if (target) {
        setActiveChat(target);
        navigate('/chat/' + chatId);
      } else {
        setInviteError('Контакт добавлен, но чат ещё не создан. Попробуйте открыть его из списка.');
      }
    } catch (e: any) {
      setInviteError(e?.message || 'Не удалось добавить контакт');
    } finally {
      setInviteBusy(false);
    }
  }
  const [deleteConfirmChat, setDeleteConfirmChat] = useState<Chat | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [myLinkDialogOpen, setMyLinkDialogOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  // Импульс при прокрутке — чисто CSS: раньше это был React-стейт, из-за чего
  // КАЖДОЕ событие скролла перерисовывало весь список чатов. Теперь ставим
  // data-атрибут на сам <List> (через ref) и переключаем анимацию правилом CSS.
  const chatListRef = React.useRef<HTMLUListElement | null>(null);
  const scrollTimerRef = React.useRef<number | null>(null);
  const [nowTick, setNowTick] = React.useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((n) => n + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const layout = useUserSettingsStore((s) => s.layout);
  const setLayout = useUserSettingsStore((s) => s.setLayout);
  const viewportWidth = useWindowWidth();
  const sidebarMax = Math.max(SIDEBAR_MIN, Math.floor(viewportWidth / 2));
  const sidebarWidth = Math.min(Math.max(layout.sidebarWidth, SIDEBAR_MIN), sidebarMax);
  const horizontal = layout.sidebarSide === 'top' || layout.sidebarSide === 'bottom';
  const avatarOnly = !mobile && !horizontal && sidebarWidth <= 112;
  const [resizing, setResizing] = useState(false);

  useEffect(() => { loadChats(); }, []);
  useEffect(() => () => { if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current); }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: globalThis.MouseEvent) => {
      // Учитываем сторону: при правом сайдбаре тянем от правого края экрана
      const x = layout.sidebarSide === 'right'
        ? window.innerWidth - e.clientX
        : e.clientX;
      const w = Math.min(Math.max(x, SIDEBAR_MIN), sidebarMax);
      setLayout('sidebarWidth', w);
    };
    const onUp = () => {
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, layout.sidebarSide, setLayout, sidebarMax]);

  function handleChatListScroll() {
    const el = chatListRef.current;
    if (!el) return;
    if (el.dataset.scrolling !== '1') el.dataset.scrolling = '1';
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => { delete el.dataset.scrolling; }, 170);
  }

  // Стабильные колбэки для строк: иначе memo-строки перерисовывались бы
  // на каждом рендере сайдбара.
  const handleSelectChat = useCallback((chat: Chat) => {
    setActiveChat(chat);
    navigate(`/chat/${chat.id}`);
  }, [setActiveChat, navigate]);
  const handleRowContextMenu = useCallback((e: React.MouseEvent, chat: Chat) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, chat });
  }, []);

  // Фильтрация + сортировка пересчитываются только при реальных изменениях
  // (раньше выполнялись на каждый рендер списка).
  const sorted = useMemo(() => {
    const filtered = chats.filter(c => {
      if (!c || !c.id) return false;
      const otherMember = c.members?.find(m => m.userId !== user?.id);
      const name = c.name || [otherMember?.user?.firstName, otherMember?.user?.lastName].filter(Boolean).join(' ') || otherMember?.user?.username || '';
      const matchSearch = name.toLowerCase().includes(search.toLowerCase());
      if (archiveView) return matchSearch && isArchived(c.id);
      if (isArchived(c.id)) return false;
      if (tab === 'all') return matchSearch;
      // Группы и каналы показываются вместе; диалогами считается всё остальное.
      const isRoom = c.type === 'group' || c.type === 'channel';
      return matchSearch && (tab === 'groups' ? isRoom : !isRoom);
    });

    return [...filtered].sort((a, b) => {
      const ap = isPinned(a.id) ? 1 : 0;
      const bp = isPinned(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      // Максимум из последнего сообщения и updatedAt: правка доски/холста
      // двигает updatedAt, не создавая сообщение, и чат должен подняться.
      return new Date(chatActivityAt(b)).getTime() - new Date(chatActivityAt(a)).getTime();
    });
  }, [chats, search, tab, archiveView, user?.id, isPinned, isArchived]);

  async function handleSearchUser() {
    const query = searchUser.trim();
    if (!query) return;
    // vera://add/vera://link — это приглашение, а не текст для поиска людей:
    // не дёргаем мёртвый серверный API (GET /api/users/search?q=vera://...).
    if (/^vera:\/\//i.test(query)) {
      setFoundUsers([]);
      setLastUserSearch('');
      setSearchUser('');
      setInviteInput(query);
      setInviteError(null);
      setAddContactOpen(true);
      return;
    }
    if (query.length < 2) {
      setFoundUsers([]);
      setLastUserSearch('');
      return;
    }
    setLastUserSearch(query);
    setSearching(true);
    try {
      const res = await usersApi.search(query);
      setFoundUsers((res.data as User[]) || []);
    } catch { setFoundUsers([]); }
    finally { setSearching(false); }
  }

  function handleSearchUserChange(value: string) {
    setSearchUser(value);
    setFoundUsers([]);
    setLastUserSearch('');
  }

  async function handleStartChat(targetUser: User) {
    try {
      const res = await chatsApi.createDirect(targetUser.id);
      await loadChats();
      setAddContactOpen(false);
      setSearchUser('');
      setFoundUsers([]);
      const newChat = res.data;
      if (newChat?.id) { setActiveChat(newChat); navigate(`/chat/${newChat.id}`); }
    } catch (e) { console.error(e); }
  }

  async function handleDeleteChat(chat: Chat) {
    setDeleting(true);
    try {
      if (isPeerAvailable()) {
        await peer.deleteChat(chat.id);
      } else {
        try {
          await chatsApi.deleteChat(chat.id);
        } catch (e: any) {
          // 404 — сервер чат уже удалил, а в локальном архиве он остался.
          // Это не ошибка: просто дочищаем локально.
          if (e?.response?.status !== 404) throw e;
        }
      }
      // Чистим и список, и локальный архив до перезагрузки: иначе loadChats
      // смерджит архив с сервером и удалённый чат вернётся.
      await useChatStore.getState().forgetChat(chat.id);
      await loadChats();
      if (activeChat?.id === chat.id) navigate('/');
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.message || 'Ошибка удаления чата');
    } finally {
      setDeleting(false);
      setDeleteConfirmChat(null);
    }
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const selected = Object.entries(groupMembers).filter(([, v]) => v).map(([pk]) => pk);
      let createdId: string | null = null;
      if (isPeerAvailable()) {
        const chat = await peer.createGroup(name, selected);
        createdId = (chat as any)?.id || null;
      } else {
        const result = await chatsApi.createGroup(name, selected);
        createdId = result.data.id;
      }
      await loadChats();
      setCreateGroupOpen(false);
      setNewGroupName('');
      setGroupMembers({});
      if (createdId && isPeerAvailable()) {
        try {
          const link = await peer.groupInviteLink(createdId);
          await navigator.clipboard.writeText(link);
          setInviteToast('Инвайт-ссылка скопирована');
        } catch (e) { console.warn('[groupInviteLink]', e); }
        navigate('/chat/' + createdId);
      }
    } catch (e) {
      console.error('[createGroup]', e);
      alert('Не удалось создать группу: ' + ((e as any)?.message || e));
    }
  }

  useEffect(() => {
    if (!createGroupOpen || !isPeerAvailable()) return;
    (async () => {
      try {
        const list: any[] = await peer.listContacts();
        const arr = (list || []).map((c) => ({
          pubkey: c.pubkey || c.nodeId || c.id,
          name: c.name || c.username || (c.pubkey || '').slice(0, 8),
        })).filter((c) => c.pubkey);
        setContactsForGroup(arr);
      } catch (e) { console.warn('[listContacts]', e); }
    })();
  }, [createGroupOpen]);

  function getChatName(chat: Chat | null | undefined): string {
    if (!chat) return 'Чат';
    if (chat.type === 'saved') return 'Избранное';
    if (chat.name) return chat.name;
    const other = chat.members?.find(m => m.userId !== user?.id)?.user;
    return [other?.firstName, other?.lastName].filter(Boolean).join(' ') || other?.username || 'Чат';
  }

  function getChatAvatar(chat: Chat): string | undefined {
    if (chat.type === 'saved') return undefined; // Для избранного используем StarIcon
    if (chat.avatarUrl) return chat.avatarUrl;
    return chat.members?.find(m => m.userId !== user?.id)?.user?.avatarUrl || undefined;
  }

  return (
    <Box sx={{
      ...(horizontal
        ? {
            width: '100%', minWidth: '100%', maxWidth: '100%',
            height: 240, minHeight: 240, maxHeight: 240,
            borderTop: layout.sidebarSide === 'bottom' ? `1px solid ${theme.border}` : 'none',
            borderBottom: layout.sidebarSide === 'top' ? `1px solid ${theme.border}` : 'none',
            boxShadow: layout.sidebarSide === 'top' ? '0 18px 60px rgba(0,0,0,0.38)' : '0 -18px 60px rgba(0,0,0,0.38)',
          }
        : {
            width: mobile ? '100%' : sidebarWidth,
            minWidth: mobile ? '100%' : sidebarWidth,
            maxWidth: mobile ? '100%' : sidebarWidth,
            height: '100%',
            borderRight: layout.sidebarSide === 'left' ? `1px solid ${theme.border}` : 'none',
            borderLeft: layout.sidebarSide === 'right' ? `1px solid ${theme.border}` : 'none',
            boxShadow: layout.sidebarSide === 'left' ? '18px 0 60px rgba(0,0,0,0.38)' : '-18px 0 60px rgba(0,0,0,0.38)',
          }
      ),
      background: hasListWallpaper ? 'transparent' : (theme.sidebarGradient || theme.bgSidebar),
      backdropFilter: theme.sidebarBlur || 'blur(18px)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      boxSizing: 'border-box',
      transition: resizing ? 'none' : 'width .2s ease, min-width .2s ease',
      overflow: 'hidden',
      position: 'relative',
      ...getFinishStyles(theme),
      '&::before': {
        content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
        background: theme.disableBackgroundGlow ? 'none' : `radial-gradient(circle at 20% 0%, ${theme.backgroundGlowColor || '#8FE3CF'}22 0, transparent 34%), radial-gradient(circle at 80% 100%, ${theme.backgroundGlowColor || '#8FE3CF'}14 0, transparent 30%)`,
      },
    }}>
      {/* Фон списка чатов — слой ПОД строками. Сами строки полупрозрачные
          (rgba(255,255,255,.026)), поэтому фото видно сквозь них. */}
      {listWallpaperUrl && (
        <Box sx={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <Box sx={{
            position: 'absolute', inset: `-${chatListBlur}px`,
            backgroundImage: `url(${listWallpaperUrl})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: chatListBlur ? `blur(${chatListBlur}px)` : undefined,
          }} />
          {chatListDim > 0 && (
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: `rgba(0,0,0,${chatListDim})` }} />
          )}
        </Box>
      )}
      <Box sx={{ p: { xs: 1, md: 1.25 }, display: 'flex', alignItems: 'center', gap: 1, position: 'relative', zIndex: 1, paddingTop: mobile ? 'calc(0.5rem + env(safe-area-inset-top))' : undefined }}>
        {!avatarOnly && open && <TextField size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || !experimentalExternalSites) return;
          const url = externalSiteUrl(search);
          if (url) { e.preventDefault(); setExternalUrl(url); }
        }} placeholder="Поиск" InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} sx={{ '& .MuiInputBase-root': { bgcolor: theme.bgInput, color: theme.text, borderRadius: 999, height: 38, boxShadow: '0 8px 24px rgba(0,0,0,0.20)' } }} />}
        {!avatarOnly && open && <Tooltip title="Добавить чат / контакт"><IconButton onClick={() => setAddContactOpen(true)} sx={{ color: theme.textSec }}><PersonAdd /></IconButton></Tooltip>}
        {!avatarOnly && open && <Tooltip title="Создать группу"><IconButton onClick={() => setCreateGroupOpen(true)} sx={{ color: theme.textSec }}><Group /></IconButton></Tooltip>}
      </Box>

      {/* В режиме архива вкладки фильтра уступают заголовку с возвратом. */}
      {externalUrl && experimentalExternalSites && <ExternalSiteDialog key={externalUrl} url={externalUrl} onClose={() => setExternalUrl(null)} />}
      {!avatarOnly && open && archiveView && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pb: 1.2, position: 'relative', zIndex: 1 }}>
          <IconButton size="small" onClick={() => setArchiveView(false)} sx={{ color: theme.textSec }} aria-label="Назад к чатам">
            <ChevronLeft />
          </IconButton>
          <Typography sx={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>Архив</Typography>
        </Box>
      )}

      {!avatarOnly && open && !archiveView && layout.showTabs && (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          gap: 0.6,
          px: 1,
          pb: 1.2,
          position: 'relative',
          zIndex: 1,
          transition: 'grid-template-columns 300ms cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <Box key={t.id} sx={{
                position: 'relative',
                minWidth: 0,
                transition: 'flex 300ms cubic-bezier(0.34, 1.3, 0.64, 1)',
              }}>
                <Button
                  size="small"
                  disableRipple
                  data-vera-sidebar-tab
                  onClick={() => setTab(t.id)}
                  sx={{
                    width: '100%',
                    minWidth: 0,
                    borderRadius: 999,
                    textTransform: 'none',
                    px: 0.8,
                    fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                    color: active ? '#001018' : theme.textSec,
                    // Заливку рисует только ::before. Собственный bgcolor кнопки
                    // давал второй слой того же цвета (двойной край на скруглении),
                    // а MUI на hover подменял его своим полупрозрачным фоном.
                    bgcolor: 'transparent',
                    '&:hover': { bgcolor: 'transparent' },
                    '&.Mui-focusVisible': { bgcolor: 'transparent', outline: `2px solid ${theme.accent}`, outlineOffset: 2 },
                    border: 'none',
                    position: 'relative',
                    zIndex: 1,
                    transition: 'color 220ms ease, font-weight 220ms ease',
                    overflow: 'hidden',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      // Повторяет радиус кнопки: в «Полускруглённом» стиле он
                      // приходит из ползунка (--vera-sq-radius), а не 999.
                      borderRadius: 'inherit',
                      background: theme.accent,
                      opacity: active ? 1 : 0,
                      transform: active ? 'scale(1)' : 'scale(0.6)',
                      transition: 'opacity 260ms cubic-bezier(0.34, 1.3, 0.64, 1), transform 300ms cubic-bezier(0.34, 1.3, 0.64, 1)',
                      zIndex: 0,
                    },
                    '&:hover::before': {
                      opacity: active ? 1 : 0.12,
                      transform: 'scale(1)',
                    },
                    '& .MuiButton-startIcon': {
                      transition: 'margin 200ms ease',
                    },
                    '& > *': { position: 'relative', zIndex: 1 },
                    boxShadow: active
                      ? `0 4px 18px ${theme.accent}55`
                      : 'none',
                  }}
                >
                  <Box component="span" sx={{ position: 'relative', zIndex: 1 }}>
                    {t.label}
                  </Box>
                </Button>
              </Box>
            );
          })}
        </Box>
      )}

      <List
        data-vera-list
        // Ориентация нужна стилям «без заливки»: полноширинная полоса и
        // растягивание единственного чата применимы только к вертикальному
        // списку и сломали бы горизонтальную ленту.
        data-vera-list-layout={horizontal ? 'horizontal' : 'vertical'}
        onScroll={handleChatListScroll}
        ref={chatListRef}
        sx={{
          flex: 1, overflowY: horizontal ? 'hidden' : 'auto', overflowX: horizontal ? 'auto' : 'hidden',
          display: horizontal ? 'flex' : 'block', flexDirection: horizontal ? 'row' : 'column',
          py: .5, px: open ? 1 : .5, position: 'relative', zIndex: 1, scrollBehavior: 'smooth',
          '&::-webkit-scrollbar': { height: 6 },
          // Импульс аватарок при прокрутке — на CSS, без React-стейта.
          '&[data-scrolling="1"] .MuiAvatar-root': {
            transform: 'scale(.88)',
            transition: `transform 120ms ${motion.easeIn}, box-shadow .3s ease, border-color .3s ease`,
          },
          '& .MuiAvatar-root': {
            transform: 'scale(1)',
            transition: `transform 520ms ${motion.spring}, box-shadow .3s ease, border-color .3s ease`,
          },
        }}
      >
        {sorted.map(chat => (
          <SidebarChatRow
            key={chat.id}
            chat={chat}
            name={getChatName(chat)}
            avatarUrl={getChatAvatar(chat)}
            active={activeChat?.id === chat.id}
            pinned={isPinned(chat.id)}
            unreadCount={chat.unreadCount}
            // Та же метка, что и для сортировки: правка доски/холста двигает
            // только updatedAt, и время в строке должно его показать.
            updatedAt={chatActivityAt(chat)}
            theme={theme}
            ringSx={ringSx}
            avatarOnly={avatarOnly}
            horizontal={horizontal}
            open={open}
            showAvatars={layout.showAvatarsInList}
            userId={user?.id}
            nowTick={nowTick}
            onSelect={handleSelectChat}
            onContextMenu={handleRowContextMenu}
          />
        ))}
      </List>

      {(() => {
        // Сколько кнопок в панели: четыре своих + «Bug Bounty» у админа.
        const navCount = 4 + (user?.isAdmin ? 1 : 0);
        // В горизонтальном сайдбаре ширина = ширина окна, места хватает всегда.
        const wide = horizontal || mobile;
        // «Как на телефоне» — парящая плашка с подписями. Если сайдбар сузили так,
        // что подписи не влезают, показываем обычную строку иконок.
        const phoneFits = wide || sidebarWidth >= NAV_PHONE_CHROME_PX + 4 * NAV_PHONE_ITEM_MIN_PX
          + (user?.isAdmin ? NAV_ICON_PX : 0);
        const phoneNav = (layout.desktopNavStyle ?? 'compact') === 'phone' && open && !horizontal && phoneFits;
        // Компактная строка иконок тоже следует ползунку «Высота нижней панели».
        const compactBtn = compactNavButtonPx(navHeight);
        const compactBtnSx = { width: compactBtn, height: compactBtn, '& .MuiSvgIcon-root': { fontSize: compactNavIconPx(navHeight) } };
        // Если иконки не влезают в одну строку (узкий сайдбар), ставим их столбиком.
        // NAV_ICON_PX − 40 = зазор между кнопками.
        const compactFits = wide || sidebarWidth >= NAV_COMPACT_CHROME_PX + navCount * (compactBtn + NAV_ICON_PX - 40);
        // На телефоне вместо этой панели — MobileBottomNav.
        if (mobile) return null;
        return (
          // Панель вынесена порталом над питомцем (SidebarNavDock): изнутри
          // сайдбара никакой zIndex не поднимет её выше слоя питомца.
          <SidebarNavDock
            slotSx={phoneNav ? { mx: 1, mb: 1, mt: .5 } : undefined}
            panelSx={phoneNav ? {
            display: 'flex', alignItems: 'center', justifyContent: 'space-around',
            gap: .5, flexWrap: 'nowrap',
            px: 1, py: .75,
            borderRadius: UI_NAV_RADIUS,
            ...navPanelBackground(theme.bgSidebar, theme.bg, navOpacity),
            backdropFilter: 'blur(22px) saturate(1.35)',
            border: `1px solid ${theme.border}`,
            boxShadow: '0 -6px 26px rgba(0,0,0,.28), 0 8px 24px rgba(0,0,0,.24)',
          } : {
            // В строку — ровно высота с ползунка; столбиком высота от числа кнопок.
            ...(compactFits ? { px: 1, py: 0, height: compactNavPanelPx(navHeight) } : { p: 1 }),
            borderTop: `1px solid ${theme.border}`, display: 'flex', gap: .5,
            flexDirection: compactFits ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: compactFits ? (open ? 'space-between' : 'center') : 'flex-start',
            flexWrap: 'nowrap',
            // Ползунок «Непрозрачность нижней панели»: 100% — прежний фон.
            background: compactNavBackground(navOpacity), backdropFilter: 'blur(18px)',
          }}>
            {/* Порядок кнопок меняется перетаскиванием мышкой (SidebarNavButtons). */}
            <SidebarNavButtons
              variant={phoneNav ? 'phone' : 'compact'}
              color={theme.textSec}
              accent={theme.accent}
              items={{
                profile: { title: 'Профиль', label: 'Профиль', icon: <AccountCircle />, onClick: () => navigate('/profile') },
                music: { title: 'Моя музыка и плейлисты', label: 'Музыка', icon: <LibraryMusic />, onClick: () => setMusicOpen(true) },
                editor: { title: 'Редактор тем', label: 'Редактор', icon: <Palette />, onClick: () => setThemeEditorOpen(true) },
                archive: { title: archiveView ? 'Назад к чатам' : 'Архив', label: archiveView ? 'Чаты' : 'Архив', icon: <Archive />, onClick: toggleArchiveView, active: archiveView },
              }}
            />
            {user?.isAdmin && (
              // order: кнопки выше расставлены CSS-свойством order, эта всегда последняя.
              <Tooltip title="Bug Bounty Tools"><IconButton onClick={() => navigate('/admin')} sx={{ color: theme.textSec, order: 100, flexShrink: 0, ...membranePressSx, ...(phoneNav ? {} : compactBtnSx) }}><Security /></IconButton></Tooltip>
            )}
          </SidebarNavDock>
        );
      })()}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          title={contextMenu.chat.name || 'Чат'}
          items={[
            {
              key: 'pin',
              label: isPinned(contextMenu.chat.id) ? 'Открепить' : 'Закрепить',
              icon: <Pin />,
              onClick: () => togglePin(contextMenu.chat.id),
            },
            {
              key: 'archive',
              label: isArchived(contextMenu.chat.id) ? 'Из архива' : 'В архив',
              icon: <Archive />,
              onClick: () => toggleArchive(contextMenu.chat.id),
            },
            {
              key: 'mute',
              label: isMuted(contextMenu.chat.id) ? 'Включить звук' : 'Без звука',
              icon: <Mute />,
              onClick: () => toggleMute(contextMenu.chat.id),
            },
            {
              key: 'delete',
              label: 'Удалить',
              icon: <DeleteForever />,
              danger: true,
              divider: true,
              onClick: () => setDeleteConfirmChat(contextMenu.chat),
            },
          ]}
        />
      )}

      <Box
        onMouseDown={() => {
          setResizing(true);
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
        }}
        sx={{
          display: mobile || horizontal ? 'none' : 'block',
          position: 'absolute',
          ...(layout.sidebarSide === 'left' ? { right: -5 } : { left: -5 }),
          top: 0,
          bottom: 0,
          width: 10,
          zIndex: 5,
          cursor: 'ew-resize',
          '&::after': {
            content: '"↔"',
            position: 'absolute',
            ...(layout.sidebarSide === 'left' ? { right: 2 } : { left: 2 }),
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'rgba(255,255,255,0.55)',
            fontSize: 12,
            letterSpacing: 1,
            opacity: 0,
            transition: 'opacity .2s ease',
          },
          '&:hover::after': { opacity: 1 },
        }}
      />

      <Dialog open={addContactOpen} onClose={() => setAddContactOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Добавить контакт / чат</DialogTitle>
        <DialogContent>
          {isPeerAvailable() && (
            <>
              <Button 
                fullWidth 
                startIcon={<Link />} 
                onClick={() => { setAddContactOpen(false); setMyLinkDialogOpen(true); }} 
                variant="outlined"
                sx={{ justifyContent: 'flex-start', mb: 2, textTransform: 'none' }}
              >
                Моя ссылка для добавления в друзья
              </Button>
              <Divider sx={{ my: 2 }} />
            </>
          )}

          <Button fullWidth startIcon={<Group />} onClick={() => { setAddContactOpen(false); setCreateGroupOpen(true); }} sx={{ justifyContent: 'flex-start', mb: 1, textTransform: 'none' }}>Создать группу</Button>
          <TextField fullWidth margin="dense" label="Имя, username или телефон (поиск на сервере)" value={searchUser} onChange={(e) => handleSearchUserChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSearchUser(); }} />
          <Button onClick={handleSearchUser} disabled={searching || searchUser.trim().length < 2}>{searching ? 'Ищу...' : 'Найти контакт'}</Button>
          {lastUserSearch && !searching && foundUsers.length === 0 && <Typography sx={{ mt: 1, color: theme.textSec, fontSize: 13 }}>Ничего не найдено по запросу «{lastUserSearch}»</Typography>}
          {lastUserSearch && foundUsers.map(u => <ListItem key={u.id} onClick={() => handleStartChat(u)} sx={{ cursor: 'pointer' }}><Avatar src={u.avatarUrl || undefined}>{getInitials(u.firstName || u.username)}</Avatar><ListItemText sx={{ ml: 1 }} primary={[u.firstName, u.lastName].filter(Boolean).join(' ') || u.username} secondary={u.username} /></ListItem>)}
        </DialogContent>
        <DialogActions><Button onClick={() => setAddContactOpen(false)} sx={{ color: theme.textSec }}>Закрыть</Button></DialogActions>
      </Dialog>

      <Snackbar open={!!inviteToast} autoHideDuration={2000} onClose={() => setInviteToast(null)}
        message={inviteToast || ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />

      <Dialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Новая группа</DialogTitle>
        <DialogContent>
          <TextField fullWidth autoFocus margin="dense" label="Название" helperText={creationHint(newGroupName)} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
          <Typography sx={{ mt: 2, mb: 1, fontSize: 13, color: theme.textSec }}>
            Участники ({contactsForGroup.length ? 'выберите контакты' : 'контактов пока нет — создайте группу и пришлите ссылку'})
          </Typography>
          <Box sx={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {contactsForGroup.map((c) => (
              <FormControlLabel
                key={c.pubkey}
                control={
                  <Checkbox
                    checked={!!groupMembers[c.pubkey]}
                    onChange={(e) => setGroupMembers((prev) => ({ ...prev, [c.pubkey]: e.target.checked }))}
                  />
                }
                label={
                  <Box>
                    <Typography sx={{ fontSize: 14 }}>{c.name || c.pubkey.slice(0, 10)}</Typography>
                    <Typography sx={{ fontSize: 11, color: theme.textSec, fontFamily: 'monospace' }}>{c.pubkey.slice(0, 24)}…</Typography>
                  </Box>
                }
              />
            ))}
          </Box>
          <Typography sx={{ mt: 1, fontSize: 12, color: theme.textSec }}>
            После создания инвайт-ссылка (vera://join) скопируется в буфер обмена.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateGroupOpen(false)}>Отмена</Button>
          <Button onClick={handleCreateGroup} variant="contained" disabled={!newGroupName.trim()}>Создать</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteConfirmChat} onClose={() => setDeleteConfirmChat(null)}><DialogTitle>Удалить чат?</DialogTitle><DialogContent>Чат «{getChatName(deleteConfirmChat)}» будет удалён.</DialogContent><DialogActions><Button onClick={() => setDeleteConfirmChat(null)}>Отмена</Button><Button color="error" disabled={deleting} onClick={() => deleteConfirmChat && handleDeleteChat(deleteConfirmChat)}>Удалить</Button></DialogActions></Dialog>

      <Dialog open={musicOpen} onClose={() => setMusicOpen(false)} fullWidth maxWidth="md" PaperProps={{ sx: { height: '82vh', bgcolor: theme.bg, color: theme.text, borderRadius: 3 } }}><DialogTitle>Музыка и плейлисты</DialogTitle><DialogContent sx={{ p: 0 }}><MusicLibrary /></DialogContent><DialogActions><Button onClick={() => setMusicOpen(false)} sx={{ color: theme.textSec }}>Закрыть</Button></DialogActions></Dialog>

      <Dialog open={myLinkDialogOpen} onClose={() => setMyLinkDialogOpen(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, borderRadius: 3 } }}>
        <DialogTitle sx={{ color: theme.text, bgcolor: theme.bg, borderBottom: `1px solid ${theme.border}` }}>Моя ссылка для добавления в друзья</DialogTitle>
        <DialogContent sx={{ bgcolor: theme.bg, color: theme.text }}>
          <Typography variant="body2" sx={{ color: theme.textSec, mb: 2 }}>
            Отправьте эту ссылку другу любым способом. Когда он её вставит у себя — вы окажетесь в контактах друг у друга и откроется чат.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField
              size="small"
              fullWidth
              value={myInviteLink}
              InputProps={{ readOnly: true }}
              placeholder={myPk ? '' : 'Ключ ещё не готов…'}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: theme.text,
                  backgroundColor: theme.bgInput,
                  fontSize: 14,
                  borderRadius:  1.5,
                  '& fieldset': { borderColor: theme.border },
                  '&:hover fieldset': { borderColor: theme.textSec + '80' },
                  '&.Mui-focused fieldset': { borderColor: theme.accent },
                },
              }}
            />
            <Button 
              variant="contained" 
              startIcon={<ContentCopy />} 
              onClick={copyMyInvite} 
              disabled={!myInviteLink}
              sx={{ minWidth: 140 }}
            >
              Скопировать
            </Button>
          </Stack>
          
          <Divider sx={{ my: 2, borderColor: theme.border }} />
          
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: theme.text }}>Добавить по ссылке друга</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField size="small" fullWidth placeholder="vera://add?pk=..." value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddByInvite(); }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  color: theme.text,
                  backgroundColor: theme.bgInput,
                  fontSize: 14,
                  borderRadius: 1.5,
                  '& fieldset': { borderColor: theme.border },
                  '&:hover fieldset': { borderColor: theme.textSec + '80' },
                  '&.Mui-focused fieldset': { borderColor: theme.accent },
                },
              }} />
            <Button variant="outlined" startIcon={<ContentPaste />} onClick={pasteInvite} sx={{ minWidth: 120 }}>
              Вставить
            </Button>
          </Stack>
          <Button 
            fullWidth 
            variant="contained" 
            onClick={handleAddByInvite} 
            disabled={inviteBusy || !inviteInput.trim()}
          >
            {inviteBusy ? 'Добавляем...' : 'Добавить и открыть чат'}
          </Button>
          {inviteError && <Alert severity="error" sx={{ mt: 2 }}>{inviteError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ bgcolor: theme.bg, borderTop: `1px solid ${theme.border}`, px: 3, py: 1.5 }}>
          <Button onClick={() => setMyLinkDialogOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Suspense fallback={null}>{themeEditorOpen && <ThemeEditor onClose={() => setThemeEditorOpen(false)} />}</Suspense>
      <Suspense fallback={null}>{marketplaceOpen && <ThemeMarketplace onClose={() => setMarketplaceOpen(false)} />}</Suspense>
    </Box>
  );
}
