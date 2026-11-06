# 🔍 Отчет аудита безопасности: IDOR и ошибки в коде

## 📊 Сводка

| Категория | Найдено | Исправлено | Критичность |
|-----------|---------|------------|-------------|
| IDOR-уязвимости | 4 | 1 | 1 HIGH, 2 MEDIUM, 1 LOW |
| Ошибки TypeScript | 1 | 0 | Предыдущая (не связана) |
| Проверено эндпоинтов | 60+ | - | - |

## 🚨 Исправленные уязвимости

### 1. ✅ HIGH — POST /api/messages/:id/read (строка 4899)

**Проблема:** Эндпоинт отмечал сообщения как прочитанные в любом чате без проверки членства пользователя. Злоумышленник, знающий ID любого сообщения из чужого чата, мог помечать сообщения как прочитанные в этом чате.

**Исправлено:** Добавлена проверка `isMember` + `isAdmin` перед отметкой сообщений как прочитанных.


## ⚠️ Оставшиеся проблемы

### 2. MEDIUM — GET /api/music/:id (строка 5025-5030)

**Проблема:** Возвращает данные любого трека без проверки владения.
```js
const track = db.tracks.find(t => t.id === req.params.id);
res.json({ ...track, uploadedBy });  // ❌ Нет проверки доступа
```

**Рекомендация:** Добавить проверку `track.uploadedById === req.userId` или сделать треки публичными по дизайну.


## ✅ Уже защищенные эндпоинты (проверено)

| Эндпоинт | Защита |
|----------|--------|
| `GET /api/chats/:id` | `isMember` + `isAdmin` ✅ |
| `GET /api/messages/:chatId` | `isMember` + `isAdmin` ✅ |
| `GET /api/messages/:chatId/comments/:postId` | `isMember` + `isAdmin` ✅ |
| `POST /api/messages/:id/read` | `isMember` + `isAdmin` ✅ (исправлено) |
| `PUT /api/messages/:id` | `msg.senderId === req.userId` или модератор ✅ |
| `DELETE /api/messages/:id` | `msg.senderId === req.userId` или модератор ✅ |
| `POST /api/messages/:id/poll-vote` | Членство в чате ✅ |
| `POST /api/messages/:id/pin` | Членство в чате ✅ |
| `POST /api/messages/:id/unpin` | Членство в чате ✅ |
| `DELETE /api/chats/:id` | Членство + роль owner ✅ |
| `DELETE /api/chats/:id/leave` | Членство в чате ✅ |
| `PATCH /api/chats/:id/archive, pin, mute` | Членство в чате ✅ |
| `PATCH /api/chats/:id/members/:userId/admin` | `hasGroupRight('manageAdmins')` ✅ |
| `PUT /api/messages/:chatId` (send) | `handleSendMessage` проверяет `isMember` ✅ |
| `GET /api/users/:id` | Публичные поля + приватные только для себя ✅ |
| `GET /api/users/:id/customization` | Только визуальные поля ✅ |
| `DELETE /api/devices/:id` | Фильтр по `userId === req.userId` ✅ |
| `GET /api/wallet/orders/:orderId` | `o.userId === req.userId` ✅ |
| `PATCH /api/creator/items/:id` | `item.authorId === req.userId` ✅ |
| `DELETE /api/creator/items/:id` | `item.authorId === req.userId` ✅ |
| `PATCH /api/music/:id` | `track.uploadedById === req.userId` ✅ |
| `DELETE /api/music/:id` | `track.uploadedById === req.userId` ✅ |
| `GET /api/music/playlists/:id/zip` | `p.userId === req.userId || p.isPublic` ✅ |
| `PATCH /api/music/playlists/:id` | `p.userId === req.userId` ✅ |
| `DELETE /api/music/playlists/:id` | `p.userId === req.userId` ✅ |
| `DELETE /api/favorites/:chatId` | `f.userId === req.userId` ✅ |
| `DELETE /api/admin/ip-bans/:ip` | `adminRequest(req)` ✅ |
| `DELETE /api/users/:id/comments/:commentId` | Автор или владелец стены ✅ |

