/*
 * callStore — Discord-подобные звонки (mesh WebRTC + socket-сигналинг).
 * Одна «комната» = один чат. Медиа — mesh (peer-to-peer), сигналинг — сервер.
 * Voice activity считается через AnalyserNode в callPeers.ts.
 */
import { create } from 'zustand';
import { getSocket } from '../services/socket';
import { registerAccountStore } from '../services/storeSyncSimple';
import { useChatStore } from './chatStore';
import {
  startRingback, stopRingback, playCallAccept, playCallDecline, playCallHangup,
} from '../services/callSounds';

export type CallKind = 'audio' | 'video';

export interface CallPeer {
  userId: string;
  user?: {
    id: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    avatarUrl?: string;
  };
  stream?: MediaStream;
  screenStream?: MediaStream;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  deaf: boolean;
  speaking: boolean;
  connection: 'new' | 'connecting' | 'connected' | 'failed' | 'closed';
}

interface LocalState {
  mic: boolean; cam: boolean; screen: boolean; deaf: boolean; speaking: boolean;
}

export interface RingState {
  chatId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string | null;
  kind: CallKind;
}

interface CallStoreState {
  activeChatId: string | null;
  kind: CallKind;
  minimized: boolean;
  joining: boolean;
  peers: Record<string, CallPeer>;
  local: LocalState;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  ring: RingState | null;
  activeRooms: Record<string, { kind: CallKind; starterId?: string }>;
  /** Выбранный микрофон (deviceId; null — системное по умолчанию). */
  audioInputId: string | null;
  /** Выбранное устройство вывода звука звонка (null — по умолчанию). */
  audioOutputId: string | null;

  startCall: (chatId: string, kind: CallKind) => Promise<void>;
  joinCall: (chatId: string, kind: CallKind) => Promise<void>;
  /** Выход из звонка. opts.silent — без звука снятия (его уже сыграли иначе). */
  leaveCall: (opts?: { silent?: boolean }) => void;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  toggleDeaf: () => void;
  toggleScreen: () => Promise<void>;
  setMinimized: (v: boolean) => void;
  /** Сменить микрофон на лету: трек заменяется и у всех собеседников. */
  setAudioInput: (deviceId: string | null) => Promise<void>;
  /** Куда выводить звук звонка (применяется в CallAudioSink через setSinkId). */
  setAudioOutput: (deviceId: string | null) => void;
  acceptRing: () => Promise<void>;
  declineRing: () => void;

  _setPeer: (id: string, patch: Partial<CallPeer>) => void;
  _removePeer: (id: string) => void;
  _setSpeaking: (id: string, speaking: boolean) => void;
  _setRing: (r: RingState | null) => void;
  _setActiveRoom: (chatId: string, v: { kind: CallKind; starterId?: string } | null) => void;
  _setLocalStream: (s: MediaStream | null) => void;
  _setLocalScreenStream: (s: MediaStream | null) => void;
  /** Полный список активных звонков (с сервера при подключении). */
  _setActiveRooms: (rooms: Array<{ chatId: string; kind: CallKind; starterId?: string }>) => void;
}

export const CALL_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

// Выбор устройств звука персональный и аппаратно-зависимый — храним локально,
// без серверной синхронизации.
const LS_AUDIO_INPUT = 'vera_call_audio_input';
const LS_AUDIO_OUTPUT = 'vera_call_audio_output';
function readDeviceId(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeDeviceId(key: string, value: string | null) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
}


