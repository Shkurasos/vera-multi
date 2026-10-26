
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useOfflineStore } from '../store/offlineStore';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

/* ─── Офлайн-определение ───────────────────────────────────────────────────
 * В Electron спрашиваем главный процесс (veraDesktop.isOnline),
 * в браузере — navigator.onLine.
 */
function isOffline(): boolean {
  if (typeof window !== 'undefined' && (window as any).veraDesktop) {
    // Синхронно не получится — isOnline возвращает Promise.
    // Используем navigator.onLine как быструю оценку, уточнение приходит по IPC.
    return !navigator.onLine;
  }
  return !navigator.onLine;
}

/** Эндпоинты, которые кэшируются для офлайн (путь -> имя стора в IndexedDB). */
const CACHEABLE_GET: Record<string, string> = {
  '/tracks': 'music_library',
  '/music/library': 'music_library',
  '/messages/': 'messages',
  '/auth/me': 'user_profile',
  '/users/': 'avatars',
  '/themes': 'themes',
  '/skins': 'skins',
  '/icons': 'icons',
};

/** Извлечь имя стора по URL. */
function cacheStoreForUrl(url: string): string | null {
  const path = url.replace('/api', '');
  for (const [prefix, store] of Object.entries(CACHEABLE_GET)) {
    if (path.startsWith(prefix)) return store;
  }
  return null;
}

/** Кэшировать ответ GET-запроса. */
async function cacheResponse(url: string, data: any): Promise<void> {
  const store = cacheStoreForUrl(url);
  if (!store) return;
  try {
    const offlineStore = useOfflineStore.getState();
    if (store === 'messages') {
      // URL: /messages/:chatId — извлекаем chatId и кэшируем массив сообщений.
      const m = url.match(/\/messages\/([^\/]+)/);
      if (m && Array.isArray(data)) {
        await offlineStore.cacheMessages(m[1], data);
      }
      return;
    }
    if (store === 'user_profile') {
      await offlineStore.cacheUserProfile(data);
      return;
    }
    if (store === 'avatars') {
      // Ответ может быть одним пользователем или списком.
      const users = Array.isArray(data) ? data : [data];
      for (const u of users) {
        if (u?.id && u.avatarUrl) {
          await offlineStore.cacheAvatar(u.id, u.avatarUrl, u.updatedAt || new Date().toISOString());
        }
      }
      return;
    }
    if (Array.isArray(data)) {
      await offlineStore.cacheMusicLibrary(data); // по умолчанию музыка
      if (store === 'themes') await offlineStore.cacheThemes(data);
      if (store === 'skins') await offlineStore.cacheSkins(data);
      if (store === 'icons') await offlineStore.cacheIcons(data);
    } else if (data && data.items) {
      await offlineStore.cacheMusicLibrary(data.items);
    }
  } catch { /* офлайн-кэш не критичен */ }
}

/** Вернуть кэшированные данные для GET-запроса, если есть. */
async function getCachedResponse(url: string): Promise<any | null> {
  const store = cacheStoreForUrl(url);
  if (!store) return null;
  try {
    const offlineStore = useOfflineStore.getState();
    if (store === 'messages') {
      const m = url.match(/\/messages\/([^\/]+)/);
      if (m) {
        return await offlineStore.getCachedMessages(m[1]);
      }
      return null;
    }
    if (store === 'user_profile') return await offlineStore.getCachedUserProfile();
    if (store === 'avatars') return null; // аватары кэшируются по個別に через getCachedAvatar
    if (store === 'music_library') return await offlineStore.getCachedMusicLibrary();
    if (store === 'themes') return await offlineStore.getCachedThemes();
    if (store === 'skins') return await offlineStore.getCachedSkins();
    if (store === 'icons') return await offlineStore.getCachedIcons();
  } catch { /* ignore */ }
  return null;
}

// SEC: CSRF double-submit — читаем vera_csrf (non-HttpOnly) и кладём в заголовок.
function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vera_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // CSRF нужен только на mutating-запросах, но лишний header не мешает.
  const csrf = readCookie('vera_csrf');
  if (csrf) config.headers['X-CSRF-Token'] = csrf;
  return config;
});

// Offline: если нет сети и это GET-запрос к кэшируемому эндпоинту — отдаём кэш.
api.interceptors.request.use(async (config) => {
  const url = config.url || '';
  if (config.method?.toLowerCase() === 'get' && isOffline()) {
    const cached = await getCachedResponse(url);
    if (cached != null) {
      // Возвращаем фейковый ответ Axios с кэшированными данными.
      return Promise.resolve({
        data: cached,
        status: 200,
        statusText: 'OK (offline cache)',
        headers: {},
        config,
      } as any);
    }
    // Нет кэша — не можем выполнить запрос без сети.
    return Promise.reject(new Error('Offline and no cached data'));
  }
  return config;
}, (err) => Promise.reject(err));

