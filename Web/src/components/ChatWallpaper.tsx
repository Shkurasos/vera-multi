/**
 * Движок обоев чата VERA.
 * Рендерит все 15 типов обоев из магазина: time, parallax, touch,
 * gradient, particles, waves, grid, dots-animate, aurora, matrix,
 * snow, rain, stars, noise, blob.
 * Слой абсолютный за сообщениями, pointer-events выключены.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';

export type WallpaperType =
  | 'time' | 'parallax' | 'touch' | 'gradient' | 'particles' | 'waves'
  | 'grid' | 'dots-animate' | 'aurora' | 'matrix' | 'snow' | 'rain'
  | 'stars' | 'noise' | 'blob';

export interface WallpaperSpec {
  type: WallpaperType;
  gradient?: string;
}

interface ChatWallpaperProps {
  spec: WallpaperSpec | null;
  /** Светлая ли тема — влияет на базовые цвета слоёв. */
  isLight?: boolean;
}

/** Палитры «времени суток» для wp-time. */
function timePalette(): { bg: string; g1: string; g2: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return { bg: '#fdf6ec', g1: '#ffd89b', g2: '#ffb88c' };
  if (h >= 11 && h < 17) return { bg: '#eef7ff', g1: '#a8dcff', g2: '#cfe9ff' };
  if (h >= 17 && h < 21) return { bg: '#fff3e6', g1: '#ff9a76', g2: '#ffcf9e' };
  return { bg: '#0b1026', g1: '#1b2559', g2: '#20124d' };
}

