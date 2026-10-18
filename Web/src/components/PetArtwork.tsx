import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { findPet } from '../store/petCatalog';
import { getPetParticles } from '../utils/petParticles';

/**
 * Арт пятнадцати питомцев по референсам + лёгкие CSS-анимации:
 * дыхание, моргание, взмах крыльев, неоновое мерцание, «zZz» у лисы,
 * качание паука на нитке, язычок змеи, свечение тыквы и волна щупалец медузы.
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
@keyframes veraPetTap { 0%,100% { transform: scale(1) } 25% { transform: translateY(-6px) scale(1.12,.92) } 55% { transform: scale(.96,1.06) } }
@keyframes veraPetBurst { 0% { opacity: 0; transform: translate(0,0) scale(.3) } 15% { opacity: 1 } 100% { opacity: 0; transform: translate(var(--vera-pet-dx),var(--vera-pet-dy)) scale(.15) rotate(100deg) } }
@keyframes veraPetSwing { 0%,100% { transform: rotate(-5deg) } 50% { transform: rotate(5deg) } }
@keyframes veraPetSway { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
@keyframes veraPetTongue { 0%,64%,100% { transform: scaleY(1); opacity: 1 } 74% { transform: scaleY(1.55); opacity: .6 } 84% { transform: scaleY(1); opacity: 1 } }
@keyframes veraPetJackGlow { 0%,100% { opacity: .85; filter: drop-shadow(0 0 3px rgba(255,166,61,.5)) } 50% { opacity: 1; filter: drop-shadow(0 0 10px rgba(255,196,93,.95)) } }
@keyframes veraPetTentacle { 0%,100% { transform: skewX(-4deg) translateY(0) } 50% { transform: skewX(4deg) translateY(2px) } }
.vera-pet-tap { animation: veraPetTap .45s ease-out }
.vera-pet-swing { animation: veraPetSwing 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-sway { animation: veraPetSway 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
.vera-pet-tongue { animation: veraPetTongue 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-jackglow { animation: veraPetJackGlow 2.8s ease-in-out infinite }
.vera-pet-tentacle { animation: veraPetTentacle 3s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-particle { animation: veraPetBurst .8s ease-out both }
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
  .vera-pet-twinkle, .vera-pet-z, .vera-pet-tap, .vera-pet-swing, .vera-pet-sway,
  .vera-pet-tongue, .vera-pet-jackglow, .vera-pet-tentacle { animation: none !important }
  .vera-pet-particle { display: none !important }
}
`;

/* ── Пиксельный кот: сетка пикселей по референсу (чёрный кот, зелёные глаза) ── */
const PIXEL_COLORS: Record<string, string> = { K: '#171923', E: '#667089', P: '#343b50', G: '#a6f65b', W: '#efffdc', H: '#48536c', N: '#c18aa8' };
const PIXEL_CAT = [
  '....KK............KK....',
  '...KKK............KKK...',
  '..KNNKK..........KKNNK..',
  '.KKNNKKKKKKKKKKKKKKNNKK.',
  '.KPHHHHHHHHHHHHHHHHHHPK.',
  '.KPHHPPPPPPPPPPPPPPHHPK.',
  '.KKKKGGGGGKKKKGGGGGKKKK.',
  '.KKKKGWGGGKKKKGGGWGKKKK.',
  '.KKKKGGGGGKKKKGGGGGKKKK.',
  '.KKKKGGGGGKKKKGGGGGKKKK.',
  '.KWWWKKKKKKKKKKKKKKWWWK.',
  '.KWWKKKKKKKKKKKKKKKKWWK.',
  '..KKWKKKKKKKKKKKKKKWKK..',
  '..KKKKKKKKKKKKKKKKKKKK..',
  '...KPPKKKPPPPPPKKKPPK...',
  '...KPPKKPPHHHHPPKKPPK...',
  '...KPPKKPHHHHHHPKKPPK...',
  '...KPPKKPPHHHHPPKKPPK...',
  '..KKPPKKKPPPPPPKKKPPKK..',
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
        <path d="M55 55 H65 V60 H60 V65 H55 Z" fill="#c18aa8" />
        <path d="M50 65 H55 V70 H50 Z M60 65 H65 V70 H60 Z" fill="#a2adc4" />
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
            <stop offset="0%" stopColor="#ffbd72" />
            <stop offset="55%" stopColor="#f68b43" />
            <stop offset="100%" stopColor="#c95732" />
          </linearGradient>
        </defs>
        {/* свернутое тело и хвост */}
        <path d="M97 54 C103 76 90 98 63 101 C40 104 23 92 25 75 C27 63 39 58 43 47 C57 58 83 60 97 54 Z" fill="url(#veraPetFoxBody)" />
        <path d="M93 64 C97 83 84 97 62 99 C47 100 35 95 31 87 C41 91 53 91 63 87 C79 81 89 74 93 64 Z" fill="#e85f47" />
        <path d="M83 69 Q89 75 87 84" fill="none" stroke="#c84c3b" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
        <path d="M73 82 Q79 87 77 93" fill="none" stroke="#c84c3b" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
        {/* кремовый кончик хвоста у подбородка */}
        <path d="M99 62 C114 84 96 104 66 104 C43 105 25 97 24 83 C35 91 49 89 61 84 C78 77 89 67 99 62 Z" fill="url(#veraPetFoxBody)" stroke="#bc5838" strokeWidth="1.2" />
        <path d="M24 83 C35 91 49 89 61 84 L57 91 L65 93 L58 97 L64 104 C43 105 25 97 24 83 Z" fill="#fff0d5" />
        <path d="M71 96 Q91 92 98 78" fill="none" stroke="#ffd095" strokeWidth="2.5" strokeLinecap="round" />
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
        <path d="M28 45 Q49 28 71 45 L76 56 L70 56 L73 62 Q61 77 50 76 Q36 74 25 62 L30 60 L24 55 Z" fill="url(#veraPetFoxBody)" />
        {/* кремовая «маска» по мордочке */}
        <path d="M29 51 Q41 47 50 61 Q59 47 71 51 L68 62 Q61 69 50 73 Q38 69 32 62 Z" fill="#fff0d5" />
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
        <path d="M47 72 Q50 75 53 72" fill="none" stroke="#b44b43" strokeWidth="1.3" strokeLinecap="round" />
        <g stroke="#6e4540" strokeWidth="1" strokeLinecap="round" opacity="0.8">
          <path d="M35 67 L25 65" /><path d="M35 70 L26 72" />
          <path d="M65 67 L74 65" /><path d="M65 70 L74 72" />
        </g>
        <ellipse cx="43" cy="96" rx="8" ry="4" fill="#d9553f" />
        <ellipse cx="69" cy="96" rx="8" ry="4" fill="#d9553f" />
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
        <circle cx="60" cy="49" r="3" fill={neon} opacity="0.5" />
        <g className="vera-pet-blink" fill={neon}>
          <circle cx="49" cy="56" r="4.4" />
          <circle cx="71" cy="56" r="4.4" />
        </g>
        <path d="M57 64 L63 64 L60 67 Z M60 67 Q56 72 53 69 M60 67 Q64 72 67 69" fill="none" stroke={neon} strokeWidth="1.6" strokeLinecap="round" />
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
        <path d="M43 60 C29 53 17 39 10 22 Q5 46 18 61 L7 53 Q9 72 28 79 L16 76 Q26 92 43 82 Z" fill="url(#veraPetPhxWing)" stroke="#e85f47" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M13 35 Q20 58 37 67 M18 59 Q26 72 38 75" fill="none" stroke="#ffe7a0" strokeWidth="3" strokeLinecap="round" />
        <path d="M31 58 Q17 55 13 67 Q18 63 27 66" fill="none" stroke="#ffd76e" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        <path d="M29 67 Q18 70 18 80 Q23 74 31 74" fill="none" stroke="#ff9b4a" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="vera-pet-flap-r">
        <path d="M77 60 C91 53 103 39 110 22 Q115 46 102 61 L113 53 Q111 72 92 79 L104 76 Q94 92 77 82 Z" fill="url(#veraPetPhxWing)" stroke="#e85f47" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M107 35 Q100 58 83 67 M102 59 Q94 72 82 75" fill="none" stroke="#ffe7a0" strokeWidth="3" strokeLinecap="round" />
        <path d="M87 58 Q101 55 105 67 Q100 63 91 66" fill="none" stroke="#ffd76e" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        <path d="M89 67 Q100 70 100 80 Q95 74 87 74" fill="none" stroke="#ff9b4a" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* тело с брюшком-«чешуёй» */}
      <ellipse cx="59" cy="66" rx="24" ry="31" fill="#f4785a" />
      <ellipse cx="59" cy="78" rx="14" ry="17" fill="#ffd08a" />
      <path d="M48 60 Q59 54 70 60 Q67 66 59 68 Q51 66 48 60 Z" fill="#ff9b4a" opacity="0.8" />
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
      <path d="M56 44 L66 44 L61 50 L56 44 Z" fill="#7b2d25" />
      <path d="M58 48 L64 48" stroke="#ffd76e" strokeWidth="1.2" strokeLinecap="round" />
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
      <path d="M52 101 Q59 104 66 101" fill="none" stroke="#ffd76e" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

