/**
 * Пресеты настроек встроенных тем.
 *
 * Каждая тема приходит не «голой палитрой», а готовым набором: базовый фон,
 * шрифт, стиль иконок, форма чатов, набор анимаций, яркость/масштаб текста
 * и раскладка интерфейса. Всё это лежит в `ThemeSettings` и применяется при
 * переключении темы (applyThemeSettings), поэтому тема меняет не только
 * цвета, а весь характер интерфейса.
 *
 * Пересборка пресетов безопасна: правки пользователя хранятся в
 * `settingsByTheme` и не перетираются — пресет засеивает тему только при
 * ПЕРВОМ её посещении (см. takeThemeSettings в themeStore).
 */
import type { ThemeSettings } from './themeStore';

/** Локальные id фонов — короче и читается в таблице пресетов. */
export const W = {
  // Фотографии-стоки (public/wallpapers/*.jpg) и авторские варианты,
  // подобранные под характер конкретных тем.
  photoDoodleChat: 'base-photo-doodle-chat',
  photoFormulas: 'base-photo-formulas',
  photoTriangles: 'base-photo-pastel-triangles',
  photoBlueBubbles: 'base-photo-blue-bubbles',
  photoBlackWaves: 'base-photo-black-waves',
  photoTealIcons: 'base-photo-teal-icons',
  photoRedIcons: 'base-photo-red-icons',
  photoSketch: 'base-photo-sketch-66',
  photoScribble: 'base-photo-doodle-scribble',
  photoSocial: 'base-photo-social-icons',
  photoPlane: 'base-photo-paper-plane',
  photoPastelWaves: 'base-photo-pastel-waves',
  deepNight: 'base-deep-night',
  indigoGold: 'base-indigo-gold',
  cherryNight: 'base-cherry-night',
  lavenderDream: 'base-lavender-dream',
  oceanDepth: 'base-ocean-depth',
  sandShore: 'base-sand-shore',
  smokyRose: 'base-smoky-rose',
  jadeDark: 'base-jade-dark',
  emeraldNight: 'base-emerald-night',
  cosmicVelvet: 'base-cosmic-velvet',
  coralBranch: 'base-coral-branch',
  paperCream: 'base-paper-cream',
  mistSilver: 'base-mist-silver',
  neonMagenta: 'base-neon-magenta',
  chalkCrimson: 'base-chalk-crimson',
  abyssIce: 'base-abyss-ice',
  goldVault: 'base-gold-vault',
  vkBlue: 'base-vk-blue',
  xInk: 'base-x-ink',
  fbLight: 'base-fb-light',
  discordBlurple: 'base-discord-blurple',
  tgNight: 'base-tg-night',
  // Фото, загруженные админом и сжатые до 1920px (см. public/wallpapers).
  // Стоки, а не ссылки на строки БД: тема не должна рассыпаться после
  // сброса диска сервера.
  photoVd: 'base-photo-vd',
  photoSakura: 'base-photo-sakura',
  photoO: 'base-photo-o',
  photoGorod: 'base-photo-gorod',
  photoPrikoolnyy: 'base-photo-prikoolnyy',
  photoZnaki: 'base-photo-znaki',
  photoVasap: 'base-photo-vasap',
  photoLiving: 'base-photo-living',
  photoNightgame: 'base-photo-nightgame',
  photoSeredchki: 'base-photo-seredchki',
} as const;

type Preset = ThemeSettings;

/**
 * Вход пресета — те же группы, но с ЧАСТИЧНЫМИ полями: недостающие значения
 * подставляются дефолтами сторов прямо здесь. Поэтому в таблице видно только
 * отличия темы, а не полные копии всех настроек.
 */
type PresetInput = {
  wallpaper?: Partial<NonNullable<ThemeSettings['wallpaper']>>;
  ui?: Partial<NonNullable<ThemeSettings['ui']>>;
  animations?: ThemeSettings['animations'];
  appearance?: Partial<NonNullable<ThemeSettings['appearance']>>;
  layout?: ThemeSettings['layout'];
  sound?: ThemeSettings['sound'];
};

/** Заготовка пресета: базовый фон + осознанный набор «характера» темы. */
function preset(p: PresetInput): Preset {
  return {
    wallpaper: { stockId: 'none', brightness: 0.65, ...p.wallpaper },
    ui: {
      iconPack: 'filled', uiStyle: 'default', chatShape: 'vera',
      chatBorder: true, chatFill: true, ...p.ui,
    },
    appearance: { brightness: 1, textScale: 1, globalFontFamily: 'inherit', ...p.appearance },
    ...(p.animations ? { animations: p.animations } : {}),
    ...(p.layout ? { layout: p.layout } : {}),
    ...(p.sound ? { sound: p.sound } : {}),
  };
}

/**
 * Пресеты по id темы. Здесь решается, какой базовый фон «родной» для каждой
 * темы и насколько он приглушён (brightness), а также её характер: стиль
 * иконок и панелей, форма карточек, плотность, радиусы и анимации.
 */
