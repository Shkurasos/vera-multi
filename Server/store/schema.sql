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
