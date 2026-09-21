import { getContrastRatio } from '@mui/material/styles';
import { PACK_ART } from './packArt';
import { themedSkin } from './themedSkin';

export function packSkin(key: string, color: string, part: 'ring' | 'selfcard' | 'bubble'): Record<string, any> {
  const themed = themedSkin(key, part);
  if (themed) return themed;
  const art = PACK_ART[`pack-${key}`];
  if (!art) return {};
  const cyber = key === 'cyber';
  const wings = key === 'r-relic' || key === 'r-divine';
  const c = cyber ? '#fcee09' : color;
  const ink = getContrastRatio(c, '#171b22') >= getContrastRatio(c, '#ffffff') ? '#171b22' : '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><filter id="g"><feGaussianBlur stdDeviation="2"/></filter></defs><path d="${art.path}" fill="none" stroke="${c}" stroke-opacity=".45" stroke-width="8" filter="url(#g)"/><path d="${art.path}" fill="none" stroke="#05070b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="${art.path}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="${art.path}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".65" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  const base = { border: `${wings ? '3px double' : '1px solid'} ${c}`, boxShadow: cyber ? '3px 2px 0 #00e5ff' : `0 0 8px ${c}33`, letterSpacing: 0 };
  if (part === 'ring') return {
    ...base, position: 'relative', overflow: 'visible',
    '&::after': { content: '""', position: 'absolute', pointerEvents: 'none',
      width: wings ? '140%' : '52%', height: wings ? '140%' : '52%',
      left: wings ? '-20%' : '52%', top: wings ? '-20%' : '52%',
      backgroundImage: image, backgroundSize: 'contain', backgroundRepeat: 'no-repeat',
      filter: 'drop-shadow(0 1px 2px #000)', zIndex: 1 },
  };
  if (part === 'selfcard') return {
    ...base, display: 'inline-flex', alignItems: 'center', gap: '4px',
    px: 0.75, py: 0.4, fontSize: 11, lineHeight: 1.2,
    background: c, color: ink,
    borderRadius: cyber ? '0px' : wings ? '8px 8px 2px 2px' : '4px',
    '&::before': { content: '""', flexShrink: 0, width: 20, height: 20,
      backgroundColor: ink, maskImage: image, maskSize: 'contain', maskRepeat: 'no-repeat' },
  };
  return {
    ...base, background: c, color: ink,
    backgroundImage: image, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px bottom 4px',
    backgroundSize: '42px 42px', backgroundBlendMode: 'soft-light',
    borderRadius: cyber ? '0px 14px 0px 0px' : wings ? '18px 18px 4px 4px' : '8px',
    ...(cyber ? { borderLeft: '5px solid #fcee09', fontFamily: 'monospace',
      backgroundImage: `${image}, repeating-linear-gradient(0deg,transparent 0 5px,#00e5ff16 5px 6px)`,
      backgroundSize: '42px 42px, auto' } : {}),
  };
}