export const THEME_PRESETS: Record<number, Preset> = {
  0: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'glass', iconPack: 'filled', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: 'inherit', wallClock: { enabled: true, pos: 'top', datePos: 'above', seconds: true, secondsPos: 'below', secondsScale: 0.8, timeScale: 0.9, dateScale: 0.85 } },
    layout: { density: 'cozy', radius: 12, bubbleRadius: 16, showTabs: true, showAvatarsInList: true },
  }),
  1: preset({
    wallpaper: { stockId: W.photoGorod, brightness: 0.9},
    ui: { uiStyle: 'glass', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: "'Inter', sans-serif", wallClock: { enabled: true, pos: 'bottom', datePos: 'above', seconds: false, secondsPos: 'below', secondsScale: 1, timeScale: 1, dateScale: 0.9 } },
    layout: { density: 'cozy', radius: 14, bubbleRadius: 16, showTabs: true, showAvatarsInList: true },
  }),
  3: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'rounded', iconPack: 'rounded', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { brightness: 1.1, textScale: 1.02, globalFontFamily: 'inherit' },
    layout: { density: 'roomy', radius: 20, bubbleRadius: 22, messageMaxWidth: 68, showTabs: true, showAvatarsInList: true },
  }),
  4: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'glass', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'cozy', radius: 10, bubbleRadius: 14, showTabs: true, showAvatarsInList: true },
  }),
  5: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'filled', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'cozy', radius: 14, bubbleRadius: 16, showTabs: true, showAvatarsInList: true },
  }),
  6: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'rounded', iconPack: 'twoTone', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'roomy', radius: 18, bubbleRadius: 20, showTabs: true, showAvatarsInList: true },
  }),
  7: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'glass', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { brightness: 0.95, globalFontFamily: 'inherit', wallClock: { enabled: true, pos: 'top', datePos: 'left', seconds: true, secondsPos: 'topLeft', secondsScale: 0.75, timeScale: 1.2, dateScale: 0.9 } },
    layout: { density: 'cozy', radius: 16, bubbleRadius: 18, showTabs: true, showAvatarsInList: true },
  }),
  8: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'rounded', iconPack: 'sharp', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { brightness: 1.12, textScale: 1.02, globalFontFamily: 'inherit' },
    layout: { density: 'cozy', radius: 6, bubbleRadius: 8, showTabs: true, showAvatarsInList: true },
  }),
  9: preset({
    wallpaper: { stockId: W.photoSakura, brightness: 0.95},
    ui: { uiStyle: 'rounded', iconPack: 'rounded', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { brightness: 1.02, globalFontFamily: 'inherit' },
    layout: { density: 'cozy', radius: 18, bubbleRadius: 20, showTabs: true, showAvatarsInList: true },
  }),
  10: preset({
    wallpaper: { stockId: W.photoVasap, brightness: 0.95},
    ui: { uiStyle: 'flat', iconPack: 'rounded', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'cozy', radius: 12, bubbleRadius: 16, showTabs: true, showAvatarsInList: true },
  }),
  12: preset({
    wallpaper: { stockId: W.photoSeredchki, brightness: 0.8},
    ui: { uiStyle: 'default', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { brightness: 0.95, globalFontFamily: 'inherit', wallClock: { enabled: true, pos: 'top', datePos: 'above', seconds: false, secondsPos: 'below', secondsScale: 1, timeScale: 1, dateScale: 0.95 } },
    layout: { density: 'cozy', radius: 10, bubbleRadius: 14, showTabs: true, showAvatarsInList: true },
  }),
  13: preset({
    wallpaper: { stockId: W.photoLiving, brightness: 1},
    ui: { uiStyle: 'glass', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: 'inherit', wallClock: { enabled: true, pos: 'bottom', datePos: 'below', seconds: true, secondsPos: 'bottomRight', secondsScale: 0.8, timeScale: 1.15, dateScale: 0.85 } },
    layout: { density: 'cozy', radius: 16, bubbleRadius: 18, showTabs: true, showAvatarsInList: true },
  }),
  15: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'rounded', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'cozy', radius: 14, bubbleRadius: 18, showTabs: true, showAvatarsInList: true },
  }),
  16: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { brightness: 1.08, globalFontFamily: 'inherit' },
    layout: { density: 'compact', radius: 8, bubbleRadius: 14, showTabs: true, showAvatarsInList: true },
  }),
  18: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'rounded', iconPack: 'twoTone', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'roomy', radius: 20, bubbleRadius: 22, showTabs: true, showAvatarsInList: true },
  }),
  19: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'glass', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'cozy', radius: 14, bubbleRadius: 18, showTabs: true, showAvatarsInList: true },
  }),
  21: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'filled', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: 'inherit', wallClock: { enabled: true, pos: 'top', datePos: 'right', seconds: true, secondsPos: 'topRight', secondsScale: 0.7, timeScale: 1.1, dateScale: 0.9 } },
    layout: { density: 'cozy', radius: 12, bubbleRadius: 16, showTabs: true, showAvatarsInList: true },
  }),
  22: preset({
    wallpaper: { stockId: W.photoPrikoolnyy, brightness: 1},
    ui: { uiStyle: 'rounded', iconPack: 'filled', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'roomy', radius: 18, bubbleRadius: 22, messageMaxWidth: 70, showTabs: true, showAvatarsInList: true },
  }),
  23: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { brightness: 0.95, globalFontFamily: 'inherit' },
    layout: { density: 'compact', radius: 8, bubbleRadius: 12, showTabs: true, showAvatarsInList: true },
  }),
  24: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'glass', iconPack: 'twoTone', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: 'inherit', wallClock: { enabled: true, pos: 'bottom', datePos: 'above', seconds: true, secondsPos: 'bottomLeft', secondsScale: 1, timeScale: 1, dateScale: 0.95 } },
    layout: { density: 'cozy', radius: 14, bubbleRadius: 16, showTabs: true, showAvatarsInList: true },
  }),
  25: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'filled', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'cozy', radius: 16, bubbleRadius: 18, showTabs: true, showAvatarsInList: true },
  }),
  26: preset({
    wallpaper: { stockId: W.photoVd, brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'sharp', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'compact', radius: 6, bubbleRadius: 10, showTabs: true, showAvatarsInList: true },
  }),
  27: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'rounded', iconPack: 'twoTone', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'cozy', radius: 18, bubbleRadius: 20, showTabs: true, showAvatarsInList: true },
  }),
  28: preset({
    wallpaper: { stockId: W.photoNightgame, brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'sharp', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: "'JetBrains Mono', monospace" },
    layout: { density: 'compact', radius: 4, bubbleRadius: 6, messageMaxWidth: 76, showTabs: true, showAvatarsInList: true },
  }),
  29: preset({
    wallpaper: { stockId: W.photoZnaki, brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: "'Source Code Pro', monospace" },
    layout: { density: 'compact', radius: 4, bubbleRadius: 8, messageMaxWidth: 74, showTabs: true, showAvatarsInList: true },
  }),
  30: preset({
    wallpaper: { stockId: W.photoO, brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'sharp', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: "'Source Code Pro', monospace", wallClock: { enabled: true, pos: 'top', datePos: 'above', seconds: true, secondsPos: 'below', secondsScale: 0.85, timeScale: 0.95, dateScale: 0.85 } },
    layout: { density: 'compact', radius: 0, bubbleRadius: 4, messageMaxWidth: 78, showAvatarsInList: false, showTabs: true },
  }),
  31: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'filled', chatShape: 'telegram', chatBorder: false, chatFill: false },
    appearance: { globalFontFamily: "'Inter', sans-serif" },
    layout: { density: 'compact', radius: 6, bubbleRadius: 14, messageMaxWidth: 74, showTabs: false, showAvatarsInList: false },
  }),
  32: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'filled', chatShape: 'vk', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: "'Inter', sans-serif" },
    layout: { density: 'compact', radius: 8, bubbleRadius: 12, messageMaxWidth: 76, showTabs: true, showAvatarsInList: true },
  }),
  33: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: "'Inter', sans-serif" },
    layout: { density: 'compact', radius: 4, bubbleRadius: 10, messageMaxWidth: 72, showTabs: true, showAvatarsInList: true },
  }),
  34: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'default', iconPack: 'filled', chatShape: 'telegram', chatBorder: false, chatFill: false },
    appearance: { globalFontFamily: "'Inter', sans-serif" },
    layout: { density: 'compact', radius: 6, bubbleRadius: 14, messageMaxWidth: 74, showTabs: false, showAvatarsInList: false },
  }),
  35: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'filled', chatShape: 'telegram', chatBorder: false, chatFill: false },
    appearance: { globalFontFamily: "'Inter', sans-serif" },
    layout: { density: 'compact', radius: 8, bubbleRadius: 16, messageMaxWidth: 76, showTabs: false, showAvatarsInList: false },
  }),
  36: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'filled', chatShape: 'telegram', chatBorder: false, chatFill: false },
    appearance: { globalFontFamily: "'Inter', sans-serif" },
    layout: { density: 'compact', radius: 6, bubbleRadius: 14, messageMaxWidth: 74, showTabs: false, showAvatarsInList: false },
  }),
  100: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'glass', iconPack: 'outlined', chatShape: 'vera', chatBorder: true, chatFill: true },
    appearance: { globalFontFamily: "'Inter', sans-serif" },
    layout: { density: 'cozy', radius: 12, bubbleRadius: 16, showTabs: true, showAvatarsInList: true },
  }),
  101: preset({
    wallpaper: { stockId: 'none', brightness: 1},
    ui: { uiStyle: 'flat', iconPack: 'rounded', chatShape: 'vera', chatBorder: true, chatFill: true },
    layout: { density: 'compact', radius: 8, bubbleRadius: 12, showTabs: true, showAvatarsInList: true },
  }),
};

export function themePreset(id: number): ThemeSettings | undefined {
  return THEME_PRESETS[id];
}
