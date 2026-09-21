import type { ShopItem } from '../store/shopStore';
import { packSkin } from './packSkin';
import { buildPlaqueSx } from './rarityStyles';
import { themedSkin } from './themedSkin';
import { PACK_ART } from './packArt';
import { artDataUrl } from './collectionArt';
import { THEMED_MATERIALS } from './themedSkin';

/** A compact plaque uses its pack's bubble material, not a flat accent fill. */
export function selfcardSkin(item: ShopItem, catalog: ShopItem[], accent: string, themeMode = false): Record<string, any> {
  const bubble = catalog.find(candidate => candidate.category === 'bubble' && candidate.value?.pack === item.value?.pack);
  if (!item.value?.pack || !bubble) return {};
  const surface = bubbleSkin(bubble, accent, themeMode);
  const art = PACK_ART[`pack-${item.value.pack}`];
  const iconColor = themeMode ? accent : THEMED_MATERIALS[item.value.pack]?.accent || bubble.value.color || surface.color;
  const icon = art ? artDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${art.path}" fill="none" stroke="${iconColor}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`) : undefined;
  return {
    ...surface,
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    position: 'relative', isolation: 'isolate',
    borderRadius: '4px',
    px: 0.75, py: 0.5, fontSize: 11, lineHeight: 1.4, minWidth: 30,
    '&::before': { content: '""', display: icon ? 'block' : 'none', flexShrink: 0,
      width: '18px', height: '18px', pointerEvents: 'none',
      backgroundImage: icon ? `url("${icon}")` : undefined,
      backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
    '&::after': surface['&::before'] || { display: 'none' },
  };
}

/** Shared by the inventory and actual messages. Texture stays behind the text. */
export function bubbleSkin(item: ShopItem | undefined, accent: string, themeMode = false): Record<string, any> {
  if (!item || item.stock) return {};
  const themed = themedSkin(item.value.pack, 'bubble');
  if (themed) return themeMode ? { ...themed, borderColor: accent } : themed;
  const c = themeMode ? accent : (item.value.color || (typeof item.previewColor === 'string' && item.previewColor.match(/#[\da-f]{6}/i)?.[0]) || '#54dce4');
  const base = { color: '#f4f7fa', border: '1px solid #ffffff24', boxShadow: '0 4px 12px #00000026', borderRadius: '16px 16px 4px 16px', background: '#20242b', letterSpacing: 0,
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' } };
  const skins: Record<string, Record<string, any>> = {
    neon: { background: '#101e24', border: `1px solid ${c}`, boxShadow: `inset 3px 0 ${c}, 0 0 12px ${c}44`, borderRadius: '4px 16px 4px 16px' },
    glass: { background: 'linear-gradient(125deg,#ffffff48 0%,#ffffff12 40%,#d5f7ff28 100%), #233b48e8', backdropFilter: 'blur(16px)', border: '1px solid #ffffff60', boxShadow: 'inset 0 1px #ffffff70, 0 6px 20px #00000026' },
    shadow: { background: 'linear-gradient(145deg,#363b43,#17191e)', border: '1px solid #ffffff18', boxShadow: '4px 5px 0 #0c0e13, 7px 9px 14px #00000038' },
    minimal: { background: '#f5f7fa', color: '#252b35', border: `1px solid ${c}`, borderLeft: `4px solid ${c}`, borderRadius: '2px', boxShadow: 'none' },
    rounded: { background: `linear-gradient(160deg,#ffffff24,transparent 55%), #213d38`, borderRadius: '26px', border: `1px solid ${c}80`, boxShadow: 'inset 0 3px 4px #ffffff30, inset 0 -3px 4px #00000030' },
    sharp: { background: `linear-gradient(135deg,${c}28 12%,transparent 12%), #1f2329`, borderRadius: '0px', borderTop: `3px solid ${c}`, borderRight: `3px solid ${c}`, boxShadow: '4px 4px 0 #00000055' },
    retro: { background: 'repeating-linear-gradient(0deg,transparent 0 3px,#2034180b 3px 4px), #d4e7ae', color: '#253622', border: '3px double #50683c', borderRadius: '6px', fontFamily: 'monospace', boxShadow: 'inset 2px 2px 0 #607e4540, 3px 3px 0 #263323' },
    candy: { background: 'repeating-linear-gradient(135deg,#ffe6ef 0 16px,#fcd0e1 16px 32px)', color: '#5c2344', border: '2px solid #fff1f7', borderRadius: '20px 6px 20px 6px', boxShadow: 'inset 0 -4px #df8bb44d, 3px 3px 0 #bf578d60' },
    mono: { background: '#f9f9f9', color: '#191919', border: '2px solid #191919', borderRadius: '2px 14px 2px 14px', boxShadow: '4px 4px 0 #191919' },
    aurora: { background: 'linear-gradient(115deg,#103b3b,#26544a,#26344e,#16434b)', backgroundSize: '250% 100%', animation: 'veraAuroraShift 12s ease infinite', borderTop: '2px solid #77e6bf', borderBottom: '2px solid #91a6ef' },
    cyber: { background: `repeating-linear-gradient(0deg,transparent 0 6px,${c}0c 6px 7px), #0e2025`, border: `1px solid ${c}`, borderLeft: `5px solid ${c}`, borderRadius: '2px 14px 2px 2px', boxShadow: '3px 3px 0 #f3cf5350', fontFamily: 'monospace' },
  };
  const variants: Record<string, Record<string, any>> = {
    'bubble-gradient-sunset': { background: 'linear-gradient(170deg,#592144 0%,#963954 65%,#bc644b 100%)', borderBottom: '3px solid #ffc080', borderRadius: '18px 18px 3px 3px' },
    'bubble-gradient-ocean': { background: 'repeating-radial-gradient(ellipse at 0 120%,transparent 0 16px,#76e7db18 17px 18px,transparent 19px 34px), linear-gradient(145deg,#123f56,#146361)', border: '1px solid #81dace70' },
    'bubble-gradient-forest': { background: 'repeating-linear-gradient(125deg,transparent 0 24px,#abcba913 24px 26px), linear-gradient(120deg,#173f35,#34553a)', border: '1px solid #a6c78880', borderRadius: '4px 22px 4px 22px' },
    'bubble-gradient-lava': { background: 'linear-gradient(120deg,transparent 42%,#ffb24c 43%,#ec542f 44%,transparent 46%), linear-gradient(25deg,#272326,#57302a)', border: '1px solid #db694c', boxShadow: 'inset 0 -3px #d64a3744, 0 3px 12px #a8292926' },
    'bubble-gradient-ice': { background: 'linear-gradient(145deg,transparent 40%,#ffffff80 41%,transparent 43%), linear-gradient(35deg,#d1eaf4,#f4fcff 55%,#b6dfe9)', color: '#1c4555', border: '1px solid #ffffff', borderRadius: '3px 18px 3px 18px' },
    'bubble-gradient-gold': { background: 'repeating-linear-gradient(0deg,#ffffff0d 0 1px,transparent 1px 3px), linear-gradient(115deg,#d3a34e,#fff0ba 48%,#d8b565)', color: '#443018', border: '3px double #8b662e', borderRadius: '5px' },
    'bubble-neon-pink': { background: '#32192c', border: '1px solid #ff89be', borderBottom: '3px solid #ff89be', boxShadow: '3px 0 0 #6de5df, 0 0 14px #ff48952b' },
    'bubble-holographic': { background: 'linear-gradient(125deg,#d9f7ed,#e0defb 35%,#f8dfed 65%,#cdf3f6)', color: '#343550', border: '1px solid #ffffff', backgroundSize: '250% 100%', animation: 'veraAuroraShift 14s ease infinite', boxShadow: 'inset 0 2px #ffffff90, 0 3px 12px #24243526' },
  };
  const style: Record<string, any> = { ...base, ...skins[item.value.type], ...variants[item.id] };
  if (item.value.pack) {
    const motif = packSkin(item.value.pack, c, 'bubble');
    if (item.rarity) {
      const material = buildPlaqueSx(item.rarity, c);
      for (const key of ['background', 'backgroundImage', 'bgcolor', 'color', 'border', 'boxShadow', 'borderRadius']) {
        if (material[key] !== undefined) style[key] = material[key];
      }
    }
    if (item.value.pack === 'cyber') Object.assign(style, motif);
    else {
      // Separate layer keeps the existing material and text contrast intact.
      Object.assign(style, { position: 'relative', isolation: 'isolate',
        '&::before': { content: '""', position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: -1,
          opacity: 0.2, backgroundImage: motif.backgroundImage, backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px bottom 2px', backgroundSize: '48px 48px', borderRadius: 'inherit' } });
    }
  }
  // Theme accents do not replace neutral surfaces or readable foregrounds.
  return themeMode ? { ...style, borderColor: c, boxShadow: `${style.boxShadow === 'none' ? '' : `${style.boxShadow}, `}inset 3px 0 ${c}` } : style;
}