/* ── Пушистый паук: висит на нитке, лапки-крючки и большие глаза ── */
function SpiderArt() {
  return (
    <g className="vera-pet-swing">
      {/* нить, за которую паучок качается */}
      <path d="M60 0Q61 14 60 26" fill="none" stroke="#d8cfc4" strokeWidth="1.4" strokeLinecap="round" />
      <defs>
        <radialGradient id="veraPetSpiderBody" gradientUnits="userSpaceOnUse" cx="60" cy="52" r="46">
          <stop offset="0%" stopColor="#f6b16b" />
          <stop offset="55%" stopColor="#e08c42" />
          <stop offset="100%" stopColor="#ad5c20" />
        </radialGradient>
      </defs>
      {/* восемь лапок с изломом-«коленом» */}
      <g fill="none" stroke="#7c4a1e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 53Q31 45 28 35Q26 28 17 24" />
        <path d="M36 61Q25 59 18 51Q14 47 7 44" />
        <path d="M37 71Q25 75 19 85Q16 91 9 95" />
        <path d="M43 79Q35 89 33 99Q32 104 25 107" />
        <path d="M80 53Q89 45 92 35Q94 28 103 24" />
        <path d="M84 61Q95 59 102 51Q106 47 113 44" />
        <path d="M83 71Q95 75 101 85Q104 91 111 95" />
        <path d="M77 79Q85 89 87 99Q88 104 95 107" />
      </g>
      {/* пушистый контур: бугорки шёрстки под телом */}
      <g fill="url(#veraPetSpiderBody)" stroke="#7c3f16" strokeWidth="2.2">
        <circle cx="41" cy="47" r="8" />
        <circle cx="52" cy="40" r="8.5" />
        <circle cx="68" cy="40" r="8.5" />
        <circle cx="79" cy="47" r="8" />
        <circle cx="34" cy="58" r="7.5" />
        <circle cx="86" cy="58" r="7.5" />
        <circle cx="37" cy="71" r="7" />
        <circle cx="83" cy="71" r="7" />
      </g>
      <ellipse cx="60" cy="62" rx="27" ry="23" fill="url(#veraPetSpiderBody)" stroke="#7c3f16" strokeWidth="2.4" />
      {/* мягкая светлая мордочка */}
      <ellipse cx="60" cy="63" rx="19" ry="15" fill="#f9c98f" opacity="0.4" />
      {/* глаза: две большие, две поменьше и пара крохотных сверху */}
      <g className="vera-pet-blink">
        <g fill="#2f1c10">
          <circle cx="52" cy="60" r="7" />
          <circle cx="68" cy="60" r="7" />
          <circle cx="39" cy="52" r="3.6" />
          <circle cx="81" cy="52" r="3.6" />
          <circle cx="56" cy="45" r="1.7" />
          <circle cx="64" cy="45" r="1.7" />
        </g>
        <g fill="#ffffff">
          <circle cx="49.6" cy="57.4" r="2.6" />
          <circle cx="65.6" cy="57.4" r="2.6" />
          <circle cx="54.2" cy="62.6" r="1.2" />
          <circle cx="70.2" cy="62.6" r="1.2" />
          <circle cx="38" cy="51" r="1.2" />
          <circle cx="80" cy="51" r="1.2" />
        </g>
      </g>
      {/* румянец, рот и клыки */}
      <g fill="#e8875f" opacity="0.5">
        <circle cx="40" cy="68" r="3.6" />
        <circle cx="80" cy="68" r="3.6" />
      </g>
      <path d="M56 73q4 3 8 0" fill="none" stroke="#5a3113" strokeWidth="1.8" strokeLinecap="round" />
      <g fill="#fff6ea" stroke="#e2b489" strokeWidth="1.2" strokeLinejoin="round">
        <path d="M55.5 74.5h4L57.5 80Z" />
        <path d="M60.5 74.5h4L62.5 80Z" />
      </g>
    </g>
  );
}

