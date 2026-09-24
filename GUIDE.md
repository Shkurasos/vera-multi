# 🗺 VERA Multi — Полная карта приложения

> **Для чего этот файл.** Это исчерпывающая «карта» репозитория: какой файл за что
> отвечает, куда ведёт, как связаны между собой сервер, веб-клиент, десктоп-оболочка
> и скрипты. Написан для людей и программистов, которые первый раз открывают
> проект (или возвращаются после перерыва) — чтобы не тыкаться по папкам вслепую.
>
> Обновляй этот файл вместе с кодом: если добавил/переименовал файл — поправь соответствующий раздел.

---

## 1. Что это за проект

**VERA Multi** — мессенджер в стиле Telegram/Discord с богатой кастомизацией:

- 💬 личные чаты, группы, каналы;
- 📞 голосовые и видео-звонки (mesh WebRTC + серверный сигналинг);
- 🎵 музыка: библиотека, плейлисты, плеер, визуализатор;
- 🎨 темы, обои (в т.ч. «живые» видео-обои), шрифты, персональные темы чатов;
- 🛍 инвентарь/магазин: обводки аватара, плашки сообщений, стили пузырей;
- 🧑🎨 «Мастерская» — авторы создают свои кастомные предметы;
- 📱 привязка устройств по QR-ссылке («1 аккаунт = N устройств»);
- 🔐 пароль на приложение, приватность, уведомления, звуки чатов;
- 🤖 боты и ИИ-модели (примитивный, но рабочий BotFather).

### Технологический стек

| Слой | Технология |
|---|---|
| **Сервер** | Node.js + Express + Socket.io, JSON-файл-БД (`Server/data/vera.json`), без внешней БД |
| **Веб-клиент** | React 18 + TypeScript + MUI 5 + Zustand (persist/sync) + Vite |
| **Реалтайм** | Socket.io (websocket transport), события `message:*`, `typing:*`, `callroom:*`, `store:*` |
| **Десктоп** | Electron-оболочка (`App/`), открывает тот же веб-клиент, никакого локального узла |
| **P2P-режим** | legacy: `services/peer.ts` — мост в `window.vera` (текущий сервер-режим его не требует) |
| **Синхронизация** | универсальный `store:updated` поверх `/api/sync/stores/:name` (last-write-wins) |
| **Деплой** | Render Free (Docker), Fly.io (`deploy.ps1`), локально — Cloudflare Tunnel |

### «Три сущности» репозитория

```
VERA Multi /
├── Server/   ← ОДИН сервер: REST + WebSocket + раздаёт собранный Web/dist
├── Web/      ← фронтенд (React): и для браузера, и для Electron-оболочки
└── App/      ← тонкая Electron-оболочка вокруг Web/ (главное меню — main.js)
```

---

## 2. Быстрый старт (запуск)

Корневые npm-скрипты (см. `package.json`):

| Команда | Что делает |
|---|---|
| `npm run install-all` | `npm install` в `Server/` и в `Web/` |
| `npm run server` | запустить только Node-сервер (`cd Server && npm start`, порт 3000) |
| `npm run web` | запустить только Vite dev-сервер (`cd Web && npm run dev`, порт 5173) |
| `npm run build` | собрать фронт (`cd Web && npm run build` → `Web/dist`) |
| `npm run start` | запустить **и** сервер, **и** Web в двух PowerShell-окнах |
| `npm run kill` | убить все node- и vite-процессы |
| `npm run restart` | `kill && start` (перезапуск всего) |

**Локальный доступ:**
- прод-сборка (всё на одном порту, раздаёт `Express`): `http://localhost:3000`
- dev-режим (HMR + прокси `/api`, `/uploads`, `/socket.io` на `:3000`): `http://localhost:5173`

**Публичный доступ в интернет** — `cloudflared.exe tunnel --url http://localhost:3000`
(или скрипт `local/start-home.ps1`, для named-tunnel — `local/cloudflared.example.yml`).

---

## 3. Структура репозитория (карта верхнего уровня)

```
Vera_Multi/
├── package.json            — корневые npm-скрипты (start/restart/kill/server/web/build/install-all)
├── package-lock.json       — lock-файл корневого npm
├── GUIDE.md                — ЭТОТ файл
├── Server/                 — бэкенд (см. раздел 4)
├── Web/                    — фронтенд (см. раздел 5)
├── App/                    — Electron-оболочка (см. раздел 6)
├── local/                  — скрипты «домашнего» запуска с Cloudflare Tunnel (см. раздел 7)
├── deploy.ps1              — автодеплой на Fly.io
├── Dockerfile              — мульти-стейдж сборка (Web → Server) для Render/Fly
├── render.yaml             — конфиг Render Free (Docker, env, healthcheck)
├── fly.toml                — конфиг Fly.io (app, volume, region)
├── DEPLOY.md               — инструкция деплоя на Render Free (без карты)
├── SYNC.md                 — документация cross-device синхронизации (UTF-16!)
├── .github/                — CI-воркфлоу (если есть)
├── .gitignore              — gitignore корня
└── .dockerignore           — что не попадает в Docker-образ
```

### Разовые/служебные скрипты в корне

| Файл | Назначение |
|---|---|
| `srv.js` | dev-утилита: печатает строки с `socket.on(` из `Web/src/App.tsx` с номерами строк |
| `list_themes.js` | dev-утилита: список тем (`id : name`) из `themeStore.ts` |
| `patch_server.js` | ОДНОРАЗОВЫЙ патч: добавлял в `server.js` блок групповых приглашений (уже применён) |
| `patch_glow*.js` | ОДНОРАЗОВЫЕ патчи `MainLayout.tsx` для фонового свечения (уже применены) |
| `patch_editor_glow.js` | ОДНОРАЗОВЫЙ патч `ThemeEditor.tsx` (уже применён) |
| `patch_themes.js` | ОДНОРАЗОВЫЙ патч каталога тем в `themeStore.ts` (уже применён) |
| `holders.txt`, `ver.html`, `procs.txt`, `*.log`, `cf-*.log` | временные/диагностические файлы |
| `cloudflared.exe` | portable-бинарник Cloudflare Tunnel (для `tunnel --url localhost:3000`) |

