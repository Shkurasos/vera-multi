import { create } from 'zustand';
import { clampBubble, normalizeMetaPos } from '../utils/bubbleSettings';
import type { BubbleMetaPos } from '../utils/bubbleSettings';
import { persist } from 'zustand/middleware';
import { registerAccountStore } from '../services/storeSyncSimple';
import type { RoundShape } from '../utils/roundShape';

/**
 * Глобальные пользовательские настройки: внешний вид (яркость, масштаб),
 * уведомления, приватность, данные и безопасность.
 * Часть полей уже применяется (brightness, textScale, appLock, language),
 * остальные персистятся и подключаются по мере готовности функционала.
 */

export type PrivacyScope = 'everyone' | 'contacts' | 'nobody';
export type PreviewMode = 'always' | 'when_off' | 'never';
export type AutoDeleteMonths = 0 | 1 | 3 | 6 | 12; // 0 = отключено

/* ─── Layout / раскладка интерфейса ─────────────────────────────────── */
export type SidePos = 'left' | 'right' | 'top' | 'bottom';
export type VertPos = 'top' | 'bottom';
/** Позиция развёрнутого плеера: снизу/сверху лентой, правой панелью или прямо в инфопанели чата. */
export type PlayerPos = VertPos | 'left' | 'right' | 'info';
export type Density = 'compact' | 'cozy' | 'roomy';
/** Вид нижней панели сайдбара на ПК: строка иконок или плашка как на телефоне. */
export type DesktopNavStyle = 'compact' | 'phone';
/** Сторона сообщений в чате: auto — свои справа/чужие слева (как обычно), left/right — все с одной стороны. */
export type MessageAlign = 'auto' | 'left' | 'right';
/** Положение календаря и часов на обоях чата (внешний вид темы). */
export type WallClockPos =
  | 'center' | 'top' | 'bottom'
  | 'topLeft' | 'topRight' | 'middleLeft' | 'middleRight' | 'bottomLeft' | 'bottomRight';
export const WALL_CLOCK_POSITIONS: readonly WallClockPos[] = [
  'center', 'top', 'bottom', 'topLeft', 'topRight', 'middleLeft', 'middleRight', 'bottomLeft', 'bottomRight',
];
/** Неизвестное значение (старая тема, чужой снимок) — по середине, а не пустое место. */
export function normalizeWallClockPos(v: unknown): WallClockPos {
  return WALL_CLOCK_POSITIONS.includes(v as WallClockPos) ? (v as WallClockPos) : 'center';
}
/** Положение раскладывается на две оси: по вертикали и по горизонтали. */
export function wallClockAnchor(pos: WallClockPos): { v: 'top' | 'middle' | 'bottom'; h: 'left' | 'center' | 'right' } {
  const p = normalizeWallClockPos(pos);
  const v = p.startsWith('top') ? 'top' : p.startsWith('bottom') ? 'bottom' : 'middle';
  const h = p.endsWith('Left') ? 'left' : p.endsWith('Right') ? 'right' : 'center';
  return { v, h };
}
/** Где в ленте стоит плашка даты («Сегодня», «10 февраля»). */
export type ChatDateAlign = 'left' | 'center' | 'right';
/** Где стоит дата относительно времени: над ним, под ним, слева или справа. */
export type WallClockDatePos = 'above' | 'below' | 'left' | 'right';
/**
 * Где секунды относительно времени: над ним / под ним / слева / справа, либо
 * углом — сверху слева, сверху справа, снизу слева, снизу справа. Угловые
 * варианты нужны отдельно: в ряду или колонке они выразить нельзя, сдвиг от
 * угла получается диагональным.
 */
export type WallClockSecondsPos =
  | 'above' | 'below' | 'left' | 'right'
  | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
/**
 * Чем рисуются часы на обоях: встроенные цифры, свой HTML-HUD или страница по
 * ссылке. Свой HUD живёт в sandbox-iframe без доступа к приложению.
 */
