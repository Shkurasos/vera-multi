const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatBgPrefsStore.ts'), 'utf8');

// Базовые фоны тем грузим по-настоящему: каталог обоев строится из них, и
// тест должен видеть настоящий список, а не заглушку.
const baseWallpapers = vm.createContext({ console, exports: {}, module: { exports: {} } });
vm.runInContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'src/store/baseWallpapers.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
  ).outputText,
  baseWallpapers,
);

// Минимальная эмуляция zustand (как в chatSkinStore.test.cjs).
let store;
const setFn = (update) => {
  const next = typeof update === 'function' ? update(store) : update;
  Object.assign(store, next);
};
const getFn = () => store;

const context = vm.createContext({
  console,
  exports: {},
  module: { exports: {} },
  require: (name) => {
    // useAllStockWallpapers — хук на useMemo; в тесте он не вызывается.
    if (name === 'react') return { useMemo: (fn) => fn(), createElement: () => ({}) };
    if (name === 'zustand') return { create: () => (factory) => { store = factory(setFn, getFn); return store; } };
    if (name === 'zustand/middleware') return { persist: (factory) => factory };
    if (name === '../services/storeSyncSimple') return { enableStoreSync: () => {} };
    if (name === './baseWallpapers') return baseWallpapers.exports;
    // Стор фонов админа тут не нужен: тесты проверяют свои обои, а не общий каталог.
    if (name === './adminWallpapersStore') {
      return { useAdminWallpaperItems: () => [], useAdminWallpapers: () => [] };
    }
    throw new Error('unexpected require: ' + name);
  },
});
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);

const photo = (id, name) => ({ id, name, type: 'photo', value: `data:image/jpeg;base64,${id}`, createdAt: 1 });
const video = (id) => ({ id, name: `${id}.mp4`, type: 'live', value: `chat-1:${id}`, createdAt: 2 });

test('свои обои копятся списком по каждому чату', () => {
  store.addUserWallpaper('chat-1', photo('a', 'Закат'));
  store.addUserWallpaper('chat-1', photo('b', 'Море'));
  store.addUserWallpaper('chat-1', video('v1'));
  store.addUserWallpaper('chat-2', photo('c', 'Лес'));
  assert.equal(store.getUserWallpapers('chat-1').length, 3);
  assert.equal(store.getUserWallpapers('chat-2').length, 1);
  assert.equal(store.getUserWallpapers('chat-2')[0].name, 'Лес');
});

test('удаление убирает только выбранные обои', () => {
  store.addUserWallpaper('chat-3', photo('x', 'Поле'));
  store.addUserWallpaper('chat-3', photo('y', 'Горы'));
  store.removeUserWallpaper('chat-3', 'x');
  const left = store.getUserWallpapers('chat-3');
  assert.equal(left.length, 1);
  assert.equal(left[0].id, 'y');
});

test('несколько видео хранятся под разными ключами-скоупами', () => {
  store.addUserWallpaper('chat-4', video('v1'));
  store.addUserWallpaper('chat-4', video('v2'));
  const values = store.getUserWallpapers('chat-4').filter((i) => i.type === 'live').map((i) => i.value);
  assert.deepEqual([...values], ['chat-1:v1', 'chat-1:v2']);
  assert.equal(new Set(values).size, 2);
});

test('глобальное видео выбирается по своему ключу (несколько видео)', () => {
  store.globalStockWallpaper = 'custom-live';
  assert.equal(store.getChatWallpaper('unknown').value, 'global');
  store.setGlobalLiveWallpaper('global:v9');
  assert.equal(store.globalStockWallpaper, 'custom-live');
  assert.equal(store.getChatWallpaper('unknown').value, 'global:v9');
});

test('per-chat оверрайд важнее глобальных обоев', () => {
  store.setGlobalLiveWallpaper('global');
  store.setChatWallpaper('chat-5', { type: 'live', value: 'chat-5:v7' });
  assert.deepEqual(store.getChatWallpaper('chat-5'), { type: 'live', value: 'chat-5:v7' });
  store.clearChatWallpaper('chat-5');
  assert.equal(store.getChatWallpaper('chat-5').value, 'global');
});

// --- Миграция dataURL-фотов в IndexedDB (planPhotoWallpaperMigration) ---

const photoStorageSource = fs.readFileSync(path.join(__dirname, 'src/services/chatBgPhotoStorage.ts'), 'utf8');
const photoStorageContext = vm.createContext({ console, exports: {}, module: { exports: {} }, require: () => { throw new Error('unexpected require'); } });
vm.runInContext(
  ts.transpileModule(photoStorageSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText,
  photoStorageContext,
);
const { planPhotoWallpaperMigration, isPhotoBgKey } = photoStorageContext.exports;

const dataUrl = 'data:image/jpeg;base64,AAAA';

test('isPhotoBgKey различает ключ IDB и dataURL/URL', () => {
  assert.equal(isPhotoBgKey('global:a1'), true);
  assert.equal(isPhotoBgKey('chat-1:offer-photo'), true);
  assert.equal(isPhotoBgKey(dataUrl), false);
  assert.equal(isPhotoBgKey('https://example.com/a.jpg'), false);
  assert.equal(isPhotoBgKey('stock-forest'), false);
});

test('план миграции: dataURL в списке → ключи, дедупликация одинаковых фото', () => {
  const plan = planPhotoWallpaperMigration({
    userWallpapers: {
      global: [
        { id: 'a', name: 'Закат', type: 'photo', value: dataUrl, createdAt: 1 },
        { id: 'b', name: 'Закат копия', type: 'photo', value: dataUrl, createdAt: 2 },
        { id: 'c', name: 'Видео', type: 'live', value: 'global:v1', createdAt: 3 },
      ],
    },
    userPhotoWallpaper: dataUrl,
    userPhotoName: 'Закат',
    perChatOverrides: {},
  });
  assert.ok(plan);
  // Одинаковый dataURL (список + легаси) схлопывается в одну запись Blob.
  assert.equal(plan.saves.length, 1);
  assert.equal(plan.saves[0].key, 'global:a');
  const items = plan.next.userWallpapers.global;
  assert.equal(items[0].value, 'global:a');
  assert.equal(items[1].value, 'global:a');
  assert.equal(items[2].type, 'live');
  assert.equal(items[2].value, 'global:v1');
  assert.equal(plan.next.userPhotoWallpaper, 'global:a');
  // Все новые значения — ключи, dataURL больше нигде не остаётся.
  assert.ok(isPhotoBgKey(plan.next.userPhotoWallpaper));
});

test('план миграции: per-chat override получает свой ключ; null без dataURL', () => {
  const plan = planPhotoWallpaperMigration({
    userWallpapers: {},
    userPhotoWallpaper: null,
    userPhotoName: null,
    perChatOverrides: { 'chat-9': { type: 'photo', value: dataUrl } },
  });
  assert.ok(plan);
  assert.equal(plan.saves.length, 1);
  assert.equal(plan.saves[0].key, 'chat-9:photo-override');
  assert.equal(plan.next.perChatOverrides['chat-9'].value, 'chat-9:photo-override');
  // Ключи и stock-значения не трогаем.
  const noop = planPhotoWallpaperMigration({
    userWallpapers: { global: [{ id: 'a', name: 'Ф', type: 'photo', value: 'global:a', createdAt: 1 }] },
    userPhotoWallpaper: 'global:a',
    userPhotoName: 'Ф',
    perChatOverrides: { 'chat-9': { type: 'stock', value: 'none' } },
  });
  assert.equal(noop, null);
});
