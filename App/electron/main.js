'use strict';
/*
 * Vera Multi Desktop — Electron main-процесс.
 *
 * Это ТОНКАЯ оболочка: наше «приложение» — это тот же веб-клиент (Web/),
 * который подключается к ОДНОМУ серверу (Server/). Никакого локального
 * P2P-узла на устройстве больше нет — вся синхронизация идёт через сервер,
 * как в Telegram. Поэтому App просто открывает окно браузера с клиентом.
 *
 * Server address, in priority order:
 *   1) VERA_SERVER_URL (dev);
 *   2) server-url.txt next to the exe. The installer writes it from the address
 *      of the site it was downloaded from (Server/download-stamp.js +
 *      resources/installer.nsh), so the site and the app always share one
 *      server, even on a free Cloudflare tunnel;
 *   3) DEFAULT_SERVER_URL — http://localhost:3000 (cd Server; npm start).
 */

const { app, BrowserWindow, Menu, shell, session, desktopCapturer, net, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_SERVER_URL = 'http://localhost:3000';

/** Only an http(s) origin, like normalizeServerUrl on the server. */
function normalizeServerUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) return null;
  try {
    const u = new URL(raw.trim());
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function stampedServerUrl() {
  try {
    return normalizeServerUrl(fs.readFileSync(path.join(path.dirname(process.execPath), 'server-url.txt'), 'utf8'));
  } catch {
    return null;
  }
}

const SERVER_URL = normalizeServerUrl(process.env.VERA_SERVER_URL || '')
  || (app.isPackaged ? stampedServerUrl() : null)
  || DEFAULT_SERVER_URL;

let mainWindow = null;
let isOnline = true;

/* ─── Offline / online tracking ─────────────────────────────────────────── */
function updateOnlineState() {
  const prev = isOnline;
  // Проверяем реальную сетевую доступность сервера через HEAD-запрос.
  const req = net.request({ method: 'HEAD', url: SERVER_URL + '/api/auth/device' });
  let resolved = false;
  const timeout = setTimeout(() => { resolved = true; req.destroy(); }, 3000);
  req.on('response', () => { if (!resolved) { resolved = true; clearTimeout(timeout); isOnline = true; } });
  req.on('error', () => { if (!resolved) { resolved = true; clearTimeout(timeout); isOnline = false; } });
  req.on('abort', () => { if (!resolved) { resolved = true; clearTimeout(timeout); isOnline = false; } });
  req.end();
  // Не ждем ответа — обновляем по событию online/offline как основной источник.
  if (prev !== isOnline && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vera:online-status', isOnline);
  }
}

// IPC: рендерер может спросить статус онлайн.
ipcMain.handle('vera:is-online', () => isOnline);

/* ─── Своя верхняя панель ────────────────────────────────────────────────
 * Системный заголовок скрыт (titleBarStyle: 'hidden'); полосу рисует веб-клиент
 * (Web/src/components/TitleBar.tsx), а кнопки окна ОС кладёт поверх справа
 * (titleBarOverlay). Их цвет клиент присылает при смене темы. */
const TITLE_BAR_HEIGHT = 32;
const HEX6 = /^#[0-9a-f]{6}$/i;
const titleBarOverlayFor = (color = '#000000', symbolColor = '#ffffff') => (
  process.platform === 'darwin' ? undefined : { color, symbolColor, height: TITLE_BAR_HEIGHT }
);

ipcMain.on('vera:title-bar-colors', (e, payload) => {
  // Только из нашего окна и только строгие #rrggbb — остальное игнорируем.
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) return;
  const color = payload && payload.color;
  const symbolColor = payload && payload.symbolColor;
  if (!HEX6.test(String(color)) || !HEX6.test(String(symbolColor))) return;
  mainWindow.setBackgroundColor(color);
  if (process.platform !== 'darwin' && typeof mainWindow.setTitleBarOverlay === 'function') {
    try { mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_HEIGHT }); } catch { /* старый Electron */ }
  }
});

app.on('online', () => { isOnline = true; updateOnlineState(); });
app.on('offline', () => { isOnline = false; updateOnlineState(); });
// При старте считаем онлайн до первой проверки.
setTimeout(() => updateOnlineState(), 500);

