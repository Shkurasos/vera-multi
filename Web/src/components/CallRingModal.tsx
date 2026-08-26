/*
 * CallRingModal — экран входящего звонка (ring) с принять/отклонить.
 * Появляется при событии callroom:ring (direct-чаты). Проигрывает рингтон.
 */
import React, { useEffect, useRef } from 'react';
import { Box, Avatar, Typography, IconButton, Tooltip } from '@mui/material';
import { Call, CallEnd, Videocam } from '@mui/icons-material';
import { useCallStore } from '../store/callStore';

export default function CallRingModal() {
  const ring = useCallStore((s) => s.ring);
  const { acceptRing, declineRing } = useCallStore();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ring) { stopRingRef.current?.(); stopRingRef.current = null; return; }
    try {
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      let stopped = false;
      const beep = () => {
        if (stopped) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 520;
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.55);
      };
      beep();
      const id = setInterval(beep, 1500);
      stopRingRef.current = () => { stopped = true; clearInterval(id); try { ctx.close(); } catch {} };
    } catch {}
    return () => { stopRingRef.current?.(); stopRingRef.current = null; };
  }, [ring]);

  if (!ring) return null;

  return (
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 9999,
      bgcolor: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 3, color: '#fff',
    }}>
      <Avatar src={ring.callerAvatar || undefined} sx={{
        width: 120, height: 120, fontSize: 48,
        animation: 'callPulse 1.5s ease-in-out infinite',
      }}>
        {ring.callerName[0]?.toUpperCase()}
      </Avatar>
      <style>{`@keyframes callPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6);} 50% { box-shadow: 0 0 0 24px rgba(34,197,94,0);} }`}</style>
      <Box sx={{ textAlign: 'center' }}>
        <Typography sx={{ fontSize: 24, fontWeight: 700 }}>{ring.callerName}</Typography>
        <Typography sx={{ fontSize: 15, color: '#b5bac1', mt: 0.5 }}>
          {ring.kind === 'video' ? 'Входящий видеозвонок...' : 'Входящий звонок...'}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 4, mt: 2 }}>
        <Tooltip title="Отклонить">
          <IconButton onClick={declineRing} sx={{
            bgcolor: '#ef4444', color: '#fff', width: 72, height: 72,
            '&:hover': { bgcolor: '#dc2626' },
          }}>
            <CallEnd sx={{ fontSize: 32 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Принять">
          <IconButton onClick={acceptRing} sx={{
            bgcolor: '#22c55e', color: '#fff', width: 72, height: 72,
            '&:hover': { bgcolor: '#16a34a' },
          }}>
            {ring.kind === 'video' ? <Videocam sx={{ fontSize: 32 }} /> : <Call sx={{ fontSize: 32 }} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