/* ── Мягкий медвежонок: сидит, дышит и шевелит ушками ── */
function BearArt() {
  const fur = '#dfb08c';
  const light = '#f6e3cd';
  const outline = '#7a5140';
  return (
    <g className="vera-pet-float">
      <ellipse cx="60" cy="110" rx="34" ry="5" fill="#000000" opacity="0.2" />
      <g className="vera-pet-breathe">
        {/* ушки */}
        <g className="vera-pet-ear">
          <circle cx="41" cy="32" r="11" fill={fur} stroke={outline} strokeWidth="2.4" />
          <circle cx="41" cy="32" r="5.5" fill={light} />
        </g>
        <g className="vera-pet-ear" style={{ animationDelay: '0.7s' }}>
          <circle cx="79" cy="32" r="11" fill={fur} stroke={outline} strokeWidth="2.4" />
          <circle cx="79" cy="32" r="5.5" fill={light} />
        </g>
        {/* тело */}
        <ellipse cx="60" cy="86" rx="27" ry="21" fill={fur} stroke={outline} strokeWidth="2.4" />
        {/* задние лапы с подушечками */}
        <g stroke={outline} strokeWidth="2.2">
          <ellipse cx="28" cy="94" rx="11" ry="13" fill={fur} transform="rotate(-10 28 94)" />
          <ellipse cx="92" cy="94" rx="11" ry="13" fill={fur} transform="rotate(10 92 94)" />
        </g>
        <ellipse cx="28" cy="97" rx="6" ry="7.5" fill={light} transform="rotate(-10 28 97)" />
        <ellipse cx="92" cy="97" rx="6" ry="7.5" fill={light} transform="rotate(10 92 97)" />
        <g fill={light}>
          <circle cx="23" cy="85" r="2.4" /><circle cx="28" cy="83" r="2.4" /><circle cx="33" cy="85" r="2.4" />
          <circle cx="87" cy="85" r="2.4" /><circle cx="92" cy="83" r="2.4" /><circle cx="97" cy="85" r="2.4" />
        </g>
        {/* передние лапки */}
        <g stroke={outline} strokeWidth="2.2">
          <ellipse cx="49" cy="99" rx="9" ry="7.5" fill={fur} />
          <ellipse cx="71" cy="99" rx="9" ry="7.5" fill={fur} />
        </g>
        {/* голова */}
        <circle cx="60" cy="52" r="25" fill={fur} stroke={outline} strokeWidth="2.4" />
        <ellipse cx="60" cy="60" rx="10.5" ry="8" fill={light} />
        <path d="M57 57l6 6M63 57l-6 6" fill="none" stroke="#4a3226" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M60 63v1.5M56.5 66.5q3.5 2.5 7 0" fill="none" stroke="#4a3226" strokeWidth="1.6" strokeLinecap="round" />
        <g className="vera-pet-blink" fill="#4a3226">
          <circle cx="51" cy="50" r="3.2" />
          <circle cx="69" cy="50" r="3.2" />
        </g>
        <g fill="#f0a6a6" opacity="0.8">
          <circle cx="43" cy="59" r="4.2" />
          <circle cx="77" cy="59" r="4.2" />
        </g>
      </g>
    </g>
  );
}

