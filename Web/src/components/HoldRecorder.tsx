import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { Mic, Videocam } from '@mui/icons-material';

interface Props {
  disabled: boolean;
  onSend: (file: File, round: boolean) => Promise<void>;
  onError: (message: string) => void;
}

// A stable canvas track allows switching cameras without replacing recorder tracks.
export default function HoldRecorder({ disabled, onSend, onError }: Props) {
  const [round, setRound] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const startY = useRef(0);
  const preview = useRef<HTMLVideoElement>(null);
  const session = useRef<{
    cancelled: boolean; recorder?: MediaRecorder; camera?: MediaStream; audio?: MediaStream;
    output?: MediaStream; video?: HTMLVideoElement; frame?: number; timer?: ReturnType<typeof setInterval>;
    facing: 'user' | 'environment';
  } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const pointer = useRef<number | null>(null);
  const held = useRef(false);
  const mounted = useRef(true);
  const sending = useRef(false);

  const releaseResources = (s: NonNullable<typeof session.current>) => {
    if (s.frame !== undefined) cancelAnimationFrame(s.frame);
    if (s.timer) clearInterval(s.timer);
    [s.camera, s.audio, s.output].forEach(stream => stream?.getTracks().forEach(track => track.stop()));
    if (s.video) { s.video.pause(); s.video.srcObject = null; }
  };

  const finish = (cancel = false) => {
    const s = session.current;
    if (!s) return;
    s.cancelled = cancel || !s.recorder;
    session.current = null;
    lockedRef.current = false;
    if (s.recorder?.state === 'recording') s.recorder.stop();
    releaseResources(s);
    if (mounted.current) { setActive(false); setSeconds(0); setLocked(false); }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(hold.current);
      finish(true);
    };
  }, []);

  const start = async () => {
    if (disabled || sending.current || session.current) return;
    const s: NonNullable<typeof session.current> = { cancelled: false, facing: 'user' };
    session.current = s;
    setActive(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('unsupported');
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session.current !== s) { audio.getTracks().forEach(t => t.stop()); return; }
      s.audio = audio;
      let output = audio;
      if (round) {
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } });
        if (session.current !== s) { camera.getTracks().forEach(t => t.stop()); return; }
        s.camera = camera;
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.srcObject = camera;
        s.video = video;
        await video.play();
        if (session.current !== s) return;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 480;
        const context = canvas.getContext('2d');
        if (!context || !canvas.captureStream) throw new Error('unsupported');
        const draw = () => {
          if (session.current !== s) return;
          if (video.readyState >= 2) {
            const side = Math.min(video.videoWidth, video.videoHeight);
            context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 480, 480);
          }
          s.frame = requestAnimationFrame(draw);
        };
        draw();
        output = canvas.captureStream(30);
        audio.getAudioTracks().forEach(track => output.addTrack(track));
        s.output = output;
        if (preview.current) { preview.current.srcObject = output; void preview.current.play().catch(() => {}); }
      }
      const candidates = round ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(output, mimeType ? { mimeType } : undefined);
      s.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { if (session.current === s) { finish(true); onError('Ошибка записи. Попробуйте ещё раз.'); } };
      recorder.onstop = async () => {
        releaseResources(s);
        if (s.cancelled || !mounted.current || !chunks.length) return;
        const type = recorder.mimeType || chunks[0].type;
        const file = new File(chunks, `${round ? 'video-note' : 'voice'}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
        sending.current = true; setBusy(true);
        try { await onSend(file, round); }
        catch { if (mounted.current) onError('Не удалось отправить запись. Проверьте подключение.'); }
        finally { sending.current = false; if (mounted.current) setBusy(false); }
      };
      recorder.start(250);
      let elapsed = 0;
      s.timer = setInterval(() => {
        setSeconds(++elapsed);
        if (elapsed >= 60) finish();
      }, 1000);
    } catch {
      if (session.current === s) {
        finish(true);
        onError('Не удалось начать запись. Нужны HTTPS и разрешения на микрофон' + (round ? ' и камеру.' : '.'));
      }
    }
  };

  const flip = async () => {
    const s = session.current;
    if (!s?.video || switching) return;
    setSwitching(true);
    const facing = s.facing === 'user' ? 'environment' : 'user';
    try {
      // Mobile devices often cannot open two cameras simultaneously.
      s.camera?.getTracks().forEach(t => t.stop());
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } } });
      if (session.current !== s) { camera.getTracks().forEach(t => t.stop()); return; }
      s.camera = camera; s.video.srcObject = camera; s.facing = facing;
      await s.video.play();
    } catch {
      if (session.current === s) { finish(true); onError('Не удалось переключить камеру. Запись отменена.'); }
    } finally { if (mounted.current) setSwitching(false); }
  };

  return <>
    {active && <Box sx={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 1500, bgcolor: '#171923', color: '#fff', p: 2, borderRadius: 3, textAlign: 'center' }}>
      {round && <video ref={preview} muted autoPlay playsInline style={{ width: 240, height: 240, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />}
      <Typography role="status">{seconds} с · {locked ? 'Запись закреплена' : 'Отпустите для отправки · Вверх — закрепить'}</Typography>
      {locked && <Button onClick={() => finish()}>Отправить</Button>}
      {round && <Button disabled={switching} onClick={flip}>Перевернуть камеру</Button>}
      <Button color="error" onClick={() => finish(true)}>Отмена</Button>
    </Box>}
    <IconButton disabled={disabled || busy} aria-label={round ? 'Кружок: удерживайте для записи' : 'Голосовое: удерживайте для записи'}
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => {
        if (e.button !== 0 || pointer.current !== null || session.current) return;
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        startY.current = e.clientY;
        pointer.current = e.pointerId; held.current = false;
        hold.current = setTimeout(() => { held.current = true; void start(); }, 250);
      }}
      onPointerUp={e => {
        if (pointer.current !== e.pointerId) return;
        pointer.current = null; clearTimeout(hold.current);
        if (held.current) { if (!lockedRef.current) finish(); } else setRound(value => !value);
      }}
      onPointerMove={e => {
        if (pointer.current === e.pointerId && session.current && startY.current - e.clientY > 70) {
          lockedRef.current = true; setLocked(true);
        }
      }}
      onPointerCancel={() => { pointer.current = null; clearTimeout(hold.current); finish(true); }}
      onLostPointerCapture={() => { if (pointer.current !== null) { pointer.current = null; clearTimeout(hold.current); finish(true); } }}
      onClick={e => { if (e.detail === 0) setRound(value => !value); }}
      sx={{ width: 42, height: 42, flexShrink: 0, touchAction: 'none', userSelect: 'none', color: active ? '#f44336' : 'inherit' }}>
      {round ? <Videocam /> : <Mic />}
    </IconButton>
  </>;
}