const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const store = read('src/store/userSettingsStore.ts');
const panels = read('src/components/ThemeSettingsPanels.tsx');
const info = read('src/components/ChatInfoPanel.tsx');
const player = read('src/components/MusicPlayer.tsx');
const layout = read('src/pages/MainLayout.tsx');
const designer = read('src/components/LayoutDesignerDialog.tsx');

// Плеер: «Слева» и «Справа» — отдельная панель у края окна; «В инфопанели» —
// тот самый встроенный в инфопанель плеер, который раньше назывался «Справа».

test('тип PlayerPos знает значение info', () => {
  assert.match(store, /export type PlayerPos = VertPos \| 'left' \| 'right' \| 'info';/,
    'info — часть типа, а не костыль через as');
  assert.match(store, /bottom \| top \| left \| right \| info/, 'перечисление в комментарии актуально');
});

test('в настройках и конструкторе есть пункт «В инфопанели»', () => {
  const row = panels.slice(panels.indexOf('label="Плеер"'));
  assert.match(row, /\['bottom', 'Снизу'\][\s\S]*\['top', 'Сверху'\][\s\S]*\['left', 'Слева'\][\s\S]*\['right', 'Справа'\][\s\S]*\['info', 'В инфопанели'\]/);
  assert.match(designer, /<ToggleButton value="info">В инфопанели<\/ToggleButton>/, 'и в визуальном конструкторе');
});

test('встроенный режим — только info, «Справа» — отдельная панель как «Слева»', () => {
  assert.match(player, /const showSidePanel = \(isDesktop && \(playerPos === 'left' \|\| playerPos === 'right' \|\| playerPos === 'info'\)\) \|\| playerPos === 'info';/);
  assert.match(player, /const embedded = showSidePanel && playerPos === 'info';/, 'в инфопанель встраивается только info');
  assert.ok(!/playerPos === 'right'\s*;/.test(player.slice(player.indexOf('const embedded'), player.indexOf('const embedded') + 80)),
    '«Справа» больше не встраивается');
  // Ресайз за внутренний край — у обеих отдельных панелей.
  assert.match(player, /showSidePanel && !embedded && \(/, 'у отдельной панели есть ручка ширины');
  assert.match(player, /playerPos === 'left' \? e\.clientX : window\.innerWidth - e\.clientX/, 'ширина справа считается от правого края');
});

test('MainLayout отодвигает контент и для «Справа», а не только для «Слева»', () => {
  assert.match(layout, /const sidePlayer = !isMobile && \(playerPos === 'left' \|\| playerPos === 'right'\);/);
  assert.match(layout, /\? \{ pl: sidePlayerPad \}\s*: \{ pr: sidePlayerPad \}/, 'справа — padding-right');
  // На телефоне боковых панелей нет — «Слева»/«Справа» падают вниз,
  // а «В инфопанели» остаётся в инфопанели (без нижней ленты и отступа).
  assert.match(layout, /isMobile && \(playerPos === 'left' \|\| playerPos === 'right'\)\r?\n\s*\? 'bottom'/);
  assert.ok(!/isMobile && \(playerPos === 'left' \|\| playerPos === 'right' \|\| playerPos === 'info'\)/.test(layout),
    'info на телефоне не превращается в нижний плеер');
});

test('на телефоне «В инфопанели» тоже встраивается в инфопанель', () => {
  assert.match(player, /\|\| playerPos === 'info';/, 'info включает встроенный режим и без isDesktop');
});

test('инфопанель держит один хост плеера внизу, как раньше', () => {
  const hosts = info.match(/<div ref=\{onPlayerHost\} \/>/g) || [];
  assert.equal(hosts.length, 1, 'один хост');
  assert.ok(!info.includes("playerPos === 'info'"), 'инфопанель не знает про режимы плеера');
  assert.ok(info.lastIndexOf('<div ref={onPlayerHost} />') > info.indexOf('Avatar + name section'), 'хост — после содержимого панели');
});

test('самодельного info-блока с библиотекой больше нет', () => {
  for (const marker of ['inInfoPanel', 'data-info-library', 'libQuery', 'librarySource']) {
    assert.ok(!player.includes(marker), `${marker} убран`);
  }
});

test('хуки плеера не стоят после раннего return', () => {
  const early = player.indexOf('if (!currentTrack) return null;');
  assert.ok(early > 0);
  const tail = player.slice(early);
  assert.ok(!/\buse(State|Effect|Memo|Ref|Callback|SyncExternalStore)\(/.test(tail),
    'после return null хуков нет — иначе «Rendered more hooks than during the previous render»');
});
