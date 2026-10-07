const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const peers = read('src/services/callPeers.ts');
const store = read('src/store/callStore.ts');
const tile = read('src/components/CallTile.tsx');
const sink = read('src/components/CallAudioSink.tsx');

const ontrack = peers.slice(peers.indexOf('pc.ontrack ='), peers.indexOf('pc.onconnectionstatechange'));
const joinCall = store.slice(store.indexOf('async joinCall('), store.indexOf('leaveCall()'));

// ─── Видео ───────────────────────────────────────────────────────────────────

test('стор обновляется на ЛЮБОМ треке, а не только на аудио', () => {
  // Регресс: обновление стора было обёрнуто в if (track.kind === 'audio'),
  // из-за чего видеотрек доходил до conn.remoteStream, но не до стора — тайл
  // рендерил поток без видео, и видеозвонок выглядел как «картинки нет».
  //
  // Проверяем НЕ позицию строки, а структуру: строка с _setPeer не должна
  // начинаться с audio-условия. Сравнение позиций тут обманчиво — при
  // `if (...) useCallStore...` обе строки оказываются рядом и проверка
  // «setPeer после audioGuard» проходит, хотя баг вернулся.
  const setPeerLine = ontrack.split(/\r?\n/)
    .find(l => l.includes('getState()._setPeer'));
  assert.ok(setPeerLine, 'стор обновляется в ontrack');
  assert.ok(
    !/^\s*if\s*\(\s*e\.track\.kind\s*===\s*['"]audio['"]/.test(setPeerLine),
    'обновление стора не должно быть обёрнуто в условие «только аудио»',
  );
  assert.ok(
    !/\bif\s*\([^)]*kind\s*===\s*['"]audio['"][^)]*\)\s*\{[^}]*_setPeer/s.test(ontrack),
    'внутри audio-условия нет обновления стора',
  );
  // Условие осталось ровно для индикатора речи.
  assert.ok(
    /if \(e\.track\.kind === ['"]audio['"] && !conn\.vaCleanup\)/.test(ontrack),
    'аудио-условие осталось только для индикатора речи',
  );
});

test('screenStream попадает в стор вместе с обычным потоком', () => {
  assert.ok(/screenStream: conn\.screenStream\.getTracks\(\)\.length/.test(ontrack), 'экран отдаётся');
});

// ─── Камера в видеозвонке ───────────────────────────────────────────────────

test('видеозвонок стартует с включённой камерой', () => {
  // При video камера уже захвачена в getUserMedia, но флаг cam оставался
  // false — тайл показывал аватар, и собеседник видел «камера выключена».
  assert.ok(/const cam = kind === 'video'/.test(joinCall), 'cam выводится из вида звонка');
  assert.ok(/local: \{ \.\.\.get\(\)\.local, cam \}/.test(joinCall), 'локальное состояние обновляется');
  // И собеседнику нужно сообщить, иначе у него горит «выключена».
  assert.ok(/callroom:state[\s\S]{0,80}patch: \{ cam \}/.test(joinCall), 'состояние уходит на сервер');
});

test('аудиозвонок камеру не включает', () => {
  assert.ok(
    /const cam = kind === 'video'/.test(joinCall) && !/cam: true/.test(joinCall),
    'cam не зашит в true намертво',
  );
});

// ─── Картинка в тайле ───────────────────────────────────────────────────────

test('поток не теряется, если он пришёл раньше элемента video', () => {
  // Регресс: <video> рендерился только при camOn && stream, а эффект зависел
  // лишь от [stream]. В момент прихода потока ref.current === null (элемента
  // ещё нет) и эффект больше не перезапускался — картинка оставалась пустой.
  assert.ok(/ref=\{\(el\) =>/.test(tile), 'используется колбэк-реф');
  assert.ok(/if \(el && stream\) el\.srcObject = stream/.test(tile), 'колбэк проставляет поток');
  assert.ok(
    /\}, \[stream, camOn, isLocal\]\);/.test(tile),
    'эффект перезапускается и по camOn, а не только по stream',
  );
});

// ─── Звук ───────────────────────────────────────────────────────────────────

test('тайл не играет звук — этим занят CallAudioSink', () => {
  // Регресс: у удалённых тайлов было muted={isLocal} === false, и тот же
  // поток играл ещё и в CallAudioSink — двойное воспроизведение с эхом.
  // Ищем НАСТОЯЩИЙ тег по колбэк-рефу: первое вхождение <video в файле
  // принадлежит комментарию и обрезается сразу после «>».
  const anchor = tile.indexOf('ref={(el) =>');
  const start = tile.lastIndexOf('<video', anchor);
  // Режем по концу открывающего тега — по переходу на style={{, а не по «>»:
  // внутри атрибутов и комментария уже встречаются закрывающие уголки.
  const end = tile.indexOf('style={{', anchor);
  const videoTag = tile.slice(start, end);
  assert.ok(anchor >= 0 && start >= 0, 'тег video есть');
  // Порядок атрибутов не фиксируем: muted может стоять до или после autoPlay.
  assert.ok(
    /autoPlay[\s\S]*\bmuted\b/.test(videoTag),
    `video приглушён безусловно: ${videoTag.slice(-120)}`,
  );
  // Прежнего условия быть не должно — только как текст в комментарии.
  assert.ok(
    !/autoPlay[\s\S]*\bmuted=\{/.test(videoTag),
    'прежнего условия по isLocal больше нет',
  );
  assert.ok(/autoPlay/.test(sink), 'звук играет CallAudioSink');
});

test('CallAudioSink цепляется к потоку пира', () => {
  assert.ok(/srcObject = stream/.test(sink), 'поток назначается элементу');
  assert.ok(/stream=\{p\.stream\}/.test(sink), 'берётся поток пира из стора');
  // Оглушение должно глушить и звук, а не только картинку.
  assert.ok(/muted=\{deaf\}/.test(sink), 'оглушение глушит звук');
});