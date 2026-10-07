const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// Настоящий zustand, но localStorage общий на все «запуски» — так проверяется
// именно цикл «изменил состояние → обновил страницу».
const mem = new Map();
const fakeStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.localStorage = fakeStorage;
globalThis.window = globalThis;

const realModules = {
  zustand: require('zustand'),
  'zustand/middleware': require('zustand/middleware'),
};

const track = (id, title) => ({ id, title, artist: 'A', fileUrl: `blob:${id}` });

/** Поднимает стор заново, как при перезагрузке страницы. */
function boot() {
  const ctx = vm.createContext({
    console, exports: {}, module: { exports: {} },
    localStorage: fakeStorage, setTimeout, clearTimeout,
    require: (n) => realModules[n] || ({
      '../services/api': { musicApi: { recordPlay: () => Promise.resolve() } },
      './../services/peer': { peer: {}, isPeerAvailable: () => false },
      '../services/storeSyncSimple': { registerAccountStore: () => {} },
    }[n] || {}),
  });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(read('src/store/musicStore.ts'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  return ctx.exports.useMusicStore;
}

const reload = () => boot();

// ── Убранный трек не должен возвращаться после обновления страницы ──────

test('убранный из очереди трек не возвращается в плеере после перезагрузки', () => {
  const store = boot();
  const a = track('a', 'Первый');
  const b = track('b', 'Второй');

  store.getState().play(b, [a, b]);
  assert.equal(store.getState().playbackTrackId, 'b', 'играет второй трек');

  // Убираем ТЕКУЩИЙ трек из очереди — плеер должен уйти.
  store.getState().removeFromQueue('b');
  const afterRemove = store.getState();
  assert.equal(afterRemove.currentTrack?.id ?? null, 'a', 'взял соседний трек');
  assert.equal(afterRemove.playbackTrackId, 'a', 'id тоже переключился, а не остался от удалённого');

  // Убираем оставшийся — очередь пуста, плееру нечего показывать.
  store.getState().removeFromQueue('a');
  assert.equal(store.getState().currentTrack, null, 'текущего трека нет');
  assert.equal(store.getState().playbackTrackId, null, 'id тоже очищен');

  // Ключевая проверка: после перезагрузки loadTracks() ищет трек по
  // playbackTrackId. Он null — значит плеер не появится.
  const saved = JSON.parse(mem.get('vera-music')).state;
  assert.equal(saved.playbackTrackId, null, 'в хранилище тоже пусто');
  assert.equal(reload().getState().playbackTrackId, null, 'после обновления пусто');
});

test('убранный из середины очереди трек не ломает восстановление', () => {
  const store = boot();
  const a = track('a', 'Первый');
  const b = track('b', 'Второй');
  const c = track('c', 'Третий');

  store.getState().play(c, [a, b, c]);
  // Убираем НЕ текущий: id текущего трогать нельзя.
  store.getState().removeFromQueue('b');
  assert.equal(store.getState().playbackTrackId, 'c', 'текущий трек не сбит');
  assert.equal(store.getState().currentTrack?.id, 'c', 'текущий трек на месте');

  const reloaded = reload();
  assert.equal(reloaded.getState().playbackTrackId, 'c', 'после обновления тот же трек');
});

test('удаление трека из медиатеки тоже очищает восстановление', () => {
  const store = boot();
  const a = track('a', 'Первый');
  store.getState().play(a, [a]);
  assert.equal(store.getState().playbackTrackId, 'a');

  // deleteTrack чистит id сам — регрессия, чтобы не отвалилось снова.
  assert.ok(
    read('src/store/musicStore.ts').includes('playbackTrackId: removedCurrent ? null : s.playbackTrackId'),
    'deleteTrack очищает playbackTrackId у удалённого текущего трека',
  );
});

test('свёрнутое состояние плеера переживает обновление страницы', () => {
  const store = boot();
  store.getState().setPlayerCollapsed(true);
  assert.equal(reload().getState().playerCollapsed, true, 'осталось свёрнутым');
});

// ── Сайдбар не пересоздаётся при смене стороны ───────────────────────────

test('попап реакции не уезжает в угол, когда панель действий размонтирована', () => {
  // Панель быстрого доступа условно монтируется, и при сбросе ховера кнопка
  // реакции исчезает из DOM. Если Popover держал бы живой элемент-якорь, MUI
  // измерил бы отсоединённый узел (нули) и открыл попап в левом верхнем углу.
  const src = read('src/components/MessageBubble.tsx');
  assert.ok(
    !/setReactionAnchor\(e\.currentTarget\)/.test(src),
    'якорем не может быть живой DOM-узел',
  );
  assert.ok(
    src.includes('anchorFromRect(e.currentTarget.getBoundingClientRect())'),
    'координаты кнопки снимаются в момент клика',
  );
  assert.ok(
    src.includes('type VirtualAnchor = {') && src.includes('getBoundingClientRect: () => DOMRect;'),
    'виртуальный якорь отдаёт прямоугольник MUI',
  );
  // Пока попап открыт, панель остаётся на месте — иначе якорь снова отсоединится.
  assert.ok(
    src.includes('const actionsVisible = actionsOpen || reactionAnchor !== null;'),
    'панель действий остаётся смонтированной, пока открыт выбор реакции',
  );
  assert.ok(src.includes('{actionsVisible && ('), 'панель монтируется по actionsVisible');
  assert.ok(
    src.includes('opacity: isHovered || reactionAnchor ? 1 : 0'),
    'панель видна вместе с попапом, даже если ховер сброшен',
  );
});

test('сайдбар не пересоздаётся при перестановке — редактор не выключается сам', () => {
  // Список детей переставляет сайдбар (слева/справа/сверху/снизу). Без key
  // React сопоставляет детей по индексу, и на смене стороны весь сайдбар
  // пересоздаётся: теряется его локальное состояние, и открытый редактор тем
  // (или визуальный конструктор макета) закрывается сам собой.
  const src = read('src/pages/MainLayout.tsx');
  const desktop = src.match(/const sidebar = <Sidebar[^>]*>/);
  assert.ok(desktop, 'сайдбар рендерится один раз как отдельный элемент');
  assert.ok(
    /key="vera-sidebar"/.test(desktop[0]),
    'у сайдбара есть постоянный key — экземпляр переносится, а не пересоздаётся',
  );
  assert.ok(
    src.includes('key="vera-sidebar-mobile"'),
    'и у мобильного сайдбара свой key',
  );
  // Перестановка обязана идти через тот же элемент, иначе key не поможет.
  for (const side of ['left', 'right', 'top', 'bottom']) {
    assert.ok(
      src.includes(`sidebarSide === '${side}' && (`),
      `ветка ${side} на месте`,
    );
  }
  assert.ok(
    !/<Sidebar open onToggle/.test(src),
    'нигде не остался сайдбар без key',
  );
});
