import React from 'react';
import { Box } from '@mui/material';
import { findPet } from '../store/petCatalog';

/**
 * Арт пяти питомцев по референсам + лёгкие CSS-анимации:
 * дыхание, моргание, взмах крыльев, неоновое мерцание, «zZz» у лисы.
 * Все ключи/классы с префиксами veraPet/vera-pet — повторное монтирование безопасно.
 */
const KEYFRAMES = `
@keyframes veraPetFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
@keyframes veraPetBreathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.03) } }
@keyframes veraPetBlink { 0%,90%,100% { transform: scaleY(1) } 94% { transform: scaleY(0.06) } }
@keyframes veraPetEar { 0%,84%,100% { transform: rotate(0deg) } 88% { transform: rotate(-7deg) } 92% { transform: rotate(4deg) } }
@keyframes veraPetHop { 0%,70%,100% { transform: translateY(0) } 80% { transform: translateY(-5px) } 88% { transform: translateY(0) } 93% { transform: translateY(-2px) } }
@keyframes veraPetGlow { 0%,100% { opacity: .5 } 50% { opacity: 1 } }
@keyframes veraPetGlowPulse { 0%,100% { filter: drop-shadow(0 0 4px var(--vera-pet-glow, rgba(126,224,34,.4))) } 50% { filter: drop-shadow(0 0 10px var(--vera-pet-glow, rgba(126,224,34,.9))) } }
@keyframes veraPetFlicker { 0%,100% { opacity: 1 } 44% { opacity: 1 } 46% { opacity: .72 } 48% { opacity: 1 } 74% { opacity: 1 } 75% { opacity: .82 } 76% { opacity: 1 } }
@keyframes veraPetFlapL { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-5deg) } }
@keyframes veraPetFlapR { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(5deg) } }
@keyframes veraPetTwinkle { 0%,100% { opacity: .25; transform: scale(.7) } 50% { opacity: 1; transform: scale(1.15) } }
@keyframes veraPetZ { 0% { opacity: 0; transform: translate(0,0) scale(.6) } 25% { opacity: 1 } 100% { opacity: 0; transform: translate(7px,-18px) scale(1.1) } }
@keyframes veraPetPeekIn { 0% { transform: translateY(-50%) translateX(64px); opacity: 0 } 100% { transform: translateY(-50%) translateX(0); opacity: 1 } }
@keyframes veraPetPeekSway { 0%,100% { transform: translateY(-50%) translateX(0) } 50% { transform: translateY(-51.5%) translateX(-6px) } }
.vera-pet-float { animation: veraPetFloat 3.2s ease-in-out infinite }
.vera-pet-breathe { animation: veraPetBreathe 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 90% }
.vera-pet-blink { animation: veraPetBlink 4.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.vera-pet-ear { animation: veraPetEar 4.2s ease-in-out infinite; transform-box: fill-box; transform-origin: bottom center }
.vera-pet-hop { animation: veraPetHop 3.6s ease-in-out infinite }
.vera-pet-glow { animation: veraPetGlow 3s ease-in-out infinite }
.vera-pet-glowpulse { animation: veraPetGlowPulse 3s ease-in-out infinite }
.vera-pet-flicker { animation: veraPetFlicker 5.5s linear infinite }
.vera-pet-flap-l { animation: veraPetFlapL 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: 100% 90% }
.vera-pet-flap-r { animation: veraPetFlapR 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: 0% 90% }
.vera-pet-twinkle { animation: veraPetTwinkle 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.vera-pet-z { animation: veraPetZ 3.2s ease-in infinite }
.vera-pet-noanim * { animation: none !important }
@media (prefers-reduced-motion: reduce) {
  .vera-pet-float, .vera-pet-breathe, .vera-pet-blink, .vera-pet-ear, .vera-pet-hop,
  .vera-pet-glow, .vera-pet-glowpulse, .vera-pet-flicker, .vera-pet-flap-l, .vera-pet-flap-r,
  .vera-pet-twinkle, .vera-pet-z { animation: none !important }
}
`;

