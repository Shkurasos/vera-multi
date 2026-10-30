import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Button, IconButton, TextField, CircularProgress, Alert, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Tabs, Tab,
} from '@mui/material';
import { Close, Add, Delete, Download, Search, ArrowBack } from '@mui/icons-material';
import { stickersApi, type StickerPack, type StickerPackSummary, type Sticker } from '../services/api';
import { useStickerStore } from '../store/stickerStore';
import { useThemeStore } from '../store/themeStore';
import { resolveStickerUrl } from './StickerPicker';

/** Ошибка из ответа сервера или запасной текст. */
const errorText = (e: any, fallback: string) => e?.response?.data?.message || fallback;

function StickerTile({ sticker, size = 72, onClick, children }: {
  sticker: Sticker; size?: number; onClick?: () => void; children?: React.ReactNode;
}) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Box sx={{ position: 'relative', width: size, height: size, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)', border: `1px solid ${theme.border}` }}>
      <Box
        component={onClick ? 'button' : 'div'}
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        aria-label={`Стикер ${sticker.emoji}`}
        sx={{ all: 'unset', display: 'block', width: '100%', height: '100%', cursor: onClick ? 'pointer' : 'default', borderRadius: 2,
          '&:focus-visible': { outline: `2px solid ${theme.accent}` } }}
      >
        <img src={resolveStickerUrl(sticker.fileUrl)} alt={sticker.emoji} loading="lazy" draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </Box>
      {children}
    </Box>
  );
}