/* ── Зелёная змея: свернулась кольцами и шипит язычком ── */
function SnakeArt() {
  return (
    <g className="vera-pet-float">
      <defs>
        <linearGradient id="veraPetSnakeRing1" gradientUnits="userSpaceOnUse" x1="60" y1="82" x2="60" y2="107">
          <stop offset="0%" stopColor="#7cae3a" />
          <stop offset="100%" stopColor="#547f27" />
        </linearGradient>
        <linearGradient id="veraPetSnakeRing2" gradientUnits="userSpaceOnUse" x1="60" y1="71" x2="60" y2="94">
          <stop offset="0%" stopColor="#95c94a" />
          <stop offset="100%" stopColor="#6b9a2f" />
        </linearGradient>
        <linearGradient id="veraPetSnakeRing3" gradientUnits="userSpaceOnUse" x1="60" y1="62" x2="60" y2="83">
          <stop offset="0%" stopColor="#a8d65e" />
          <stop offset="100%" stopColor="#7cae3a" />
        </linearGradient>
        <linearGradient id="veraPetSnakeHead" gradientUnits="userSpaceOnUse" x1="50" y1="32" x2="72" y2="58">
          <stop offset="0%" stopColor="#b3e06a" />
          <stop offset="100%" stopColor="#83b83e" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="110" rx="36" ry="5" fill="#000000" opacity="0.2" />
      {/* хвостик с заострённым кончиком */}
      <g strokeLinecap="round" fill="none">
        <path d="M84 96q14 3 20-6" stroke="#21301a" strokeWidth="11" />
        <path d="M84 96q14 3 20-6" stroke="#6f9e33" strokeWidth="7" />
        <path d="M104 90q3-3 3-7" stroke="#21301a" strokeWidth="6" />
        <path d="M104 90q3-3 3-7" stroke="#8fc93f" strokeWidth="3" />
      </g>
      {/* три витка: задний темнее, передний светлее */}
      <ellipse cx="60" cy="94" rx="35" ry="13" fill="url(#veraPetSnakeRing1)" stroke="#21301a" strokeWidth="2.6" />
      <ellipse cx="60" cy="97" rx="27" ry="6.5" fill="#f4e9cf" stroke="#21301a" strokeWidth="1.6" />
      <g stroke="#dcc9a0" strokeWidth="1.4" strokeLinecap="round">
        <path d="M44 96.5v4.5M52 98v4.5M60 98.5v4.5M68 98v4.5M76 96.5v4.5" />
      </g>
      <ellipse cx="60" cy="82" rx="31" ry="12" fill="url(#veraPetSnakeRing2)" stroke="#21301a" strokeWidth="2.6" />
      <ellipse cx="60" cy="85" rx="22" ry="5.5" fill="#f4e9cf" stroke="#21301a" strokeWidth="1.6" />
      <g stroke="#dcc9a0" strokeWidth="1.3" strokeLinecap="round">
        <path d="M50 84.5v4M57 85.5v4M64 85.5v4M71 84.5v4" />
      </g>
      <ellipse cx="60" cy="72" rx="26" ry="11" fill="url(#veraPetSnakeRing3)" stroke="#21301a" strokeWidth="2.6" />
      {/* крапинки на витках */}
      <g fill="#5f8f2e" opacity="0.8">
        <circle cx="33" cy="95" r="3.4" />
        <circle cx="87" cy="95" r="3.4" />
        <circle cx="34" cy="82" r="2.6" />
        <circle cx="86" cy="82" r="2.6" />
        <circle cx="41" cy="71" r="2.2" />
        <circle cx="79" cy="71" r="2.2" />
      </g>
      {/* голова качается, язычок периодически высовывается */}
      <g className="vera-pet-sway">
        <path d="M51 79Q47 57 60 43Q73 57 69 79Z" fill="url(#veraPetSnakeHead)" stroke="#21301a" strokeWidth="2.4" strokeLinejoin="round" />
        <ellipse cx="60" cy="44" rx="17" ry="13.5" fill="url(#veraPetSnakeHead)" stroke="#21301a" strokeWidth="2.4" />
        <path d="M48 38q7-8 18-6" fill="none" stroke="#e2f7b4" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
        <g fill="#5f8f2e" opacity="0.75">
          <circle cx="52" cy="35" r="2" />
          <circle cx="66" cy="34" r="2.4" />
        </g>
        {/* глаза с двумя бликами */}
        <g className="vera-pet-blink">
          <g fill="#21301a">
            <circle cx="53" cy="44" r="4" />
            <circle cx="67" cy="44" r="4" />
          </g>
          <g fill="#ffffff">
            <circle cx="51.5" cy="42.4" r="1.5" />
            <circle cx="65.5" cy="42.4" r="1.5" />
            <circle cx="54.3" cy="45.6" r="0.8" />
            <circle cx="68.3" cy="45.6" r="0.8" />
          </g>
        </g>
        {/* румянец и ноздри */}
        <g fill="#f2a6a6" opacity="0.7">
          <ellipse cx="46" cy="50" rx="3.6" ry="2.4" />
          <ellipse cx="74" cy="50" rx="3.6" ry="2.4" />
        </g>
        <g fill="#21301a">
          <circle cx="57" cy="49.5" r="0.9" />
          <circle cx="63" cy="49.5" r="0.9" />
        </g>
        <path d="M53 52q7 5 14 0" fill="none" stroke="#21301a" strokeWidth="1.7" strokeLinecap="round" />
        <g className="vera-pet-tongue" stroke="#e2657f" strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M60 53.5v6" />
          <path d="M60 59.5q-2 3-4 3.5" />
          <path d="M60 59.5q2 3 4 3.5" />
        </g>
      </g>
    </g>
  );
}

/* ── Светящийся Джек: рыжая тыква с пульсирующим лицом-фонарём ── */
function PumpkinArt() {
  return (
    <g className="vera-pet-float">
      <defs>
        <radialGradient id="veraPetPumpkinBody" gradientUnits="userSpaceOnUse" cx="50" cy="44" r="72">
          <stop offset="0%" stopColor="#ffc178" />
          <stop offset="45%" stopColor="#f9933c" />
          <stop offset="100%" stopColor="#d76a12" />
        </radialGradient>
        <radialGradient id="veraPetPumpkinGlow" gradientUnits="userSpaceOnUse" cx="60" cy="74" r="34">
          <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffb347" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="101" rx="34" ry="4.5" fill="#000000" opacity="0.2" />
      {/* серый стебель, слегка покачивается */}
      <g className="vera-pet-ear">
        <path d="M60 38c0-11 5-19 15-22 3.5-1 6 3.5 2.5 5.5-6.5 3.5-9.5 9-9.5 16.5z" fill="#6b6f75" stroke="#2b2320" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M64 33c1-6 4-10 9-12" fill="none" stroke="#8d9298" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* верхние бугры-доли дают ребристый силуэт */}
      <g fill="url(#veraPetPumpkinBody)" stroke="#2b2320" strokeWidth="2.6">
        <circle cx="41" cy="45" r="15" />
        <circle cx="60" cy="41" r="16" />
        <circle cx="79" cy="45" r="15" />
      </g>
      {/* тело */}
      <ellipse cx="60" cy="68" rx="37" ry="30" fill="url(#veraPetPumpkinBody)" stroke="#2b2320" strokeWidth="3" />
      {/* линии долей и мягкий блик */}
      <g fill="none" stroke="#c8600f" strokeWidth="2.4" strokeLinecap="round" opacity="0.9">
        <path d="M45 43Q37 55 37 68t8 27" />
        <path d="M75 43Q83 55 83 68t-8 27" />
      </g>
      <path d="M36 44q7-9 18-10" fill="none" stroke="#ffe0b0" strokeWidth="3.5" strokeLinecap="round" opacity="0.55" />
      {/* внутреннее свечение фонаря */}
      <ellipse cx="60" cy="74" rx="27" ry="17" fill="url(#veraPetPumpkinGlow)" />
      {/* лицо-фонарь: глаза-треугольники и зубастая ухмылка */}
      <g className="vera-pet-jackglow" fill="#241d1a" stroke="#241d1a" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M39 66l9-15 9 15z" />
        <path d="M63 66l9-15 9 15z" />
        <path d="M34 77Q60 96 86 77L74 77 71 82 66 77 58 77 55 81 50 77 34 77Z" />
      </g>
    </g>
  );
}