/* ── Пиксельный кот: сетка пикселей по референсу (чёрный кот, зелёные глаза) ── */
const PIXEL_COLORS: Record<string, string> = { K: '#101015', E: '#55555f', P: '#3f3f4a', G: '#7ee022', W: '#ffffff' };
const PIXEL_CAT = [
  '....KK............KK....',
  '...KKK............KKK...',
  '..KKKKK..........KKKKK..',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKKKGGGGGKKKKGGGGGKKKK.',
  '.KKKKGWGGGKKKKGGGWGKKKK.',
  '.KKKKGGGGGKKKKGGGGGKKKK.',
  '.KKKKGGGGGKKKKGGGGGKKKK.',
  '.KWWWKKKKKKKKKKKKKKWWWK.',
  '.KWWKKKKKKKKKKKKKKKKWWK.',
  '..KKWKKKKKKKKKKKKWKK..',
  '..KKKKKKKKKKKKKKKKKKKK..',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKKKKKKKKKKKKKKKKKKKKK.',
  '.KKEEEEKKKKKKKKKKEEEEEKK.',
  '.KKPPPPKKKKKKKKKKPPPPKK.',
  '..PPPPKKKKKKKKKKKKPPPP..',
  '...PPPPKKKKKKKKKKPPPP...',
];

const starPath = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r} Q${cx + r * 0.25} ${cy - r * 0.25} ${cx + r} ${cy} Q${cx + r * 0.25} ${cy + r * 0.25} ${cx} ${cy + r} Q${cx - r * 0.25} ${cy + r * 0.25} ${cx - r} ${cy} Q${cx - r * 0.25} ${cy - r * 0.25} ${cx} ${cy - r} Z`;

function PixelCatArt() {
  const cell = 5;
  const offsetY = (120 - PIXEL_CAT.length * cell) / 2;
  const eyeRects = (x0: number, x1: number, keyPrefix: string) => {
    const rects: React.ReactElement[] = [];
    for (let y = 6; y <= 9; y++) {
      for (let x = x0; x <= x1; x++) {
        const color = PIXEL_COLORS[PIXEL_CAT[y][x]];
        if (color) rects.push(<rect key={`${keyPrefix}-${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={color} />);
      }
    }
    return rects;
  };
  return (
    <g className="vera-pet-float" transform={`translate(0 ${offsetY})`}>
      <ellipse className="vera-pet-glow" cx="60" cy={PIXEL_CAT.length * cell - 1} rx="34" ry="3.5" fill="#7ee022" opacity="0.35" />
      <g shapeRendering="crispEdges">
        {PIXEL_CAT.map((row, y) => row.split('').map((ch, x) => {
          if (y >= 6 && y <= 9 && ((x >= 5 && x <= 9) || (x >= 14 && x <= 18))) return null;
          const color = PIXEL_COLORS[ch];
          return color ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={color} /> : null;
        }))}
        <g className="vera-pet-blink">{eyeRects(5, 9, 'eyeL')}</g>
        <g className="vera-pet-blink" style={{ animationDelay: '0.05s' }}>{eyeRects(14, 18, 'eyeR')}</g>
      </g>
    </g>
  );
}

/* ── Ночной кот: чёрный «пузырь» с радужной каймой и подсветкой снизу ── */
function CatArt() {
  return (
    <g className="vera-pet-float">
      <defs>
        <linearGradient id="veraPetCatRim" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#7df9ff" />
          <stop offset="45%" stopColor="#ff7de9" />
          <stop offset="100%" stopColor="#ffc37d" />
        </linearGradient>
        <radialGradient id="veraPetCatBody" cx="50%" cy="80%" r="85%">
          <stop offset="0%" stopColor="#23232c" />
          <stop offset="60%" stopColor="#101015" />
          <stop offset="100%" stopColor="#08080c" />
        </radialGradient>
      </defs>
      {/* световое пятно на полу */}
      <g className="vera-pet-glow">
        <ellipse cx="60" cy="100" rx="36" ry="4" fill="url(#veraPetCatRim)" opacity="0.35" />
        <rect x="16" y="97.4" width="88" height="1.8" rx="0.9" fill="url(#veraPetCatRim)" opacity="0.85" />
      </g>
      <g style={{ filter: 'drop-shadow(0 0 6px rgba(125,249,255,0.35)) drop-shadow(0 0 14px rgba(255,125,233,0.25))' }}>
        {/* тело с ушами и радужной каймой */}
        <path
          d="M30 44 L34 20 Q35 15 39 20 L52 32 Q60 29 68 32 L81 20 Q85 15 86 20 L90 44 C97 56 98 78 88 89 C74 99 46 99 32 89 C22 78 23 56 30 44 Z"
          fill="url(#veraPetCatBody)" stroke="url(#veraPetCatRim)" strokeWidth="2.4" strokeLinejoin="round"
        />
        {/* внутренняя часть ушей */}
        <path d="M37 40 L40 26 L49 35 Z" fill="#22222b" />
        <path d="M83 40 L80 26 L71 35 Z" fill="#3a2b26" />
        {/* лёгкая затенённая щёчка-пузырь внизу */}
        <ellipse cx="60" cy="86" rx="26" ry="9" fill="#1a1a22" opacity="0.55" />
        {/* усы */}
        <g stroke="#cfd3ff" strokeWidth="1.1" strokeLinecap="round" opacity="0.5">
          <path d="M36 62 L18 57" /><path d="M36 67 L19 70" />
          <path d="M84 62 L102 57" /><path d="M84 67 L101 70" />
        </g>
        {/* глаза */}
        <g className="vera-pet-blink" fill="#ffffff">
          <circle cx="47" cy="58" r="4.6" />
          <circle cx="73" cy="58" r="4.6" />
        </g>
        {/* ротик ω */}
        <path d="M54 69 Q58 74 62 69 Q66 64 70 69" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </g>
  );
}

