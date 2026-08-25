/*
 * Vera — client-side data-layer поверх P2P-ядра.
 *
 * Заменяет прежние `api.ts` (HTTP через axios) и `socket.ts` (socket.io).
 * Все методы идут через безопасный мост `window.vera`, который поднимает
 * Electron/Capacitor preload (contextBridge). Никаких HTTP-запросов на
 * сервер: за данные отвечает локальный узел `peer/src/node.js`.
 *
 * Если приложение открыто в обычном браузере (без preload), `window.vera`
 * отсутствует — тогда `isPeerAvailable()` вернёт false, а вызовы упадут
 * с понятной ошибкой. UI-верхнему уровню это позволяет показать блок
 * «Открой Vera Desktop / установи приложение».
 */

export interface VeraProfile {
  firstName?: string;
  lastName?: string;
  username?: string;
  bio?: string;
  birthDate?: string;
  country?: string;
  region?: string;
  city?: string;
  avatarUrl?: string;
}

export interface VeraInfo {
  deviceId: string;
  accountId: string;
  name: string;
  profile: VeraProfile;
  nostrPk: string | null;
  tcpPort: number | null;
  iceServers: RTCIceServer[];
}

export interface LinkedDevice {
  deviceId: string;
  nostrPk: string;
  name: string;
  linkedAt: number;
  lastSeen?: number;
}

export interface PeerChat {
  id: string;
  kind: 'direct' | 'group';
  peers: string[];
  title?: string;
  lastTs?: number;
  ownerId?: string;
  admins?: string[];
  description?: string;
  avatar?: string;
}

export interface PeerMessage {
  id: string;
  chatId: string;
  from: string;
  fromName: string;
  to: string;
  text: string;
  ts: number;
  self?: boolean;
}

export interface CallLogEntry {
  id: string;
  peer: string;
  direction: 'in' | 'out';
  startedAt: number;
  endedAt?: number;
  kind: 'audio' | 'video';
}

export interface LinkInvite {
  url: string;
  token: string;
  expiresAt: number;
  accountId: string;
  nostrPk: string;
  syncKey: string;
  name: string | null;
  qrPng: string; // base64 PNG
}

export interface RtcSignal {
  from: string;
  type: 'offer' | 'answer' | 'ice' | 'bye' | 'hello';
  sessionId: string;
  kind: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export type VeraEvent =
  | 'ready' | 'message' | 'message-sent' | 'message-queued'
  | 'presence' | 'quality' | 'log' | 'linked-device'
  | 'rtc' | 'session-open' | 'session-close';

interface VeraBridge {
  info(): Promise<VeraInfo>;
  setName(name: string): Promise<VeraInfo>;
  updateProfile(patch: Partial<VeraProfile>): Promise<VeraInfo>;
  setAvatar(dataUrl: string): Promise<VeraInfo>;
  addMedia(item: any): Promise<any>;
  removeMedia(id: string): Promise<boolean>;
  addContact(contact: { pubkey?: string; nodeId?: string; name?: string }): Promise<any>;
  removeContact(id: string): Promise<boolean>;
  createGroup(name: string, memberIds: string[]): Promise<PeerChat>;
  joinGroup(input: { gid: string; ownerPk: string; title?: string }): Promise<PeerChat>;
  groupInviteLink(chatId: string): Promise<string>;
  storeMessage(msg: Partial<PeerMessage> & { chatId: string; text?: string; attachment?: any; kind?: string }): Promise<PeerMessage>;
  deleteChat(chatId: string): Promise<boolean>;
  updateMessage(chatId: string, id: string, patch: any): Promise<any>;
  updateChat(chatId: string, patch: any): Promise<any>;
  listChats(): Promise<PeerChat[]>;
  listMessages(chatId: string): Promise<PeerMessage[]>;
  listContacts(): Promise<any[]>;
  listCallLog(): Promise<CallLogEntry[]>;
  listMedia(): Promise<any[]>;
  listLinkedDevices(): Promise<LinkedDevice[]>;
  sendMessage(peer: string, text: string): Promise<{ ok: boolean; delivered?: boolean; queued?: boolean; note?: string }>;
  createLinkInvite(): Promise<LinkInvite>;
  acceptLinkInvite(url: string): Promise<{ accountId: string; mainNostrPk: string }>;
  rtcOpen(peerPk: string, kind?: string): Promise<string>;
  rtcSendOffer(sessionId: string, sdp: RTCSessionDescriptionInit): Promise<any>;
  rtcSendAnswer(sessionId: string, sdp: RTCSessionDescriptionInit): Promise<any>;
  rtcSendIce(sessionId: string, candidate: RTCIceCandidateInit): Promise<any>;
  rtcBye(sessionId: string): Promise<any>;
  on(event: VeraEvent, handler: (payload: any) => void): () => void;
  onDeepLink(handler: (url: string) => void): () => void;
  events: VeraEvent[];
}

declare global {
  interface Window { vera?: VeraBridge }
}

export function isPeerAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.vera;
}

