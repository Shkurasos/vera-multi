'use strict';
/*
 * Vera Multi Desktop — preload.
 * Минимальный мост: веб-клиент не нуждается в локальном P2P-узле, поэтому
 * здесь мы только пробрасываем deep-link `vera://` события в renderer, чтобы
 * клиент мог захватить ссылку привязки (/link?token=...), открытую из ОС.
 */
const { contextBridge, ipcRenderer } = require('electron');

let bufferedDeepLink = null;
ipcRenderer.on('vera:deeplink', (_e, url) => { bufferedDeepLink = url; });

const api = {
  // id устройства генерит сам renderer (в localStorage), но вернём и агент
  platform: () => Promise.resolve({ platform: process.platform, isDesktop: true }),
  onDeepLink(handler) {
    const wrapped = (_e, url) => { try { handler(url); } catch (e) { console.error('[vera] onDeepLink', e); } };
    ipcRenderer.on('vera:deeplink', wrapped);
    if (bufferedDeepLink) {
      const url = bufferedDeepLink; bufferedDeepLink = null;
      queueMicrotask(() => { try { handler(url); } catch (e) { console.error(e); } });
    }
    return () => ipcRenderer.removeListener('vera:deeplink', wrapped);
  },
};

contextBridge.exposeInMainWorld('veraDesktop', api);
