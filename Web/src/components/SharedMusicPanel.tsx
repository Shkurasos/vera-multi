/**
 * Общая библиотека: чужое музыкальное имущество, альбомы и форма публикации.
 *
 * Своё музыкальное здесь тоже: автор выкладывает трек или альбом всем, поэтому
 * публикация живёт рядом с просмотром. Форма требует обложку, название, жанр и
 * исполнителя — ровно то, без чего общий список превратился бы в «Без названия».
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, TextField, Button, List, ListItem, ListItemAvatar, Avatar, ListItemText,
  IconButton, CircularProgress, LinearProgress, MenuItem, ListSubheader, InputAdornment, Stack, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, Tooltip, Checkbox, FormControlLabel,
} from '@mui/material';
import {
  Search, Pause, Download, Publish, Unpublished, Add, Delete, MusicNote,
} from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useMusicStore } from '../store/musicStore';
import { useSharedMusicStore, SHARED_SORTS, type SharedSort } from '../store/sharedMusicStore';
import { musicApi } from '../services/api';
import { normalizeKey } from '../utils/musicGenres';
import type { MusicAlbum, Track } from '../types';

function formatDuration(s: number): string {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Кто автор: сервер отдаёт `uploadedBy`, а у сохранённого копией его нет. */
function authorName(track: Track): string {
  const u = track.uploadedBy;
  if (!u) return '';
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '';
}

