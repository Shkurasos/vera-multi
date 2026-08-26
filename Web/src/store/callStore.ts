/*
 * callStore — Discord-подобные звонки (mesh WebRTC + socket-сигналинг).
 * Одна «комната» = один чат. Медиа — mesh (peer-to-peer), сигналинг — сервер.
 * Voice activity считается через AnalyserNode в callPeers.ts.
 */
import { create } from 'zustand';
import { getSocket } from '../services/socket';

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

  startCall: (chatId: string, kind: CallKind) => Promise<void>;
  joinCall: (chatId: string, kind: CallKind) => Promise<void>;
  leaveCall: () => void;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  toggleDeaf: () => void;
  toggleScreen: () => Promise<void>;
  setMinimized: (v: boolean) => void;
  acceptRing: () => Promise<void>;
  declineRing: () => void;

  _setPeer: (id: string, patch: Partial<CallPeer>) => void;
  _removePeer: (id: string) => void;
  _setSpeaking: (id: string, speaking: boolean) => void;
  _setRing: (r: RingState | null) => void;
  _setActiveRoom: (chatId: string, v: { kind: CallKind; starterId?: string } | null) => void;
  _setLocalStream: (s: MediaStream | null) => void;
  _setLocalScreenStream: (s: MediaStream | null) => void;
}

export const CALL_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};


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

  async startCall(chatId, kind) { await get().joinCall(chatId, kind); },

  async joinCall(chatId, kind) {
    const { attachRoom } = await import('../services/callPeers');
    set({ joining: true, activeChatId: chatId, kind, minimized: false, ring: null, peers: {} });
    try { await attachRoom(chatId, kind); }
    finally { set({ joining: false }); }
  },

  leaveCall() {
    const s = getSocket();
    const chatId = get().activeChatId;
    if (chatId && s) s.emit('callroom:leave', { chatId });
    import('../services/callPeers').then(({ detachRoom }) => detachRoom());
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

  async acceptRing() {
    const r = get().ring;
    if (!r) return;
    set({ ring: null });
    await get().joinCall(r.chatId, r.kind);
  },

  declineRing() {
    const r = get().ring;
    if (!r) return;
    const s = getSocket();
    if (s) s.emit('callroom:leave', { chatId: r.chatId });
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
}));
