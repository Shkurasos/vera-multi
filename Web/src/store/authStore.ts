import { create } from 'zustand';
import { User } from '../types';
import { authApi } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { peer, isPeerAvailable } from '../services/peer';
import { THEMES, useThemeStore } from './themeStore';
import { initArchive, closeArchive } from '../services/localArchive';
import { hydrateSettingsFromServer, startSettingsAutoSync } from './userSettingsStore';
import { initStoreSyncOnLogin, disableAllStoreSync } from '../services/storeSyncSimple';
import { prepareSettingsForAccount, disableSettingsSync } from './userSettingsStore';
import { usePetStore } from './petStore';
import { useReactionSkinStore } from './reactionSkinStore';
import {
  offlineLockInfo, verifyOfflinePassword, syncOfflineCredentialUser, clearOfflineCredential,
  type OfflineLockInfo,
} from '../services/offlineAuth';
import { isAppOffline, setAppOffline } from '../services/offlineMode';
import {
  isDesktop, saveSecureSession, loadSecureSession, clearSecureSession,
} from '../services/desktopSecure';
import { useUserSettingsStore } from './userSettingsStore';
import { startIconPackSync, stopIconPackSync } from '../services/iconPackSync';

/** Ответа нет совсем (сеть, таймаут) или сервер лежит (Render 502/503). */
function isUnreachable(e: any): boolean {
  const status = e?.response?.status;
  return !status || status >= 500;
}

/**
 * Десктоп: после успешного входа кладём токен и снимок профиля в защищённое
 * хранилище ОС (safeStorage/DPAPI), чтобы при следующем запуске без сети
 * открыть аккаунт без пароля. В вебе — no-op. Не ждём завершения: запись в
 * secure-store не должна задерживать вход.
 */
function persistSecureSession(token: string | null | undefined, user: User | null | undefined): void {
  if (!token || !isDesktop()) return;
  void saveSecureSession(token, user ?? null);
}

async function hydrateAccount(user: User): Promise<void> {
  const changed = localStorage.getItem('vera_sync_active_account') !== user.id;
  localStorage.setItem('vera_user', JSON.stringify(user));
  // Офлайн-пароль принадлежит только последнему вошедшему аккаунту.
  syncOfflineCredentialUser(user);
  disableSettingsSync();
  await initStoreSyncOnLogin(user.id, () => {
    const rawThemeId = (user as any).themeId;
    const hasTheme = rawThemeId !== null && rawThemeId !== undefined && rawThemeId !== '';

    if (!hasTheme) {
      // Новый аккаунт без сохранённой темы — назначаем случайную тему из каталога.
      // setTheme применяет настройки темы, сохраняет выбор на сервере и
      // прокидывает themeId/theme в стор. chatPhoto задаём отдельно.
      const randomTheme = THEMES[Math.floor(Math.random() * THEMES.length)] || THEMES[0];
      useThemeStore.getState().setTheme(randomTheme.id);
      useThemeStore.setState({ chatPhoto: (user as any).chatPhoto || undefined });
    } else {
      const themeId = Number(rawThemeId);
      const theme = useThemeStore.getState().customThemes.find((t) => t.id === themeId)
        || useThemeStore.getState().builtinThemes.find((t) => t.id === themeId)
        || THEMES.find((t) => t.id === themeId)
        || THEMES[0];
      useThemeStore.setState({ themeId, theme, chatPhoto: (user as any).chatPhoto || undefined });
    }
  });
  prepareSettingsForAccount(user.id, changed);
  // Свои паки иконок — отдельным каналом (они не влезают в синк сторов).
  // Не ждём: докачка паков с картинками не должна задерживать вход.
  void startIconPackSync(user.id, changed);
  // Надетые скины хранятся в профиле на сервере: без этого другое устройство
  // показывало свой локальный образ. Динамический импорт — shopStore сам
  // импортирует authStore.
  const { useShopStore } = await import('./shopStore');
  useShopStore.getState().hydrateEquipment(user);
  await hydrateSettingsFromServer();
  void usePetStore.getState().load().catch(() => undefined);
  // Слоты реакций — сразу после входа/F5: иначе до открытия инвентаря
  // (он делал load кейсов со слотами) пикер и профиль показывали сток.
  void useReactionSkinStore.getState().load().catch(() => undefined);
  startSettingsAutoSync(user.id);
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isPeerMode: boolean;
  /**
   * Аккаунт забанен администрацией. Вход не проходит, но приложение должно
   * показать причину и кнопку апелляции, а не молчаливый экран входа.
   */
  isBanned: boolean;
  /** Сервер недоступен: вместо формы входа — экран «введите пароль». */
  offlineLock: OfflineLockInfo | null;
  /** Вошли без сети по сохранённому паролю — данные только локальные. */
  isOfflineSession: boolean;
  unlockOffline: (password: string) => Promise<boolean>;
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
    avatarUrl: p.avatarUrl || '',
    bio: p.bio || '',
    country: p.country || '',
    region: p.region || '',
    city: p.city || '',
    isOnline: true,
    createdAt: new Date().toISOString(),
  } as User;
}

