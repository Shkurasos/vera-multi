import { Box, Typography } from '@mui/material';
import type { SkinPack } from '../store/lootStore';
import { useThemeStore } from '../store/themeStore';
import { PACK_ART } from '../utils/packArt';
import { useId } from 'react';
import { artDataUrl } from '../utils/collectionArt';

export default function PackArtwork({ pack, compact = false }: { pack: SkinPack; compact?: boolean }) {
  const { theme } = useThemeStore();
  const uniqueId = useId();
  const art = PACK_ART[pack.id];
  if (!art) return null;
  const gradientId = `pack-${uniqueId.replace(/:/g, '')}`;
  return <Box sx={{ position: 'relative', overflow: 'hidden', borderRadius: 2, border: `1px solid ${pack.color}66`, background: `linear-gradient(145deg, ${pack.color}38, transparent), ${theme.bgInput}`, boxShadow: `inset 0 1px 0 ${pack.color}55, 0 10px 28px ${pack.color}22`, p: compact ? 0.5 : 2, textAlign: 'center' }}>
    <Box sx={{ position: 'absolute', width: '70%', aspectRatio: '1', borderRadius: '50%', bgcolor: pack.color, opacity: .12, filter: 'blur(24px)', top: '-30%', right: '-12%' }} />
    {art.illustration ? <Box component="img" src={artDataUrl(art.illustration)} alt={art.story} sx={{ display: 'block', mx: 'auto', mb: 1, width: '100%', maxWidth: compact ? 160 : 320, height: compact ? 90 : 160, objectFit: 'contain', borderRadius: 1 }} /> : <Box component="svg" viewBox="0 0 100 100" role="img" aria-label={art.story} sx={{ display: 'block', mx: 'auto', width: compact ? 78 : 126, height: compact ? 78 : 126 }}>
      <defs>
        <linearGradient id={gradientId} x1="12" y1="8" x2="86" y2="94" gradientUnits="userSpaceOnUse"><stop stopColor="#ffffff" stopOpacity=".92" /><stop offset=".32" stopColor={pack.color} /><stop offset="1" stopColor={pack.color} /></linearGradient>
        <filter id={`${gradientId}-glow`} x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="2.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <path d={art.path} fill="none" stroke="#05070b" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity=".65" transform="translate(1 2)" />
      <path d={art.path} fill="none" stroke={`url(#${gradientId})`} strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${gradientId}-glow)`} />
      <path d={art.path} fill="none" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity=".4" />
    </Box>}
    <Typography sx={{ position: 'relative', color: theme.text, fontWeight: 800, fontSize: compact ? 11 : 15, lineHeight: 1.3 }}>{pack.name}</Typography>
    {!compact && <Typography sx={{ color: theme.textSec, fontSize: 12, mt: 0.5 }}>{art.story}</Typography>}
  </Box>;
}