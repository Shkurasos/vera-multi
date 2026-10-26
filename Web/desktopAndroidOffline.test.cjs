const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('desktop: no native menu, splash + offline fallback, icon and desktop shortcut', () => {
  const main = read('../App/electron/main.js');
  assert.ok(main.includes('Menu.setApplicationMenu(null)'), 'системное меню убрано');
  assert.ok(main.includes("'splash.html'") && main.includes("'offline.html'"), 'есть заставка и страница «нет сети»');
  assert.ok(main.includes("'did-fail-load'"), 'ошибка загрузки не оставляет чёрный экран');
  assert.ok(!main.includes("backgroundColor: '#000000'"));
  for (const f of ['electron/pages/splash.html', 'electron/pages/offline.html', 'electron/pages/offline.js', 'resources/icon.png', 'resources/icon.ico']) {
    assert.ok(fs.existsSync(path.join(__dirname, '../App', f)), `App/${f} существует`);
  }
  const pkg = JSON.parse(read('../App/package.json'));
  assert.equal(pkg.build.nsis.createDesktopShortcut, 'always');
  assert.equal(pkg.build.win.icon, 'resources/icon.ico');
  assert.ok(pkg.build.files.includes('resources/icon.png'), 'иконка окна попадает в asar');
  assert.match(pkg.devDependencies.electron, /^\d+\.\d+\.\d+$/, 'версия electron закреплена');
});

test('offline: sw precaches build assets, message cache keeps last 10, played tracks are cached', () => {
  const sw = read('public/sw.js');
  assert.ok(sw.includes('precacheShell') && sw.includes('shellAssets'), 'SW кэширует ассеты сборки при установке');
  assert.ok(!/[\u0000\uFFFD]/.test(sw), 'в sw.js нет битых байтов');
  const offline = read('src/store/offlineStore.ts');
  assert.ok(offline.includes('OFFLINE_CACHE_MESSAGES = 10'));
  assert.ok(offline.includes('messages.slice(-OFFLINE_CACHE_MESSAGES)'));
  assert.ok(read('src/store/musicStore.ts').includes('cachePlayedTrack(track.id, track.fileUrl)'));
});

test('android: webview wrapper keeps storage and falls back to offline page', () => {
  const act = read('../Android/app/src/main/java/app/vera/multi/MainActivity.java');
  assert.ok(act.includes('setDomStorageEnabled(true)'), 'localStorage для темы и настроек');
  assert.ok(act.includes('offline.html'), 'страница «нет сети»');
  assert.ok(act.includes('isServerUrl(request.getOrigin())'), 'камера/микрофон только для своего сервера');
  const manifest = read('../Android/app/src/main/AndroidManifest.xml');
  assert.ok(manifest.includes('android.permission.INTERNET'));
  assert.ok(manifest.includes('android:networkSecurityConfig="@xml/network_security_config"'));
  const nsc = read('../Android/app/src/main/res/xml/network_security_config.xml');
  assert.ok(nsc.includes('<base-config cleartextTrafficPermitted="false"'), 'http запрещён везде, кроме локального сервера');
  assert.ok(nsc.includes('>localhost</domain>'));
});

test('local server mode: desktop and android default to http://localhost:3000', () => {
  assert.ok(read('../App/electron/main.js').includes("const DEFAULT_SERVER_URL = 'http://localhost:3000'"));
  assert.ok(read('../Android/app/build.gradle.kts').includes('?: "http://localhost:3000"'));
});