let reconnectTimer: ReturnType<typeof setInterval> | null = null;
let reconnecting = false;

function stopOfflineReconnect(): void {
  if (reconnectTimer) clearInterval(reconnectTimer);
  reconnectTimer = null;
  if (typeof window !== 'undefined') window.removeEventListener('online', tryReconnect);
}

/**
 * Сервер снова отвечает — выходим из офлайна без перезагрузки (музыка не
 * обрывается). Проверяем голым fetch: axios-перехватчик в офлайне отдаёт кэш.
 */
async function tryReconnect(): Promise<void> {
  if (reconnecting) return;
  reconnecting = true;
  try {
    const token = localStorage.getItem('vera_token');
    // vera-probe: сервис-воркер пропускает запрос мимо своего кэша.
    const res = await fetch(`/api/auth/me?vera-probe=${Date.now()}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status >= 500) return;
    stopOfflineReconnect();
    setAppOffline(false);
    if (!res.ok || !token) {
      // Токен истёк или его нет — обычный вход разберётся сам.
      window.location.reload();
      return;
    }
    const user = (await res.json()) as User;
    try { await authApi.device(); } catch {}
    connectSocket(token);
    await hydrateAccount(user);
    persistSecureSession(token, user);
    useAuthStore.setState({ user, token, isAuthenticated: true, isOfflineSession: false, offlineLock: null });
    const [{ useChatStore }, { useMusicStore }] = await Promise.all([import('./chatStore'), import('./musicStore')]);
    void useChatStore.getState().loadChats();
    void useMusicStore.getState().loadTracks().catch(() => {});
  } catch {
    // Сети всё ещё нет — следующая попытка по таймеру или событию online.
  } finally {
    reconnecting = false;
  }
}

function startOfflineReconnect(): void {
  stopOfflineReconnect();
  reconnectTimer = setInterval(() => { void tryReconnect(); }, 20_000);
  window.addEventListener('online', tryReconnect);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('vera_token'),
  // Всегда true на старте: bootstrap либо валидирует токен, либо создаст аккаунт
  // по устройству через /auth/device.
  isLoading: true,
  isAuthenticated: false,
  isPeerMode: isPeerAvailable(),
  isBanned: false,
  offlineLock: null,
  isOfflineSession: false,

  unlockOffline: async (password) => {
    const user = await verifyOfflinePassword(password);
    if (!user) return false;
    try { initArchive(user.id); } catch {}
    set({
      user, token: localStorage.getItem('vera_token'),
      isAuthenticated: true, isOfflineSession: true, offlineLock: null,
    });
    startOfflineReconnect();
    return true;
  },

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
      persistSecureSession(token, user);
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
    disableSettingsSync();
    disableAllStoreSync();
    stopIconPackSync();
    stopOfflineReconnect();
    // Вышел сам — без сети этот аккаунт больше не открывается.
    clearOfflineCredential();
    void clearSecureSession();
    localStorage.removeItem('vera_token');
    localStorage.removeItem('vera_user');
    set({ user: null, token: null, isAuthenticated: false, isOfflineSession: false, offlineLock: null });
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

    set({ isLoading: true, offlineLock: null });
    // Повторная проверка (кнопка «Проверить подключение») — старый таймер не нужен.
    stopOfflineReconnect();

    // Сервер недоступен: сначала пробуем открыть аккаунт без пароля из
    // защищённого хранилища (десктоп, safeStorage/DPAPI) — если это включено
    // в настройках. Иначе спрашиваем пароль последнего пользователя этого
    // устройства (offlineAuth). Никого не было — форма входа.
    const enterOfflineLock = async () => {
      setAppOffline(true);
      // Десктопный авто-вход без сети: расшифровываем токен/профиль из
      // secure-store и открываем аккаунт. Пароль не спрашиваем.
      if (isDesktop() && useUserSettingsStore.getState().desktopAutoUnlock) {
        try {
          const sess = await loadSecureSession();
          const cachedRaw = localStorage.getItem('vera_user');
          const cachedUser = cachedRaw ? (JSON.parse(cachedRaw) as User) : null;
          const user = (sess?.user as User) || cachedUser;
          if (sess?.token && user?.id) {
            localStorage.setItem('vera_token', sess.token);
            localStorage.setItem('vera_user', JSON.stringify(user));
            try { initArchive(user.id); } catch {}
            set({
              user, token: sess.token,
              isAuthenticated: true, isOfflineSession: true,
              offlineLock: null, isLoading: false,
            });
            startOfflineReconnect();
            return;
          }
        } catch { /* не вышло — покажем обычный офлайн-замок ниже */ }
      }
      set({ offlineLock: offlineLockInfo(), isAuthenticated: false, isLoading: false });
      startOfflineReconnect();
    };

    setAppOffline(false);
    if (isAppOffline()) {
      await enterOfflineLock();
      return;
    }

    const existingToken = localStorage.getItem('vera_token');
    // 1) Если токен есть — валидируем через /auth/me.
    if (existingToken && !existingToken.startsWith('mock-token-')) {
      try {
        const res = await authApi.me();
        // Migrate an authenticated installation to its private cookie credential.
        await authApi.device();
        connectSocket(existingToken);
        await hydrateAccount(res.data);
        persistSecureSession(existingToken, res.data);
        set({ user: res.data, isAuthenticated: true, token: existingToken, isLoading: false });
        try { if (res.data?.id) initArchive(res.data.id); } catch {}
        return;
      } catch (e: any) {
        // Токен невалиден — попробуем переавторизоваться по устройству ниже.
        // Бан ловим отдельно: это не «токен протух», а приговор аккаунту.
        if (e?.response?.data?.code === 'ACCOUNT_BANNED') {
          set({ isBanned: true });
          return;
        }
        // Сервер не ответил — токен не виноват, не стираем его.
        if (isUnreachable(e)) {
          await enterOfflineLock();
          return;
        }
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
      persistSecureSession(accessToken, user);
      try { connectSocket(accessToken); } catch {}
      await hydrateAccount(user);
      set({ token: accessToken, user, isAuthenticated: true, isLoading: false });
      try { if (user?.id) initArchive(user.id); } catch {}
    } catch (e: any) {
      // Сервер отвечает 403 + code: ACCOUNT_BANNED на забаненном аккаунте.
      // Показываем экран с апелляцией вместо бесконечной попытки войти.
      if (e?.response?.data?.code === 'ACCOUNT_BANNED') {
        set({ isBanned: true, isAuthenticated: false });
        return;
      }
      if (isUnreachable(e)) {
        await enterOfflineLock();
        return;
      }
      console.error('[auth] device login failed', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));

