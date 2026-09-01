import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Track } from '../types';
import { musicApi } from '../services/api';
import { peer, isPeerAvailable } from './../services/peer';

type RepeatMode = 'none' | 'one' | 'all';

interface MusicState {
  tracks: Track[];
  queue: Track[];
  currentTrack: Track | null;
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  progress: number;
  duration: number;
  repeat: RepeatMode;
  shuffle: boolean;
  isVisible: boolean;
  playerCollapsed: boolean;

  loadTracks: () => Promise<void>;
  search: (q: string) => Promise<void>;
  play: (track: Track, queue?: Track[]) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  setProgress: (p: number) => void;
  setDuration: (d: number) => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  setVisible: (v: boolean) => void;
  addToQueue: (track: Track) => void;
  playQueueIndex: (index: number) => void;
  removeFromQueue: (trackId: string) => void;
  clearQueue: () => void;
  setPlayerCollapsed: (v: boolean) => void;
  uploadTrack: (formData: FormData, onProgress?: (p: number) => void) => Promise<Track>;
  updateTrack: (trackId: string, formData: FormData) => Promise<Track>;
  deleteTrack: (trackId: string) => Promise<void>;
  importUrl: (url: string) => Promise<Track>;
  importZip: (formData: FormData, onProgress?: (p: number) => void) => Promise<{ imported: number; skipped: string[]; tracks: Track[] }>;
}