export default function SharedMusicPanel() {
  const theme = useThemeStore((s) => s.theme);
  const user = useAuthStore((s) => s.user);
  const {
    tracks, albums, genres, genreGroups, loading, saving, query, sort,
    setQuery, setSort, load, saveTrack, saveAlbum, unpublishTrack, unpublishAlbum, deleteAlbum,
  } = useSharedMusicStore();
  const currentTrack = useMusicStore((s) => s.currentTrack);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const play = useMusicStore((s) => s.play);
  const togglePlay = useMusicStore((s) => s.togglePlay);
  const [publishFor, setPublishFor] = useState<Track | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);

  useEffect(() => { void load(); }, [load]);

  const toggle = (track: Track) => {
    // Общий список играется сам по себе, а не от личной библиотеки.
    if (currentTrack?.id === track.id) togglePlay();
    else play(track, tracks);
  };

  const quickGenres = genres.slice(0, 6);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ px: { xs: 1, sm: 1.5 }, pt: 1, pb: 1 }}>
        <Box sx={{
          p: { xs: 1.25, sm: 1.5 }, mb: 1.25, borderRadius: 2.5,
          color: theme.text, border: `1px solid ${theme.border}`,
          background: `linear-gradient(135deg, ${theme.accent}20 0%, ${theme.bgInput} 62%)`,
          boxShadow: `0 10px 28px ${theme.accent}12`,
        }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box sx={{
              width: 44, height: 44, borderRadius: 1.75, flexShrink: 0,
              display: 'grid', placeItems: 'center', color: theme.accent,
              bgcolor: theme.accent + '22', border: `1px solid ${theme.accent}40`,
            }}>
              <MusicNote />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: { xs: 16, sm: 18 }, fontWeight: 800, lineHeight: 1.15 }}>
                Общая музыка
              </Typography>
              <Typography sx={{ color: theme.textSec, fontSize: 12, mt: 0.35 }} noWrap>
                Треки и альбомы, которыми поделились пользователи
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', sm: 'flex' } }}>
              <Chip size="small" label={`${tracks.length} треков`} sx={{ bgcolor: theme.bgHover, color: theme.textSec }} />
              <Chip size="small" label={`${albums.length} альбомов`} sx={{ bgcolor: theme.bgHover, color: theme.textSec }} />
            </Stack>
          </Stack>
          {currentTrack && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1, mt: 1.25, px: 1, py: 0.75,
              borderRadius: 1.5, bgcolor: theme.bg + '80', border: `1px solid ${theme.border}`,
            }}>
              <Box sx={{ width: 28, height: 28, borderRadius: 1, overflow: 'hidden', flexShrink: 0,
                bgcolor: theme.accent + '20', backgroundImage: currentTrack.coverUrl ? `url(${currentTrack.coverUrl})` : undefined,
                backgroundSize: 'cover', backgroundPosition: 'center', display: 'grid', placeItems: 'center' }}>
                {!currentTrack.coverUrl && <MusicNote sx={{ fontSize: 16, color: theme.accent }} />}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ color: theme.textSec, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Сейчас играет
                </Typography>
                <Typography sx={{ color: theme.text, fontSize: 12, fontWeight: 700 }} noWrap>
                  {currentTrack.title} · {currentTrack.artist || 'Без исполнителя'}
                </Typography>
              </Box>
              <Button size="small" onClick={() => toggle(currentTrack)}
                sx={{ minWidth: 0, px: 1, color: theme.accent, textTransform: 'none' }}>
                {isPlaying ? 'Пауза' : 'Продолжить'}
              </Button>
            </Box>
          )}
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField
            size="small" fullWidth value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по общей библиотеке..."
            InputProps={{ startAdornment: <Search fontSize="small" sx={{ mr: 1, color: theme.textSec }} /> }}
          />
          <TextField
            size="small" select value={sort} onChange={(e) => setSort(e.target.value as SharedSort)}
            sx={{ minWidth: { sm: 175 }, flexShrink: 0 }}
          >
            {SHARED_SORTS.map((s) => <MenuItem key={s.key} value={s.key}>{s.label}</MenuItem>)}
          </TextField>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ mt: 0.85 }}>
          <Button fullWidth size="small" variant="outlined" startIcon={<Add />} onClick={() => setTrackOpen(true)}
            sx={{ textTransform: 'none', borderColor: theme.accent, color: theme.accent, justifyContent: 'center' }}>
            Добавить свой трек
          </Button>
          <Button fullWidth size="small" variant="outlined" startIcon={<Add />} onClick={() => setAlbumOpen(true)}
            sx={{ textTransform: 'none', borderColor: theme.accent, color: theme.accent, justifyContent: 'center' }}>
            Собрать альбом
          </Button>
          {query && (
            <Button size="small" onClick={() => setQuery('')} sx={{ color: theme.textSec, textTransform: 'none', whiteSpace: 'nowrap' }}>
              Сбросить
            </Button>
          )}
        </Stack>
        {!!quickGenres.length && (
          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
            <Typography sx={{ color: theme.textSec, fontSize: 11, alignSelf: 'center', mr: 0.2 }}>Жанры:</Typography>
            {quickGenres.map((genre) => (
              <Chip key={genre} size="small" clickable label={genre} onClick={() => setQuery(query === genre ? '' : genre)}
                sx={{ height: 24, fontSize: 11, color: query === genre ? theme.accent : theme.textSec,
                  borderColor: query === genre ? theme.accent : theme.border,
                  bgcolor: query === genre ? theme.accent + '18' : 'transparent' }} variant="outlined" />
            ))}
          </Stack>
        )}
        {loading && (tracks.length > 0 || albums.length > 0) && (
          <LinearProgress sx={{ mt: 1, borderRadius: 2, bgcolor: theme.border, '& .MuiLinearProgress-bar': { bgcolor: theme.accent } }} />
        )}
      </Box>
      <SharedBody
        tracks={tracks} albums={albums} loading={loading} saving={saving} userId={user?.id} query={query}
        currentTrack={currentTrack} isPlaying={isPlaying} onToggle={toggle}
        onPublish={setPublishFor} onUnpublish={unpublishTrack}
        onSaveTrack={saveTrack} onSaveAlbum={saveAlbum}
        onUnpublishAlbum={unpublishAlbum} onDeleteAlbum={deleteAlbum}
      />
      <PublishDialog track={publishFor} genres={genres} genreGroups={genreGroups} onClose={() => setPublishFor(null)} />
      <AddTrackDialog open={trackOpen} genres={genres} genreGroups={genreGroups}
        onClose={() => { setTrackOpen(false); void load(); }} />
      <AlbumDialog open={albumOpen} genres={genres} genreGroups={genreGroups} onClose={() => { setAlbumOpen(false); void load(); }} />
    </Box>
  );
}

