/**
 * Общая библиотека музыки: то, что выложили все.
 *
 * Отдельный стор от `musicStore`: там «моя библиотека» и плеер, здесь — чужое
 * музыкальное имущество, которое можно слушать, сохранить себе и — если оно
 * моё — снять с публикации. Смешивать их в одном сторе нельзя: список общих
 * треков перезаписывал бы `tracks` и «сбросил» бы пользователю его музыку.
 */
import { create } from 'zustand';
import { musicApi } from '../services/api';
import type { MusicAlbum, Track } from '../types';

export type SharedSort = 'new' | 'plays' | 'title' | 'artist' | 'genre';

export const SHARED_SORTS: Array<{ key: SharedSort; label: string }> = [
  { key: 'new', label: 'Сначала новые' },
  { key: 'plays', label: 'Популярные' },
  { key: 'title', label: 'По названию' },
  { key: 'artist', label: 'По исполнителю' },
  { key: 'genre', label: 'По жанру' },
];

interface SharedMusicState {
  tracks: Track[];
  albums: MusicAlbum[];
  /** Плоский список жанров — для проверок и группировки. */
  genres: string[];
  /**
   * Жанры по группам («Рок», «Джаз», «Электронная»…).
   *
   * Нужны из-за количества: 69 жанров одним списком не найти, пришлось бы
   * прокручивать мимо половины. Пустой массив означает, что сервер groups не
   * прислал, — тогда форма рисует плоский список.
   */
  genreGroups: Array<{ name: string; genres: string[] }>;
  total: number;
  loading: boolean;
  saving: Record<string, boolean>;
  query: string;
  sort: SharedSort;

  setQuery: (q: string) => void;
  setSort: (sort: SharedSort) => void;
  load: () => Promise<void>;

  publishTrack: (id: string, data: { title: string; artist: string; genre: string; description?: string; coverUrl?: string }) => Promise<void>;
  unpublishTrack: (id: string) => Promise<void>;
  saveTrack: (id: string) => Promise<void>;

  createAlbum: (data: { title: string; artist: string; genre: string; description?: string; coverUrl: string; trackIds: string[] }) => Promise<void>;
  publishAlbum: (id: string) => Promise<void>;
  unpublishAlbum: (id: string) => Promise<void>;
  saveAlbum: (id: string) => Promise<void>;
  deleteAlbum: (id: string) => Promise<void>;
}

export const useSharedMusicStore = create<SharedMusicState>((set, get) => ({
  tracks: [],
  albums: [],
  genres: [],
  genreGroups: [],
  total: 0,
  loading: false,
  saving: {},
  query: '',
  sort: 'new',

  setQuery: (query) => {
    set({ query });
    // Ищем сразу: без кнопки «найти» пользователь ждёт результата, которого
    // не будет. Запросы на каждый символ — обычное дело для списка в 200 строк.
    void get().load();
  },

  setSort: (sort) => {
    set({ sort });
    void get().load();
  },

  load: async () => {
    const { query, sort } = get();
    set({ loading: true });
    try {
      // Два независимых запроса: параллельным Promise.all, иначе список
      // альбомов ждал бы ещё треков и панель открывалась на полсекунды дольше.
      const [tracksRes, albumsRes] = await Promise.all([
        musicApi.sharedTracks({ q: query || undefined, sort }),
        musicApi.albums({ scope: 'shared', q: query || undefined, sort }),
      ]);
      const tData: any = tracksRes.data;
      const aData: any = albumsRes.data;
      set({
        tracks: Array.isArray(tData) ? tData : (tData?.tracks || []),
        albums: Array.isArray(aData) ? aData : (aData?.albums || []),
        genres: tData?.genres || aData?.genres || [],
        genreGroups: tData?.genreGroups || aData?.genreGroups || [],
        total: tData?.total ?? 0,
      });
    } catch (e) {
      console.error('[sharedMusic] не удалось загрузить общую библиотеку', e);
    } finally {
      set({ loading: false });
    }
  },

  publishTrack: async (id, data) => {
    await musicApi.publishTrack(id, data);
    await get().load();
  },

  unpublishTrack: async (id) => {
    await musicApi.unpublishTrack(id);
    // Убираем из списка сразу: пока ждём перезагрузки, трек «с исчезающим»
    // продолжал бы висеть в общей библиотеке.
    set({ tracks: get().tracks.filter((t) => t.id !== id) });
  },

  saveTrack: async (id) => {
    set({ saving: { ...get().saving, [id]: true } });
    try {
      await musicApi.saveSharedTrack(id);
    } finally {
      const next = { ...get().saving };
      delete next[id];
      set({ saving: next });
    }
  },

  createAlbum: async (data) => {
    await musicApi.createAlbum(data);
  },

  publishAlbum: async (id) => {
    await musicApi.publishAlbum(id);
    await get().load();
  },

  unpublishAlbum: async (id) => {
    await musicApi.unpublishAlbum(id);
    set({ albums: get().albums.filter((a) => a.id !== id) });
  },

  saveAlbum: async (id) => {
    set({ saving: { ...get().saving, [id]: true } });
    try {
      await musicApi.saveSharedAlbum(id);
    } finally {
      const next = { ...get().saving };
      delete next[id];
      set({ saving: next });
    }
  },

  deleteAlbum: async (id) => {
    await musicApi.deleteAlbum(id);
    set({ albums: get().albums.filter((a) => a.id !== id) });
  },
}));