import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Box, Avatar, Typography, IconButton, TextField, Button,
  Divider, List, ListItem, ListItemAvatar, ListItemText, Menu, MenuItem,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Tabs, Tab, Checkbox, FormControlLabel,
} from '@mui/material';
import {
  ChevronRight, Edit, Check, CameraAlt, ExitToApp, PersonAdd, Search, Close,
  Image as ImageIcon, Videocam, AudioFile, AttachFile, Download, Lock,
} from '@mui/icons-material';
import { Chat, User, Message, MessageAttachment } from '../types';
import { useAuthStore } from '../store/authStore';
import { useUserBlocksStore } from '../store/userBlocksStore';
import { useChatStore } from '../store/chatStore';
import { useThemeStore } from '../store/themeStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { chatsApi, filesApi, usersApi, messagesApi } from '../services/api';
import { peer, isPeerAvailable } from '../services/peer';
import { useNavigate } from 'react-router-dom';
import { ChatMember } from '../types';
import { GROUP_RIGHTS, GroupRight, hasGroupRight } from '../services/groupPermissions';
import { SHOP_CATALOG, useShopStore } from '../store/shopStore';
import { useChatSkinStore } from '../store/chatSkinStore';
import type { ChatSkinSlot } from '../store/chatSkinStore';

/** Слоты «моих скинов» для инфопанели: store-ключ, applyKey каталога, подпись. */
const CHAT_SKIN_SLOTS = [
  ['ring', 'avatarRing', 'Обводка аватара'],
  ['selfcard', 'selfCard', 'Плашка моих сообщений'],
  ['bubble', 'bubbleStyle', 'Пузырь моих сообщений'],
] as const satisfies ReadonlyArray<readonly [ChatSkinSlot, string, string]>;

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

interface Props {
  onPlayerHost: (node: HTMLDivElement | null) => void;
  chat: Chat;
  onClose: () => void;
  onViewProfile?: (userId: string) => void;
}