/** Список общих треков и альбомов. */
function SharedBody(p: {
  tracks: Track[]; albums: MusicAlbum[]; loading: boolean;
  saving: Record<string, boolean>; userId?: string; query: string;
  currentTrack: Track | null; isPlaying: boolean;
  onToggle: (t: Track) => void;
  onPublish: (t: Track) => void;
  onUnpublish: (id: string) => void;
  onSaveTrack: (id: string) => void;
  onSaveAlbum: (id: string) => void;
  onUnpublishAlbum: (id: string) => void;
  onDeleteAlbum: (id: string) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  if (p.loading && !p.tracks.length && !p.albums.length) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mt: 4, color: theme.textSec }}>
        <CircularProgress size={28} sx={{ color: theme.accent }} />
        <Typography sx={{ fontSize: 12 }}>Загружаем общую библиотеку…</Typography>
      </Box>
    );
  }
  const hasResults = p.tracks.length > 0 || p.albums.length > 0;
  return (
    <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {!!p.albums.length && (
        <>
          <SectionTitle text={`Альбомы (${p.albums.length})`} />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5, px: 1, pb: 1 }}>
            {p.albums.map((a) => (
              <AlbumCard
                key={a.id} album={a} busy={!!p.saving[a.id]}
                isMine={a.ownerId === p.userId}
                onSave={() => p.onSaveAlbum(a.id)}
                onUnpublish={() => p.onUnpublishAlbum(a.id)}
                onDelete={() => p.onDeleteAlbum(a.id)}
              />
            ))}
          </Box>
        </>
      )}
      <SectionTitle text={`Треки (${p.tracks.length})`} />
      <List data-vera-list sx={{ px: 1, pb: 2 }}>
        {p.tracks.map((track) => (
          <ListItem key={track.id} sx={{
            '&:hover': { bgcolor: theme.bgHover }, borderRadius: 2, pr: { xs: 0.5, sm: 1 },
            bgcolor: p.currentTrack?.id === track.id ? theme.accent + '10' : 'transparent',
            border: p.currentTrack?.id === track.id ? `1px solid ${theme.accent}35` : '1px solid transparent',
            mb: 0.25,
          }}>
            <ListItemAvatar sx={{ cursor: 'pointer', minWidth: { xs: 48, sm: 56 } }} onClick={() => p.onToggle(track)}>
              <Avatar src={track.coverUrl || undefined} sx={{ bgcolor: theme.accent + '30', color: theme.accent, width: 40, height: 40 }}>
                {p.currentTrack?.id === track.id && p.isPlaying
                  ? <Pause sx={{ fontSize: 18 }} />
                  : track.coverUrl ? null : <MusicNote />}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={track.title}
              secondary={
                <Box component="span" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>{[track.artist, track.album].filter(Boolean).join(' · ') || 'Без исполнителя'}</span>
                  {track.genre && <Chip size="small" label={track.genre} sx={{ height: 16, fontSize: 10 }} />}
                  {!!track.playsCount && <span>{track.playsCount} прослушиваний</span>}
                  {authorName(track) && <span>· {authorName(track)}</span>}
                  <span>{formatDuration(track.duration)}</span>
                </Box>
              }
               sx={{ minWidth: 0, mr: 0.5, '& .MuiListItemText-primary': { color: theme.text, fontSize: 13, fontWeight: p.currentTrack?.id === track.id ? 700 : 500 } }}
              onClick={() => p.onToggle(track)}
            />
            {track.uploadedById === p.userId ? (
              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                <Tooltip title="Выложить всем">
                  <IconButton size="small" onClick={() => p.onPublish(track)} sx={{ color: theme.textSec }}>
                    <Publish fontSize="small" />
                  </IconButton>
                </Tooltip>
                {track.isPublic && (
                  <Tooltip title="Снять с публикации">
                    <IconButton size="small" onClick={() => p.onUnpublish(track.id)} sx={{ color: theme.textSec }}>
                      <Unpublished fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            ) : (
              <Button size="small" disabled={!!p.saving[track.id]} onClick={() => p.onSaveTrack(track.id)}
                startIcon={p.saving[track.id] ? <CircularProgress size={14} /> : <Download fontSize="small" />}
                sx={{ color: theme.accent, textTransform: 'none', flexShrink: 0, minWidth: { xs: 0, sm: 'auto' }, px: { xs: 0.75, sm: 1 } }}>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Сохранить</Box>
              </Button>
            )}
          </ListItem>
        ))}
        {!hasResults && (
          <Box sx={{ mx: 1, mt: 1, p: 2.5, textAlign: 'center', border: `1px dashed ${theme.border}`, borderRadius: 2.5, color: theme.textSec }}>
            <MusicNote sx={{ fontSize: 30, color: theme.accent, mb: 0.5 }} />
            <Typography sx={{ color: theme.text, fontSize: 14, fontWeight: 700 }}>
              {p.query ? 'Ничего не нашли' : 'Общая библиотека пока пуста'}
            </Typography>
            <Typography sx={{ color: theme.textSec, fontSize: 12, mt: 0.5 }}>
              {p.query ? 'Попробуйте другое название, исполнителя или жанр.' : 'Опубликуйте свой трек или соберите первый альбом.'}
            </Typography>
          </Box>
        )}
      </List>
    </Box>
  );
}