function bridge(): VeraBridge {
  if (!isPeerAvailable()) {
    throw new Error('Vera работает только в приложении Vera Desktop / Vera Mobile. Скачайте установщик на vera.local.');
  }
  return window.vera as VeraBridge;
}

/* ---------- Публичное API ---------- */
export const peer = {
  info:              () => bridge().info(),
  setName:           (n: string) => bridge().setName(n),
  updateProfile:     (patch: Partial<VeraProfile>) => bridge().updateProfile(patch),
  setAvatar:         (dataUrl: string) => bridge().setAvatar(dataUrl),
  addMedia:          (item: any) => bridge().addMedia(item),
  removeMedia:       (id: string) => bridge().removeMedia(id),
  addContact:        (c: { pubkey?: string; nodeId?: string; name?: string }) => bridge().addContact(c),
  removeContact:     (id: string) => bridge().removeContact(id),
  createGroup:       (name: string, memberIds: string[] = []) => bridge().createGroup(name, memberIds),
  joinGroup:         (input: { gid: string; ownerPk: string; title?: string }) => bridge().joinGroup(input),
  groupInviteLink:   (chatId: string) => bridge().groupInviteLink(chatId),
  storeMessage:      (msg: any) => bridge().storeMessage(msg),
  deleteChat:        (chatId: string): Promise<boolean> => bridge().deleteChat(chatId),
  updateMessage:     (chatId: string, id: string, patch: any) => bridge().updateMessage(chatId, id, patch),
  updateChat:        (chatId: string, patch: any) => bridge().updateChat(chatId, patch),
  listChats:         () => bridge().listChats(),
  listMessages:      (id: string) => bridge().listMessages(id),
  listContacts:      () => bridge().listContacts(),
  listCallLog:       () => bridge().listCallLog(),
  listMedia:         () => bridge().listMedia(),
  listLinkedDevices: () => bridge().listLinkedDevices(),
  sendMessage:       (p: string, t: string) => bridge().sendMessage(p, t),
  createLinkInvite:  () => bridge().createLinkInvite(),
  acceptLinkInvite:  (url: string) => bridge().acceptLinkInvite(url),
  rtcOpen:           (pk: string, kind?: string) => bridge().rtcOpen(pk, kind),
  rtcSendOffer:      (s: string, sdp: RTCSessionDescriptionInit) => bridge().rtcSendOffer(s, sdp),
  rtcSendAnswer:     (s: string, sdp: RTCSessionDescriptionInit) => bridge().rtcSendAnswer(s, sdp),
  rtcSendIce:        (s: string, c: RTCIceCandidateInit) => bridge().rtcSendIce(s, c),
  rtcBye:            (s: string) => bridge().rtcBye(s),

  /** Подписка на событие узла. Возвращает функцию для отписки. */
  on<T = any>(event: VeraEvent, handler: (payload: T) => void): () => void {
    return bridge().on(event, handler);
  },
  /** Подписка на deep-link vera:// (Electron main → renderer). */
  onDeepLink(handler: (url: string) => void): () => void {
    return bridge().onDeepLink(handler);
  },
};

export default peer;
