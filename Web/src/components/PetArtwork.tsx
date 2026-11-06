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
@keyframes veraPetJackFlame { 0%,100% { opacity: .6; transform: scaleY(1) } 20% { opacity: 1; transform: scaleY(1.15) } 40% { opacity: .75; transform: scaleY(.92) } 60% { opacity: .95; transform: scaleY(1.08) } 80% { opacity: .8; transform: scaleY(.96) } }
@keyframes veraPetTentacle1 { 0%,100% { transform: skewX(-5deg) translateY(0) } 50% { transform: skewX(6deg) translateY(3px) } }
@keyframes veraPetTentacle2 { 0%,100% { transform: skewX(4deg) translateY(1px) } 50% { transform: skewX(-5deg) translateY(-2px) } }
@keyframes veraPetTentacle3 { 0%,100% { transform: skewX(-3deg) translateY(-1px) } 50% { transform: skewX(4deg) translateY(2px) } }
@keyframes veraPetTentacle4 { 0%,100% { transform: skewX(5deg) translateY(0) } 50% { transform: skewX(-4deg) translateY(3px) } }
@keyframes veraPetTentacle5 { 0%,100% { transform: skewX(-4deg) translateY(2px) } 50% { transform: skewX(5deg) translateY(-1px) } }
@keyframes veraPetTentacle6 { 0%,100% { transform: skewX(3deg) translateY(1px) } 50% { transform: skewX(-6deg) translateY(2px) } }
@keyframes veraPetWobble { 0%,100% { transform: rotate(-3deg) scale(1,1) } 25% { transform: rotate(0deg) scale(1.03,.97) } 50% { transform: rotate(3deg) scale(1,1) } 75% { transform: rotate(0deg) scale(.97,1.03) } }
@keyframes veraPetBoop { 0%,60%,100% { transform: translateY(0) scale(1,1) } 70% { transform: translateY(-6px) scale(1.06,.94) } 82% { transform: translateY(0) scale(.95,1.05) } 90% { transform: translateY(-2px) scale(1,1) } }
@keyframes veraPetAura { 0%,100% { opacity: .35; transform: scale(.9) } 50% { opacity: .85; transform: scale(1.12) } }
@keyframes veraPetSparkleSpin { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }
@keyframes veraPetSparklePop { 0%,100% { opacity: .2; transform: scale(.5) } 50% { opacity: 1; transform: scale(1.2) } }
@keyframes veraPetWink { 0%,46%,54%,100% { transform: scaleY(1) } 50% { transform: scaleY(.08) } }
@keyframes veraPetLegWiggle { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(2.5deg) } }
@keyframes veraPetHeartUp { 0% { opacity: 0; transform: translateY(0) scale(.4) } 20% { opacity: 1 } 100% { opacity: 0; transform: translateY(-16px) scale(1) } }
@keyframes veraPetJackBeam { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
.vera-pet-tap { animation: veraPetTap .45s ease-out }
.vera-pet-swing { animation: veraPetSwing 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-sway { animation: veraPetSway 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
.vera-pet-tongue { animation: veraPetTongue 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-jackglow { animation: veraPetJackGlow 2.8s ease-in-out infinite }
.vera-pet-jackflame { animation: veraPetJackFlame 2.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.vera-pet-tentacle1 { animation: veraPetTentacle1 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-tentacle2 { animation: veraPetTentacle2 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-tentacle3 { animation: veraPetTentacle3 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-tentacle4 { animation: veraPetTentacle4 3s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-tentacle5 { animation: veraPetTentacle5 2.9s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-tentacle6 { animation: veraPetTentacle6 3.1s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.vera-pet-wobble { animation: veraPetWobble 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
.vera-pet-boop { animation: veraPetBoop 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
.vera-pet-aura { animation: veraPetAura 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.vera-pet-sparklespin { animation: veraPetSparkleSpin 9s linear infinite; transform-box: fill-box; transform-origin: 60px 58px }
.vera-pet-sparklepop { animation: veraPetSparklePop 2.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.vera-pet-wink { animation: veraPetWink 3.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.vera-pet-legwiggle { animation: veraPetLegWiggle 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 60px 62px }
.vera-pet-heartup { animation: veraPetHeartUp 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.vera-pet-jackbeam { animation: veraPetJackBeam 2.8s ease-in-out infinite }
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
  .vera-pet-tongue, .vera-pet-jackglow, .vera-pet-jackflame,
  .vera-pet-tentacle1, .vera-pet-tentacle2, .vera-pet-tentacle3,
  .vera-pet-tentacle4, .vera-pet-tentacle5, .vera-pet-tentacle6,
  .vera-pet-wobble, .vera-pet-boop, .vera-pet-aura, .vera-pet-sparklespin,
  .vera-pet-sparklepop, .vera-pet-wink, .vera-pet-legwiggle,
  .vera-pet-heartup, .vera-pet-jackbeam { animation: none !important }
  .vera-pet-particle { display: none !important }
}
`;

/* ── Пиксельный кот: сидящий чёрный кот, зелёные глаза с бликом, розовый нос ── */
const PIXEL_COLORS: Record<string, string> = {
  K: '#1d2030', // шерсть
  H: '#4a5571', // контур/подсветка — чтобы кот читался на тёмных темах
  P: '#2a2f42', // светлая грудка
  D: '#0f1017', // тень между лапами
  N: '#e59ab8', // внутренняя сторона ушей
  G: '#a6f65b', // глаз
  g: '#5fae22', // нижняя часть глаза
  W: '#ffffff', // блик
  p: '#f2a3c4', // нос
  M: '#5a6580', // рот
  w: '#8b93a8', // усы
};
const PIXEL_EYE_ROWS = [6, 8] as const;
const PIXEL_EYES: Array<[number, number]> = [[6, 7], [16, 17]];
// 24 колонки × 22 строки, сетка симметрична (кроме хвоста справа).
const PIXEL_CAT = [
  '....HH............HH....',
  '...HKKH..........HKKH...',
  '...HKNKH........HKNKH...',
  '...HKNNKHHHHHHHHKNNKH...',
  '..HKKKKKKKKKKKKKKKKKKH..',
  '..HKKKKKKKKKKKKKKKKKKH..',
  '.HKKKKWGKKKKKKKKWGKKKKH.',
  '.HKKKKGGKKKKKKKKGGKKKKH.',
  '.HKKKKggKKKKKKKKggKKKKH.',
  '.HKKKKKKKKKppKKKKKKKKKH.',
  'wHKKKKKKKKKMMKKKKKKKKKHw',
  'wHKKKKKKKKMKKMKKKKKKKKHw',
  '..HKKKKKKKKKKKKKKKKKKH..',
  '...HHKKKKKKKKKKKKKKHH...',
  '....HKKKKPPPPPPKKKKH....',
  '...HKKKKKPPPPPPKKKKKH...',
  '...HKKKKKKPPPPKKKKKKH.H.',
  '..HKKKKKKKKKKKKKKKKKKHKH',
  '..HKKKKKKKKKKKKKKKKKKHKH',
  '..HKKDKKKKKKKKKKKKDKKKKH',
  '..HKKDKKKKKKKKKKKKDKKKH.',
  '...HHHHHHHHHHHHHHHHHH...',
];

const starPath = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r} Q${cx + r * 0.25} ${cy - r * 0.25} ${cx + r} ${cy} Q${cx + r * 0.25} ${cy + r * 0.25} ${cx} ${cy + r} Q${cx - r * 0.25} ${cy + r * 0.25} ${cx - r} ${cy} Q${cx - r * 0.25} ${cy - r * 0.25} ${cx} ${cy - r} Z`;

function PixelCatArt() {
  const cell = 5;
  const offsetY = (120 - PIXEL_CAT.length * cell) / 2;
  const [eyeTop, eyeBottom] = PIXEL_EYE_ROWS;
  const isEye = (x: number, y: number) =>
    y >= eyeTop && y <= eyeBottom && PIXEL_EYES.some(([x0, x1]) => x >= x0 && x <= x1);
  const eyeRects = (x0: number, x1: number, keyPrefix: string) => {
    const rects: React.ReactElement[] = [];
    for (let y = eyeTop; y <= eyeBottom; y++) {
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
          // Глаза рисуются отдельными группами — чтобы моргали.
          if (isEye(x, y)) return null;
          const color = PIXEL_COLORS[ch];
          return color ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={color} /> : null;
        }))}
        <g className="vera-pet-blink">{eyeRects(PIXEL_EYES[0][0], PIXEL_EYES[0][1], 'eyeL')}</g>
        <g className="vera-pet-blink" style={{ animationDelay: '0.05s' }}>{eyeRects(PIXEL_EYES[1][0], PIXEL_EYES[1][1], 'eyeR')}</g>
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

/* ── Пушистый паук (common): мягко покачивается, милый ── */
function SpiderArt() {
  return (
    <g className="vera-pet-swing">
      <defs>
        <radialGradient id="veraPetSpiderBody" gradientUnits="userSpaceOnUse" cx="60" cy="50" r="48">
          <stop offset="0%" stopColor="#ffcf9a" />
          <stop offset="52%" stopColor="#ef9a4c" />
          <stop offset="100%" stopColor="#b8651f" />
        </radialGradient>
      </defs>
      {/* восемь лапок с изломом-«коленом» */}
      <g className="vera-pet-legwiggle" fill="none" stroke="#7c4a1e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 53Q31 45 28 35Q26 28 17 24" />
        <path d="M36 61Q25 59 18 51Q14 47 7 44" />
        <path d="M37 71Q25 75 19 85Q16 91 9 95" />
        <path d="M43 79Q35 89 33 99Q32 104 25 107" />
        <path d="M80 53Q89 45 92 35Q94 28 103 24" />
        <path d="M84 61Q95 59 102 51Q106 47 113 44" />
        <path d="M83 71Q95 75 101 85Q104 91 111 95" />
        <path d="M77 79Q85 89 87 99Q88 104 95 107" />
        {/* крохотные «тапочки» на кончиках */}
        <g stroke="none" fill="#5a3113">
          <circle cx="17" cy="24" r="2.4" /><circle cx="7" cy="44" r="2.4" />
          <circle cx="9" cy="95" r="2.4" /><circle cx="25" cy="107" r="2.4" />
          <circle cx="103" cy="24" r="2.4" /><circle cx="113" cy="44" r="2.4" />
          <circle cx="111" cy="95" r="2.4" /><circle cx="95" cy="107" r="2.4" />
        </g>
      </g>
      {/* пушистый контур: бугорки шёрстки */}
      <g className="vera-pet-wobble">
        <g fill="url(#veraPetSpiderBody)" stroke="#7c3f16" strokeWidth="2.2">
          <circle cx="41" cy="46" r="8.5" />
          <circle cx="52" cy="38" r="9" />
          <circle cx="68" cy="38" r="9" />
          <circle cx="79" cy="46" r="8.5" />
          <circle cx="33" cy="58" r="8" />
          <circle cx="87" cy="58" r="8" />
          <circle cx="37" cy="71" r="7.5" />
          <circle cx="83" cy="71" r="7.5" />
        </g>
        <ellipse cx="60" cy="61" rx="28" ry="24" fill="url(#veraPetSpiderBody)" stroke="#7c3f16" strokeWidth="2.4" />
        {/* мягкая светлая мордочка + блик */}
        <ellipse cx="60" cy="62" rx="20" ry="16" fill="#ffe0bd" opacity="0.5" />
        <ellipse cx="54" cy="48" rx="12" ry="7" fill="#ffffff" opacity="0.28" transform="rotate(-18 54 48)" />
        {/* глаза: большие блестящие + крохотные сверху */}
        <g className="vera-pet-blink">
          <g fill="#2f1c10">
            <circle cx="52" cy="60" r="8.2" />
            <circle cx="68" cy="60" r="8.2" />
            <circle cx="38" cy="51" r="3.4" />
            <circle cx="82" cy="51" r="3.4" />
          </g>
          {/* радужка потеплее */}
          <g fill="#6b3a18">
            <circle cx="52.6" cy="61" r="4" />
            <circle cx="68.6" cy="61" r="4" />
          </g>
          <g fill="#ffffff">
            <circle cx="49.4" cy="57" r="3" />
            <circle cx="65.4" cy="57" r="3" />
            <circle cx="54.6" cy="63.4" r="1.5" />
            <circle cx="70.6" cy="63.4" r="1.5" />
            <circle cx="37" cy="50" r="1.2" />
            <circle cx="81" cy="50" r="1.2" />
          </g>
        </g>
        {/* звёздочки-блёстки в уголках глаз */}
        <g className="vera-pet-sparklepop" fill="#fff7e8">
          <path d={starPath(45, 55, 2.2)} />
          <path d={starPath(75, 55, 2.2)} />
        </g>
        {/* румянец, улыбка и мягкие клыки */}
        <g fill="#f0956a" opacity="0.6">
          <circle cx="40" cy="67" r="4.2" />
          <circle cx="80" cy="67" r="4.2" />
        </g>
        <path d="M54 72q6 5 12 0" fill="none" stroke="#5a3113" strokeWidth="2" strokeLinecap="round" />
        <g fill="#fff6ea" stroke="#e2b489" strokeWidth="1.2" strokeLinejoin="round">
          <path d="M55.6 73.8h3.4L57.3 78Z" />
          <path d="M61 73.8h3.4L62.7 78Z" />
        </g>
      </g>
    </g>
  );
}

/* ── Плюшевый медвежонок (uncommon): игрушечный, с швом и большими глазами ── */
function BearArt() {
  const fur = '#d9a066';
  const furDark = '#c48746';
  const light = '#f3dcb6';
  const outline = '#86592f';
  const stitch = '#9c6b38';
  return (
    <g className="vera-pet-float">
      <ellipse cx="60" cy="111" rx="33" ry="5" fill="#000000" opacity="0.18" />
      <g className="vera-pet-breathe">
        {/* ушки — круглые плюшевые */}
        <g className="vera-pet-ear">
          <circle cx="40" cy="30" r="13" fill={fur} stroke={outline} strokeWidth="2.6" />
          <circle cx="40" cy="30" r="6.5" fill={light} />
        </g>
        <g className="vera-pet-ear" style={{ animationDelay: '0.7s' }}>
          <circle cx="80" cy="30" r="13" fill={fur} stroke={outline} strokeWidth="2.6" />
          <circle cx="80" cy="30" r="6.5" fill={light} />
        </g>
        {/* тело — пухлое */}
        <ellipse cx="60" cy="88" rx="29" ry="23" fill={fur} stroke={outline} strokeWidth="2.6" />
        {/* светлое пузико-заплатка со строчкой */}
        <ellipse cx="60" cy="90" rx="17" ry="16" fill={light} stroke={furDark} strokeWidth="1.4" />
        <path d="M60 60v10" fill="none" stroke={stitch} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2.5 3" />
        {/* задние лапы с подушечками */}
        <g stroke={outline} strokeWidth="2.4">
          <ellipse cx="29" cy="97" rx="12" ry="14" fill={fur} transform="rotate(-10 29 97)" />
          <ellipse cx="91" cy="97" rx="12" ry="14" fill={fur} transform="rotate(10 91 97)" />
        </g>
        <ellipse cx="29" cy="100" rx="6.5" ry="8.5" fill={light} transform="rotate(-10 29 100)" />
        <ellipse cx="91" cy="100" rx="6.5" ry="8.5" fill={light} transform="rotate(10 91 100)" />
        <g fill={furDark}>
          <circle cx="24" cy="88" r="2.6" /><circle cx="29" cy="86" r="2.6" /><circle cx="34" cy="88" r="2.6" />
          <circle cx="86" cy="88" r="2.6" /><circle cx="91" cy="86" r="2.6" /><circle cx="96" cy="88" r="2.6" />
        </g>
        {/* передние лапки, обнимают животик */}
        <g stroke={outline} strokeWidth="2.4">
          <ellipse cx="46" cy="98" rx="10" ry="8.5" fill={fur} transform="rotate(18 46 98)" />
          <ellipse cx="74" cy="98" rx="10" ry="8.5" fill={fur} transform="rotate(-18 74 98)" />
        </g>
        {/* голова — крупная, круглая */}
        <circle cx="60" cy="50" r="28" fill={fur} stroke={outline} strokeWidth="2.6" />
        {/* шов-строчка через макушку — «игрушечность» */}
        <path d="M60 22v12" fill="none" stroke={stitch} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2.5 3" />
        {/* нос — треугольник вершиной вниз */}
        <path d="M54 53.5q6-2 12 0 1.1.4-.4 2.1l-5.6 4.6-5.6-4.6q-1.5-1.7-.4-2.1Z" fill="#2c2c2c" stroke="#2c2c2c" strokeWidth="1" strokeLinejoin="round" />
        {/* рот — короткая вертикальная чёрточка */}
        <path d="M60 60.2v5" fill="none" stroke="#2c2c2c" strokeWidth="1.8" strokeLinecap="round" />
        {/* простые глаза-точки — крупнее и шире */}
        <g className="vera-pet-blink" fill="#2c2c2c">
          <circle cx="48" cy="49" r="3.8" />
          <circle cx="72" cy="49" r="3.8" />
        </g>
        {/* румяные щёчки */}
        <g fill="#f39b9b" opacity="0.75">
          <circle cx="40" cy="56" r="4.6" />
          <circle cx="80" cy="56" r="4.6" />
        </g>
      </g>
    </g>
  );
}

/* ── Зелёная змейка (rare): свёрнута толстыми кольцами, открытый рот с язычком ── */
function SnakeArt() {
  const outline = '#1c1c1c';
  const green = '#5f9e3f';
  const greenLight = '#7bb84f';
  const belly = '#e9dcae';
  const spot = '#4a8130';
  return (
    <g className="vera-pet-float">
      <defs>
        <linearGradient id="veraPetSnakeBody" gradientUnits="userSpaceOnUse" x1="60" y1="18" x2="60" y2="64">
          <stop offset="0%" stopColor="#7bb84f" />
          <stop offset="100%" stopColor="#5f9e3f" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="112" rx="42" ry="6" fill="#000000" opacity="0.14" />

      {/* ── нижний виток (самый большой, плоский) ── */}
      <ellipse cx="60" cy="96" rx="47" ry="20" fill={green} stroke={outline} strokeWidth="4.5" />
      {/* бежевое брюшко снизу переднего витка */}
      <path d="M16 98q44 24 88 0 2 8-6 14-38 18-76 0-8-6-6-14Z" fill={belly} stroke={outline} strokeWidth="3.5" strokeLinejoin="round" />
      {/* крапинки на нижнем витке */}
      <g fill={spot} opacity="0.55">
        <circle cx="26" cy="92" r="3" /><circle cx="33" cy="98" r="2.3" />
        <circle cx="90" cy="92" r="3" /><circle cx="84" cy="98" r="2.3" />
      </g>

      {/* ── средний виток ── */}
      <path d="M13 92q0-18 24-22 20-3 40 1 24 4 30 16 6 12-8 18-22 9-50 4-34-6-36-17Z"
        fill={greenLight} stroke={outline} strokeWidth="4.5" strokeLinejoin="round" />
      {/* бежевая волна брюшка на среднем витке, уходит к груди */}
      <path d="M26 82q24-12 54-4 14 4 14 12-2 8-14 8-6-10-20-12-20-3-34 4-4-4 0-8Z"
        fill={belly} stroke={outline} strokeWidth="3" strokeLinejoin="round" opacity="0.98" />
      <g fill={spot} opacity="0.5">
        <circle cx="30" cy="78" r="2.6" /><circle cx="86" cy="86" r="2.6" /><circle cx="80" cy="80" r="2" />
      </g>

      {/* ── приподнятая шея с головой — покачивается ── */}
      <g className="vera-pet-sway">
        {/* толстая короткая шея, выходит из витков под голову */}
        <path d="M54 88c-10-4-12-18-6-30 4-8 10-14 14-18" fill="none" stroke={outline} strokeWidth="30" strokeLinecap="round" />
        <path d="M54 88c-10-4-12-18-6-30 4-8 10-14 14-18" fill="none" stroke={green} strokeWidth="23" strokeLinecap="round" />
        {/* бежевое горло на шее */}
        <path d="M53 82c-6-4-7-15-3-24 2-5 6-10 10-13" fill="none" stroke={belly} strokeWidth="10" strokeLinecap="round" />

        {/* голова — круглая */}
        <ellipse cx="60" cy="40" rx="27" ry="25" fill="url(#veraPetSnakeBody)" stroke={outline} strokeWidth="4.5" />
        {/* бежевый подбородок */}
        <path d="M44 52q16 12 32 0-4 10-16 10-12 0-16-10Z" fill={belly} opacity="0.9" />
        {/* крапинки на макушке */}
        <g fill={spot} opacity="0.5">
          <circle cx="52" cy="22" r="3" /><circle cx="66" cy="20" r="3.4" />
          <circle cx="44" cy="30" r="2.4" /><circle cx="74" cy="30" r="2.6" />
        </g>
        {/* глаза — простые чёрные овалы */}
        <g className="vera-pet-blink" fill={outline}>
          <ellipse cx="49" cy="40" rx="4" ry="5.5" />
          <ellipse cx="71" cy="40" rx="4" ry="5.5" />
        </g>
        {/* рот — аккуратный маленький открытый овал */}
        <ellipse cx="60" cy="57" rx="5" ry="6.5" fill={outline} />
        <g className="vera-pet-tongue">
          <path d="M60 58v7" fill="none" stroke="#e86a86" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M60 65q-2.5 3-5 3.5M60 65q2.5 3 5 3.5" fill="none" stroke="#e86a86" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}

/* ── Светящийся Джек (epic): классический резной фонарь со свечением ── */
function PumpkinArt() {
  return (
    <g className="vera-pet-float">
      <defs>
        <linearGradient id="veraPetPumpkinBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffa942" />
          <stop offset="100%" stopColor="#f3851d" />
        </linearGradient>
        <linearGradient id="veraPetPumpkinStem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4aa72e" />
          <stop offset="100%" stopColor="#2e7d1e" />
        </linearGradient>
        <radialGradient id="veraPetPumpkinAura" gradientUnits="userSpaceOnUse" cx="60" cy="72" r="56">
          <stop offset="0%" stopColor="#ffd24d" stopOpacity="0.85" />
          <stop offset="55%" stopColor="#ff9e1f" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ff8c1a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* свечение фонаря — тёплая пульсирующая аура */}
      <circle className="vera-pet-aura" cx="60" cy="72" r="50" fill="url(#veraPetPumpkinAura)" />
      <ellipse cx="60" cy="104" rx="36" ry="4.5" fill="#000000" opacity="0.18" />
      <g className="vera-pet-boop">
        {/* зелёный изогнутый стебель с листиками */}
        <path d="M60 44c-1-10 2-20 9-25 5-3.6 10 .5 7 4-5 5-8 11-7 20z" fill="url(#veraPetPumpkinStem)" stroke="#256b16" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M69 20c3-2 6-1 6 2" fill="none" stroke="#7bd25a" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M54 46q-6-3-11 1 6 4 12 1zM66 47q7-3 12 1-6 4-12 1z" fill="#2e7d1e" stroke="#256b16" strokeWidth="1.2" strokeLinejoin="round" />
        {/* тело из пяти ребристых долей */}
        <g fill="url(#veraPetPumpkinBody)" stroke="#d2700f" strokeWidth="1.4">
          <ellipse cx="30" cy="74" rx="17" ry="30" />
          <ellipse cx="90" cy="74" rx="17" ry="30" />
          <ellipse cx="42" cy="72" rx="20" ry="33" />
          <ellipse cx="78" cy="72" rx="20" ry="33" />
          <ellipse cx="60" cy="71" rx="23" ry="35" />
        </g>
        {/* тёмные линии между долями и светлые блики */}
        <g fill="none" stroke="#d2700f" strokeWidth="2" strokeLinecap="round" opacity="0.8">
          <path d="M47 45Q42 72 47 100" />
          <path d="M73 45Q78 72 73 100" />
          <path d="M31 52Q26 74 31 96" />
          <path d="M89 52Q94 74 89 96" />
        </g>
        <g fill="none" stroke="#ffc76a" strokeWidth="2.6" strokeLinecap="round" opacity="0.7">
          <path d="M54 46Q50 72 54 98" />
          <path d="M66 46Q70 72 66 98" />
        </g>
        {/* резное лицо с внутренним свечением */}
        <g className="vera-pet-jackglow">
          {/* свечение-подложка под прорезями */}
          <g fill="#ffcf4a" opacity="0.9">
            <path d="M34 58l17 7-17 11Z" />
            <path d="M86 58l-17 7 17 11Z" />
            <path d="M60 70l8 13H52Z" />
            <path d="M30 86q30 24 60 0l-10 .5-4 7-6-6-7 6-5-7-7 6-6-7-8 .5Z" />
          </g>
          {/* чёрные вырезы фонаря поверх свечения */}
          <g fill="#1f1a16">
            <path d="M35 59l15 6.5L35 76Z" />
            <path d="M85 59L70 65.5 85 76Z" />
            <path d="M60 71l7.5 11.5H52.5Z" />
            <path d="M31 87q29 23 58 0l-9.5 .5-4 7-6.5-6-6 6-5-7-7 6-5-7-8.5 .5Z" />
          </g>
        </g>
      </g>
    </g>
  );
}

/* ── Сияющая медуза (legendary): премиальная аура, орбита блёсток и разные щупальца ── */
function JellyfishArt() {
  return (
    <g className="vera-pet-float">
      <defs>
        <radialGradient id="veraPetJellyBell" cx="50%" cy="28%" r="85%">
          <stop offset="0%" stopColor="#fff2fb" />
          <stop offset="55%" stopColor="#ffcbe6" />
          <stop offset="100%" stopColor="#ff9fd0" />
        </radialGradient>
        <radialGradient id="veraPetJellyAura" gradientUnits="userSpaceOnUse" cx="60" cy="52" r="50">
          <stop offset="0%" stopColor="#ffc6e8" stopOpacity="0.75" />
          <stop offset="55%" stopColor="#c9a3ff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#a0e8ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="veraPetJellyGloss" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="45%" stopColor="#d6f3ff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* legendary-аура */}
      <circle className="vera-pet-aura" cx="60" cy="52" r="46" fill="url(#veraPetJellyAura)" />
      {/* орбита блёсток-звёздочек */}
      <g className="vera-pet-sparklespin">
        <g className="vera-pet-sparklepop" fill="#ffffff">
          <path d={starPath(60, 12, 3)} />
          <path d={starPath(102, 48, 2.4)} style={{ animationDelay: '0.5s' } as React.CSSProperties} />
          <path d={starPath(20, 56, 2.6)} style={{ animationDelay: '1s' } as React.CSSProperties} />
          <path d={starPath(90, 86, 2)} style={{ animationDelay: '1.4s' } as React.CSSProperties} />
          <path d={starPath(30, 88, 2.2)} style={{ animationDelay: '0.8s' } as React.CSSProperties} />
        </g>
      </g>
      {/* щупальца — разной длины, волнистые, каждое движется независимо */}
      <g className="vera-pet-tentacle1" fill="none" stroke="#f093c0" strokeWidth="5.5" strokeLinecap="round">
        <path d="M30 70q-6 8-2 15t-2 18" />
      </g>
      <g className="vera-pet-tentacle2" fill="none" stroke="#e8a3d4" strokeWidth="6" strokeLinecap="round">
        <path d="M42 72q-4 10 1 18t-1 14" />
      </g>
      <g className="vera-pet-tentacle3" fill="none" stroke="#f5a8d8" strokeWidth="5" strokeLinecap="round">
        <path d="M54 73q-3 9 0 16t-2 15" />
      </g>
      <g className="vera-pet-tentacle4" fill="none" stroke="#f0b3db" strokeWidth="6.5" strokeLinecap="round">
        <path d="M66 73q2 10 0 17t2 14" />
      </g>
      <g className="vera-pet-tentacle5" fill="none" stroke="#e598cf" strokeWidth="5.5" strokeLinecap="round">
        <path d="M78 72q5 9 1 18t3 12" />
      </g>
      <g className="vera-pet-tentacle6" fill="none" stroke="#f0a0d6" strokeWidth="6" strokeLinecap="round">
        <path d="M90 70q6 8 2 16t4 17" />
      </g>
      {/* светящиеся бусины на концах, разные позиции */}
      <g fill="#fff2fb" stroke="#ffb3d9" strokeWidth="1.4">
        <circle cx="26" cy="103" r="2.8" /><circle cx="42" cy="104" r="3" />
        <circle cx="52" cy="104" r="2.6" /><circle cx="70" cy="104" r="3.2" />
        <circle cx="82" cy="102" r="2.8" /><circle cx="96" cy="103" r="3" />
      </g>
      {/* купол со свечением */}
      <g className="vera-pet-glowpulse">
        <path d="M60 20c-21 0-38 16-38 36 0 8 5 13 13 13h50c8 0 13-5 13-13 0-20-17-36-38-36Z" fill="url(#veraPetJellyBell)" stroke="#d06a97" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M37 56c1-14 11-24 23-24s22 10 23 24z" fill="#ffb6db" opacity="0.85" />
        {/* стеклянный глянец купола */}
        <path d="M34 50c2-18 14-30 26-30 8 0 15 5 19 12-8-6-30-8-45 18Z" fill="url(#veraPetJellyGloss)" />
        <path d="M56 21q4-3 8 0" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="44" cy="34" rx="6.5" ry="4" fill="#ffffff" opacity="0.9" transform="rotate(-32 44 34)" />
        <g fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
          <path d="M74 38q5 6 5 13" />
          <path d="M81 44q4 5 4 10" />
        </g>
        {/* мордочка */}
        <g className="vera-pet-blink">
          <g fill="#2b1a22">
            <circle cx="51" cy="47" r="5" />
            <circle cx="69" cy="47" r="5" />
          </g>
          <g fill="#7a3b58">
            <circle cx="51.6" cy="47.8" r="2.4" />
            <circle cx="69.6" cy="47.8" r="2.4" />
          </g>
          <g fill="#ffffff">
            <circle cx="49" cy="44.6" r="1.8" />
            <circle cx="67" cy="44.6" r="1.8" />
            <circle cx="53" cy="49.4" r="0.9" />
            <circle cx="71" cy="49.4" r="0.9" />
          </g>
        </g>
        {/* звёздочки-искорки у глаз */}
        <g className="vera-pet-twinkle" fill="#ffffff">
          <path d={starPath(44, 42, 1.8)} />
          <path d={starPath(76, 42, 1.8)} />
        </g>
        <path d="M56.5 55q3.5 3 7 0" fill="none" stroke="#2b1a22" strokeWidth="1.8" strokeLinecap="round" />
        <g fill="#ff8fb8" opacity="0.8">
          <circle cx="42" cy="53" r="3.8" />
          <circle cx="78" cy="53" r="3.8" />
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