/** Плитка альбома: обложка, метаданные и «сохранить себе». */
function AlbumCard(p: {
  album: MusicAlbum; busy: boolean; isMine: boolean;
  onSave: () => void; onUnpublish: () => void; onDelete: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const a = p.album;
  return (
    <Box sx={{
      border: `1px solid ${theme.border}`, borderRadius: 2, overflow: 'hidden',
      bgcolor: theme.bgInput, display: 'flex', flexDirection: 'column',
    }}>
      <Box sx={{
        aspectRatio: '1 / 1', bgcolor: theme.bgHover,
        backgroundImage: a.coverUrl ? `url(${a.coverUrl})` : undefined,
        backgroundSize: 'cover', backgroundPosition: 'center',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {!a.coverUrl && <MusicNote sx={{ fontSize: 32, color: theme.textSec }} />}
      </Box>
      <Box sx={{ p: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.text }} noWrap>{a.title}</Typography>
        <Typography sx={{ fontSize: 11, color: theme.textSec }} noWrap>
          {[a.artist, a.genre].filter(Boolean).join(' · ')}
        </Typography>
        <Typography sx={{ fontSize: 11, color: theme.textSec }}>
          треков: {a.trackCount ?? a.tracks?.length ?? 0}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} alignItems="center">
          {p.isMine ? (
            <>
              <Button size="small" disabled={!a.isPublic} onClick={p.onUnpublish}
                sx={{ color: theme.textSec, textTransform: 'none' }}>
                {a.isPublic ? 'Скрыть' : 'Свой'}
              </Button>
              <IconButton size="small" onClick={p.onDelete} aria-label="Удалить альбом" sx={{ color: theme.textSec }}>
                <Delete fontSize="small" />
              </IconButton>
            </>
          ) : (
            <Button size="small" disabled={p.busy} onClick={p.onSave}
              startIcon={p.busy ? <CircularProgress size={13} /> : <Download fontSize="small" />}
              sx={{ color: theme.accent, textTransform: 'none' }}>
              Сохранить
            </Button>
          )}
        </Stack>
      </Box>
    </Box>
  );
}

/** Загрузка обложки на сервер и превью. */
function useCoverPicker() {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pick = async (file?: File | null) => {
    if (!file) return;
    setCoverFile(file);
    // Превью показываем сразу, загрузка — в фоне: пользователь не должен ждать.
    setCoverUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('cover', file);
      const res = await musicApi.uploadCover(fd);
      setCoverUrl(res.data?.coverUrl || null);
    } catch (e: any) {
      setCoverUrl(null);
      alert(e?.response?.data?.message || 'Не удалось загрузить обложку');
    } finally {
      setUploading(false);
    }
  };

  return { coverUrl, coverFile, uploading, fileRef, pick, setCoverUrl };
}

/** Поле обложки: превью, кнопка выбора и статус загрузки. */
function CoverField({ coverUrl, uploading, fileRef, onPick }: {
  coverUrl: string | null; uploading: boolean;
  fileRef: React.RefObject<HTMLInputElement>;
  onPick: (f?: File | null) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
      <Box sx={{
        width: 88, height: 88, borderRadius: 1.5, overflow: 'hidden', flexShrink: 0,
        border: `1px solid ${theme.border}`, bgcolor: theme.bgHover,
        backgroundImage: coverUrl ? `url(${coverUrl})` : undefined,
        backgroundSize: 'cover', backgroundPosition: 'center',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {!coverUrl && (uploading ? <CircularProgress size={20} /> : <MusicNote sx={{ color: theme.textSec }} />)}
      </Box>
      <Button component="label" variant="outlined" disabled={uploading}
        sx={{ borderColor: theme.accent, color: theme.accent }}>
        {uploading ? 'Загрузка...' : coverUrl ? 'Сменить обложку' : 'Выбрать обложку'}
        <input hidden type="file" accept="image/*" ref={fileRef}
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
      </Button>
      {!coverUrl && <Typography sx={{ fontSize: 11, color: theme.textSec }}>обложка обязательна</Typography>}
    </Box>
  );
}

function SectionTitle({ text }: { text: string }) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Typography sx={{ fontSize: 12, color: theme.textSec, px: 2, pt: 1.5, pb: 0.5, textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {text}
    </Typography>
  );
}
/**
 * Выбор жанра из закрытого списка.
 *
 * Свободный ввод здесь ломал бы главное свойство общей библиотеки: «рок»,
 * «Рок» и «попса» стали бы разными жанрами, и фильтр по жанру развалился бы.
 * Поэтому список один (его отдаёт сервер), а сервер приводит значение к канону.
 *
 * `stale` — прежний жанр трека, которого в списке уже нет. Показываем его
 * явно: молча пустая выпадалка выглядила бы как баг, а человек не понял бы,
 * что надо что-то выбрать заново.
 */

/**
 * Выбор жанра из закрытого списка.
 *
 * Свободный ввод здесь ломал бы главное свойство общей библиотеки: «рок»,
 * «Рок» и «попса» стали бы разными жанрами, и фильтр по жанру развалился бы.
 * Поэтому список один (его отдаёт сервер), а сервер приводит значение к канону.
 *
 * Жанров 69, поэтому они идут по группам, а ещё их можно искать: без поиска
 * нужный жанр пришлось бы выискивать глазами в длинном списке.
 *
 * `stale` — прежний жанр трека, которого в списке уже нет. Показываем его
 * явно: молча пустая выпадалка выглядела бы как баг, а человек не понял бы,
 * что надо что-то выбрать заново.
 */
function GenreField({ value, onChange, genres, groups, stale }: {
  value: string;
  onChange: (v: string) => void;
  genres: string[];
  groups?: Array<{ name: string; genres: string[] }>;
  stale?: string | null;
}) {
  const [filter, setFilter] = useState('');
  // Пустой список групп — сервер их не прислал (старый бэкенд): рисуем плоско.
  const useGroups = !!groups?.length;
  const query = normalizeKey(filter);
  // Ищем по нормализованному ключу, поэтому «рок» находит и «Рок», и «Хард-рок».
  const matches = (g: string) => !query || normalizeKey(g).startsWith(query);

  const options = () => {
    if (!query) {
      // ListSubheader, а не MenuGroup: того в MUI нет до 7-й версии, а у нас
      // 5.18. component="li" выводит заголовок обычным элементом списка, и он
      // не получает value — значит, выбрать группу вместо жанра нельзя.
      return useGroups
        ? (groups || []).map((gr) => (
          <ListSubheader key={gr.name} component="li" disableSticky
            sx={{ fontSize: 12, lineHeight: '32px', fontWeight: 700 }}>{gr.name}</ListSubheader>
        )).flatMap((hdr, i) => [hdr, ...(groups || [])[i].genres.map((g) => (
          <MenuItem key={g} value={g} sx={{ fontSize: 14 }}>{g}</MenuItem>
        ))])
        : genres.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>);
    }
    // При поиске группы только шумят в списке: показываем плоский результат.
    const found = genres.filter(matches).map((g) => <MenuItem key={g} value={g} sx={{ fontSize: 14 }}>{g}</MenuItem>);
    return found.length ? found : <MenuItem disabled>Ничего не найдено</MenuItem>;
  };

  return (
    <TextField
      select
      label="Жанр"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      fullWidth
      required
      error={!value && !!stale}
      helperText={stale ? `Раньше было «${stale}» — выберите жанр из списка заново` : '«рок», «Рок» и «rock» — это один и тот же жанр'}
      SelectProps={{ MenuProps: { PaperProps: { style: { maxHeight: 340 } } } }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Box onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              <TextField
                placeholder="Поиск"
                size="small"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                sx={{ width: 100, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
              />
            </Box>
          </InputAdornment>
        ),
      }}
    >
      {options()}
    </TextField>
  );
}

/**
 * Форма публикации трека.
 *
 * Поля обязательны ровно те, что требует сервер: обложка, название, жанр и
 * исполнитель. Описание необязательное — сервер его и не спрашивает.
 */
function PublishDialog({ track, genres, genreGroups, onClose }: {
  track: Track | null; genres: string[]; genreGroups?: Array<{ name: string; genres: string[] }>; onClose: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const publishTrack = useSharedMusicStore((s) => s.publishTrack);
  const { coverUrl, uploading, fileRef, pick } = useCoverPicker();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!track) return;
    setTitle(track.title || '');
    setArtist(track.artist || '');
    setGenre(track.genre || '');
    setDescription(track.description || '');
  }, [track]);

  const submit = async () => {
    if (!track || busy) return;
    setBusy(true);
    try {
      await publishTrack(track.id, { title, artist, genre, description, coverUrl: coverUrl || undefined });
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Не удалось выложить трек');
    } finally {
      setBusy(false);
    }
  };

  // Кнопка активна только когда заполнено всё обязательное: иначе пользователь
  // отправляет запрос и получает 400 вместо нормальной проверки на клиенте.
  const ready = !!(title.trim() && artist.trim() && genre && coverUrl) && !uploading && !busy;

  return (
    <Dialog open={!!track} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ color: theme.text }}>Выложить трек всем</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <CoverField coverUrl={coverUrl} uploading={uploading} fileRef={fileRef} onPick={pick} />
          <TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth required />
          <TextField label="Исполнитель" value={artist} onChange={(e) => setArtist(e.target.value)} fullWidth required />
          <GenreField value={genre} onChange={setGenre} genres={genres} groups={genreGroups} />
          <TextField label="Описание" value={description} onChange={(e) => setDescription(e.target.value)}
            fullWidth multiline minRows={2} helperText="необязательно" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} sx={{ color: theme.textSec }}>Отмена</Button>
        <Button variant="contained" onClick={submit} disabled={!ready}
          sx={{ bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent + 'cc' } }}>
          {busy ? 'Публикуем...' : 'Выложить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Выложить в общую библиотеку один свой трек.
 *
 * Отдельная форма, а не публикация из строки списка: строка в общем списке
 * есть только у уже опубликованного трека, а опубликовать его можно было
 * лишь из личной библиотеки. Найти там кнопку и не заметить её можно было
 * легко — поэтому рядом с «Альбом» появилась кнопка «Трек».
 *
 * Поля ровно те же, что в альбоме: обложка, название, исполнитель, жанр,
 * поиск по жанру и описание. Разница одна — вместо набора треков выбирается
 * ровно один, и он сразу уходит всем (у альбома для этого есть отдельная
 * галочка, потому что альбом можно сначала собрать в стол).
 */
function AddTrackDialog({ open, genres, genreGroups, onClose }: {
  open: boolean; genres: string[]; genreGroups?: Array<{ name: string; genres: string[] }>; onClose: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const myTracks = useMusicStore((s) => s.tracks);
  const publishTrack = useSharedMusicStore((s) => s.publishTrack);
  const { coverUrl, uploading, fileRef, pick, setCoverUrl } = useCoverPicker();
  const [pickId, setPickId] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  // Выбранный трек подставляется в поля один раз — при выборе, а не на каждый
  // ререндер: иначе правка названия затиралась бы обратно данными трека.
  const choose = (t: Track) => {
    setPickId(t.id);
    setTitle(t.title || '');
    setArtist(t.artist || '');
    // Обложку подхватываем из трека: чаще всего человек просто переименовывает
    // уже загруженный файл, и искать ту же картинку заново незачем.
    if (t.coverUrl) setCoverUrl(t.coverUrl);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await publishTrack(pickId, {
        title, artist, genre, description,
        // Обложка приходит отдельной загрузкой, а её адрес может быть ещё не
        // готов — тогда отправляем undefined, и сервер оставит прежнюю.
        coverUrl: coverUrl || undefined,
      });
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Не удалось выложить трек');
    } finally {
      setBusy(false);
    }
  };

  // Кнопка активна только когда заполнено всё обязательное: иначе пользователь
  // отправляет запрос и получает 400 вместо нормальной проверки на клиенте.
  const ready = !!(pickId && title.trim() && artist.trim() && genre && coverUrl) && !uploading && !busy;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: theme.text }}>Выложить трек всем</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
              Трек из своей библиотеки
            </Typography>
            <Box sx={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: 1.5 }}>
              {myTracks.length === 0 && (
                <Typography sx={{ p: 1.5, fontSize: 12, color: theme.textSec }}>
                  Сначала загрузите треки в свою библиотеку.
                </Typography>
              )}
              {myTracks.map((t) => (
                <Box key={t.id} onClick={() => choose(t)}
                  sx={{ px: 1.25, py: 0.75, cursor: 'pointer',
                    bgcolor: pickId === t.id ? theme.accent + '18' : 'transparent' }}>
                  <Typography sx={{ fontSize: 13, color: theme.text }} noWrap>{t.title}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <CoverField coverUrl={coverUrl} uploading={uploading} fileRef={fileRef} onPick={pick} />
          <TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth required />
          <TextField label="Исполнитель" value={artist} onChange={(e) => setArtist(e.target.value)} fullWidth required />
          <GenreField value={genre} onChange={setGenre} genres={genres} groups={genreGroups} />
          <TextField label="Описание" value={description} onChange={(e) => setDescription(e.target.value)}
            fullWidth multiline minRows={2} helperText="необязательно" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} sx={{ color: theme.textSec }}>Отмена</Button>
        <Button variant="contained" onClick={submit} disabled={!ready}
          sx={{ bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent + 'cc' } }}>
          {busy ? 'Публикуем...' : 'Выложить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Создание альбома из своих треков + публикация. */
function AlbumDialog({ open, genres, genreGroups, onClose }: {
  open: boolean; genres: string[]; genreGroups?: Array<{ name: string; genres: string[] }>; onClose: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const myTracks = useMusicStore((s) => s.tracks);
  const createAlbum = useSharedMusicStore((s) => s.createAlbum);
  const publishAlbum = useSharedMusicStore((s) => s.publishAlbum);
  const load = useSharedMusicStore((s) => s.load);
  const { coverUrl, uploading, fileRef, pick } = useCoverPicker();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [alsoPublish, setAlsoPublish] = useState(true);

  const toggle = (id: string) => {
    setPicked((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const album = await createAlbum({
        title, artist, genre, description, coverUrl: coverUrl as string, trackIds: picked,
      });
      // Альбом без публикации никто не увидит, а форма называется «выложить всем» —
      // публикуем сразу, иначе пользователь решил бы, что всё готово.
      if (alsoPublish) await publishAlbum((album as any).id);
      setTitle(''); setArtist(''); setGenre(''); setDescription(''); setPicked([]);
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Не удалось создать альбом');
    } finally {
      setBusy(false);
      void load();
    }
  };

  const ready = !!(title.trim() && artist.trim() && genre && coverUrl && picked.length) && !uploading && !busy;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: theme.text }}>Новый альбом</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <CoverField coverUrl={coverUrl} uploading={uploading} fileRef={fileRef} onPick={pick} />
          <TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth required />
          <TextField label="Исполнитель" value={artist} onChange={(e) => setArtist(e.target.value)} fullWidth required />
          <GenreField value={genre} onChange={setGenre} genres={genres} groups={genreGroups} />
          <TextField label="Описание" value={description} onChange={(e) => setDescription(e.target.value)}
            fullWidth multiline minRows={2} helperText="необязательно" />
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
              Треки в альбом ({picked.length} выбрано)
            </Typography>
            <Box sx={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: 1.5 }}>
              {myTracks.length === 0 && (
                <Typography sx={{ p: 1.5, fontSize: 12, color: theme.textSec }}>
                  Сначала загрузите треки в свою библиотеку.
                </Typography>
              )}
              {myTracks.map((t) => (
                <Box key={t.id} onClick={() => toggle(t.id)}
                  sx={{ px: 1.25, py: 0.75, cursor: 'pointer', display: 'flex', gap: 1, alignItems: 'center',
                    bgcolor: picked.includes(t.id) ? theme.accent + '18' : 'transparent' }}>
                  <Checkbox checked={picked.includes(t.id)} size="small" sx={{ p: 0 }} />
                  <Typography sx={{ fontSize: 13, color: theme.text }} noWrap>{t.title}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <FormControlLabel
            control={<Checkbox checked={alsoPublish} onChange={(e) => setAlsoPublish(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13, color: theme.textSec }}>Сразу выложить всем</Typography>}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} sx={{ color: theme.textSec }}>Отмена</Button>
        <Button variant="contained" onClick={submit} disabled={!ready}
          sx={{ bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent + 'cc' } }}>
          {busy ? 'Создаём...' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