/* ── Сияющая медуза: полупрозрачный купол и волна щупалец ── */
function JellyfishArt() {
  return (
    <g className="vera-pet-float">
      <defs>
        <radialGradient id="veraPetJellyBell" cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffe9f3" />
          <stop offset="70%" stopColor="#ffc9de" />
          <stop offset="100%" stopColor="#ffaed0" />
        </radialGradient>
      </defs>
      {/* щупальца — покачиваются волной */}
      <g className="vera-pet-tentacle" fill="none" stroke="#e98bb4" strokeWidth="6" strokeLinecap="round">
        <path d="M34 70q-5 9 0 17t0 17" />
        <path d="M45 72q-5 9 0 17t0 17" />
        <path d="M56 73q-5 9 0 17t0 17" />
        <path d="M67 73q-5 9 0 17t0 17" />
        <path d="M78 72q-5 9 0 17t0 17" />
        <path d="M89 70q-5 9 0 17t0 17" />
      </g>
      {/* купол со свечением */}
      <g className="vera-pet-glowpulse">
        <path d="M60 20c-21 0-38 16-38 36 0 8 5 13 13 13h50c8 0 13-5 13-13 0-20-17-36-38-36Z" fill="url(#veraPetJellyBell)" stroke="#d06a97" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M37 56c1-14 11-24 23-24s22 10 23 24z" fill="#f7a8cd" opacity="0.9" />
        <path d="M56 21q4-3 8 0" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="44" cy="34" rx="6.5" ry="4" fill="#ffffff" opacity="0.85" transform="rotate(-32 44 34)" />
        <g fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
          <path d="M74 38q5 6 5 13" />
          <path d="M81 44q4 5 4 10" />
        </g>
        {/* мордочка */}
        <g className="vera-pet-blink">
          <g fill="#2b1a22">
            <circle cx="52" cy="47" r="4.2" />
            <circle cx="68" cy="47" r="4.2" />
          </g>
          <g fill="#ffffff">
            <circle cx="50.5" cy="45.5" r="1.3" />
            <circle cx="66.5" cy="45.5" r="1.3" />
          </g>
        </g>
        <path d="M57.5 55q2.5 2.5 5 0" fill="none" stroke="#2b1a22" strokeWidth="1.8" strokeLinecap="round" />
        <g fill="#f2889f" opacity="0.75">
          <circle cx="43" cy="53" r="3.6" />
          <circle cx="77" cy="53" r="3.6" />
        </g>
      </g>
    </g>
  );
}

/* ── Панда: милый чиби, огромные глаза с бликами, обнимает лапками ── */
function PandaArt() {
  const ink = '#26262c';
  return (
    <g className="vera-pet-float">
      <ellipse cx="60" cy="112" rx="30" ry="4" fill="#000000" opacity="0.16" />
      <g className="vera-pet-breathe">
        {/* уши */}
        <circle cx="37" cy="25" r="12" fill={ink} />
        <circle cx="83" cy="25" r="12" fill={ink} />
        <circle cx="37" cy="25" r="5" fill="#4c4c56" />
        <circle cx="83" cy="25" r="5" fill="#4c4c56" />
        {/* большая круглая голова */}
        <circle cx="60" cy="46" r="27" fill="#ffffff" stroke={ink} strokeWidth="2.4" />
        {/* пятна глаз — мягкие */}
        <ellipse cx="47" cy="45" rx="9.5" ry="11.5" transform="rotate(18 47 45)" fill={ink} />
        <ellipse cx="73" cy="45" rx="9.5" ry="11.5" transform="rotate(-18 73 45)" fill={ink} />
        {/* огромные глаза с двумя бликами */}
        <g className="vera-pet-blink">
          <circle cx="48" cy="46" r="5" fill="#ffffff" />
          <circle cx="72" cy="46" r="5" fill="#ffffff" />
          <circle cx="48.8" cy="47.4" r="2.9" fill="#1c1c24" />
          <circle cx="72.8" cy="47.4" r="2.9" fill="#1c1c24" />
          <circle cx="47" cy="43.8" r="1.5" fill="#ffffff" />
          <circle cx="71" cy="43.8" r="1.5" fill="#ffffff" />
        </g>
        {/* румянец */}
        <g fill="#ff9fb0" opacity="0.7">
          <circle cx="38" cy="56" r="4.5" />
          <circle cx="82" cy="56" r="4.5" />
        </g>
        {/* нос и ротик ω */}
        <path d="M56 55q4-2.6 8 0-1 4-4 4t-4-4Z" fill={ink} />
        <path d="M54 61q3 3.6 6 0 3 3.6 6 0" fill="none" stroke={ink} strokeWidth="1.7" strokeLinecap="round" />
        {/* круглое тело */}
        <ellipse cx="60" cy="86" rx="27" ry="23" fill="#ffffff" stroke={ink} strokeWidth="2.4" />
        {/* лапы обнимают животик */}
        <ellipse cx="41" cy="84" rx="9" ry="13.5" transform="rotate(16 41 84)" fill={ink} />
        <ellipse cx="79" cy="84" rx="9" ry="13.5" transform="rotate(-16 79 84)" fill={ink} />
        {/* подушечки лапок */}
        <g fill="#ff9fb0">
          <ellipse cx="43" cy="91" rx="3.4" ry="2.8" />
          <ellipse cx="77" cy="91" rx="3.4" ry="2.8" />
        </g>
        {/* ножки */}
        <ellipse cx="45" cy="105" rx="10.5" ry="6.5" fill={ink} />
        <ellipse cx="75" cy="105" rx="10.5" ry="6.5" fill={ink} />
        <g fill="#ff9fb0">
          <ellipse cx="43" cy="105" rx="3" ry="2.4" />
          <ellipse cx="48.5" cy="107.5" rx="2" ry="1.7" />
          <ellipse cx="77" cy="105" rx="3" ry="2.4" />
          <ellipse cx="71.5" cy="107.5" rx="2" ry="1.7" />
        </g>
      </g>
    </g>
  );
}