export const useMusicStore = create<MusicState>()(
  persist(
    (set, get) => ({
  tracks: [],
  queue: [],
  currentTrack: null,
  currentIndex: -1,
  isPlaying: false,
  volume: 0.8,
  progress: 0,
  duration: 0,
  repeat: 'none',
  shuffle: false,
  isVisible: true,
  playerCollapsed: false,

  loadTracks: async () => {
    // P2P: локальная mediaLibrary из peer/src/store.js.
    if (isPeerAvailable()) {
      try {
        const items = await peer.listMedia();
        const tracks: Track[] = (items || []).map((m: any) => ({
          id: m.id,
          title: m.title || m.name || 'Без названия',
          artist: m.artist || '',
          album: m.album || '',
          duration: m.duration || 0,
          fileUrl: m.fileUrl || m.path || '',
          coverUrl: m.coverUrl || '',
          playsCount: m.playsCount || 0,
          createdAt: m.addedAt ? new Date(m.addedAt).toISOString() : new Date().toISOString(),
        }));
        set({ tracks });
        return;
      } catch (e) { console.warn('[peer] listMedia failed:', e); }
      set({ tracks: [] });
      return;
    }
    const res = await musicApi.getMy();
    const tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
    set({ tracks });
  },

  search: async (q) => {
    if (isPeerAvailable()) {
      // Локальный поиск по имени/артисту/альбому.
      const items = (await peer.listMedia().catch(() => [])) as any[];
      const needle = q.toLowerCase();
      const tracks: Track[] = items
        .filter((m) => [m.title, m.artist, m.album].filter(Boolean).some((s: string) => s.toLowerCase().includes(needle)))
        .map((m) => ({
          id: m.id, title: m.title || 'Без названия', artist: m.artist || '', album: m.album || '',
          duration: m.duration || 0, fileUrl: m.fileUrl || m.path || '', coverUrl: m.coverUrl || '',
          playsCount: m.playsCount || 0, createdAt: new Date(m.addedAt || Date.now()).toISOString(),
        }));
      set({ tracks });
      return;
    }
    const res = await musicApi.search(q);
    const tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
    set({ tracks });
  },

  play: (track, queue) => {
    const q = queue || get().queue;
    const idx = q.findIndex((t) => t.id === track.id);
    set({ currentTrack: track, queue: q, currentIndex: idx, isPlaying: true, progress: 0 });
    // Счётчик воспроизведений — только в серверном режиме. В P2P можно
    // локально накручивать в mediaLibrary; оставим на будущее.
    if (!isPeerAvailable()) musicApi.recordPlay(track.id).catch(() => {});
  },

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  next: () => {
    const { queue, currentIndex, shuffle, repeat, currentTrack } = get();
    if (repeat === 'one' && currentTrack) {
      set({ progress: 0, isPlaying: true });
      return;
    }
    if (!queue.length) return;
    let idx: number;
    if (shuffle) {
      idx = Math.floor(Math.random() * queue.length);
    } else {
      idx = currentIndex + 1;
      if (idx >= queue.length) {
        if (repeat === 'all') idx = 0;
        else return set({ isPlaying: false });
      }
    }
    set({ currentTrack: queue[idx], currentIndex: idx, isPlaying: true, progress: 0 });
    musicApi.recordPlay(queue[idx].id).catch(() => {});
  },

  prev: () => {
    const { queue, currentIndex, progress } = get();
    if (progress > 3) return set({ progress: 0 });
    const idx = Math.max(0, currentIndex - 1);
    set({ currentTrack: queue[idx], currentIndex: idx, isPlaying: true, progress: 0 });
  },

  setVolume: (volume) => set({ volume }),
  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration }),

  toggleRepeat: () =>
    set((s) => ({
      repeat: s.repeat === 'none' ? 'all' : s.repeat === 'all' ? 'one' : 'none',
    })),

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  setVisible: (isVisible) => set({ isVisible }),
  addToQueue: (track) => set((s) => ({ queue: [...s.queue, track] })),

  playQueueIndex: (index) => {
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    set({ currentTrack: track, currentIndex: index, isPlaying: true, progress: 0 });
    musicApi.recordPlay(track.id).catch(() => {});
  },

  removeFromQueue: (trackId) =>
    set((s) => {
      const removedIndex = s.queue.findIndex((track) => track.id === trackId);
      const nextQueue = s.queue.filter((track) => track.id !== trackId);
      const isCurrentRemoved = s.currentTrack?.id === trackId;
      const nextCurrentIndex = nextQueue.findIndex((track) => track.id === s.currentTrack?.id);

      if (isCurrentRemoved) {
        const fallbackTrack = nextQueue[removedIndex] || nextQueue[removedIndex - 1] || null;
        return {
          queue: nextQueue,
          currentTrack: fallbackTrack,
          currentIndex: fallbackTrack ? nextQueue.findIndex((track) => track.id === fallbackTrack.id) : -1,
          isPlaying: Boolean(fallbackTrack),
          progress: 0,
        };
      }

      return {
        queue: nextQueue,
        currentIndex: nextCurrentIndex,
      };
    }),

  clearQueue: () =>
    set((s) => ({
      queue: s.currentTrack ? [s.currentTrack] : [],
      currentIndex: s.currentTrack ? 0 : -1,
    })),
  setPlayerCollapsed: (playerCollapsed) => set({ playerCollapsed }),

  uploadTrack: async (formData, onProgress) => {
    if (isPeerAvailable()) {
      // P2P: файл живёт локально. Читаем через FileReader и складываем в
      // mediaLibrary с data-URL — HTML5 audio нормально их воспроизводит.
      // Прогресс имитируем (files небольшие, чтения из ArrayBuffer в base64
      // достаточно быстрое).
      onProgress && onProgress(10);
      const file = formData.get('file') as File | null;
      if (!file) throw new Error('Файл не выбран');
      const title = (formData.get('title') as string) || file.name.replace(/\.[^.]+$/, '');
      const artist = (formData.get('artist') as string) || '';
      const durationRaw = formData.get('duration');
      const duration = durationRaw ? Number(durationRaw) : 0;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('read error'));
        r.readAsDataURL(file);
      });
      onProgress && onProgress(80);
      const id = 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const item = await peer.addMedia({
        id, title, artist, duration,
        mime: file.type || 'audio/mpeg', size: file.size,
        fileUrl: dataUrl, name: file.name,
      });
      onProgress && onProgress(100);
      const created: Track = {
        id: item.id, title: item.title, artist: item.artist || '', album: '',
        duration: item.duration || 0, fileUrl: item.fileUrl, coverUrl: '',
        playsCount: 0, createdAt: new Date(item.addedAt || Date.now()).toISOString(),
      };
      set((s) => ({
        tracks: [created, ...s.tracks],
        queue: s.queue.length ? [created, ...s.queue] : s.queue,
      }));
      return created;
    }
    const res = await musicApi.upload(formData, onProgress);
    const created: Track = res.data;
    set((s) => ({
      tracks: [created, ...s.tracks],
      queue: s.queue.length ? [created, ...s.queue] : s.queue,
    }));
    return created;
  },

  updateTrack: async (trackId, formData) => {
    if (isPeerAvailable()) {
      const patch: any = {};
      const title = formData.get('title'); if (title) patch.title = String(title);
      const artist = formData.get('artist'); if (artist) patch.artist = String(artist);
      const description = formData.get('description'); if (description) patch.description = String(description);
      const item = await peer.addMedia({ id: trackId, ...patch });
      const updated: Track = {
        id: item.id, title: item.title, artist: item.artist || '', album: '',
        duration: item.duration || 0, fileUrl: item.fileUrl, coverUrl: item.coverUrl || '',
        playsCount: item.playsCount || 0, createdAt: new Date(item.addedAt || Date.now()).toISOString(),
      };
      set((s) => ({
        tracks: s.tracks.map((t) => (t.id === trackId ? updated : t)),
        queue: s.queue.map((t) => (t.id === trackId ? updated : t)),
        currentTrack: s.currentTrack?.id === trackId ? updated : s.currentTrack,
      }));
      return updated;
    }
    const res = await musicApi.update(trackId, formData);
    const updated: Track = res.data;
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? updated : t)),
      queue: s.queue.map((t) => (t.id === trackId ? updated : t)),
      currentTrack: s.currentTrack?.id === trackId ? updated : s.currentTrack,
    }));
    return updated;
  },

  deleteTrack: async (trackId) => {
    if (isPeerAvailable()) {
      await peer.removeMedia(trackId);
    } else {
      await musicApi.delete(trackId);
    }
    set((s) => {
      const tracks = s.tracks.filter((t) => t.id !== trackId);
      const queue = s.queue.filter((t) => t.id !== trackId);
      const removedCurrent = s.currentTrack?.id === trackId;
      return {
        tracks,
        queue,
        currentTrack: removedCurrent ? null : s.currentTrack,
        currentIndex: removedCurrent ? -1 : queue.findIndex((t) => t.id === s.currentTrack?.id),
        isPlaying: removedCurrent ? false : s.isPlaying,
      };
    });
  },

  importUrl: async (url) => {
    const res = await musicApi.importUrl(url);
    const created: Track = res.data;
    set((s) => ({ tracks: [created, ...s.tracks] }));
    return created;
  },

  importZip: async (formData, onProgress) => {
    const res = await musicApi.importZip(formData, onProgress);
    const payload = res.data as { imported: number; skipped: string[]; tracks: Track[] };
    if (payload.tracks?.length) {
      set((s) => ({ tracks: [...payload.tracks, ...s.tracks] }));
    }
    return payload;
  },
    }),
    {
      name: 'vera-music',
      version: 1,
      // Сохраняем только компактные поля — не сохраняем треки (они грузятся с сервера)
      // ВАЖНО: не сохраняем currentTrack/queue целиком — в P2P у трека
      // fileUrl это data:audio/... (десятки МБ). Каждое движение слайдера
      // громкости/прогресса дергало set()→persist→JSON.stringify всего этого
      // в localStorage → фризы UI. Сохраняем только id, треки восстановятся
      // из mediaLibrary при loadTracks().
      partialize: (s) => ({
        volume: s.volume,
        repeat: s.repeat,
        shuffle: s.shuffle,
        playerCollapsed: s.playerCollapsed,
      }),
    }
  )
);