/** Детерминированный псевдослучай для стабильных сцен между рендерами. */
function seeded(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Пакет частиц для snow/rain/stars/particles/dots. */
function buildParticles(count: number, seedBase: number) {
  return Array.from({ length: count }, (_, i) => ({
    left: seeded(seedBase + i * 3) * 100,
    top: seeded(seedBase + i * 3 + 1) * 100,
    size: 2 + seeded(seedBase + i * 3 + 2) * 4,
    delay: seeded(seedBase + i * 3 + 3) * 12,
    dur: 6 + seeded(seedBase + i * 3 + 4) * 14,
    opacity: 0.25 + seeded(seedBase + i * 3 + 5) * 0.65,
  }));
}

export default function ChatWallpaper({ spec, isLight = false }: ChatWallpaperProps) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const rippleId = useRef(0);

  // Параллакс от мыши / наклона устройства.
  useEffect(() => {
    if (!spec || (spec.type !== 'parallax' && spec.type !== 'touch')) return;
    const onMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      setTilt({ x, y });
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      setTilt({ x: Math.max(-1, Math.min(1, e.gamma / 45)), y: Math.max(-1, Math.min(1, (e.beta - 45) / 45)) });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('deviceorientation', onOrient);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('deviceorientation', onOrient); };
  }, [spec]);

  // «Жидкое стекло»: круги по касанию.
  useEffect(() => {
    if (!spec || spec.type !== 'touch') return;
    let last = 0;
    const onPointer = (e: PointerEvent) => {
      const now = Date.now();
      if (now - last < 220) return;
      last = now;
      const id = ++rippleId.current;
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      setRipples(r => [...r.slice(-5), { id, x, y }]);
      setTimeout(() => setRipples(r => r.filter(p => p.id !== id)), 1400);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [spec]);

  const time = useMemo(() => (spec?.type === 'time' ? timePalette() : null), [spec?.type]);

  const particles = useMemo(() => {
    if (!spec) return null;
    switch (spec.type) {
      case 'snow': return buildParticles(48, 1);
      case 'rain': return buildParticles(40, 2);
      case 'stars': return buildParticles(70, 3);
      case 'particles': return buildParticles(36, 4);
      case 'dots-animate': return buildParticles(28, 5);
      default: return null;
    }
  }, [spec?.type]);

  const base: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 0,
  };

  const s = spec!;

  // ── time: плавный градиент по времени суток ──────────────────────────────
  if (s.type === 'time' && time) {
    return (
      <Box sx={{ ...base, background: time.bg, transition: 'background 2s ease' }}>
        <Box sx={{
          position: 'absolute', inset: '-20%',
          background: `radial-gradient(ellipse at 20% 10%, ${time.g1}66 0%, transparent 55%), radial-gradient(ellipse at 80% 90%, ${time.g2}55 0%, transparent 50%)`,
          animation: 'veraWallpaperDrift 26s ease-in-out infinite alternate',
          transition: 'background 2s ease',
        }} />
      </Box>
    );
  }

  // ── gradient: живой градиент из каталога (плавное движение + сияние) ──────
  if (s.type === 'gradient') {
    const g = s.gradient || 'linear-gradient(160deg,#667eea,#764ba2)';
    return (
      <Box sx={{ ...base, background: '#0c1020' }}>
        <Box sx={{
          position: 'absolute', inset: '-15%',
          background: g,
          backgroundSize: '220% 220%',
          filter: 'blur(2px)',
          animation: 'veraWallpaperPan 24s ease-in-out infinite alternate, veraWallpaperDrift 34s ease-in-out infinite alternate',
        }} />
        <Box sx={{
          position: 'absolute', inset: '-20%',
          background: 'radial-gradient(ellipse at 70% 20%, rgba(255,255,255,.14) 0%, transparent 55%)',
          mixBlendMode: 'screen',
          animation: 'veraWallpaperAurora 20s ease-in-out infinite alternate',
        }} />
      </Box>
    );
  }

  // ── parallax: два цветных слоя, смещаются за курсором/наклоном ───────────
  if (s.type === 'parallax') {
    const dark = !isLight;
    return (
      <Box sx={{ ...base, background: dark ? '#0d1224' : '#e9f0fa' }}>
        <Box sx={{
          position: 'absolute', inset: '-12%',
          background: `radial-gradient(circle at 25% 30%, ${dark ? '#5b6ee155' : '#8fb7ff55'} 0%, transparent 55%), radial-gradient(circle at 75% 70%, ${dark ? '#8a63d255' : '#c3a8ff55'} 0%, transparent 55%)`,
          transform: `translate(${tilt.x * 22}px, ${tilt.y * 22}px) scale(1.06)`,
          transition: 'transform 0.4s cubic-bezier(.16,1,.3,1)',
        }} />
        <Box sx={{
          position: 'absolute', inset: '-8%',
          background: `radial-gradient(circle at 60% 20%, ${dark ? '#2d3a6b88' : '#ffffffaa'} 0%, transparent 45%)`,
          transform: `translate(${tilt.x * -34}px, ${tilt.y * -34}px) scale(1.04)`,
          transition: 'transform 0.6s cubic-bezier(.16,1,.3,1)',
        }} />
      </Box>
    );
  }

  // ── touch: «жидкое стекло» — круги по касанию ────────────────────────────
  if (s.type === 'touch') {
    const dark = !isLight;
    return (
      <Box sx={{ ...base, background: dark ? '#101426' : '#eef2fa' }}>
        <Box sx={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(150deg, ${dark ? '#1a2340' : '#dbe7f7'} 0%, ${dark ? '#0f1428' : '#eef2fa'} 100%)`,
        }} />
        {ripples.map(r => (
          <Box key={r.id} sx={{
            position: 'absolute',
            left: `${r.x}%`, top: `${r.y}%`,
            width: 30, height: 30, ml: '-15px', mt: '-15px',
            borderRadius: '50%',
            border: `1.5px solid ${dark ? 'rgba(140,170,255,.5)' : 'rgba(80,110,200,.4)'}`,
            animation: 'veraWallpaperRipple 1.4s cubic-bezier(.16,1,.3,1) forwards',
          }} />
        ))}
      </Box>
    );
  }

  // ── particles-семейство: snow / rain / stars / particles / dots ──────────
  if (particles) {
    const dark = !isLight;
    const cfg: Record<string, { bg: string; color: string; anim: string; radius: string }> = {
      snow: { bg: dark ? '#16202e' : '#dcebf7', color: dark ? '#e8f4fd' : '#ffffff', anim: 'veraWallpaperFall 14s linear infinite', radius: '50%' },
      rain: { bg: dark ? '#0f1826' : '#b9c9dd', color: '#8fb8e8', anim: 'veraWallpaperRain 1.1s linear infinite', radius: '1px' },
      stars: { bg: '#070a18', color: '#ffffff', anim: 'veraWallpaperTwinkle 4s ease-in-out infinite', radius: '50%' },
      particles: { bg: dark ? '#101828' : '#e8eef8', color: dark ? '#7c9cff' : '#5b7fff', anim: 'veraWallpaperFloat 16s ease-in-out infinite alternate', radius: '50%' },
      'dots-animate': { bg: dark ? '#0f1420' : '#eef2f8', color: dark ? '#3d4a66' : '#c2cfe0', anim: 'veraWallpaperFloat 12s ease-in-out infinite alternate', radius: '50%' },
    };
    const c = cfg[s.type];
    if (c) {
      return (
        <Box sx={{ ...base, background: c.bg }}>
          {particles.map((p, i) => (
            <Box key={i} sx={{
              position: 'absolute',
              left: `${p.left}%`,
              top: s.type === 'snow' || s.type === 'rain' ? '-40px' : `${p.top}%`,
              width: s.type === 'rain' ? 1.5 : p.size,
              height: s.type === 'rain' ? 18 + p.size * 4 : p.size,
              background: c.color, borderRadius: c.radius, opacity: p.opacity,
              animation: `${c.anim} ${p.dur}s linear ${p.delay}s infinite`,
            }} />
          ))}
        </Box>
      );
    }
  }

  // ── waves: мягкие анимированные волны ────────────────────────────────────
  if (s.type === 'waves') {
    const dark = !isLight;
    return (
      <Box sx={{ ...base, background: dark ? '#0c1220' : '#e4f0fa' }}>
        {[0, 1, 2].map(i => (
          <Box key={i} sx={{
            position: 'absolute', left: '-25%', width: '150%', height: '45%',
            bottom: `${-8 + i * 6}%`,
            background: `radial-gradient(ellipse at 50% 100%, ${['#4dd0ff33', '#4d88ff2b', '#7c5cff22'][i]} 0%, transparent 70%)`,
            borderRadius: '45% 55% 40% 60% / 60% 40% 60% 40%',
            animation: `veraWallpaperWave ${12 + i * 6}s ease-in-out ${i * 2}s infinite alternate`,
          }} />
        ))}
      </Box>
    );
  }

  // ── grid: техническая сетка с бегущей подсветкой ─────────────────────────
  if (s.type === 'grid') {
    const dark = !isLight;
    return (
      <Box sx={{ ...base, background: dark ? '#0d1118' : '#f0f3f7' }}>
        <Box sx={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(${dark ? '#ffffff10' : '#00000010'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? '#ffffff10' : '#00000010'} 1px, transparent 1px)`,
          backgroundSize: '36px 36px',
          animation: 'veraWallpaperGridPan 14s linear infinite',
        }} />
        <Box sx={{
          position: 'absolute', inset: '-20%',
          background: `radial-gradient(ellipse at 50% 0%, ${dark ? '#4d88ff1c' : '#4d88ff10'} 0%, transparent 60%)`,
          animation: 'veraWallpaperDrift 22s ease-in-out infinite alternate',
        }} />
      </Box>
    );
  }

  // ── aurora: северное сияние ──────────────────────────────────────────────
  if (s.type === 'aurora') {
    return (
      <Box sx={{ ...base, background: '#050810' }}>
        {[
          { c: '#43e97b', d: 18, x: '15%', y: '8%' },
          { c: '#38f9d7', d: 24, x: '60%', y: '22%' },
          { c: '#4facfe', d: 30, x: '35%', y: '42%' },
        ].map((a, i) => (
          <Box key={i} sx={{
            position: 'absolute', inset: '-25%',
            background: `radial-gradient(ellipse 40% 60% at ${a.x} ${a.y}, ${a.c}44 0%, transparent 70%)`,
            filter: 'blur(28px)',
            animation: `veraWallpaperAurora ${a.d}s ease-in-out ${i * 3}s infinite alternate`,
          }} />
        ))}
      </Box>
    );
  }

  // ── matrix: падающие символы ─────────────────────────────────────────────
  if (s.type === 'matrix') {
    const cols = Array.from({ length: 24 }, (_, i) => ({ left: (i / 24) * 100, dur: 5 + seeded(i + 9) * 9, delay: seeded(i + 40) * 8 }));
    return (
      <Box sx={{ ...base, background: '#001200' }}>
        {cols.map((c, i) => (
          <Box key={i} sx={{
            position: 'absolute', top: '-60px', left: `${c.left}%`,
            color: '#00ff41', fontSize: 13, fontFamily: 'monospace', lineHeight: 1.35, opacity: 0.5,
            writingMode: 'vertical-rl', textOrientation: 'upright',
            textShadow: '0 0 6px #00ff4188',
            animation: `veraWallpaperFall ${c.dur}s linear ${c.delay}s infinite`,
          }}>
            {Array.from({ length: 18 }, (_, j) => (seeded(i * 97 + j * 7) > 0.5 ? '1' : '0')).join('')}
          </Box>
        ))}
      </Box>
    );
  }

  // ── noise: киношный плёночный шум ────────────────────────────────────────
  if (s.type === 'noise') {
    const dark = !isLight;
    return (
      <Box sx={{ ...base, background: dark ? '#161616' : '#e8e6e2' }}>
        <Box sx={{
          position: 'absolute', inset: 0, opacity: dark ? 0.1 : 0.07,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '180px 180px',
          animation: 'veraWallpaperNoise 0.45s steps(4) infinite',
        }} />
      </Box>
    );
  }

  // ── blob: живые цветные капли ────────────────────────────────────────────
  if (s.type === 'blob') {
    const dark = !isLight;
    return (
      <Box sx={{ ...base, background: dark ? '#14101f' : '#f4ecfa' }}>
        {[
          { c: '#a18cd1', s: '42vw', x: '12%', y: '18%', d: 20 },
          { c: '#fbc2eb', s: '36vw', x: '58%', y: '48%', d: 26 },
          { c: '#84fab0', s: '30vw', x: '34%', y: '70%', d: 23 },
        ].map((b, i) => (
          <Box key={i} sx={{
            position: 'absolute', left: b.x, top: b.y,
            width: b.s, height: b.s,
            background: `radial-gradient(circle, ${b.c}${dark ? '3d' : '55'} 0%, transparent 70%)`,
            filter: 'blur(30px)',
            borderRadius: '42% 58% 55% 45% / 55% 42% 58% 45%',
            animation: `veraWallpaperBlob ${b.d}s ease-in-out ${i * 4}s infinite alternate`,
          }} />
        ))}
      </Box>
    );
  }

  return null;
}