/* ── Ленивая лиса: свернулась клубком и спит (дыхание + zZz) ── */
function FoxArt() {
  return (
    <g>
      <ellipse cx="60" cy="104" rx="42" ry="5" fill="#000000" opacity="0.25" />
      <g className="vera-pet-breathe">
        <defs>
          <linearGradient id="veraPetFoxBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f4785a" />
            <stop offset="100%" stopColor="#e85f47" />
          </linearGradient>
        </defs>
        {/* свернутое тело и хвост */}
        <path d="M97 54 C103 76 90 98 63 101 C40 104 23 92 25 75 C27 63 39 58 43 47 C57 58 83 60 97 54 Z" fill="url(#veraPetFoxBody)" />
        <path d="M93 64 C97 83 84 97 62 99 C47 100 35 95 31 87 C41 91 53 91 63 87 C79 81 89 74 93 64 Z" fill="#e85f47" />
        {/* кремовый кончик хвоста у подбородка */}
        <path d="M31 87 C26 81 28 72 37 68 C34 76 37 83 46 87 C39 90 34 90 31 87 Z" fill="#f9efdb" />
        {/* ушки */}
        <g className="vera-pet-ear">
          <path d="M30 42 L33 20 L49 35 Z" fill="#f4785a" />
          <path d="M35 40 L37 27 L46 35 Z" fill="#d9553f" />
        </g>
        <g className="vera-pet-ear" style={{ animationDelay: '0.6s' }}>
          <path d="M52 35 L65 18 L71 38 Z" fill="#f4785a" />
          <path d="M56 34 L65 25 L68 36 Z" fill="#d9553f" />
        </g>
        {/* голова */}
        <ellipse cx="50" cy="55" rx="23" ry="18" fill="#f4785a" />
        {/* кремовая «маска» по мордочке */}
        <path d="M30 53 C32 44 40 40 50 40 C60 40 68 44 70 53 C71 61 65 67 59 69 L50 73 L41 69 C35 67 29 61 30 53 Z" fill="#f9efdb" />
        {/* закрытые глазки */}
        <g fill="none" stroke="#43332e" strokeWidth="2" strokeLinecap="round">
          <path d="M39 54 Q43 58 47 54" />
          <path d="M54 54 Q58 58 62 54" />
        </g>
        {/* румянец */}
        <circle cx="37" cy="61" r="3.4" fill="#f5a9a0" opacity="0.85" />
        <circle cx="64" cy="61" r="3.4" fill="#f5a9a0" opacity="0.85" />
        {/* нос */}
        <path d="M47 67 L54 67 L50.5 71 Z" fill="#2b2b33" />
        {/* zZz */}
        <g fill="#f9efdb" fontFamily="serif" fontWeight="700">
          <text className="vera-pet-z" x="76" y="36" fontSize="11">z</text>
          <text className="vera-pet-z" x="85" y="26" fontSize="8" style={{ animationDelay: '1.3s' }}>z</text>
        </g>
      </g>
    </g>
  );
}

