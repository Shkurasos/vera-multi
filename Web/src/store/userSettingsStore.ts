import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

export interface LayoutSettings {
  sidebarSide: SidePos;        // left | right
  sidebarWidth: number;        // 200..520
  mobileNavPos: VertPos;       // bottom | top (нижняя навигация на мобильном)
  playerPos: VertPos;          // bottom | top (место развёрнутого плеера)
  chatHeaderPos: VertPos;      // top | bottom (шапка чата)
  chatInputPos: VertPos;       // bottom | top (поле ввода)
  density: Density;            // плотность отступов
  radius: number;              // 0..28 радиус углов панелей
  chatOuterMargin: number;     // 0..24 внешний отступ окна чата (десктоп)
  bubbleRadius: number;        // 4..28 радиус пузырьков сообщений
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
  showAvatarsInList: true,
  showTabs: true,
};

export interface UserSettingsState {
  // Внешний вид
  brightness: number;              // 0.5 .. 1.5 (CSS filter: brightness)
  textScale: number;               // 0.8 .. 1.6 (CSS var --vera-text-scale)
  language: 'ru' | 'en' | 'uk' | 'es';

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
      setLayout: (key, value) => set({ layout: { ...get().layout, [key]: value } } as any),
      resetLayout: () => set({ layout: { ...defaultLayout } } as any),
      reset: () => set({ ...initial } as any),
    }),
    { name: 'vera-user-settings', version: 2, migrate: (persisted: any) => {
        if (!persisted) return persisted;
        // v2: добавлены chatOuterMargin и bubbleRadius; merge с defaultLayout на всякий случай
        persisted.layout = { ...defaultLayout, ...(persisted.layout || {}) };
        return persisted;
      } }
  )
);

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

function applyServerSnapshot(settings: any) {
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

async function apiFetch(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem('vera_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, init.headers || {});
  return fetch(`/api${path}`, { ...init, headers });
}

export async function hydrateSettingsFromServer(): Promise<void> {
  try {
    const r = await apiFetch('/settings');
    if (!r.ok) return;
    const { settings } = await r.json();
    if (!settings || typeof settings !== 'object') return;
    const localAt = localStorage.getItem(LOCAL_UPDATED_KEY);
    const serverAt = settings.__updatedAt || null;
    // Если локально уже есть более свежая версия — не перезаписываем, а
    // pushнём её на сервер при первом же изменении (autoSync подхватит).
    if (localAt && serverAt && localAt >= serverAt) return;
    applyServerSnapshot(settings);
  } catch {
    /* offline / не залогинен — ок */
  }
}

export function startSettingsAutoSync(): void {
  if (syncStarted) return;
  syncStarted = true;

  useUserSettingsStore.subscribe((state, prev) => {
    if (hydrating) return;
    let changed = false;
    for (const k of SYNC_KEYS) {
      if ((state as any)[k] !== (prev as any)[k]) { changed = true; break; }
    }
    if (!changed) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const snapshot = snapshotForSync(useUserSettingsStore.getState());
      try {
        const r = await apiFetch('/settings', {
          method: 'PUT',
          body: JSON.stringify({ settings: snapshot }),
        });
        if (r.ok) {
          const { updatedAt } = await r.json();
          if (updatedAt) localStorage.setItem(LOCAL_UPDATED_KEY, updatedAt);
        }
      } catch { /* оффлайн — persist уже сохранил локально */ }
    }, 800);
  });

  // Живой пуш с других устройств.
  import('../services/socket').then(({ getSocket }) => {
    try {
      const s = getSocket?.();
      if (!s) return;
      s.on('settings:updated', (payload: any) => {
        const settings = payload?.settings;
        if (!settings) return;
        // Своё эхо — игнорируем.
        if (settings.__clientId && settings.__clientId === getClientId()) return;
        applyServerSnapshot(settings);
      });
    } catch { /* сокет ещё не готов — ок, hydrate возьмёт при следующем логине */ }
  }).catch(() => {});
}