export type WallClockHudMode = 'builtin' | 'html' | 'url';
/** Лимит своего HTML: весь снимок настроек на сервере ограничен 32 КБ. */
export const WALL_CLOCK_HUD_HTML_MAX = 12000;
export const WALL_CLOCK_HUD_HEIGHT_LIMITS = { min: 60, max: 400 } as const;

/** Пропускает только http(s)-ссылки: javascript:, data: и прочее отбрасываем. */
export function normalizeHudUrl(raw: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export interface LayoutSettings {
  sidebarSide: SidePos;        // left | right
  sidebarWidth: number;        // 72px..50% ширины окна
  mobileNavPos: VertPos;       // bottom | top (нижняя навигация на мобильном)
  desktopNavStyle: DesktopNavStyle; // compact | phone (нижняя панель сайдбара на ПК)
  playerPos: PlayerPos;        // bottom | top | left | right | info: «Слева»/«Справа» — панель у края окна, info — внутри инфопанели чата
  playerWidth: number;         // ширина плеера-панели при боковом playerPos (px)
  chatInfoWidth: number;
  chatHeaderPos: VertPos;      // top | bottom (шапка чата)
  chatInputPos: VertPos;       // bottom | top (поле ввода)
  density: Density;            // плотность отступов
  radius: number;              // 0..28 радиус углов панелей
  chatOuterMargin: number;     // 0..24 внешний отступ окна чата (десктоп)
  bubbleRadius: number;        // 4..28 радиус пузырьков сообщений
  messageMaxWidth: number;     // 35..95 максимальная ширина сообщений (% от ширины чата)
  messageAlign: MessageAlign;  // auto | left | right сторона сообщений
  bubbleEnabled: boolean;
  bubbleTextSize: number;
  bubblePadding: number;
  /** Выравнивание текста по стенке (свои — вправо, чужие — влево). */
  bubbleWallAlign: boolean;
  /** Где в пузыре время и галочки. */
  bubbleMetaPos: BubbleMetaPos;
  showAvatarsInList: boolean;  // аватары в списке чатов
  showTabs: boolean;           // вкладки Диалоги/Архив/Группы
}

export const defaultLayout: LayoutSettings = {
  sidebarSide: 'left',
  sidebarWidth: 300,
  mobileNavPos: 'bottom',
  desktopNavStyle: 'compact',
  playerPos: 'bottom',
  playerWidth: 300,
  chatInfoWidth: 300,
  chatHeaderPos: 'top',
  chatInputPos: 'bottom',
  density: 'cozy',
  radius: 10,
  chatOuterMargin: 8,
  bubbleRadius: 14,
  messageMaxWidth: 72,
  messageAlign: 'auto',
  bubbleEnabled: true,
  bubbleTextSize: 15,
  bubblePadding: 6,
  bubbleWallAlign: false,
  bubbleMetaPos: 'belowLeft',
  showAvatarsInList: true,
  showTabs: true,
};

export interface UserSettingsState {
  // Внешний вид
  brightness: number;              // 0.5 .. 1.5 (CSS filter: brightness)
  textScale: number;               // 0.8 .. 1.6 (CSS var --vera-text-scale)
  /** Размер иконок приложения в px (16..40). Применяется как CSS var --vera-icon-size. */
  iconSize: number;
  language: 'ru' | 'en' | 'uk' | 'es';
  globalFontFamily: string;        // глобальный шрифт для всего приложения
  /** Экспериментальный режим встроенных чатов сторонних сайтов. */
  experimentalExternalSites: boolean;
  /** Экспериментальная кнопка коррекции текущего черновика во всех чатах. */
  languageCorrectionEnabled: boolean;
  /** Показывать объяснение исправлений для глобальной коррекции текста. */
  languageCorrectionExplain: boolean;
  // Обои с календарём и часами поверх фона чата (внешний вид темы)
  /** Размер цифр времени поверх обоев (множитель базового кегля). */
  wallClockTimeScale: number;       // 0.6 .. 1.6
  /** Размер строки даты поверх обоев. */
  wallClockDateScale: number;       // 0.6 .. 1.6
  wallClockEnabled: boolean;       // показывать дату и время на обоях
  wallClockChats: Record<'dialogs' | 'board' | 'groups' | 'channels', boolean>;
  // Отодвигать сообщения, перекрывающие часы: перекрывый набор навязаних пузырает сам, а текст лента остаётся на месте.
  wallClockAvoid: boolean;
  wallClockPos: WallClockPos;      // где на обоях: 3×3 — сверху / по середине / снизу × слева / по центру / справа
  /** Где дата относительно времени: над ним / под ним / слева / справа. */
  wallClockDatePos: WallClockDatePos;
  /** Показывать секунды (по умолчанию выключено — они мелькают и отвлекают). */
  wallClockSeconds: boolean;
  /** Где секунды относительно времени: над ним / под ним / слева / справа. */
  wallClockSecondsPos: WallClockSecondsPos;
  /** Множитель кегля секунд относительно базового. */
  wallClockSecondsScale: number;
  /** Свой HUD вместо встроенных часов (личная настройка, в тему не попадает). */
  wallClockHudMode: WallClockHudMode;
  wallClockHudHtml: string;
  wallClockHudUrl: string;
  /** Высота области HUD в пикселях. */
  wallClockHudHeight: number;
  /** Плашка даты в ленте сообщений: слева / по центру / справа. */
  chatDateAlign: ChatDateAlign;
  /** Форма отправляемых кружков (видеосообщений): круг / квадрат / сердце. */
  roundShape: RoundShape;

  // Данные и экономия трафика
  autoDownloadMedia: boolean;
  compressUploads: boolean;
  streamingHighQuality: boolean;

  // Уведомления
  inAppSounds: boolean;
  inAppVibration: boolean;
  vibrationEnabled: boolean;
  ledIndicator: boolean;
  popupPreview: PreviewMode;
  pinnedPriority: boolean;

  // Истории
  storiesWhoCanView: PrivacyScope;
  storiesWhoCanSave: PrivacyScope;

  // Контактные данные
  requirePhone: boolean;   // требуется ли телефон при регистрации/входе
  requireEmail: boolean;   // требуется ли почта при регистрации/входе

  // Приватность
  lastSeenScope: PrivacyScope;
  profilePhotoScope: PrivacyScope;
  forwardScope: PrivacyScope;
  callsScope: PrivacyScope;
  callsP2P: PrivacyScope;
  groupsInviteScope: PrivacyScope;

  // Безопасность
  appLockEnabled: boolean;
  appLockPasswordHash: string | null;     // SHA-256 hex
  appLockRecoveryEmail: string | null;
  cloudPasswordEnabled: boolean;
  autoDeleteInactiveMonths: AutoDeleteMonths;

  // Layout / раскладка
  layout: LayoutSettings;

  // Actions
  set: <K extends keyof UserSettingsState>(key: K, value: UserSettingsState[K]) => void;
  setLayout: <K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) => void;
  resetLayout: () => void;
  reset: () => void;
}