### 3. LOW — POST /api/music/:id/play (строка 5058-5064)

**Проблема:** Увеличивает счетчик проигрышей любого трека без проверки владения.
```js

## 🛡️ Защита от IDOR через Burp Suite / Repeater

### Как работает защита:

1. **`req.userId` берется ТОЛЬКО из JWT токена**, а не из `req.body`, `req.query` или `req.params`:
   ```js
   const { userId, deviceId } = verifyAccessToken(auth.slice(7));
   req.userId = userId; // ВЗЯТО ИЗ JWT, НЕ ИЗ ПАРАМЕТРОВ ЗАПРОСА
   ```

2. **JWT подписан секретным ключом** (`JWT_SECRET`):
   ```js
   const payload = jwt.verify(token, JWT_SECRET);
   ```
   Злоумышленник **не может** подделать токен без секретного ключа.

3. **`tokenVersion` защищает от украденных токенов:**
   ```js
   if (Number(payload.tv || 0) !== tv) throw new Error('token_revoked');
   ```
   После logout токены становятся недействительными.

4. **Проверка членства в чате блокирует доступ к чужим данным:**
   ```js
   const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === req.userId);
   if (!isMember && !isAdmin) return res.status(403).json({ message: 'Нет доступа' });
   ```

### Что НЕ может сделать злоумышленник через Burp Suite:

## 🧪 Тесты

### Запуск тестов:

```bash
# Базовые тесты доступа к чатам
node Server/test-chat-access.js

# IDOR-тесты (Burp Suite / Repeater сценарии)
node Server/test-idor-chat-access.js
```

### Результаты:

```
✅ Alice видит chat-1
✅ Eve НЕ может видеть chat-1 (IDOR-атака заблокирована)
✅ Поддельный JWT токен отклонён
✅ Украденный токен недействителен после logout
✅ Админ видит chat-2 (модерация)
✅ Все IDOR-тесты пройдены!
```

## 📁 Файлы

- ✅ `Server/server.js` — исправлена уязвимость в `POST /api/messages/:id/read`
- ✅ `Server/test-chat-access.js` — базовые тесты безопасности
- ✅ `Server/test-idor-chat-access.js` — IDOR-тесты
- ✅ `SECURITY_AUDIT_REPORT.md` — этот отчет

## 🎯 Рекомендации по безопасности

1. **Всегда проверяйте `req.userId` из JWT**, никогда не доверяйте `req.body.userId`, `req.query.userId` или `req.params.userId` для идентификации текущего пользователя.

2. **Проверяйте членство в чате** перед предоставлением доступа к данным чата (сообщениям, метаданным, отметкам о прочтении).

3. **JWT_SECRET должен храниться в переменных окружения**, а не в коде.

4. **`tokenVersion` обязательна** для защиты от использования украденных токенов после logout.

5. **Админы имеют доступ к любым чатам** только для чтения (модерация). Они НЕ могут писать сообщения в чужие чаты без членства.

6. **Рассмотрите добавление проверки владения** для `GET /api/music/:id` и `POST /api/music/:id/play`.


| Атака | Результат |
|-------|-----------|
| Подменить `chatId` в URL | ❌ 403 Нет доступа |
| Подменить `userId` в `req.body` | ❌ Игнорируется (используется JWT) |
| Подделать JWT токен с чужим `userId` | ❌ 401 Invalid token |
| Украсть токен и использовать после logout | ❌ 401 Token revoked |
| Подменить `messageId` для чтения в чужом чате | ❌ 403 Нет доступа (исправлено) |

track.playsCount = (track.playsCount || 0) + 1;  // ❌ Нет проверки доступа
```

**Рекомендация:** Добавить проверку владения (минимальный риск).
