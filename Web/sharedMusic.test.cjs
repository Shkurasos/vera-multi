/**
 * Общая библиотека музыки на клиенте: проводка настроек до UI.
 *
 * Проверяем связность: стор держит раздельные списки (общие не должны
 * затирать личные), форма публикации требует ровно то, что сервер, а раздел
 * реально появился в музыке.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const store = read('src/store/sharedMusicStore.ts');
const panel = read('src/components/SharedMusicPanel.tsx');
const api = read('src/services/api.ts');
const types = read('src/types/index.ts');
const library = read('src/components/MusicLibrary.tsx');

test('общая библиотека не смешана с личной', () => {
  // Главная ошибка, которой могло случиться: один стор на оба списка. Тогда
  // общий список перетирал бы `tracks` и сбрасывал пользователю музыку.
  assert.ok(store.includes("import { create } from 'zustand'"), 'свой стор');
  assert.ok(!store.includes("from './musicStore'"), 'личный стор не импортируется');
  assert.ok(store.includes('musicApi.sharedTracks'), 'список общих');
  assert.ok(store.includes('musicApi.albums'), 'альбомы отдельно');
  assert.ok(store.includes("scope: 'shared'"), 'альбомы запрашиваются как общие, а не свои');
});

test('сортировки объявлены все и с ключами сервера', () => {
  // Ключи обязаны совпадать с SORTERS в music-share.js, иначе сервер тихо
  // откатит запрос на «новые», а интерфейс будет врать.
  for (const key of ['new', 'plays', 'title', 'artist', 'genre']) {
    assert.ok(store.includes(`key: '${key}'`), `сортировка ${key}`);
  }
  assert.ok(api.includes("sharedTracks: (params?: { q?: string; sort?: string"), 'sort передаётся на сервер');
});

test('поиск и сортировка перезапрашивают список', () => {
  // Ищем по РЕАЛИЗАЦИИ, а не по строке в интерфейсе: `setQuery:` встречается
  // ещё и в объявлении типа, и такая проверка прошла бы, ничего не проверив.
  const body = store.slice(store.indexOf('export const useSharedMusicStore'));
  assert.ok(/setQuery: \(query\) => \{[\s\S]{0,220}void get\(\)\.load\(\)/.test(body), 'поиск перезагружает');
  assert.ok(/setSort: \(sort\) => \{[\s\S]{0,220}void get\(\)\.load\(\)/.test(body), 'сортировка перезагружает');
  assert.ok(body.includes('musicApi.sharedTracks({ q: query || undefined, sort })'), 'условия в запрос');
});

test('треки и альбомы грузятся параллельно', () => {
  // Promise.all, а не два await подряд: иначе список альбомов ждал бы ещё
  // треков, и вкладка открывалась на полсекунды дольше.
  assert.ok(store.includes('Promise.all'), 'параллельные запросы');
});

test('форма публикации требует ровно обязательные поля', () => {
  // Сервер требует обложку, название, жанр и исполнителя. Если кнопка активна
  // без них — пользователь отправит запрос и получит 400.
  assert.ok(/const ready = !!\(title\.trim\(\) && artist\.trim\(\) && genre && coverUrl\)/.test(panel),
    'кнопка выложить проверяет все поля');
  assert.ok(panel.includes('label="Название"'), 'название');
  assert.ok(panel.includes('label="Исполнитель"'), 'исполнитель');
  assert.ok(panel.includes('label="Описание"'), 'описание');
  assert.ok(panel.includes('обложка обязательна'), 'про обложку сказано прямо');
});

test('жанр выбирается из списка, а не пишется руками', () => {
  // Свободный ввод жанра развалил бы главное свойство общей библиотеки:
  // «рок», «Рок» и «попса» стали бы разными жанрами, и фильтр по жанру
  // нашёл бы треть зала.
  assert.ok(panel.includes('function GenreField'), 'единый компонент выбора жанра');
  assert.ok(!panel.includes('select label="Жанр" value={genre} onChange={(e) => setGenre(e.target.value)}'),
    'сырого ввода жанра не осталось');
  assert.ok(panel.includes('genres.map((g) =>'), 'варианты приходят из списка сервера');
  // Старый жанр, которого в списке нет, должен быть виден, а не молчать.
  assert.ok(panel.includes('выберите жанр из списка заново'), 'предупреждение о старом жанре');
});

test('описание необязательное, но спросить надо', () => {
  // Раньше описание было необязательным молча; теперь у обоих видов записи
  // оно есть в форме, чтобы метаданные альбома и трека выглядели одинаково.
  assert.ok(panel.includes('label="Описание"'), 'поле есть в форме трека');
  assert.ok(panel.includes('необязательно'), 'и помечено как необязательное');
});

test('сохранение чужого не ждёт перезагрузки страницы', () => {
  assert.ok(store.includes('saveTrack'), 'сохранить трек');
  assert.ok(store.includes('saveAlbum'), 'сохранить альбом');
  // Сохранившему показываем «Сохранить» только у чужого: своё сохранять незачем.
  assert.ok(panel.includes('track.uploadedById === p.userId'), 'своё и чужое различается');
  assert.ok(panel.includes('isMine'), 'и у альбома');
});

test('снятие с публикации убирает запись из списка сразу', () => {
  // Иначе трек «уходит» только после перезагрузки и мигает на экране.
  assert.ok(/unpublishTrack[\s\S]{0,220}tracks\.filter/.test(store), 'трек убирается из списка');
  assert.ok(/unpublishAlbum[\s\S]{0,220}albums\.filter/.test(store), 'альбом убирается из списка');
});

test('обложка грузится отдельным запросом, а не вместе с аудио', () => {
  // Иначе смена картинки тянула бы перезаливку музыки.
  assert.ok(api.includes("api.post('/music/cover'"), 'своя точка загрузки обложки');
  assert.ok(panel.includes('musicApi.uploadCover'), 'панель пользуется ей');
  assert.ok(panel.includes("fd.append('cover', file)"), 'поле cover');
});

test('вкладка «Общая библиотека» есть в музыке', () => {
  assert.ok(library.includes('<Tab label="Общая библиотека" />'), 'вкладка добавлена');
  assert.ok(library.includes('<SharedMusicPanel />'), 'панель подключена');
  assert.ok(library.includes('import SharedMusicPanel'), 'импорт');
});

test('в общую библиотеку можно выложить один трек, а не только альбом', () => {
  // Жалоба: «в общую библиотеку можно добавлять не только плейлисты, но и треки
  // отдельно». Раньше публиковать было нечем: кнопка публикации жила в строке
  // ОБЩЕГО списка, а там бывают только уже опубликованные треки — то есть
  // опубликовать впервые было физически неоткуда.
  assert.ok(panel.includes('onClick={() => setTrackOpen(true)}'), 'кнопка «Трек» открывает форму');
  assert.ok(panel.includes('<AddTrackDialog'), 'форма подключена');
  // Форма берёт трек из ЛИЧНОЙ библиотеки — единственное место, где он есть
  // до публикации.
  assert.ok(/AddTrackDialog[\s\S]{0,900}useMusicStore/.test(panel), 'список своих треков');
  // Публикация идёт существующим маршрутом.
  assert.ok(panel.includes('await publishTrack(pickId'), 'публикует выбранный трек');
  // Список обновляется без перезагрузки страницы.
  assert.ok(/AddTrackDialog open=\{trackOpen\}[\s\S]{0,160}void load\(\)/.test(panel), 'после успеха список обновляется');
});

test('форма трека повторяет поля альбома', () => {
  // «Настройки при загрузке точно такие же как в альбоме». Сверяем набор
  // полей внутри обеих форм, а не наличие их вообще: иначе проверка прошла бы
  // даже с одним лишь заголовком диалога.
  const form = (name) => panel.slice(panel.indexOf(`function ${name}(`));
  const trackForm = form('AddTrackDialog');
  const albumForm = form('AlbumDialog');
  for (const field of ['CoverField', 'label="Название"', 'label="Исполнитель"', 'GenreField', 'label="Описание"']) {
    assert.ok(trackForm.includes(field), `в форме трека есть ${field}`);
    assert.ok(albumForm.includes(field), `в форме альбома есть ${field}`);
  }
  // Кнопка неактивна, пока не заполнено обязательное — иначе уходит 400.
  assert.ok(trackForm.includes('pickId && title.trim() && artist.trim() && genre && coverUrl'), 'проверка обязательного');
});

test('типы знают про альбом и поля публикации', () => {
  assert.ok(types.includes('export interface MusicAlbum'), 'тип альбома');
  assert.ok(types.includes('isPublic?: boolean;'), 'признак публикации');
  assert.ok(types.includes('genre?: string | null;'), 'жанр');
  assert.ok(types.includes('savedFromId?: string | null;'), 'откуда сохранено');
});