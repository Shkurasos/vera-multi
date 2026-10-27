'use strict';
/*
 * Vera Multi Desktop — preload.
 * Минимальный мост: веб-клиент не нуждается в локальном P2P-узле, поэтому
 * здесь мы только пробрасываем deep-link `vera://` события в renderer, чтобы
 * клиент мог захватить ссылку привязки (/link?token=...), открытую из ОС.
 */
const { contextBridge, ipcRenderer, clipboard, nativeImage } = require('electron');

let bufferedDeepLink = null;
ipcRenderer.on('vera:deeplink', (_e, url) => { bufferedDeepLink = url; });

let onlineHandlers = new Set();
ipcRenderer.on('vera:online-status', (_e, isOnline) => {
  for (const h of onlineHandlers) { try { h(isOnline); } catch { /* ignore */ } }
});

const api = {
  // id устройства генерит сам renderer (в localStorage), но вернём и агент
  platform: () => Promise.resolve({ platform: process.platform, isDesktop: true }),
  isOnline: () => ipcRenderer.invoke('vera:is-online'),
  onOnlineStatusChange(handler) {
    onlineHandlers.add(handler);
    return () => onlineHandlers.delete(handler);
  },
  // Своя верхняя панель: клиент рисует полосу, а кнопкам окна сообщает цвета темы.
  titleBar: {
    height: 32,
    platform: process.platform,
    setColors(colors) {
      if (!colors || typeof colors !== 'object') return;
      ipcRenderer.send('vera:title-bar-colors', { color: String(colors.color), symbolColor: String(colors.symbolColor) });
    },
  },
  // Буфер обмена ОС напрямую: navigator.clipboard в Electron упирается в
  // разрешения, а картинку без него не скопировать (у текста есть execCommand).
  clipboard: {
    writeText(text) {
      clipboard.writeText(String(text ?? ''));
      return true;
    },
    /** PNG как ArrayBuffer / Uint8Array. Возвращает false, если картинка не разобралась. */
    writeImage(pngBytes) {
      if (!pngBytes) return false;
      // ArrayBuffer приходит из другого JS-мира (contextIsolation), поэтому
      // instanceof ненадёжен — заворачиваем в Uint8Array в любом случае.
      let bytes;
      try {
        bytes = ArrayBuffer.isView(pngBytes)
          ? new Uint8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength)
          : new Uint8Array(pngBytes);
      } catch {
        return false;
      }
      if (!bytes.byteLength) return false;
      const img = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (img.isEmpty()) return false;
      clipboard.writeImage(img);
      return true;
    },
  },
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
