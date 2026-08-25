'use strict';
/*
 * Vera Multi Desktop — Electron main-процесс.
 *
 * Это ТОНКАЯ оболочка: наше «приложение» — это тот же веб-клиент (Web/),
 * который подключается к ОДНОМУ серверу (Server/). Никакого локального
 * P2P-узла на устройстве больше нет — вся синхронизация идёт через сервер,
 * как в Telegram. Поэтому App просто открывает окно браузера с клиентом.
 *
 * В dev:  VERA_SERVER_URL (default http://localhost:3000) — адрес единого сервера.
 * В prod: грузим собранный Web/dist локально (file в Electron) или с сервера.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const SERVER_URL = process.env.VERA_SERVER_URL || 'http://localhost:3000';
const DEV = !app.isPackaged;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Открываем внешние ссылки в браузере ОС, а не в окне Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    // Разрешаем только наш сервер / локальный файл.
    if (url.startsWith('http') && !url.startsWith(SERVER_URL)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  if (DEV) {
    mainWindow.loadURL(SERVER_URL);
  } else {
    // production: сервер раздаёт собранный клиент на той же машине
    mainWindow.loadURL(SERVER_URL);
  }
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
