import { useId } from 'react';
import { Box } from '@mui/material';
import { findReactionSkin, REACTION_SKIN_PACKS, STOCK_REACTIONS } from '../store/reactionSkinStore';
import ReactionArt, { FACE_KEYS, PACK_PALETTE, stockPalette } from './ReactionArt';
import { pixelRuns } from '../utils/pixelReactions';

/**
 * Отрисовка реакции собственной SVG-картинкой (а не системным эмодзи —
 * одинаково на любой ОС). Стоковая реакция в сообщении по-прежнему хранится
 * эмодзи (`👍`), скин — id `rx-<пак>-<реакция>`. Неизвестный эмодзи
 * показываем текстом, неизвестный `rx-…` id — как «✨», а не сырой id.
 */
const keyOf = (id: string) => id.slice(id.lastIndexOf('-') + 1);
const BASE = REACTION_SKIN_PACKS[0]?.reactions || [];
const norm = (s: string) => s.replace(/\uFE0F/g, '');
/** Порядок стоковых эмодзи в каталоге совпадает с порядком реакций в паке. */
const STOCK_KEY = new Map(STOCK_REACTIONS.map((emoji, i) => [norm(emoji), BASE[i] ? keyOf(BASE[i].id) : '']));
const STOCK_NAME = new Map(BASE.map(r => [keyOf(r.id), r.name.split(' · ')[0]]));

export default function ReactionGlyph({ value, size }: { value: string; size?: number }) {
  const gradientId = `rx-${useId().replace(/:/g, '')}`;
  const skin = findReactionSkin(value);
  const key = skin ? keyOf(skin.id) : STOCK_KEY.get(norm(value));
  if (!key) {
    return <Box component="span" sx={{ fontSize: size, lineHeight: 1 }}>{value.startsWith('rx-') ? '✨' : value}</Box>;
  }
  const p = (skin && PACK_PALETTE[skin.pack]?.(skin.color, key)) || stockPalette(key);
  const dim = size ?? '1.25em';
  return <svg viewBox="0 0 32 32" role="img" aria-label={skin?.name || STOCK_NAME.get(key) || value} data-vera-reaction={key}
    shapeRendering={p.pixel ? 'crispEdges' : undefined}
    style={{ width: dim, height: dim, display: 'inline-block', verticalAlign: '-0.25em', flexShrink: 0, overflow: 'visible', filter: p.filter }}>
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={p.from} /><stop offset="1" stopColor={p.to} />
      </linearGradient>
    </defs>
    {p.pixel
      // Пак «Пиксели» — настоящий спрайт 32×32: клетка = единица viewBox.
      ? pixelRuns(key, { from: p.from, to: p.to, outline: p.stroke, detail: p.detail, accent: p.accent })
        .map(r => <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />)
      : <ReactionArt k={key} p={p} fill={`url(#${gradientId})`} />}
    {p.gloss && (FACE_KEYS.has(key) || key === 'heart') && <ellipse cx="11" cy="9" rx="4.5" ry="2.2" fill="#fff" opacity={0.35} transform="rotate(-30 11 9)" />}
    {p.sparkles && <g fill="#fff"><circle cx="4" cy="5" r="0.9" /><circle cx="28" cy="5.5" r="0.7" /><circle cx="28.5" cy="27" r="0.9" /><circle cx="15" cy="16" r="0.6" opacity={0.7} /></g>}
  </svg>;
}
