# WebRTC / Звонки — как исправить «не слышно, не видно экран»

## Частые причины
1. **Cloudflare WARP** блокирует WebRTC UDP → отключи WARP временно для звонков
2. **Права на микрофон/камеру** не даны → проверь в настройках браузера/Electron/системы
3. **`getUserMedia` падает** → смотри консоль (F12) на ошибки `NotAllowedError`, `NotFoundError`
4. **TURN-сервер перегружен** → `openrelay.metered.ca` бесплатный, иногда не работает
5. **Экран не передаётся** → `getDisplayMedia` в Electron требует явного разрешения и источника

## Как проверить
1. **Открой админ-панель** (если админ) → кнопка «🔍 Диагностика WebRTC / Звонков»
2. **Консоль F12**: запусти `runCallDiagnostics()` вручную (импорт: `import { runCallDiagnostics } from './services/callDiagnostics'`)
3. **Посмотри, что красное** (❌):
   - ❌ getUserMedia API недоступен → старый браузер или заблокирован
   - ❌ Доступ к микрофону запрещён → Settings → Privacy & Security → Microphone
   - ❌ STUN и TURN недоступны → UDP заблокирован (WARP, VPN, файрволл, корпоративная сеть)
   - ⚠️ Cloudflare WARP включён → отключи WARP (системный трей → Cloudflare WARP → Disconnect)

## Что исправить
### 1. Cloudflare WARP
Если обнаружен WARP:
- **Отключи** WARP на время звонка (системный трей → Cloudflare WARP → Disconnect)
- Либо добавь Vera Multi в Split Tunnels (Settings → Gateway → Split Tunnels → исключи localhost / твой домен)

### 2. Права на микрофон/камеру
**Браузер (Chrome/Edge):**
- `chrome://settings/content/microphone` — разреши сайту
- `chrome://settings/content/camera` — разреши сайту

**Electron (десктопное приложение):**
- Уже настроено в `App/electron/main.js:214-242` (setPermissionRequestHandler)
- Если не работает → проверь **системные права** (Windows Settings → Privacy → Microphone/Camera)

**Windows:**
- Settings → Privacy → Microphone → Allow apps → включи для браузера/Electron

### 3. Демонстрация экрана (`getDisplayMedia`)
В Electron обработчик уже есть (`App/electron/main.js:231-242`), но если не работает:
- **Проверь**, что `desktopCapturer.getSources()` возвращает экраны (консоль в `main.js`)
- **Picker UI** не показывается по умолчанию (берётся первый экран) — можно добавить диалог выбора

### 4. TURN-сервер
Публичный `openrelay.metered.ca` иногда не работает. Замени на свой или Cloudflare Calls:

**Cloudflare Calls (бесплатно до 10k минут/мес):**
```ts
// CallModal.tsx / callStore.ts
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Cloudflare TURN (после регистрации на dash.cloudflare.com)
    {
      urls: 'turn:turn.cloudflare.com:3478?transport=udp',
      username: 'YOUR_APP_ID',
      credential: 'YOUR_APP_SECRET',
    },
  ],
};
```

**Свой coturn (самохост):**
```bash
# Ubuntu
sudo apt install coturn
sudo nano /etc/turnserver.conf
```
```conf
listening-port=3478
fingerprint
lt-cred-mech
user=vera:password123
realm=yourdomain.com
```
```bash
sudo systemctl start coturn
```

## Отладочный лог для звонков
Добавь в `callPeers.ts` (строка 52):
```ts
try {
  s = await navigator.mediaDevices.getUserMedia({
    audio: savedInput ? { ...baseAudio, deviceId: { exact: savedInput } } : baseAudio,
    video,
  });
  console.log('✅ getUserMedia OK:', s.getTracks().map(t => `${t.kind}:${t.label}`));
} catch (e) {
  console.error('❌ getUserMedia FAILED:', e.name, e.message, e);
  // ...
}
```

Добавь в `CallModal.tsx` (строка 99):
```ts
const stream = await navigator.mediaDevices.getUserMedia(constraints).catch((e) => {
  console.error('❌ getUserMedia (CallModal):', e.name, e.message);
  return null;
});
```

## Тестовая страница WebRTC
Открой https://test.webrtc.org/ или https://webrtc.github.io/samples/ чтобы проверить, работает ли WebRTC вообще (без Vera Multi).

## Поддержка
Если диагностика показала ✅ всё OK, но звонок не работает — ищи ошибки в консоли (F12) и логи сервера.
