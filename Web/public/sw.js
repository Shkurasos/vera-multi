/* Vera Messenger — сервис-воркер для офлайн-режима.
 * - Precache: оболочка приложения (index.html + ассеты).
 * - Runtime: NetworkFirst для /api/chats, /api/messages/:chatId, /api/music/*,
 *   /api/users/*, /api/auth/me (кэш — только без сети);
 *   Stale-While-Revalidate для /uploads/*.
 * - CacheFirst для /assets/** и статические медиа.
 * - Fallback: если сеть недоступна и есть кэш — отдаём его,
 *   данные подгружаются из IndexedDB-архива (offlineStore / localArchive).
 */
// v11: API перешли на NetworkFirst; смена имени сносит старый runtime-кэш
// с устаревшим /api/auth/me.
const CACHE = 'vera-v11';
const RUNTIME_CACHE = 'vera-runtime-v11';
const APP_SHELL = ['./', './index.html', './vera.svg', './vera-icon.png', './favicon.ico', './icons/icon-192.png', './icons/icon-512.png', './manifest.webmanifest'];

// Runtime-кэшируемые API-префиксы (Stale-While-Revalidate).
const API_CACHE_PREFIXES = [
  '/api/chats',
  '/api/messages/',
  '/api/music/',
  '/api/users/',
  '/api/auth/me',
  '/uploads/', // аватары, обложки, вложения
];

// Ассеты сборки (./assets/*.js|css), на которые ссылается index.html. Без них
// офлайн открылся бы только со второго запуска: первый запуск грузит их ещё
// до регистрации SW, и fetch-обработчик их не видит.
function shellAssets(html) {
  const found = new Set();
  const re = /(?:src|href)="(\.?\/?assets\/[^"?#]+)"/g;
  let m;
  while ((m = re.exec(html))) found.add('./' + m[1].replace(/^\.?\//, ''));
  return [...found];
}

async function precacheShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(APP_SHELL).catch(() => {});
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put('./index.html', res);
    await Promise.all(shellAssets(html).map((u) => cache.add(u).catch(() => {})));
  } catch { /* офлайн при установке — дозакэшируем при следующем запуске */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('vera-') && k !== CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Проверка связи (vera-probe) должна идти в сеть: ответ из кэша выдал бы
  // офлайн за онлайн. Скачивание медиатеки (x-vera-offline) само пишет в
  // IndexedDB — второй копии аудио в кэше SW не нужно.
  if (url.searchParams.has('vera-probe') || req.headers.has('x-vera-offline')) return;
  // Внешние запросы, Vite-модули, socket.io не кэшируем.
  if (url.origin !== self.location.origin ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/') ||
      url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/socket.io')) return;

  // --- CacheFirst для статических ассетов и медиа ---
  if (url.pathname.startsWith('/assets/') || /\.(png|jpg|jpeg|svg|webp|css|js|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (!res.ok) return res;
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        });
      }),
    );
    return;
  }

  // --- API: NetworkFirst, кэш только без сети ---
  // Stale-While-Revalidate здесь опасен: /api/auth/me из кэша отдавал профиль
  // прошлого аккаунта (после пересоздания базы у того же ника новый id), и
  // свои сообщения рисовались как чужие. Данные API должны быть свежими.
  if (API_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        }).catch(() => cache.match(req).then((cached) => cached || new Response('Offline', { status: 503 }))),
      ),
    );
    return;
  }

  // --- Stale-While-Revalidate для аватаров/обложек/вложений ---
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          const fetchPromise = fetch(req).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              cache.put(req, clone).catch(() => {});
            }
            return res;
          }).catch(() => null);
          // Отдаём кэш сразу если есть, иначе ждём сеть.
          if (cached) return cached;
          return fetchPromise.then((res) => res || new Response('Offline', { status: 503 }));
        });
      }),
    );
    return;
  }

  // Навигация: NetworkFirst с fallback на index.html. Свежий index.html
  // сохраняем — офлайн откроется последняя версия клиента, а не версия с установки SW.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const type = res.headers.get('content-type') || '';
        if (res.ok && type.includes('text/html')) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', clone)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html')),
    );
  }
});

// Background Sync: когда сеть возвращается, шлём клиенту сигнал flush.
self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-outbox') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'flush-outbox' }));
      }),
    );
  }
});