// SEC: одноразовая попытка /auth/refresh на 401. Если удалось — повторяем запрос.
// Если refresh тоже упал — чистим стейт и ре-бутстрапим.
let refreshInFlight: Promise<string | null> | null = null;
async function tryRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const csrf = readCookie('vera_csrf');
      const res = await axios.post('/api/auth/refresh', {}, {
        withCredentials: true,
        timeout: 15000,
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      });
      const newToken = (res.data as any)?.accessToken;
      if (newToken) {
        localStorage.setItem('vera_token', newToken);
        return newToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      // Сбрасываем в следующем tick, чтобы параллельные 401 успели присоединиться.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

api.interceptors.response.use(
  (res) => {
    if (res.config.url === '/auth/device' || res.config.url === '/devices/link/accept'
      || res.config.url === '/auth/login' || res.config.url === '/auth/register') {
      if (typeof res.data?.deviceId === 'string') localStorage.setItem('vera_device_id', res.data.deviceId);
    }
    // Кэшируем успешные GET-ответы к кэшируемым эндпоинтам.
    if (res.config?.method?.toLowerCase() === 'get') {
      void cacheResponse(res.config.url || '', res.data);
    }
    return res;
  },
  async (err: AxiosError) => {
    const cfg = err.config as AxiosRequestConfig & { _retry?: boolean };
    const url = cfg?.url || '';
    const status = err.response?.status;
    const isBootstrap = url.includes('/auth/device') || url.includes('/auth/me') || url.includes('/auth/refresh')
      || url.includes('/auth/login') || url.includes('/auth/register');
    if (status === 401 && !cfg?._retry && !isBootstrap) {
      cfg._retry = true;
      const newToken = await tryRefresh();
      if (newToken) {
        cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${newToken}` };
        return api.request(cfg);
      }
      // Refresh не удался — полный ре-бутстрап.
      localStorage.removeItem('vera_token');
      localStorage.removeItem('vera_user');
      window.location.href = '/';
    }
    return Promise.reject(err);
  },
);

export const authApi = {
  device: () => api.post('/auth/device', { deviceId: getDeviceId(), deviceName: getDeviceName() }, { timeout: 15000 }),
  /** Регистрация по нику и паролю; почта и телефон необязательны. */
  register: (username: string, password: string, email?: string, phone?: string) => api.post('/auth/register', { username, password, email: email || undefined, phone: phone || undefined, deviceId: getDeviceId(), deviceName: getDeviceName() }, { timeout: 30000 }),
  /** Вход по нику (или почте) и паролю — работает на любом устройстве. */
  login: (identifier: string, password: string) => api.post('/auth/login', { identifier, password, deviceId: getDeviceId(), deviceName: getDeviceName() }, { timeout: 30000 }),
  /** Задать пароль (старым аккаунтам без него) или сменить текущий. */
  setPassword: (newPassword: string, currentPassword?: string) => api.post('/auth/password', { newPassword, currentPassword }, { timeout: 30000 }),
  loginEvents: () => api.get('/auth/login-events'),
  passkey: { registerOptions: () => api.post('/auth/passkey/register/options'), registerVerify: (response: unknown) => api.post('/auth/passkey/register/verify', response), loginOptions: (identifier?: string) => api.post('/auth/passkey/login/options', { identifier }), loginVerify: (response: unknown) => api.post('/auth/passkey/login/verify', response) },
  me: () => api.get('/auth/me', { timeout: 15000 }),
  logout: () => api.post('/auth/logout'),
};

/**
 * Идентификатор устройства: генерируем один раз на браузер/приложение и храним
 * в localStorage. Именно на нём работает правило «1 аккаунт = 1 устройство,
 * второе добавляется только по QR/ссылке».
 */
export function getDeviceId(): string {
  let id = localStorage.getItem('vera_device_id');
  if (!id) {
    id = 'dev_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('vera_device_id', id);
  }
  return id;
}

export function getDeviceName(): string {
  const saved = localStorage.getItem('vera_device_name');
  if (saved) return saved;
  const ua = navigator.userAgent || '';
  let name = 'Браузер';
  if (ua.includes('Electron')) name = 'Vera Desktop';
  else if (/Android/i.test(ua)) name = 'Android';
  else if (/(iPhone|iPad)/i.test(ua)) name = 'iOS';
  else if (/Windows/i.test(ua)) name = 'Windows';
  else if (/Mac/i.test(ua)) name = 'macOS';
  return name;
}

export const devicesApi = {
  list: () => api.get('/devices'),
  createLink: () => api.post('/devices/link/create'),
  acceptLink: (token: string) => api.post('/devices/link/accept', {
    token, deviceId: getDeviceId(), deviceName: getDeviceName(),
  }),
  remove: (id: string) => api.delete(`/devices/${id}`),
  rename: (name: string) => api.post('/devices/name', { name, deviceId: getDeviceId() }),
  callLog: () => api.get('/call-log'),
};

/* ─── ВП-кошелёк / крипто-пополнение (NOWPayments) ─────────────────────── */
export const walletApi = {
  cases: () => api.get('/cases'),
  buyCase: (caseId: string) => api.post('/cases/buy', { caseId }),
  openCase: (caseId: string) => api.post('/cases/open', { caseId }),
  /** Баланс ВП + купленные товары. */
  get: () => api.get('/wallet'),
  /** Создать инвойс на пополнение (amount — в ВП). */
  topup: (amount: number) => api.post('/wallet/topup', { amount }),
  /** Статус инвойса (поллинг). */
  orderStatus: (orderId: string) => api.get(`/wallet/orders/${orderId}`),
  /** Mock-оплата (только когда NOWPAYMENTS_API_KEY не задан). */
  mockPay: (orderId: string) => api.post('/wallet/mock-pay', { orderId }),
  /** Купить платный товар — списание ВП с баланса. */
  buy: (itemId: string) => api.post('/shop/buy', { itemId }),
};

export interface MarketListing {
  id: string;
  itemId: string;
  sellerId: string;
  seller: string;
  price: number;
  createdAt: number;
  isMine?: boolean;
}

export const marketApi = {
  list: () => api.get<{ listings: MarketListing[] }>('/market'),
  create: (itemId: string, price: number) => api.post<{ listing: MarketListing; balance: number }>('/market/list', { itemId, price }),
  cancel: (id: string) => api.post<{ ok: boolean; itemId: string }>(`/market/${id}/cancel`),
  buy: (id: string) => api.post<{ ok: boolean; balance: number; ownedItems: string[] }>(`/market/${id}/buy`),
};

export const usersApi = {
  me: () => api.get('/auth/me'),
  update: (data: any) => api.patch('/users/me', data),
  updateMe: (data: any) => api.patch('/users/me', data),
  search: (q: string) => api.get(`/users/search?q=${encodeURIComponent(q)}`),
  getById: (id: string) => api.get(`/users/${id}`),
  getReputation: (id: string) => api.get(`/users/${id}/reputation`),
  rateUser: (id: string, value: string, comment?: string) => api.put(`/users/${id}/reputation`, { value, comment }),
  uploadAvatar: (formData: FormData) => api.put('/users/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  setFavoriteTrack: (trackId: string | null) =>
    api.patch('/users/me/favorite-track', { trackId }),
  updateTheme: (themeId: number) =>
    api.patch('/users/me', { themeId }),
};

export const petsApi = {
  get: () => api.get('/pets'),
  setEquipment: (petId: string | null, settings?: any) => api.put('/pets/equipment', { petId, settings }),
};

/** Скины реакций: владение и 10 слотов быстрых реакций. */
export const reactionsApi = {
  get: () => api.get<{ reactionSkins: Record<string, number>; reactionSlots: string[] }>('/reactions'),
  setSlots: (slots: string[]) => api.put<{ reactionSkins: Record<string, number>; reactionSlots: string[] }>('/reactions/slots', { slots }),
};

export const adminApi = {
  grantVp: (username: string, amount: number) => api.post('/admin/wallet/grant', { username, amount }),
  listIpBans: () => api.get('/admin/ip-bans'),
  banIp: (ip: string, expiresInMinutes = 0, reason?: string) =>
    api.post('/admin/ip-bans', { ip, expiresInMinutes, reason }),
  unbanIp: (ip: string) => api.delete(`/admin/ip-bans/${encodeURIComponent(ip)}`),
};

/**
 * Каталог встроенных тем. Правит его только админ, но читают все клиенты:
 * заводские темы + правки (`overrides`), удалённые (`removed`) и добавленные
 * админом стоковые (`added`). Публикация — PUT, остальным клиентам приходит
 * событием `themes:updated`.
 */
export const themesApi = {
  get: () => api.get<{ themes: any }>('/themes'),
  save: (payload: { overrides: Record<string, any>; removed: number[]; added: any[] }) =>
    api.put<{ ok: boolean; themes: any }>('/themes', payload),
};

export type CommunityTheme = {
  id: string;
  name: string;
  description: string;
  authorId: string;
  authorName: string;
  theme: any;
  previewUrl: string | null;
  assetUrl: string | null;
  assetType: 'font' | 'image' | null;
  downloads: number;
  createdAt: string;
};

export const communityThemesApi = {
  list: (q = '') => api.get<{ themes: CommunityTheme[] }>('/community/themes', { params: q ? { q } : undefined }),
  upload: (theme: Blob, name: string, description: string, preview?: File, asset?: File) => {
    const form = new FormData();
    form.append('theme', theme, 'theme.json');
    form.append('name', name);
    form.append('description', description);
    if (preview) form.append('preview', preview, preview.name);
    if (asset) form.append('asset', asset, asset.name);
    return api.post<{ theme: CommunityTheme }>('/community/themes', form);
  },
  install: (id: string) => api.post<{ theme: CommunityTheme }>(`/community/themes/${encodeURIComponent(id)}/install`),
  download: (id: string) => api.get<Blob>(`/community/themes/${encodeURIComponent(id)}/download`, { responseType: 'blob' }),
  remove: (id: string) => api.delete(`/community/themes/${encodeURIComponent(id)}`),
};

export type CommunityIconPack = {
  id: string;
  name: string;
  description: string;
  base: string;
  authorId: string;
  authorName: string;
  iconCount: number;
  /** Несколько слотов для карточки (тот же формат, что и в паке). */
  preview: Record<string, any>;
  downloads: number;
  createdAt: string;
};

/** Каталог паков иконок сообщества (Server/community-icon-packs.js). */
export const communityIconPacksApi = {
  list: (q = '') => api.get<{ packs: CommunityIconPack[] }>('/community/icon-packs', { params: q ? { q } : undefined }),
  publish: (pack: unknown, name: string, description: string) =>
    api.post<{ pack: CommunityIconPack }>('/community/icon-packs', { pack, name, description }),
  get: (id: string, install = false) =>
    api.get<{ item: CommunityIconPack; pack: any }>(`/community/icon-packs/${encodeURIComponent(id)}`, { params: install ? { install: 1 } : undefined }),
  remove: (id: string) => api.delete(`/community/icon-packs/${encodeURIComponent(id)}`),
};

/**
 * Фото-обои: админ загружает файл на сервер (POST /themes/wallpapers) или
 * заводит css-фон градиентом (POST /themes/wallpapers/base), и они появляются
 * в общей галерее обоев у ВСЕХ пользователей.
 *
 * Загруженные фото НЕ кладутся в localStorage (это мегабайты) — приходят
 * ссылкой на /uploads/wallpapers/... и живут только на сервере.
 */

export const wallpapersApi = {
  get: () => api.get<{ wallpapers: any }>('/themes/wallpapers'),
  /** Загрузка файла-фона. `file` — File/Blob, name и light уходят формой. */
  upload: (file: File | Blob, name: string, light?: boolean) => {
    const form = new FormData();
    const filename = (file as File).name || 'wallpaper.jpg';
    form.append('file', file, filename);
    form.append('name', name);
    if (light) form.append('light', '1');
    return api.post('/themes/wallpapers', form);
  },
  /** Фон-градиент: только css, без url(). */
  addBase: (payload: { name: string; css: string; light?: boolean }) =>
    api.post('/themes/wallpapers/base', payload),
  /** Переименование / переключение «светлый» / новый css — id не меняется. */
  update: (id: string, payload: { name?: string; light?: boolean; css?: string }) =>
    api.put(`/themes/wallpapers/${encodeURIComponent(id)}`, payload),
  /** Замена картинки фото-фона: id сохраняется, меняется сам файл. */
  replace: (id: string, file: File | Blob, name?: string, light?: boolean) => {
    const form = new FormData();
    form.append('file', file, (file as File).name || 'wallpaper.jpg');
    if (name) form.append('name', name);
    if (light) form.append('light', '1');
    return api.post(`/themes/wallpapers/${encodeURIComponent(id)}/replace`, form);
  },
  remove: (id: string) => api.delete(`/themes/wallpapers/${encodeURIComponent(id)}`),
};

/**
 * Общие стоковые шрифты админа: он заливает файл на сервер, и шрифт доступен
 * всем без загрузки. Файл уходит multipart'ом — mime у шрифтов ненадёжен,
 * сервер определяет тип по расширению.
 */
export const fontsApi = {
  get: () => api.get<{ fonts: any }>('/themes/fonts'),
  upload: (file: File | Blob, name?: string) => {
    const form = new FormData();
    form.append('file', file, (file as File).name || 'font.woff2');
    if (name) form.append('name', name);
    return api.post('/themes/fonts', form);
  },
  remove: (id: string) => api.delete(`/themes/fonts/${encodeURIComponent(id)}`),
};
export const chatsApi = {
  searchChannels: (q: string) => api.get('/channels/search', { params: { q } }),
  joinChannel: (id: string) => api.post(`/channels/${id}/join`),
  getAll: () => api.get('/chats'),
  getById: (id: string) => api.get(`/chats/${id}`),
  getChannelSkins: (id: string) => api.get<string[]>(`/chats/${id}/skins`),
  /** «Мои скины» для моих сообщений в чате (null — вернуть «как в профиле»). */
  setMySkins: (id: string, skins: { ring?: string | null; selfcard?: string | null; bubble?: string | null }) =>
    api.put(`/chats/${id}/my-skins`, skins),
  createDirect: (targetUserId: string) => api.post('/chats/direct', { targetUserId }),
  createGroup: (name: string, memberIds: string[]) => api.post('/chats/group', { name, memberIds }),
  createChannel: (name: string, description?: string) => api.post('/chats/channel', { name, description }),
  update: (chatId: string, data: { activeRing?: string; activeSelfCard?: string; activeBubble?: string; name?: string; description?: string; avatarUrl?: string; wallpaper?: { type: 'photo' | 'live' | 'stock'; value: string } | null }) =>
    api.patch(`/chats/${chatId}`, data),
  leaveChat: (chatId: string) => api.delete(`/chats/${chatId}/leave`),
  deleteChat: (chatId: string) => api.delete(`/chats/${chatId}`),
  archive: (chatId: string, archived: boolean) => api.patch(`/chats/${chatId}/archive`, { archived }),
  pin: (chatId: string, pinned: boolean) => api.patch(`/chats/${chatId}/pin`, { pinned }),
  mute: (chatId: string, muted: boolean) => api.patch(`/chats/${chatId}/mute`, { muted }),
  addMember: (chatId: string, userId: string) => api.post(`/chats/${chatId}/members`, { userId }),
  setAdmin: (chatId: string, userId: string, data: { role: 'admin' | 'member'; adminTitle: string; permissions: import('../types').ChatMember['permissions'] }) =>
    api.patch(`/chats/${chatId}/members/${userId}/admin`, data),
  invite: (chatId: string, userId: string) => api.post(`/chats/${chatId}/invite`, { userId }),
  acceptInvite: (token: string) => api.post(`/group-invites/${token}/accept`),
  declineInvite: (token: string) => api.post(`/group-invites/${token}/decline`),
};

export interface DraftCorrectionResponse {
  correctedText: string;
  explanation?: string;
}

export const languageApi = {
  correctDraft: (chatId: string, text: string, explain: boolean, signal?: AbortSignal) =>
    api.post<DraftCorrectionResponse>(`/chats/${encodeURIComponent(chatId)}/language-correction`, { text, explain }, { signal, timeout: 65000 }),
};

export const protoBoardApi = {
  get: (chatId: string) => api.get(`/proto-boards/${chatId}`),
  // Размер доски (width/height) едет сюда же: он часть состояния холста, а не
  // отдельная настройка. Опционален ради старых вызовов без него.
  save: (chatId: string, board: { items: any[]; threads: any[]; width?: number; height?: number }) =>
    api.put(`/proto-boards/${chatId}`, board),
  saveDrawing: async (chatId: string, drawing: any[]) => {
    const current = await api.get(`/proto-boards/${chatId}`);
    return api.put(`/proto-boards/${chatId}`, { ...current.data, drawing });
  },
  access: (chatId: string) => api.get(`/proto-boards/${chatId}/access`),
  grant: (chatId: string, userId: string, level: 'viewer' | 'editor') =>
    api.post(`/proto-boards/${chatId}/access`, { userId, level }),
  setLevel: (chatId: string, userId: string, level: 'viewer' | 'editor') =>
    api.patch(`/proto-boards/${chatId}/access/${userId}`, { level }),
  revoke: (chatId: string, userId: string) =>
    api.delete(`/proto-boards/${chatId}/access/${userId}`),
  uploadPhoto: (chatId: string, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('chatId', chatId);
    return api.post('/proto-boards/photo', fd);
  },
};

export const aiApi = {
  chat: (message: string) => api.post<{ answer: string; model: string }>('/ai-lmm/chat', { message }),
  learnUrl: (url: string) => api.post<{ ok: boolean; url: string; text: string }>('/ai-lmm/learn-url', { url }),
};

export const messagesApi = {
  getComments: (chatId: string, postId: string) => api.get(`/messages/${chatId}/comments/${postId}`),
  getMessages: (chatId: string, before?: string, limit?: number) =>
    api.get(`/messages/${chatId}`, { params: { before, limit } }),
  send: (chatId: string, data: { text?: string; clientTempId?: string; replyToId?: string; commentReplyToId?: string; attachments?: any[]; type?: string; poll?: any; forwardFromId?: string }) =>
    api.post(`/messages/${chatId}/send`, data),
  votePoll: (messageId: string, optionIds: string[]) => api.post(`/messages/${messageId}/poll-vote`, { optionIds }),
  edit: (id: string, text: string) => api.put(`/messages/${id}`, { text }),
  delete: (id: string) => api.delete(`/messages/${id}`),
  markRead: (id: string, chatId: string) => api.post(`/messages/${id}/read`, { chatId }),
  pin: (id: string | null, chatId: string) =>
    api.post(`/messages/${id || 'none'}/pin`, { chatId, messageId: id }),
  unpin: (id: string, chatId: string) =>
    api.post(`/messages/${id}/unpin`, { chatId, messageId: id }),
  search: (chatId: string, q: string) =>
    api.get(`/messages/${chatId}/search`, { params: { q } }),
  addReaction: (chatId: string, messageId: string, emoji: string) =>
    api.post(`/messages/${chatId}/reaction`, { messageId, emoji }),
  /** Отложенное сообщение (/time): задержку отсчитывает сервер. */
  schedule: (chatId: string, text: string, delayMs: number) =>
    api.post<ScheduledMessage>(`/messages/${chatId}/schedule`, { text, delayMs }),
  scheduled: (chatId: string) => api.get<ScheduledMessage[]>(`/messages/${chatId}/scheduled`),
  cancelScheduled: (id: string) => api.delete(`/messages/scheduled/${encodeURIComponent(id)}`),
};

/**
 * Морской бой (/warship): сессия-карточка в чате.
 * mode 'ai' — одиночная игра против ИИ на клиенте, сервер принимает итог (/finish).
 * mode 'pvp' — дуэль 1 на 1 в личке: флоты и ходы живут на сервере,
 * клиент получает только свой вид (/state) и стреляет через /fire.
 */
export const warshipsApi = {
  /** Создать сессию в чате. inviteeId — для лички (собеседник); в группе не нужен. */
  create: (chatId: string, inviteeId?: string | null) =>
    api.post(`/messages/${encodeURIComponent(chatId)}/warship`, { inviteeId: inviteeId ?? null }),
  accept: (messageId: string) =>
    api.post(`/warships/${encodeURIComponent(messageId)}/accept`),
  decline: (messageId: string) =>
    api.post(`/warships/${encodeURIComponent(messageId)}/decline`),
  finish: (messageId: string, result: { winner: 'player' | 'computer'; durationMs: number; shots: number }) =>
    api.post(`/warships/${encodeURIComponent(messageId)}/finish`, result),
  state: (messageId: string) =>
    api.get<WarshipDuelView>(`/warships/${encodeURIComponent(messageId)}/state`),
  /** Отправить свою расстановку: корабль — массив клеток [r, c]. */
  place: (messageId: string, ships: [number, number][][]) =>
    api.post<WarshipDuelView>(`/warships/${encodeURIComponent(messageId)}/place`, { ships }),
  fire: (messageId: string, r: number, c: number) =>
    api.post<{ outcome: 'miss' | 'hit' | 'sunk'; view: WarshipDuelView }>(`/warships/${encodeURIComponent(messageId)}/fire`, { r, c }),
  surrender: (messageId: string) =>
    api.post(`/warships/${encodeURIComponent(messageId)}/surrender`),
};

/**
 * Крестики-нолики (/tic-tac-toe): сессия-карточка в чате. Состояние партии
 * лежит в payload карточки, каждый ход проверяет сервер.
 */
export const ticTacToeApi = {
  create: (chatId: string) =>
    api.post(`/messages/${encodeURIComponent(chatId)}/tictactoe`, {}),
  accept: (messageId: string) =>
    api.post(`/tictactoe/${encodeURIComponent(messageId)}/accept`),
  decline: (messageId: string) =>
    api.post(`/tictactoe/${encodeURIComponent(messageId)}/decline`),
  /** Ход в клетку 0..8 (слева направо, сверху вниз). */
  move: (messageId: string, cell: number) =>
    api.post(`/tictactoe/${encodeURIComponent(messageId)}/move`, { cell }),
};

/** Вид дуэли глазами текущего игрока (чужой флот сервер не отдаёт). */
export interface WarshipDuelView {
  mode: 'pvp';
  /** 'placement' — игроки расставляют корабли, 'battle' — идёт бой. */
  phase: 'placement' | 'battle';
  /** Я уже отправил свою расстановку. */
  myReady: boolean;
  /** Соперник уже отправил свою расстановку (его клетки не раскрываются). */
  opponentReady: boolean;
  myShips: Array<{ cells: [number, number][]; sunk: boolean }>;
  /** Мои выстрелы по сопернику: «r,c» → исход. */
  myShots: Record<string, 'miss' | 'hit' | 'sunk'>;
  /** Выстрелы соперника по моему полю. */
  enemyShots: Record<string, 'miss' | 'hit' | 'sunk'>;
  myTurn: boolean;
  over: boolean;
  winnerId: string | null;
  opponentId: string;
  opponentName: string;
  enemyShipsLeft: number;
  myShipsLeft: number;
  myShotsCount: number;
  enemyShotsCount: number;
  /** Начало боя; null, пока идёт расстановка. */
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ScheduledMessage {
  id: string;
  chatId: string;
  text: string;
  sendAt: number;
  createdAt: number;
}

export interface BlockedUser {
  id: string;
  blocked: { id: string; username: string };
  blocker?: { id: string; username: string };
  createdAt: string;
}

export const blocksApi = {
  list: () => api.get<BlockedUser[]>('/users/blocks'),
  // Кто заблокировал меня: чату это нужно, чтобы объяснить, почему нельзя писать.
  listBy: () => api.get<BlockedUser[]>('/users/blocks/by'),
  block: (userId: string) => api.post<{ ok: boolean; blocked: boolean; already: boolean }>(
    `/users/${encodeURIComponent(userId)}/block`,
  ),
  unblock: (userId: string) => api.delete(`/users/${encodeURIComponent(userId)}/block`),
};

export const appealsApi = {
  send: (text: string) => api.post<{ id: string }>('/appeals', { text }),
  mine: () => api.get<{ id: string; status: string; createdAt: string } | null>('/appeals/mine'),
  /**
   * Путь для забаненных: работает по cookie установки, а не по JWT — у
   * забаненного токена нет вовсе. Ответ сразу говорит, забанен ли аккаунт.
   */
  sendBanned: (text: string) => api.post<{ id: string }>('/auth/appeal', { text }),
  mineBanned: () => api.get<{ banned: boolean; appeal: { id: string; status: string } | null }>('/auth/appeal'),
  adminList: () => api.get<any[]>('/admin/appeals'),
  decide: (id: string, action: 'uphold' | 'overturn', note: string) =>
    api.post<any>(`/admin/appeals/${id}/decision`, { action, note }),
};

export const reportsApi = {
  sharedChats: (targetId: string) => api.get<Array<{ id: string; name: string; type: string }>>(`/reports/chats/${targetId}`),
  create: (formData: FormData) => api.post<{ id: string }>('/reports', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  list: () => api.get<any[]>('/admin/reports'),
  get: (id: string) => api.get<any>(`/admin/reports/${id}`),
  photo: (id: string) => api.get<Blob>(`/admin/reports/${id}/photo`, { responseType: 'blob' }),
  messages: (id: string, offset = 0) => api.get<{ messages: any[]; total: number }>(`/admin/reports/${id}/messages`, { params: { offset } }),
  decide: (id: string, action: string, reason: string, minutes: number) =>
    api.post<any>(`/admin/reports/${id}/decision`, { action, reason, minutes }),
};

export const musicApi = {
  getAll: (page?: number, limit?: number) => api.get('/music/my', { params: { page, limit } }),
  search: (q: string) => api.get(`/music/search?q=${encodeURIComponent(q)}`),
  getMy: () => api.get('/music/my'),
  getTrack: (id: string) => api.get(`/music/${id}`),
  recordPlay: (id: string) => api.post(`/music/${id}/play`),
  upload: (formData: FormData, onProgress?: (p: number) => void) =>
    api.post('/music/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    }),
  update: (id: string, formData: FormData) =>
    api.patch(`/music/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  delete: (id: string) => api.delete(`/music/${id}`),
  // Импорт по URL (yt-dlp на сервере, лимит 6 минут).
  importUrl: (url: string) => api.post('/music/import-url', { url }),
  // Массовый импорт mp3 из ZIP-архива.
  importZip: (formData: FormData, onProgress?: (p: number) => void) =>
    api.post('/music/import-zip', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    }),
  // Скачать все треки плейлиста одним zip. Возвращает Blob.
  downloadPlaylistZip: (playlistId: string) =>
    api.get(`/music/playlists/${playlistId}/zip`, { responseType: 'blob' }),
  // ── Общая библиотека ────────────────────────────────────────────────────────
  genres: () => api.get('/music/genres'),
  sharedTracks: (params?: { q?: string; sort?: string; limit?: number }) =>
    api.get('/music/shared', { params }),
  publishTrack: (id: string, data: { title: string; artist: string; genre: string; description?: string; coverUrl?: string }) =>
    api.post(`/music/${id}/publish`, data),
  unpublishTrack: (id: string) => api.delete(`/music/${id}/publish`),
  saveSharedTrack: (id: string) => api.post(`/music/shared/${id}/save`),
  // Загрузить обложку (трек/альбом) и получить URL.
  uploadCover: (formData: FormData, onProgress?: (p: number) => void) =>
    api.post('/music/cover', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    }),
  albums: (params?: { scope?: 'mine' | 'shared'; q?: string; sort?: string }) =>
    api.get('/music/albums', { params }),
  createAlbum: (data: { title: string; artist: string; genre: string; description?: string; coverUrl: string; trackIds: string[] }) =>
    api.post('/music/albums', data),
  updateAlbum: (id: string, data: Partial<{ title: string; artist: string; genre: string; description: string; coverUrl: string }>) =>
    api.patch(`/music/albums/${id}`, data),
  deleteAlbum: (id: string) => api.delete(`/music/albums/${id}`),
  publishAlbum: (id: string, data?: { genre?: string }) => api.post(`/music/albums/${id}/publish`, data || {}),
  unpublishAlbum: (id: string) => api.delete(`/music/albums/${id}/publish`),
  saveSharedAlbum: (id: string) => api.post(`/music/albums/${id}/save`),
  // Плейлисты
  getPlaylists: () => api.get('/playlists'),
  createPlaylist: (name: string, description?: string, isPublic?: boolean) => api.post('/playlists', { name, description, isPublic }),
  updatePlaylist: (playlistId: string, dto: { name?: string; description?: string; isPublic?: boolean }) =>
    api.patch(`/playlists/${playlistId}`, dto),
  searchPublicPlaylists: (q: string) => api.get(`/playlists/public/search?q=${encodeURIComponent(q)}`),
  copyPlaylist: (playlistId: string) => api.post(`/playlists/${playlistId}/copy`),
  getPlaylist: (playlistId: string) => api.get(`/playlists/${playlistId}`),
  addToPlaylist: (playlistId: string, trackId: string) =>
    api.post(`/playlists/${playlistId}/tracks`, { trackId }),
  removeFromPlaylist: (playlistId: string, trackId: string) =>
    api.delete(`/playlists/${playlistId}/tracks/${trackId}`),
  reorderPlaylist: (playlistId: string, trackIds: string[]) =>
    api.patch(`/playlists/${playlistId}/reorder`, { trackIds }),
  deletePlaylist: (playlistId: string) => api.delete(`/playlists/${playlistId}`),
};

export const filesApi = {
  // compress=false — отправка оригиналом (настройка «Сжимать отправляемые файлы»).
  // Без параметра сервер сжимает фото по умолчанию.
  upload: (file: File, compress?: boolean) => {
    const formData = new FormData();
    if (compress === false) formData.append('compress', '0');
    formData.append('file', file);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // С прогрессом загрузки
  uploadWithProgress: (file: File, onProgress: (p: number) => void, compress?: boolean) => {
    const formData = new FormData();
    if (compress === false) formData.append('compress', '0');
    formData.append('file', file);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    });
  },
};

// Избранное
export const favoritesApi = {
  get: () => api.get('/favorites'),
  add: (chatId: string) => api.post('/favorites', { chatId }),
  remove: (chatId: string) => api.delete(`/favorites/${chatId}`),
};

export const voiceApi = {
  transcribe: (attachmentId: string) => api.post(`/voice/transcribe/${encodeURIComponent(attachmentId)}`, undefined, { timeout: 310000 }),
};

export const downloadsApi = {
  list: () => api.get<{ files: Array<{ platform: 'win' | 'mac' | 'linux' | 'android' | 'other'; filename: string; size: number; url: string }> }>('/downloads'),
};

/* ─── Creator / Кастомный магазин ────────────────────────────────────────── */
export interface CustomSpec {
  bg: { type: 'solid' | 'linear' | 'radial'; color1: string; color2: string; angle: number };
  border: { width: number; color: string; style: 'solid' | 'dashed' | 'dotted' | 'double'; radius: number };
  glow: { enabled: boolean; color: string; intensity: number };
  shadow: { enabled: boolean; x: number; y: number; blur: number; color: string };
  text: { color: string; weight: '300' | '400' | '500' | '600' | '700' | '800' };
  animation: 'none' | 'pulse' | 'shimmer' | 'float';
  opacity: number;
  padding: number;
  emoji: string;
}
export type CustomCategory = 'profile' | 'selfcard' | 'wallpaper' | 'bubble';
export interface CustomItem {
  id: string;
  authorId?: string;
  category: CustomCategory;
  name: string;
  description: string;
  price: number;
  spec: CustomSpec;
  status?: 'draft' | 'published' | 'hidden';
  createdAt?: number;
  publishedAt?: number;
  salesCount?: number;
  revenueVp?: number;
  author?: { id: string; username: string; avatar?: string } | null;
}

export const creatorApi = {
  me: () => api.get<{ feePaid: boolean; isAdmin: boolean; feeRub: number; revenueVp: number }>('/creator/me'),
  joinFee: () => api.post<{ orderId: string; mock?: boolean; priceRub: number; invoiceUrl: string }>('/creator/join-fee'),
  mockPayFee: (orderId: string) => api.post<{ ok: boolean; feePaid: boolean }>('/creator/mock-pay-fee', { orderId }),
  myItems: () => api.get<{ items: CustomItem[] }>('/creator/items'),
  create: (dto: Partial<CustomItem>) => api.post<{ item: CustomItem }>('/creator/items', dto),
  update: (id: string, dto: Partial<CustomItem>) => api.patch<{ item: CustomItem }>(`/creator/items/${id}`, dto),
  publish: (id: string) => api.post<{ item: CustomItem }>(`/creator/items/${id}/publish`),
  unpublish: (id: string) => api.post<{ item: CustomItem }>(`/creator/items/${id}/unpublish`),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/creator/items/${id}`),
  hide: (id: string) => api.post<{ item: CustomItem }>(`/creator/items/${id}/hide`),
  restore: (id: string) => api.post<{ item: CustomItem }>(`/creator/items/${id}/restore`),
  publicList: () => api.get<{ items: CustomItem[] }>('/shop/custom'),
};

export default api;
