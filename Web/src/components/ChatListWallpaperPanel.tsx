/**
 * Обои экрана выбора чатов — отдельная от чатовых.
 *
 * Своё фото с ручной обрезкой: картинка целиком в фоне списка почти всегда
 * обрезается краем панели, а «главный объект» уезжает за список. Поэтому перед
 * сохранением кадр выбирает пользователь, а не `background-size: cover`.
 *
 * Само фото лежит в IndexedDB (как и остальные фото-обои), в сторе — только
 * ключ: держать base64 в синхронизируемом сторе нельзя, квота и лимит
 * синхронизации этого не переживут.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Typography, Button, Slider, Alert, IconButton,
} from '@mui/material';
import { DeleteOutline, PhotoCamera } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { CHAT_LIST_SCOPE, useChatBgPrefsStore } from '../store/chatBgPrefsStore';
import { savePhotoBg, clearPhotoBg } from '../services/chatBgPhotoStorage';
import { usePhotoBgUrl, usePhotoBgUrls } from '../hooks/usePhotoBgUrl';
import PhotoCropDialog from './PhotoCropDialog';

/** Предупреждаем раньше, чем браузер съест память на декодирование. */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function newId(): string {
  return (crypto as any)?.randomUUID?.() || `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChatListWallpaperPanel() {
  const theme = useThemeStore((s) => s.theme);
  const chatListBg = useChatBgPrefsStore((s) => s.chatListBg);
  const chatListDim = useChatBgPrefsStore((s) => s.chatListDim);
  const chatListBlur = useChatBgPrefsStore((s) => s.chatListBlur);
  const all = useChatBgPrefsStore((s) => s.userWallpapers[CHAT_LIST_SCOPE]);
  // Фильтруем через useMemo, а не прямо в селекторе: filter() в селекторе
  // zustand возвращает новый массив на каждый вызов, и перерисовка панели
  // случалась бы на любое чужое изменение стора.
  const items = useMemo(() => (all || []).filter((i) => i.type === 'photo'), [all]);
  const setChatListBg = useChatBgPrefsStore((s) => s.setChatListBg);
  const setChatListDim = useChatBgPrefsStore((s) => s.setChatListDim);
  const setChatListBlur = useChatBgPrefsStore((s) => s.setChatListBlur);
  const addUserWallpaper = useChatBgPrefsStore((s) => s.addUserWallpaper);
  const removeUserWallpaper = useChatBgPrefsStore((s) => s.removeUserWallpaper);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState('');

  const urls = usePhotoBgUrls(items.map((i) => i.value));
  const currentUrl = usePhotoBgUrl(chatListBg?.type === 'photo' ? chatListBg.value : null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Сбрасываем input сразу: иначе повторный выбор того же файла не даст
    // события change и второй раз обрезать его будет нечем.
    e.target.value = '';
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('Это не картинка'); return; }
    if (file.size > MAX_FILE_SIZE) { setError('Файл больше 25 МБ'); return; }
    setPending({ url: URL.createObjectURL(file), name: file.name });
  };

  const closePending = () => {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  };

  // Кроппер отдал блоб — кладём в IndexedDB и сразу выбираем.
  const saveCropped = async (blob: Blob) => {
    const id = newId();
    const key = `${CHAT_LIST_SCOPE}:${id}`;
    await savePhotoBg(blob, key);
    addUserWallpaper(CHAT_LIST_SCOPE, { id, name: pending?.name || 'Моё фото', type: 'photo', value: key, createdAt: Date.now() });
    setChatListBg({ type: 'photo', value: key });
    closePending();
  };

  const drop = async (id: string, key: string) => {
    // Файл стираем из IndexedDB только если он больше нигде не выбран: тем же
    // ключом может пользоваться обои чата (см. WallpaperSettingsDialog).
    const st = useChatBgPrefsStore.getState();
    const stillUsed = st.chatListBg?.value === key
      || Object.values(st.perChatOverrides).some((o) => o?.value === key)
      || Object.values(st.userWallpapers).some((list) => (list || []).some((i) => i.value === key));
    removeUserWallpaper(CHAT_LIST_SCOPE, id);
    if (chatListBg?.value === key) setChatListBg(null);
    if (!stillUsed) await clearPhotoBg(key);
  };
return (
    <Box>
      <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>
        Меню со списком чатов — свой фон, не связанный с чатами
      </Typography>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, mb: 1.5,
        border: `1px solid ${theme.border}`, borderRadius: 2, bgcolor: theme.bgInput,
      }}>
        <Box sx={{
          width: 56, height: 72, borderRadius: 1.5, flexShrink: 0, overflow: 'hidden',
          border: `1px solid ${theme.border}`, bgcolor: theme.bgHover,
          backgroundImage: currentUrl ? `url(${currentUrl})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, color: theme.text, fontWeight: 600 }} noWrap>
            {chatListBg ? 'Своё фото' : 'Без обоев'}
          </Typography>
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>Фон списка чатов</Typography>
        </Box>
      </Box>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => fileRef.current?.click()} startIcon={<PhotoCamera />}
          sx={{ bgcolor: theme.accent, textTransform: 'none', '&:hover': { bgcolor: theme.accent } }}>
          Добавить фото
        </Button>
        {chatListBg && (
          <Button onClick={() => setChatListBg(null)} sx={{ color: theme.textSec, textTransform: 'none' }}>
            Убрать обои
          </Button>
        )}
      </Box>
      {error ? <Alert severity="error" sx={{ mt: 1.5, fontSize: 12 }}>{error}</Alert> : null}
      <ChatListGallery
        items={items}
        urls={urls}
        selected={chatListBg?.type === 'photo' ? chatListBg.value : null}
        onPick={(key) => setChatListBg({ type: 'photo', value: key })}
        onDrop={drop}
      />
      {chatListBg && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>
            Затемнение: {Math.round(chatListDim * 100)}%
          </Typography>
          <Slider size="small" min={0} max={0.9} step={0.05} value={chatListDim}
            onChange={(_, v) => setChatListDim(Array.isArray(v) ? v[0] : v)} sx={{ color: theme.accent }} />
          <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>Размытие: {chatListBlur} px</Typography>
          <Slider size="small" min={0} max={24} step={1} value={chatListBlur}
            onChange={(_, v) => setChatListBlur(Array.isArray(v) ? v[0] : v)} sx={{ color: theme.accent }} />
        </Box>
      )}
      <Alert severity="info" sx={{ mt: 1.5, fontSize: 12 }}>
        Фото можно обрезать самому: рамка кадрирования показывает, что останется
        в меню. Затемнение и размытие помогают, чтобы названия чатов читались.
        Выбор сохраняется вместе с темой.
      </Alert>
      <PhotoCropDialog open={!!pending} src={pending?.url || ''} title={pending?.name}
        onDone={saveCropped} onClose={closePending} />
    </Box>
  );
}

/** Плитки своих фото: выбор и удаление. */
function ChatListGallery({ items, urls, selected, onPick, onDrop }: {
  items: Array<{ id: string; value: string }>;
  urls: Record<string, string>;
  selected: string | null;
  onPick: (key: string) => void;
  onDrop: (id: string, key: string) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  if (!items.length) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 1, mt: 1.5 }}>
      {items.map((it) => (
        <Box key={it.id} onClick={() => onPick(it.value)}
          sx={{
            position: 'relative', aspectRatio: '9 / 16', borderRadius: 1.5, overflow: 'hidden', cursor: 'pointer',
            border: selected === it.value ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
            bgcolor: theme.bgHover,
            backgroundImage: urls[it.value] ? `url(${urls[it.value]})` : undefined,
            backgroundSize: 'cover', backgroundPosition: 'center',
          }}
        >
          <IconButton size="small" aria-label="Удалить обои"
            onClick={(e) => { e.stopPropagation(); void onDrop(it.id, it.value); }}
            sx={{ position: 'absolute', top: 2, right: 2, p: 0.4, bgcolor: 'rgba(0,0,0,.6)', color: '#fff',
              '&:hover': { bgcolor: 'rgba(0,0,0,.8)' } }}>
            <DeleteOutline sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}