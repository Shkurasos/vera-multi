import { create } from 'zustand';
import {
  offlineSet, offlineSetMany, offlineGet, offlineGetAll,
  offlineGetMany, offlineDelete, offlineClear, offlineHasStore,
} from '../services/offlineDb';
import {
  cacheFile, getCachedFile, getCachedFileUrl, hasCachedFile,
  removeCachedFile, clearFileCache, fetchAndCache,
} from '../services/fileCache';

/* ─── OfflineStore ─────────────────────────────────────────────────────────
 * Кэш для офлайн-режима десктоп-приложения.
 * Когда приложение без сети, данные берутся из IndexedDB.
 * Когда сеть есть — данные пишутся в IndexedDB параллельно с сервером.
 */

/** Сколько последних сообщений чата держим в офлайн-кэше (= OFFLINE_MESSAGE_LIMIT в chatStore). */
export const OFFLINE_CACHE_MESSAGES = 10;

export interface CachedTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  duration: number;
  fileUrl: string;
  coverUrl?: string;
  uploadedById?: string;
  isPublic?: boolean;
  createdAt: string;
}

export interface CachedMessage {
  id: string;
  chatId: string;
  senderId: string;
  content?: string;
  type: string;
  createdAt: string;
  readed?: boolean;
}

export interface CachedAvatar {
  id: string; // userId
  avatarUrl: string;
  updatedAt: string;
}

export interface CachedSkin {
  id: string;
  name: string;
  type: string;
  dataFormat: string;
  createdAt: string;
}

export interface CachedTheme {
  id: string;
  name: string;
  configJson: string;
  isDefault: boolean;
  createdAt: string;
}

export interface CachedIcon {
  id: string;
  name: string;
  packId?: string;
  dataUrl?: string;
  createdAt: string;
}

interface OfflineState {
  initialized: boolean;
  init: () => Promise<void>;
  // Музыка
  cacheMusicLibrary: (tracks: CachedTrack[]) => Promise<void>;
  getCachedMusicLibrary: () => Promise<CachedTrack[]>;
  // Аватары
  cacheAvatar: (userId: string, avatarUrl: string, updatedAt: string) => Promise<void>;
  getCachedAvatar: (userId: string) => Promise<CachedAvatar | null>;
  getCachedAvatars: (userIds: string[]) => Promise<CachedAvatar[]>;
  // Плейлисты (вместе с треками) — для музыки без сети
  cachePlaylists: (playlists: Array<{ id: string; [key: string]: any }>) => Promise<void>;
  getCachedPlaylists: () => Promise<any[]>;
  // Сообщения (последние 10 на чат)
  cacheMessages: (chatId: string, messages: CachedMessage[]) => Promise<void>;
  getCachedMessages: (chatId: string) => Promise<CachedMessage[]>;
  // Скины
  cacheSkins: (skins: CachedSkin[]) => Promise<void>;
  getCachedSkins: () => Promise<CachedSkin[]>;
  // Темы
  cacheThemes: (themes: CachedTheme[]) => Promise<void>;
  getCachedThemes: () => Promise<CachedTheme[]>;
  // Иконки
  cacheIcons: (icons: CachedIcon[]) => Promise<void>;
  getCachedIcons: () => Promise<CachedIcon[]>;
  // Профиль
  cacheUserProfile: (profile: any) => Promise<void>;
  getCachedUserProfile: () => Promise<any | null>;
  // Файловый кэш (аватарки, обложки, аудио blobs)
  cacheFileBlob: (key: string, blob: Blob, originalUrl?: string) => Promise<void>;
  getCachedFileBlob: (key: string) => Promise<Blob | null>;
  getCachedFileUrl: (key: string) => Promise<string | null>;
  hasCachedFile: (key: string) => Promise<boolean>;
  fetchAndCacheFile: (url: string, key?: string) => Promise<string>;
  removeCachedFile: (key: string) => Promise<void>;
  clearFileCache: () => Promise<void>;
  // Очистка
  clearAll: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    try {
      await offlineHasStore('music_library');
      set({ initialized: true });
    } catch (e) {
      console.error('[offline] IndexedDB init failed', e);
    }
  },

  cacheMusicLibrary: async (tracks) => {
    // Медиатека целиком заменяет прежнюю: удалённые треки не всплывают офлайн.
    await offlineClear('music_library');
    await offlineSetMany('music_library', tracks.map(t => ({ id: t.id, ...t })));
  },
  getCachedMusicLibrary: async () => {
    return offlineGetAll('music_library');
  },

  cacheAvatar: async (userId, avatarUrl, updatedAt) => {
    await offlineSet('avatars', userId, { id: userId, avatarUrl, updatedAt });
  },
  getCachedAvatar: async (userId) => {
    return offlineGet('avatars', userId);
  },
  getCachedAvatars: async (userIds) => {
    return offlineGetMany('avatars', userIds);
  },

  cacheMessages: async (chatId, messages) => {
    // Офлайн нужны только последние сообщения чата — храним не больше лимита.
    const tail = messages.slice(-OFFLINE_CACHE_MESSAGES);
    await offlineSet('messages', chatId, { id: chatId, messages: tail, count: tail.length });
  },
  getCachedMessages: async (chatId) => {
    const data = await offlineGet('messages', chatId);
    return data ? data.messages : [];
  },

  cacheSkins: async (skins) => {
    await offlineSetMany('skins', skins.map(s => ({ id: s.id, ...s })));
  },
  getCachedSkins: async () => {
    return offlineGetAll('skins');
  },

  cacheThemes: async (themes) => {
    await offlineSetMany('themes', themes.map(t => ({ id: t.id, ...t })));
  },
  getCachedThemes: async () => {
    return offlineGetAll('themes');
  },

  cacheIcons: async (icons) => {
    await offlineSetMany('icons', icons.map(i => ({ id: i.id, ...i })));
  },
  getCachedIcons: async () => {
    return offlineGetAll('icons');
  },

  cacheUserProfile: async (profile) => {
    await offlineSet('user_profile', 'me', profile);
  },
  getCachedUserProfile: async () => {
    return offlineGet('user_profile', 'me');
  },
  // Файловый кэш
  cacheFileBlob: async (key, blob, originalUrl) => {
    await cacheFile(key, blob, originalUrl);
  },
  getCachedFileBlob: async (key) => {
    return getCachedFile(key);
  },
  getCachedFileUrl: async (key) => {
    return getCachedFileUrl(key);
  },
  hasCachedFile: async (key) => {
    return hasCachedFile(key);
  },
  fetchAndCacheFile: async (url, key) => {
    return fetchAndCache(url, key);
  },
  removeCachedFile: async (key) => {
    await removeCachedFile(key);
  },
  clearFileCache: async () => {
    await clearFileCache();
  },

  cachePlaylists: async (playlists) => {
    await offlineClear('playlists');
    await offlineSetMany('playlists', playlists.filter(p => p && p.id));
  },
  getCachedPlaylists: async () => {
    return offlineGetAll('playlists');
  },

  clearAll: async () => {
    for (const store of ['music_library', 'music_files', 'playlists', 'avatars', 'messages', 'skins', 'themes', 'icons', 'user_profile']) {
      try { await offlineClear(store); } catch {}
    }
    set({ initialized: false });
  },
}));