const initial: Omit<UserSettingsState, 'set' | 'reset' | 'setLayout' | 'resetLayout'> = {
  brightness: 1,
  textScale: 1,
  iconSize: 24,
  language: 'ru',
  globalFontFamily: 'inherit',
  experimentalExternalSites: false,
  languageCorrectionEnabled: false,
  languageCorrectionExplain: false,
  wallClockEnabled: false,
  wallClockChats: { dialogs: true, board: true, groups: true, channels: true },
  wallClockPos: 'center',
  wallClockDatePos: 'above',
  wallClockSeconds: false,
  wallClockSecondsPos: 'below',
  wallClockSecondsScale: 1,
  wallClockAvoid: false,
  wallClockTimeScale: 1,
  wallClockDateScale: 1,
  wallClockHudMode: 'builtin',
  wallClockHudHtml: '',
  wallClockHudUrl: '',
  wallClockHudHeight: 160,
  chatDateAlign: 'center',
  roundShape: 'circle',

  autoDownloadMedia: true,
  compressUploads: true,
  streamingHighQuality: false,

  inAppSounds: true,
  inAppVibration: true,
  vibrationEnabled: true,
  ledIndicator: false,
  popupPreview: 'always',
  pinnedPriority: true,

  storiesWhoCanView: 'contacts',
  storiesWhoCanSave: 'contacts',

  requirePhone: false,
  requireEmail: false,

  lastSeenScope: 'contacts',
  profilePhotoScope: 'everyone',
  forwardScope: 'everyone',
  callsScope: 'everyone',
  callsP2P: 'contacts',
  groupsInviteScope: 'everyone',

  appLockEnabled: false,
  appLockPasswordHash: null,
  appLockRecoveryEmail: null,
  cloudPasswordEnabled: false,
  autoDeleteInactiveMonths: 0,

  layout: { ...defaultLayout },
};

