import { create } from 'zustand';
import { Playlist, Track } from '../types';
import { musicApi } from '../services/api';

interface PlaylistState {
  playlists: Playlist[];
  publicPlaylists: Playlist[];
  currentPlaylist: Playlist | null;
  loading: boolean;

  load: () => Promise<void>;
  create: (name: string, description?: string, isPublic?: boolean) => Promise<Playlist>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string, description?: string, isPublic?: boolean) => Promise<void>;
  searchPublic: (q?: string) => Promise<void>;
  copyPublic: (id: string) => Promise<Playlist>;
  addTrack: (playlistId: string, trackId: string) => Promise<void>;
  removeTrack: (playlistId: string, trackId: string) => Promise<void>;
  reorderTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  setCurrentPlaylist: (p: Playlist | null) => void;
  // Возвращает плоский массив треков в порядке воспроизведения
  getPlaylistTracks: (p: Playlist) => Track[];
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  publicPlaylists: [],
  currentPlaylist: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const res = await musicApi.getPlaylists();
      const list = Array.isArray(res.data) ? res.data : (res.data?.playlists || []);
      set({ playlists: list });
    } catch (e) {
      console.error('Не удалось загрузить плейлисты', e);
    } finally {
      set({ loading: false });
    }
  },

  create: async (name, description, isPublic) => {
    const res = await musicApi.createPlaylist(name, description, isPublic);
    const created: Playlist = res.data;
    set({ playlists: [created, ...get().playlists] });
    return created;
  },

  remove: async (id) => {
    await musicApi.deletePlaylist(id);
    set({
      playlists: get().playlists.filter(p => p.id !== id),
      currentPlaylist: get().currentPlaylist?.id === id ? null : get().currentPlaylist,
    });
  },

  rename: async (id, name, description, isPublic) => {
    const res = await musicApi.updatePlaylist(id, { name, description, isPublic });
    set({
      playlists: get().playlists.map(p => p.id === id ? res.data : p),
      currentPlaylist: get().currentPlaylist?.id === id ? res.data : get().currentPlaylist,
    });
  },

  searchPublic: async (q = '') => {
    const res = await musicApi.searchPublicPlaylists(q);
    const list = Array.isArray(res.data) ? res.data : (res.data?.playlists || []);
    set({ publicPlaylists: list });
  },

  copyPublic: async (id) => {
    const res = await musicApi.copyPlaylist(id);
    const copied: Playlist = res.data;
    set({ playlists: [copied, ...get().playlists] });
    return copied;
  },

  addTrack: async (playlistId, trackId) => {
    const res = await musicApi.addToPlaylist(playlistId, trackId);
    set({
      playlists: get().playlists.map(p => p.id === playlistId ? res.data : p),
      currentPlaylist: get().currentPlaylist?.id === playlistId ? res.data : get().currentPlaylist,
    });
  },

  removeTrack: async (playlistId, trackId) => {
    const res = await musicApi.removeFromPlaylist(playlistId, trackId);
    set({
      playlists: get().playlists.map(p => p.id === playlistId ? res.data : p),
      currentPlaylist: get().currentPlaylist?.id === playlistId ? res.data : get().currentPlaylist,
    });
  },

  reorderTracks: async (playlistId, trackIds) => {
    const res = await musicApi.reorderPlaylist(playlistId, trackIds);
    set({
      playlists: get().playlists.map(p => p.id === playlistId ? res.data : p),
      currentPlaylist: get().currentPlaylist?.id === playlistId ? res.data : get().currentPlaylist,
    });
  },

  setCurrentPlaylist: (p) => set({ currentPlaylist: p }),

  getPlaylistTracks: (p) => {
    if (!p || !p.tracks) return [];
    return [...p.tracks]
      .sort((a, b) => a.position - b.position)
      .map(pt => pt.track);
  },
}));
