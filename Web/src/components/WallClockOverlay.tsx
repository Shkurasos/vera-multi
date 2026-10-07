/**
 * Обои с календарём и часами — слой из настроек «Внешний вид» темы.
 *
 * Показывает дату («среда, 10 февраля») и время поверх фона чата: слой
 * абсолютный, pointer-events выключен, поверх — лента сообщений, поэтому
 * ничего не перекрывает. Шрифт приходит пропом и совпадает с лентой
 * сообщений: шрифт конкретного чата, а если его нет — глобальный шрифт
 * темы, так что цифры всегда в «своем» стиле. Положение (wallClockPos:
 * по середине / сверху / снизу) и само включение живут во внешнем виде
 * темы и переключаются там же.
 */
import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useUserSettingsStore, type WallClockPos } from '../store/userSettingsStore';
import { useChatFontStore } from '../store/chatFontStore';
import { useClockLayout } from '../store/wallClockLayout';

/** Язык даты — по языку интерфейса (userSettingsStore.language). */
const DATE_LOCALES: Record<string, string> = {
  ru: 'ru-RU', en: 'en-GB', uk: 'uk-UA', es: 'es-ES',
};

interface WallClockOverlayProps {
  chatKind?: 'dialogs' | 'board' | 'groups' | 'channels';
  /** id текущего чата — тот же ключ, по которому шрифт читают сообщения. */
  chatId?: string;
  /** font-family ленты сообщений: шрифт чата, иначе глобальный шрифт темы. */
  fontFamily: string;
  /** Цвет времени — основной текст темы. */
  color: string;
  /** Цвет даты — вторичный текст темы. */
  colorSec: string;
}

/**
 * Точка привязки блока.
 *
 * Раньше здесь был `justifyContent` колонки: «сверху» = flex-start, «снизу» =
 * flex-end. Логика верная, но её легко перепутать и трудно увидеть глазами —
 * поэтому положение задаётся прямо свойствами `top`/`bottom` на самом блоке.
 * Сверху и снизу добавлен отступ: шапка чата и поле ввода лежат поверх обоев и
 * перекрыли бы надписи.
 */
function placeStyles(pos: WallClockPos) {
  const base = { position: 'absolute' as const, left: 0, right: 0, textAlign: 'center' as const };
  if (pos === 'top') return { ...base, top: { xs: 76, md: 88 } };
  if (pos === 'bottom') return { ...base, bottom: { xs: 104, md: 92 } };
  return { ...base, top: 0, bottom: 0 };
}

