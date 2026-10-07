/**
 * Обои с календарём и часами (внешний вид темы).
 *
 * Проверяем четыре звена цепочки, каждое из которых легко «отваливается» по
 * отдельности: настройка в сторе → снимок/применение в теме → тумблер и
 * расположение в панели «Внешний вид» → сам слой на обоях чата с тем же
 * шрифтом, что у сообщений.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const settings = read('src/store/userSettingsStore.ts');
const themeStore = read('src/store/themeStore.ts');
const panels = read('src/components/ThemeSettingsPanels.tsx');
const chat = read('src/components/ChatWindow.tsx');
const clock = read('src/components/WallClockOverlay.tsx');

// ── Настройка живёт во внешнем виде и не теряется при синхронизации ───────────

test('wallClock объявлен во внешнем виде стора настроек', () => {
  assert.ok(settings.includes('export type WallClockPos'), 'тип положения объявлен');
  assert.ok(
    /export type WallClockPos = 'center' \| 'top' \| 'bottom';/.test(settings),
    'положение — по середине / сверху / снизу',
  );
  assert.ok(settings.includes('wallClockEnabled: boolean'), 'тумблер объявлен');
  assert.ok(settings.includes('wallClockPos: WallClockPos'), 'поле положения объявлено');
  // По умолчанию часы выключены, а включаются они ровно по середине обоев.
  assert.ok(/wallClockEnabled: false,/.test(settings), 'по умолчанию выключено');
  assert.ok(/wallClockPos: 'center',/.test(settings), 'по умолчанию — центр обоев');
});

test('обои с календарём/часами едут между устройствами', () => {
  // Без этих ключей настройка жила бы только в localStorage одного браузера.
  const syncBlock = settings.slice(settings.indexOf('const SYNC_KEYS'));
  assert.ok(syncBlock.includes("'wallClockEnabled'"), 'тумблер в списке синхронизации');
  assert.ok(syncBlock.includes("'wallClockPos'"), 'положение в списке синхронизации');
});

// ── Настройка принадлежит КОНКРЕТНОЙ теме (снимок → применение) ───────────────

test('wallClock входит в ThemeSettings.appearance', () => {
  // Поля размеров опциональны: снимки настроек, сделанные до их появления,
// не содержат их — иначе старый снимок не прошёл бы проверку формы.
assert.ok(
  /wallClock\?: \{ enabled: boolean; avoid\?: boolean; pos: WallClockPos; datePos\?: WallClockDatePos; seconds\?: boolean; secondsPos\?: WallClockSecondsPos; secondsScale\?: number; timeScale\?: number; dateScale\?: number \}/.test(themeStore),
  'поле объявлено, размеры, положения и отодвигание опциональны',
);
  assert.ok(
    /import \{ useUserSettingsStore, type LayoutSettings, type WallClockPos, type WallClockDatePos, type WallClockSecondsPos \}/.test(themeStore),
    'типы положения импортированы',
  );
});

test('снимок темы забирает часы, а применение возвращает их', () => {
  // Снимок читает тот же стор, из которого потом пишет applyThemeSettings.
  assert.ok(
    /wallClock: \{ enabled: us\.wallClockEnabled, avoid: us\.wallClockAvoid, pos: us\.wallClockPos, datePos: us\.wallClockDatePos, seconds: us\.wallClockSeconds, secondsPos: us\.wallClockSecondsPos, secondsScale: us\.wallClockSecondsScale, timeScale: us\.wallClockTimeScale, dateScale: us\.wallClockDateScale \},/.test(themeStore),
    'снимок берёт включение, отодвигание, положение и размеры',
  );
  const applyBody = themeStore.slice(themeStore.indexOf('export function applyThemeSettings'));
  assert.ok(applyBody.includes("us.set('wallClockEnabled', s.appearance.wallClock.enabled)"), 'включение применяется');
  assert.ok(applyBody.includes("us.set('wallClockPos', s.appearance.wallClock.pos)"), 'положение применяется');
});

test('старые снимки без wallClock не гасят выбор пользователя', () => {
  // У настроек, сохранённых до появления функции, поля нет. Если применять их
  // «как есть», каждый старый пресет выключал бы часы при переключении темы.
  assert.ok(
    /if \(s\.appearance\.wallClock\) \{/.test(themeStore),
    'wallClock применяется только когда он есть в снимке',
  );
  assert.ok(
    /typeof s\.appearance\.wallClock\.enabled === 'boolean'/.test(themeStore),
    'битое/частичное значение не пишется в стор',
  );
});

// ── Панель «Внешний вид» даёт тумблер и расположение ──────────────────────────

test('во внешнем виде есть тумблер обоев с календарём и часами', () => {
  assert.ok(panels.includes('Обои с календарём и часами'), 'тумблер подписан');
  assert.ok(panels.includes("s.set('wallClockEnabled', v)"), 'тумблер пишет в внешний вид');
});

test('во внешнем виде настраивается расположение на обоях', () => {
  assert.ok(panels.includes('Расположение на обоях'), 'заголовок настройки расположения');
  for (const pos of ['center', 'top', 'bottom']) {
    assert.ok(panels.includes(`value="${pos}"`), `есть вариант ${pos}`);
  }
  assert.ok(panels.includes("s.set('wallClockPos', v)"), 'выбор положения пишется в стор');
  assert.ok(panels.includes('type WallClockPos'), 'тип положения импортирован в панель');
});

// ── Слой на обоях чата: центр обоев, шрифт чата/темы ──────────────────────────

test('часы рисуются поверх обоев и не перехватывают клики', () => {
  assert.ok(clock.includes("position: 'absolute', inset: 0"), 'слой на все обои');
  assert.ok(clock.includes('pointerEvents') && clock.includes("'none'"), 'клики проходят сквозь слоя');
  assert.ok(/zIndex: 1/.test(clock), 'слой над фоном');
});

test('часы показывают календарь и время и идут сами', () => {
  assert.ok(clock.includes('toLocaleDateString'), 'дата');
  assert.ok(clock.includes('Intl.DateTimeFormat'), 'время');
  assert.ok(/weekday: 'long', day: 'numeric', month: 'long'/.test(clock), 'дата как календарь');
  assert.ok(clock.includes('setInterval'), 'время обновляется');
  assert.ok(clock.includes('clearInterval'), 'таймер очищается');
  // Выключенная настройка не должна оставлять пустой слой в дереве.
  assert.ok(/if \(!enabled\) return null;/.test(clock), 'выключено — слоя нет');
});

test('стиль букв и цифр берётся из шрифта чата/темы', () => {
  assert.ok(clock.includes('fontFamily'), 'шрифт приходит пропом');
  // Проп объявлен один раз, а применён к дате и ко времени.
  assert.equal((clock.match(/\n\s*fontFamily,\r?\n/g) || []).length, 3, 'шрифт применён к дате, секундам и времени');
  assert.ok(clock.includes('fontVariantNumeric'), 'цифры ровной ширины — часы не дёргаются');
});

test('расположение из настройки применяется к слою', () => {
  assert.ok(clock.includes('function placeStyles'), 'расположение считается по настройке');
  // Положение задаётся прямо свойствами top/bottom: у «сверху» должен быть
  // top, у «снизу» — bottom. Именно их и путают между собой, поэтому проверяем
  // каждое ветку отдельно, а не «вообще есть отступ».
  const topBranch = clock.slice(clock.indexOf("if (pos === 'top')"), clock.indexOf("if (pos === 'bottom')"));
  const bottomBranch = clock.slice(clock.indexOf("if (pos === 'bottom')"), clock.indexOf('return { ...base, top: 0, bottom: 0'));
  assert.match(topBranch, /top: \{ xs: 76, md: 88 \}/, 'сверху — отступ сверху');
  assert.ok(!/bottom:/.test(topBranch), 'сверху нет bottom, иначе блок растянется');
  assert.match(bottomBranch, /bottom: \{ xs: 104, md: 92 \}/, 'снизу — отступ снизу');
  assert.ok(!/\btop:/.test(bottomBranch), 'снизу нет top, иначе блок растянется');
  // По середине блок занимает всю высоту и центрируется.
  const centerBranch = clock.slice(clock.indexOf('return { ...base, top: 0, bottom: 0'));
  assert.match(centerBranch, /top: 0, bottom: 0/, 'по середине — во всю высоту');
});

test('размер часов и даты настраивается и переживает тему', () => {
  assert.ok(settings.includes('wallClockTimeScale: number'), 'масштаб времени объявлен');
  assert.ok(settings.includes('wallClockDateScale: number'), 'масштаб даты объявлен');
  assert.ok(/wallClockTimeScale: 1,/.test(settings), 'по умолчанию 100%');
  assert.ok(/wallClockDateScale: 1,/.test(settings), 'по умолчанию 100%');
  // Иначе размер настраивался бы на одном устройстве и терялся бы на другом.
  const sync = settings.slice(settings.indexOf('const SYNC_KEYS'));
  assert.ok(sync.includes("'wallClockTimeScale'"), 'размер времени синхронизируется');
  assert.ok(sync.includes("'wallClockDateScale'"), 'размер даты синхронизируется');
  // Снимок и применение — размер должен переживать переключение темы.
  assert.ok(
    /timeScale: us\.wallClockTimeScale, dateScale: us\.wallClockDateScale/.test(themeStore),
    'снимок берёт размеры',
  );
  const apply = themeStore.slice(themeStore.indexOf('export function applyThemeSettings'));
  assert.ok(apply.includes("us.set('wallClockTimeScale'"), 'размер времени применяется');
  assert.ok(apply.includes("us.set('wallClockDateScale'"), 'размер даты применяется');
});

test('слой часов умножает базовый кегль на настройку', () => {
  assert.ok(clock.includes('s.wallClockTimeScale') || clock.includes('wallClockTimeScale'), 'читает масштаб');
  assert.ok(/round\(56 \* tScale\)/.test(clock), 'кегль времени масштабируется');
  assert.ok(/round\(15 \* dScale\)/.test(clock), 'кегль даты масштабируется');
  // Старые снимки настроек поля не содержат: без подстраховки был бы NaN.
  assert.ok(clock.includes('Number.isFinite(timeScale)'), 'битое значение не превращается в NaN');
  // Ползунки в панели внешнего вида.
  assert.ok(panels.includes('wallClockTimeScale'), 'есть ползунок времени');
  assert.ok(panels.includes('wallClockDateScale'), 'есть ползунок даты');
});

test('положение даты выбирается: над, под, слева, справа', () => {
  assert.ok(
    /export type WallClockDatePos = 'above' \| 'below' \| 'left' \| 'right';/.test(settings),
    'тип положения даты объявлен',
  );
  assert.ok(settings.includes('wallClockDatePos: WallClockDatePos'), 'поле объявлено');
  assert.ok(/wallClockDatePos: 'above',/.test(settings), 'по умолчанию дата над временем');
  // Иначе раскладка настраивалась бы на одном устройстве.
  const sync = settings.slice(settings.indexOf('const SYNC_KEYS'));
  assert.ok(sync.includes("'wallClockDatePos'"), 'положение даты синхронизируется');

  // Раскладка в слое: слева/справа — строка, иначе колонка, порядок задан явно.
  assert.ok(/const side = datePos === 'left' \|\| datePos === 'right';/.test(clock), 'слева/справа — в строку');
  assert.ok(/const dateFirst = datePos === 'above' \|\| datePos === 'left';/.test(clock), 'порядок задан явно');
  assert.ok(/flexDirection: side \? 'row' : 'column'/.test(clock), 'колонка/строка по настройке');
  // «Слева» = сначала дата, «справа» = сначала время: если перепутать, дата
  // прыгнёт на другую сторону часов.
  assert.ok(/dateFirst \? dateNode : timeGroup/.test(clock), 'порядок узлов по флагу');
  // В строке дата встаёт по базовой линии, иначе она центрируется по высоте
  // цифр и «висит» сбоку.
  assert.ok(/alignSelf: side \? 'baseline'/.test(clock), 'дата по базовой линии рядом с цифрами');

  // Переключатель в настройках и проведение через тему.
  assert.ok(panels.includes('wallClockDatePos'), 'есть выбор положения даты');
  assert.ok(panels.includes("s.set('wallClockDatePos', v)"), 'выбор пишется в стор');
  assert.ok(/datePos: us\.wallClockDatePos, seconds: us\.wallClockSeconds/.test(themeStore), 'снимок темы берёт положение даты и секунды');
  const apply = themeStore.slice(themeStore.indexOf('export function applyThemeSettings'));
  assert.ok(apply.includes("us.set('wallClockDatePos'"), 'положение применяется при смене темы');
});

test('секунды выключены по умолчанию и настраиваются отдельно от даты', () => {
  assert.ok(
    /export type WallClockSecondsPos =\n?\s*\| 'above' \| 'below' \| 'left' \| 'right'\n?\s*\| 'topLeft' \| 'topRight' \| 'bottomLeft' \| 'bottomRight';/.test(settings),
    'тип положения секунд объявлен вместе с угловыми вариантами',
  );
  assert.ok(settings.includes('wallClockSeconds: boolean'), 'поле-тумблер объявлено');
  assert.ok(settings.includes('wallClockSecondsPos: WallClockSecondsPos'), 'поле положения объявлено');
  assert.ok(/wallClockSeconds: false,/.test(settings), 'по умолчанию секунды выключены');
  assert.ok(/wallClockSecondsPos: 'below',/.test(settings), 'по умолчанию секунды под временем');
  // Иначе раскладка задавалась бы только на одном устройстве.
  const sync = settings.slice(settings.indexOf('const SYNC_KEYS'));
  assert.ok(sync.includes("'wallClockSeconds'"), 'тумблер синхронизируется');
  assert.ok(sync.includes("'wallClockSecondsPos'"), 'положение секунд синхронизируется');

  // Переключатель в настройках: положение показывается только при включённых
  // секундах, иначе панель предлагала бы настраивать то, чего не видно.
  assert.ok(panels.includes('Показывать секунды'), 'есть тумблер секунд');
  assert.ok(panels.includes("s.set('wallClockSeconds', e.target.checked)"), 'тумблер пишется в стор');
  assert.ok(panels.includes('wallClockSecondsPos'), 'есть выбор положения секунд');
  assert.ok(panels.includes("s.set('wallClockSecondsPos', v)"), 'положение пишется в стор');
  assert.ok(/{s\.wallClockSeconds && \(/.test(panels), 'положение скрыто при выключенных секундах');
  assert.ok(panels.includes('type WallClockSecondsPos'), 'тип импортирован в панель');

  // Проведение через тему.
  assert.ok(/seconds: us\.wallClockSeconds, secondsPos: us\.wallClockSecondsPos/.test(themeStore), 'снимок берёт секунды');
  const apply = themeStore.slice(themeStore.indexOf('export function applyThemeSettings'));
  assert.ok(apply.includes("us.set('wallClockSeconds'"), 'тумблер применяется при смене темы');
  assert.ok(apply.includes("us.set('wallClockSecondsPos'"), 'положение применяется при смене темы');
  // Старые снимки полей не содержат — применять их «ка есть» значило бы
  // выключить секунды, заданные пользователем вручную.
  assert.ok(
    /typeof s\.appearance\.wallClock\.seconds === 'boolean'/.test(themeStore),
    'булево поле проверяется на undefined',
  );
});

test('секунды стоят вокруг часов, а не внутри строки времени', () => {
  // Секунды — отдельный узел с собственным кеглем. Считать их частью строки
  // времени нельзя: «12:30:07» одним куском не даст поставить их по сторонам.
  assert.ok(clock.includes('const secNode ='), 'секунды отдельным узлом');
  assert.ok(/\{showSeconds \? sec : ''\}/.test(clock), 'содержимое узла зависит от тумблера');
  // Секунды вчетверо мельче часов: в одном кегле «12:30» и «07» читается как «12:3007».
  // Порядок узлов в файле не фиксируем — сравниваем по величине, а не по индексу.
  const sizes = (clock.match(/round\((\d+) \* (?:tScale|secScale)\)/g) || []).map((s) => Number(s.match(/\d+/)[0]));
  const timeSize = sizes.find((n) => n > 40);
  const secSize = sizes.find((n) => n < 40);
  assert.equal(sizes.length, 4, 'у часов и у секунд свой кегль для телефона и десктопа');
  assert.ok(timeSize && timeSize === 56, 'часы — базовый кегль 56 на телефоне');
  assert.ok(secSize && secSize === 16, 'секунды заметно мельче часов');
  // Свой множитель: иначе размер секунд нельзя было бы менять отдельно от часов.
  assert.ok(/round\(16 \* secScale\)/.test(clock), 'кегль секунд умножается на свой множитель');
  assert.ok(/const secScale = Number\.isFinite\(secondsScale\) \? secondsScale : 1;/.test(clock), 'множитель с запасом к дефолту');
  assert.ok(settings.includes('wallClockSecondsScale: number'), 'поле размера секунд объявлено');
  assert.ok(/wallClockSecondsScale: 1,/.test(settings), 'по умолчанию 100%');
  const syncScale = settings.slice(settings.indexOf('const SYNC_KEYS'));
  assert.ok(syncScale.includes("'wallClockSecondsScale'"), 'размер секунд синхронизируется');
  assert.ok(panels.includes('Размер секунд'), 'есть ползунок размера секунд');
  assert.ok(panels.includes("s.set('wallClockSecondsScale'"), 'ползунок пишется в стор');
  assert.ok(/secondsScale\?: number/.test(themeStore), 'размер секунд входит в снимок темы');
  const applyScale = themeStore.slice(themeStore.indexOf('export function applyThemeSettings'));
  assert.ok(applyScale.includes("us.set('wallClockSecondsScale'"), 'размер секунд применяется при смене темы');
  assert.ok(
    /Number\.isFinite\(s\.appearance\.wallClock\.secondsScale\)/.test(themeStore),
    'размер проверяется на число — старый снимок не зануляет ползунок',
  );

  // Внутренняя раскладка «часы + секунды» — своя, независимая от даты.
  assert.ok(/const secSide = secondsPos === 'left' \|\| secondsPos === 'right';/.test(clock), 'слева/справа — в строку');
  assert.ok(/const secFirst = secondsPos === 'above' \|\| secondsPos === 'left';/.test(clock), 'порядок задан явно');
  assert.ok(/flexDirection: secSide \|\| secCorner \? 'row' : 'column'/.test(clock), 'колонка/строка по настройке');
  assert.ok(/secCorner \? timeNode : \(secFirst \? secNode : timeNode\)/.test(clock), 'порядок узлов по флагу');
  assert.ok(/alignSelf: secCorner \? undefined : secSide \? 'baseline'/.test(clock), 'секунды по базовой линии рядом с цифрами');

  // Пока секунды выключены, блока вокруг часов нет вовсе — пустой flex-контейнер
  // всё равно занял бы место и сдвинул время.
  assert.ok(/const timeGroup = showSeconds \? \(/.test(clock), 'блок создаётся только при включённых секундах');
  assert.ok(/\) : timeNode;/.test(clock), 'иначе рисуются одни часы');

  // Секунды берутся по типу части, а не вырезкой из строки: в локалях с
  // нелатинскими цифрами и разделителями вырезка отрезала бы не то.
  assert.ok(clock.includes("p.type === 'second'"), 'секунды берутся через formatToParts');
  assert.ok(!/toLocaleTimeString\(locale, \{ second/.test(clock), 'нет вырезки секунд из строки');
});

test('угловые положения секунд уводят их за угол часов', () => {
  for (const pos of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
    assert.ok(panels.includes(`value="${pos}"`), `в настройках есть вариант ${pos}`);
  }

  // Угол в ряду или колонке не выразить — сдвиг от угла диагональный, поэтому
  // секунды позиционируются абсолютно, а блок часов становится точкой отсчёта.
  assert.ok(
    /const secCorner = secondsPos === 'topLeft' \|\| secondsPos === 'topRight'/.test(clock),
    'угловой режим распознаётся',
  );
  assert.ok(/position: 'relative'/.test(clock), 'блок часов — точка отсчёта для абсолютных секунд');
  assert.ok(/position: 'absolute' as const/.test(clock), 'секунды в углу позиционируются абсолютно');

  // Каждой стороне — своя пара свойств: «сверху слева» это top + left. Если
  // стороны перепутать, секунды прыгнут в противоположный угол, поэтому каждая
  // ветка проверяется отдельно, а не «сдвиг вообще есть».
  assert.ok(
    /secondsPos === 'topLeft' \|\| secondsPos === 'bottomLeft'[\s\S]*\? \{ left: /.test(clock),
    'левая ветка ставит left',
  );
  assert.ok(
    /secondsPos === 'topLeft' \|\| secondsPos === 'bottomLeft'[\s\S]*: \{ right: /.test(clock),
    'правая ветка ставит right',
  );
  assert.ok(
    /secondsPos === 'topLeft' \|\| secondsPos === 'topRight'[\s\S]*\? \{ top: /.test(clock),
    'верхняя ветка ставит top',
  );
  assert.ok(
    /secondsPos === 'topLeft' \|\| secondsPos === 'topRight'[\s\S]*: \{ bottom: /.test(clock),
    'нижняя ветка ставит bottom',
  );
  // Отступ долями габаритов, а не пикселями: кегль на телефоне и десктопе
  // разный, и фиксированный отступ наезжал бы на цифры.
  assert.ok(/const gapPct = 12;/.test(clock), 'отступ задан долями, а не пикселями');
  assert.ok(/top: `\$\{-gapPct\}%`/.test(clock), 'отступ применяется в процентах');

  // В угловом режиме часы обязаны остаться в раскладке: если убрать и их,
  // блок окажется пустым и время пропадёт совсем.
  assert.ok(
    /\{secCorner \? timeNode : \(secFirst \? secNode : timeNode\)\}/.test(clock),
    'часы остаются на месте при угловом режиме',
  );
  assert.ok(!/\{!secCorner && \(secFirst \? secNode : timeNode\)\}/.test(clock), 'секунды не занимают место в раскладке');
});

test('чат рисует часы тем же шрифтом, что и сообщения', () => {
  assert.ok(chat.includes("import WallClockOverlay from './WallClockOverlay'"), 'компонент подключён');
  assert.ok(chat.includes('<WallClockOverlay'), 'слой отрендерен');
  assert.ok(chat.includes('chatId={id}'), 'слой получает id текущего чата');
  assert.ok(
    chat.includes('fontFamily={id ? (chatFontValue || globalFontFamily) : globalFontFamily}'),
    'шрифт тот же, что у ленты сообщений',
  );
  assert.ok(clock.includes("import { useChatFontStore } from '../store/chatFontStore'"), 'часы подписаны на шрифты чатов');
  assert.ok(clock.includes('s.perChatFonts[chatId]'), 'часы читают шрифт по id текущего чата');
});

// ── Отодвигание сообщений, закрывающих часы ────────────────────────

test('отодвигание объявлено, выключено по умолчанию и едет между устройствами', () => {
  assert.ok(settings.includes('wallClockAvoid: boolean'), 'поле объявлено');
  assert.ok(/wallClockAvoid: false,/.test(settings), 'по умолчанию выключено');
  const sync = settings.slice(settings.indexOf('const SYNC_KEYS'));
  assert.ok(sync.includes("'wallClockAvoid'"), 'настройка синхронизируется');
  // Живёт рядом с тумблером часов — иначе её пришлось бы искать в другом месте.
  assert.ok(panels.includes('Отодвигать сообщения из-под часов'), 'тумблер подписан');
  assert.ok(panels.includes("s.set('wallClockAvoid', v)"), 'тумблер пишет во внешний вид');
  assert.ok(/disabled=\{!s\.wallClockEnabled\}/.test(panels), 'зависит от включения часов');
  // Помечено как экспериментальное: функцию ещё шлифуют, и по подписи это видно.
  assert.ok(/Отодвигать сообщения из-под часов \(Ex\)/.test(panels), 'тумблер помечен как Ex');
  assert.ok(/Экспериментально/.test(panels), 'в подсказке сказано, что это экспериментально');
});

test('отодвигание переживает смену темы', () => {
  assert.ok(/avoid: us\.wallClockAvoid/.test(themeStore), 'снимок берёт настройку');
  const apply = themeStore.slice(themeStore.indexOf('export function applyThemeSettings'));
  assert.ok(apply.includes("us.set('wallClockAvoid'"), 'настройка применяется');
  assert.ok(
    /typeof s\.appearance\.wallClock\.avoid === 'boolean'/.test(themeStore),
    'старые снимки без поля не портят настройку',
  );
});

test('смещение считается по блоку часов, а не по всему слою', () => {
  // Слой растянут на все обои: если публиковать его границы, «часами» оказутся весь экран и сдвигалось бы каждое сообщение.
  assert.ok(clock.includes('data-clock-ink'), 'измеряется блок с содержимым');
  assert.ok(clock.includes("width: 'fit-content'"), 'блок подстраивается под содержимое');
  assert.ok(clock.includes('getBoundingClientRect'), 'границы публикуются в стор ленты');
});

test('свои и чужие сообщения отодвигаются одинаково', () => {
  const bubble = read('src/components/MessageBubble.tsx');
  // Хук стоит на пузыре и на корне строки — до ветвления на свои/чужие.
  assert.ok(bubble.includes('useClockAvoid(bubbleRef, rowRef)'), 'смещение считается по пузырю и строке');
  assert.ok(bubble.includes('transform 260ms'), 'смещение плавное');
  // Сдвиг только трансформацией. Зазор здесь ломал: высота ленты росла, полоса прокрутки уезжала,
  // и самое нижнее сообщение оказывалось за краем экрана.
  assert.ok(
    /transform: `translateX\(\$\{clockAvoid\}px\)`/.test(bubble),
    'горизонтальный сдвиг трансформацией',
  );
  assert.ok(
    !/mt: `\$\{clockAvoid\}px`/.test(bubble),
    'вертикального зазора нет — лента не растёт',
  );
  assert.ok(chat.includes('bumpClockLayout()'), 'прокрутка сообщает о смене позиции');
});

test('часы по середине остаются по середине', () => {
  // Раскладку разбили на две обёртки: слой задаёт положение, вложенный блок — содержимое.
  // При этом центрирование потерялось: растянутая обёртка без alignItems прижала блок с цифрами к верху,
  // и часы уезжали наверх вместо средины.
  const at = clock.indexOf('...placeStyles(pos)');
  const wrapper = clock.slice(at - 300, at);
  assert.ok(wrapper.includes('alignItems'), 'обёртка центрирует по вертикали');
  assert.ok(wrapper.includes('justifyContent'), 'обёртка центрирует по горизонтали');
  assert.ok(/width: 'fit-content'/.test(clock), 'измеряемый блок подстраивается под содержимое');
});