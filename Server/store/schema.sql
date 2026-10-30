-- Схема зашифрованного хранилища Vera (node:sqlite).
--
-- Сервер по-прежнему держит рабочую копию данных в памяти (объект db), а сюда
-- сохраняет только изменившиеся записи. Открыто лежат лишь технические ключи:
-- имя коллекции, id записи и порядок. Содержимое — AES-256-GCM конверт, AAD
-- которого привязан к (коллекция, id): строку нельзя незаметно переставить в
-- другую запись или подменить.

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Верхнеуровневые ключи db.*:
--   list  — массив объектов с уникальным id (users, chats, messages, ...)
--   map   — объект-словарь (userStores, moderationIps, builtinThemes, ...)
--   value — всё остальное (числа, массивы строк); значение лежит в data.
CREATE TABLE IF NOT EXISTS collections (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'map', 'value')),
  seq  INTEGER NOT NULL,
  data BLOB
);

-- Элементы list/map: одна строка на запись.
CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  data       BLOB NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS ix_records_order ON records(collection, seq);

-- ─── Явные таблицы с по-полевым шифрованием ─────────────────────────────
-- Пользователи (связаны с пользователем → пароль Argon2id, email шифруем AES-256-GCM)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email BLOB,                          -- AES-256-GCM конверт (pii ключ)
  password_hash TEXT NOT NULL,         -- Argon2id хеш (не обратим)
  password_hash_version INTEGER DEFAULT 2,
  avatar_url TEXT,
  display_name TEXT,
  is_bot INTEGER DEFAULT 0,
  token_version INTEGER DEFAULT 0,
  role TEXT DEFAULT 'user',
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Чаты (неличные сущности, но ownerId — связь с пользователем)
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct',
  name TEXT,
  is_public INTEGER DEFAULT 0,
  owner_id TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Участники чатов
CREATE TABLE IF NOT EXISTS chat_members (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

-- Сообщения (текст и вложения — личные данные пользователя → шифруем AES-256-GCM)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  text BLOB,                           -- AES-256-GCM конверт (pii ключ)
  attachments BLOB,                    -- AES-256-GCM конверт JSON (pii ключ)
  poll BLOB,                           -- AES-256-GCM конверт JSON (pii ключ)
  reply_to_id TEXT,
  forward_from_id TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  read_by TEXT                         -- JSON массив userId (открыт, для подсчёта прочтений)
);

-- Устройства пользователя
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL UNIQUE,
  name TEXT,
  token_version INTEGER DEFAULT 0,
  is_primary INTEGER DEFAULT 0,
  revoked INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

-- Боты (владелец — пользователь; токен только проверяем → SHA-256; вебхук шифруем)
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  name TEXT,
  token_hash TEXT NOT NULL,            -- SHA-256 hex (не обратим, только проверка)
  webhook_url BLOB,                    -- AES-256-GCM конверт (pii ключ)
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Refresh-токены (только проверка → SHA-256)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,            -- SHA-256 hex (не обратим, только проверка)
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Персональные хранилища пользователей (data шифруем AES-256-GCM)
CREATE TABLE IF NOT EXISTS user_stores (
  user_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  data BLOB,                           -- AES-256-GCM конверт JSON (pii ключ)
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, store_name)
);

-- IP-блокировки (не привязаны к профилю пользователя → SHA-256 на IP)
CREATE TABLE IF NOT EXISTS ip_bans (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,               -- SHA-256 hex IP-адреса
  reason TEXT,
  banned_at TEXT NOT NULL,
  expires_at TEXT
);

-- Бан аккаунта модерацией (связан с пользователем, причина открыта для админа)
CREATE TABLE IF NOT EXISTS moderation_bans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  reason TEXT,
  banned_by TEXT,
  banned_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS ix_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS ix_chat_members_chat ON chat_members(chat_id);
CREATE INDEX IF NOT EXISTS ix_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS ix_user_stores_user ON user_stores(user_id);
CREATE INDEX IF NOT EXISTS ix_ip_bans_ip ON ip_bans(ip_hash);