export const useCallStore = create<CallStoreState>((set, get) => ({
  activeChatId: null,
  kind: 'audio',
  minimized: false,
  joining: false,
  peers: {},
  local: { mic: true, cam: false, screen: false, deaf: false, speaking: false },
  localStream: null,
  localScreenStream: null,
  ring: null,
  activeRooms: {},
  audioInputId: readDeviceId(LS_AUDIO_INPUT),
  audioOutputId: readDeviceId(LS_AUDIO_OUTPUT),

  async startCall(chatId, kind) {
    await get().joinCall(chatId, kind);
    // Личный звонок: слушаем гудки, пока собеседник не примет вызов.
    // Групповые звонки без «принятия» — там участники заходят сами.
    const chat = useChatStore.getState().chats.find((c) => c.id === chatId);
    if (chat?.type === 'direct' || chat?.type === 'private') startRingback();
  },

  async joinCall(chatId, kind) {
    const { attachRoom } = await import('../services/callPeers');
    // В видео-звонке камера уже захвачена (constraints = audio+video),
    // поэтому cam обязан быть true сразу: иначе тайл рендерит аватар вместо
    // картинки, хотя поток идёт, и собеседник видит «камера выключена».
    const cam = kind === 'video';
    set({
      joining: true, activeChatId: chatId, kind, minimized: false, ring: null, peers: {},
      local: { ...get().local, cam },
    });
    try { await attachRoom(chatId, kind); }
    finally { set({ joining: false }); }
    const s = getSocket();
    if (s) s.emit('callroom:state', { chatId, patch: { cam } });
  },

  leaveCall(opts) {
    const s = getSocket();
    const chatId = get().activeChatId;
    stopRingback();
    if (chatId && s) s.emit('callroom:leave', { chatId });
    import('../services/callPeers').then(({ detachRoom }) => detachRoom());
    // Звук снятия трубки — только если звонок реально был и его не просили
    // промолчать (например, при отклонении вызова звонящим).
    if (chatId && !opts?.silent) playCallHangup();
    set({
      activeChatId: null, peers: {}, minimized: false,
      localStream: null, localScreenStream: null,
      local: { mic: true, cam: false, screen: false, deaf: false, speaking: false },
    });
  },

  toggleMic() {
    const { localStream, local, activeChatId } = get();
    const nv = !local.mic;
    localStream?.getAudioTracks().forEach((t) => (t.enabled = nv));
    set({ local: { ...local, mic: nv } });
    const s = getSocket();
    if (s && activeChatId) s.emit('callroom:state', { chatId: activeChatId, patch: { mic: nv } });
  },

  async toggleCam() {
    const { local, localStream, activeChatId } = get();
    const nv = !local.cam;
    if (!localStream) return;
    if (nv) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const vTrack = cam.getVideoTracks()[0];
        if (vTrack) {
          localStream.addTrack(vTrack);
          const { addOrReplaceVideoTrack } = await import('../services/callPeers');
          await addOrReplaceVideoTrack(vTrack);
        }
      } catch (e) { console.warn('toggleCam failed', e); return; }
    } else {
      const vt = localStream.getVideoTracks();
      vt.forEach((t) => { t.stop(); localStream.removeTrack(t); });
      const { removeVideoTrack } = await import('../services/callPeers');
      await removeVideoTrack();
    }
    set({ local: { ...get().local, cam: nv } });
    const s = getSocket();
    if (s && activeChatId) s.emit('callroom:state', { chatId: activeChatId, patch: { cam: nv } });
  },

  toggleDeaf() {
    const { local, activeChatId, localStream } = get();
    const nv = !local.deaf;
    const nextMic = nv ? false : local.mic;
    localStream?.getAudioTracks().forEach((t) => (t.enabled = nextMic));
    set({ local: { ...local, deaf: nv, mic: nextMic } });
    const s = getSocket();
    if (s && activeChatId) s.emit('callroom:state', { chatId: activeChatId, patch: { deaf: nv, mic: nextMic } });
  },

  async toggleScreen() {
    const { local, activeChatId } = get();
    const nv = !local.screen;
    const { startScreenShare, stopScreenShare } = await import('../services/callPeers');
    if (nv) { const ok = await startScreenShare(); if (!ok) return; }
    else await stopScreenShare();
    set({ local: { ...get().local, screen: nv } });
    const s = getSocket();
    if (s && activeChatId) s.emit('callroom:state', { chatId: activeChatId, patch: { screen: nv } });
  },

  setMinimized(v) { set({ minimized: v }); },

  async setAudioInput(deviceId) {
    writeDeviceId(LS_AUDIO_INPUT, deviceId);
    set({ audioInputId: deviceId });
    const { localStream, local } = get();
    if (!localStream) return; // вне звонка — выбор просто запомнится
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (deviceId) audio.deviceId = { exact: deviceId };
    let fresh: MediaStream;
    try {
      fresh = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (e) {
      console.warn('setAudioInput: device unavailable', e);
      return;
    }
    const newTrack = fresh.getAudioTracks()[0];
    if (!newTrack) return;
    // Микрофон мог быть выключен — сохраняем текущее состояние.
    newTrack.enabled = local.mic;
    // Меняем трек прямо в потоке: srcObject у тайлов и VA остаются валидными.
    localStream.getAudioTracks().forEach((t) => { t.stop(); localStream.removeTrack(t); });
    localStream.addTrack(newTrack);
    const { replaceAudioTrack } = await import('../services/callPeers');
    await replaceAudioTrack(newTrack);
  },

  setAudioOutput(deviceId) {
    writeDeviceId(LS_AUDIO_OUTPUT, deviceId);
    set({ audioOutputId: deviceId });
  },

  async acceptRing() {
    const r = get().ring;
    if (!r) return;
    set({ ring: null });
    // Звук принятия — сразу; дубля при коннекте пира не будет (флаг в callPeers).
    playCallAccept();
    const { primeAcceptSound } = await import('../services/callPeers');
    primeAcceptSound();
    await get().joinCall(r.chatId, r.kind);
  },

  declineRing() {
    const r = get().ring;
    if (!r) return;
    const s = getSocket();
    // Сервер уведомит звонящего (callroom:ring-declined) — тот перестанет
    // слушать гудки, выйдет из комнаты и услышит «отклонено».
    if (s) s.emit('callroom:decline', { chatId: r.chatId });
    playCallDecline();
    set({ ring: null });
  },

  _setPeer(id, patch) {
    set((st) => {
      const prev = st.peers[id] || { userId: id, mic: true, cam: false, screen: false, deaf: false, speaking: false, connection: 'new' as const };
      return { peers: { ...st.peers, [id]: { ...prev, ...patch } } };
    });
  },
  _removePeer(id) {
    set((st) => { const n = { ...st.peers }; delete n[id]; return { peers: n }; });
  },
  _setSpeaking(id, speaking) {
    if (id === '__local__') { set((st) => ({ local: { ...st.local, speaking } })); return; }
    set((st) => {
      const p = st.peers[id];
      if (!p || p.speaking === speaking) return {} as any;
      return { peers: { ...st.peers, [id]: { ...p, speaking } } };
    });
  },
  _setRing(r) { set({ ring: r }); },
  _setActiveRoom(chatId, v) {
    set((st) => {
      const n = { ...st.activeRooms };
      if (v) n[chatId] = v; else delete n[chatId];
      return { activeRooms: n };
    });
  },
  _setLocalStream(s) { set({ localStream: s }); },
  _setLocalScreenStream(s) { set({ localScreenStream: s }); },
  _setActiveRooms(rooms) {
    const next: Record<string, { kind: CallKind; starterId?: string }> = {};
    for (const r of rooms || []) {
      if (!r || !r.chatId) continue;
      next[r.chatId] = { kind: r.kind === 'video' ? 'video' : 'audio', starterId: r.starterId };
    }
    set({ activeRooms: next });
  },
}));

registerAccountStore('calls', useCallStore);
