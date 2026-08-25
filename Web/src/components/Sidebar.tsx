import React, { useState, useEffect, lazy, Suspense } from 'react';
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
  ContentCopy, ContentPaste, QrCode, Link, DevicesOther, Download,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../store/chatStore';
import { useChatPrefsStore } from '../store/chatPrefsStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { chatsApi, usersApi } from '../services/api';
import { peer, isPeerAvailable } from '../services/peer';
import { Chat, User } from '../types';
import VeraLogo from './VeraLogo';
import MusicLibrary from './MusicLibrary';
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

type SidebarTab = 'chats' | 'archive' | 'groups';
const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'chats', label: 'Диалоги' },
  { id: 'archive', label: 'Архив' },
  { id: 'groups', label: 'Группы' },
];

const SIDEBAR_WIDTH_KEY = 'vera-sidebar-width';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 440;

function loadSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
    }
  } catch {}
  return 320;
}

export default function Sidebar({ open, onToggle, mobile }: Props) {
  const { chats, activeChat, setActiveChat, loadChats, onlineUsers } = useChatStore();
  const { togglePin, toggleArchive, toggleMute, isPinned, isArchived, isMuted } = useChatPrefsStore();
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const navigate = useNavigate();

  const [tab, setTab] = useState<SidebarTab>('chats');
  const [search, setSearch] = useState('');
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
  const [scrollPulse, setScrollPulse] = useState(false);
  const scrollTimerRef = React.useRef<number | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth());
  const [resizing, setResizing] = useState(false);

  useEffect(() => { loadChats(); }, []);
  useEffect(() => () => { if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current); }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: globalThis.MouseEvent) => {
      const x = Math.min(Math.max(e.clientX, SIDEBAR_MIN), SIDEBAR_MAX);
      setSidebarWidth(x);
    };
    const onUp = () => {
      setResizing(false);
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); } catch {}
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, sidebarWidth]);

  function handleChatListScroll() {
    setScrollPulse(true);
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => setScrollPulse(false), 170);
  }

  const filtered = chats.filter(c => {
    if (!c || !c.id) return false;
    const otherMember = c.members?.find(m => m.userId !== user?.id);
    const name = c.name || [otherMember?.user?.firstName, otherMember?.user?.lastName].filter(Boolean).join(' ') || otherMember?.user?.username || '';
    const matchSearch = name.toLowerCase().includes(search.toLowerCase());
    if (tab === 'archive') return matchSearch && isArchived(c.id);
    if (tab === 'groups') return matchSearch && c.type === 'group';
    return matchSearch && !isArchived(c.id);
  });

  const sorted = [...filtered].sort((a, b) => {
    const ap = isPinned(a.id) ? 1 : 0;
    const bp = isPinned(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const at = a.lastMessage?.createdAt || a.createdAt;
    const bt = b.lastMessage?.createdAt || b.createdAt;
    return new Date(bt).getTime() - new Date(at).getTime();
  });

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

  function handleContextMenu(e: React.MouseEvent, chat: Chat) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, chat });
  }

  async function handleDeleteChat(chat: Chat) {
    setDeleting(true);
    try {
      if (isPeerAvailable()) {
        await peer.deleteChat(chat.id);
      } else {
        await chatsApi.deleteChat(chat.id);
      }
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
        await chatsApi.createGroup(name, []);
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
    if (chat.type === 'saved') return '⭐ Избранное';
    if (chat.name) return chat.name;
    const other = chat.members?.find(m => m.userId !== user?.id)?.user;
    return [other?.firstName, other?.lastName].filter(Boolean).join(' ') || other?.username || 'Чат';
  }

  function getChatAvatar(chat: Chat): string | undefined {
    if (chat.avatarUrl) return chat.avatarUrl;
    return chat.members?.find(m => m.userId !== user?.id)?.user?.avatarUrl || undefined;
  }

  function isChatOnline(chat: Chat): boolean {
    const otherId = chat.members?.find(m => m.userId !== user?.id)?.userId;
    return !!otherId && onlineUsers.has(otherId);
  }

  return (
    <Box sx={{
      width: mobile ? '100%' : sidebarWidth,
      minWidth: mobile ? '100%' : sidebarWidth,
      maxWidth: mobile ? '100%' : sidebarWidth,
      height: '100%',
      background: theme.sidebarGradient || theme.bgSidebar,
      backdropFilter: theme.sidebarBlur || 'blur(18px)',
      borderRight: `1px solid ${theme.border}`,
      display: 'flex',
      flexDirection: 'column',
      transition: resizing ? 'none' : 'width .2s ease, min-width .2s ease',
      overflow: 'hidden',
      boxShadow: '18px 0 60px rgba(0,0,0,0.38)',
      position: 'relative',
      '&::before': {
        content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(circle at 20% 0%, ${theme.accent}22 0, transparent 34%), radial-gradient(circle at 80% 100%, rgba(255,79,216,0.14) 0, transparent 30%)`,
      },
    }}>
      <Box sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1, position: 'relative', zIndex: 1 }}>
        {open && <TextField size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск" InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} sx={{ '& .MuiInputBase-root': { bgcolor: theme.bgInput, color: theme.text, borderRadius: 999, height: 38, boxShadow: '0 8px 24px rgba(0,0,0,0.20)' } }} />}
        {open && <Tooltip title="Добавить чат / контакт"><IconButton onClick={() => setAddContactOpen(true)} sx={{ color: theme.textSec }}><PersonAdd /></IconButton></Tooltip>}
        {open && <Tooltip title="Создать группу"><IconButton onClick={() => setCreateGroupOpen(true)} sx={{ color: theme.textSec }}><Group /></IconButton></Tooltip>}
      </Box>

      {open && (
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
                    bgcolor: 'transparent',
                    border: 'none',
                    position: 'relative',
                    zIndex: 1,
                    transition: 'color 220ms ease, font-weight 220ms ease',
                    overflow: 'hidden',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 999,
                      background: theme.accent,
                      opacity: active ? 1 : 0,
                      transform: active ? 'scale(1)' : 'scale(0.6)',
                      transition: 'opacity 260ms cubic-bezier(0.34, 1.3, 0.64, 1), transform 300ms cubic-bezier(0.34, 1.3, 0.64, 1)',
                      zIndex: -1,
                    },
                    '&:hover::before': {
                      opacity: active ? 1 : 0.12,
                      transform: 'scale(1)',
                    },
                    '& .MuiButton-startIcon': {
                      transition: 'margin 200ms ease',
                    },
                    boxShadow: active
                      ? `0 4px 18px ${theme.accent}55`
                      : 'none',
                  }}
                >
                  {t.label}
                </Button>
              </Box>
            );
          })}
        </Box>
      )}

      <List onScroll={handleChatListScroll} sx={{ flex: 1, overflowY: 'auto', py: .5, px: open ? 1 : .5, position: 'relative', zIndex: 1, scrollBehavior: 'smooth' }}>
        {sorted.map(chat => {
          const name = getChatName(chat);
          const active = activeChat?.id === chat.id;
           return <ListItem key={chat.id} onClick={() => { setActiveChat(chat); navigate(`/chat/${chat.id}`); }} onContextMenu={(e) => handleContextMenu(e, chat)} sx={{ cursor: 'pointer', px: open ? 1.15 : .65, py: .85, mb: .55, borderRadius: 3.5, bgcolor: active ? theme.bgActive : 'rgba(255,255,255,0.026)', border: `1px solid ${active ? theme.accent + '66' : 'rgba(255,255,255,0.045)'}`, boxShadow: active ? `0 12px 34px ${theme.accent}22` : 'none', backdropFilter: 'blur(14px)', overflow: 'hidden', '&::before': { content: '""', position: 'absolute', inset: 0, opacity: 0, background: 'linear-gradient(90deg, rgba(255,72,105,.34), rgba(255,145,77,.20), transparent 78%)', filter: 'blur(10px)', transform: 'translateX(-18%)', transition: `opacity 260ms ${motion.easeOut}, transform 360ms ${motion.easeOut}` }, '&:hover': { bgcolor: theme.bgHover, transform: 'translateY(-1px)' }, '&:active': { transform: 'translateX(10px) scale(.985)', boxShadow: 'inset 10px 0 28px rgba(255,80,110,.26)' }, '&:active::before': { opacity: 1, transform: 'translateX(0)' }, transition: `background .22s ${motion.easeOut}, transform .28s ${motion.spring}, box-shadow .22s ${motion.easeOut}` }}>
             <Badge color="success" variant="dot" invisible={!isChatOnline(chat)} overlap="circular"><Avatar src={getChatAvatar(chat)} sx={{ width: 46, height: 46, bgcolor: theme.accent, boxShadow: `0 0 0 2px ${active ? theme.accent + '55' : 'rgba(255,255,255,0.08)'}`, transform: scrollPulse ? 'scale(.88)' : 'scale(1)', transition: `transform ${scrollPulse ? 120 : 520}ms ${scrollPulse ? motion.easeIn : motion.spring}`, willChange: 'transform' }}>{getInitials(name)}</Avatar></Badge>
            {open && <ListItemText sx={{ ml: 1.25, minWidth: 0 }} primary={<Box sx={{ display: 'flex', alignItems: 'center', gap: .5 }}><Typography noWrap sx={{ color: theme.text, fontWeight: isPinned(chat.id) ? 700 : 600, flex: 1 }}>{isPinned(chat.id) ? '📌 ' : ''}{name}</Typography><Typography sx={{ color: theme.textSec, fontSize: 11 }}>{timeAgo(chat.lastMessage?.createdAt || chat.updatedAt || chat.createdAt)}</Typography></Box>} secondary={<Typography noWrap sx={{ color: theme.textSec, fontSize: 13 }}>{chat.lastMessage?.content || (chat.lastMessage?.attachments?.length ? '📎 Вложение' : 'Нет сообщений')}</Typography>} />}
            {open && !!chat.unreadCount && <Badge badgeContent={chat.unreadCount} color="primary" />}
          </ListItem>;
        })}
      </List>

      <Box sx={{ p: 1, borderTop: `1px solid ${theme.border}`, display: 'flex', gap: .5, justifyContent: open ? 'space-between' : 'center', flexWrap: 'wrap', position: 'relative', zIndex: 1, background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(18px)' }}>
        <Tooltip title="Моя музыка и плейлисты"><IconButton onClick={() => setMusicOpen(true)} sx={{ color: theme.textSec, ...membranePressSx }}><LibraryMusic /></IconButton></Tooltip>
        <Tooltip title="Редактировать профиль"><IconButton onClick={() => navigate('/profile?edit=1')} sx={{ color: theme.textSec, ...membranePressSx }}><AccountCircle /></IconButton></Tooltip>
        <Tooltip title="Магазин тем"><IconButton onClick={() => setMarketplaceOpen(true)} sx={{ color: theme.textSec, ...membranePressSx }}><Palette /></IconButton></Tooltip>
        <Tooltip title="Моя ссылка для добавления в друзья"><IconButton onClick={() => setMyLinkDialogOpen(true)} sx={{ color: theme.textSec, ...membranePressSx }}><Link /></IconButton></Tooltip>
        <Tooltip title="Устройства"><IconButton onClick={() => navigate('/devices')} sx={{ color: theme.textSec, ...membranePressSx }}><DevicesOther /></IconButton></Tooltip>
        <Tooltip title="Скачать приложение"><IconButton onClick={() => navigate('/download')} sx={{ color: theme.textSec, ...membranePressSx }}><Download /></IconButton></Tooltip>
        {user?.username === 'admin3' && (
          <Tooltip title="Bug Bounty Tools"><IconButton onClick={() => navigate('/admin')} sx={{ color: theme.textSec, ...membranePressSx }}><Security /></IconButton></Tooltip>
        )}
      </Box>

      {contextMenu && <Box sx={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 2000, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 2, boxShadow: 4, p: .5 }} onMouseLeave={() => setContextMenu(null)}>
        <Button fullWidth startIcon={<Pin />} onClick={() => { togglePin(contextMenu.chat.id); setContextMenu(null); }}>Закрепить</Button>
        <Button fullWidth startIcon={<Archive />} onClick={() => { toggleArchive(contextMenu.chat.id); setContextMenu(null); }}>Архив</Button>
        <Button fullWidth startIcon={<Mute />} onClick={() => { toggleMute(contextMenu.chat.id); setContextMenu(null); }}>Без звука</Button>
        <Button fullWidth color="error" startIcon={<DeleteForever />} onClick={() => { setDeleteConfirmChat(contextMenu.chat); setContextMenu(null); }}>Удалить</Button>
      </Box>}

      <Box
        onMouseDown={() => {
          setResizing(true);
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
        }}
        sx={{
          position: 'absolute',
          right: -5,
          top: 0,
          bottom: 0,
          width: 10,
          zIndex: 5,
          cursor: 'ew-resize',
          '&::after': {
            content: '"↔"',
            position: 'absolute',
            right: 2,
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
        <DialogActions><Button onClick={() => setAddContactOpen(false)}>Закрыть</Button></DialogActions>
      </Dialog>

      <Snackbar open={!!inviteToast} autoHideDuration={2000} onClose={() => setInviteToast(null)}
        message={inviteToast || ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />

      <Dialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Новая группа</DialogTitle>
        <DialogContent>
          <TextField fullWidth autoFocus margin="dense" label="Название" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
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

      <Dialog open={musicOpen} onClose={() => setMusicOpen(false)} fullWidth maxWidth="md" PaperProps={{ sx: { height: '82vh', bgcolor: theme.bg, color: theme.text, borderRadius: 3 } }}><DialogTitle>Музыка и плейлисты</DialogTitle><DialogContent sx={{ p: 0 }}><MusicLibrary /></DialogContent><DialogActions><Button onClick={() => setMusicOpen(false)}>Закрыть</Button></DialogActions></Dialog>

      <Dialog open={myLinkDialogOpen} onClose={() => setMyLinkDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Моя ссылка для добавления в друзья</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Отправьте эту ссылку другу любым способом. Когда он её вставит у себя — вы окажетесь в контактах друг у друга и откроется чат.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField 
              size="small" 
              fullWidth 
              value={myInviteLink} 
              InputProps={{ readOnly: true }} 
              placeholder={myPk ? '' : 'Ключ ещё не готов…'} 
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
          
          <Divider sx={{ my: 2 }} />
          
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Добавить по ссылке друга</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField size="small" fullWidth placeholder="vera://add?pk=..." value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddByInvite(); }} />
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
        <DialogActions>
          <Button onClick={() => setMyLinkDialogOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Suspense fallback={null}>{themeEditorOpen && <ThemeEditor onClose={() => setThemeEditorOpen(false)} />}</Suspense>
      <Suspense fallback={null}>{marketplaceOpen && <ThemeMarketplace onClose={() => setMarketplaceOpen(false)} />}</Suspense>
    </Box>
  );
}