export default function WallClockOverlay({ chatId, fontFamily: fallbackFontFamily, color, colorSec, chatKind = 'dialogs' }: WallClockOverlayProps) {
  // Подписываемся на тот же per-chat override, что и MessageBubble. Это важно
  // не только для первого рендера: при смене шрифта в открытом чате часы и дата
  // должны переключиться сразу, даже если родительский слой не менялся.
  const chatFont = useChatFontStore((s) => (chatId ? s.perChatFonts[chatId] : undefined));
  const fontFamily = chatFont || fallbackFontFamily;
  const enabled = useUserSettingsStore((s) => s.wallClockEnabled && s.wallClockChats?.[chatKind] !== false);
  const pos = useUserSettingsStore((s) => s.wallClockPos);
  const timeScale = useUserSettingsStore((s) => s.wallClockTimeScale);
  const dateScale = useUserSettingsStore((s) => s.wallClockDateScale);
  const datePos = useUserSettingsStore((s) => s.wallClockDatePos);
  const showSeconds = useUserSettingsStore((s) => s.wallClockSeconds);
  const secondsPos = useUserSettingsStore((s) => s.wallClockSecondsPos);
  const secondsScale = useUserSettingsStore((s) => s.wallClockSecondsScale);
  const language = useUserSettingsStore((s) => s.language);
  const [now, setNow] = useState(() => new Date());

  // Тик раз в секунду. Компонент изолирован (свой слой), поэтому обновление
  // времени не трогает ни ленту сообщений, ни слои обоев.
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  const locale = DATE_LOCALES[language] || 'ru-RU';
  const date = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  // Секунды — отдельная опция, по умолчанию выключены. Берём их через
  // formatToParts по типу части, а не вырезаем из строки: в локалях с
  // нелатинскими цифрами и разделителями вырезка отрезала бы не то.
  const secPart = new Intl.DateTimeFormat(locale, { second: '2-digit' }).formatToParts(now).find((p) => p.type === 'second');
  const sec = secPart ? secPart.value : '';
  // Часы без секунд всегда: показывать их можно отдельным узлом и в другом месте.
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);

  // Отодвигание сообщений живёт на тех же границах: слой публикует, где он
  // физически находится, а сообщения из store/wallClockLayout читают.
  const avoid = useUserSettingsStore((s) => s.wallClockAvoid);
  const setRect = useClockLayout((s) => s.setRect);
  const blockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!enabled || !avoid) {
      // Функция выключена или часов нет — публикуем пусто, иначе сообщения
      // держали бы сдвиг от часов, которые уже не рисуются.
      setRect(null);
      return;
    }
    const el = blockRef.current;
    if (!el) { setRect(null); return; }
    const publish = () => {
      // Замеряем именно блок с data-clock-ink: он подстроен под содержимое, в
      // отличие от растянутого слоя. Правый край с px:2 шире самих цифр —
      // это ровно тот запас, который не даёт сообщению лечь на часы вплотную.
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, pos });
    };
    publish();
    // Пересчёт на каждый тик: у блока меняется ширина («09:05» → «11:59»),
    // и без этого крайние сообщения оставались бы под надписями.
    const timer = setInterval(publish, 1000);
    window.addEventListener('resize', publish);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', publish);
      setRect(null);
    };
  }, [enabled, avoid, pos, timeScale, dateScale, secondsScale, showSeconds, datePos, secondsPos]);

  // All hooks must run even when a theme disables the clock.
  if (!enabled) return null;

  // Кегль умножаем на масштаб из настроек, но по разному для телефона и десктопа:
  // базовые кегли различаются вдвое, и общий множитель масштабировал бы их
  // неодинаково. Значения берём с запасом к дефолту 1 — старые снимки настроек
  // поля не содержат.
  const tScale = Number.isFinite(timeScale) ? timeScale : 1;
  const dScale = Number.isFinite(dateScale) ? dateScale : 1;
  const secScale = Number.isFinite(secondsScale) ? secondsScale : 1;
  const round = (v: number) => Math.round(v * 10) / 10;

  // Раскладка двухуровневая: сначала дата вокруг всего блока времени, затем
  // внутри этого блока — секунды вокруг самих часов. Порядок задаём явно, а не
  // через order, чтобы в разметке читалось, где что стоит.
  const side = datePos === 'left' || datePos === 'right';
  const dateFirst = datePos === 'above' || datePos === 'left';
  const secSide = secondsPos === 'left' || secondsPos === 'right';
  const secFirst = secondsPos === 'above' || secondsPos === 'left';
  // Угловые положения в ряду/колонке не выразить: сдвиг от угла диагональный,
  // поэтому для них секунды позиционируются абсолютно внутри блока часов.
  const secCorner = secondsPos === 'topLeft' || secondsPos === 'topRight'
    || secondsPos === 'bottomLeft' || secondsPos === 'bottomRight';

  // Сдвиг секунд за угол часов. Отступ задан долями габаритов блока часов, а не
  // в пикселях: кегль на телефоне и десктопе разный, и фиксированный отступ
  // на телефоне наезжал бы на цифры.
  const gapPct = 12;
  const cornerStyles = !secCorner ? {} : {
    position: 'absolute' as const,
    ...(secondsPos === 'topLeft' || secondsPos === 'bottomLeft'
      ? { left: `${-gapPct}%` } : { right: `${-gapPct}%` }),
    ...(secondsPos === 'topLeft' || secondsPos === 'topRight'
      ? { top: `${-gapPct}%` } : { bottom: `${-gapPct}%` }),
    lineHeight: 1,
  };

  const dateNode = (
    <Typography sx={{
      fontFamily,
      fontSize: { xs: round(15 * dScale), md: round(19 * dScale) }, fontWeight: 600, color: colorSec,
      // «среда, 10 февраля» → «Среда, 10 февраля».
      textTransform: 'capitalize',
      textShadow: '0 1px 3px rgba(0,0,0,0.30), 0 4px 22px rgba(0,0,0,0.35)',
      // В строке дата встаёт по базовой линии рядом с цифрами, а не по центру.
      alignSelf: side ? 'baseline' : undefined,
      whiteSpace: 'nowrap',
    }}>
      {date}
    </Typography>
  );
  // Секунды отдельным узлом и всегда вчетверо мельче часов: «12:30» рядом с
  // «07» в одном кегле читается как «12:3007».
  const secNode = (
    <Typography sx={{
      fontFamily,
      fontSize: { xs: round(16 * secScale), md: round(22 * secScale) }, lineHeight: 1, fontWeight: 600, color: colorSec,
      fontVariantNumeric: 'tabular-nums',
      textShadow: '0 1px 3px rgba(0,0,0,0.30), 0 4px 22px rgba(0,0,0,0.35)',
      // В ряду — по базовой линии цифр, в колонке — по центру, углом — сдвигом
      // от соответствующего угла часов. Значения заданы явно, чтобы «сверху
      // слева» нельзя было спутать с «снизу справа».
      alignSelf: secCorner ? undefined : secSide ? 'baseline' : undefined,
      ...cornerStyles,
      whiteSpace: 'nowrap',
    }}>
      {showSeconds ? sec : ''}
    </Typography>
  );
  const timeNode = (
    <Typography sx={{
      fontFamily,
      fontSize: { xs: round(56 * tScale), md: round(84 * tScale) }, lineHeight: 1, fontWeight: 700, color: color,
      letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
      textShadow: '0 2px 4px rgba(0,0,0,0.30), 0 8px 32px rgba(0,0,0,0.40)',
      whiteSpace: 'nowrap',
    }}>
      {time}
    </Typography>
  );

  // Блок «часы + секунды». Пока секунды выключены, узел не рендерим вовсе —
  // иначе пустой элемент всё равно занимает место в раскладке.
  const timeGroup = showSeconds ? (
    <Box sx={{
      // Угловые секунды позиционируются абсолютно, поэтому блок часов должен
      // быть точкой отсчёта. В ряду/колонке position не нужен, но он не мешает.
      position: 'relative',
      display: 'flex',
      flexDirection: secSide || secCorner ? 'row' : 'column',
      alignItems: 'center',
      columnGap: secSide && !secCorner ? 0.5 : 0,
      rowGap: secCorner || secSide ? 0 : 0.1,
    }}>
      {/* В угловом режиме в раскладке только часы: секунды уехали за угол и в
          ряд/колонке участвовать не должны. Часы в этом случае обязаны быть
          на месте — иначе блок останется пустым и время пропадёт совсем. */}
      {secCorner ? timeNode : (secFirst ? secNode : timeNode)}
      {!secCorner && (secFirst ? timeNode : secNode)}
    </Box>
  ) : timeNode;

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Обёртка задаёт положение (top/bottom/центр) и растянута на весь слой,
          поэтому мерить её нельзя: получилась бы рамка во весь экран и сдвиг
          каждого сообщения. Границы публикует вложенный блок — он по ширине
          подстраивается под содержимое.

          Центрирование живёт именно здесь. Обёртка растянута (top:0/bottom:0
          при «по середине»), а без alignItems/justifyContent вложенный блок
          прижимался к верхнему краю — часы уезжали наверх вместо середины. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...placeStyles(pos),
        }}
      >
        <Box
          ref={blockRef}
          data-clock-ink=""
          sx={{
            px: 2,
            width: 'fit-content',
            display: 'flex',
            flexDirection: side ? 'row' : 'column',
            alignItems: 'center',
            // В строке зазор по горизонтали, иначе дата липнет к цифрам.
            columnGap: side ? 2 : 0,
            rowGap: side ? 0 : 0.25,
          }}
        >
          {dateFirst ? dateNode : timeGroup}
          {dateFirst ? timeGroup : dateNode}
        </Box>
      </Box>
    </Box>
  );
}