export default function ChatInfoPanel({ chat, onClose, onViewProfile, onPlayerHost }: Props) {
  const user = useAuthStore((s) => s.user);
  const [channelSkins, setChannelSkins] = useState<{ chatId: string; ids: string[] } | null>(null);
  const [skinError, setSkinError] = useState('');
  const [mySkinError, setMySkinError] = useState('');
  const loadChats = useChatStore((s) => s.loadChats);
  const updateChatList = useChatStore((s) => s.updateChatList);
  const onlineUsers = useChatStore((s) => s.onlineUsers);
  const chats = useChatStore((s) => s.chats);
  // Только сообщения этого чата: раньше панель перерисовывалась на каждое
  // сообщение в любом чате (подписка на всю карту messages).
  const chatMessages = useChatStore((s) => s.messages[chat.id]);
  const theme = useThemeStore((s) => s.theme);
  // «Мои скины» чата: применяются только к моим сообщениям (см. MessageBubble).
  const chatSkins = useChatSkinStore((s) => s.overrides[chat.id]);
  const setChatSkin = useChatSkinStore((s) => s.setChatSkin);
  const clearChatSkins = useChatSkinStore((s) => s.clearChatSkins);
  const ownedSkins = useShopStore((s) => s.owned);
  const navigate = useNavigate();
  const savedWidth = useUserSettingsStore(s => s.layout.chatInfoWidth);
  const setLayout = useUserSettingsStore(s => s.setLayout);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const [maxWidth, setMaxWidth] = useState(600);
  const [resizing, setResizing] = useState(false);
  const panelWidth = Math.min(maxWidth, Math.max(300, Number(savedWidth) || 300));

  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      setMaxWidth(Math.max(300, Math.floor(parent.clientWidth * 0.6)));
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);


  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [newName, setNewName] = useState(chat?.name || '');
  const [newDesc, setNewDesc] = useState(chat?.description || '');
  const [saving, setSaving] = useState(false);
  const [adminTarget, setAdminTarget] = useState<ChatMember | null>(null);
  const [adminTitle, setAdminTitle] = useState('');
  const [adminRights, setAdminRights] = useState<ChatMember['permissions']>({});
  const [adminError, setAdminError] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  const [memberMenu, setMemberMenu] = useState<{ userId: string; x: number; y: number } | null>(null);
  const memberHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberTouch = useRef<{ x: number; y: number } | null>(null);
  const suppressMemberClick = useRef(false);
  const cancelMemberHold = () => {
    if (memberHold.current) clearTimeout(memberHold.current);
    memberHold.current = null;
  };
  useEffect(() => {
    setMemberMenu(null);
    setAdminTarget(null);
    return cancelMemberHold;
  }, [chat.id]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Add member dialog
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [addError, setAddError] = useState('');
  const [mediaTab, setMediaTab] = useState(0);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaMessages, setMediaMessages] = useState<Message[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadMediaHistory() {
      setMediaLoading(true);
      try {
        const collected: Message[] = [];
        if (isPeerAvailable()) {
          collected.push(...(chatMessages || []));
        } else {
          let before: string | undefined;
          for (;;) {
            const res = await messagesApi.getMessages(chat.id, before, 100);
            const pageMessages = Array.isArray(res.data) ? res.data : [];
            collected.push(...pageMessages);
            if (pageMessages.length < 100) break;
            const oldest = pageMessages[0]?.createdAt;
            if (!oldest || oldest === before) break;
            before = oldest;
          }
          // Keep locally archived messages too, including files uploaded while offline.
          collected.push(...(chatMessages || []));
        }
        const unique = new Map<string, Message>();
        collected.forEach((message) => {
          if (message?.id) unique.set(message.id, message);
        });
        if (!cancelled) setMediaMessages(Array.from(unique.values()));
      } catch {
        if (!cancelled) setMediaMessages(chatMessages || []);
      } finally {
        if (!cancelled) setMediaLoading(false);
      }
    }
    loadMediaHistory();
    return () => { cancelled = true; };
  }, [chat.id, chatMessages?.length]);

  const mediaItems = useMemo(() => {
    const unique = new Map<string, MessageAttachment>();
    const newestFirst = [...mediaMessages].sort((a, b) =>
      (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    newestFirst.forEach((message) => (message.attachments || []).forEach((attachment: MessageAttachment) => {
      if (attachment.fileUrl && attachment.mimeType !== 'application/x-vera-group-invite') {
        const key = attachment.id || `${message.id}:${attachment.fileUrl}`;
        if (!unique.has(key)) unique.set(key, attachment);
      }
    }));
    return Array.from(unique.values());
  }, [mediaMessages]);

  const mediaGroups = useMemo(() => [
    mediaItems.filter((item) => item.mimeType?.startsWith('image/')),
    mediaItems.filter((item) => item.mimeType?.startsWith('video/')),
    mediaItems.filter((item) => !item.mimeType?.startsWith('image/') && !item.mimeType?.startsWith('video/') && !item.mimeType?.startsWith('audio/')),
    mediaItems.filter((item) => item.mimeType?.startsWith('audio/')),
  ], [mediaItems]);

  // SEC: пропускаем только медиа-типы. Раньше /^data:/ принимал ЛЮБОЙ data-URL,
  // включая data:text/html — такая ссылка в <a href> открыла бы документ
  // в нашем origin. Сервер режет вложения через SAFE_MEDIA_DATA_URL, здесь
  // та же проверка на клиенте как второй эшелон.
  const resolveMediaUrl = (url: string) =>
    /^https?:|^blob:|^data:(?:image|audio|video)\//i.test(url)
      ? url
      : `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
  const formatFileSize = (size?: number) => {
    if (!size) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  async function searchUsers(q: string) {
    setSearchQ(q);
    if (!q.trim()) { setSearchResults([]); return; }
    // Ссылка приглашения Vera попадать в поиск не должна (мёртвый серверный API).
    if (/^vera:\/\//i.test(q.trim())) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await usersApi.search(q);
      // Exclude already existing members
      const existingIds = new Set((chat.members || []).map(m => m.userId));
      setSearchResults((res.data || []).filter((u: User) => !existingIds.has(u.id)));
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }

  async function addMember(userId: string) {
    setAddingUserId(userId);
    setAddError('');
    try {
      await chatsApi.addMember(chat.id, userId);
      await loadChats();
      setSearchResults(prev => prev.filter(u => u.id !== userId));
    } catch (e: any) {
      setAddError(e?.response?.data?.message || 'Ошибка добавления');
    }
    finally { setAddingUserId(null); }
  }

  async function inviteMember(userId: string) {
    setAddingUserId(userId);
    setAddError('');
    try {
      await chatsApi.invite(chat.id, userId);
      // Закрываем диалог и показываем успех
      setAddMemberOpen(false);
      setSearchQ('');
      setSearchResults([]);
    } catch (e: any) {
      setAddError(e?.response?.data?.message || 'Ошибка приглашения');
    }
    finally { setAddingUserId(null); }
  }

  if (!chat) return null;

  const isGroup = chat.type === 'group' || chat.type === 'channel';
  const myMember = chat.members?.find(m => m.userId === user?.id);
  const canEdit = isGroup && hasGroupRight(myMember, 'changeInfo');

  // Блокировка доступна только в личке: в группе собеседников много, и запрет
  // писать «этому пользователю» означал бы запрет писать всем остальным.
  const blocks = useUserBlocksStore();
  useEffect(() => { if (!blocks.loaded) blocks.load(); }, []);
  const peerId = !isGroup ? chat.members?.find((m) => m.userId !== user?.id)?.userId : undefined;
  const peerBlocked = !!peerId && blocks.isBlocked(peerId);
  const [blockError, setBlockError] = useState('');
  const [blockBusy, setBlockBusy] = useState(false);
  const toggleBlock = async () => {
    if (!peerId) return;
    setBlockBusy(true); setBlockError('');
    try {
      if (peerBlocked) await blocks.unblock(peerId);
      else await blocks.block(peerId);
    } catch (e: any) {
      setBlockError(e.response?.data?.message || 'Не удалось изменить блокировку');
    } finally {
      setBlockBusy(false);
    }
  };
  useEffect(() => {
    if (chat.type !== 'channel' || !canEdit) return;
    let cancelled = false;
    setChannelSkins(null);
    setSkinError('');
    chatsApi.getChannelSkins(chat.id).then(res => {
      if (!cancelled) setChannelSkins({ chatId: chat.id, ids: res.data });
    }).catch(() => {
      if (!cancelled) setSkinError('Не удалось загрузить скины создателя канала');
    });
    return () => { cancelled = true; };
  }, [chat.id, chat.type, canEdit]);
  const canManageAdmins = isGroup && !isPeerAvailable() && hasGroupRight(myMember, 'manageAdmins');
  const canManageMember = (member: ChatMember) => canManageAdmins && member.role !== 'owner' &&
    member.userId !== user?.id && (myMember?.role === 'owner' || member.role !== 'admin' || member.promotedBy === user?.id);
  const openAdmin = (member: ChatMember) => {
    if (!canManageMember(member)) return;
    setAdminTarget(member);
    setAdminTitle(member.adminTitle || '');
    setAdminError('');
    setAdminRights(Object.fromEntries((Object.keys(GROUP_RIGHTS) as GroupRight[]).map(right =>
      [right, member.role === 'admin' && hasGroupRight(member, right)])));
  };
  const selectedMember = chat.members?.find(m => m.userId === memberMenu?.userId);
  async function saveAdmin(role: 'admin' | 'member') {
    if (!adminTarget) return;
    setAdminSaving(true); setAdminError('');
    try {
      const result = await chatsApi.setAdmin(chat.id, adminTarget.userId, { role, adminTitle, permissions: adminRights });
      updateChatList(result.data);
      setAdminTarget(null);
    } catch (err: any) {
      setAdminError(err.response?.data?.message || 'Не удалось сохранить права');
    } finally { setAdminSaving(false); }
  }

  const otherMember = chat.type === 'private'
    ? chat.members?.find(m => m.userId !== user?.id)
    : null;
  const otherUser = otherMember?.user;

  const displayName = isGroup
    ? (chat.name || 'Группа')
    : otherUser
      ? ([otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ').trim() || otherUser.username)
      : 'Чат';

  const avatarSrc = isGroup ? chat.avatarUrl : otherUser?.avatarUrl;

  async function saveName() {
    if (!newName.trim() || !canEdit) return;
    setSaving(true);
    try {
      if (isPeerAvailable()) {
        await peer.updateChat(chat.id, { title: newName.trim() });
        await loadChats();
      } else {
        const res = await chatsApi.update(chat.id, { name: newName.trim() });
        updateChatList(res.data);
      }
      setEditingName(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  async function saveDesc() {
    if (!canEdit) return;
    setSaving(true);
    try {
      if (isPeerAvailable()) {
        await peer.updateChat(chat.id, { description: newDesc.trim() });
        await loadChats();
      } else {
        const res = await chatsApi.update(chat.id, { description: newDesc.trim() });
        updateChatList(res.data);
      }
      setEditingDesc(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !canEdit) return;
    setUploadingAvatar(true);
    try {
      if (isPeerAvailable()) {
        // Читаем в data URL с даунскейлом до 512px, чтобы не раздувать store
        const raw: string = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('read error'));
          r.readAsDataURL(file);
        });
        const url: string = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const max = 512;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const ctx = c.getContext('2d'); if (!ctx) return resolve(raw);
            ctx.drawImage(img, 0, 0, w, h);
            try { resolve(c.toDataURL('image/jpeg', 0.85)); } catch { resolve(raw); }
          };
          img.onerror = () => resolve(raw);
          img.src = raw;
        });
        await peer.updateChat(chat.id, { avatar: url });
        await loadChats();
      } else {
        const uploadRes = await filesApi.upload(file);
        const url = uploadRes.data?.url || uploadRes.data?.fileUrl;
        if (url) {
          const res = await chatsApi.update(chat.id, { avatarUrl: url });
          updateChatList(res.data);
        }
      }
    } catch (e) { console.error(e); }
    finally { setUploadingAvatar(false); }
  }

  async function kickMember(userId: string) {
    if (!canEdit || !isPeerAvailable()) return;
    if (userId === user?.id || userId === chat.ownerId) return;
    if (!window.confirm('Удалить участника из группы?')) return;
    const nextPeers = (chat.members || [])
      .map((m) => m.userId)
      .filter((id) => id !== userId);
    try {
      await peer.updateChat(chat.id, { peers: nextPeers });
      await loadChats();
    } catch (e) { console.error('kickMember:', e); }
  }

  const inputSx = {
    '& .MuiOutlinedInput-root': {
      color: theme.text, fontSize: 15,
      '& fieldset': { borderColor: theme.accent + '60' },
      '&.Mui-focused fieldset': { borderColor: theme.accent },
    },
    '& .MuiInputBase-input': { color: theme.text },
  };

  return (
    <Box ref={panelRef} sx={{
      width: '100%',
      userSelect: resizing ? 'none' : undefined,
      height: '100dvh',
      bgcolor: theme.bgHeader,
      borderLeft: 'none',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      zIndex: 1200,
      paddingTop: 'env(safe-area-inset-top)',
      '@media (min-width: 701px)': {
        position: 'relative',
        width: panelWidth,
        flexShrink: 0,
        height: '100%',
        minHeight: 0,
        zIndex: 'auto',
        borderLeft: `1px solid ${theme.border}`,
        paddingTop: 0,
      },
    }}>
      <Box
        role="separator"
        aria-label="Ширина информации о чате"
        aria-orientation="vertical"
        aria-valuemin={300}
        aria-valuemax={maxWidth}
        aria-valuenow={panelWidth}
        tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, width: panelWidth };
          setResizing(true);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag) return;
          setLayout('chatInfoWidth', Math.min(maxWidth, Math.max(300,
            Math.round(drag.width + drag.x - event.clientX))));
        }}
        onPointerUp={event => {
          dragRef.current = null;
          setResizing(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { dragRef.current = null; setResizing(false); }}
        onLostPointerCapture={() => { dragRef.current = null; setResizing(false); }}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setLayout('chatInfoWidth', Math.min(maxWidth, Math.max(300,
            panelWidth + (event.key === 'ArrowLeft' ? 20 : -20))));
        }}
        sx={{
          display: 'none',
          '@media (min-width: 701px)': { display: 'block' },
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 6, zIndex: 1, cursor: 'col-resize', touchAction: 'none',
          bgcolor: resizing ? theme.accent + '60' : 'transparent',
          '&:hover, &:focus-visible': { bgcolor: theme.accent + '60' },
        }}
      />
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', px: { xs: 1, md: 2 }, py: { xs: 0.75, md: 1.5 },
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}>
        <Typography sx={{ flex: 1, fontWeight: 700, fontSize: 16, color: theme.text }}>
          {isGroup ? 'Информация о группе' : 'Профиль'}
        </Typography>
        <IconButton size="small" onClick={onClose}
          sx={{ color: theme.textSec, '&:hover': { color: theme.text } }}>
          <ChevronRight sx={{
            fontSize: 24,
            transform: 'rotate(180deg)',
            '@media (min-width: 701px)': { transform: 'none' },
          }} />
        </IconButton>
      </Box>

      <Box sx={{
        flex: 1, overflowY: 'auto',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: theme.accent + '30', borderRadius: 4 },
      }}>
        {/* Avatar + name section */}
        <Box sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          pt: 3, pb: 2.5, px: 2,
          background: `linear-gradient(180deg, ${theme.accent}18 0%, transparent 100%)`,
        }}>
          <Box sx={{ position: 'relative', mb: 1.5 }}>
            {uploadingAvatar ? (
              <Box sx={{
                width: 88, height: 88, borderRadius: '50%',
                bgcolor: theme.accent + '40',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CircularProgress size={28} sx={{ color: theme.accent }} />
              </Box>
            ) : (
              <Avatar
                src={avatarSrc || undefined}
                sx={{
                  width: 88, height: 88, fontSize: 26,
                  bgcolor: theme.accent + '80',
                  cursor: canEdit ? 'pointer' : 'default',
                  border: `3px solid ${theme.accent}`,
                  boxShadow: `0 0 20px ${theme.accent}40`,
                }}
                onClick={() => canEdit && avatarInputRef.current?.click()}
              >
                {getInitials(displayName)}
              </Avatar>
            )}
            {canEdit && (
              <Box onClick={() => avatarInputRef.current?.click()} sx={{
                position: 'absolute', bottom: 0, right: 0,
                width: 26, height: 26, borderRadius: '50%',
                bgcolor: theme.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                '&:hover': { opacity: 0.85 },
              }}>
                <CameraAlt sx={{ fontSize: 14, color: '#fff' }} />
              </Box>
            )}
            <input ref={avatarInputRef} type="file" hidden accept="image/*" onChange={handleAvatarChange} />
          </Box>

          {/* Name */}
          {editingName ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', justifyContent: 'center' }}>
              <TextField
                size="small" autoFocus value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                sx={{ ...inputSx, maxWidth: 180 }}
              />
              <IconButton size="small" onClick={saveName} disabled={saving}
                sx={{ color: '#4CAF50' }}>
                {saving ? <CircularProgress size={16} /> : <Check sx={{ fontSize: 18 }} />}
              </IconButton>
              <IconButton size="small" onClick={() => setEditingName(false)}
                sx={{ color: theme.textSec }}>
                <Close sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: 19, fontWeight: 700, color: theme.text }}>
                {displayName}
              </Typography>
              {canEdit && (
                <IconButton size="small"
                  onClick={() => { setNewName(displayName); setEditingName(true); }}
                  sx={{ color: theme.textSec, '&:hover': { color: theme.accent } }}>
                  <Edit sx={{ fontSize: 15 }} />
                </IconButton>
              )}
            </Box>
          )}

          {/* Status / member count */}
          <Typography sx={{
            fontSize: 13, mt: 0.4,
            color: isGroup
              ? theme.textSec
              : (otherUser && onlineUsers.has(otherUser.id) ? theme.online : theme.textSec),
          }}>
            {isGroup
              ? `${chat.members?.length || 0} участников`
              : otherUser && onlineUsers.has(otherUser.id) ? '● в сети' : '○ не в сети'}
          </Typography>
        </Box>

        {chat.type === 'channel' && canEdit && <Box sx={{ p: 2 }}>
          <Typography fontWeight={600}>Скины канала</Typography>
          <Typography variant="caption">Доступны только скины из инвентаря создателя канала</Typography>
          {([
            ['activeRing', 'avatarRing', 'Обводка аватара'],
            ['activeSelfCard', 'selfCard', 'Плашка сообщений'],
            ['activeBubble', 'bubbleStyle', 'Пузырь сообщений'],
          ] as const).map(([key, applyKey, label]) => <TextField key={key} select fullWidth margin="dense" label={label}
            disabled={channelSkins?.chatId !== chat.id}
            value={channelSkins?.chatId === chat.id && channelSkins.ids.includes(chat[key] || '') ? chat[key] : ''} onChange={async e => {
              setSkinError('');
              try { const res = await chatsApi.update(chat.id, { [key]: e.target.value }); updateChatList(res.data); }
              catch (error: any) { setSkinError(error.response?.data?.message || 'Не удалось применить скин'); }
            }}>
            <MenuItem value="">Без скина</MenuItem>
            {SHOP_CATALOG.filter(i => i.applyKey === applyKey && channelSkins?.chatId === chat.id && channelSkins.ids.includes(i.id)).map(i => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
          </TextField>)}
          {skinError && <Typography color="error">{skinError}</Typography>}
        </Box>}

        {/* Мои скины — только на мои сообщения в этом чате */}
        <Box sx={{ p: 2 }}>
          <Typography fontWeight={600}>Мои скины в этом чате</Typography>
          <Typography variant="caption">
            Применяются только к вашим сообщениям. «Как в профиле» — общий выбор из инвентаря.
          </Typography>
          {CHAT_SKIN_SLOTS.map(([slot, applyKey, label]) => {
            const value = !chatSkins || !(slot in chatSkins) ? 'profile' : chatSkins[slot] === '' ? 'none' : chatSkins[slot];
            return <TextField key={slot} select fullWidth margin="dense" label={label}
              value={value}
              onChange={async e => {
                const v = e.target.value;
                const next = v === 'profile' ? undefined : v === 'none' ? '' : v;
                // Мгновенно применяем у себя и сообщаем серверу, чтобы скины
                // видели остальные участники (members.skins + user:equipment).
                setChatSkin(chat.id, slot, next);
                setMySkinError('');
                try { await chatsApi.setMySkins(chat.id, { [slot]: next === undefined ? null : next }); }
                catch (error: any) { setMySkinError(error.response?.data?.message || 'Не удалось сохранить скин для чата'); }
              }}>
              <MenuItem value="profile">Как в профиле</MenuItem>
              <MenuItem value="none">Без скина</MenuItem>
              {SHOP_CATALOG.filter(i => i.applyKey === applyKey && !i.stock && ownedSkins[i.id]).map(i => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
            </TextField>;
          })}
          {!!chatSkins && !!Object.keys(chatSkins).length && (
            <Button size="small" sx={{ mt: 1, color: theme.textSec }} onClick={() => clearChatSkins(chat.id)}>
              Сбросить для этого чата
            </Button>
          )}
          {mySkinError && <Typography color="error" sx={{ mt: 1 }}>{mySkinError}</Typography>}
        </Box>

        <Divider sx={{ borderColor: theme.border }} />

        {/* Description (groups) */}
        {isGroup && (
          <Box sx={{ px: 2, py: 1.75 }}>
            <Typography sx={{
              fontSize: 11, color: theme.textSec,
              textTransform: 'uppercase', letterSpacing: 0.8, mb: 1, fontWeight: 600,
            }}>
              Описание
            </Typography>
            {editingDesc ? (
              <Box>
                <TextField fullWidth size="small" multiline rows={3} autoFocus
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  sx={inputSx}
                />
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                  <Button size="small" variant="contained" onClick={saveDesc} disabled={saving}
                    sx={{ bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent + 'CC' }, fontSize: 13 }}>
                    {saving ? <CircularProgress size={14} /> : 'Сохранить'}
                  </Button>
                  <Button size="small" onClick={() => setEditingDesc(false)}
                    sx={{ color: theme.textSec, fontSize: 13 }}>
                    Отмена
                  </Button>
                </Box>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                <Typography sx={{
                  flex: 1, fontSize: 14,
                  color: chat.description ? theme.text : theme.textSec,
                  fontStyle: chat.description ? 'normal' : 'italic',
                }}>
                  {chat.description || (canEdit ? 'Нажмите, чтобы добавить описание' : 'Нет описания')}
                </Typography>
                {canEdit && (
                  <IconButton size="small" onClick={() => setEditingDesc(true)}
                    sx={{ color: theme.textSec, '&:hover': { color: theme.accent }, mt: -0.5 }}>
                    <Edit sx={{ fontSize: 15 }} />
                  </IconButton>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Private chat: other user info */}
        {!isGroup && otherUser && (
          <Box sx={{ px: 2, py: 1.75 }}>
            {otherUser.bio && (
              <>
                <Typography sx={{
                  fontSize: 11, color: theme.textSec,
                  textTransform: 'uppercase', letterSpacing: 0.8, mb: 0.75, fontWeight: 600,
                }}>О себе</Typography>
                <Typography sx={{ fontSize: 14, color: theme.text, mb: 1.5, whiteSpace: 'pre-wrap' }}>
                  {otherUser.bio}
                </Typography>
                <Divider sx={{ borderColor: theme.border, mb: 1.5 }} />
              </>
            )}
            <Typography sx={{
              fontSize: 11, color: theme.textSec,
              textTransform: 'uppercase', letterSpacing: 0.8, mb: 0.75, fontWeight: 600,
            }}>Имя пользователя</Typography>
            <Typography sx={{ fontSize: 14, color: theme.accent, mb: 1.5 }}>@{otherUser.username}</Typography>
            {otherUser.phone && (
              <>
                <Typography sx={{
                  fontSize: 11, color: theme.textSec,
                  textTransform: 'uppercase', letterSpacing: 0.8, mb: 0.75, fontWeight: 600,
                }}>Телефон</Typography>
                <Typography sx={{ fontSize: 14, color: theme.text }}>{otherUser.phone}</Typography>
              </>
            )}
          </Box>
        )}

        {/* All attachments shared in this chat */}
        <Divider sx={{ borderColor: theme.border }} />
        <Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
          <Typography sx={{
            px: 0.5, fontSize: 11, color: theme.textSec,
            textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600,
          }}>
            Медиа и файлы
          </Typography>
          <Tabs
            value={mediaTab}
            onChange={(_, value) => setMediaTab(value)}
            variant="scrollable"
            scrollButtons={false}
            sx={{
              minHeight: 38,
              '& .MuiTabs-indicator': { bgcolor: theme.accent },
              '& .MuiTab-root': { minWidth: 0, minHeight: 38, px: 1, color: theme.textSec, fontSize: 11, textTransform: 'none' },
              '& .Mui-selected': { color: `${theme.accent} !important` },
            }}
          >
            <Tab icon={<ImageIcon sx={{ fontSize: 17 }} />} iconPosition="start" label={`Фото ${mediaGroups[0].length || ''}`} />
            <Tab icon={<Videocam sx={{ fontSize: 17 }} />} iconPosition="start" label={`Видео ${mediaGroups[1].length || ''}`} />
            <Tab icon={<AttachFile sx={{ fontSize: 17 }} />} iconPosition="start" label={`Файлы ${mediaGroups[2].length || ''}`} />
            <Tab icon={<AudioFile sx={{ fontSize: 17 }} />} iconPosition="start" label={`Звуки ${mediaGroups[3].length || ''}`} />
          </Tabs>
          {mediaLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} sx={{ color: theme.accent }} /></Box>
          ) : mediaGroups[mediaTab].length === 0 ? (
            <Typography sx={{ color: theme.textSec, fontSize: 13, textAlign: 'center', py: 2 }}>
              Здесь пока ничего нет
            </Typography>
          ) : (
            <Box key={`${chat.id}:${mediaTab}`} tabIndex={0} role="region" aria-label="Вложения чата" sx={{
              display: 'flex', flexWrap: 'nowrap', gap: 0.75, mt: 0.5, pb: 0.75,
              minWidth: 0, maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden',
              scrollSnapType: 'x proximity',
              '& > *': {
                flex: mediaTab === 0 ? '0 0 88px' : '0 0 min(260px, 100%)',
                minWidth: 0, boxSizing: 'border-box', scrollSnapAlign: 'start',
              },
              '&::-webkit-scrollbar': { height: 6 },
              '&::-webkit-scrollbar-thumb': { bgcolor: theme.accent + '60', borderRadius: 3 },
            }}>
              {mediaGroups[mediaTab].map((item) => {
                const url = resolveMediaUrl(item.fileUrl);
                const name = item.fileName || 'Вложение';
                if (mediaTab === 0) {
                  return <Box key={item.id} component="a" href={url} target="_blank" rel="noreferrer" sx={{ display: 'block', aspectRatio: '1', overflow: 'hidden', borderRadius: 1.5, bgcolor: theme.bgHover }}>
                    <Box component="img" src={resolveMediaUrl(item.thumbnailUrl || item.fileUrl)} alt={name} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </Box>;
                }
                if (mediaTab === 1) {
                  return <Box key={item.id} sx={{ bgcolor: theme.bgHover, borderRadius: 1.5, p: 0.75 }}><Box component="video" src={url} controls preload="metadata" sx={{ width: '100%', height: 150, objectFit: 'contain', display: 'block' }} /></Box>;
                }
                if (mediaTab === 3) {
                  return <Box key={item.id} sx={{ bgcolor: theme.bgHover, borderRadius: 1.5, px: 1, py: 0.75 }}><Typography noWrap sx={{ color: theme.text, fontSize: 12, mb: 0.5 }}>{name}</Typography><Box component="audio" src={url} controls preload="metadata" sx={{ width: '100%', height: 34 }} /></Box>;
                }
                return <Box key={item.id} component="a" href={url} target="_blank" rel="noreferrer" download={name} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1.5, bgcolor: theme.bgHover, color: theme.text, textDecoration: 'none', '&:hover': { bgcolor: theme.accent + '18' } }}>
                  <AttachFile sx={{ fontSize: 19, color: theme.accent }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 13 }}>{name}</Typography><Typography noWrap sx={{ color: theme.textSec, fontSize: 11 }}>{[item.mimeType, formatFileSize(item.fileSize)].filter(Boolean).join(' • ')}</Typography></Box><Download sx={{ fontSize: 18, color: theme.textSec }} />
                </Box>;
              })}
            </Box>
          )}
        </Box>

        {/* Members list (groups) */}
        {isGroup && chat.members && chat.members.length > 0 && (
          <>
            <Divider sx={{ borderColor: theme.border }} />
            <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
              <Typography sx={{
                fontSize: 11, color: theme.textSec,
                textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600,
              }}>
                Участники · {chat.members.length}
              </Typography>
            </Box>
            <List disablePadding>
              {chat.members.map(m => {
                const u = m.user;
                if (!u) return null;
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
                return (
                  <ListItem
                    key={m.id}
                    onClick={(e) => {
                      if (suppressMemberClick.current) { e.preventDefault(); e.stopPropagation(); suppressMemberClick.current = false; return; }
                      cancelMemberHold();
                      if (canManageMember(m)) {
                        setMemberMenu({ userId: m.userId, x: e.clientX, y: e.clientY });
                      } else {
                        onViewProfile?.(u.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      cancelMemberHold();
                      setMemberMenu({ userId: m.userId, x: e.clientX, y: e.clientY });
                    }}
                    onTouchStart={(e) => {
                      cancelMemberHold();
                      suppressMemberClick.current = false;
                      if (e.touches.length !== 1) return;
                      const { clientX: x, clientY: y } = e.touches[0];
                      memberTouch.current = { x, y };
                      memberHold.current = setTimeout(() => {
                        suppressMemberClick.current = true;
                        setMemberMenu({ userId: m.userId, x, y });
                      }, 500);
                    }}
                    onTouchMove={(e) => {
                      const start = memberTouch.current;
                      const touch = e.touches[0];
                      if (!start || !touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) cancelMemberHold();
                    }}
                    onTouchEnd={cancelMemberHold}
                    onTouchCancel={cancelMemberHold}
                    sx={{
                      px: 2, py: 0.9,
                      cursor: 'pointer',
                      userSelect: 'none', WebkitTouchCallout: 'none',
                      '&:hover': { bgcolor: theme.bgHover },
                      transition: 'background 0.12s',
                    }}
                  >
                    <ListItemAvatar sx={{ minWidth: 46 }}>
                      <Avatar
                        src={u.avatarUrl || undefined}
                        sx={{
                          width: 38, height: 38, fontSize: 13,
                          bgcolor: theme.accent + '70',
                        }}
                      >
                        {getInitials(name)}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography sx={{
                          fontSize: 14, fontWeight: 500,
                          color: u.id === user?.id ? theme.accent : theme.text,
                        }}>
                          {name}{u.id === user?.id ? ' (вы)' : ''}
                        </Typography>
                      }
                      secondary={
                        <Typography sx={{ fontSize: 12, color: theme.textSec }}>
                          {m.role === 'owner' ? '👑 Владелец'
                            : m.role === 'admin' ? `⚡ ${m.adminTitle || 'Администратор'}`
                            : onlineUsers.has(u.id) ? '● в сети' : ''}
                        </Typography>
                      }
                    />
                    {canManageMember(m) && (
                      <Button size="small" onClick={(e) => {
                        e.stopPropagation(); openAdmin(m);
                      }}>Права</Button>
                    )}
                    {isPeerAvailable() && canEdit && u.id !== user?.id && u.id !== chat.ownerId && (
                      <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); kickMember(u.id); }}
                        sx={{ color: '#f44336', '&:hover': { bgcolor: 'rgba(244,67,54,0.08)' } }}
                        title="Удалить из группы"
                      >
                        <Close sx={{ fontSize: 18 }} />
                      </IconButton>
                    )}
                  </ListItem>
                );
              })}
            </List>
          </>
        )}

        {/* Add member + Leave group */}
        {/* Блокировка — только в личке, где собеседник один. В группе запрет
            писать «этому пользователю» означал бы запрет писать всем остальным. */}
        {!isGroup && peerId && (
          <>
            <Divider sx={{ borderColor: theme.border, mt: 1 }} />
            <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Button
                fullWidth size="small"
                // Иконка одна (Lock) для обоих состояний: в shim только она,
                // а различие состояний уже читается по подписи кнопки.
                startIcon={<Lock sx={{ fontSize: 18 }} />}
                disabled={blockBusy}
                sx={{
                  color: peerBlocked ? theme.accent : '#f44336',
                  justifyContent: 'flex-start',
                  fontSize: 14, textTransform: 'none',
                  '&:hover': { bgcolor: peerBlocked ? theme.accent + '14' : 'rgba(244,67,54,0.08)' },
                }}
                onClick={toggleBlock}
              >
                {peerBlocked ? 'Разблокировать' : 'Заблокировать'}
              </Button>
              {blockError && <Typography sx={{ fontSize: 12, color: '#f44336' }}>{blockError}</Typography>}
              {peerBlocked && (
                <Typography sx={{ fontSize: 11.5, color: theme.textSec }}>
                  Пока пользователь заблокирован, вы не можете писать ему, а он — вам.
                </Typography>
              )}
            </Box>
          </>
        )}

        {isGroup && (
          <>
            <Divider sx={{ borderColor: theme.border, mt: 1 }} />
            <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Button
                fullWidth size="small"
                startIcon={<PersonAdd sx={{ fontSize: 18 }} />}
                sx={{
                  color: theme.accent, justifyContent: 'flex-start',
                  fontSize: 14, textTransform: 'none',
                  '&:hover': { bgcolor: theme.accent + '14' },
                }}
                onClick={() => { setAddMemberOpen(true); setSearchQ(''); setSearchResults([]); setAddError(''); }}
                disabled={!isPeerAvailable() && !hasGroupRight(myMember, 'inviteMembers')}
              >
                Добавить участника
              </Button>
              <Button
                fullWidth size="small"
                startIcon={<ExitToApp />}
                sx={{
                  color: '#f44336', justifyContent: 'flex-start',
                  fontSize: 14, textTransform: 'none',
                  '&:hover': { bgcolor: 'rgba(244,67,54,0.08)' },
                }}
                onClick={async () => {
                  try {
                    await chatsApi.leaveChat(chat.id);
                    await loadChats();
                    onClose();
                    navigate('/');
                  } catch (e) { console.error(e); }
                }}
              >
                Покинуть группу
              </Button>
            </Box>
          </>
        )}
        <div ref={onPlayerHost} />
      </Box>

      <Menu open={!!memberMenu && !!selectedMember} onClose={() => setMemberMenu(null)}
        anchorReference="anchorPosition" anchorPosition={memberMenu ? { top: memberMenu.y, left: memberMenu.x } : undefined}
        PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text } }}>
        <MenuItem onClick={() => { if (selectedMember) onViewProfile?.(selectedMember.userId); setMemberMenu(null); }}
          sx={{ color: theme.text, '&:hover': { bgcolor: theme.bgHover } }}>Открыть профиль</MenuItem>
        {selectedMember && canManageMember(selectedMember) && (
          <MenuItem onClick={() => { openAdmin(selectedMember); setMemberMenu(null); }}
            sx={{ color: theme.text, '&:hover': { bgcolor: theme.bgHover } }}>
            {selectedMember.role === 'admin' ? 'Изменить права и звание' : 'Назначить администратором'}
          </MenuItem>
        )}
        {selectedMember?.role === 'admin' && canManageMember(selectedMember) && (
          <MenuItem sx={{ color: 'error.main' }} onClick={() => { openAdmin(selectedMember); setMemberMenu(null); }}>Снять администратора…</MenuItem>
        )}
      </Menu>

      {/* Add member dialog */}
      <Dialog open={!!adminTarget} onClose={() => { if (!adminSaving) setAdminTarget(null); }} fullWidth maxWidth="xs"
        PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text } }}>
        <DialogTitle>Права администратора</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>{adminTarget?.user?.firstName || adminTarget?.user?.username}</Typography>
          <TextField fullWidth label="Звание" placeholder="Например: Модератор" value={adminTitle}
            onChange={e => setAdminTitle(e.target.value)} inputProps={{ maxLength: 32 }} disabled={adminSaving}
            helperText="Своё название должности, до 32 символов" sx={{ mb: 2 }} />
          {(Object.keys(GROUP_RIGHTS) as GroupRight[]).map(right => (
            <FormControlLabel key={right} sx={{ display: 'flex' }} label={GROUP_RIGHTS[right]}
              control={<Checkbox checked={adminRights?.[right] === true}
                disabled={adminSaving || !hasGroupRight(myMember, right)}
                onChange={(_, checked) => setAdminRights(prev => ({ ...prev, [right]: checked }))} />} />
          ))}
          <Typography variant="body2" sx={{ mt: 1 }}>Можно выдавать только свои права. Назначенные администраторы управляют только своими назначениями.</Typography>
          {adminError && <Typography color="error" role="alert">{adminError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}>
          {adminTarget?.role === 'admin' && <Button color="error" disabled={adminSaving} onClick={() => void saveAdmin('member')}>Снять администратора</Button>}
          <Button disabled={adminSaving} onClick={() => setAdminTarget(null)}>Отмена</Button>
          <Button disabled={adminSaving} onClick={() => void saveAdmin('admin')}>Сохранить</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: theme.bgHeader, color: theme.text,
            borderRadius: 3, minWidth: 340, maxWidth: 420,
            border: `1px solid ${theme.border}`,
          },
        }}
      >
        <DialogTitle sx={{ pb: 1, fontWeight: 700, fontSize: 17, color: theme.text }}>
          Добавить участника
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          {/* Пригласить из личных чатов */}
          {(() => {
            const existingIds = new Set((chat.members || []).map(m => m.userId));
            const directPartners = (chats || [])
              .filter((c: any) => c.type === 'direct')
              .map((c: any) => c.members?.find((m: any) => m.userId !== user?.id)?.user)
              .filter((u: any): u is User => !!u && !existingIds.has(u.id));
            if (directPartners.length === 0) return null;
            return (
              <Box sx={{ mb: 1.5 }}>
                <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Из моих чатов
                </Typography>
                <List disablePadding>
                  {directPartners.map((u: User) => {
                    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
                    return (
                      <ListItem key={u.id} disablePadding sx={{ mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, px: 1, py: 0.75, borderRadius: 2, bgcolor: theme.bgHover }}>
                          <Avatar src={u.avatarUrl || undefined} sx={{ width: 32, height: 32, fontSize: 12, bgcolor: theme.accent + '70' }}>
                            {getInitials(name)}
                          </Avatar>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 500, color: theme.text, lineHeight: 1.3 }}>{name}</Typography>
                            <Typography sx={{ fontSize: 12, color: theme.textSec }}>@{u.username}</Typography>
                          </Box>
                          <Button
                            size="small"
                            disabled={addingUserId === u.id}
                            onClick={() => inviteMember(u.id)}
                            sx={{ color: theme.accent, textTransform: 'none', fontSize: 13, minWidth: 0 }}
                          >
                            {addingUserId === u.id ? <CircularProgress size={16} sx={{ color: theme.accent }} /> : 'Пригласить'}
                          </Button>
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
                <Divider sx={{ my: 1.5, borderColor: theme.border }} />
              </Box>
            );
          })()}
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Поиск по имени, username или телефону..."
            value={searchQ}
            onChange={e => searchUsers(e.target.value)}
            InputProps={{
              startAdornment: <Search sx={{ fontSize: 18, color: theme.textSec, mr: 0.5 }} />,
              sx: { color: theme.text, fontSize: 14 },
            }}
            sx={{
              mt: 0.5, mb: 1,
              '& .MuiOutlinedInput-root': {
                color: theme.text,
                '& fieldset': { borderColor: theme.accent + '50' },
                '&.Mui-focused fieldset': { borderColor: theme.accent },
              },
            }}
          />
          {addError && (
            <Typography sx={{ fontSize: 13, color: '#f44336', mb: 1 }}>{addError}</Typography>
          )}
          {searchLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} sx={{ color: theme.accent }} />
            </Box>
          ) : searchResults.length > 0 ? (
            <List disablePadding>
              {searchResults.map(u => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
                return (
                  <ListItem key={u.id} disablePadding sx={{ mb: 0.5 }}>
                    <Box sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      flex: 1, px: 1, py: 0.75, borderRadius: 2,
                      bgcolor: theme.bgHover,
                    }}>
                      <Avatar
                        src={u.avatarUrl || undefined}
                        sx={{ width: 36, height: 36, fontSize: 13, bgcolor: theme.accent + '70' }}
                      >
                        {getInitials(name)}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 500, color: theme.text, lineHeight: 1.3 }}>
                          {name}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: theme.textSec }}>
                          @{u.username}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        disabled={addingUserId === u.id}
                        onClick={() => inviteMember(u.id)}
                        sx={{ color: theme.accent, '&:hover': { bgcolor: theme.accent + '20' } }}
                      >
                        {addingUserId === u.id
                          ? <CircularProgress size={18} sx={{ color: theme.accent }} />
                          : <PersonAdd sx={{ fontSize: 20 }} />
                        }
                      </IconButton>
                    </Box>
                  </ListItem>
                );
              })}
            </List>
          ) : searchQ.trim() ? (
            <Typography sx={{ fontSize: 14, color: theme.textSec, textAlign: 'center', py: 2 }}>
              Никого не найдено
            </Typography>
          ) : (
            <Typography sx={{ fontSize: 13, color: theme.textSec, textAlign: 'center', py: 1.5 }}>
              Введите имя, username или номер телефона
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddMemberOpen(false)}
            sx={{ color: theme.textSec, textTransform: 'none', fontSize: 14 }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
