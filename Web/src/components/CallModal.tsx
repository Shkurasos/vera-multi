import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '../services/socket';

interface IncomingCallData {
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  offer: RTCSessionDescriptionInit;
  type: 'audio' | 'video';
}

interface CallModalProps {
  targetUser?: { id: string; firstName?: string; lastName?: string; username?: string; avatarUrl?: string } | null;
  callType?: 'audio' | 'video';
  incomingOffer?: RTCSessionDescriptionInit;
  onClose: () => void;
}

export function useIncomingCall() {
  const [incoming, setIncoming] = useState<IncomingCallData | null>(null);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const handler = (data: IncomingCallData) => setIncoming(data);
    s.on('call:incoming', handler);
    return () => { s.off('call:incoming', handler); };
  }, []);
  return { incoming, setIncoming };
}

const ICE_SERVERS = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    // Публичный тестовый TURN — без него звонок между разными сетями/NAT не поднимется.
    // Для продакшна заменить на свой TURN (metered.ca / coturn / Cloudflare Calls).
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

// ─── Outgoing / Active call modal ──────────────────────────────────────────
export function CallModal({ targetUser, callType = 'audio', onClose }: CallModalProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'calling' | 'connected' | 'ended'>('calling');
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'medium' | 'poor'>('good');
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    if (durationRef.current) clearInterval(durationRef.current);
  }, []);

  useEffect(() => {
    if (!targetUser) return;
    const s = getSocket();
    if (!s) return;

    startCall(s);

    s.on('call:answered', async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      setStatus('connected');
      durationRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      monitorConnectionQuality();
    });

    s.on('call:ice-candidate', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try { await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    });

    s.on('call:ended', () => {
      setStatus('ended');
      cleanup();
      setTimeout(onClose, 1500);
    });

    return () => {
      s.off('call:answered');
      s.off('call:ice-candidate');
      s.off('call:ended');
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCall(s: ReturnType<typeof getSocket>) {
    if (!s || !targetUser) return;
    const constraints = callType === 'video' ? { audio: true, video: true } : { audio: true, video: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints).catch(() => null);
    if (!stream) { setStatus('ended'); setTimeout(onClose, 1500); return; }

    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
    pc.onicecandidate = (e) => {
      if (e.candidate) s.emit('call:ice-candidate', { targetUserId: targetUser.id, candidate: e.candidate.toJSON() });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    s.emit('call:offer', { targetUserId: targetUser.id, offer, type: callType });
  }

  function monitorConnectionQuality() {
    const interval = setInterval(async () => {
      if (!pcRef.current) { clearInterval(interval); return; }
      const stats = await pcRef.current.getStats();
      let packetsLost = 0, packetsReceived = 0;
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsLost += report.packetsLost || 0;
          packetsReceived += report.packetsReceived || 0;
        }
      });
      const lossRate = packetsReceived > 0 ? packetsLost / packetsReceived : 0;
      if (lossRate > 0.05) setConnectionQuality('poor');
      else if (lossRate > 0.02) setConnectionQuality('medium');
      else setConnectionQuality('good');
    }, 2000);
    return () => clearInterval(interval);
  }

  function hangUp() {
    const s = getSocket();
    if (s && targetUser) s.emit('call:end', { targetUserId: targetUser.id, reason: 'ended' });
    cleanup();
    onClose();
  }

  function toggleMute() {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsMuted(m => !m);
  }

  function toggleCam() {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsCamOff(c => !c);
  }

  const name = targetUser
    ? [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || targetUser.username || 'Пользователь'
    : '';
  const fmtDuration = `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {callType === 'video' && (
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', color: '#fff', marginBottom: 24 }}>
        {targetUser?.avatarUrl
          ? <img src={targetUser.avatarUrl} alt="" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', marginBottom: 12 }} />
          : <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 12px' }}>
              {name[0]?.toUpperCase() || '?'}
            </div>
        }
        <div style={{ fontSize: 22, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 4 }}>
          {status === 'calling' && 'Вызов...'}
          {status === 'connected' && fmtDuration}
          {status === 'ended' && 'Звонок завершён'}
        </div>
        {status === 'connected' && (
          <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ 
              width: 8, height: 8, borderRadius: '50%', 
              background: connectionQuality === 'good' ? '#22c55e' : connectionQuality === 'medium' ? '#f59e0b' : '#ef4444' 
            }} />
            <span style={{ color: '#9ca3af' }}>
              {connectionQuality === 'good' ? 'Хорошее качество' : connectionQuality === 'medium' ? 'Среднее качество' : 'Плохое качество'}
            </span>
          </div>
        )}
      </div>
      {callType === 'video' && (
        <video ref={localVideoRef} autoPlay playsInline muted
          style={{ position: 'absolute', bottom: 100, right: 16, width: 120, height: 90, borderRadius: 8, objectFit: 'cover', border: '2px solid #fff', zIndex: 2 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', gap: 16 }}>
        <CallButton icon={isMuted ? '🔇' : '🎙️'} label={isMuted ? 'Вкл. микр.' : 'Откл. микр.'} onClick={toggleMute} color="#374151" />
        {callType === 'video' && (
          <CallButton icon={isCamOff ? '📷' : '📸'} label={isCamOff ? 'Вкл. камеру' : 'Откл. камеру'} onClick={toggleCam} color="#374151" />
        )}
        <CallButton icon="📵" label="Завершить" onClick={hangUp} color="#ef4444" />
      </div>
    </div>
  );
}

// ─── Incoming call modal ────────────────────────────────────────────────────
export function IncomingCallModal({ data, onClose }: { data: IncomingCallData; onClose: () => void }) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'medium' | 'poor'>('good');
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    if (durationRef.current) clearInterval(durationRef.current);
  }, []);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on('call:ice-candidate', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try { await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    });
    s.on('call:ended', () => { cleanup(); onClose(); });
    return () => {
      s.off('call:ice-candidate');
      s.off('call:ended');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function accept() {
    const s = getSocket();
    if (!s) return;
    const constraints = data.type === 'video' ? { audio: true, video: true } : { audio: true, video: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints).catch(() => null);
    if (!stream) return;

    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
    pc.onicecandidate = (e) => {
      if (e.candidate) s.emit('call:ice-candidate', { targetUserId: data.callerId, candidate: e.candidate.toJSON() });
    };

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    s.emit('call:answer', { targetUserId: data.callerId, answer });

    setAccepted(true);
    durationRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    monitorConnectionQuality();
  }

  function monitorConnectionQuality() {
    const interval = setInterval(async () => {
      if (!pcRef.current) { clearInterval(interval); return; }
      const stats = await pcRef.current.getStats();
      let packetsLost = 0, packetsReceived = 0;
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsLost += report.packetsLost || 0;
          packetsReceived += report.packetsReceived || 0;
        }
      });
      const lossRate = packetsReceived > 0 ? packetsLost / packetsReceived : 0;
      if (lossRate > 0.05) setConnectionQuality('poor');
      else if (lossRate > 0.02) setConnectionQuality('medium');
      else setConnectionQuality('good');
    }, 2000);
    return () => clearInterval(interval);
  }

  function toggleMute() {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsMuted(m => !m);
  }

  function toggleCam() {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsCamOff(c => !c);
  }

  function decline() {
    const s = getSocket();
    if (s) s.emit('call:end', { targetUserId: data.callerId, reason: 'declined' });
    cleanup();
    onClose();
  }

  const fmtDuration = `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {data.type === 'video' && accepted && (
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', color: '#fff', marginBottom: 32 }}>
        {data.callerAvatar
          ? <img src={data.callerAvatar} alt="" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', marginBottom: 12 }} />
          : <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 12px' }}>
              {data.callerName[0]?.toUpperCase() || '?'}
            </div>
        }
        <div style={{ fontSize: 22, fontWeight: 600 }}>{data.callerName}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 4 }}>
          {accepted ? fmtDuration : (data.type === 'video' ? 'Входящий видеозвонок...' : 'Входящий звонок...')}
        </div>
        {accepted && (
          <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ 
              width: 8, height: 8, borderRadius: '50%', 
              background: connectionQuality === 'good' ? '#22c55e' : connectionQuality === 'medium' ? '#f59e0b' : '#ef4444' 
            }} />
            <span style={{ color: '#9ca3af' }}>
              {connectionQuality === 'good' ? 'Хорошее качество' : connectionQuality === 'medium' ? 'Среднее качество' : 'Плохое качество'}
            </span>
          </div>
        )}
      </div>
      {data.type === 'video' && accepted && (
        <video ref={localVideoRef} autoPlay playsInline muted
          style={{ position: 'absolute', bottom: 100, right: 16, width: 120, height: 90, borderRadius: 8, objectFit: 'cover', border: '2px solid #fff', zIndex: 2 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', gap: 16 }}>
        {!accepted && <CallButton icon="📞" label="Ответить" onClick={accept} color="#22c55e" />}
        {accepted && (
          <>
            <CallButton icon={isMuted ? '🔇' : '🎙️'} label={isMuted ? 'Вкл. микр.' : 'Откл. микр.'} onClick={toggleMute} color="#374151" />
            {data.type === 'video' && (
              <CallButton icon={isCamOff ? '📷' : '📸'} label={isCamOff ? 'Вкл. камеру' : 'Откл. камеру'} onClick={toggleCam} color="#374151" />
            )}
          </>
        )}
        <CallButton icon="📵" label="Завершить" onClick={decline} color="#ef4444" />
      </div>
    </div>
  );
}

function CallButton({ icon, label, onClick, color }: { icon: string; label: string; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 64, height: 64, borderRadius: '50%',
        background: color, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, color: '#fff', transition: 'opacity .15s',
      }}
      onMouseOver={e => (e.currentTarget.style.opacity = '0.8')}
      onMouseOut={e => (e.currentTarget.style.opacity = '1')}
    >
      {icon}
    </button>
  );
}