export const useUserSettingsStore = create<UserSettingsState>()(
  persist(
    (set, get) => ({
      ...initial,
      set: (key, value) => set({ [key]: value } as any),
      setLayout: (key, value) => set({ layout: { ...get().layout, [key]:
        key === 'messageMaxWidth' ? clampBubble('maxWidth', Number(value)) :
        key === 'bubbleTextSize' ? clampBubble('textSize', Number(value)) :
        key === 'bubblePadding' ? clampBubble('padding', Number(value)) :
        key === 'bubbleMetaPos' ? normalizeMetaPos(value) :
        key === 'bubbleWallAlign' ? !!value : value } } as any),
      resetLayout: () => set({ layout: { ...defaultLayout } } as any),
      reset: () => set({ ...initial } as any),
    }),
    { name: 'vera-user-settings', version: 4, migrate: (persisted: any, version: number) => {
        if (!persisted) return persisted;
        // v2: добавлены chatOuterMargin и bubbleRadius; merge с defaultLayout на всякий случай
        persisted.layout = { ...defaultLayout, ...(persisted.layout || {}) };
        // v4: время и галочки по умолчанию — отдельной строкой снизу слева.
        // Старый дефолт inlineRight сохранялся у всех, кто не трогал настройку.
        if (version < 4 && persisted.layout.bubbleMetaPos === 'inlineRight') {
          persisted.layout.bubbleMetaPos = 'belowLeft';
        }
        return persisted;
      } }
  )
);

registerAccountStore('user-settings', useUserSettingsStore);

/** Применяет размер иконок к <html> как CSS переменную --vera-icon-size. */
function applyIconSizeToDom(size: number): void {
  try {
    document.documentElement.style.setProperty('--vera-icon-size', `${Math.round(size)}px`);
  } catch {}
}

/** Первичное применение после гидратации persist + отслеживание изменений. */
applyIconSizeToDom(useUserSettingsStore.getState().iconSize);
let _prevIconSize = useUserSettingsStore.getState().iconSize;
useUserSettingsStore.subscribe((state) => {
  if (state.iconSize !== _prevIconSize) {
    _prevIconSize = state.iconSize;
    applyIconSizeToDom(state.iconSize);
  }
});