/* ── Неоновый зайчик: тёмное тело и светящаяся кибернетическая обвязка ── */
function BunnyArt() {
  const neon = '#2ee6ff';
  const glowStyle: React.CSSProperties = { filter: `drop-shadow(0 0 5px ${neon})` };
  return (
    <g className="vera-pet-float">
      <defs>
        <linearGradient id="veraPetBunnyBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2b3140" />
          <stop offset="100%" stopColor="#161a24" />
        </linearGradient>
      </defs>
      {/* неоновые рельсы под ним */}
      <g className="vera-pet-glow">
        <rect x="28" y="98" width="66" height="2.4" rx="1.2" fill={neon} />
        <rect x="40" y="104" width="42" height="2" rx="1" fill={neon} opacity="0.7" />
      </g>
      <g style={glowStyle}>
        {/* длинные уши */}
        <g className="vera-pet-ear">
          <rect x="35" y="8" width="14" height="52" rx="7" fill="url(#veraPetBunnyBody)" stroke={neon} strokeWidth="2" />
          <rect x="39" y="14" width="6" height="40" rx="3" fill={neon} opacity="0.85" />
        </g>
        <g className="vera-pet-ear" style={{ animationDelay: '1.1s' }}>
          <rect x="67" y="8" width="14" height="52" rx="7" fill="url(#veraPetBunnyBody)" stroke={neon} strokeWidth="2" />
          <rect x="71" y="14" width="6" height="40" rx="3" fill={neon} opacity="0.85" />
        </g>
        {/* тело с неоновыми швами */}
        <ellipse cx="60" cy="72" rx="31" ry="29" fill="url(#veraPetBunnyBody)" stroke={neon} strokeWidth="2" />
        <path d="M43 55 Q60 66 77 55" fill="none" stroke={neon} strokeWidth="1.6" opacity="0.8" />
        <path d="M60 46 L60 62" stroke={neon} strokeWidth="1.6" opacity="0.8" />
        <circle cx="60" cy="79" r="6.5" fill={neon} opacity="0.35" stroke={neon} strokeWidth="1.4" />
        {/* грудка-«панель» */}
        <path d="M50 87 Q60 94 70 87 Q66 96 60 97 Q54 96 50 87 Z" fill={neon} opacity="0.55" stroke="none" />
        {/* лапки */}
        <ellipse cx="42" cy="96" rx="11" ry="7" fill="#161a24" stroke={neon} strokeWidth="2" />
        <ellipse cx="76" cy="96" rx="11" ry="7" fill="#161a24" stroke={neon} strokeWidth="2" />
        {/* мордочка */}
        <circle cx="60" cy="42" r="7" fill={neon} opacity="0.5" stroke={neon} strokeWidth="1.4" />
        <g className="vera-pet-blink" fill={neon}>
          <circle cx="49" cy="43" r="4.4" />
          <circle cx="71" cy="43" r="4.4" />
        </g>
        <path d="M56 51 L64 51 M60 51 L57 55 M60 51 L63 55" fill="none" stroke={neon} strokeWidth="1.6" strokeLinecap="round" />
        <g className="vera-pet-blink" fill="none" stroke={neon} strokeWidth="2.2" strokeLinecap="round">
          <path d="M44 57 Q48 61 52 57" />
          <path d="M68 57 Q72 61 76 57" />
        </g>
      </g>
    </g>
  );
}

