/**
 * Админский редактор встроенных тем.
 *
 * Встроенные темы — общие для всех пользователей сервера, поэтому правки тут
 * не локальные: админ меняет название, фон-фото, цвета и эффекты, удаляет темы
 * и добавляет новые стоковые, а затем жмёт «Применить для всех» — каталог
 * уезжает на сервер (PUT /api/themes) и прилетает остальным событием
 * `themes:updated`. Настройки темы (включая «обои с календарём и часами»)
 * хранятся внутри самой темы, поэтому календарь/часы переключаются вместе с ней.
 *
 * Для правки одной темы переиспользуется обычный `ThemeEditor`: он умеет всё
 * нужное (цвета, фон, эффекты, обои, шрифты, макет), а мы лишь подменяем
 * сохранение на «записать в каталог».
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, Typography, Button, IconButton, Tooltip, Chip, Alert, Select, MenuItem, TextField, Checkbox, FormControlLabel } from '@mui/material';
// CloudUpload в шиме иконок нет (шим собирается по фактически используемым
// иконкам), поэтому кнопка публикации берёт обычную Upload.
import { Add, Delete, Edit, RestartAlt, Upload, Undo } from '@mui/icons-material';
import {
  useThemeStore, CUSTOM_THEME_ID_START, snapshotThemeSettings, builtinCatalogDirty, type Theme,
} from '../store/themeStore';
import { wallpapersApi, fontsApi } from '../services/api';
import { useAdminFonts } from '../store/adminFontsStore';
import { FONT_FILE_ACCEPT, checkFontFile, customFontCss } from '../utils/customFonts';
import {
  useAdminWallpapers, useAdminWallpaperItems, type AdminWallpaper,
} from '../store/adminWallpapersStore';
import { adminWallpaperClass } from '../store/baseWallpapers';
import { useAllStockWallpapers, wallpaperCssClass, type StockWallpaper } from '../store/chatBgPrefsStore';
import { ThemeEditor } from './ThemeEditor';
import { bubbleBackground } from '../utils/bubbleGradient';

/** Диапазон id для новых стоковых тем админа: ниже «моих тем» (1000+). */
export const ADMIN_STOCK_THEME_ID_START = 500;

/** Следующий свободный id для добавленной стоковой темы. */
export function nextStockThemeId(existing: Theme[]): number {
  const max = existing.reduce((acc, t) => Math.max(acc, Number(t?.id) || 0), ADMIN_STOCK_THEME_ID_START - 1);
  return Math.min(Math.max(max + 1, ADMIN_STOCK_THEME_ID_START), CUSTOM_THEME_ID_START - 1);
}