/* ─── Локальные страницы: заставка и «нет сети» ─────────────────────────
 * Раньше окно сразу грузило сервер: пока Render просыпается (до минуты) или
 * если адрес недоступен (503), пользователь видел чёрный экран. Теперь сначала
 * показываем локальную заставку, а при ошибке — страницу «нет сети» с повтором.
 * Если сервис-воркер уже закэшировал клиент, офлайн открывается сам клиент. */
const PAGES_DIR = path.join(__dirname, 'pages');
const showLocalPage = (name) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadFile(path.join(PAGES_DIR, name), { query: { server: SERVER_URL } }).catch(() => {});
};
// Exact origin match: a prefix check would let https://x.trycloudflare.com.evil.com through.
const isServerUrl = (url) => {
  if (typeof url !== 'string') return false;
  try { return new URL(url).origin === SERVER_URL; } catch { return false; }
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Узкое окно (≤700px) переключает клиент в телефонную раскладку:
    // либо список чатов, либо открытый чат — как на телефоне.
    minWidth: 360,
    minHeight: 500,
    backgroundColor: '#0f0f17',
    show: false,
    // Без системного заголовка и меню: верхнюю полосу в цветах темы рисует клиент.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor('#0f0f17', '#ffffff'),
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Открываем внешние ссылки в браузере ОС, а не в окне Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    // Разрешаем только наш сервер / локальный файл.
    if (url.startsWith('http') && !isServerUrl(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());

  // Сеть недоступна и клиента нет в кэше SW → страница «нет сети».
  // -3 (ERR_ABORTED) — это отмена навигации (например, переход внутри SPA).
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, _desc, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && isServerUrl(url)) showLocalPage('offline.html');
  });
  // Сервер ответил ошибкой (Render 502/503 при сбое) — тоже не показываем пустоту.
  mainWindow.webContents.on('did-navigate', (_e, url, httpResponseCode) => {
    if (isServerUrl(url) && httpResponseCode >= 500) showLocalPage('offline.html');
  });

  // Заставка видна, пока сервер просыпается: старая страница остаётся на
  // экране до того, как новая начнёт отрисовываться.
  mainWindow.loadFile(path.join(PAGES_DIR, 'splash.html'))
    .catch(() => {})
    .finally(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(SERVER_URL).catch(() => {});
    });
}

/* ---------- Deep-link vera:// ---------- */
app.setAsDefaultProtocolClient('vera');

function extractDeepLink(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((a) => typeof a === 'string' && a.startsWith('vera://')) || null;
}

let pendingDeepLink = extractDeepLink(process.argv);

function forwardDeepLink(url) {
  if (!url) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('vera:deeplink', url);
  } else {
    pendingDeepLink = url;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = extractDeepLink(argv);
    if (url) forwardDeepLink(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  forwardDeepLink(url);
});

app.whenReady().then(() => {
  // Никакого системного меню «File / Edit / View» (раньше всплывало по Alt).
  Menu.setApplicationMenu(null);

  // ─── WebRTC permissions (микрофон / камера / уведомления) ────────────
  // Без этих handlers Electron блокирует getUserMedia и звонок молча падает.
  const ses = session.defaultSession;
  // clipboard-sanitized-write — navigator.clipboard.writeText («Копировать» в меню сообщения),
  // clipboard-read — кнопка «Вставить» в приглашениях.
  const allowed = new Set(['media', 'audioCapture', 'videoCapture', 'display-capture', 'notifications',
    'clipboard-sanitized-write', 'clipboard-read']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // ─── Screen-share (getDisplayMedia) ───────────────────────────────────
  // По умолчанию Electron 20+ требует явно вернуть источник экрана.
  // Здесь берём первый доступный экран без picker-UI. При желании можно
  // показать окно выбора через ipcMain + отдельный renderer.
  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    ses.setDisplayMediaRequestHandler(async (_req, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
        });
        // Первый экран (обычно основной монитор).
        const screen = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
        if (screen) callback({ video: screen, audio: 'loopback' });
        else callback(null);
      } catch {
        callback(null);
      }
    });
  }

  createWindow();
  if (pendingDeepLink && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      const url = pendingDeepLink; pendingDeepLink = null;
      forwardDeepLink(url);
    });
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
