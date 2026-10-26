/**
 * Фото-обои едут вместе с аккаунтом и узкое окно = телефонная раскладка.
 *
 * Раньше в синхронизируемом сторе был только ключ IndexedDB, а сам файл
 * оставался на одном устройстве: в другом приложении галерея показывала
 * серый квадрат. Теперь у ключа есть серверная копия (/uploads/...).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

function loadStorage(extra = {}) {
  const ctx = vm.createContext({
    console, exports: {}, module: { exports: {} },
    require: () => { throw new Error('unexpected require'); },
    setTimeout,
    ...extra,
  });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(read('src/services/chatBgPhotoStorage.ts'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  return ctx.module.exports;
}

test('серверный адрес принимается только свой и без обхода пути', () => {
  const { isRemotePhotoUrl } = loadStorage();
  assert.equal(isRemotePhotoUrl('/uploads/files/abc-1.jpg'), true);
  assert.equal(isRemotePhotoUrl('https://evil.example/a.jpg'), false);
  assert.equal(isRemotePhotoUrl('/uploads/../data/db.json'), false);
  assert.equal(isRemotePhotoUrl('/api/files/x'), false);
  assert.equal(isRemotePhotoUrl(undefined), false);
});

test('ключи фото собираются из всех мест стора без дублей', () => {
  const { referencedPhotoKeys } = loadStorage();
  const keys = referencedPhotoKeys({
    userWallpapers: {
      global: [
        { id: 'a', name: '', type: 'photo', value: 'global:a', createdAt: 1 },
        { id: 'v', name: '', type: 'live', value: 'global', createdAt: 1 },
      ],
      chatlist: [{ id: 'b', name: '', type: 'photo', value: 'chatlist:b', createdAt: 1 }],
    },
    userPhotoWallpaper: 'global:a',
    perChatOverrides: { c1: { type: 'photo', value: 'c1:x' }, c2: { type: 'stock', value: 'forest' } },
    chatListBg: { type: 'photo', value: 'chatlist:b' },
  });
  assert.deepEqual([...keys].sort(), ['c1:x', 'chatlist:b', 'global:a']);
});

test('нет файла в IndexedDB — фото докачивается с сервера по ключу', async () => {
  const fetched = [];
  class FakeBlob { constructor(parts, opts) { this.size = 3; this.type = opts?.type || ''; } }
  const storage = loadStorage({
    // IndexedDB нет (как в новом приложении до первой записи) — openDb падает.
    Blob: FakeBlob,
    fetch: async (url) => { fetched.push(url); return { ok: true, blob: async () => new FakeBlob([], { type: '' }) }; },
    URL: { createObjectURL: (b) => `blob:${b.type}` },
    Image: undefined,
  });
  storage.setPhotoBgRemote({ urlFor: (k) => (k === 'global:a' ? '/uploads/files/a.jpg' : undefined), upload: async () => {} });
  assert.equal(await storage.loadPhotoBgUrl('global:a'), 'blob:image/jpeg', 'пустой тип attachment-ответа → image/jpeg');
  assert.deepEqual(fetched, ['/uploads/files/a.jpg']);
  assert.equal(await storage.loadPhotoBgUrl('global:none'), null, 'без серверной копии — по-прежнему null');
});

test('чужой адрес из стора не скачивается', async () => {
  let called = false;
  const storage = loadStorage({ fetch: async () => { called = true; return { ok: false }; }, Image: undefined });
  storage.setPhotoBgRemote({ urlFor: () => 'https://evil.example/x.jpg', upload: async () => {} });
  assert.equal(await storage.loadPhotoBgUrl('global:a'), null);
  assert.equal(called, false);
});

test('проводка: стор хранит адреса, синк их не теряет, App подключает загрузку', () => {
  const store = read('src/store/chatBgPrefsStore.ts');
  assert.ok(store.includes('remotePhotos: Record<string, string>;'));
  assert.ok(store.includes('setRemotePhoto: (key, url) =>'));
  const sync = read('src/services/storeSyncSimple.ts');
  assert.ok(sync.includes('merged.remotePhotos = { ...(current.remotePhotos || {}), ...(incoming.remotePhotos || {}) }'));
  const app = read('src/App.tsx');
  assert.ok(app.includes('setPhotoBgRemote({'));
  assert.ok(app.includes('filesApi.upload(file)'));
  assert.ok(app.includes('backfillRemotePhotos('));
  // Галерея и фон чата перезапрашивают фото, когда приезжает серверный адрес.
  assert.ok(read('src/hooks/usePhotoBgUrl.ts').includes('[key, remoteUrl]'));
  assert.ok(read('src/components/WallpaperSettingsDialog.tsx').includes('[photoKeys, photoRemoteSig]'));
  assert.ok(read('src/components/ChatWindow.tsx').includes('[photoWallpaperValue, photoRemoteUrl]'));
});

test('узкое окно приложения переходит в телефонную раскладку', () => {
  const main = read('../App/electron/main.js');
  const min = Number(main.match(/minWidth:\s*(\d+)/)[1]);
  assert.ok(min <= 700, `minWidth ${min} должен пускать окно ниже порога 700px`);
  const layout = read('src/pages/MainLayout.tsx');
  assert.ok(layout.includes("useMediaQuery('(max-width: 700px)')"));
  // Под своей верхней панелью окна: не 100dvh и не fixed от top: 0.
  assert.ok(!layout.includes("height: '100dvh'"));
  assert.ok(layout.includes('|| desktopApp)'));
});
