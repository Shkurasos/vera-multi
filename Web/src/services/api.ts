
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vera_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('vera_token');
      // Аккаунт живёт с устройством: перезагружаем — bootstrap авторизуется заново.
      window.location.href = '/';
    }
    return Promise.reject(err);
  },
);

export const authApi = {
  device: () => api.post('/auth/device', { deviceId: getDeviceId(), deviceName: getDeviceName() }),
  me: () => api.get('/auth/me'),
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
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
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

export const chatsApi = {
  getAll: () => api.get('/chats'),
  getById: (id: string) => api.get(`/chats/${id}`),
  createDirect: (targetUserId: string) => api.post('/chats/direct', { targetUserId }),
  createGroup: (name: string, memberIds: string[]) => api.post('/chats/group', { name, memberIds }),
  createChannel: (name: string, description?: string) => api.post('/chats/channel', { name, description }),
  update: (chatId: string, data: { name?: string; description?: string; avatarUrl?: string }) =>
    api.patch(`/chats/${chatId}`, data),
  leaveChat: (chatId: string) => api.delete(`/chats/${chatId}/leave`),
  deleteChat: (chatId: string) => api.delete(`/chats/${chatId}`),
  archive: (chatId: string, archived: boolean) => api.patch(`/chats/${chatId}/archive`, { archived }),
  pin: (chatId: string, pinned: boolean) => api.patch(`/chats/${chatId}/pin`, { pinned }),
  mute: (chatId: string, muted: boolean) => api.patch(`/chats/${chatId}/mute`, { muted }),
  addMember: (chatId: string, userId: string) => api.post(`/chats/${chatId}/members`, { userId }),
};

export const messagesApi = {
  getMessages: (chatId: string, before?: string, limit?: number) =>
    api.get(`/messages/${chatId}`, { params: { before, limit } }),
  send: (chatId: string, data: { text?: string; replyToId?: string; attachments?: any[]; type?: string }) =>
    api.post(`/messages/${chatId}/send`, data),
  edit: (id: string, text: string) => api.put(`/messages/${id}`, { text }),
  delete: (id: string) => api.delete(`/messages/${id}`),
  markRead: (id: string, chatId: string) => api.post(`/messages/${id}/read`, { chatId }),
  pin: (id: string | null, chatId: string) =>
    api.post(`/messages/${id || 'none'}/pin`, { chatId, messageId: id }),
  search: (chatId: string, q: string) =>
    api.get(`/messages/${chatId}/search`, { params: { q } }),
  addReaction: (chatId: string, messageId: string, emoji: string) =>
    api.post(`/messages/${chatId}/reaction`, { messageId, emoji }),
};

export const musicApi = {
  getAll: (page?: number, limit?: number) => api.get('/music/my', { params: { page, limit } }),
  search: (q: string) => api.get(`/music/search?q=${encodeURIComponent(q)}`),
  getMy: () => api.get('/music/my'),
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
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // С прогрессом загрузки
  uploadWithProgress: (file: File, onProgress: (p: number) => void) => {
    const formData = new FormData();
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
  transcribe: (attachmentId: string) => api.post(`/voice/transcribe/${attachmentId}`),
};

export const downloadsApi = {
  list: () => api.get<{ files: Array<{ platform: 'win' | 'mac' | 'linux' | 'other'; filename: string; size: number; url: string }> }>('/downloads'),
};

export default api;
