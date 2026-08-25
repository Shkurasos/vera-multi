import { create } from 'zustand';
import { User } from '../types';
import { authApi } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { peer, isPeerAvailable } from '../services/peer';
import { useThemeStore } from './themeStore';
import { initArchive, closeArchive } from '../services/localArchive';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isPeerMode: boolean;
  setUser: (user: User) => void;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const _hasToken = !!localStorage.getItem('vera_token');

export function peerInfoToUser(info: Awaited<ReturnType<typeof peer.info>>): User {
  const p = info.profile || {};
  return {
    id: info.deviceId,
    username: p.username || info.name || info.deviceId.slice(0, 8),
    firstName: p.firstName || info.name || 'Vera',
    lastName: p.lastName || '',
    avatarUrl: p.avatarUrl || '',
    bio: p.bio || '',
    birthDate: p.birthDate || '',
    country: p.country || '',
    region: p.region || '',
    city: p.city || '',
    isOnline: true,
    createdAt: new Date().toISOString(),
  } as User;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('vera_token'),
  // Всегда true на старте: bootstrap либо валидирует токен, либо создаст аккаунт
  // по устройству через /auth/device.
  isLoading: true,
  isAuthenticated: false,
  isPeerMode: isPeerAvailable(),

  setUser: (user) => {
    localStorage.setItem('vera_user', JSON.stringify(user));
    set({ user });
  },

  login: (token, user) => {
    localStorage.setItem('vera_token', token);
    localStorage.setItem('vera_user', JSON.stringify(user));
    initArchive(user.id);
    if (!isPeerAvailable() && !token.startsWith('mock-token-')) {
      try { connectSocket(token); } catch {}
    }
    try {
      const themeId = Number((user as any).themeId || 0);
      const chatPhoto = (user as any).chatPhoto;
      // Применяем с сервера только если он реально что-то сохранил
      // (themeId > 0). Иначе не трогаем локально сохранённую тему.
      if (themeId > 0) useThemeStore.getState().setTheme(themeId);
      if (typeof chatPhoto === 'string' && chatPhoto) useThemeStore.getState().setChatPhoto(chatPhoto);
    } catch {}
    set({ token, user, isAuthenticated: true });
  },

  logout: async () => {
    if (!isPeerAvailable()) {
      try { await authApi.logout(); } catch {}
      disconnectSocket();
    }
    closeArchive();
    localStorage.removeItem('vera_token');
    set({ user: null, token: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    // P2P-режим: identity берём из локального узла.
    if (isPeerAvailable()) {
      set({ isLoading: true, isPeerMode: true });
      try {
        const info = await peer.info();
        const user = peerInfoToUser(info);
        localStorage.setItem('vera_user', JSON.stringify(user));
        initArchive(user.id);
        set({ user, token: info.deviceId, isAuthenticated: true });
      } catch (e) {
        console.error('[auth] peer.info failed', e);
      } finally {
        set({ isLoading: false });
      }
      return;
    }

    set({ isLoading: true });
    const existingToken = localStorage.getItem('vera_token');
    // 1) Если токен есть — валидируем через /auth/me.
    if (existingToken && !existingToken.startsWith('mock-token-')) {
      try {
        const res = await authApi.me();
        connectSocket(existingToken);
        try {
          const themeId = Number((res.data as any).themeId || 0);
          const chatPhoto = (res.data as any).chatPhoto;
          if (themeId > 0) useThemeStore.getState().setTheme(themeId);
          if (typeof chatPhoto === 'string' && chatPhoto) useThemeStore.getState().setChatPhoto(chatPhoto);
        } catch {}
        set({ user: res.data, isAuthenticated: true, token: existingToken, isLoading: false });
        try { if (res.data?.id) initArchive(res.data.id); } catch {}
        return;
      } catch {
        // Токен невалиден — попробуем переавторизоваться по устройству ниже.
        localStorage.removeItem('vera_token');
      }
    }

    // 2) Токена нет (или устарел) — авто-логин по deviceId.
    //    Правило VERA: 1 аккаунт = 1 устройство; второе добавляется QR-ом.
    try {
      const res = await authApi.device();
      const { accessToken, user } = res.data as any;
      localStorage.setItem('vera_token', accessToken);
      localStorage.setItem('vera_user', JSON.stringify(user));
      try { connectSocket(accessToken); } catch {}
      try {
        const themeId = Number((user as any).themeId || 0);
        const chatPhoto = (user as any).chatPhoto;
        if (themeId > 0) useThemeStore.getState().setTheme(themeId);
        if (typeof chatPhoto === 'string' && chatPhoto) useThemeStore.getState().setChatPhoto(chatPhoto);
      } catch {}
      set({ token: accessToken, user, isAuthenticated: true });
      try { if (user?.id) initArchive(user.id); } catch {}
    } catch (e) {
      console.error('[auth] device login failed', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));