> ⚠️ Патчи (`patch_*.js`) — разовые, после применения больше не нужны. Всё уже в коде.

---

## 4. Сервер — `Server/`

### Файлы

| Путь | Назначение |
|---|---|
| `Server/server.js` | **ВЕСЬ бэкенд**: конфиг, миддлвары, REST API, WebSocket, voice-комнаты, консоль. ~4100 строк, разделы `// ─── … ───` |
| `Server/package.json` | зависимости: `express`, `socket.io`, `bcrypt`, `jsonwebtoken`, `multer`, `compression`, `dotenv`, `adm-zip`, `archiver`, `music-metadata`, `uuid`, `cookie-parser`, `helmet`, `cors` |
| `Server/public/downloads/` | установщики десктопа (раздаются по `/downloads/*`, список — `/api/downloads`) |
| `Server/data/vera.json` | **БД-файл**: users, chats, messages, tracks, chatMembers, playlists, favorites, devices, linkInvites, callLogs, bots, aiModels, aiSessions, walletOrders, refreshTokens, customItems, userStores, userSettings, admins |
| `Server/uploads/` | загруженные файлы: `avatars/`, `music/`, `files/` (раздаются по `/uploads/*`) |
| `Server/.env` (опц.) | локальные секреты: `JWT_SECRET`, `CORS_ORIGIN`, `DEV_IPS`, `ADMIN_USERNAMES`, `NOWPAYMENTS_*` |

### Структура `Server/server.js` (разделы сверху вниз)

| Раздел | Что делает |
|---|---|
| `resolve modules` | резолв зависимостей из `Server/node_modules` с фолбэком в корень |
| `paths` | `DATA_DIR`, `UPLOADS_DIR`, `DB_FILE` (env или дефолты) |
| `IS_PROD / JWT_SECRET` | в проде `JWT_SECRET` обязателен (≥32 симв.); в dev — эфемерный ключ |
| `CORS_ALLOWED` | whitelist origin из `CORS_ORIGIN` + `PUBLIC_URL`; в dev без списка — всё разрешено |
| `JSON Database` | загрузка `vera.json`, нормализация полей, `saveDb()` |
| `verification codes` | in-memory коды (легаси телефон-верификация) |
| `DEV-режим по IP` | `DEV_IPS` → `user.isDev = true` (магазин + DevInspector) |
| `Админы по username` | `ADMIN_USERNAMES` env + `db.admins` |
| `Express app` | helmet, gzip (`compression`), `express.json({limit:'30mb'})`, rate-limit, security-заголовки |
| `Загрузка установщиков` | `GET /api/downloads` — список установщиков из manifests |
| `Auth middleware` | JWT-проверка Bearer-токена; CSRF double-submit |
| `Refresh tokens` | ротация + reuse-detection cookie `vera_refresh`, endpoint `/api/auth/refresh` |
| `Multer storage` | загрузка файлов: whitelist MIME/расширений, UUID-имена |
| `AUTH` | `POST /api/auth/device` (вход/регистрация по устройству), `/logout`, `/me` |
| `ADMIN routes` | `POST /api/admin/reload-db`, `POST /api/admin/grant` (X-Admin-Token) |
| `USERS routes` | поиск/профили: `GET /search?q=`, `GET /:id`, `GET /:id/customization`, `PATCH /me`, проверка ника, аватар |
| `USER SETTINGS` | `db.userSettings[userId]` — снапшот настроек (layout, приватность) |
| `UNIVERSAL STORE SYNC` | `GET/PUT/DELETE /api/sync/stores/:name` — синк любых Zustand-стора |
| `DEVICE routes` | список устройств, QR-привязка второго устройства |
| `ВП / кошелёк` | `NOWPayments` крипто-шлюз (mock-режим без ключей), баланс/пополнение |
| `CREATOR / CUSTOM SHOP` | мастерская авторов: items, публикация, revenue |
| `CHATS routes` | список/создание/изменение чатов, участники, invite-ссылки групп |
| `Приглашения в группы` | `ensureDirectChat`, `/api/chats/:id/invite`, групповые invite accept/decline |
| `MESSAGES routes` | сообщения. **Лимит: `MESSAGE_MAX_LEN = 10000` символов** |
| `FILES routes` | `POST /api/files/upload` (multipart), прикрепление к сообщениям |
| `MUSIC routes` | треки, импорт из URL (yt-dlp/ffmpeg), импорт ZIP, zip плейлиста |
| `PLAYLISTS routes` | CRUD плейлистов + треки (алиасы `/api/music/playlists` и `/api/playlists`) |
| `BOTS / AI / VOICE` | BotFather `/api/bots/*`; ИИ `/api/ai/*`; транскрибация `/api/voice/transcribe/:id` |
| `AI Theme Generator` | `POST /api/ai/theme` — тема по описанию (платно в ВП) |
| `PROFILE COMMENTS` | Steam-подобная стена комментариев на профиле |
| `FAVORITES routes` | избранные чаты |
| `Socket.io` | real-time события (см. таблицу ниже) |
| `voice rooms` | Discord-style комнаты звонков `callRooms` (in-memory) |
| `Console commands` | CLI: `help`, `users`, `chats`, `msgs`, `delchat`, `kick`, `stats`, `admin add/del`, `exit` |
| `Self-ping` | keep-alive для Render Free (не даёт контейнеру заснуть) |
| `SPA fallback` | в конце: всё, что не `/api|/uploads|/socket.io` → `Web/dist/index.html` |
| `Start` | `server.listen(PORT, '0.0.0.0')`, порт по умолчанию **3000** |

### REST API — сводка по группам