/* ── Румяный ёжик: круглый колючий шарик, крупная мордочка и оливковые листья ── */
function hedgehogSpikes() {
  const pts: string[] = [];
  const spikes = 20;
  for (let i = 0; i < spikes; i += 1) {
    const a1 = (Math.PI * 2 * i) / spikes - Math.PI / 2;
    const a2 = (Math.PI * 2 * (i + 0.5)) / spikes - Math.PI / 2;
    pts.push(`${i === 0 ? 'M' : 'L'}${(60 + Math.cos(a1) * 46).toFixed(1)} ${(70 + Math.sin(a1) * 42).toFixed(1)}`);
    pts.push(`L${(60 + Math.cos(a2) * 33).toFixed(1)} ${(70 + Math.sin(a2) * 30).toFixed(1)}`);
  }
  return `${pts.join('')}Z`;
}

function HedgehogArt() {
  return (
    <g className="vera-pet-float">
      <ellipse cx="60" cy="111" rx="32" ry="4" fill="#000000" opacity="0.16" />
      {/* оливковые листики вокруг */}
      <g className="vera-pet-sway" style={{ animationDelay: '.6s' }}>
        <path d="M20 42q-9-9-2-14 8 1 8 9Z" fill="#9aae55" stroke="#5d7033" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g className="vera-pet-sway" style={{ animationDelay: '1.4s' }}>
        <path d="M100 30q9-8 14-1-2 8-10 9Z" fill="#c3d477" stroke="#71833c" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g className="vera-pet-breathe">
        {/* колючий шар */}
        <path d={hedgehogSpikes()} fill="#7a5236" stroke="#52331f" strokeWidth="1.8" strokeLinejoin="round" />
        {/* крупная светлая морда-пуфик */}
        <path d="M60 38c-17 0-28 13-28 30 0 19 12 32 28 32s28-13 28-32c0-17-11-30-28-30Z" fill="#f6e3c8" stroke="#c9a275" strokeWidth="2" />
        {/* ушки */}
        <circle cx="42" cy="42" r="6.5" fill="#f6e3c8" stroke="#8a5c3b" strokeWidth="2" />
        <circle cx="78" cy="42" r="6.5" fill="#f6e3c8" stroke="#8a5c3b" strokeWidth="2" />
        {/* большие глазки с двумя бликами */}
        <g className="vera-pet-blink">
          <g fill="#2e2118">
            <circle cx="50" cy="64" r="4.8" />
            <circle cx="70" cy="64" r="4.8" />
          </g>
          <g fill="#ffffff">
            <circle cx="48.6" cy="62.2" r="1.7" />
            <circle cx="68.6" cy="62.2" r="1.7" />
            <circle cx="51.8" cy="66.4" r="0.9" />
            <circle cx="71.8" cy="66.4" r="0.9" />
          </g>
        </g>
        {/* нос и улыбка */}
        <ellipse cx="60" cy="73" rx="3.4" ry="2.6" fill="#2e2118" />
        <path d="M60 76v2M55 80q5 4 10 0" fill="none" stroke="#8a5c3b" strokeWidth="1.8" strokeLinecap="round" />
        {/* румянец */}
        <g fill="#f0a3a8" opacity="0.75">
          <circle cx="42" cy="74" r="4" />
          <circle cx="78" cy="74" r="4" />
        </g>
        {/* лапки */}
        <ellipse cx="48" cy="103" rx="7" ry="5" fill="#8a5c3b" stroke="#52331f" strokeWidth="1.8" />
        <ellipse cx="72" cy="103" rx="7" ry="5" fill="#8a5c3b" stroke="#52331f" strokeWidth="1.8" />
      </g>
    </g>
  );
}

