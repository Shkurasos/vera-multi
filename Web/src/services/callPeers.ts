/*
 * callPeers — mesh-менеджер WebRTC для одной voice-комнаты.
 * Правило: меньший userId делает offer (impolite), больший — polite.
 */
import { getSocket } from './socket';
import { useCallStore, CALL_ICE_SERVERS, CallKind } from '../store/callStore';
import { useAuthStore } from '../store/authStore';

interface PeerConn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteStream: MediaStream;
  screenStream: MediaStream;
  vaCleanup?: () => void;
  senders: Map<string, RTCRtpSender>;
}

const peers = new Map<string, PeerConn>();
let currentChatId: string | null = null;
let currentKind: CallKind = 'audio';
let localStream: MediaStream | null = null;
let localScreen: MediaStream | null = null;
let localVA: (() => void) | null = null;
let bound = false;

function myId(): string | null {
  return useAuthStore.getState().user?.id || null;
}

function isPolite(otherId: string): boolean {
  const me = myId();
  if (!me) return true;
  return me > otherId; // больший id — polite (отвечает)
}

async function ensureLocalStream(kind: CallKind): Promise<MediaStream> {
  if (localStream) return localStream;
  const constraints: MediaStreamConstraints = kind === 'video'
    ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { width: 640, height: 480 } }
    : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
  const s = await navigator.mediaDevices.getUserMedia(constraints);
  localStream = s;
  useCallStore.getState()._setLocalStream(s);
  localVA = attachVoiceActivity(s, '__local__');
  return s;
}

function sendSignal(toUserId: string, data: any) {
  const s = getSocket();
  if (!s || !currentChatId) return;
  s.emit('callroom:signal', { chatId: currentChatId, toUserId, data });
}

function attachVoiceActivity(stream: MediaStream, id: string): () => void {
  try {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0, speaking = false, lastChange = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      const isSpeaking = rms > 0.04;
      if (isSpeaking !== speaking && now - lastChange > 120) {
        speaking = isSpeaking; lastChange = now;
        useCallStore.getState()._setSpeaking(id, speaking);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); try { ctx.close(); } catch {} };
  } catch { return () => {}; }
}

function createPeer(otherId: string): PeerConn {
  const pc = new RTCPeerConnection(CALL_ICE_SERVERS);
  const polite = isPolite(otherId);
  const conn: PeerConn = {
    pc, polite, makingOffer: false, ignoreOffer: false,
    remoteStream: new MediaStream(), screenStream: new MediaStream(), senders: new Map(),
  };

  if (localStream) {
    for (const t of localStream.getTracks()) {
      const sender = pc.addTrack(t, localStream);
      conn.senders.set(t.kind, sender);
    }
  }
  if (localScreen) {
    for (const t of localScreen.getTracks()) pc.addTrack(t, localScreen);
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(otherId, { type: 'ice', candidate: e.candidate.toJSON() });
  };

  pc.ontrack = (e) => {
    // Принимаем ВСЕ треки от пира: аудио (речь) и видео (камера).
    // Важно: e.streams может быть пустым (Firefox), поэтому всегда пушим
    // трек в conn.remoteStream и КАЖДЫЙ раз обновляем стрим в сторе —
    // иначе CallAudioSink может держать старый MediaStream без новых треков.
    const isScreen = /screen|display/i.test(e.track.label);
    const target = isScreen ? conn.screenStream : conn.remoteStream;
    if (!target.getTracks().find((t) => t.id === e.track.id)) {
      target.addTrack(e.track);
    }
    if (isScreen) {
      useCallStore.getState()._setPeer(otherId, {
        screenStream: new MediaStream(conn.screenStream.getTracks()),
      });
    }
    // Аудио-трек — обновляем стрим в сторе, чтобы CallAudioSink перезватил srcObject.
    if (e.track.kind === 'audio') {
      if (!conn.vaCleanup) {
        conn.vaCleanup = attachVoiceActivity(conn.remoteStream, otherId);
      }
      useCallStore.getState()._setPeer(otherId, {
        stream: new MediaStream(conn.remoteStream.getTracks()),
        screenStream: conn.screenStream.getTracks().length ? new MediaStream(conn.screenStream.getTracks()) : undefined,
      });
    }
    // Видео — тайл обновится сам из того же conn.remoteStream (CallTile subscribes stream).
  };

  pc.onconnectionstatechange = () => {
    useCallStore.getState()._setPeer(otherId, { connection: pc.connectionState as any });
  };

  pc.onnegotiationneeded = async () => {
    if (conn.polite) return;
    try {
      conn.makingOffer = true;
      await pc.setLocalDescription();
      if (pc.localDescription) sendSignal(otherId, { type: 'sdp', sdp: pc.localDescription });
    } catch (err) { console.warn('negotiationneeded', err); }
    finally { conn.makingOffer = false; }
  };

  peers.set(otherId, conn);
  useCallStore.getState()._setPeer(otherId, {
    userId: otherId, connection: 'connecting',
    mic: true, cam: false, screen: false, deaf: false, speaking: false,
  });
  return conn;
}

