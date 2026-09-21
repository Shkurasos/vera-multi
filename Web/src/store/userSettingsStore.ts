import { create } from 'zustand';
import { clampBubble } from '../utils/bubbleSettings';
import { persist } from 'zustand/middleware';
import { registerAccountStore } from '../services/storeSyncSimple';

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
export type Density = 'compact' | 'cozy' | 'roomy';
/** Сторона сообщений в чате: auto — свои справа/чужие слева (как обычно), left/right — все с одной стороны. */
export type MessageAlign = 'auto' | 'left' | 'right';

export interface LayoutSettings {
  sidebarSide: SidePos;        // left | right
  sidebarWidth: number;        // 72px..50% ширины окна
  mobileNavPos: VertPos;       // bottom | top (нижняя навигация на мобильном)
  playerPos: VertPos;          // bottom | top (место развёрнутого плеера)
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
  showAvatarsInList: boolean;  // аватары в списке чатов
  showTabs: boolean;           // вкладки Диалоги/Архив/Группы
}

export const defaultLayout: LayoutSettings = {
  sidebarSide: 'left',
  sidebarWidth: 300,
  mobileNavPos: 'bottom',
  playerPos: 'bottom',
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
  showAvatarsInList: true,
  showTabs: true,
};

export interface UserSettingsState {
  // Внешний вид
  brightness: number;              // 0.5 .. 1.5 (CSS filter: brightness)
  textScale: number;               // 0.8 .. 1.6 (CSS var --vera-text-scale)
  language: 'ru' | 'en' | 'uk' | 'es';
  globalFontFamily: string;        // глобальный шрифт для всего приложения

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
  language: 'ru',
  globalFontFamily: 'inherit',

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
        key === 'bubblePadding' ? clampBubble('padding', Number(value)) : value } } as any),
      resetLayout: () => set({ layout: { ...defaultLayout } } as any),
      reset: () => set({ ...initial } as any),
    }),
    { name: 'vera-user-settings', version: 3, migrate: (persisted: any) => {
        if (!persisted) return persisted;
        // v2: добавлены chatOuterMargin и bubbleRadius; merge с defaultLayout на всякий случай
        persisted.layout = { ...defaultLayout, ...(persisted.layout || {}) };
        return persisted;
      } }
  )
);

registerAccountStore('user-settings', useUserSettingsStore);

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
  'brightness', 'textScale', 'language',
  'autoDownloadMedia', 'compressUploads', 'streamingHighQuality',
  'inAppSounds', 'inAppVibration', 'vibrationEnabled', 'ledIndicator',
  'popupPreview', 'pinnedPriority',
  'storiesWhoCanView', 'storiesWhoCanSave',
  'lastSeenScope', 'profilePhotoScope', 'forwardScope',
  'callsScope', 'callsP2P', 'groupsInviteScope',
  'appLockEnabled', 'cloudPasswordEnabled', 'autoDeleteInactiveMonths',
  'layout',
];

const LOCAL_UPDATED_KEY = 'vera-settings-updated-at';
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
  if (clean.layout) clean.layout = { ...defaultLayout, ...clean.layout };
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