/* ── Ореховая белка: пушистый хвост-спираль, кремовый животик и жёлудь в лапках ── */
function SquirrelArt() {
  const fur = '#dd9a58';
  const furDark = '#8a5430';
  const cream = '#f6e3c8';
  return (
    <g className="vera-pet-float">
      <ellipse cx="62" cy="111" rx="28" ry="4" fill="#000000" opacity="0.16" />
      <g className="vera-pet-breathe">
        {/* большой хвост-спираль */}
        <path d="M40 102C14 92 12 44 40 30c18-9 34 4 28 20-4 11-17 13-21 4-3-7 4-12 10-9" fill="none" stroke={furDark} strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M40 102C14 92 12 44 40 30c18-9 34 4 28 20-4 11-17 13-21 4-3-7 4-12 10-9" fill="none" stroke={fur} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M40 102C14 92 12 44 40 30c18-9 34 4 28 20" fill="none" stroke="#f6c68b" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
        {/* тело */}
        <path d="M64 56c-14 0-24 12-24 28 0 14 10 24 24 24s24-10 24-24c0-16-10-28-24-28Z" fill={fur} stroke={furDark} strokeWidth="2.2" />
        <ellipse cx="66" cy="88" rx="13" ry="15" fill={cream} />
        {/* ушки */}
        <circle cx="50" cy="34" r="7.5" fill={fur} stroke={furDark} strokeWidth="2" />
        <circle cx="78" cy="34" r="7.5" fill={fur} stroke={furDark} strokeWidth="2" />
        <circle cx="50" cy="35" r="3.5" fill="#f6c68b" />
        <circle cx="78" cy="35" r="3.5" fill="#f6c68b" />
        {/* голова */}
        <circle cx="64" cy="48" r="19" fill={fur} stroke={furDark} strokeWidth="2.2" />
        <ellipse cx="64" cy="54" rx="10" ry="8" fill={cream} />
        <g className="vera-pet-blink">
          <g fill="#33241a">
            <circle cx="57" cy="46" r="4.3" />
            <circle cx="71" cy="46" r="4.3" />
          </g>
          <g fill="#ffffff">
            <circle cx="55.6" cy="44.4" r="1.5" />
            <circle cx="69.6" cy="44.4" r="1.5" />
            <circle cx="58.6" cy="48.2" r="0.8" />
            <circle cx="72.6" cy="48.2" r="0.8" />
          </g>
        </g>
        <ellipse cx="64" cy="53" rx="2.6" ry="2" fill="#33241a" />
        <path d="M64 55v2M60 59q4 3 8 0" fill="none" stroke={furDark} strokeWidth="1.6" strokeLinecap="round" />
        <g fill="#f0a3a8" opacity="0.7">
          <circle cx="49" cy="53" r="3.4" />
          <circle cx="79" cy="53" r="3.4" />
        </g>
        {/* жёлудь в лапках */}
        <g className="vera-pet-ear" style={{ transformOrigin: '64px 74px' }}>
          <path d="M58 76h12v6q-6 5-12 0Z" fill="#c98a4b" stroke="#7c4a26" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M56 70q8-4 16 0l-1 6q-7-3-14 0Z" fill="#7c4a26" stroke="#5b3418" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M64 66v-4" stroke="#5b3418" strokeWidth="2" strokeLinecap="round" />
        </g>
        <ellipse cx="54" cy="84" rx="6.5" ry="5" transform="rotate(-20 54 84)" fill={fur} stroke={furDark} strokeWidth="1.8" />
        <ellipse cx="74" cy="84" rx="6.5" ry="5" transform="rotate(20 74 84)" fill={fur} stroke={furDark} strokeWidth="1.8" />
        {/* лапки внизу */}
        <ellipse cx="56" cy="105" rx="7.5" ry="4.5" fill={fur} stroke={furDark} strokeWidth="1.8" />
        <ellipse cx="74" cy="105" rx="7.5" ry="4.5" fill={fur} stroke={furDark} strokeWidth="1.8" />
      </g>
    </g>
  );
}

/* ── Пиксельный дракон: один крупный чиби-дракон, клетка 10px, чтобы пиксели читались ── */
const DRAGON_COLORS: Record<string, string> = {
  K: '#1c5a30', G: '#4fc44f', L: '#a7ed8e', D: '#2e8b46', Y: '#ffd98a', W: '#ffffff', E: '#182218', P: '#ff9fb0',
};
const PIXEL_DRAGON = [
  '..Y......Y..',
  '.KY......YK.',
  '.KGGGGGGGGK.',
  '.KGWEGGWEWK.',
  '.KGEEGGEEGK.',
  '.KGPKGKGPGK.',
  '.KGGGGGGGGK.',
  'DDKGLLLLGKDD',
  '.DKGLLLLGKDY',
  '..KGLLLLGK.G',
  '..KYKGGKYKGG',
];

function PixelDragonArt() {
  const cell = 10;
  const offsetY = (120 - PIXEL_DRAGON.length * cell) / 2;
  return (
    <g className="vera-pet-float" transform={`translate(0 ${offsetY})`} shapeRendering="crispEdges">
      <ellipse cx="60" cy={PIXEL_DRAGON.length * cell - 1} rx="34" ry="4" fill="#000000" opacity="0.16" />
      {PIXEL_DRAGON.map((row, y) => row.split('').map((ch, x) => {
        const color = DRAGON_COLORS[ch];
        return color ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={color} /> : null;
      }))}
    </g>
  );
}

/* ── Летучая мышь: пушистое серо-фиолетовое тело, розовые перепонки и клыки ── */
function BatArt() {
  const fur = '#7b7391';
  const furDark = '#4e475f';
  const membrane = '#f2a7bd';
  const membraneDark = '#d3798f';
  return (
    <g className="vera-pet-float">
      <ellipse cx="60" cy="110" rx="26" ry="4" fill="#000000" opacity="0.16" />
      {/* крылья-перепонки */}
      <g className="vera-pet-flap-l">
        <path d="M47 58Q33 44 10 38q4 9 3 16-7-2-11 3 8 3 8 9-6-1-9 4 10 1 12 7 4-5 10-5 2-8 5-12 8 2 14 1Z" fill={membrane} stroke={membraneDark} strokeWidth="2" strokeLinejoin="round" />
        <path d="M46 60 14 43M45 67 11 61M44 74l-11 7" fill="none" stroke={membraneDark} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <g className="vera-pet-flap-r">
        <path d="M73 58q14-14 37-20-4 9-3 16 7-2 11 3-8 3-8 9 6-1 9 4-10 1-12 7-4-5-10-5-2-8-5-12-8 2-14 1Z" fill={membrane} stroke={membraneDark} strokeWidth="2" strokeLinejoin="round" />
        <path d="M74 60l32-17M75 67l34-6M76 74l11 7" fill="none" stroke={membraneDark} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <g className="vera-pet-breathe">
        {/* большие уши с розовой серединой */}
        <path d="M46 34q-9-16-1-22 8 4 13 17Z" fill={fur} stroke={furDark} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M74 34q9-16 1-22-8 4-13 17Z" fill={fur} stroke={furDark} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M47 31q-5-10-1-14 5 3 8 11Z" fill={membrane} />
        <path d="M73 31q5-10 1-14-5 3-8 11Z" fill={membrane} />
        {/* тело с головой */}
        <path d="M60 24c-12 0-20 9-20 19 0 5 2 9 4 12-2 5-3 11-3 16 0 13 8 22 19 22s19-9 19-22c0-5-1-11-3-16 2-3 4-7 4-12 0-10-8-19-19-19Z" fill={fur} stroke={furDark} strokeWidth="2.4" />
        {/* пушистый животик */}
        <ellipse cx="60" cy="77" rx="12" ry="14" fill="#9d95b0" />
        {/* большие глазки с двумя бликами */}
        <g className="vera-pet-blink">
          <g fill={furDark}>
            <circle cx="52" cy="45" r="4.6" />
            <circle cx="68" cy="45" r="4.6" />
          </g>
          <g fill="#ffffff">
            <circle cx="50.6" cy="43.2" r="1.6" />
            <circle cx="66.6" cy="43.2" r="1.6" />
            <circle cx="53.8" cy="47.4" r="0.9" />
            <circle cx="69.8" cy="47.4" r="0.9" />
          </g>
        </g>
        {/* нос, улыбка и клыки */}
        <ellipse cx="60" cy="53" rx="2.6" ry="2" fill={furDark} />
        <path d="M55 57q5 4.5 10 0" fill="none" stroke={furDark} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M56 59l1.4 4 1.4-4ZM61.2 59l1.4 4 1.4-4Z" fill="#ffffff" stroke={furDark} strokeWidth="0.7" strokeLinejoin="round" />
        {/* румянец */}
        <g fill={membrane} opacity="0.75">
          <circle cx="45" cy="53" r="3.2" />
          <circle cx="75" cy="53" r="3.2" />
        </g>
        {/* лапки-коготки */}
        <path d="M52 91l-3 5M52 91v6M52 91l3 5M68 91l3 5M68 91v6M68 91l-3 5" fill="none" stroke={furDark} strokeWidth="2" strokeLinecap="round" />
      </g>
    </g>
  );
}

