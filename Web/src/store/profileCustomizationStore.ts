import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

/**
 * Кастомизация профиля в стиле Steam:
 *   - Баннер (URL/data-URL картинки или градиент через bannerColor).
 *   - Акцентный цвет карточки, прозрачность.
 *   - Витрина (showcase): свободный текст, который отображается блоком
 *     под инфо-карточкой (любимая цитата, «шоу-кейс» достижений и т.п.).
 *   - Статус активности «как в Discord»: kind + text.
 *     'auto' — берётся из плеера музыки (currentTrack).
 *     'playing' | 'watching' | 'listening' | 'custom' — ручной ввод.
 *     'off' — не показывать.
 */

export type ActivityKind = 'off' | 'auto' | 'playing' | 'watching' | 'listening' | 'custom';

export interface ProfileCustomization {
  bannerUrl: string;               // data-URL / http(s) URL; '' = градиент из bannerColor
  bannerColor: string;             // hex, база градиента, когда нет картинки
  cardAccent: string;              // hex, акцент карточки (иначе берётся theme.accent)
  cardOpacity: number;             // 0..1 — прозрачность фона карточки
  showcase: string;                // произвольный текст витрины (multi-line)
  activityKind: ActivityKind;
  activityText: string;            // текст, когда activityKind !== 'auto'/'off'
}

interface ProfileCustomizationState extends ProfileCustomization {
  set: <K extends keyof ProfileCustomization>(key: K, value: ProfileCustomization[K]) => void;
  reset: () => void;
}

const initial: ProfileCustomization = {
  bannerUrl: '',
  bannerColor: '#3a4a6b',
  cardAccent: '',
  cardOpacity: 0.72,
  showcase: '',
  activityKind: 'auto',
  activityText: '',
};

export const useProfileCustomizationStore = create<ProfileCustomizationState>()(
  persist(
    (set) => ({
      ...initial,
      set: (key, value) => set({ [key]: value } as any),
      reset: () => set({ ...initial } as any),
    }),
    { name: 'vera-profile-customization' }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('profile-customization', useProfileCustomizationStore);
}
