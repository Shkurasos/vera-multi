import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Button, List, ListItem, ListItemAvatar, Avatar,
  ListItemText, ListItemButton, IconButton, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, CircularProgress, Menu, MenuItem, Divider,
  Checkbox, Alert, Chip, Stack,
} from '@mui/material';
import {
  GraphicEq, Add, MoreVert, Edit, Delete, MusicNote, ArrowBack,
  DragIndicator, LibraryMusic, Search, QueueMusic, Send,
} from '@mui/icons-material';
import { usePlaylistStore } from '../store/playlistStore';
import { useMusicStore } from '../store/musicStore';
import { useThemeStore } from '../store/themeStore';
import { Playlist, Track } from '../types';
import SendPlaylistDialog from './SendPlaylistDialog';

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return forms[1];
  return forms[2];
}

interface PlaylistsPanelProps {
  initialPlaylistId?: string | null;
}

export default function PlaylistsPanel({ initialPlaylistId }: PlaylistsPanelProps) {
  const { theme } = useThemeStore();
  const {
    playlists, publicPlaylists, loading, load, create, remove, rename,
    removeTrack, addTrack, reorderTracks, getPlaylistTracks, searchPublic, copyPublic,
  } = usePlaylistStore();
  const { tracks: allTracks, play, loadTracks: loadAllTracks } = useMusicStore();

  const [selected, setSelected] = useState<Playlist | null>(null);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [renamePublic, setRenamePublic] = useState(false);
  const [showPublic, setShowPublic] = useState(false);
  const [publicQuery, setPublicQuery] = useState('');

  // Add-tracks dialog
  const [addingTo, setAddingTo] = useState<Playlist | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [addQuery, setAddQuery] = useState('');
  const [addingBusy, setAddingBusy] = useState(false);

  const [renamingPlaylist, setRenamingPlaylist] = useState<Playlist | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameDesc, setRenameDesc] = useState('');

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuPlaylist, setMenuPlaylist] = useState<Playlist | null>(null);
  const [sendTo, setSendTo] = useState<Playlist | null>(null);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!initialPlaylistId || loading) return;
    const p = playlists.find((x) => x.id === initialPlaylistId);
    if (p) setSelected(p);
  }, [initialPlaylistId, playlists, loading]);

  useEffect(() => {
    if (!selected) return;
    const fresh = playlists.find((p) => p.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [playlists, selected]);

  const openCreateDialog = () => {
    setCreateError('');
    setNewName('');
    setNewDesc('');
    setNewPublic(false);
    setCreating(true);
  };

  const closeCreateDialog = () => {
    if (createBusy) return;
    setCreating(false);
    setCreateError('');
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    setCreateError('');
    try {
      const created = await create(name, newDesc.trim() || undefined, newPublic);
      await load();
      setSelected(created);
      setNewName('');
      setNewDesc('');
      setNewPublic(false);
      setCreating(false);
    } catch (e) {
      console.error(e);
      setCreateError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u043b\u0435\u0439\u043b\u0438\u0441\u0442. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435, \u0447\u0442\u043e \u0441\u0435\u0440\u0432\u0435\u0440 \u0437\u0430\u043f\u0443\u0449\u0435\u043d, \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.');
    } finally {
      setCreateBusy(false);
    }
  };

  const handlePlayPlaylist = (p: Playlist) => {
    const queue = getPlaylistTracks(p);
    if (queue.length === 0) return;
    play(queue[0], queue);
  };

  const handleDeletePlaylist = async (p: Playlist) => {
    if (!confirm(`Удалить плейлист "${p.name}"?`)) return;
    await remove(p.id);
    setMenuAnchor(null);
    setMenuPlaylist(null);
  };

  const handleRenameSubmit = async () => {
    if (!renamingPlaylist) return;
    await rename(
      renamingPlaylist.id,
      renameName.trim() || renamingPlaylist.name,
      renameDesc.trim() || undefined,
      renamePublic,
    );
    setRenamingPlaylist(null);
  };

  const openPublicSearch = async () => {
    setShowPublic(true);
    await searchPublic(publicQuery);
  };

  const handleCopyPublic = async (p: Playlist) => {
    await copyPublic(p.id);
    await load();
  };

  // =========== ADD TRACKS DIALOG ===========
  const openAddTracks = async (p: Playlist) => {
    setAddingTo(p);
    setSelectedTrackIds(new Set());
    setAddQuery('');
    const { tracks } = useMusicStore.getState();
    if (tracks.length === 0) await loadAllTracks();
  };

  const closeAddTracks = () => {
    setAddingTo(null);
    setSelectedTrackIds(new Set());
    setAddQuery('');
    setAddingBusy(false);
  };

  const filteredTracks = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return allTracks;
    return allTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q),
    );
  }, [allTracks, addQuery]);

  const toggleTrack = (id: string) => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      filteredTracks.forEach((t) => next.add(t.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedTrackIds(new Set());

  const confirmAddTracks = async () => {
    if (!addingTo || selectedTrackIds.size === 0) return;
    setAddingBusy(true);
    try {
      for (const trackId of Array.from(selectedTrackIds)) {
        await addTrack(addingTo.id, trackId);
        if (useMusicStore.getState().tracks.length === 0) {
          // safety reload
        }
      }
      closeAddTracks();
    } catch (e) {
      console.error('Add tracks error:', e);
    } finally {
      setAddingBusy(false);
    }
  };

  const handleRemoveTrack = async (p: Playlist, t: Track) => {
    await removeTrack(p.id, t.id);
  };

  // DnD reordering
  const dragFromRef = React.useRef<number | null>(null);
  const onDragStart = (i: number) => (e: React.DragEvent) => {
    dragFromRef.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (p: Playlist, i: number) => async (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragFromRef.current;
    dragFromRef.current = null;
    if (from === null || from === i) return;
    const tracks = getPlaylistTracks(p);
    const newOrder = [...tracks];
    const [moved] = newOrder.splice(from, 1);
    newOrder.splice(i, 0, moved);
    await reorderTracks(p.id, newOrder.map((t) => t.id));
  };

  // =========== ВИД ПЛЕЙЛИСТА (треки внутри) ===========
  if (selected) {
    const tracksInPlaylist = getPlaylistTracks(selected);
    const queue = tracksInPlaylist;
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Шапка */}
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton size="small" onClick={() => setSelected(null)} sx={{ color: theme.text }}>
            <ArrowBack />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 18, color: theme.text }} noWrap>
              {selected.name}
            </Typography>
            <Typography sx={{ fontSize: 12, color: theme.textSec }}>
              {tracksInPlaylist.length === 0
                ? 'Пусто'
                : `${tracksInPlaylist.length} ${plural(tracksInPlaylist.length, ['трек', 'трека', 'треков'])}`}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Add />}
            onClick={() => openAddTracks(selected)}
            sx={{
              borderColor: theme.accent + '60', color: theme.accent,
              textTransform: 'none', borderRadius: 2, minWidth: 0,
              '&:hover': { borderColor: theme.accent, bgcolor: theme.accent + '10' },
            }}
          >
            Треки
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<GraphicEq />}
            onClick={() => handlePlayPlaylist(selected)}
            disabled={tracksInPlaylist.length === 0}
            sx={{
              bgcolor: theme.accent, color: '#fff',
              textTransform: 'none', borderRadius: 2, minWidth: 0,
              '&:hover': { bgcolor: theme.accent + 'cc' },
              '&.Mui-disabled': { bgcolor: theme.bgInput, color: theme.textSec },
            }}
          >
            Играть
          </Button>
        </Box>
        <Divider sx={{ borderColor: theme.border }} />

        {tracksInPlaylist.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 3, textAlign: 'center' }}>
            <QueueMusic sx={{ fontSize: 56, color: theme.textSec, mb: 1.5, opacity: 0.6 }} />
            <Typography sx={{ color: theme.text, fontSize: 16, fontWeight: 600, mb: 0.5 }}>
              Плейлист пуст
            </Typography>
            <Typography sx={{ color: theme.textSec, fontSize: 13, mb: 2.5 }}>
              Добавьте треки из своей музыкальной библиотеки — нажмите «Треки».
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => openAddTracks(selected)}
              sx={{
                bgcolor: theme.accent, color: '#fff',
                textTransform: 'none', borderRadius: 2,
                '&:hover': { bgcolor: theme.accent + 'cc' },
              }}
            >
              Добавить треки
            </Button>
          </Box>
        ) : (
          <>
            <List data-vera-list sx={{
              flex: 1, overflowY: 'auto', px: 1, py: 0.5,
              '&::-webkit-scrollbar': { width: 4 },
              '&::-webkit-scrollbar-thumb': { bgcolor: theme.accent + '30', borderRadius: 4 },
            }}>
              {tracksInPlaylist.map((track, idx) => (
                <ListItem
                  key={track.id}
                  draggable
                  onDragStart={onDragStart(idx)}
                  onDragOver={onDragOver(idx)}
                  onDrop={onDrop(selected, idx)}
                  sx={{
                    borderRadius: 2, mb: 0.25, cursor: 'pointer',
                    '&:hover': { bgcolor: theme.bgHover },
                  }}
                  onClick={() => play(track, queue)}
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      <DragIndicator sx={{ color: theme.textSec, cursor: 'grab', fontSize: 18 }} />
                      <Typography variant="caption" sx={{ color: theme.textSec, minWidth: 40, textAlign: 'right' }}>
                        {formatDuration(track.duration)}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); handleRemoveTrack(selected, track); }}
                      >
                        <Delete sx={{ fontSize: 18, color: theme.textSec, '&:hover': { color: '#f44336' } }} />
                      </IconButton>
                    </Box>
                  }
                >
                  <ListItemAvatar>
                    <Avatar src={track.coverUrl || ''} variant="rounded" sx={{ bgcolor: theme.bgInput, width: 40, height: 40 }}>
                      <MusicNote sx={{ color: theme.textSec }} />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: 14, color: theme.text }} noWrap>
                        {track.title}
                      </Typography>
                    }
                    secondary={
                      <Typography sx={{ fontSize: 12, color: theme.textSec }} noWrap>
                        {track.artist || 'Неизвестный'}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
            </List>
            <Divider sx={{ borderColor: theme.border }} />
            <Box sx={{ p: 1.25, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: theme.textSec }}>
                💡 Перетаскивайте треки мышью, чтобы изменить порядок
              </Typography>
            </Box>
          </>
        )}

        {/* =========== DIALOG: ADD TRACKS =========== */}
        <Dialog
          open={Boolean(addingTo)}
          onClose={closeAddTracks}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: { bgcolor: theme.bg, borderRadius: 3 } }}
        >
          <DialogTitle sx={{ color: theme.text, pt: 2.5, pb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Add sx={{ color: theme.accent }} />
              Добавить треки в «{addingTo?.name}»
            </Box>
          </DialogTitle>

          {allTracks.length === 0 ? (
            <>
              <DialogContent>
                <Alert severity="info" sx={{ borderRadius: 2 }}>
                  У вас пока нет загруженных треков. Перейдите на вкладку <b>Музыка</b> и
                  нажмите <Add sx={{ fontSize: 14, mb: '-2px' }} /> чтобы загрузить аудиофайлы.
                </Alert>
              </DialogContent>
              <DialogActions sx={{ px: 2.5, pb: 2 }}>
                <Button onClick={closeAddTracks} sx={{ color: theme.textSec, textTransform: 'none' }}>
                  Закрыть
                </Button>
              </DialogActions>
            </>
          ) : (
            <>
              <DialogContent sx={{ pt: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Поиск по названию или исполнителю..."
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  sx={{
                    mb: 1.5,
                    '& .MuiOutlinedInput-root': {
                      bgcolor: theme.bgInput, borderRadius: 2, color: theme.text,
                      '& fieldset': { borderColor: theme.border },
                      '&:hover fieldset': { borderColor: theme.accent + '60' },
                      '&.Mui-focused fieldset': { borderColor: theme.accent },
                    },
                    '& input::placeholder': { color: theme.textSec },
                  }}
                  InputProps={{ startAdornment: <Search sx={{ mr: 1, color: theme.textSec, fontSize: 18 }} /> }}
                />

                <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip
                    label={`Выбрано: ${selectedTrackIds.size}`}
                    size="small"
                    sx={{ bgcolor: theme.accent + '20', color: theme.accent, fontWeight: 600 }}
                  />
                  <Chip
                    label="Выбрать все"
                    size="small"
                    clickable
                    onClick={selectAllVisible}
                    sx={{ bgcolor: theme.bgInput, color: theme.textSec, '&:hover': { bgcolor: theme.bgHover, color: theme.text } }}
                  />
                  <Chip
                    label="Снять все"
                    size="small"
                    clickable
                    onClick={clearSelection}
                    sx={{ bgcolor: theme.bgInput, color: theme.textSec, '&:hover': { bgcolor: theme.bgHover, color: theme.text } }}
                  />
                </Stack>

                <List dense sx={{
                  maxHeight: 380, overflowY: 'auto',
                  '&::-webkit-scrollbar': { width: 4 },
                  '&::-webkit-scrollbar-thumb': { bgcolor: theme.accent + '30', borderRadius: 4 },
                }}>
                  {filteredTracks.length === 0 && (
                    <Box sx={{ p: 3, textAlign: 'center' }}>
                      <Typography sx={{ color: theme.textSec, fontSize: 14 }}>
                        Ничего не найдено
                      </Typography>
                    </Box>
                  )}
                  {filteredTracks.map((track) => {
                    const isSelected = selectedTrackIds.has(track.id);
                    return (
                      <ListItemButton
                        key={track.id}
                        onClick={() => toggleTrack(track.id)}
                        sx={{
                          borderRadius: 2, mb: 0.25, py: 0.5,
                          bgcolor: isSelected ? theme.accent + '18' : 'transparent',
                          '&:hover': { bgcolor: isSelected ? theme.accent + '22' : theme.bgHover },
                        }}
                      >
                        <Checkbox
                          edge="start"
                          checked={isSelected}
                          tabIndex={-1}
                          sx={{ color: theme.textSec, '&.Mui-checked': { color: theme.accent }, p: 0.5 }}
                        />
                        <ListItemAvatar>
                          <Avatar src={track.coverUrl || ''} variant="rounded" sx={{ bgcolor: theme.bgInput, width: 36, height: 36 }}>
                            <MusicNote sx={{ color: theme.textSec, fontSize: 18 }} />
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Typography sx={{ fontSize: 14, color: theme.text }} noWrap>
                              {track.title}
                            </Typography>
                          }
                          secondary={
                            <Typography sx={{ fontSize: 12, color: theme.textSec }} noWrap>
                              {track.artist || 'Неизвестный'} • {formatDuration(track.duration)}
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              </DialogContent>
              <DialogActions sx={{ px: 2.5, pb: 2, gap: 1 }}>
                <Button
                  onClick={closeAddTracks}
                  sx={{ color: theme.textSec, textTransform: 'none' }}
                >
                  Отмена
                </Button>
                <Button
                  variant="contained"
                  disabled={selectedTrackIds.size === 0 || addingBusy}
                  onClick={confirmAddTracks}
                  sx={{
                    bgcolor: theme.accent, color: '#fff',
                    textTransform: 'none', borderRadius: 2,
                    '&:hover': { bgcolor: theme.accent + 'cc' },
                    '&.Mui-disabled': { bgcolor: theme.bgInput, color: theme.textSec },
                  }}
                >
                  {addingBusy
                    ? <CircularProgress size={18} sx={{ color: '#fff' }} />
                    : `Добавить${selectedTrackIds.size > 0 ? ` (${selectedTrackIds.size})` : ''}`
                  }
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      </Box>
    );
  }

  // =========== СПИСОК ПЛЕЙЛИСТОВ ===========
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 19, color: theme.text, flex: 1 }}>
          Плейлисты
        </Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={<Add />}
          onClick={openCreateDialog}
          sx={{
            bgcolor: theme.accent, color: '#fff',
            textTransform: 'none', borderRadius: 2,
            '&:hover': { bgcolor: theme.accent + 'cc' },
          }}
        >
          Создать
        </Button>
      </Box>
      <Divider sx={{ borderColor: theme.border }} />

      {loading ? (
        <Box display="flex" justifyContent="center" mt={4}>
          <CircularProgress sx={{ color: theme.accent }} />
        </Box>
      ) : playlists.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 3, textAlign: 'center' }}>
          <LibraryMusic sx={{ fontSize: 64, color: theme.textSec, mb: 2, opacity: 0.6 }} />
          <Typography sx={{ color: theme.text, fontSize: 17, fontWeight: 600, mb: 0.5 }}>
            У вас пока нет плейлистов
          </Typography>
          <Typography sx={{ color: theme.textSec, fontSize: 13, mb: 2.5, maxWidth: 320 }}>
            Создайте свой первый плейлист, чтобы хранить любимые треки в одном месте.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={openCreateDialog}
            sx={{
              bgcolor: theme.accent, color: '#fff',
              textTransform: 'none', borderRadius: 2,
              '&:hover': { bgcolor: theme.accent + 'cc' },
            }}
          >
            Создать первый
          </Button>
        </Box>
      ) : (
        <>
          <List data-vera-list sx={{
            flex: 1, overflowY: 'auto', px: 1, pt: 1,
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-thumb': { bgcolor: theme.accent + '30', borderRadius: 4 },
          }}>
            {playlists.map((p) => {
              const trackCount = (p.tracks || []).length;
              return (
                <ListItem
                  key={p.id}
                  sx={{
                    borderRadius: 2, mb: 0.5, cursor: 'pointer',
                    bgcolor: theme.bgInput,
                    '&:hover': { bgcolor: theme.bgHover },
                  }}
                  onClick={() => setSelected(p)}
                  secondaryAction={
                    <IconButton edge="end" size="small" onClick={(e) => {
                      e.stopPropagation();
                      setMenuAnchor(e.currentTarget);
                      setMenuPlaylist(p);
                    }}>
                      <MoreVert sx={{ color: theme.textSec }} />
                    </IconButton>
                  }
                >
                  <ListItemAvatar>
                    <Avatar variant="rounded" sx={{ bgcolor: theme.accent + '20', width: 48, height: 48, color: theme.accent }}>
                      {p.coverUrl
                        ? <img src={p.coverUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <MusicNote />}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: 15, fontWeight: 600, color: theme.text }} noWrap>
                        {p.name}
                        {p.isPublic && <Chip label="public" size="small" sx={{ ml: 1, height: 18, fontSize: 10, bgcolor: theme.accent + '22', color: theme.accent }} />}
                      </Typography>
                    }
                    secondary={
                      <Typography sx={{ fontSize: 12, color: theme.textSec }} noWrap>
                        {trackCount === 0
                          ? 'Пусто'
                          : p.description
                            ? `${trackCount} ${plural(trackCount, ['трек', 'трека', 'треков'])} • ${p.description}`
                            : `${trackCount} ${plural(trackCount, ['трек', 'трека', 'треков'])}`
                        }
                      </Typography>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
          <Box sx={{ p: 1.25, textAlign: 'center', borderTop: `1px solid ${theme.border}` }}>
            <Typography variant="caption" sx={{ color: theme.textSec }}>
              💡 Нажмите на плейлист, чтобы открыть треки. 3 точки — меню действий.
            </Typography>
          </Box>
        </>
      )}

      {/* =========== Меню действий (3 точки) =========== */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => { setMenuAnchor(null); setMenuPlaylist(null); }}
        PaperProps={{ sx: { bgcolor: theme.bgHeader, borderRadius: 2 } }}
      >
        <MenuItem onClick={() => {
          if (!menuPlaylist) return;
          setRenamingPlaylist(menuPlaylist);
          setRenameName(menuPlaylist.name);
          setRenameDesc(menuPlaylist.description || '');
          setRenamePublic(!!menuPlaylist.isPublic);
          setMenuAnchor(null);
          setMenuPlaylist(null);
        }}>
          <Edit fontSize="small" sx={{ mr: 1 }} /> Переименовать
        </MenuItem>
        <MenuItem onClick={() => {
          if (!menuPlaylist) return;
          setSendTo(menuPlaylist);
          setMenuAnchor(null);
          setMenuPlaylist(null);
        }}>
          <Send fontSize="small" sx={{ mr: 1 }} /> Отправить в чат
        </MenuItem>
        <MenuItem onClick={() => menuPlaylist && handleDeletePlaylist(menuPlaylist)} sx={{ color: '#f44336' }}>
          <Delete fontSize="small" sx={{ mr: 1 }} /> Удалить
        </MenuItem>
      </Menu>

      <SendPlaylistDialog open={!!sendTo} playlist={sendTo} onClose={() => setSendTo(null)} />

      {/* =========== DIALOG: Создание =========== */}
      <Dialog
        open={creating}
        onClose={closeCreateDialog}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { bgcolor: theme.bg, borderRadius: 3 } }}
      >
        <DialogTitle sx={{ color: theme.text, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Add sx={{ color: theme.accent }} />
          Новый плейлист
        </DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 1 }}>{createError}</Alert>}
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Название"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            inputProps={{ maxLength: 80 }}
            sx={{
              '& .MuiOutlinedInput-root': { bgcolor: theme.bgInput, color: theme.text },
              '& label': { color: theme.textSec },
            }}
          />
          <TextField
            fullWidth
            margin="dense"
            label="Описание (необязательно)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            multiline
            rows={2}
            sx={{
              '& .MuiOutlinedInput-root': { bgcolor: theme.bgInput, color: theme.text },
              '& label': { color: theme.textSec },
            }}
          />
          <Typography variant="caption" sx={{ color: theme.textSec, mt: 1, display: 'block' }}>
            Треки можно будет добавить после создания.
          </Typography>
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1, color: theme.text }}>
            <Checkbox checked={newPublic} onChange={(e) => setNewPublic(e.target.checked)} sx={{ color: theme.textSec, '&.Mui-checked': { color: theme.accent } }} />
            <Typography sx={{ fontSize: 13 }}>Публичный плейлист — другие смогут найти и скопировать его</Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, gap: 1 }}>
          <Button onClick={closeCreateDialog} disabled={createBusy} sx={{ color: theme.textSec, textTransform: 'none' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            disabled={createBusy || !newName.trim()}
            onClick={handleCreate}
            sx={{
              bgcolor: theme.accent, color: '#fff',
              textTransform: 'none', borderRadius: 2,
              '&:hover': { bgcolor: theme.accent + 'cc' },
              '&.Mui-disabled': { bgcolor: theme.bgInput, color: theme.textSec },
            }}
          >
            {createBusy ? '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435...' : '\u0421\u043e\u0437\u0434\u0430\u0442\u044c'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* =========== DIALOG: Переименование =========== */}
      <Dialog
        open={Boolean(renamingPlaylist)}
        onClose={() => setRenamingPlaylist(null)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { bgcolor: theme.bg, borderRadius: 3 } }}
      >
        <DialogTitle sx={{ color: theme.text, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Edit sx={{ color: theme.accent }} />
          Изменить плейлист
        </DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 1 }}>{createError}</Alert>}
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Название"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            inputProps={{ maxLength: 80 }}
            sx={{
              '& .MuiOutlinedInput-root': { bgcolor: theme.bgInput, color: theme.text },
              '& label': { color: theme.textSec },
            }}
          />
          <TextField
            fullWidth
            margin="dense"
            label="Описание"
            value={renameDesc}
            onChange={(e) => setRenameDesc(e.target.value)}
            multiline
            rows={2}
            sx={{
              '& .MuiOutlinedInput-root': { bgcolor: theme.bgInput, color: theme.text },
              '& label': { color: theme.textSec },
            }}
          />
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1, color: theme.text }}>
            <Checkbox checked={renamePublic} onChange={(e) => setRenamePublic(e.target.checked)} sx={{ color: theme.textSec, '&.Mui-checked': { color: theme.accent } }} />
            <Typography sx={{ fontSize: 13 }}>Публичный плейлист</Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, gap: 1 }}>
          <Button onClick={() => setRenamingPlaylist(null)} sx={{ color: theme.textSec, textTransform: 'none' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleRenameSubmit}
            sx={{
              bgcolor: theme.accent, color: '#fff',
              textTransform: 'none', borderRadius: 2,
              '&:hover': { bgcolor: theme.accent + 'cc' },
            }}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {/* =========== DIALOG: Публичные плейлисты =========== */}
      <Dialog open={showPublic} onClose={() => setShowPublic(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: theme.bg, borderRadius: 3 } }}>
        <DialogTitle sx={{ color: theme.text, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Search sx={{ color: theme.accent }} /> Публичные плейлисты
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            placeholder="Поиск по названию"
            value={publicQuery}
            onChange={(e) => setPublicQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchPublic(publicQuery); }}
            sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { bgcolor: theme.bgInput, color: theme.text } }}
          />
          <Button size="small" onClick={() => searchPublic(publicQuery)} sx={{ color: theme.accent, textTransform: 'none', mb: 1 }}>Найти</Button>
          <List sx={{ maxHeight: 360, overflowY: 'auto' }}>
            {publicPlaylists.map((p) => {
              const count = (p.tracks || []).length;
              return (
                <ListItem key={p.id} sx={{ bgcolor: theme.bgInput, borderRadius: 2, mb: 1 }} secondaryAction={
                  <Button size="small" variant="contained" onClick={() => handleCopyPublic(p)} sx={{ bgcolor: theme.accent, textTransform: 'none', borderRadius: 2 }}>Скачать</Button>
                }>
                  <ListItemAvatar><Avatar variant="rounded" sx={{ bgcolor: theme.accent + '20', color: theme.accent }}><LibraryMusic /></Avatar></ListItemAvatar>
                  <ListItemText
                    primary={<Typography sx={{ color: theme.text, fontWeight: 700 }} noWrap>{p.name}</Typography>}
                    secondary={<Typography sx={{ color: theme.textSec, fontSize: 12 }} noWrap>{count} {plural(count, ['трек', 'трека', 'треков'])}{p.user?.username ? ` • @${p.user.username}` : ''}</Typography>}
                  />
                </ListItem>
              );
            })}
            {publicPlaylists.length === 0 && <Typography sx={{ color: theme.textSec, textAlign: 'center', py: 3 }}>Публичные плейлисты не найдены</Typography>}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button onClick={() => setShowPublic(false)} sx={{ color: theme.textSec, textTransform: 'none' }}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
