/**
 * Стили редкости для обводки аватара и плашки своих сообщений.
 * 21 редкость реализована через чистый CSS (border, box-shadow, clip-path,
 * градиенты, image-rendering: pixelated для 8-bit «Культовой»).
 */

export type RarityTier =
  | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  | 'mythic' | 'divine' | 'transcendent' | 'absolute' | 'exclusive'
  | 'crystal' | 'plasma' | 'digital' | 'relic' | 'holo'
  | 'mechanic' | 'royal' | 'anomaly' | 'core' | 'infinity' | 'cult';

export interface RarityMeta {
  id: RarityTier;
  label: string;
  codename: string;
  order: number;
  color: string;
  price: number;
}

export const RARITY_META: Record<RarityTier, RarityMeta> = {
  common:       { id: 'common',       label: 'Обычная',        codename: 'Clean',       order: 1,  color: '#9AA3AD', price: 40 },
  uncommon:     { id: 'uncommon',     label: 'Необычная',      codename: 'Neon Line',   order: 2,  color: '#4CE07A', price: 90 },
  rare:         { id: 'rare',         label: 'Редкая',         codename: 'Tech',        order: 3,  color: '#4DA6FF', price: 160 },
  epic:         { id: 'epic',         label: 'Эпическая',      codename: 'Energy',      order: 4,  color: '#B96BFF', price: 260 },
  legendary:    { id: 'legendary',    label: 'Легендарная',    codename: 'Crown',       order: 5,  color: '#FFB84D', price: 400 },
  mythic:       { id: 'mythic',       label: 'Мифическая',     codename: 'Void',        order: 6,  color: '#FF4D80', price: 600 },
  divine:       { id: 'divine',       label: 'Божественная',   codename: 'Halo',        order: 7,  color: '#F5E6A8', price: 850 },
  transcendent: { id: 'transcendent', label: 'Запредельная',   codename: 'Glitch',      order: 8,  color: '#00FFC6', price: 1150 },
  absolute:     { id: 'absolute',     label: 'Абсолютная',     codename: 'Singularity', order: 9,  color: '#7B61FF', price: 1500 },
  exclusive:    { id: 'exclusive',    label: 'Эксклюзивная',   codename: 'Artifact',    order: 10, color: '#FF7A00', price: 1900 },
  crystal:      { id: 'crystal',      label: 'Кристальная',    codename: 'Crystal',     order: 11, color: '#66E0FF', price: 2350 },
  plasma:       { id: 'plasma',       label: 'Плазменная',     codename: 'Plasma',      order: 12, color: '#FF3CAC', price: 2850 },
  digital:      { id: 'digital',      label: 'Цифровая',       codename: 'Data',        order: 13, color: '#00E5A0', price: 3400 },
  relic:        { id: 'relic',        label: 'Реликтовая',     codename: 'Relic',       order: 14, color: '#C8A96A', price: 4000 },
  holo:         { id: 'holo',         label: 'Голографическая', codename: 'Holo',       order: 15, color: '#BAF0FF', price: 4650 },
  mechanic:     { id: 'mechanic',     label: 'Механическая',   codename: 'Mechanic',    order: 16, color: '#8FA1B5', price: 5350 },
  royal:        { id: 'royal',        label: 'Королевская',    codename: 'Royal',       order: 17, color: '#E8C547', price: 6100 },
  anomaly:      { id: 'anomaly',      label: 'Аномальная',     codename: 'Anomaly',     order: 18, color: '#FF2E63', price: 6900 },
  core:         { id: 'core',         label: 'Сингулярная',    codename: 'Core',        order: 19, color: '#00D0FF', price: 7750 },
  infinity:     { id: 'infinity',     label: 'Бесконечная',    codename: 'Infinity',    order: 20, color: '#FFFFFF', price: 8650 },
  cult:         { id: 'cult',         label: 'Культовая',      codename: '8-bit',       order: 21, color: '#F8E71C', price: 12000 },
};

export const RARITY_ORDER: RarityTier[] = (Object.values(RARITY_META) as RarityMeta[])
  .sort((a, b) => a.order - b.order)
  .map((r) => r.id);

