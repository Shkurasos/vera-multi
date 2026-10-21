/**
 * Разделы редактора тем и поиск по его настройкам.
 *
 * Разделы сгруппированы для верхней панели редактора. Индекс поиска — плоский
 * список «вкладка + название строки»: название совпадает с подписью строки в
 * панели, поэтому по нему же редактор находит строку и прокручивает к ней.
 */

export type SettingsTabId =
  | 'theme' | 'community'
  | 'wallpaper' | 'icons' | 'ui' | 'anim'
  | 'look' | 'clock' | 'messages' | 'layout'
  | 'sound';

export interface SettingsTabGroup {
  title: string;
  tabs: readonly (readonly [SettingsTabId, string])[];
}

/** Группы вкладок в верхней панели редактора — в порядке показа. */
export const TAB_GROUPS: readonly SettingsTabGroup[] = [
  { title: 'Темы', tabs: [['theme', 'Тема'], ['community', 'Темы комьюнити']] },
  { title: 'Оформление', tabs: [['wallpaper', 'Обои'], ['icons', 'Иконки'], ['ui', 'Стиль'], ['anim', 'Анимации']] },
  { title: 'Интерфейс', tabs: [['look', 'Внешний вид'], ['clock', 'Часы'], ['messages', 'Сообщения'], ['layout', 'Макет']] },
  { title: 'Звук', tabs: [['sound', 'Звук']] },
];

export const SETTINGS_TABS: readonly SettingsTabId[] = TAB_GROUPS.flatMap((g) => g.tabs.map(([id]) => id));

export const TAB_LABELS: Record<SettingsTabId, string> = Object.fromEntries(
  TAB_GROUPS.flatMap((g) => g.tabs.map(([id, label]) => [id, label])),
) as Record<SettingsTabId, string>;

export interface SettingsIndexEntry {
  tab: SettingsTabId;
  /** Подпись строки ровно как в панели — по ней ищется элемент для прокрутки. */
  label: string;
  /** Синонимы, по которым строку тоже можно найти. */
  keywords?: string;
}

const e = (tab: SettingsTabId, label: string, keywords?: string): SettingsIndexEntry => ({ tab, label, keywords });

/**
 * Статическая часть индекса. Строки, которые панели строят из сторов
 * (режимы стиля, группы анимаций), добавляет вызывающий код — см. extra
 * в searchSettings.
 */
