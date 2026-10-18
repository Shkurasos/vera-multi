/**
 * Собственные SVG-формы реакций (вместо системных эмодзи): 10 форм
 * (лайк, сердце, огонь, смех, удивление, слеза, гнев, праздник, дизлайк,
 * звезда) и палитры — стандартная для стоковых реакций и своя для каждого пака.
 */
export interface ReactionPalette {
  from: string; to: string; stroke: string; strokeWidth: number;
  detail: string; accent: string; gloss?: boolean; sparkles?: boolean; pixel?: boolean; filter?: string;
}

export const FACE_KEYS = new Set(['laugh', 'wow', 'sad', 'angry']);

const STOCK_BODY: Record<string, [string, string]> = {
  heart: ['#ff7a8f', '#e3203f'], fire: ['#ffb347', '#ff4d00'], party: ['#c3a6ff', '#7c4dff'], star: ['#fff09a', '#f5b335'],
};

export const stockPalette = (key: string): ReactionPalette => {
  const [from, to] = STOCK_BODY[key] || ['#ffe08a', '#f5b335'];
  return {
    from, to, stroke: 'rgba(0,0,0,.3)', strokeWidth: 1.2, detail: '#5a3a12',
    accent: key === 'fire' ? '#ffe066' : key === 'party' ? '#ff3b5c' : '#4fc3ff', gloss: true,
  };
};

export const PACK_PALETTE: Record<string, (color: string, key: string) => ReactionPalette> = {
  neon: c => ({ from: '#0b1530', to: '#16234f', stroke: c, strokeWidth: 1.8, detail: c, accent: '#ff4dd8', filter: `drop-shadow(0 0 2px ${c}) drop-shadow(0 0 5px ${c})` }),
  gold: c => ({ from: '#fff3b8', to: '#c98a12', stroke: '#7a4e00', strokeWidth: 1.2, detail: '#5a3800', accent: '#fff8d6', gloss: true, filter: `drop-shadow(0 0 2px ${c})` }),
  pixel: (c, k) => ({ ...stockPalette(k), stroke: '#1b1b1b', strokeWidth: 2.2, gloss: false, pixel: true, filter: `drop-shadow(1.5px 1.5px 0 ${c})` }),
  cosmos: c => ({ from: '#6a3ae0', to: '#140a3a', stroke: '#c9b3ff', strokeWidth: 1.2, detail: '#ffffff', accent: '#7ee8ff', sparkles: true, filter: `drop-shadow(0 0 3px ${c})` }),
  candy: c => ({ from: '#ffe0f0', to: '#ff7ab8', stroke: '#d63384', strokeWidth: 1.3, detail: '#7a0f3d', accent: '#ffffff', gloss: true, filter: `drop-shadow(0 1.5px 0 ${c}aa)` }),
};

const THUMB = 'M4 14h5v14H4z M11 14l5-9c1-2 4-1.5 4 1v6h6.5c1.9 0 3.3 1.8 2.9 3.6l-2 9C27 26.8 25.8 28 24.4 28H11z';

/** Форма реакции в координатах viewBox 0 0 32 32. */
export default function ReactionArt({ k, p, fill }: { k: string; p: ReactionPalette; fill: string }) {
  const body = { fill, stroke: p.stroke, strokeWidth: p.strokeWidth, strokeLinejoin: 'round' as const };
  const line = { fill: 'none', stroke: p.detail, strokeWidth: 2, strokeLinecap: 'round' as const };
  if (k === 'like') return <path d={THUMB} {...body} />;
  if (k === 'dislike') return <path d={THUMB} {...body} transform="rotate(180 16 16)" />;
  if (k === 'heart') return <path d="M16 28S3 20.5 3 11.5C3 7.4 6.2 4.5 9.8 4.5c2.6 0 4.7 1.4 6.2 3.6 1.5-2.2 3.6-3.6 6.2-3.6 3.6 0 6.8 2.9 6.8 7 0 9-13 16.5-13 16.5z" {...body} />;
  if (k === 'star') return <polygon points="16,3 19.8,11.6 29,12.4 22,18.6 24.2,27.8 16,23 7.8,27.8 10,18.6 3,12.4 12.2,11.6" {...body} />;
  if (k === 'fire') return <>
    <path d="M16 2.5c1.2 5.5 8.5 8.5 8.5 16.5a8.5 8.5 0 0 1-17 0c0-4.6 2.4-7 4.2-9.4.4 3 1.8 4.6 3.2 5-1.2-4.4-.4-8.6 1.1-12.1z" {...body} />
    <path d="M16 17.5c1.8 2.3 4 3.6 4 6.6a4 4 0 0 1-8 0c0-2.4 1.9-3.8 4-6.6z" fill={p.accent} />
  </>;
  if (k === 'party') return <>
    <path d="M4 28.5l6.5-17.5 11 11z" {...body} />
    <path d="M7.5 20l5 5M9.5 14.5l8 8" stroke={p.detail} strokeWidth={1.4} strokeLinecap="round" opacity={0.6} />
    <circle cx="22" cy="6" r="1.8" fill={p.accent} /><circle cx="27" cy="13" r="1.5" fill={p.stroke} />
    <rect x="15" y="3" width="3" height="3" rx="0.6" fill={p.stroke} transform="rotate(25 16.5 4.5)" />
    <rect x="25" y="20" width="3" height="3" rx="0.6" fill={p.accent} transform="rotate(-20 26.5 21.5)" />
    <path d="M18 12c2-3 5-2 6-5" {...line} stroke={p.accent} strokeWidth={1.6} />
  </>;
  if (!FACE_KEYS.has(k)) return null;
  const eyeY = k === 'angry' ? 15 : 12.5;
  const eyes = <><circle cx="11" cy={eyeY} r="1.9" fill={p.detail} /><circle cx="21" cy={eyeY} r="1.9" fill={p.detail} /></>;
  return <>
    <circle cx="16" cy="16" r="13" {...body} />
    {k === 'laugh' && <>
      <path d="M8.5 13q2.5-3.5 5 0M18.5 13q2.5-3.5 5 0" {...line} />
      <path d="M8 17.5h16a8 8 0 0 1-16 0z" fill={p.detail} />
      <path d="M5 16q-2 3 0 4.5q2-1.5 0-4.5zM27 16q-2 3 0 4.5q2-1.5 0-4.5z" fill={p.accent} />
    </>}
    {k === 'wow' && <>{eyes}<ellipse cx="16" cy="21.5" rx="3" ry="4" fill={p.detail} /></>}
    {k === 'sad' && <>{eyes}<path d="M11 23.5q5-5 10 0" {...line} /><path d="M9 16q-2.2 3.4 0 4.8q2.2-1.4 0-4.8z" fill={p.accent} /></>}
    {k === 'angry' && <>{eyes}<path d="M7.5 10l6 3M24.5 10l-6 3M11 23.5q5-4.5 10 0" {...line} /></>}
  </>;
}