/** Скачать ZIP набора: запрос с авторизацией, потом сохранение Blob. */
async function downloadPack(pack: { id: string; name: string }) {
  const { data } = await stickersApi.download(pack.id);
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pack.name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Редактор своего набора: загрузка, эмодзи, удаление стикеров и набора. */
function PackEditor({ pack, onBack }: { pack: StickerPack; onBack: () => void }) {
  const theme = useThemeStore((s) => s.theme);
  const upsert = useStickerStore((s) => s.upsert);
  const remove = useStickerStore((s) => s.remove);
  const fileRef = useRef<HTMLInputElement>(null);
  const [emoji, setEmoji] = useState('🙂');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    const list = Array.from(files);
    let current = pack;
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress(list.length > 1 ? `Загружаем ${i + 1} из ${list.length}…` : 'Загружаем…');
        const { data } = await stickersApi.addSticker(current.id, list[i], emoji);
        current = data;
        upsert(data);
      }
    } catch (e) {
      setError(errorText(e, 'Не удалось загрузить стикер'));
    } finally {
      setBusy(false);
      setProgress('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function run(action: () => Promise<{ data: StickerPack }>, fallback: string) {
    setError('');
    try { upsert((await action()).data); } catch (e) { setError(errorText(e, fallback)); }
  }

  async function deletePack() {
    setConfirmDelete(false);
    try {
      await stickersApi.deletePack(pack.id);
      remove(pack.id);
      onBack();
    } catch (e) { setError(errorText(e, 'Не удалось удалить набор')); }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton aria-label="Назад к наборам" onClick={onBack} sx={{ color: theme.textSec }}><ArrowBack /></IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 700, color: theme.text }}>{pack.title}</Typography>
          <Typography noWrap sx={{ fontSize: 12, color: theme.textSec }}>{pack.name} · {pack.stickers.length} стикеров</Typography>
        </Box>
        <Tooltip title="Скачать ZIP">
          <span><IconButton aria-label="Скачать набор" disabled={!pack.stickers.length} onClick={() => downloadPack(pack).catch(() => setError('Не удалось скачать набор'))} sx={{ color: theme.textSec }}><Download /></IconButton></span>
        </Tooltip>
        <Tooltip title="Удалить набор">
          <IconButton aria-label="Удалить набор" onClick={() => setConfirmDelete(true)} sx={{ color: '#f44336' }}><Delete /></IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField size="small" label="Эмодзи" value={emoji} onChange={(e) => setEmoji(e.target.value)} sx={{ width: 110 }}
          inputProps={{ maxLength: 16, 'aria-describedby': 'sticker-upload-hint' }} />
        <Button variant="contained" startIcon={busy ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <Add />} disabled={busy}
          onClick={() => fileRef.current?.click()} sx={{ textTransform: 'none', bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }}>
          {progress || 'Добавить стикеры'}
        </Button>
        <input ref={fileRef} type="file" hidden multiple accept="image/png,image/webp,image/jpeg,image/gif" onChange={(e) => upload(e.target.files)} />
      </Box>
      <Typography id="sticker-upload-hint" sx={{ fontSize: 12, color: theme.textSec }}>
        PNG, WEBP, JPEG или GIF до 2 МБ. Сервер впишет картинку в 512×512 и сохранит в WEBP; анимация сохраняется.
      </Typography>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {pack.stickers.length === 0 ? (
        <Typography sx={{ color: theme.textSec, fontSize: 14, py: 2, textAlign: 'center' }}>В наборе пока нет стикеров</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 1 }}>
          {pack.stickers.map((s) => (
            <Box key={s.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <StickerTile sticker={s} size={88}>
                <IconButton size="small" aria-label="Убрать стикер из набора"
                  onClick={() => run(() => stickersApi.removeSticker(pack.id, s.id), 'Не удалось убрать стикер')}
                  sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', p: 0.25, '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' } }}>
                  <Close sx={{ fontSize: 14 }} />
                </IconButton>
              </StickerTile>
              <TextField size="small" defaultValue={s.emoji} inputProps={{ 'aria-label': 'Эмодзи стикера', maxLength: 16, style: { textAlign: 'center', padding: '2px 4px' } }}
                onBlur={(e) => { if (e.target.value !== s.emoji) void run(() => stickersApi.setEmoji(pack.id, s.id, e.target.value), 'Не удалось сменить эмодзи'); }}
                sx={{ width: 88 }} />
            </Box>
          ))}
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Удалить набор «{pack.title}»?</DialogTitle>
        <DialogContent>
          <Typography>Набор пропадёт у всех, кто его добавил. Уже отправленные стикеры останутся в чатах.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Отмена</Button>
          <Button color="error" onClick={deletePack}>Удалить</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** Карточка набора в списке: превью, добавить/убрать, скачать. */
function PackRow({ pack, onOpen }: {
  pack: StickerPack | StickerPackSummary; onOpen?: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const upsert = useStickerStore((s) => s.upsert);
  const remove = useStickerStore((s) => s.remove);
  const [installed, setInstalled] = useState(pack.installed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = 'preview' in pack ? pack.preview : pack.stickers.slice(0, 5);
  const count = 'count' in pack ? pack.count : pack.stickers.length;

  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (installed) {
        await stickersApi.uninstall(pack.id);
        setInstalled(false);
        // Свой набор остаётся в «Мои наборы», чужой уходит из стора целиком.
        if (pack.isMine) upsert({ ...(pack as StickerPack), installed: false });
        else remove(pack.id);
      } else {
        const { data } = await stickersApi.install(pack.id);
        setInstalled(true);
        upsert(data);
      }
    } catch (e) {
      setError(errorText(e, 'Не получилось'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ p: 1.25, borderRadius: 2, border: `1px solid ${theme.border}`, bgcolor: 'rgba(255,255,255,0.03)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component={onOpen ? 'button' : 'div'} type={onOpen ? 'button' : undefined} onClick={onOpen}
          sx={{ all: 'unset', flex: 1, minWidth: 0, cursor: onOpen ? 'pointer' : 'default', '&:focus-visible': { outline: `2px solid ${theme.accent}`, borderRadius: 1 } }}>
          <Typography noWrap sx={{ fontWeight: 600, color: theme.text }}>{pack.title}</Typography>
          <Typography noWrap sx={{ fontSize: 12, color: theme.textSec }}>
            {pack.name} · {count} стикеров{pack.isMine ? ' · ваш набор' : ''}
          </Typography>
        </Box>
        <Tooltip title="Скачать ZIP">
          <span><IconButton size="small" aria-label={`Скачать набор ${pack.title}`} disabled={!count}
            onClick={() => downloadPack(pack).catch(() => setError('Не удалось скачать набор'))} sx={{ color: theme.textSec }}><Download fontSize="small" /></IconButton></span>
        </Tooltip>
        <Button size="small" variant={installed ? 'outlined' : 'contained'} disabled={busy} onClick={toggle}
          sx={{ textTransform: 'none', minWidth: 96, ...(installed ? { color: theme.textSec, borderColor: theme.border } : { bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }) }}>
          {busy ? <CircularProgress size={14} /> : installed ? 'Убрать' : 'Добавить'}
        </Button>
      </Box>
      {preview.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1, overflow: 'hidden' }}>
          {preview.map((s) => <StickerTile key={s.id} sticker={s} size={52} />)}
        </Box>
      )}
      {error && <Typography role="alert" sx={{ fontSize: 12, color: '#ff6b6b', mt: 0.5 }}>{error}</Typography>}
    </Box>
  );
}

/** Новый набор: короткое имя (для ссылок и поиска) и название. */
function NewPackForm({ onCreated }: { onCreated: (pack: StickerPack) => void }) {
  const theme = useThemeStore((s) => s.theme);
  const upsert = useStickerStore((s) => s.upsert);
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await stickersApi.createPack(name.trim(), title.trim());
      upsert(data);
      setTitle('');
      setName('');
      onCreated(data);
    } catch (err) {
      setError(errorText(err, 'Не удалось создать набор'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.25, borderRadius: 2, border: `1px dashed ${theme.border}` }}>
      <Typography sx={{ fontWeight: 600, color: theme.text }}>Новый набор</Typography>
      <TextField size="small" label="Название" value={title} onChange={(e) => setTitle(e.target.value)} inputProps={{ maxLength: 64 }} required />
      <TextField size="small" label="Короткое имя" value={name} onChange={(e) => setName(e.target.value)} required
        helperText="Латиница, цифры и _, от 3 до 40 символов. По нему набор найдут в поиске."
        inputProps={{ maxLength: 40, pattern: '[A-Za-z][A-Za-z0-9_]{2,39}' }} />
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" variant="contained" disabled={busy || !title.trim() || !name.trim()}
        sx={{ alignSelf: 'flex-start', textTransform: 'none', bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }}>
        {busy ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Создать'}
      </Button>
    </Box>
  );
}

/** Поиск наборов по названию и короткому имени. */
function SearchTab() {
  const theme = useThemeStore((s) => s.theme);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<StickerPackSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      stickersApi.search(q.trim())
        .then((res) => { if (!cancelled) setFound(res.data || []); })
        .catch((e) => { if (!cancelled) setError(errorText(e, 'Поиск не удался')); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField size="small" fullWidth placeholder="Название или короткое имя набора" value={q} onChange={(e) => setQ(e.target.value)}
        inputProps={{ 'aria-label': 'Поиск наборов стикеров' }}
        InputProps={{ startAdornment: <Search fontSize="small" sx={{ mr: 1, color: theme.textSec }} /> }} />
      {loading && <CircularProgress size={20} sx={{ alignSelf: 'center', my: 1 }} />}
      {error && <Alert severity="error">{error}</Alert>}
      {!loading && !error && found.length === 0 && (
        <Typography sx={{ color: theme.textSec, fontSize: 14, textAlign: 'center', py: 2 }}>Наборов не нашлось</Typography>
      )}
      <Box aria-live="polite" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {found.map((p) => <PackRow key={p.id} pack={p} />)}
      </Box>
    </Box>
  );
}

/**
 * Мини-приложение стикеров (кнопка «Стикеры» в /hub): свои наборы и загрузка,
 * набор в панели, поиск и добавление чужих наборов, скачивание ZIP.
 */
export default function StickersMiniApp({ onClose, packName }: { onClose: () => void; packName?: string }) {
  const theme = useThemeStore((s) => s.theme);
  const { installed, own, loaded, loading, error, load } = useStickerStore();
  const [tab, setTab] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linked, setLinked] = useState<StickerPack | null>(null);
  const [linkError, setLinkError] = useState('');

  useEffect(() => { void load(true); }, [load]);
  // Ссылка на набор (vera://addstickers/<name>) открывает его карточку сверху.
  useEffect(() => {
    if (!packName) return;
    stickersApi.byName(packName).then((r) => setLinked(r.data)).catch(() => setLinkError(`Набор «${packName}» не найден`));
  }, [packName]);

  const editing = editingId ? own.find((p) => p.id === editingId) || null : null;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="stickers-app-title"
      PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3, minHeight: '70vh' } }}>
      <DialogTitle id="stickers-app-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0 }}>
        <Box component="span" sx={{ flex: 1 }}>🎨 Стикеры</Box>
        <IconButton aria-label="Закрыть мини-приложение" onClick={onClose} sx={{ color: theme.textSec }}><Close /></IconButton>
      </DialogTitle>
      {!editing && (
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="fullWidth" sx={{ px: 2 }}>
          <Tab label="Мои наборы" />
          <Tab label="В панели" />
          <Tab label="Найти" />
        </Tabs>
      )}
      <DialogContent sx={{ pt: 2 }}>
        {linkError && <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setLinkError('')}>{linkError}</Alert>}
        {linked && !editing && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>Набор по ссылке</Typography>
            <PackRow pack={linked} />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {!loaded && loading && <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 3 }} />}

        {editing ? (
          <PackEditor pack={editing} onBack={() => setEditingId(null)} />
        ) : loaded && tab === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <NewPackForm onCreated={(p) => setEditingId(p.id)} />
            {own.length === 0 && <Typography sx={{ color: theme.textSec, fontSize: 14 }}>Своих наборов пока нет.</Typography>}
            {own.map((p) => <PackRow key={p.id} pack={p} onOpen={() => setEditingId(p.id)} />)}
          </Box>
        ) : loaded && tab === 1 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {installed.length === 0 && (
              <Typography sx={{ color: theme.textSec, fontSize: 14 }}>Панель пуста. Создайте набор или найдите чужой во вкладке «Найти».</Typography>
            )}
            {installed.map((p) => <PackRow key={p.id} pack={p} onOpen={p.isMine ? () => setEditingId(p.id) : undefined} />)}
          </Box>
        ) : loaded && tab === 2 ? (
          <SearchTab />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
