/* Vera Messenger — минимальный service worker.
 * - Precache: оболочка приложения (index.html + ассеты) при первом запросе.
 * - Runtime: NetworkFirst для /api/**, CacheFirst для /assets/** и /uploads/**.
 * - Fallback: если сеть недоступна и есть кэш index.html — отдаём его,
 *   чтобы SPA работало оффлайн (данные подгрузятся из IndexedDB-архива).
 */
const CACHE = 'vera-v3';
const APP_SHELL = ['./', './index.html', './vera.svg', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('vera-') && k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Vite-модули и персональные API-ответы нельзя отдавать из старого кэша.
  if (url.origin !== self.location.origin ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/') ||
      url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/api/')) return;
  // Не кэшируем socket.io и API-мутации; API-GET можно stale-while-revalidate.
  if (url.pathname.startsWith('/socket.io')) return;

  // CacheFirst для ассетов и медиа.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/uploads/') || /\.(png|jpg|jpeg|svg|webp|css|js|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        });
      }),
    );
    return;
  }

  // Навигация: NetworkFirst с fallback на index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html')),
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