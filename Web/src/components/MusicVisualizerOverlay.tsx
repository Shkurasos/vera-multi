import React from 'react';
import { Box } from '@mui/material';
import { MusicVisualizerSettings } from '../store/musicVisualizerStore';

interface Props {
  settings: MusicVisualizerSettings;
  level: number;
  bass: number;
  beat: number;
}

export default function MusicVisualizerOverlay({ settings, level, bass, beat }: Props) {
  if (!settings.enabled) return null;
  const baseSignal = settings.mode === 'bass' ? bass : settings.mode === 'beat' ? beat : settings.mode === 'volume' ? level : Math.max(level * 0.72, bass * 0.58, beat * 0.9);
  const signal = Math.min(1, Math.max(0, baseSignal * settings.sensitivity));
  const power = 0.10 + Math.pow(signal, 0.74) * settings.intensity;
  const bassPower = Math.min(1, Math.pow(Math.max(bass, beat * 0.76), 0.72) * settings.sensitivity);
  const color = settings.color;
  const color2 = settings.secondaryColor;
  const opacity = Math.max(0.05, Math.min(1, settings.opacity));
  const width = `${Math.max(8, Math.min(100, settings.width))}vw`;
  const height = Math.max(24, Math.min(900, settings.height));
  const wave = Math.max(20, Math.min(220, settings.waveLength)) / 100;
  const glow = Math.max(20, Math.min(220, settings.glowSize)) / 100;
  const common = { pointerEvents: 'none' as const, zIndex: 1000, transition: 'opacity 180ms cubic-bezier(.22,1,.36,1), transform 180ms cubic-bezier(.22,1,.36,1), filter 180ms cubic-bezier(.22,1,.36,1), width 220ms ease, height 220ms ease, left 220ms ease, top 220ms ease', willChange: 'opacity, transform, filter' };
  const positioned = {
    position: 'fixed' as const,
    left: `${settings.x}%`,
    top: `${settings.y}%`,
    width,
    height,
    transform: 'translate(-50%, -50%)',
  };

  if (settings.style === 'bars') {
    const bars = Array.from({ length: Math.max(8, Math.round(18 * wave)) });
    return <Box sx={{ ...common, ...positioned, display: 'flex', alignItems: settings.placement === 'top' ? 'flex-start' : 'flex-end', justifyContent: 'center', gap: `${Math.max(2, 4 * wave)}px`, opacity: (0.35 + power) * opacity }}>
      {bars.map((_, i) => {
        const shape = 0.42 + Math.sin(i * 0.92 + power * 5.4) * 0.22 + ((i % 5) / 5) * 0.32;
        return <Box key={i} sx={{ width: Math.max(4, 8 * wave), borderRadius: 99, height: `${14 + Math.max(0.18, shape) * height * 0.92 * power}px`, background: `linear-gradient(180deg, ${color2}, ${color})`, boxShadow: `0 0 ${(22 + 58 * power) * glow}px ${color}, 0 0 ${(8 + 28 * bassPower) * glow}px ${color2}`, transition: 'height 120ms cubic-bezier(.22,1,.36,1), box-shadow 160ms ease' }} />;
      })}
    </Box>;
  }

  if (settings.style === 'pulse') {
    return <Box sx={{ ...common, ...positioned, borderRadius: '999px', boxShadow: `0 0 ${(35 + power * 120) * glow}px ${color}, inset 0 0 ${(20 + power * 90) * glow}px ${color2}`, opacity: (0.16 + power * 0.55) * opacity, transform: `translate(-50%, -50%) scale(${1 + power * 0.09})` }} />;
  }

  if (settings.style === 'wave') {
    return <Box sx={{ ...common, ...positioned, opacity: (0.26 + power * 0.68) * opacity, transform: `translate(-50%, -50%) scaleX(${1 + bassPower * 0.05}) scaleY(${1 + power * 0.045})`, background: `radial-gradient(ellipse at 18% 100%, ${color}AA 0%, transparent ${(24 + power * 42) * wave}%), radial-gradient(ellipse at 50% 108%, ${color2}88 0%, transparent ${(28 + beat * 52) * wave}%), radial-gradient(ellipse at 82% 100%, ${color}66 0%, transparent ${(22 + bass * 48) * wave}%)`, filter: `blur(${(9 + power * 16) * glow}px) saturate(${1.15 + bassPower * 0.55})` }} />;
  }

  const side = settings.placement === 'sides';
  return <Box sx={{ ...common, ...(side ? { position: 'fixed', inset: 0, width: '100vw', height: '100vh' } : positioned), opacity: (0.28 + power * 0.72) * opacity, transform: side ? undefined : `translate(-50%, -50%) scale(${1 + bassPower * 0.065})`, filter: `saturate(${1.18 + bassPower * 0.62}) blur(${settings.placement === 'full' ? 10 + power * 10 : 0}px)`, boxShadow: side ? `${(26 + power * 88) * glow}px 0 ${(55 + power * 120) * glow}px ${color}, calc(100vw - ${(26 + power * 64) * glow}px) 0 ${(55 + power * 120) * glow}px ${color2}, inset 0 0 ${(30 + beat * 90) * glow}px ${color}33` : `0 0 ${(42 + power * 150) * glow}px ${color}, 0 0 ${(18 + beat * 96) * glow}px ${color2}, inset 0 0 ${(20 + power * 86) * glow}px ${color2}`, borderRadius: settings.placement === 'full' ? 0 : '999px', background: settings.placement === 'full' ? `radial-gradient(circle at ${settings.x}% ${settings.y}%, ${color}55, transparent ${44 * wave + power * 28}%), radial-gradient(circle at ${100 - settings.x}% ${100 - settings.y}%, ${color2}3D, transparent ${36 * wave + beat * 30}%)` : `radial-gradient(circle at 42% 45%, ${color}44, transparent ${48 * wave}%), radial-gradient(circle at 60% 58%, ${color2}33, transparent ${64 * wave}%)` }} />;
}