| Группа | Базовый путь | Основные эндпоинты |
|---|---|---|
| Auth | `/api/auth` | `POST /device` (вход/регистрация по id), `POST /refresh`, `POST /logout`, `GET /me` |
| Users | `/api/users` | `GET /search?q=`, `GET /:id`, `GET /:id/customization`, `PATCH /me`, `PUT /me/avatar`, `GET /username-available` |
| Chats | `/api/chats` | `GET /`, `POST /`, `GET/PATCH /:id`, участники, `POST /:id/invite` |
| Messages | `/api/messages` | `GET /:chatId?before=`, `POST /:chatId/send`, `PATCH /:id`, `DELETE /:id`, pin, reaction, mark-read, search |
| Files | `/api/files` | `POST /upload` (multipart) |
| Music | `/api/music` | треки: `GET/POST`, загрузка файла, импорт URL/ZIP, плейлисты (алиас `/api/playlists`) |
| Sync | `/api/sync/stores` | `GET`, `GET /:name`, `PUT /:name`, `DELETE /:name` |
| Devices | `/api/devices` | `GET /`, `POST /link/create`, `POST /link/accept` |
| Wallet | `/api/wallet` | баланс, пополнение (NOWPayments IPN) |
| Creator | `/api/creator` | кабинет автора, items, publish/unpublish, статистика |
| Shop | `/api/shop` | `GET /custom` — каталог кастомных предметов |
| Bots | `/api/bots` | `GET /my`, `POST /create`, `GET /:username` |
| AI | `/api/ai` | модели, файлы, train, `POST /chat`, `POST /theme` |
| Voice | `/api/voice` | `POST /transcribe/:attachmentId` |
| Profile | `/api/profile-comments` | стена комментариев |
| Favorites | `/api/favorites` | избранные чаты |
| Downloads | `/api/downloads` | список установщиков |

### Socket.io — события (клиент ↔ сервер)

**Клиент → сервер (emit):**

| Событие | Назначение |
|---|---|
| `chat:join` / `chat:leave` | войти/выйти из socket-room чата |
| `message:send` | отправить сообщение через WS (альтернатива REST) |
| `typing:start` / `typing:stop` | индикатор «печатает…» |
| `message:read` | прочитал сообщение |
| `call:offer` / `call:answer` / `call:ice-candidate` / `call:end` | legacy-звонки (журнал) |
| `callroom:join` / `callroom:leave` | войти/выйти из voice-комнаты |
| `callroom:signal` | SDP offer/answer/ICE между пирами (relay) |
| `callroom:state` | смена mic/cam/screen/deaf |

**Сервер → клиент (emit):**

| Событие | Когда шлётся |
|---|---|
| `message:new` | новое сообщение всем в `chat:<id>` |
| `message:updated` / `message:deleted` | правки/удаления |
| `typing:start` / `typing:stop` | собеседник печатает |
| `message:read` | ресепты прочтения |
| `chat:updated` | чат изменился |
| `user:online` / `user:offline` | статус присутствия |
| `wallet:updated` / `shop:owned` | кошелёк/инвентарь изменились |
| `store:updated` / `store:deleted` | универсальный синк стора с другого устройства |
| `callroom:peers` / `peer-joined` / `peer-left` / `peer-state` | состояние voice-комнаты |
| `callroom:signal` | relay WebRTC-сигналинга |
| `callroom:started` / `callroom:ended` | звонок начался/завершился в чате |
| `callroom:ring` | входящий звонок (direct-чат) |

### Хранилище и лимиты

- БД — **один JSON-файл** `Server/data/vera.json` (на Render Free: `/tmp/vera/vera.json`, теряется при рестарте — у клиента есть локальный архив `localArchive`).
- Uploads — папки `avatars/`, `music/`, `files/` (в проде — persistent-диск `/data`).
- Тело запроса: **30 МБ** (`express.json({limit:'30mb'})`) — голосовые/фото ходят как base64.
- Сообщение: **максимум 10 000 символов** (`MESSAGE_MAX_LEN = 10000`).
- Rate-limit: in-memory окно; на auth-цепочку и на mutating-API.
- Store sync: ≤128 КБ на store, ≤1 МБ на пользователя.

---

## 5. Веб-клиент — `Web/`

### Конфигурация и точка входа