function PetSvg({ petId }: { petId: string }) {
  switch (petId) {
    case 'pet-fox': return <FoxArt />;
    case 'pet-bunny': return <BunnyArt />;
    case 'pet-pixel': return <PixelCatArt />;
    case 'pet-phoenix': return <PhoenixArt />;
    case 'pet-spider': return <SpiderArt />;
    case 'pet-bear': return <BearArt />;
    case 'pet-snake': return <SnakeArt />;
    case 'pet-pumpkin': return <PumpkinArt />;
    case 'pet-jellyfish': return <JellyfishArt />;
    case 'pet-panda': return <PandaArt />;
    case 'pet-hedgehog': return <HedgehogArt />;
    case 'pet-squirrel': return <SquirrelArt />;
    case 'pet-pixel-dragon': return <PixelDragonArt />;
    case 'pet-bat': return <BatArt />;
    case 'pet-cat':
    default: return <CatArt />;
  }
}

/**
 * Рендерит арт питомца фиксированного размера (px).
 * `animate={false}` выключает CSS-анимации (предпросмотр в магазине и т.п.);
 * анимации также отключаются при системной настройке prefers-reduced-motion.
 */
export default function PetArtwork({ petId, size = 64, animate = true, reaction = 0 }: { petId: string; size?: number; animate?: boolean; reaction?: number }) {
  const pet = findPet(petId);
  const showAnims = animate
    && typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const previousReaction = useRef(reaction);
  const [burst, setBurst] = useState<number | null>(null);
  useEffect(() => {
    if (previousReaction.current === reaction) return;
    previousReaction.current = reaction;
    if (!showAnims) { setBurst(null); return; }
    setBurst(reaction);
  }, [reaction, showAnims]);
  useEffect(() => {
    if (burst === null) return;
    const timer = window.setTimeout(() => setBurst(null), 950);
    return () => window.clearTimeout(timer);
  }, [burst]);
  if (!pet) return null;
  return (
    <Box
      aria-label={pet.name}
      sx={{ position: 'relative', width: size, height: size, overflow: 'visible', color: pet.color, lineHeight: 0, '--vera-pet-glow': `${pet.color}66` } as React.CSSProperties}
    >
      <svg
        viewBox="0 0 120 120"
        width="100%"
        height="100%"
        role="img"
        className={showAnims ? undefined : 'vera-pet-noanim'}
        style={{ overflow: 'visible', pointerEvents: 'visiblePainted' }}
      >
        <style>{KEYFRAMES}</style>
        <g key={burst ?? 'idle'} className={burst !== null && showAnims ? 'vera-pet-tap' : undefined} style={{ transformOrigin: '60px 70px' }}>
          <PetSvg petId={petId} />
        </g>
      </svg>
      {burst !== null && showAnims && (
        <svg key={`burst-${burst}`} viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {getPetParticles(petId).map((particle, index) => (
            <g key={index} transform="translate(60 60)">
              <g className="vera-pet-particle" fill={particle.color} style={{
                '--vera-pet-dx': `${particle.dx}px`, '--vera-pet-dy': `${particle.dy}px`,
                animationDelay: `${particle.delay}ms`,
                filter: particle.kind === 'pixel' ? undefined : `drop-shadow(0 0 3px ${particle.color})`,
              } as React.CSSProperties}>
                {particle.kind === 'star' ? <path d="M0 -6 L2 -2 L6 0 L2 2 L0 6 L-2 2 L-6 0 L-2 -2 Z" />
                  : particle.kind === 'bubble' ? <circle r={particle.size} fill="none" stroke={particle.color} strokeWidth="1.5" />
                  : particle.kind === 'spark' ? <path d="M1 -7 L-4 1 L0 1 L-1 7 L4 -1 L0 -1 Z" />
                  : particle.kind === 'pixel' ? <rect x={-particle.size / 2} y={-particle.size / 2} width={particle.size} height={particle.size} />
                  : particle.kind === 'heart' ? <path d="M0 5C-5.5 1-5-4-2.4-4c1.1 0 2 .9 2.4 1.9C.4-3.1 1.3-4 2.4-4 5-4 5.5 1 0 5Z" />
                  : <path d="M0 -7 Q6 0 3 4 Q0 7 -3 4 Q-6 0 0 -7 Z" />}
              </g>
            </g>
          ))}
        </svg>
      )}
    </Box>
  );
}
