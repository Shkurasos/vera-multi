# Что сделано: диагностика и отладка WebRTC звонков

## Добавлено

### 1. **Модуль диагностики** (`Web/src/services/callDiagnostics.ts`)
Полная проверка WebRTC перед звонком:
- ✅ / ❌ `getUserMedia` API доступен
- ✅ / ❌ Права на микрофон/камеру (granted/denied/prompt)
- ✅ / ❌ `getDisplayMedia` доступен (демонстрация экрана)
- 🎤 Список аудио/видеоустройств
- 🌐 STUN (srflx) / TURN (relay) доступность
- ⚠️ Cloudflare WARP включён (блокирует UDP)

**Как использовать:**
```ts
import { runCallDiagnostics, showCallDiagnosticsAlert } from './services/callDiagnostics';

// Вариант 1: детальный результат в консоли
const result = await runCallDiagnostics();
console.log(result);

// Вариант 2: краткий алерт
await showCallDiagnosticsAlert();
```

### 2. **Кнопка диагностики в админ-панели**
- Открой админ-панель (`/admin`)
- Секция **🔍 Диагностика WebRTC / Звонков**
- Кнопка **«Запустить диагностику»**
- Результаты в консоли (F12) + алерт с проблемами

### 3. **Расширенные логи** (console.log)
Добавлены в:
- **`callPeers.ts`** (групповые звонки):
  - `[callPeers] getUserMedia запрос: {...}`
  - `[callPeers] ✅ getUserMedia OK: [...]` или `❌ FAILED`
  - `[callPeers] ICE candidate to USER_ID: ...` (STUN/TURN кандидаты)
  - `[callPeers] ICE gathering complete`

- **`CallModal.tsx`** (P2P звонки):
  - `[CallModal] getUserMedia запрос: {...}`
  - `[CallModal] ✅ getUserMedia OK: [...]` или `❌ FAILED`
  - `[CallModal] Стрим не получен, завершаем звонок`
  - `[CallModal] ICE candidate: ...`
  - `[CallModal] ICE gathering завершён`

### 4. **Документация** (`WEBRTC_DEBUG.md`)
Инструкция по устранению проблем:
- Отключение Cloudflare WARP
- Проверка прав на микрофон/камеру (браузер, Electron, Windows)
- Настройка TURN (Cloudflare Calls / coturn)
- Тестовые страницы WebRTC

## Как использовать

### Перед звонком
1. **Открой консоль** (F12)
2. **Запусти диагностику**:
   - Через админ-панель (`/admin` → «Запустить диагностику»)
   - Или в консоли:
     ```js
     import('./services/callDiagnostics').then(m => m.showCallDiagnosticsAlert())
     ```
3. **Посмотри результаты**:
   - ❌ красные — проблемы (нет прав, UDP заблокирован, WARP включён)
   - ✅ зелёные — всё ОК

### Во время звонка
1. **Открой консоль** (F12)
2. **Ищи логи**:
   - `[callPeers]` или `[CallModal]`
   - `❌ getUserMedia FAILED` → нет прав или устройство занято
   - `ICE candidate` → если нет `typ srflx` или `typ relay`, STUN/TURN не работают

### Если не работает
1. **WARP включён** → отключи (трей → Cloudflare WARP → Disconnect)
2. **Права запрещены** → Settings → Privacy → Microphone/Camera → разреши
3. **STUN/TURN недоступны** → замени на Cloudflare Calls (см. `WEBRTC_DEBUG.md`)
4. **Ничего не помогло** → открой тикет с логами из консоли

## Файлы
- ✅ `Web/src/services/callDiagnostics.ts` — модуль диагностики
- ✅ `Web/src/pages/AdminToolsPage.tsx` — добавлена кнопка диагностики
- ✅ `Web/src/services/callPeers.ts` — добавлены логи
- ✅ `Web/src/components/CallModal.tsx` — добавлены логи
- ✅ `WEBRTC_DEBUG.md` — полная инструкция по отладке

## TypeScript
Без ошибок. Единственная предыдущая ошибка в `ModerationPanel.tsx:77` (не связана с этим PR).
