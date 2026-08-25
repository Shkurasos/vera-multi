import api from './api';
import { Bot } from '../types/bots';

export const botsApi = {
  getMyBots: () => api.get<Bot[]>('/bots/my'),
  createBot: (name: string, username: string) => api.post<Bot>('/bots/create', { name, username }),
  getBot: (username: string) => api.get<Bot>(`/bots/${username}`),
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
};

export const adminApi = {
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
  train: (datasetDir?: string) => api.post('/ai-lmm/train', { datasetDir }),
  extract: (filePath: string) => api.post('/ai-lmm/extract', { filePath }),
  search: (q: string) => api.get('/ai-lmm/search', { params: { q } }),
  readFile: (path: string) => api.post('/ai-lmm/file', { path }),
  listDir: (path: string) => api.post('/ai-lmm/list', { path }),
  runCommand: (command: string) => api.post('/ai-lmm/run', { command }),
};