/** Заготовка новой стоковой темы: палитра-основа + текущие настройки. */
export function makeStockThemeDraft(base: Theme, id: number, name?: string): Theme {
  return {
    ...base,
    id,
    name: name || `Стоковая тема ${id}`,
    // Настройки темы (обои/звук/иконки/внешний вид с календарём и часами/макет)
    // берём с текущего экрана — админ дальше правит их в обычном редакторе.
    settings: snapshotThemeSettings(),
  };
}
export default function AdminThemeEditor() {
  const builtinThemes = useThemeStore((s) => s.builtinThemes);
  const builtinCatalog = useThemeStore((s) => s.builtinCatalog);
  const publishedCatalog = useThemeStore((s) => s.publishedBuiltinCatalog);
  const saveBuiltinTheme = useThemeStore((s) => s.saveBuiltinTheme);
  const removeBuiltinTheme = useThemeStore((s) => s.removeBuiltinTheme);
  const resetBuiltinTheme = useThemeStore((s) => s.resetBuiltinTheme);
  const publishBuiltinThemes = useThemeStore((s) => s.publishBuiltinThemes);
  const loadBuiltinThemes = useThemeStore((s) => s.loadBuiltinThemes);

  const [editing, setEditing] = useState<Theme | null>(null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const changedIds = useMemo(
    () => new Set(Object.keys(builtinCatalog.overrides).map(Number)),
    [builtinCatalog.overrides],
  );
  const removedIds = useMemo(() => new Set(builtinCatalog.removed), [builtinCatalog.removed]);
  const addedIds = useMemo(() => new Set(builtinCatalog.added.map((t) => t.id)), [builtinCatalog.added]);
  // Ожидают публикации только правки, которых ещё нет на сервере: после
  // «Применить для всех» каталог остаётся непустым, но грязным быть не должен.
  const hasLocalEdits = builtinCatalogDirty(builtinCatalog, publishedCatalog);

  const handleEdit = (t: Theme) => {
    setStatus(null);
    setEditing({ ...t, settings: t.settings || snapshotThemeSettings() });
  };

  const handleSaveDraft = (t: Theme) => {
    saveBuiltinTheme(t);
    setStatus({
      error: false,
      text: `Тема «${t.name}» изменена локально. Нажмите «Применить для всех», чтобы её увидели все пользователи.`,
    });
  };

  const handleDelete = (t: Theme) => {
    if (!window.confirm(`Удалить встроенную тему «${t.name}»? Она исчезнет у всех пользователей.`)) return;
    removeBuiltinTheme(t.id);
    setStatus({ error: false, text: `Тема «${t.name}» помечена удалённой. Нажмите «Применить для всех».` });
  };

  const handleReset = (t: Theme) => {
    resetBuiltinTheme(t.id);
    setStatus({ error: false, text: `Тема «${t.name}» возвращена к заводскому виду.` });
  };

  const handleAddStock = () => {
    const base = builtinThemes[0];
    if (!base) return;
    setStatus(null);
    setEditing(makeStockThemeDraft(base, nextStockThemeId(builtinCatalog.added)));
  };

  const handlePublish = async () => {
    setBusy(true);
    const res = await publishBuiltinThemes();
    setBusy(false);
    setStatus(res.ok
      ? { error: false, text: 'Готово: встроенные темы обновлены у всех пользователей.' }
      : { error: true, text: res.message || 'Не удалось сохранить темы' });
  };

  const handleRevertLocal = async () => {
    setBusy(true);
    // Перечитываем каталог с сервера: локальные правки отбрасываются.
    await loadBuiltinThemes();
    setBusy(false);
    setStatus({ error: false, text: 'Локальные правки отброшены — показан каталог с сервера.' });
  };

  return (
    <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, p: 2, mb: 3, border: '1px solid rgba(255,255,255,0.12)' }}>
      <Typography variant="h6">Редактор встроенных тем</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Меняйте название, фон-фото, цвета и эффекты заводских тем, удаляйте их и добавляйте новые стоковые.
        Пока изменения не применены, их видите только вы.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
        <Button variant="contained" startIcon={<Upload />} disabled={busy || !hasLocalEdits} onClick={handlePublish}>
          Применить для всех
        </Button>
        <Button variant="outlined" startIcon={<Add />} disabled={busy} onClick={handleAddStock}>
          Добавить стоковую тему
        </Button>
        <Button variant="outlined" startIcon={<Undo />} disabled={busy || !hasLocalEdits} onClick={handleRevertLocal}>
          Отменить правки
        </Button>
        {hasLocalEdits && <Chip size="small" color="warning" label="Есть неприменённые правки" />}
      </Box>

      {status && (
        <Alert severity={status.error ? 'error' : 'success'} sx={{ mb: 1.5 }} onClose={() => setStatus(null)}>
          {status.text}
        </Alert>
      )}

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        В каталоге {builtinThemes.length} тем
        {builtinCatalog.updatedAt
          ? ` · последнее применение: ${new Date(builtinCatalog.updatedAt).toLocaleString()}`
          : ' · изменения ещё не применялись'}
      </Typography>
<Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 1.5 }}>
        {builtinThemes.map((t) => {
          const changed = changedIds.has(t.id);
          const isAdded = addedIds.has(t.id);
          return (
            <Box key={t.id} sx={{
              borderRadius: 2, overflow: 'hidden',
              border: `1px solid ${changed || isAdded ? 'rgba(255,180,80,0.6)' : 'rgba(255,255,255,0.12)'}`,
              background: t.bgSidebar || t.bg,
            }}>
              <Box sx={{ display: 'flex', height: 34 }}>
                <Box sx={{ flex: 1, background: t.bg }} />
                <Box sx={{ flex: 1, background: t.bgChat || t.bg }} />
                <Box sx={{ flex: 1, background: bubbleBackground(t.bgBubbleOwn, t.bubbleOwnGradient) }} />
                <Box sx={{ flex: 1, background: t.accent }} />
              </Box>
              <Box sx={{ p: 1.25 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: t.text, mb: 0.5 }} noWrap>
                  {t.name}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                  <Chip size="small" label={`id ${t.id}`} sx={{ height: 18, fontSize: 10 }} />
                  {isAdded && <Chip size="small" color="info" label="новая" sx={{ height: 18, fontSize: 10 }} />}
                  {changed && <Chip size="small" color="warning" label="изменена" sx={{ height: 18, fontSize: 10 }} />}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title="Изменить: название, фон-фото, цвета, эффекты, настройки">
                    <IconButton size="small" aria-label={`Изменить тему ${t.name}`} onClick={() => handleEdit(t)}>
                      <Edit sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Удалить у всех">
                    <IconButton size="small" aria-label={`Удалить тему ${t.name}`} onClick={() => handleDelete(t)}>
                      <Delete sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  {(changed || isAdded) && (
                    <Tooltip title="Вернуть заводской вид">
                      <IconButton size="small" aria-label={`Сбросить тему ${t.name}`} onClick={() => handleReset(t)}>
                        <RestartAlt sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>

      {removedIds.size > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
            Удалённые темы (пользователи их не видят) — нажмите, чтобы восстановить:
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {builtinCatalog.removed.map((id) => (
              <Chip
                key={id}
                size="small"
                label={`Тема #${id} · восстановить`}
                onClick={() => {
                  resetBuiltinTheme(id);
                  setStatus({ error: false, text: `Тема #${id} восстановлена. Нажмите «Применить для всех».` });
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {editing && (
        <ThemeEditor
          initialTheme={editing}
          onApply={handleSaveDraft}
          onClose={() => setEditing(null)}
        />
      )}

      <AdminWallpaperSection />
      <AdminFontSection />
    </Box>
  );
}

/* ── Фото и фоны, общие для всех ───────────────────────────────────────────── */

/** Готовые заготовки градиентов: не даём админу писать css руками. */
export const GRADIENT_PRESETS = [
  { name: 'Закат', css: 'linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)', light: true },
  { name: 'Океан', css: 'linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)', light: false },
  { name: 'Мята', css: 'linear-gradient(135deg, #8fe3cf 0%, #6a82fb 100%)', light: false },
  { name: 'Лава', css: 'linear-gradient(120deg, #ff512f 0%, #dd2476 100%)', light: false },
  { name: 'Туман', css: 'linear-gradient(180deg, #dfe9f3 0%, #ffffff 100%)', light: true },
  { name: 'Космос', css: 'radial-gradient(circle at 30% 20%, #2b5876 0%, #0b0f19 100%)', light: false },
];

/**
 * Загрузка фото-фонов и добавление фонов-градиентов: они появляются в общей
 * галерее обоев у ВСЕХ пользователей.
 *
 * В отличие от каталога тем здесь нет черновика и кнопки «Применить для всех»:
 * файл сначала уезжает на сервер и лишь потом появляется в галерее — черновиком
 * файл быть не может. Каталог меняется сразу, остальным прилетает
 * `wallpapers:updated`.
 */
function AdminWallpaperSection() {
  const items = useAdminWallpaperItems();
  // Полный список (заводские + добавленные) — по нему ищем фон при правке.
  const allWallpapers = useAllStockWallpapers();
  const apply = useAdminWallpapers((s) => s.apply);
  const load = useAdminWallpapers((s) => s.load);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const [gradient, setGradient] = useState(GRADIENT_PRESETS[0].name);
  const fileRef = useRef<HTMLInputElement>(null);
  // Диалог правки существующего фона: null — закрыт.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', light: false, css: '' });
  const [editFile, setEditFile] = useState<File | null>(null);
  const editFileRef = useRef<HTMLInputElement>(null);
  const editingItem = useMemo(() => {
    // Ищем и в добавленных админом, и среди заводских: правка доступна и тем, и
    // другим, а список добавленных тут ни при чём.
    if (!editingId) return null;
    const own = items.find((x) => x.id === editingId);
    if (own) return own;
    const fromCatalog = allWallpapers.find((w) => w.id === editingId);
    return fromCatalog
      ? { id: fromCatalog.id, name: fromCatalog.name, type: fromCatalog.type, url: fromCatalog.url, css: fromCatalog.css, light: fromCatalog.light }
      : null;
  }, [editingId, items, allWallpapers]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } finally { setBusy(false); }
  };

  const fail = (e: any, fallback: string) =>
    setMsg({ error: true, text: e?.response?.data?.message || fallback });

  const uploadFile = (file: File) => withBusy(async () => {
    try {
      const res = await wallpapersApi.upload(file, file.name.replace(/\.[a-z0-9]+$/i, ''));
      apply(res.data?.wallpapers);
      setMsg({ error: false, text: `Фон «${file.name}» добавлен — он уже в галерее у всех.` });
    } catch (e: any) { fail(e, 'Не удалось загрузить фон'); }
  });

  const addGradient = () => withBusy(async () => {
    const preset = GRADIENT_PRESETS.find((g) => g.name === gradient);
    if (!preset) return;
    try {
      const res = await wallpapersApi.addBase({ name: preset.name, css: preset.css, light: preset.light });
      apply(res.data?.wallpapers);
      setMsg({ error: false, text: `Фон «${preset.name}» добавлен — он уже в галерее у всех.` });
    } catch (e: any) { fail(e, 'Не удалось добавить фон'); }
  });

  const remove = (id: string, name: string, verb = 'удалён') => withBusy(async () => {
    try {
      const res = await wallpapersApi.remove(id);
      apply(res.data?.wallpapers);
      setMsg({ error: false, text: `Фон «${name}» ${verb}.` });
    } catch (e: any) { fail(e, 'Не удалось удалить фон'); }
  });

  // Правка существующего фона: имя, «светлый» и — для градиента — сам css.
  const saveEdit = (id: string, name: string, light: boolean, css?: string) => withBusy(async () => {
    try {
      const res = await wallpapersApi.update(id, { name, light, ...(css ? { css } : {}) });
      apply(res.data?.wallpapers);
      setMsg({ error: false, text: `Фон «${name}» обновлён.` });
    } catch (e: any) { fail(e, 'Не удалось изменить фон'); }
  });

  // Замена картинки: id сохраняется, поэтому темы, ссылающиеся на фон, не ломаются.
  const replacePhoto = (id: string, name: string, light: boolean, file: File) => withBusy(async () => {
    try {
      const res = await wallpapersApi.replace(id, file, name, light);
      apply(res.data?.wallpapers);
      setMsg({ error: false, text: `Фото фона «${name}» заменено.` });
    } catch (e: any) { fail(e, 'Не удалось заменить фото'); }
  });

  /** Открывает диалог правки конкретного фона. */
  const openEdit = (w: AdminWallpaper) => {
    setEditingId(w.id);
    setDraft({ name: w.name, light: !!w.light, css: w.css || '' });
  };

  const submitEdit = (file: File | null) => {
    if (!editingItem) return;
    const name = draft.name.trim();
    if (!name) { setMsg({ error: true, text: 'Название не может быть пустым' }); return; }
    const id = editingItem.id;
    // Новый файл бывает только у фото-фона: замена картинки у градиента не имеет
    // смысла, а у заводского фото — есть.
    if (file && editingItem.type === 'photo') void replacePhoto(id, name, draft.light, file);
    else void saveEdit(id, name, draft.light, editingItem.type === 'base' ? draft.css : undefined);
    setEditingId(null);
  };
return (
    <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, p: 2, mb: 3, border: '1px solid rgba(255,255,255,0.12)' }}>
      <Typography variant="h6">Фото и фоны для всех</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Загруженные фото и фоны появляются в общей галерее обоев у всех пользователей —
        их можно выбрать и в чате, и в настройках темы. Здесь изменения применяются сразу.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
        <Button variant="contained" startIcon={<Upload />} disabled={busy} onClick={() => fileRef.current?.click()}>
          Загрузить фото-фон
        </Button>
        <input
          ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Сбрасываем value: иначе повторный выбор того же файла не даст события.
            e.target.value = '';
            if (file) void uploadFile(file);
          }}
        />
        <Select size="small" value={gradient} disabled={busy} onChange={(e) => setGradient(e.target.value)} sx={{ minWidth: 140 }}>
          {GRADIENT_PRESETS.map((g) => (
            <MenuItem key={g.name} value={g.name}>{g.name}</MenuItem>
          ))}
        </Select>
        <Button variant="outlined" startIcon={<Add />} disabled={busy} onClick={addGradient}>
          Добавить фон-градиент
        </Button>
        <Button size="small" disabled={busy} onClick={() => withBusy(async () => { await load(); })}>
          Обновить
        </Button>
      </Box>

      {msg && (
        <Alert severity={msg.error ? 'error' : 'success'} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <FactoryWallpaperList
        count={items.length}
        busy={busy}
        onEdit={(w) => { setEditingId(w.id); setDraft({ name: w.name, light: !!w.light, css: w.css || '' }); }}
        onRemove={(id, name) => {
          // Заводской фон нельзя стереть с сервера — он в бандле. Убираем его из
          // галереи у всех; вернуть можно правкой (она снимает скрытие).
          void remove(id, name, 'убран из галереи у всех');
        }}
      />

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        Добавленных фонов: {items.length}
      </Typography>

      {items.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Пока ничего не добавлено — загрузите фото или добавьте градиент.
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5 }}>
          {items.map((w) => (
            <Box key={w.id} sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
              {w.type === 'photo' ? (
                <Box sx={{
                  width: '100%', height: 90,
                  backgroundImage: `url(${w.url})`, backgroundSize: 'cover', backgroundPosition: 'center',
                }} />
              ) : (
                <Box className={adminWallpaperClass(w.id, w.css || '')} sx={{ width: '100%', height: 90 }} />
              )}
              <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontSize: 12, flex: 1, minWidth: 0 }} noWrap title={w.name}>{w.name}</Typography>
                <Tooltip title="Изменить фон">
                  <IconButton
                    size="small" disabled={busy}
                    aria-label={`Изменить фон ${w.name}`}
                    onClick={() => { setEditFile(null); openEdit(w); }}
                  >
                    <Edit sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Удалить фон у всех">
                  <IconButton
                    size="small" disabled={busy} aria-label={`Удалить фон ${w.name}`}
                    onClick={() => void remove(w.id, w.name)}
                  >
                    <Delete sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Box>
      )}
{editingItem && (
        <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, border: '1px solid rgba(255,255,255,0.16)', bgcolor: 'rgba(0,0,0,0.25)' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>
            Изменение: {editingItem.name}
          </Typography>
          <TextField
            fullWidth size="small" label="Название" value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            sx={{ mb: 1 }}
          />
          {editingItem.type === 'base' && (
            <TextField
              fullWidth size="small" label="CSS фона (градиент/цвета)"
              value={draft.css}
              onChange={(e) => setDraft((d) => ({ ...d, css: e.target.value }))}
              sx={{ mb: 1 }}
              helperText="Без url(), @ и ; — иначе фон не примется"
            />
          )}
          {editingItem.type === 'photo' && (
            <>
              <Button
                size="small" variant="outlined" sx={{ mb: 1 }}
                onClick={() => editFileRef.current?.click()}
              >
                {editFile ? `Выбран: ${editFile.name}` : 'Заменить фото'}
              </Button>
              <input
                ref={editFileRef} type="file" accept="image/*" hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // Сбрасываем value: иначе повторный выбор того же файла не даст события.
                  e.target.value = '';
                  setEditFile(f || null);
                }}
              />
            </>
          )}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small" checked={draft.light} disabled={busy}
                  onChange={(e) => setDraft((d) => ({ ...d, light: e.target.checked }))}
                />
              }
              label={<Typography sx={{ fontSize: 13 }}>Светлый фон</Typography>}
            />
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setEditingId(null)}>Отмена</Button>
            <Button size="small" variant="contained" disabled={busy || !draft.name.trim()} onClick={() => submitEdit(editFile)}>
              Сохранить
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
/* ── Общие шрифты ─────────────────────────────────────────────────────────── */

/**
 * Общие стоковые шрифты: админ заливает файл на сервер, и шрифт появляется в
 * выборе шрифта у ВСЕХ — без загрузки, как обычный стоковой.
 *
 * Как и с фонами, черновика тут нет: файл сначала уезжает на сервер, и лишь
 * потом появляется в выборе. Остальным прилетает `fonts:updated`.
 */
function AdminFontSection() {
  const items = useAdminFonts((s) => s.items);
  const apply = useAdminFonts((s) => s.apply);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = (file: File) => {
    setBusy(true);
    setMsg(null);
    void (async () => {
      try {
        const res = await fontsApi.upload(file);
        apply(res.data?.fonts);
        setMsg({ error: false, text: `Шрифт «${file.name}» доступен всем пользователям.` });
      } catch (e: any) {
        setMsg({ error: true, text: e?.response?.data?.message || 'Не удалось загрузить шрифт' });
      } finally {
        setBusy(false);
      }
    })();
  };

  const remove = (id: string, name: string) => {
    setBusy(true);
    setMsg(null);
    void (async () => {
      try {
        const res = await fontsApi.remove(id);
        apply(res.data?.fonts);
        setMsg({ error: false, text: `Шрифт «${name}» удалён.` });
      } catch (e: any) {
        setMsg({ error: true, text: e?.response?.data?.message || 'Не удалось удалить шрифт' });
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, p: 2, mb: 3, border: '1px solid rgba(255,255,255,0.12)' }}>
      <Typography variant="h6">Общие шрифты</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Загруженные шрифты появляются в выборе шрифта у всех — и в настройках приложения, и в чатах.
        Свои шрифты пользователей (загруженные локально) остаются у них.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
        <Button variant="contained" startIcon={<Upload />} disabled={busy} onClick={() => fileRef.current?.click()}>
          Загрузить общий шрифт
        </Button>
        <input
          ref={fileRef} type="file" accept={FONT_FILE_ACCEPT} hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Сбрасываем value: иначе повторный выбор того же файла не даст события.
            e.target.value = '';
            if (!file) return;
            // Проверка до отправки: файл всё равно уедет на сервер целиком.
            const problem = checkFontFile(file);
            if (problem) { setMsg({ error: true, text: problem }); return; }
            upload(file);
          }}
        />
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
          .ttf / .otf / .woff / .woff2, до 12 МБ
        </Typography>
      </Box>

      {msg && (
        <Alert severity={msg.error ? 'error' : 'success'} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      {items.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Общих шрифтов пока нет — загрузите .ttf или .woff2.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {items.map((f) => (
            <Box
              key={f.id}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.5, borderRadius: 2,
                bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <Box component="span" data-font-preview sx={{ fontFamily: customFontCss(f.family), fontSize: 14 }}>
                {f.name}
              </Box>
              <Tooltip title="Удалить шрифт у всех">
                <IconButton
                  size="small" disabled={busy}
                  aria-label={`Удалить шрифт ${f.name}`}
                  onClick={() => remove(f.id, f.name)}
                >
                  <Delete sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
/* ── Обзор встроенных фонов ────────────────────────────────────────────────── */

/**
 * Все фоны, которые уже считаются встроенными: заводские из приложения и
 * добавленные админом. Нужен, чтобы видеть весь каталог в одном месте — иначе
 * «сколько у нас фонов» отвечает только за загруженные, а остальные не видны.
 *
 * Заводские лежат в бандле и правке с сервера не поддаются, поэтому здесь они
 * только для чтения: показать и найти можно, скрыть или удалить — нельзя.
 */
function FactoryWallpaperList({
  count, busy, onEdit, onRemove,
}: {
  count: number;
  busy: boolean;
  onEdit: (w: StockWallpaper) => void;
  onRemove: (id: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  // Общий список: заводские + админские, ровно тот, что видит галерея обоев.
  const all = useAllStockWallpapers();

  const factory = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((w) => w.id !== 'none' && (!q || w.name.toLowerCase().includes(q)));
  }, [all, query]);

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Встроенные фоны
        </Typography>
        <Chip size="small" label={`всего ${factory.length}${count ? ` (+${count} ваших)` : ''}`} sx={{ height: 20, fontSize: 11 }} />
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <TextField
            fullWidth size="small" placeholder="Поиск по названию" value={query}
            onChange={(e) => setQuery(e.target.value)} sx={{ maxWidth: 260 }}
          />
        </Box>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        Заводские фоны вшиты в приложение — их нельзя удалить или изменить с сервера.
        Свои фоны ниже можно править и удалять.
      </Typography>
      {factory.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Ничего не найдено.</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
          {factory.map((w) => (
            <Box
              key={w.id}
              title={`${w.name} · ${w.id}`}
              sx={{ borderRadius: 1.5, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {w.type === 'photo' ? (
                <Box sx={{
                  width: '100%', height: 64,
                  backgroundImage: `url(${w.url})`, backgroundSize: 'cover', backgroundPosition: 'center',
                }} />
              ) : (
                <Box
                  className={wallpaperCssClass(w)}
                  sx={{ width: '100%', height: 64 }}
                />
              )}
              <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <Typography sx={{ fontSize: 10, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.name}
                </Typography>
                {w.edited && (
                  <Tooltip title="Фон изменён админом">
                    <Chip size="small" label="изм." sx={{ height: 15, fontSize: 9 }} />
                  </Tooltip>
                )}
                <Tooltip title="Изменить фон у всех">
                  <IconButton
                    size="small" disabled={busy}
                    aria-label={`Изменить фон ${w.name}`}
                    onClick={() => { onEdit(w); }}
                  >
                    <Edit sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Убрать фон из галереи у всех">
                  <IconButton
                    size="small" disabled={busy}
                    aria-label={`Убрать фон ${w.name}`}
                    onClick={() => void onRemove(w.id, w.name)}
                  >
                    <Delete sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}