| Путь | Назначение |
|---|---|
| `Web/index.html` | HTML-шаблон Vite: `#root`, `src/main.tsx`, регистрация `sw.js` (service worker) |
| `Web/vite.config.ts` | сборка + dev-сервер. **base `'./'`** (важно для Electron/file://). Dev-прокси: `/api`, `/uploads`, `/socket.io` → `localhost:3000`. Алиасы `@/*`, `@components`, `@pages`, `@store`, `@services`, шим `@mui/icons-material` |
| `Web/package.json` | react, react-dom, react-router-dom 6, MUI 5, zustand, axios, socket.io-client, qrcode, date-fns, framer-motion |
| `Web/public/` | статика: `vera.svg`, `manifest.webmanifest`, `sw.js` |
| `tsconfig*.json` | настройки TypeScript |
| `Web/dist/` | **результат `npm run build`** — его раздаёт сервер (`Server/server.js`, SPA fallback) |

### `Web/src/main.tsx` — точка входа

- Подключает побочные сторы `uiPrefsStore`, `animStore`, `outboxStore` (их `persist`-подписки).
- Глобальный **ErrorBoundary** приложения: красный экран со стеком и кнопкой «Перезагрузить».
- MUI-тема (`darkTheme`): палитра, шрифты (Space Grotesk / Manrope / Inter), скругления.
- Глобальные CSS: `html[data-ui-style]` (rounded/square/glass/compact), `data-icon-pack`, кастомные скроллбары, анимации `vera-pulse/shimmer/float`, `prefers-reduced-motion`.
- Рендерит `<HashRouter><ThemeProvider><ErrorBoundary><App/></…>`.

### `Web/src/App.tsx` — корневой компонент-маршрутизатор

- **Bootstrapping** (эффект при монтировании):
  - `authStore.checkAuth()` → `/auth/device` или P2P-режим `peer.info()`;
  - `connectSocket(token)`, `bindCallHandlers()` (звонки), `bindSocketEvents()` для чатов;
  - инициализация: тема, звуки, кастом-каталог, уведомления, архив.
- **Слушает socket-события**: `message:new`, `typing:start/stop`, `chat:updated`, `user:online/offline`, `message:read`, `wallet:updated`, `shop:owned`, `store:updated` → обновляет сторы.
- **Звук уведомлений** (`playNotificationSound`): кастомный звук чата → глобальный → дефолтный beep.

**Маршруты (HashRouter):**

| Путь | Компонент | Доступ |
|---|---|---|
| `/` | `MainLayout` | авторизован |
| `/chat/:id` | `ChatWindow` (внутри MainLayout) | авторизован |
| `/profile` | `ProfilePage` | авторизован |
| `/devices` | `DevicesPage` | авторизован |
| `/contacts` | `ContactsPage` | авторизован |
| `/calls` | `CallLogPage` | авторизован |
| `/botfather` | `BotFatherPage` | авторизован |
| `/admin` | `AdminToolsPage` | авторизован |
| `/link` | `AcceptLinkPage` | публичный |
| `/download` | `DownloadPage` | публичный |

Глобальные оверлеи поверх маршрутов: `AppLockGate`, `MusicPlayer` (не размонтируется при навигации), `StoreOpen`, `MobileBottomNav`, `DevInspector`, звоночные `CallRingModal` / `CallOverlay` / `CallMiniBar` / `CallAudioSink`.

### Страницы — `Web/src/pages/`

| Файл | Что это | Куда ведёт / что делает |
|---|---|---|
| `MainLayout.tsx` | Каркас после логина: сайдбар + зона чатов/страниц. CSS-переменные layout (`--vera-density`, `--vera-radius`, `--vera-nav-pos`), полноэкранные обои (стеклянные панели). Мобильный вид: список чатов / чат на весь экран | Рендерит `Sidebar`, `ChatWindow` (`/chat/:id`), `WelcomeScreen`, `BotFatherPage`, `AdminToolsPage` |
| `ProfilePage.tsx` | Свой профиль: фото, имя, «о себе», дата рождения/страна, QR устройства, темы, инвентарь, кастомизация (баннер/витрина/статус) | `usersApi`, `devicesApi`, `profileCustomizationStore`, `profileDraftStore`, `themeStore` |
| `DevicesPage.tsx` | Список устройств аккаунта, QR-привязка нового, переименование/удаление | `devicesApi`, `getDeviceId()` |
| `AcceptLinkPage.tsx` | **Публичная** `/#/link?token=…`: привязывает текущее устройство к аккаунту по QR | `devicesApi`, `authStore` |
| `DownloadPage.tsx` | **Публичная** `/#/download`: список установщиков десктопа по платформе | `downloadsApi` |
| `ContactsPage.tsx` | Контакты: список, добавление по pubkey/ссылке, пригласительная ссылка | `peer` (P2P), `chatStore` |
| `CallLogPage.tsx` | История звонков (audio/video) | `peer.listCallLog` (P2P) |
| `BotFatherPage.tsx` | «BotFather»: создание/управление ботами | `botsApi` |
| `AdminToolsPage.tsx` | Админ-инструменты: сканер URL, прокси-логи, Repeater | `adminApi`, `aiLmmApi` |

### Компоненты чата — `Web/src/components/` (часть 1)

| Компонент | Назначение | Ключевые связи |
|---|---|---|
| `Sidebar.tsx` | Список чатов слева: поиск, табы (Всё/Архив/Группы), категории, кнопки тем/настроек, онлайн-индикаторы | `chatStore`, `chatPrefsStore`, ленивые `ThemeEditor`/`ThemeMarketplace` |
| `WelcomeScreen.tsx` | Заглушка «Нет сообщений. Напишите первым!» при пустом чате | `chatStore` |
| `ChatWindow.tsx` | **Главный экран чата**: шапка (имя/аватар/поиск/инфо/меню), лента сообщений (группировка по датам), поле ввода (текст/файлы/голос/emoji), кнопки звонка, обои, поиск, reply/forward. **Скролл: всегда открывается на последнем сообщении (pin-to-bottom + rAF + MutationObserver до 6с); скроллбар справа всегда виден (`overflowY:'scroll'` + `scrollbarGutter:'stable'`); лимит ввода — 10 000 символов** | `chatStore`, `chatPrefsStore`, `chatFontStore`, `chatSettingsStore`, `chatSoundStore`, `chatThemeStore`, `chatBgPrefsStore`, `authStore`, `themeStore`, `draftsStore`, `MessageBubble`, `CallModal`, `ChatInfoPanel`, `ChatWallpaper` |
| `MessageBubble.tsx` | Пузырь сообщения: текст/медиа/аудио/голос/документы, hover-меню (reply/forward/edit/delete/pin/reactions), аватар из живого `authStore`/`activeChat.members`, полноэкранный просмотр фото/видео через `createPortal(…, document.body)` | `chatStore`, `themeStore`, `authStore`, `customEquipStore`, `rarityStyles` |
| `ChatInfoPanel.tsx` | Панель «Информация о чате»: участники, имя/фото, приглашения, медиа, выход | `chatsApi`, `filesApi`, `usersApi`, `chatStore` |
| `ChatWallpaper.tsx` | Движок обоев: 15 типов (time, parallax, touch, gradient, particles, waves, grid, aurora, matrix, snow, rain, stars, noise, blob) | `wallpaperSpec` → CSS |
| `ChatThemeDialog.tsx` | Диалог персональной темы чата (пресеты + свои) | `chatThemeStore` |
| `WallpaperSettingsDialog.tsx` | Обои чата: стоковые фото, своё фото/видео (IndexedDB) | `chatBgPrefsStore`, `chatLiveBgStorage` |
| `NotificationSettingsDialog.tsx` | Звук/громкость уведомлений чата | `chatSoundStore`, `chatPrefsStore` |
| `GlobalSoundSettingsDialog.tsx` | Глобальный звук уведомлений + громкость | `chatSoundStore` |
| `LayoutDesignerDialog.tsx` | Конструктор раскладки: стороны сайдбара/плеера/шапки/инпута, плотность, радиусы, ширина сообщений | `userSettingsStore` |
| `SettingsDialog.tsx` | Общие настройки: внешний вид, уведомления, приватность, данные, безопасность, язык, устройства | `userSettingsStore`, `authStore`, `deviceStore`, `FontPicker` |
| `FontPicker.tsx` | Выбор шрифта + управление своими шрифтами (загрузка .ttf/.otf/.woff/.woff2, список, удаление) — общий для «шрифта всего приложения» и шрифтов чата | `customFontsStore`, `customFontStorage` |
| `AppLockGate.tsx` | Гейт «приложение заблокировано паролем» (sessionStorage) | `userSettingsStore` (hashPassword) |

### Компоненты звонков (часть 1.1)

| Компонент | Назначение | Связи |
|---|---|---|
| `CallModal.tsx` | Диалог нового звонка (инициатор): выбор аудио/видео, WebRTC-подключение; legacy `IncomingCallModal` | `socket.ts`, `callPeers` |
| `CallOverlay.tsx` | Полноэкранная панель активного звонка: сетка тайлов, контролы mic/cam/screen/deaf/leave/minimize | `callStore`, `CallTile` |
| `CallRingModal.tsx` | Экран **входящего** звонка: принять/отклонить + рингтон (`callroom:ring`) | `callStore` |
| `CallTile.tsx` | Один участник: аватар/видео + рамка при speaking + иконки mic/cam | `callStore` (CallPeer) |
| `CallMiniBar.tsx` | Компактная плашка звонка, когда оверлей свёрнут | `callStore` |
| `CallAudioSink.tsx` | Невидимый компонент: звук ВСЕХ удалённых пиров (не пропадает при сворачивании) | `callStore` |

### Компоненты музыки, магазина, тем, профиля (часть 2)

| Компонент | Назначение | Связи |
|---|---|---|
| `MusicPlayer.tsx` | Глобальный плеер (всегда в App): play/pause/next/prev/volume/repeat/shuffle/queue, мини-визуализатор | `musicStore`, `playlistStore`, `musicVisualizerStore` |
| `MusicLibrary.tsx` | Библиотека треков: список, поиск, импорт файла/URL/ZIP, в плейлист | `musicStore`, `playlistStore`, `musicApi` |
| `PlaylistsPanel.tsx` | Плейлисты: CRUD, реордер, публичность, отправка в чат | `playlistStore`, `musicStore` |
| `MusicVisualizerOverlay.tsx` | Оверлей-визуализатор (bar/glow/pulse/wave) по `level/bass/beat` | `musicVisualizerStore` |
| `MusicVisualizerSettingsDialog.tsx` | Настройки визуализатора: цвет, стиль, режимы, размещение | `musicVisualizerStore` |
| `PlaylistMessageCard.tsx` | Карточка плейлиста в сообщении: play/preplay, скачать ZIP | `musicStore`, `musicApi` |
| `SendPlaylistDialog.tsx` | «Отправить плейлист в чат» | `chatStore`, `messagesApi` |
| `Store.tsx` | **Инвентарь/магазин** (оверлей): категории (profile/selfcard/theme/wallpaper/bubble), каталог, выбор, редкости | `shopStore`, `rarityStyles` |
| `Workshop.tsx` | **Мастерская авторов**: свои предметы, публикация, редактор | `creatorApi`, `CustomItemPreview`, `CreatorEditor` |
| `CreatorEditor.tsx` | Редактор кастомного предмета: name/description/price/spec | `creatorApi`, `customStyle` |
| `CustomItemPreview.tsx` | Превью кастомного предмета по `spec` | `customStyle` (specToStyle) |
| `ThemeEditor.tsx` | Редактор темы: цвета/фоны/паттерны (SVG), finish (solid/glass/matte/metal), генерация ИИ, экспорт/импорт по ссылке | `themeStore`, `aiApi` |
| `ThemeMarketplace.tsx` | Каталог тем: пресеты, свои темы, редактор, копирование ссылки | `themeStore`, `ThemeEditor` |
| `ProfileCustomizeDialog.tsx` | Кастомизация профиля: баннер, акцент, прозрачность, витрина, статус | `profileCustomizationStore`, `shopStore` |
| `ProfileCommentsWall.tsx` | Стена комментариев на профиле (create/delete, realtime) | `api`, `socket` |
| `ProfilePinnedPlaylistBar.tsx` | Мини-плеер закреплённого плейлиста на профиле | `usersApi`, `musicApi`, `playlistStore` |
| `ActivityLine.tsx` | Discord-строка активности («Слушает трек…»), режим `auto` из `musicStore` | `profileCustomizationStore`, `musicStore` |
| `UserProfileModal.tsx` | Модалка профиля собеседника: инфо, «Написать», репутация, комментарии | `usersApi`, `chatsApi`, `chatStore` |

### Прочие компоненты (часть 3)

| Компонент | Назначение |
|---|---|
| `ContextMenu.tsx` | Универсальный контекстный модальный список (пункты, danger, divider) |
| `MobileBottomNav.tsx` | Нижняя навигация на мобильном: чаты, группы, музыка, профиль, устройства |
| `InviteLinkDialog.tsx` | Диалог пригласительной ссылки (P2P + server), вставка из буфера |
| `GroupInviteCard.tsx` | Карточка приглашения в группу (`vera://group?token=…`) принять/отклонить |
| `DevInspector.tsx` | DEV-инспектор (только `isDev`): горячая клавиша Z → инфо об элементе, путь к файлу |
| `VeraLogo.tsx` | SVG-логотип Vera (скруглённый квадрат + перевёрнутый треугольник) |
| `StarIcon.tsx` | Кастомная иконка звезды для «Избранного» |

### Сервисный слой — `Web/src/services/`

| Файл | Что делает |
|---|---|
| `api.ts` | **Единый axios-клиент к `/api`**: интерцепторы (Bearer-токен из localStorage, CSRF `X-CSRF-Token`), авто-refresh на 401 + ретрай, `getDeviceId()`. Экспортирует: `authApi`, `chatsApi`, `messagesApi`, `filesApi`, `usersApi`, `musicApi`, `playlistsApi`, `favoritesApi`, `voiceApi`, `downloadsApi`, `devicesApi`, `creatorApi` |
| `socket.ts` | Singleton socket.io-клиента: `connectSocket(token)` (websocket + reconnect), `disconnectSocket()`, `getSocket()`, хелперы `joinChat/leaveChat/sendTyping*/sendReadReceipt` |
| `callPeers.ts` | Mesh-менеджер WebRTC для voice-комнат: `attachRoom/detachRoom`, `RTCPeerConnection`, offer/answer/ICE через `callroom:signal`, voice-activity (AnalyserNode), screen share. **Важно**: слушатели перевешиваются при пересоздании соккета (сравнение `boundSocket`) — фикс «звонок работает через раз» |
| `botsApi.ts` | `botsApi` (боты) + `aiApi` (ИИ: модели, train, chat, генератор тем) |
| `notifications.ts` | Нативные push-уведомления (Web Notifications API) + звук |
| `localArchive.ts` | Локальный зеркальный архив в IndexedDB (`vera-archive-<userId>`, `chats`/`messages`) — история переживает рестарт сервера |
| `chatLiveBgStorage.ts` | Живые обои (видео) в IndexedDB + blob-URL |
| `customFontStorage.ts` | Свои шрифты (.ttf/.otf/.woff/.woff2) в IndexedDB: `saveFontFile/loadFontFiles/deleteFontFile` + `injectFontFace/removeFontFace` (`@font-face` со ссылкой на Blob) |
| `peer.ts` | **P2P-мост в `window.vera`** (legacy-режим). `isPeerAvailable()`, `peer.*`. Без `window.vera` вызовы падают с понятной ошибкой |
| `storeSync.ts` | Универсальный `syncedStore()` — middleware синка Zustand-стора (server + socket, last-write-wins) |
| `storeSyncSimple.ts` | Упрощённый `enableStoreSync(name, api, debounce)` — подключение синка к существующим сторам |

### Хуки, типы, стили, утилиты — `Web/src/`

| Файл | Что делает |
|---|---|
| `hooks/useActiveWallpaper.ts` | Активные полно-экранные обои (`shopStore`/`customEquipStore`/`themeStore`), `isLightColor()` |
| `types/index.ts` | **Доменные типы**: `User`, `Chat`, `ChatMember`, `Message`, `MessageAttachment`, `MessageReaction`, `Track`, `Playlist` |
| `types/bots.ts` | Типы ботов/ИИ: `Bot`, `BotCommand`, `BotKeywordRule`, `ScanResult`, `ProxyLogEntry`, `RepeaterEntry` |
| `utils/customStyle.ts` | `specToStyle(spec)` — рендер `CustomSpec` в CSS/MUI sx |
| `utils/rarityStyles.ts` | 21 редкость для обводок/плашек: `RARITY_META`, `buildShopRingSx/buildPlaqueSx` |
| `utils/appFont.ts` | Шрифт приложения: `DEFAULT_APP_FONT`, `APP_FONT_OPTIONS` (список вариантов), `resolveAppFont`, `appFontStyles` |
| `utils/customFonts.ts` | Чистые помощники своих шрифтов: `sanitizeFontFamily`, `customFontCss`, `checkFontFile`, `formatFontSize`, `FONT_FILE_ACCEPT`, `MAX_FONT_FILE_SIZE` |
| `utils/themeLink.ts` | Экспорт/импорт темы ссылкой (base64 JSON): `themeToLink`, `themeFromLink`, `CUSTOM_THEME_ID_START` (реэкспортируется из `themeStore`) |
| `styles/motion.ts` | Кривые анимаций (`easeOut/spring/emphasized`), `membranePressSx` |
| `mui-icons-shim.tsx` | Шим `@mui/icons-material` → no-op (см. vite alias) |

### Zustand-сторы — `Web/src/store/` (полная карта)

| Файл | Что хранит / делает | Синхронизация |
|---|---|---|
| `authStore.ts` | Текущий `user`, `token`, `isAuthenticated`, `isPeerMode`. `login/logout/checkAuth`, `peerInfoToUser()`. При логине: `connectSocket`, тема, `initStoreSyncOnLogin` | — |
| `chatStore.ts` | Чаты и сообщения + действия: `loadChats`, `loadMessages` (с архивом), `sendMessage`, `edit/delete/pin/reaction`, `markRead`, typing, online. Адаптеры `peerChatToChat/peerMsgToMsg` для P2P | — (архив в IndexedDB) |
| `chatPrefsStore.ts` | Пер-чат преференсы: закреплённые, архив, mute, закреплённое сообщение | `enableStoreSync` |
| `chatFontStore.ts` | Стоковые шрифты (`STOCK_FONTS`) + шрифт на чат | `enableStoreSync` |
| `chatSettingsStore.ts` | Размер шрифта/эмодзи, font-family, кастомные шрифты (`BUILTIN_FONTS`; старые загрузки мигрируют в `customFontsStore`) | `enableStoreSync` |
| `customFontsStore.ts` | **Свои шрифты пользователя** (один список на приложение): `fonts`, `hydrate/addFont/removeFont`, файлы в IndexedDB, `@font-face` на Blob, сброс выбранного шрифта при удалении | — (локально, IndexedDB) |
| `chatSoundStore.ts` | Звуки уведомлений (data URL) и громкости на чат + глобальный звук | `enableStoreSync` |
| `chatThemeStore.ts` | Персональные темы чатов (`CHAT_THEME_PRESETS`), overrides | `enableStoreSync` |
| `chatBgPrefsStore.ts` | Обои: `STOCK_WALLPAPERS`, глобальные/per-chat, яркость фона | — |
| `themeStore.ts` | **Темы**: `THEMES` (каталог), `setTheme`, finish (solid/glass/matte/metal), `themeToLink/themeFromLink` (в `utils/themeLink.ts`), `CUSTOM_THEME_ID_START`, `getFinishStyles`, отдельные цвета времени (`messageTimeColor` на сообщениях, `chatTimeColor` в списке чатов) | persist + сервер |
| `musicStore.ts` | Библиотека треков, очередь, currentTrack, play/pause/next/prev, volume, repeat, shuffle | — |
| `musicVisualizerStore.ts` | Настройки визуализатора (цвет, стиль, режимы, размещение) | — |
| `playlistStore.ts` | Плейлисты (свои + публичные), CRUD, треки, реордер, `getPlaylistTracks` | — |
| `shopStore.ts` | **Инвентарь**: `SHOP_CATALOG`, категории, owned, активный предмет, `selectShopItem`, баланс ВП | `enableStoreSync` |
| `customEquipStore.ts` | Кастомные предметы авторов: `items` (кэш), `equipped` (что надето), `load/upsert/setEquipped` | — |
| `deviceStore.ts` | P2P-устройства: `info`, `linked`, `invite`, `init/refreshLinked/makeInvite/acceptInvite` (legacy) | — |
| `draftsStore.ts` | Черновики сообщений по чатам (`chatId → text`) | `enableStoreSync` |
| `outboxStore.ts` | Очередь исходящих сообщений (оффлайн): `enqueue/remove/markFailed/setOnline/flush` | persist (localStorage) |
| `profileCustomizationStore.ts` | Кастомизация профиля: баннер, акцент, прозрачность, витрина, статус (`ActivityKind`) | `enableStoreSync` |
| `profileDraftStore.ts` | Черновик редактора профиля (восстановление после F5/выхода) | `enableStoreSync` |
| `uiPrefsStore.ts` | Набор иконок (`IconPack`) + UI-стиль (`UiStyle`), применяет `data-*` на `<html>` | persist |
| `userSettingsStore.ts` | Глобальные настройки: layout, приватность, язык, яркость, пароль (`hashPassword`), `hydrateSettingsFromServer/startSettingsAutoSync` | persist + сервер |
| `animStore.ts` | Вкл/выкл групп анимаций (`data-anim-off-*` на `<html>`) | persist |
| `callStore.ts` | Состояние звонка: `activeChatId`, `kind`, `peers`, `local` (mic/cam/screen/deaf), `ring`, `activeRooms`; `startCall/joinCall/leaveCall/toggleMic/Cam/Deaf/Screen/acceptRing/declineRing`; `CALL_ICE_SERVERS` (STUN/TURN) | — (in-memory) |

---

## 6. Десктоп-оболочка — `App/` (Electron)

| Путь | Назначение |
|---|---|
| `App/electron/main.js` | Electron main-процесс: создаёт `BrowserWindow` 1280×800, грузит единый сервер (`VERA_SERVER_URL`: dev `localhost:3000`, prod `https://vera-koto.onrender.com`). Внешние ссылки открывает в системном браузере, deep-link `vera://` пробрасывает в preload |
| `App/electron/preload.js` | contextBridge → `window.veraDesktop`: `platform()`, `onDeepLink(handler)` (привязка устройств по ссылке) |
| `App/package.json` | `electron` + `electron-builder`; сборка `npm run build` → NSIS-инсталлер |
| `App/dist-electron-build/` | готовая сборка (win-unpacked, установщик) |
| `App/dist-electron/` | промежуточная папка electron-builder |

> ⚠️ **App — просто оболочка.** Функционал живёт в `Web/` (тот же клиент, что в
> браузере). Десктоп НЕ содержит локального P2P-узла. Файлы `services/peer.ts` /
> `deviceStore.ts` — legacy P2P-режим, в серверном режиме не используются.

---

## 7. Домашний запуск — `local/`

| Файл | Назначение |
|---|---|
| `start-home.ps1` | Запуск на своём ПК: `-Server` (Node :3000), `-Tunnel` (Cloudflare), `-All` (оба), `-Domains` |
| `start-home.bat` | Обёртка над `start-home.ps1` |
| `install-autostart.ps1` | автозапуск сервера/туннеля |
| `cloudflared.example.yml` | пример конфига named-tunnel (поддомен → localhost:3000) |
| `README-HOME.md` | инструкция домашнего запуска |

---

## 8. Деплой и CI

| Файл | Назначение |
|---|---|
| `Dockerfile` | Мульти-стейдж: собрать `Web` (Vite) → в образ `Server` положить `Web/dist`. ENV: `NODE_ENV=production`, `PORT=3000`, `DATA_DIR=/data`, `UPLOADS_DIR=/data/uploads`, `DB_FILE=/data/vera.json` |
| `render.yaml` | Render Free: web-service `vera-koto`, Docker, region frankfurt, healthcheck `/api/downloads`, `JWT_SECRET` (auto), NOWPayments |
| `deploy.ps1` | Автодеплой на **Fly.io**: проверка flyctl, init app, volume, deploy |
| `fly.toml` | конфиг Fly: app, primary_region, `[[mounts]]` volume, build |
| `DEPLOY.md` | подробная инструкция деплоя на Render Free |
| `SYNC.md` | документация cross-device синхронизации (файл закодирован UTF-16) |

---

## 9. Потоки данных (как это работает)

### 9.1 Авторизация (аккаунт = устройство)
```
main.tsx → App.tsx → authStore.checkAuth()
   ├─ Серверный режим: POST /api/auth/device {deviceId} → {token, user}
   │     (устройство «не первое» — только по QR-привязке)
   │     → connectSocket(token) → bindSocketHandlers() (звонки + чат)
   └─ P2P-режим (legacy): peer.info() → isPeerAvailable
```

### 9.2 Жизненный цикл сообщения (серверный режим)
```
ChatWindow.handleSend() → chatStore.sendMessage(chatId, text)
   → messagesApi.send() → POST /api/messages/:chatId/send
   → Server: handleSendMessage() (валидация ≤10000, attachments ≤20, 30MB тело)
   → saveDb(); io.to(`chat:${chatId}`).emit('message:new', msg)
   → все клиенты: App.tsx socket.on('message:new') → chatStore добавляет msg
   → локально: запись в localArchive (IndexedDB) для оффлайна/быстрого открытия
```

### 9.3 Голосовой звонок (mesh WebRTC, сигналинг через сервер)
```
Инициатор: callStore.startCall(chatId, kind) → attachRoom() → callroom:join
   Сервер: callRooms.set(...); wasEmpty && direct → callroom:ring собеседнику
   Собеседник: CallRingModal → acceptRing() → joinCall() → эта же комната
   Далее: callroom:peers → createPeer() → offer/answer/ICE через callroom:signal
   Медиа: peer-to-peer (UserMedia); по серверу идут только сигналы
   (важно: обработчики перевешиваются при новом сокете — см. callPeers.ts)
```

### 9.4 Синхронизация настроек между устройствами
```
Любой store с enableStoreSync:
   изменение → debounce(800ms) → PUT /api/sync/stores/:name
   сервер сохраняет → io.emit('store:updated') всем устройствам (кроме отправителя)
   другие устройства: api.setState(data) (last-write-wins)
   персист в localStorage: `vera_sync_<name>_updated` для версионности
```

### 9.5 Открытие чата всегда на последнем сообщении
```
ChatWindow useLayoutEffect (при открытии):
   pinToBottom() = scrollIntoView(end) + scrollTop = scrollHeight
   затем: rAF-цикл (~90 кадров) + поллинг scrollHeight (50мс, до 6с)
          + MutationObserver (новые сообщения/медиа в DOM)
   останавливается, когда пользователь сам прокрутил вверх (atBottomRef=false)
   скроллбар всегда виден: overflowY:'scroll' + scrollbarGutter:'stable'
```

---

## 10. Схема данных (`Server/data/vera.json`)

| Коллекция | Что хранит |
|---|---|
| `users` | `{id, username, firstName, lastName, bio, avatarUrl, isOnline, lastSeen, createdAt, …, isDev, isAdmin, pinnedPlaylistId, pinnedTrackId, activeRing, activeSelfCard, themeId}` |
| `chats` | `{id, type: private|group|channel|direct|saved, name, description, avatarUrl, inviteLink, isPublic, ownerId, members[], …}` |
| `chatMembers` | `{id, chatId, userId, role, isMuted, lastReadMessageId, joinedAt}` |
| `messages` | `{id, chatId, senderId, text, content, replyToId, attachments[], type, readBy[], isEdited, isPinned, isDeleted, createdAt}` |
| `tracks` | `{id, title, artist, album, duration, fileUrl, coverUrl, uploadedById, playsCount, createdAt}` |
| `playlists` | `{id, name, description, coverUrl, userId, isPublic, createdAt}` |
| `favorites` | избранные чаты |
| `devices` | `{id, deviceId, name, isPrimary, accountId, nostrPk, linkedAt}` |
| `linkInvites` | QR-ссылки привязки устройств |
| `callLogs` | журнал legacy-звонков |
| `bots` / `aiModels` / `aiSessions` | боты, ИИ-модели, сессии |
| `walletOrders` | заказы пополнения ВП |
| `refreshTokens` | refresh-токены с ротацией |
| `customItems` | кастомные предметы авторов (мастерская) |
| `userSettings` | `{userId → {layout, brightness, privacy, …}}` |
| `userStores` | `{userId → {storeName → {data, __updatedAt, __clientId}}}` (универсальный синк) |
| `admins` | имена админов, добавленных через консоль |

---

## 11. Быстрый указатель: «где что править»

| Хочу изменить… | Файл |
|---|---|
| Внешний вид пузыря сообщения (цвета/отступы/hover/порталы) | `Web/src/components/MessageBubble.tsx` |
| Скролл чата, open-вниз, кнопку «вниз», поле ввода | `Web/src/components/ChatWindow.tsx` |
| Список чатов слева | `Web/src/components/Sidebar.tsx` |
| Тему/цвета приложения | `Web/src/store/themeStore.ts` + `Web/src/components/ThemeEditor.tsx` |
| Обои (картинка/видео/живые) | `Web/src/components/ChatWallpaper.tsx`, `chatBgPrefsStore.ts`, `chatLiveBgStorage.ts` |
| Звонки (WebRTC) | `Web/src/services/callPeers.ts`, `callStore.ts`, компоненты `Call*` |
| Музыку/плейлисты | `Web/src/store/musicStore.ts`, `playlistStore.ts`, `components/Music*`, `PlaylistsPanel.tsx` |
| Профиль/кастомизацию | `Web/src/pages/ProfilePage.tsx`, `profileCustomizationStore.ts`, `ProfileCustomizeDialog.tsx` |
| Синк настроек между устройствами | `Web/src/services/storeSyncSimple.ts`, `Server/server.js` (`/api/sync/stores`) |
| Лимит длины сообщения | `Server/server.js` → `MESSAGE_MAX_LEN` (сейчас 10000) + `ChatWindow.tsx` → `inputProps.maxLength` |
| REST-эндпоинт | `Server/server.js` (раздел ресурса) + `Web/src/services/api.ts` |
| Socket-событие | `Server/server.js` (socket-блок) + `Web/src/App.tsx` / сервисы |
| Деплой | `Dockerfile`, `render.yaml`, `deploy.ps1`, `fly.toml`, `DEPLOY.md` |

---

## 12. Советы для разработчиков

1. **Изменения на сервере требуют перезапуска** — `npm run restart` (или вручную: убить node, `cd Server; node server.js`). Клиентские правки в dev подхватывает HMR Vite.
2. **Продакшн-сборку раздаёт сервер** — после правок фронта обязательно `npm run build`, иначе по `:3000`/через туннель останется старый `Web/dist`.
3. **Скроллбар чата** остаётся всегда видимым намеренно (`overflowY:'scroll'` + `scrollbarGutter:'stable'`): «ховер» справа — это и есть скроллбар. Не меняй на `auto`, чтобы не вернуть баг «открывается сверху».
4. **Туннель**: `cloudflared.exe tunnel --url http://localhost:3000` — быстрая публикация; для стабильной — named-tunnel через `local/`. При нестабильности сети туннель переподключается сам.
5. **Не коммить** `node_modules/`, `App/dist-*`, бинарники (`cloudflared.exe`) и `.env`.
6. **`SYNC.md` закодирован UTF-16** — при открытии без указания кодировки будет «мусор»; руководствуйся `storeSync.ts`/`storeSyncSimple.ts`.
7. **Новые файлы**: компоненты → `components/`, страницы → `pages/`, сторы → `store/`, API-группы → `services/api.ts`.
8. **Единый HTTP-клиент**: все запросы через `services/api.ts` (axios, авт-refresh, CSRF). Исключение — `storeSync*` (fetch) — осознанно.

---

*Конец карты. Описаны все файлы `Web/src/*`, `Server/`, `App/`, `local/` и корневые скрипты.*