/** SHA-256 → hex. Используется для хранения пароля app-lock. */
export async function hashPassword(pwd: string): Promise<string> {
  const enc = new TextEncoder().encode(pwd);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ─── Серверная синхронизация ─────────────────────────────────────────────
 * Стратегия: last-write-wins по `__updatedAt`.
 * - hydrate: GET /api/settings; применяем серверный снапшот, только если он
 *   новее локального (или локального нет).
 * - autoSync: subscribe на стор → debounce 800 мс → PUT /api/settings.
 * - live: socket 'settings:updated' от других устройств пользователя
 *   применяется мгновенно (с фильтром по __clientId, чтобы не ловить своё эхо).
 */
const SYNC_KEYS: (keyof UserSettingsState)[] = [
  'brightness', 'textScale', 'language', 'iconSize',
  'experimentalExternalSites', 'languageCorrectionEnabled', 'languageCorrectionExplain',
  'wallClockEnabled', 'wallClockAvoid', 'wallClockPos', 'wallClockDatePos', 'wallClockSeconds', 'wallClockSecondsPos', 'wallClockSecondsScale', 'wallClockTimeScale', 'wallClockDateScale',
  'wallClockHudMode', 'wallClockHudHtml', 'wallClockHudUrl', 'wallClockHudHeight',
  'chatDateAlign', 'roundShape',
  'autoDownloadMedia', 'compressUploads', 'streamingHighQuality',
  'inAppSounds', 'inAppVibration', 'vibrationEnabled', 'ledIndicator',
  'popupPreview', 'pinnedPriority',
  'storiesWhoCanView', 'storiesWhoCanSave',
  'requirePhone', 'requireEmail',
  'lastSeenScope', 'profilePhotoScope', 'forwardScope',
  'callsScope', 'callsP2P', 'groupsInviteScope',
  'appLockEnabled', 'cloudPasswordEnabled', 'autoDeleteInactiveMonths',
  'layout',
];

const LOCAL_UPDATED_KEY = 'vera-settings-updated-at';
/** Версия формата layout в серверном снапшоте (4 — время снизу слева по умолчанию). */
const LAYOUT_VERSION = 4;
const CLIENT_ID_KEY = 'vera-settings-client-id';
let activeSettingsAccountId: string | null = null;
let settingsGeneration = 0;
let settingsSocket: { off?: (event: string, handler?: (...args: any[]) => void) => void } | null = null;
let settingsSocketHandler: ((payload: any) => void) | null = null;

function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto as any).randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function snapshotForSync(s: UserSettingsState) {
  const out: any = {};
  for (const k of SYNC_KEYS) out[k] = (s as any)[k];
  out.__clientId = getClientId();
  // Метка формата layout: снапшоты без неё сохранены до смены дефолта времени.
  out.__layoutVersion = LAYOUT_VERSION;
  return out;
}

function settingsAccountFromStorage(): string | null {
  try {
    const raw = localStorage.getItem('vera_user');
    const user = raw ? JSON.parse(raw) : null;
    return typeof user?.id === 'string' ? user.id : null;
  } catch {
    return null;
  }
}

function settingsRequestIsCurrent(accountId: string, generation: number, token: string): boolean {
  return activeSettingsAccountId === accountId
    && settingsGeneration === generation
    && localStorage.getItem('vera_token') === token
    && settingsAccountFromStorage() === accountId;
}

