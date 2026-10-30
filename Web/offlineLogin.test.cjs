const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

/** offlineAuth в vm: настоящий WebCrypto Node, localStorage в памяти. */
function loadOfflineAuth() {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const mod = { exports: {} };
  const js = ts.transpileModule(read('src/services/offlineAuth.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(js, vm.createContext({
    exports: mod.exports, module: mod, require: () => ({}),
    localStorage, crypto: globalThis.crypto, TextEncoder, btoa, atob, Uint8Array, String, JSON,
  }));
  return { auth: mod.exports, mem };
}

const alice = { id: 'u-alice', username: 'alice', firstName: 'Алиса', lastName: '' };
const bob = { id: 'u-bob', username: 'bob', firstName: 'Боб' };

test('без сети вход открывается только паролем последнего пользователя', async () => {
  const { auth, mem } = loadOfflineAuth();
  assert.equal(auth.offlineLockInfo(), null, 'на чистом устройстве входить некому');

  await auth.saveOfflineCredential(alice, 'correct horse battery');
  mem.set('vera_user', JSON.stringify(alice));
  const info = auth.offlineLockInfo();
  assert.equal(info.username, 'alice');
  assert.equal(info.displayName, 'Алиса');
  assert.equal(info.hasCredential, true);

  assert.equal(await auth.verifyOfflinePassword('wrong password!!'), null, 'чужой пароль не подходит');
  assert.equal(await auth.verifyOfflinePassword(''), null);
  assert.equal((await auth.verifyOfflinePassword('correct horse battery'))?.id, 'u-alice');
});

test('пароль хранится только как PBKDF2-хэш с солью', async () => {
  const { auth, mem } = loadOfflineAuth();
  await auth.saveOfflineCredential(alice, 'correct horse battery');
  const raw = mem.get('vera_offline_auth');
  assert.ok(!raw.includes('correct horse'), 'открытого пароля в хранилище нет');
  const stored = JSON.parse(raw);
  assert.ok(stored.iterations >= 100000);
  await auth.saveOfflineCredential(alice, 'correct horse battery');
  assert.notEqual(JSON.parse(mem.get('vera_offline_auth')).salt, stored.salt, 'соль каждый раз новая');
});

test('вход другого аккаунта и выход стирают офлайн-пароль', async () => {
  const { auth } = loadOfflineAuth();
  await auth.saveOfflineCredential(alice, 'correct horse battery');
  auth.syncOfflineCredentialUser({ ...alice, firstName: 'Алиса Н.' });
  assert.equal(auth.offlineLockInfo().displayName, 'Алиса Н.', 'тот же аккаунт — профиль обновился');
  auth.syncOfflineCredentialUser(bob);
  assert.equal(await auth.verifyOfflinePassword('correct horse battery'), null, 'пароль Алисы больше не открывает');

  await auth.saveOfflineCredential(alice, 'correct horse battery');
  auth.clearOfflineCredential();
  assert.equal(await auth.verifyOfflinePassword('correct horse battery'), null);
});

test('без сохранённого пароля экран входа сообщает, что офлайн-вход недоступен', () => {
  const { auth, mem } = loadOfflineAuth();
  mem.set('vera_user', JSON.stringify(alice));
  assert.equal(auth.offlineLockInfo().hasCredential, false);
});

test('authStore: сервер недоступен — экран пароля, токен не стирается', () => {
  const src = read('src/store/authStore.ts');
  const check = src.slice(src.indexOf('checkAuth: async'));
  assert.ok(check.includes('if (isAppOffline()) {'), 'без сети сразу экран пароля');
  const unreachable = check.indexOf('if (isUnreachable(e)) {');
  assert.ok(unreachable > 0);
  const removal = check.indexOf("localStorage.removeItem('vera_token')", unreachable);
  assert.ok(removal === -1 || unreachable < removal, 'недоступный сервер не считается протухшим токеном');
  assert.ok(src.includes('clearOfflineCredential();'), 'выход стирает офлайн-пароль');
  assert.ok(src.includes('syncOfflineCredentialUser(user);'));
  assert.ok(src.includes('vera-probe='), 'проверка связи идёт мимо кэша SW');
  const page = read('src/pages/DeviceEntryPage.tsx');
  assert.ok(page.includes('if (offlineLock) return <OfflineUnlock info={offlineLock} />;'));
  assert.ok(page.includes('saveOfflineCredential(data.user, password)'), 'пароль запоминается при входе');
  assert.ok(read('src/pages/DevicesPage.tsx').includes('saveOfflineCredential('), 'и при смене пароля');
});

test('офлайн в чате — последние 10 сообщений, без запросов к серверу', () => {
  const chat = read('src/store/chatStore.ts');
  assert.ok(chat.includes('export const OFFLINE_MESSAGE_LIMIT = 10;'));
  assert.ok(chat.includes('archived.slice(-OFFLINE_MESSAGE_LIMIT)'));
  const guard = chat.indexOf('if (offline && !isPeerAvailable())');
  assert.ok(guard > 0 && guard < chat.indexOf('messagesApi.getMessages', guard), 'офлайн loadMessages не идёт в API');
});

test('музыка: медиатека и плейлисты качаются в отдельный стор без лимита', () => {
  const db = read('src/services/offlineDb.ts');
  assert.ok(db.includes('const DB_VERSION = 2;'));
  assert.ok(db.includes("'music_files'") && db.includes("'playlists'"));
  const cache = read('src/services/musicOfflineCache.ts');
  assert.ok(cache.includes("const STORE = 'music_files';"));
  assert.ok(cache.includes("sources.has('library') && sources.has('playlists')"),
    'лишние файлы удаляются только когда известны оба списка');
  const music = read('src/store/musicStore.ts');
  assert.ok(music.includes("syncMusicFiles('library', tracks);"));
  assert.ok(music.includes('getMusicFileUrl(t.id)'), 'офлайн плеер играет blob: из IndexedDB');
  const playlists = read('src/store/playlistStore.ts');
  assert.ok(playlists.includes("syncMusicFiles('playlists', playlistTracks(list));"));
  assert.ok(playlists.includes('getCachedPlaylists()'));
  assert.ok(read('public/sw.js').includes("req.headers.has('x-vera-offline')"));
});
