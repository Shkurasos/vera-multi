import React, { useState, useRef } from 'react';
import {
  Box, Avatar, Typography, IconButton, TextField, Button,
  Divider, List, ListItem, ListItemAvatar, ListItemText,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Close, Edit, Check, CameraAlt, ExitToApp, PersonAdd, Search,
} from '@mui/icons-material';
import { Chat, User } from '../types';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useThemeStore } from '../store/themeStore';
import { chatsApi, filesApi, usersApi } from '../services/api';
import { peer, isPeerAvailable } from '../services/peer';
import { useNavigate } from 'react-router-dom';

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

interface Props {
  chat: Chat;
  onClose: () => void;
  onViewProfile?: (userId: string) => void;
}

export default function ChatInfoPanel({ chat, onClose, onViewProfile }: Props) {
  const { user } = useAuthStore();
  const { loadChats, updateChatList, onlineUsers } = useChatStore();
  const { theme } = useThemeStore();
  const navigate = useNavigate();

  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [newName, setNewName] = useState(chat?.name || '');
  const [newDesc, setNewDesc] = useState(chat?.description || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Add member dialog
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [addError, setAddError] = useState('');

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

  if (!chat) return null;

  const isGroup = chat.type === 'group' || chat.type === 'channel';
  const myRole = chat.members?.find(m => m.userId === user?.id)?.role;
  const canEdit = isGroup && (myRole === 'owner' || myRole === 'admin');

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
    <Box sx={{
      width: 300, height: '100%',
      bgcolor: theme.bgHeader,
      borderLeft: `1px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', px: 2, py: 1.5,
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}>
        <Typography sx={{ flex: 1, fontWeight: 700, fontSize: 16, color: theme.text }}>
          {isGroup ? 'Информация о группе' : 'Профиль'}
        </Typography>
        <IconButton size="small" onClick={onClose}
          sx={{ color: theme.textSec, '&:hover': { color: theme.text } }}>
          <Close sx={{ fontSize: 20 }} />
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
                    onClick={() => onViewProfile?.(u.id)}
                    sx={{
                      px: 2, py: 0.9,
                      cursor: 'pointer',
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
                            : m.role === 'admin' ? '⚡ Администратор'
                            : onlineUsers.has(u.id) ? '● в сети' : ''}
                        </Typography>
                      }
                    />
                    {canEdit && u.id !== user?.id && u.id !== chat.ownerId && (
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
      </Box>

      {/* Add member dialog */}
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
                        onClick={() => addMember(u.id)}
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