/* ── Феникс: раздутые крылья-полумесяцы, хохолок, огненные стримеры ── */
function PhoenixArt() {
  const flame = (d: string, color: string, dur: string) => (
    <path d={d} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" className="vera-pet-flap-l" style={{ animationDuration: dur }} />
  );
  return (
    <g className="vera-pet-float">
      <defs>
        <linearGradient id="veraPetPhxWing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffb454" />
          <stop offset="100%" stopColor="#f4785a" />
        </linearGradient>
        <radialGradient id="veraPetPhxGlow" cx="50%" cy="55%" r="60%">
          <stop offset="0%" stopColor="#ffd76e" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffd76e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="58" cy="64" r="44" fill="url(#veraPetPhxGlow)" className="vera-pet-glow" />
      {/* огненные стримеры снизу */}
      <g className="vera-pet-glow">
        {flame('M48 90 Q43 102 47 110', '#ff6b3d', '1.6s')}
        {flame('M59 94 Q57 106 61 112', '#ffb454', '2.1s')}
        {flame('M70 90 Q76 100 73 109', '#ff6b3d', '1.85s')}
      </g>
      {/* крылья */}
      <g className="vera-pet-flap-l">
        <path d="M34 56 Q14 40 8 64 Q5 84 24 92 Q14 74 26 66 Q20 80 34 84 Q28 70 40 66 Z" fill="url(#veraPetPhxWing)" stroke="#e85f47" strokeWidth="1.4" />
      </g>
      <g className="vera-pet-flap-r">
        <path d="M84 56 Q104 40 110 64 Q113 84 94 92 Q104 74 92 66 Q98 80 84 84 Q90 70 78 66 Z" fill="url(#veraPetPhxWing)" stroke="#e85f47" strokeWidth="1.4" />
      </g>
      {/* тело с брюшком-«чешуёй» */}
      <ellipse cx="59" cy="66" rx="24" ry="31" fill="#f4785a" />
      <ellipse cx="59" cy="78" rx="14" ry="17" fill="#ffd08a" />
      <g fill="none" stroke="#f0a24b" strokeWidth="1.6">
        <path d="M47 72 Q59 78 71 72" />
        <path d="M47 79 Q59 85 71 79" />
        <path d="M49 86 Q59 92 69 86" />
      </g>
      {/* хохолок */}
      <g className="vera-pet-ear">
        <path d="M57 36 Q60 20 67 15 Q65 26 69 35" fill="#ffd76e" stroke="#f0a24b" strokeWidth="1.2" />
        <path d="M67 35 Q72 24 81 23 Q76 31 76 40" fill="#ffb454" stroke="#f0a24b" strokeWidth="1.2" />
      </g>
      {/* голова */}
      <circle cx="60" cy="37" r="16" fill="#f4785a" />
      <g className="vera-pet-blink" fill="#3a1c12">
        <circle cx="53" cy="37" r="3.4" />
        <circle cx="67" cy="37" r="3.4" />
      </g>
      <circle cx="54" cy="36" r="1.1" fill="#ffffff" />
      <circle cx="68" cy="36" r="1.1" fill="#ffffff" />
      <path d="M56 44 L66 44 L61 51 Z" fill="#2b2b33" />
      <circle cx="49" cy="44" r="3" fill="#ff9d8a" opacity="0.7" />
      <circle cx="72" cy="44" r="3" fill="#ff9d8a" opacity="0.7" />
      {/* золотые завитки хвоста */}
      <g fill="none" stroke="#ffd76e" strokeWidth="3.5" strokeLinecap="round" className="vera-pet-glow">
        <path d="M48 92 Q36 96 33 106 Q42 104 46 97" />
        <path d="M70 92 Q82 96 85 106 Q76 104 72 97" />
      </g>
      {/* лапки */}
      <path d="M52 96 L50 102 M52 96 L55 101 M52 96 L47 100" fill="none" stroke="#2b2b33" strokeWidth="2" strokeLinecap="round" />
      <path d="M67 96 L65 102 M67 96 L70 101 M67 96 L72 100" fill="none" stroke="#2b2b33" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function PetSvg({ petId }: { petId: string }) {
  switch (petId) {
    case 'pet-fox': return <FoxArt />;
    case 'pet-bunny': return <BunnyArt />;
    case 'pet-pixel': return <PixelCatArt />;
    case 'pet-phoenix': return <PhoenixArt />;
    case 'pet-cat':
    default: return <CatArt />;
  }
}

/**
 * Рендерит арт питомца фиксированного размера (px).
 * `animate={false}` выключает CSS-анимации (предпросмотр в магазине и т.п.);
 * анимации также отключаются при системной настройке prefers-reduced-motion.
 */
export default function PetArtwork({ petId, size = 64, animate = true }: { petId: string; size?: number; animate?: boolean }) {
  const pet = findPet(petId);
  const showAnims = animate
    && typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!pet) return null;
  return (
    <Box
      aria-label={pet.name}
      sx={{ width: size, height: size, color: pet.color, lineHeight: 0, '--vera-pet-glow': `${pet.color}66` } as React.CSSProperties}
    >
      <svg
        viewBox="0 0 120 120"
        width="100%"
        height="100%"
        role="img"
        className={showAnims ? undefined : 'vera-pet-noanim'}
      >
        <style>{KEYFRAMES}</style>
        <PetSvg petId={petId} />
      </svg>
    </Box>
  );
}