export const RARITY_KEYFRAMES = `
@keyframes veraRarityPulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }
@keyframes veraRaritySpin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;


export function buildRingSx(rarity: RarityTier, accent: string, active = false): Record<string, any> {
  const c = RARITY_META[rarity].color;
  const base: Record<string, any> = {
    border: `2px solid transparent`,
    boxShadow: active ? `0 0 0 2px ${accent}55` : undefined,
    transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
  };
  switch (rarity) {
    case 'common':       return { ...base, border: `2px solid ${c}`, borderRadius: '50%' };
    case 'uncommon':     return { ...base, border: `1px solid ${c}`, boxShadow: `0 0 0 3px ${c}CC, 0 0 8px ${c}55` };
    case 'rare':         return { ...base, border: `2px solid ${c}`, boxShadow: `inset 0 0 0 1px ${c}AA, 0 0 10px ${c}66` };
    case 'epic':         return { ...base, border: `2px solid ${c}`, boxShadow: `0 0 14px ${c}, 0 0 28px ${c}55`, animation: 'veraRarityPulse 2.6s ease-in-out infinite' };
    case 'legendary':    return { ...base, border: `3px solid ${c}`, boxShadow: `0 0 20px ${c}AA, 0 0 40px ${c}44` };
    case 'mythic':       return { ...base, border: `3px solid #0a0a12`, boxShadow: `inset 0 0 0 1px ${c}, 0 0 18px ${c}AA` };
    case 'divine':       return { ...base, border: `2px solid ${c}`, boxShadow: `0 0 0 5px ${c}88, 0 0 0 9px ${c}44, 0 0 24px ${c}AA` };
    case 'transcendent': return { ...base, border: `2px solid ${c}`, boxShadow: `2px 0 0 ${c}AA, -2px 0 0 #ff00c8AA, 0 0 12px ${c}88` };
    case 'absolute':     return { ...base, border: `1px solid ${c}CC`, boxShadow: `0 0 0 4px ${c}66, 0 0 0 8px ${c}33, 0 0 16px ${c}AA`, animation: 'veraRaritySpin 8s linear infinite' };
    case 'exclusive':    return { ...base, borderTop: `3px solid ${c}`, borderRight: `2px solid #C0C0C0`, borderBottom: `3px solid ${c}88`, borderLeft: `2px solid #C0C0C0AA`, boxShadow: `0 -4px 12px ${c}77, 4px 0 12px #C0C0C077, 0 4px 12px ${c}55` };
    case 'crystal':      return { ...base, border: `2px solid ${c}`, clipPath: 'polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%)', boxShadow: `0 0 12px ${c}AA` };
    case 'plasma':       return { ...base, border: '3px solid transparent', backgroundImage: `linear-gradient(#0000, #0000), linear-gradient(90deg, ${c}, #ff8ac0, ${c})`, backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box', boxShadow: `0 0 18px ${c}AA`, animation: 'veraRarityPulse 1.8s ease-in-out infinite' };
    case 'digital':      return { ...base, border: `2px dashed ${c}`, boxShadow: `0 0 10px ${c}AA, inset 0 0 6px ${c}44` };
    case 'relic':        return { ...base, border: `4px double ${c}`, boxShadow: `inset 0 0 4px #00000088, 0 2px 6px #00000066, 0 0 10px ${c}66` };
    case 'holo':         return { ...base, border: `2px solid ${c}88`, boxShadow: `0 0 0 3px #ff77ff44, 0 0 0 6px #77ffff44, 0 0 20px ${c}88` };
    case 'mechanic':     return { ...base, border: `3px dotted ${c}`, boxShadow: `inset 0 0 0 1px #0006, 0 0 8px ${c}77` };
    case 'royal':        return { ...base, border: `3px solid ${c}`, boxShadow: `-12px 0 12px -6px ${c}AA, 12px 0 12px -6px ${c}AA, 0 0 20px ${c}88` };
    case 'anomaly':      return { ...base, border: `2px solid ${c}`, borderRadius: '50% 30% 50% 40%', boxShadow: `0 0 14px ${c}AA, inset 0 0 6px ${c}55` };
    case 'core':         return { ...base, border: `2px solid ${c}`, boxShadow: `0 0 0 4px ${c}77, 0 0 0 8px ${c}44, 0 0 22px ${c}CC`, animation: 'veraRarityPulse 2s ease-in-out infinite' };
    case 'infinity':     return { ...base, border: `2px solid #FFF`, boxShadow: `0 0 0 4px #ff4870AA, 0 0 0 7px #4dd0ffAA, 0 0 24px #FFFFFFAA` };
    case 'cult':         return { ...base, border: `2px solid ${c}`, borderRadius: 0, imageRendering: 'pixelated', boxShadow: `2px 0 0 ${c}, -2px 0 0 ${c}, 0 2px 0 ${c}, 0 -2px 0 ${c}, 4px 0 0 #000, -4px 0 0 #000, 0 4px 0 #000, 0 -4px 0 #000` };
  }
}


