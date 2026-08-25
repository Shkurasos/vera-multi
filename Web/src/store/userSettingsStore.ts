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

  // Actions
  set: <K extends keyof UserSettingsState>(key: K, value: UserSettingsState[K]) => void;
  reset: () => void;
}

const initial: Omit<UserSettingsState, 'set' | 'reset'> = {
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
};

export const useUserSettingsStore = create<UserSettingsState>()(
  persist(
    (set) => ({
      ...initial,
      set: (key, value) => set({ [key]: value } as any),
      reset: () => set({ ...initial } as any),
    }),
    { name: 'vera-user-settings' }
  )
);

/** SHA-256 → hex. Используется для хранения пароля app-lock. */
export async function hashPassword(pwd: string): Promise<string> {
  const enc = new TextEncoder().encode(pwd);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
