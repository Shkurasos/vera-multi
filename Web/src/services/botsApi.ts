import api from './api';
import { Bot } from '../types/bots';

export const botsApi = {
  getMyBots: () => api.get<Bot[]>('/bots/my'),
  /** Токен приходит один раз — в ответе на создание или перевыпуск. */
  createBot: (name: string, username: string) => api.post<{ bot: Bot; token: string }>('/bots/create', { name, username }),
  reissueToken: (id: string) => api.post<{ bot: Bot; token: string }>(`/bots/${encodeURIComponent(id)}/token`),
  deleteBot: (id: string) => api.delete(`/bots/${encodeURIComponent(id)}`),
  getBot: (username: string) => api.get<Bot>(`/bots/${encodeURIComponent(username)}`),
  /**
   * Подписанный запуск мини-приложения бота: по короткому имени (ссылка
   * vera://app/<бот>/<имя>) или кнопкой у поля ввода (без app).
   */
  appInit: (username: string, app?: string) =>
    api.post<{ url: string; title: string; initData: string; bot: { username: string; name: string } }>(
      '/bots/app-init', { username, ...(app ? { app } : {}) },
    ),
};

export const aiApi = {
  listModels: () => api.get('/ai/models'),
  createModel: (name: string, description?: string) => api.post('/ai/models', { name, description }),
  uploadFile: (modelId: string, file: File, onProgress?: (p: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/ai/models/${modelId}/files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    });
  },
  train: (modelId: string) => api.post(`/ai/models/${modelId}/train`),
  chat: (message: string, modelId?: string) => api.post('/ai/chat', { message, modelId }),
  stats: () => api.get('/ai/stats'),
  clearModel: (modelId: string) => api.post(`/ai/models/${modelId}/clear`),
  generateTheme: (description: string) =>
    api.post<{ ok: boolean; theme: any; cost: number; balance: number }>('/ai/theme', { description }),
};

export const adminApi = {
  deleteAllChats: () => api.post('/admin/delete-all-chats', { confirmation: 'DELETE_ALL_CHATS' }),
  deleteAllUsers: () => api.post('/admin/delete-all-users', { confirmation: 'DELETE_ALL_USERS' }),
  scan: (url: string) => api.post('/admin/scan', { url }),
  getScans: () => api.get('/admin/scans'),
  analyzeScan: (scanId: string) => api.post(`/admin/scans/${scanId}/analyze`),
  startProxy: (port?: number) => api.post('/admin/proxy/start', { port }),
  stopProxy: () => api.post('/admin/proxy/stop'),
  proxyStatus: () => api.get('/admin/proxy/status'),
  proxyLogs: (limit?: number) => api.get('/admin/proxy/logs', { params: { limit } }),
  repeater: (method: string, url: string, headers?: Record<string, string>, body?: string) =>
    api.post('/admin/repeater', { method, url, headers, body }),
  repeaterHistory: () => api.get('/admin/repeater/history'),
};

// Полноценная LLM через Python-движок
export const aiLmmApi = {
  health: () => api.get('/ai-lmm/health'),
  chat: (message: string) => api.post('/ai-lmm/chat', { message }),
  learnUrl: (url: string) => api.post<{ ok: boolean; source?: { url: string; title?: string; textLength?: number }; message?: string }>('/ai-lmm/learn-url', { url }),
  train: (datasetDir?: string) => api.post('/ai-lmm/train', { datasetDir }),
  extract: (filePath: string) => api.post('/ai-lmm/extract', { filePath }),
  search: (q: string) => api.get('/ai-lmm/search', { params: { q } }),
  readFile: (path: string) => api.post('/ai-lmm/file', { path }),
  listDir: (path: string) => api.post('/ai-lmm/list', { path }),
  runCommand: (command: string) => api.post('/ai-lmm/run', { command }),
};