async function handleSignal(fromUserId: string, data: any) {
  let conn = peers.get(fromUserId);
  if (!conn) conn = createPeer(fromUserId);
  const { pc } = conn;
  try {
    if (data.type === 'sdp') {
      const desc = data.sdp as RTCSessionDescriptionInit;
      const offerCollision = desc.type === 'offer' && (conn.makingOffer || pc.signalingState !== 'stable');
      conn.ignoreOffer = !conn.polite && offerCollision;
      if (conn.ignoreOffer) return;
      await pc.setRemoteDescription(desc);
      if (desc.type === 'offer') {
        await pc.setLocalDescription();
        if (pc.localDescription) sendSignal(fromUserId, { type: 'sdp', sdp: pc.localDescription });
      }
    } else if (data.type === 'ice') {
      try { await pc.addIceCandidate(data.candidate); }
      catch (e) { if (!conn.ignoreOffer) console.warn('addIceCandidate', e); }
    }
  } catch (e) { console.warn('handleSignal', e); }
}

/* ─── Публичный API ──────────────────────────────────────────────────── */

export async function attachRoom(chatId: string, kind: CallKind): Promise<void> {
  bindSocketHandlers();
  currentChatId = chatId;
  currentKind = kind;
  await ensureLocalStream(kind);
  const s = getSocket();
  if (!s) throw new Error('Socket not connected');
  s.emit('callroom:join', { chatId, kind });
}

export function detachRoom(): void {
  for (const [, conn] of peers) {
    try { conn.pc.close(); } catch {}
    conn.vaCleanup?.();
  }
  peers.clear();
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; useCallStore.getState()._setLocalStream(null); }
  if (localScreen) { localScreen.getTracks().forEach((t) => t.stop()); localScreen = null; useCallStore.getState()._setLocalScreenStream(null); }
  localVA?.(); localVA = null;
  currentChatId = null;
}

export async function addOrReplaceVideoTrack(track: MediaStreamTrack): Promise<void> {
  for (const [, conn] of peers) {
    const existing = conn.senders.get('video');
    if (existing) await existing.replaceTrack(track);
    else if (localStream) {
      const sender = conn.pc.addTrack(track, localStream);
      conn.senders.set('video', sender);
    }
  }
}

export async function removeVideoTrack(): Promise<void> {
  for (const [, conn] of peers) {
    const sender = conn.senders.get('video');
    if (sender) { try { conn.pc.removeTrack(sender); } catch {} conn.senders.delete('video'); }
  }
}

export async function startScreenShare(): Promise<boolean> {
  try {
    const s: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
    localScreen = s;
    useCallStore.getState()._setLocalScreenStream(s);
    for (const [, conn] of peers) s.getTracks().forEach((t) => conn.pc.addTrack(t, s));
    const vt = s.getVideoTracks()[0];
    if (vt) vt.onended = () => {
      const st = useCallStore.getState();
      if (st.local.screen) st.toggleScreen();
    };
    return true;
  } catch { return false; }
}

export async function stopScreenShare(): Promise<void> {
  if (!localScreen) return;
  const tracks = localScreen.getTracks();
  for (const [, conn] of peers) {
    conn.pc.getSenders().forEach((snd) => {
      if (snd.track && tracks.includes(snd.track)) {
        try { conn.pc.removeTrack(snd); } catch {}
      }
    });
  }
  tracks.forEach((t) => t.stop());
  localScreen = null;
  useCallStore.getState()._setLocalScreenStream(null);
}

export function bindSocketHandlers(): void {
  if (bound) return;
  const s = getSocket();
  if (!s) return;
  bound = true;

  s.on('callroom:peers', ({ peers: list }: { peers: Array<any> }) => {
    for (const p of list) {
      useCallStore.getState()._setPeer(p.userId, {
        userId: p.userId, mic: p.mic, cam: p.cam, screen: p.screen, deaf: p.deaf,
        speaking: false, connection: 'connecting',
      });
      createPeer(p.userId);
    }
  });

  s.on('callroom:peer-joined', ({ userId: uid, user, state }: any) => {
    useCallStore.getState()._setPeer(uid, {
      userId: uid, user, mic: state?.mic ?? true, cam: state?.cam ?? false,
      screen: state?.screen ?? false, deaf: state?.deaf ?? false, speaking: false, connection: 'connecting',
    });
    createPeer(uid);
  });

  s.on('callroom:peer-left', ({ userId: uid }: { userId: string }) => {
    const conn = peers.get(uid);
    if (conn) { try { conn.pc.close(); } catch {} conn.vaCleanup?.(); peers.delete(uid); }
    useCallStore.getState()._removePeer(uid);
  });

  s.on('callroom:signal', ({ fromUserId, data }: any) => handleSignal(fromUserId, data));

  s.on('callroom:peer-state', ({ userId: uid, state }: any) => {
    useCallStore.getState()._setPeer(uid, {
      mic: !!state.mic, cam: !!state.cam, screen: !!state.screen, deaf: !!state.deaf,
    });
  });

  s.on('callroom:ended', ({ chatId }: { chatId: string }) => {
    useCallStore.getState()._setActiveRoom(chatId, null);
    if (currentChatId === chatId) useCallStore.getState().leaveCall();
  });

  s.on('callroom:started', ({ chatId, kind, starterId }: any) => {
    useCallStore.getState()._setActiveRoom(chatId, { kind, starterId });
  });

  s.on('callroom:ring', (r: any) => {
    if (useCallStore.getState().activeChatId) return;
    useCallStore.getState()._setRing(r);
  });
}

export function getCurrentKind() { return currentKind; }