function applyServerSnapshot(settings: any, accountId: string, generation: number, token: string) {
  if (!settingsRequestIsCurrent(accountId, generation, token)) return;
  const clean: any = {};
  for (const k of SYNC_KEYS) {
    if (settings[k] !== undefined) clean[k] = settings[k];
  }
  if (clean.layout) {
    clean.layout = { ...defaultLayout, ...clean.layout };
    // Старые снапшоты хранят прежний дефолт inlineRight — переводим на belowLeft.
    if (!(Number(settings.__layoutVersion) >= LAYOUT_VERSION) && clean.layout.bubbleMetaPos === 'inlineRight') {
      clean.layout.bubbleMetaPos = 'belowLeft';
    }
  }
  hydrating = true;
  try {
    useUserSettingsStore.setState(clean);
    if (settings.__updatedAt) localStorage.setItem(LOCAL_UPDATED_KEY, settings.__updatedAt);
  } finally {
    hydrating = false;
  }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncStarted = false;
let hydrating = false;

async function apiFetch(path: string, token: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  Object.assign(headers, init.headers || {});
  return fetch(`/api${path}`, { ...init, headers });
}

export async function hydrateSettingsFromServer(): Promise<void> {
  const accountId = activeSettingsAccountId || settingsAccountFromStorage();
  const token = localStorage.getItem('vera_token');
  const generation = settingsGeneration;
  if (!accountId || !token || !settingsRequestIsCurrent(accountId, generation, token)) return;
  try {
    const r = await apiFetch('/settings', token);
    if (!r.ok || !settingsRequestIsCurrent(accountId, generation, token)) return;
    const { settings } = await r.json();
    if (!settings || typeof settings !== 'object' || !settingsRequestIsCurrent(accountId, generation, token)) return;
    const localAt = localStorage.getItem(LOCAL_UPDATED_KEY);
    const serverAt = settings.__updatedAt || null;
    // Если локально уже есть более свежая версия — не перезаписываем, а
    // pushнём её на сервер при первом же изменении (autoSync подхватит).
    if (localAt && serverAt && localAt >= serverAt) return;
    applyServerSnapshot(settings, accountId, generation, token);
  } catch {
    /* offline / не залогинен — ок */
  }
}

export function prepareSettingsForAccount(accountId: string, accountChanged: boolean): void {
  if (activeSettingsAccountId === accountId && !accountChanged) return;
  activeSettingsAccountId = accountId;
  settingsGeneration += 1;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  if (accountChanged) localStorage.removeItem(LOCAL_UPDATED_KEY);
}

export function disableSettingsSync(): void {
  settingsGeneration += 1;
  activeSettingsAccountId = null;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  if (settingsSocket && settingsSocketHandler) settingsSocket.off?.('settings:updated', settingsSocketHandler);
  settingsSocket = null;
  settingsSocketHandler = null;
}

export function startSettingsAutoSync(accountId?: string): void {
  if (accountId) prepareSettingsForAccount(accountId, false);
  if (!syncStarted) useUserSettingsStore.subscribe((state, prev) => {
    if (hydrating) return;
    let changed = false;
    for (const k of SYNC_KEYS) {
      if ((state as any)[k] !== (prev as any)[k]) { changed = true; break; }
    }
    if (!changed || !activeSettingsAccountId) return;
    if (syncTimer) clearTimeout(syncTimer);
    const requestAccountId = activeSettingsAccountId;
    const requestGeneration = settingsGeneration;
    const requestToken = localStorage.getItem('vera_token');
    if (!requestToken) return;
    syncTimer = setTimeout(async () => {
      syncTimer = null;
      if (!settingsRequestIsCurrent(requestAccountId, requestGeneration, requestToken)) return;
      const snapshot = snapshotForSync(useUserSettingsStore.getState());
      try {
        const r = await apiFetch('/settings', requestToken, {
          method: 'PUT',
          body: JSON.stringify({ settings: snapshot }),
        });
        if (r.ok && settingsRequestIsCurrent(requestAccountId, requestGeneration, requestToken)) {
          const { updatedAt } = await r.json();
          if (updatedAt && settingsRequestIsCurrent(requestAccountId, requestGeneration, requestToken)) {
            localStorage.setItem(LOCAL_UPDATED_KEY, updatedAt);
          }
        }
      } catch { /* оффлайн — persist уже сохранил локально */ }
    }, 800);
  });

  syncStarted = true;
  // Живой пуш с других устройств.
  import('../services/socket').then(({ getSocket }) => {
    try {
      const s = getSocket?.();
      if (!s) return;
      if (settingsSocket === s) return;
      if (settingsSocket && settingsSocketHandler) settingsSocket.off?.('settings:updated', settingsSocketHandler);
       const handler = (payload: any) => {
         const accountId = activeSettingsAccountId;
         const token = localStorage.getItem('vera_token');
         const generation = settingsGeneration;
         if (!accountId || !token || !settingsRequestIsCurrent(accountId, generation, token)) return;
        const settings = payload?.settings;
        if (!settings) return;
        // Своё эхо — игнорируем.
        if (settings.__clientId && settings.__clientId === getClientId()) return;
         applyServerSnapshot(settings, accountId, generation, token);
       };
       s.on('settings:updated', handler);
       settingsSocket = s;
       settingsSocketHandler = handler;
    } catch { /* сокет ещё не готов — ок, hydrate возьмёт при следующем логине */ }
  }).catch(() => {});
}