export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
  // Тема
  e('theme', 'Мои темы', 'сохранённые свои'),
  e('theme', 'Встроенные темы', 'готовые стандартные'),
  e('theme', 'Название темы', 'имя ии сгенерировать'),
  e('theme', 'Фон приложения', 'цвет'),
  e('theme', 'Основной текст', 'цвет шрифт'),
  e('theme', 'Акцент', 'цвет основной accent'),
  e('theme', 'Вторичный текст', 'цвет серый'),
  e('theme', 'Онлайн-точка', 'цвет статус'),
  e('theme', 'Сайдбар', 'цвет боковая панель'),
  e('theme', 'Область чата', 'цвет фон'),
  e('theme', 'Хедер', 'цвет шапка'),
  e('theme', 'Поле ввода', 'цвет'),
  e('theme', 'Ховер-фон', 'цвет наведение'),
  e('theme', 'Активный элемент', 'цвет выбранный'),
  e('theme', 'Свой пузырь', 'цвет градиент сообщения'),
  e('theme', 'Чужой пузырь', 'цвет градиент сообщения'),
  e('theme', 'Текст своего пузыря', 'цвет'),
  e('theme', 'Текст чужого пузыря', 'цвет'),
  e('theme', 'Время на сообщениях', 'цвет'),
  e('theme', 'Время в списке чатов', 'цвет'),
  e('theme', 'Паттерн фона чата', 'узор рисунок'),
  e('theme', 'Фоновое свечение', 'glow интенсивность'),
  e('theme', 'Отделка поверхностей (Finish)', 'стекло матовая металлик'),
  e('theme', 'Превью чата', 'предпросмотр'),
  // Темы комьюнити
  e('community', 'Темы комьюнити', 'community каталог опубликовать скачать поделиться'),
  // Обои
  e('wallpaper', 'Текущие обои темы', 'фон картинка фото видео'),
  e('wallpaper', 'Обои списка чатов', 'фон меню сайдбар'),
  // Иконки
  e('icons', 'Пак иконок', 'набор icons'),
  e('icons', 'Свои паки', 'эмодзи рисунок своя иконка'),
  // Стиль
  e('ui', 'Скругление углов основного экрана, px', 'радиус углы'),
  e('ui', 'Скругление плашек профиля, px', 'радиус'),
  e('ui', 'Скругление аватарок, %', 'радиус круг квадрат'),
  e('ui', 'Скругление сообщений, px', 'радиус пузыри'),
  e('ui', 'Скругление нижней панели, px', 'радиус навигация'),
  e('ui', 'Непрозрачность нижней панели, %', 'прозрачность навигация'),
  e('ui', 'Высота нижней панели, px', 'размер навигация профиль музыка редактор архив'),
  e('ui', 'Сбросить стиль', 'по умолчанию'),
  e('ui', 'Вид чатов', 'карточки форма список'),
  e('ui', 'Обводка карточек', 'рамка граница'),
  e('ui', 'Заливка карточек', 'фон полоса'),
  // Анимации
  e('anim', 'Все анимации интерфейса', 'движение motion'),
  // Внешний вид
  e('look', 'Яркость, %', 'темнее светлее'),
  e('look', 'Масштаб текста, %', 'размер шрифта крупнее мельче'),
  e('look', 'Шрифт всего приложения', 'font гарнитура'),
  // Часы
  e('clock', 'Обои с календарём и часами', 'часы время дата календарь'),
  e('clock', 'Отодвигать сообщения из-под часов (Ex)', 'часы сдвиг'),
  e('clock', 'Где показывать часы', 'диалоги доски группы каналы'),
  e('clock', 'Расположение на обоях', 'часы положение угол центр'),
  e('clock', 'Где стоит дата', 'часы календарь'),
  e('clock', 'Размер времени, %', 'часы'),
  e('clock', 'Размер даты, %', 'часы календарь'),
  e('clock', 'Показывать секунды', 'часы'),
  e('clock', 'Где стоят секунды', 'часы'),
  e('clock', 'Размер секунд, %', 'часы'),
  e('clock', 'Свой HUD вместо часов', 'html url ссылка виджет'),
  e('clock', 'Высота HUD, px', 'html виджет'),
  // Сообщения
  e('messages', 'Показывать пузыри сообщений', 'облачка'),
  e('messages', 'Выравнивание по стенке', 'пузыри текст сторона'),
  e('messages', 'Время и галочки в пузыре', 'прочитано статус'),
  e('messages', 'Максимальная ширина пузыря, %', 'пузыри'),
  e('messages', 'Высота пузыря, px', 'пузыри отступ'),
  e('messages', 'Размер текста, px', 'пузыри шрифт'),
  e('messages', 'Плашка даты в ленте сообщений', 'дата разделитель день'),
  // Макет
  e('layout', 'Визуальный конструктор', 'перетаскивать панели'),
  e('layout', 'Сторона панели чатов (десктоп)', 'сайдбар слева справа'),
  e('layout', 'Нижняя навигация (мобильный)', 'телефон'),
  e('layout', 'Нижняя панель сайдбара (десктоп)', 'как на телефоне компактная'),
  e('layout', 'Плеер', 'музыка'),
  e('layout', 'Шапка чата', 'хедер'),
  e('layout', 'Поле ввода чата', 'сообщение'),
  e('layout', 'Плотность интерфейса', 'компактно просторно'),
  e('layout', 'Скругление углов окна чата и панелей, px', 'радиус'),
  e('layout', 'Ширина боковой панели, px', 'сайдбар'),
  e('layout', 'Показывать вкладки (Диалоги / Архив / Группы)', 'табы'),
  e('layout', 'Показывать аватары в списке чатов', 'аватарки'),
  e('layout', 'Сбросить макет', 'по умолчанию'),
  // Звук
  e('sound', 'Звук уведомлений по умолчанию', 'громкость мелодия уведомление'),
];

/** Без регистра, «ё» = «е», лишние пробелы схлопнуты. */
export function normalizeSearch(s: string): string {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Находит строки настроек: каждое слово запроса должно встретиться в
 * подписи, синонимах или названии вкладки. Совпадения в начале подписи —
 * выше, затем в подписи, затем по синонимам.
 */
export function searchSettings(
  query: string,
  extra: readonly SettingsIndexEntry[] = [],
  limit = 12,
): SettingsIndexEntry[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored: { entry: SettingsIndexEntry; score: number; i: number }[] = [];
  [...SETTINGS_INDEX, ...extra].forEach((entry, i) => {
    const label = normalizeSearch(entry.label);
    const hay = `${label} ${normalizeSearch(entry.keywords || '')} ${normalizeSearch(TAB_LABELS[entry.tab] || '')}`;
    if (!words.every((w) => hay.includes(w))) return;
    const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
    scored.push({ entry, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.entry);
}

/**
 * Ищет на экране строку настройки по подписи: сначала по data-setting-label
 * (так помечены строки панелей), затем по листовому элементу с тем же текстом
 * (секции и строки вкладки «Тема»).
 */
export function findSettingElement(root: ParentNode | null | undefined, label: string): HTMLElement | null {
  if (!root) return null;
  const want = normalizeSearch(label);
  const marked = Array.from(root.querySelectorAll<HTMLElement>('[data-setting-label]'));
  const hit = marked.find((el) => normalizeSearch(el.getAttribute('data-setting-label') || '') === want);
  if (hit) return hit;
  const leaf = Array.from(root.querySelectorAll<HTMLElement>('*'))
    .find((el) => el.children.length === 0 && normalizeSearch(el.textContent || '') === want);
  return leaf ? (leaf.parentElement || leaf) : null;
}