export function buildPlaqueSx(rarity: RarityTier, accent?: string): Record<string, any> {
  // Цвет плашки всегда следует акценту активной темы; форма — от редкости.
  // Фиксированный цвет редкости используется только как fallback.
  const c = accent || RARITY_META[rarity].color;
  const base: Record<string, any> = {
    fontSize: 11, lineHeight: 1, px: 0.8, py: 0.4, borderRadius: 1,
    color: '#fff', fontWeight: 700, letterSpacing: 0.4,
    textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 0.4,
  };
  switch (rarity) {
    case 'common':       return { ...base, bgcolor: '#2a2f36', color: '#DDD', border: `1px solid ${c}` };
    case 'uncommon':     return { ...base, bgcolor: '#0006', border: `1px solid ${c}`, boxShadow: `inset 0 0 4px ${c}66` };
    case 'rare':         return { ...base, bgcolor: '#0d1a2b', border: `1px solid ${c}`, borderLeft: `3px solid ${c}`, boxShadow: `0 0 6px ${c}66` };
    case 'epic':         return { ...base, background: `linear-gradient(90deg, ${c}33, ${c}11)`, border: `1px solid ${c}`, boxShadow: `0 0 8px ${c}88` };
    case 'legendary':    return { ...base, background: `linear-gradient(90deg, ${c}, #FFD98A)`, color: '#3a2b00', boxShadow: `0 0 10px ${c}AA` };
    case 'mythic':       return { ...base, bgcolor: '#0a0a12', border: `1px solid ${c}`, boxShadow: `inset 0 0 6px ${c}88, 0 0 8px ${c}55` };
    case 'divine':       return { ...base, bgcolor: '#fffbea', color: '#665500', border: `1px solid ${c}`, boxShadow: `0 0 10px ${c}` };
    case 'transcendent': return { ...base, bgcolor: '#000', color: c, border: `1px solid ${c}`, textShadow: `2px 0 #ff00c8, -2px 0 #00ffff` };
    case 'absolute':     return { ...base, bgcolor: '#100a20', border: `1px solid ${c}`, clipPath: 'polygon(8% 0, 92% 0, 100% 50%, 92% 100%, 8% 100%, 0 50%)', px: 1.4, boxShadow: `0 0 10px ${c}88` };
    case 'exclusive':    return { ...base, background: `linear-gradient(135deg, #C0C0C0, ${c})`, color: '#2a1500', border: `1px solid ${c}`, boxShadow: `0 0 8px ${c}` };
    case 'crystal':      return { ...base, bgcolor: '#0e2833', border: `1px solid ${c}`, clipPath: 'polygon(8% 0, 92% 0, 100% 50%, 92% 100%, 8% 100%, 0 50%)', px: 1.4, boxShadow: `inset 0 0 6px ${c}88` };
    case 'plasma':       return { ...base, background: `linear-gradient(90deg, ${c}, #ff8ac0, ${c})`, color: '#fff', borderRadius: 999, boxShadow: `0 0 10px ${c}AA` };
    case 'digital':      return { ...base, bgcolor: '#001a12', color: c, border: `1px solid ${c}`, fontFamily: 'monospace', letterSpacing: 1, boxShadow: `inset 0 0 6px ${c}55` };
    case 'relic':        return { ...base, bgcolor: '#2a2116', color: '#f0dfaa', border: `2px double ${c}`, boxShadow: `inset 0 0 4px #0008` };
    case 'holo':         return { ...base, bgcolor: '#ffffff11', color: c, border: `1px solid ${c}88`, backdropFilter: 'blur(4px)', boxShadow: `0 0 8px ${c}88, inset 0 0 4px ${c}44` };
    case 'mechanic':     return { ...base, bgcolor: '#1a1f26', color: c, border: `1px dashed ${c}`, fontFamily: 'monospace' };
    case 'royal':        return { ...base, background: `linear-gradient(180deg, #5a4200, #2a1e00)`, color: c, border: `1px solid ${c}`, boxShadow: `0 0 8px ${c}` };
    case 'anomaly':      return { ...base, bgcolor: '#20050e', color: c, border: `1px solid ${c}`, borderRadius: '10px 2px 10px 2px', boxShadow: `0 0 8px ${c}AA` };
    case 'core':         return { ...base, bgcolor: '#001a26', color: c, border: `1px solid ${c}`, borderRadius: 999, boxShadow: `0 0 12px ${c}, inset 0 0 4px ${c}77` };
    case 'infinity':     return { ...base, bgcolor: '#000', color: '#fff', border: `1px solid #fff`, borderRadius: 999, px: 1.4, boxShadow: `0 0 8px #ff4870AA, 0 0 12px #4dd0ffAA` };
    case 'cult':         return { ...base, bgcolor: '#000', color: c, border: `2px solid ${c}`, borderRadius: 0, fontFamily: '"Courier New", monospace', letterSpacing: 1, fontSize: 9, boxShadow: `2px 2px 0 ${c}, 4px 4px 0 #000` };
  }
}
