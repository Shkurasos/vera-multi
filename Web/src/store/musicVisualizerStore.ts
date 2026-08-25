import { create } from 'zustand';

export type VisualizerReactiveMode = 'beat' | 'bass' | 'volume' | 'spectrum';
export type VisualizerPlacement = 'bottom' | 'top' | 'sides' | 'full' | 'player';
export type VisualizerStyle = 'glow' | 'bars' | 'pulse' | 'wave';
export type VisualizerTheme = 'custom' | 'neon' | 'fire' | 'ice' | 'matrix' | 'sunset' | 'mono';

export interface MusicVisualizerSettings {
  enabled: boolean;
  color: string;
  secondaryColor: string;
  intensity: number;
  sensitivity: number;
  mode: VisualizerReactiveMode;
  placement: VisualizerPlacement;
  style: VisualizerStyle;
  theme: VisualizerTheme;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  waveLength: number;
  glowSize: number;
}

export const defaultVisualizerSettings: MusicVisualizerSettings = {
  enabled: false,
  color: '#7C6AF7',
  secondaryColor: '#00E5FF',
  intensity: 0.75,
  sensitivity: 1.15,
  mode: 'bass',
  placement: 'bottom',
  style: 'glow',
  theme: 'neon',
  opacity: 0.75,
  x: 50,
  y: 88,
  width: 100,
  height: 130,
  waveLength: 100,
  glowSize: 100,
};

export const visualizerThemes: Record<VisualizerTheme, { label: string; color: string; secondaryColor: string }> = {
  custom: { label: 'Своя', color: '#7C6AF7', secondaryColor: '#00E5FF' },
  neon: { label: 'Неон', color: '#7C6AF7', secondaryColor: '#00E5FF' },
  fire: { label: 'Огонь', color: '#FF3D00', secondaryColor: '#FFD600' },
  ice: { label: 'Лёд', color: '#00E5FF', secondaryColor: '#B388FF' },
  matrix: { label: 'Матрица', color: '#00E676', secondaryColor: '#64FFDA' },
  sunset: { label: 'Закат', color: '#FF4081', secondaryColor: '#FFAB40' },
  mono: { label: 'Белая', color: '#FFFFFF', secondaryColor: '#BDBDBD' },
};

type Scope = 'track' | 'playlist';
const key = (scope: Scope, id: string) => `${scope}:${id}`;
const storageKey = 'vera.musicVisualizerSettings.v1';

function loadMap(): Record<string, MusicVisualizerSettings> {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
}
function saveMap(map: Record<string, MusicVisualizerSettings>) {
  try { localStorage.setItem(storageKey, JSON.stringify(map)); } catch {}
}

interface VisualizerState {
  settings: Record<string, MusicVisualizerSettings>;
  systemAudioReactive: boolean;
  getSettings: (scope: Scope, id?: string | null) => MusicVisualizerSettings;
  setSettings: (scope: Scope, id: string, patch: Partial<MusicVisualizerSettings>) => void;
  setSystemAudioReactive: (v: boolean) => void;
}

const systemAudioKey = 'vera.musicVisualizer.systemAudio';

export const useMusicVisualizerStore = create<VisualizerState>((set, get) => ({
  settings: loadMap(),
  systemAudioReactive: localStorage.getItem(systemAudioKey) === '1',
  getSettings: (scope, id) => {
    if (!id) return defaultVisualizerSettings;
    return { ...defaultVisualizerSettings, ...(get().settings[key(scope, id)] || {}) };
  },
  setSettings: (scope, id, patch) => set((state) => {
    const k = key(scope, id);
    const next = { ...state.settings, [k]: { ...defaultVisualizerSettings, ...(state.settings[k] || {}), ...patch } };
    saveMap(next);
    return { settings: next };
  }),
  setSystemAudioReactive: (v) => {
    try { localStorage.setItem(systemAudioKey, v ? '1' : '0'); } catch {}
    set({ systemAudioReactive: v });
  },
}));
