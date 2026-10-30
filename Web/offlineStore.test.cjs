const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('offlineStore module exports expected functions', () => {
  // Проверяем, что исходный файл содержит все ожидаемые методы стора.
  const src = fs.readFileSync(path.join(__dirname, 'src/store/offlineStore.ts'), 'utf8');
  const expected = [
    'cacheMusicLibrary', 'getCachedMusicLibrary',
    'cacheAvatar', 'getCachedAvatar', 'getCachedAvatars',
    'cacheMessages', 'getCachedMessages',
    'cacheSkins', 'getCachedSkins',
    'cacheThemes', 'getCachedThemes',
    'cacheIcons', 'getCachedIcons',
    'cacheUserProfile', 'getCachedUserProfile',
    // Файловый кэш (новое)
    'cacheFileBlob', 'getCachedFileBlob', 'getCachedFileUrl',
    'hasCachedFile', 'fetchAndCacheFile', 'removeCachedFile', 'clearFileCache',
    'clearAll', 'init',
  ];
  for (const name of expected) {
    assert.ok(src.includes(name), `offlineStore: метод ${name} присутствует`);
  }
});

test('offlineStore CachedTrack interface has required fields', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/store/offlineStore.ts'), 'utf8');
  assert.ok(src.includes('interface CachedTrack'), 'интерфейс CachedTrack существует');
  assert.ok(src.includes('fileUrl: string'), 'CachedTrack имеет fileUrl');
  assert.ok(src.includes('coverUrl?: string'), 'CachedTrack имеет опциональный coverUrl');
});

test('offlineStore CachedMessage interface has fromArchive-compatible fields', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/store/offlineStore.ts'), 'utf8');
  assert.ok(src.includes('interface CachedMessage'), 'интерфейс CachedMessage существует');
  assert.ok(src.includes('chatId: string'), 'CachedMessage имеет chatId');
  assert.ok(src.includes('senderId: string'), 'CachedMessage имеет senderId');
});

test('types Message has fromArchive field', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/types/index.ts'), 'utf8');
  assert.ok(src.includes('fromArchive?: boolean'), 'Message имеет поле fromArchive');
});

test('types Track has fileUrl and coverUrl', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/types/index.ts'), 'utf8');
  assert.ok(src.includes('fileUrl: string'), 'Track имеет fileUrl');
  assert.ok(src.includes('coverUrl?: string'), 'Track имеет coverUrl');
});

test('fileCache service exists with core functions', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/services/fileCache.ts'), 'utf8');
  const expected = [
    'cacheFile', 'getCachedFile', 'getCachedFileUrl', 'hasCachedFile',
    'removeCachedFile', 'clearFileCache', 'fetchAndCache', 'listCachedFiles',
  ];
  for (const name of expected) {
    assert.ok(src.includes(`export async function ${name}`) || src.includes(`export function ${name}`), `fileCache: функция ${name} экспортируется`);
  }
});

test('offlineDb includes file_cache store', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/services/offlineDb.ts'), 'utf8');
  assert.ok(src.includes("'file_cache'"), 'offlineDb имеет стор file_cache');
});

test('api.ts caches messages, profile and avatars', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/services/api.ts'), 'utf8');
  assert.ok(src.includes("'/messages/': 'messages'"), 'API кэширует /messages/');
  assert.ok(src.includes("'/auth/me': 'user_profile'"), 'API кэширует /auth/me');
  assert.ok(src.includes("'/users/': 'avatars'"), 'API кэширует /users/');
  assert.ok(src.includes('cacheMessages'), 'cacheResponse вызывает cacheMessages');
  assert.ok(src.includes('cacheUserProfile'), 'cacheResponse вызывает cacheUserProfile');
  assert.ok(src.includes('cacheAvatar'), 'cacheResponse вызывает cacheAvatar');
});

test('App.tsx caches incoming socket messages', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/App.tsx'), 'utf8');
  assert.ok(src.includes('useOfflineStore'), 'App.tsx импортирует useOfflineStore');
  assert.ok(src.includes('cacheMessages'), 'App.tsx кэширует входящие сообщения');
  assert.ok(src.includes('saveArchivedMessages'), 'App.tsx пишет в локальный архив');
});

test('chatStore limits offline messages to OFFLINE_MESSAGE_LIMIT', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/store/chatStore.ts'), 'utf8');
  assert.ok(src.includes('OFFLINE_MESSAGE_LIMIT'), 'chatStore имеет константу OFFLINE_MESSAGE_LIMIT');
  assert.ok(src.includes('offlineChats'), 'chatStore отслеживает офлайн-чаты');
});

test('musicStore loads from cache when offline', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/store/musicStore.ts'), 'utf8');
  assert.ok(src.includes('useOfflineStore'), 'musicStore импортирует useOfflineStore');
  assert.ok(src.includes('getCachedMusicLibrary'), 'musicStore читает кэш музыки офлайн');
  // Аудио — в отдельном сторе music_files (без лимита file_cache на 200 записей).
  assert.ok(src.includes('cacheMusicTrack') && src.includes('syncMusicFiles'), 'musicStore кэширует файлы треков');
});

test('sw.js runtime-caches API and media', () => {
  const src = fs.readFileSync(path.join(__dirname, 'public/sw.js'), 'utf8');
  assert.ok(src.includes('/api/chats'), 'SW кэширует /api/chats');
  assert.ok(src.includes('/api/messages/'), 'SW кэширует /api/messages/');
  assert.ok(src.includes('/api/music/'), 'SW кэширует /api/music/');
  assert.ok(src.includes('/api/users/'), 'SW кэширует /api/users/');
  assert.ok(src.includes('/uploads/'), 'SW кэширует /uploads/');
  assert.ok(src.includes('RUNTIME_CACHE'), 'SW имеет отдельный runtime-кэш');
  assert.ok(src.includes('Stale-While-Revalidate'), 'SW использует SWR стратегию');
  // API — NetworkFirst: устаревший /api/auth/me из кэша подменял текущего
  // пользователя, и свои сообщения рисовались как чужие.
  assert.ok(src.includes('NetworkFirst'), 'API идут сначала в сеть');
  assert.ok(/fetch\(req\)\.then[\s\S]{0,200}\.catch\(\(\) => cache\.match\(req\)/.test(src), 'кэш API — только при сбое сети');
});

test('authApi.me идёт мимо кэша сервис-воркера', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/services/api.ts'), 'utf8');
  assert.match(src, /me: \(\) => api\.get\('\/auth\/me', \{[^}]*'vera-probe'/);
});