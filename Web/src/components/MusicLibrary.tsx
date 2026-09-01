import React, { useState, useEffect } from 'react';
import { Box, Typography, TextField, List, ListItem, ListItemAvatar, Avatar, ListItemText, IconButton, Tabs, Tab, CircularProgress, Menu, MenuItem, Snackbar, Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack } from '@mui/material';
import { GraphicEq, Pause, MusicNote, Search, PlaylistAdd, Edit, Delete, UploadFile, Link as LinkIcon, FolderZip } from '@mui/icons-material';
import { useMusicStore } from '../store/musicStore';
import { usePlaylistStore } from '../store/playlistStore';
import { Track } from '../types';
import PlaylistsPanel from './PlaylistsPanel';

function formatDuration(s: number): string {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function MusicLibrary() {
  const { tracks, currentTrack, isPlaying, loadTracks, search, play, togglePlay, uploadTrack, updateTrack, deleteTrack, importUrl, importZip } = useMusicStore();
  const { playlists, load: loadPlaylists, addTrack, create } = usePlaylistStore();
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [snack, setSnack] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);

  const handleImportUrl = async () => {
    const u = urlValue.trim();
    if (!u) return;
    setUrlBusy(true);
    try {
      const t = await importUrl(u);
      setSnack(`Импортирован: ${t.title}`);
      setUrlOpen(false);
      setUrlValue('');
    } catch (err: any) {
      setSnack(err?.response?.data?.message || 'Не удалось импортировать ссылку');
    } finally { setUrlBusy(false); }
  };

  const handleImportZip = async (file?: File | null) => {
    if (!file || zipBusy) return;
    if (!/\.zip$/i.test(file.name)) { setSnack('Нужен .zip'); return; }
    const fd = new FormData();
    fd.append('file', file);
    setZipBusy(true);
    setUploadProgress(0);
    try {
      const r = await importZip(fd, setUploadProgress);
      setSnack(`Импортировано треков: ${r.imported}${r.skipped.length ? `, пропущено ${r.skipped.length}` : ''}`);
    } catch (err: any) {
      setSnack(err?.response?.data?.message || 'Не удалось распаковать архив');
    } finally { setZipBusy(false); setUploadProgress(0); }
  };

  useEffect(() => {
    setLoading(true);
    loadTracks().finally(() => setLoading(false));
    loadPlaylists();
  }, [loadTracks, loadPlaylists]);

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (q.length > 1) await search(q);
    else await loadTracks();
  };

  const handlePlay = (track: Track) => currentTrack?.id === track.id ? togglePlay() : play(track, tracks);
  const openAddMenu = (e: React.MouseEvent<HTMLElement>, t: Track) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuTrack(t); };
  const closeAddMenu = () => { setMenuAnchor(null); setMenuTrack(null); };
  const openEdit = (track: Track) => { setEditing(track); setTitle(track.title || ''); setArtist(track.artist || ''); setDescription(track.description || ''); setCover(null); setEditOpen(true); };

  const getAudioDuration = (file: File) => new Promise<number>((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });

  const handleUploadFile = async (file?: File | null) => {
    if (!file || uploading) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|aac|m4a|opus|webm)$/i.test(file.name)) {
      setSnack('Выбери аудиофайл');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', file.name.replace(/\.[^.]+$/, ''));
    const duration = await getAudioDuration(file);
    if (duration) fd.append('duration', String(duration));
    setUploading(true);
    setUploadProgress(0);
    try {
      await uploadTrack(fd, setUploadProgress);
      setSnack('Трек добавлен в библиотеку');
    } catch (err: any) {
      console.error('music upload error:', err);
      setSnack(err?.response?.data?.message || err?.message || 'Не удалось загрузить трек');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const saveEdit = async () => {
    if (!editing || !title.trim()) return;
    const fd = new FormData();
    fd.append('title', title.trim());
    fd.append('artist', artist.trim());
    fd.append('description', description.trim());
    if (cover) fd.append('cover', cover);
    setSaving(true);
    try {
      await updateTrack(editing.id, fd);
      setSnack('Трек обновлён');
      setEditOpen(false);
      setCover(null);
    } catch (err: any) {
      console.error('save track edit error:', err);
      setSnack(err?.response?.data?.message || err?.message || 'Не удалось обновить трек');
    }
    finally { setSaving(false); }
  };

  const removeTrack = async (track: Track) => {
    if (!confirm(`Удалить трек «${track.title}»?`)) return;
    try { await deleteTrack(track.id); setSnack('Трек удалён'); }
    catch { setSnack('Не удалось удалить трек'); }
  };

  const handleAddToPlaylist = async (playlistId: string, playlistName: string) => {
    if (!menuTrack) return;
    try { await addTrack(playlistId, menuTrack.id); setSnack(`«${menuTrack.title}» добавлен в «${playlistName}»`); }
    catch { setSnack('Не удалось добавить трек'); }
    closeAddMenu();
  };

  const handleCreateAndAdd = async () => {
    if (!menuTrack) return;
    const name = prompt('Название нового плейлиста:');
    if (!name?.trim()) return closeAddMenu();
    try {
      const created = await create(name.trim());
      if (created?.id) await addTrack(created.id, menuTrack.id);
      await loadPlaylists();
      setSnack(`Плейлист «${name.trim()}» создан`);
    } catch { setSnack('Ошибка создания плейлиста'); }
    closeAddMenu();
  };

  return <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <Box sx={{ px: 2, pt: 2, pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography variant="h6" fontWeight={800}>Музыка</Typography>
        {tab === 0 && (
          <Stack direction="row" spacing={0.5}>
            <IconButton size="small" onClick={() => setUrlOpen(true)} title="Импорт по ссылке"><LinkIcon fontSize="small" /></IconButton>
            <IconButton size="small" component="label" title="Импорт ZIP" disabled={zipBusy}>
              {zipBusy ? <CircularProgress size={16} /> : <FolderZip fontSize="small" />}
              <input hidden type="file" accept=".zip,application/zip" onChange={(e) => { handleImportZip(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </IconButton>
            <Button component="label" size="small" variant="contained" startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <UploadFile />} disabled={uploading}>
              {uploading ? `${uploadProgress || 0}%` : 'Добавить'}
              <input hidden type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.opus,.webm" onChange={(e) => { handleUploadFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </Button>
          </Stack>
        )}
      </Box>
      {tab === 0 && <TextField fullWidth size="small" placeholder="Поиск треков..." value={query} onChange={(e) => handleSearch(e.target.value)} InputProps={{ startAdornment: <Search fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }} />}
    </Box>
    <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2 }}>
      <Tab label="Все треки" />
      <Tab label={`Плейлисты${playlists.length ? ` (${playlists.length})` : ''}`} />
    </Tabs>
    <Box data-tab-panel key={tab} sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
    {tab === 1 ? <Box sx={{ flex: 1, overflow: 'hidden', minWidth: 0 }}><PlaylistsPanel /></Box> : loading ? <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box> : <List data-vera-list sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', px: 1 }}>
      {tracks.map((track) => {
        const isCurrentPlaying = currentTrack?.id === track.id && isPlaying;
        return <ListItem key={track.id} sx={{ '&:hover': { bgcolor: 'action.hover' }, borderRadius: 2, pr: 16, minWidth: 0 }} secondaryAction={<Box sx={{ display: 'flex', gap: 0.25 }}>
          <IconButton size="small" onClick={(e) => openAddMenu(e, track)}><PlaylistAdd fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => openEdit(track)}><Edit fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => removeTrack(track)}><Delete fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => handlePlay(track)}>{isCurrentPlaying ? <Pause fontSize="small" color="primary" /> : <GraphicEq fontSize="small" />}</IconButton>
        </Box>}>
          <ListItemAvatar><Avatar src={track.coverUrl || ''} variant="rounded" sx={{ bgcolor: 'primary.dark' }}><MusicNote fontSize="small" /></Avatar></ListItemAvatar>
          <ListItemText primary={<Typography fontSize={14} fontWeight={currentTrack?.id === track.id ? 800 : 500} color={currentTrack?.id === track.id ? 'primary.light' : 'text.primary'} noWrap>{track.title}</Typography>} secondary={<Typography fontSize={12} color="text.secondary" noWrap>{track.artist || 'Неизвестный'} • {formatDuration(track.duration)}{track.description ? ` • ${track.description}` : ''}</Typography>} />
        </ListItem>;
      })}
      {tracks.length === 0 && <Box textAlign="center" mt={4}><Typography color="text.secondary" fontSize={14}>Треки не найдены</Typography></Box>}
      </List>}
    </Box>
    <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeAddMenu} PaperProps={{ sx: { minWidth: 220, maxHeight: 360 } }}>
      {playlists.map(p => <MenuItem key={p.id} onClick={() => handleAddToPlaylist(p.id, p.name)}><MusicNote fontSize="small" sx={{ mr: 1 }} /> {p.name}<Typography variant="caption" sx={{ ml: 'auto', color: 'text.secondary' }}>{p.tracks?.length || 0}</Typography></MenuItem>)}
      <MenuItem onClick={handleCreateAndAdd} sx={{ borderTop: '1px solid', borderColor: 'divider' }}><PlaylistAdd fontSize="small" sx={{ mr: 1 }} /> Создать новый плейлист</MenuItem>
    </Menu>
    <Dialog open={urlOpen} onClose={() => !urlBusy && setUrlOpen(false)} fullWidth maxWidth="xs">
      <DialogTitle>Импорт по ссылке</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField autoFocus label="URL (YouTube, SoundCloud и т.п.)" value={urlValue} onChange={(e) => setUrlValue(e.target.value)} fullWidth disabled={urlBusy} />
          <Typography variant="caption" color="text.secondary">Ограничение: длительность не более 6 минут. На сервере должны быть установлены yt-dlp и ffmpeg.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setUrlOpen(false)} disabled={urlBusy}>Отмена</Button>
        <Button variant="contained" onClick={handleImportUrl} disabled={urlBusy || !urlValue.trim()}>{urlBusy ? 'Импорт...' : 'Импортировать'}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={editOpen} onClose={() => !saving && setEditOpen(false)} fullWidth maxWidth="xs"><DialogTitle>Редактировать трек</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth /><TextField label="Исполнитель" value={artist} onChange={(e) => setArtist(e.target.value)} fullWidth /><TextField label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline minRows={3} /><Button component="label" variant="outlined" disabled={saving}>Выбрать обложку<input hidden type="file" accept="image/*" onChange={(e) => setCover(e.target.files?.[0] || null)} /></Button>{cover && <Typography variant="caption" color="text.secondary">{cover.name}</Typography>}</Stack></DialogContent><DialogActions><Button onClick={() => setEditOpen(false)} disabled={saving}>Отмена</Button><Button variant="contained" onClick={saveEdit} disabled={saving || !title.trim()}>{saving ? 'Сохранение...' : 'Сохранить'}</Button></DialogActions></Dialog>
    <Snackbar open={!!snack} onClose={() => setSnack('')} autoHideDuration={2200} message={snack} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
  </Box>;
}