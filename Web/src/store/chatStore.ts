import { create } from 'zustand';
import { Chat, Message } from '../types';
import { chatsApi, messagesApi, aiApi } from '../services/api';
import { getSocket } from '../services/socket';
import { peer, isPeerAvailable, PeerChat, PeerMessage } from '../services/peer';
import { useAuthStore } from './authStore';
import { useChatPrefsStore } from './chatPrefsStore';
import {
  loadArchivedChats, saveArchivedChats, deleteArchivedChat,
  loadArchivedMessages, saveArchivedMessages, deleteArchivedMessage,
  mergeById,
} from '../services/localArchive';
import { registerAccountStore } from '../services/storeSyncSimple';

/* ---------- P2P ↔ UI-модель адаптеры ---------- */
// UI-типы (Chat/Message) исторически заточены под серверную модель.
// В P2P-режиме приводим ответы peer.* к тем же полям, чтобы не переписывать
// компоненты. Недостающие поля заполняем разумными дефолтами.
function peerChatToChat(c: PeerChat): Chat {
  const ownerId = (c as any).ownerId as string | undefined;
  const admins: string[] = Array.isArray((c as any).admins) ? (c as any).admins : (ownerId ? [ownerId] : []);
  return {
    id: c.id,
    type: c.kind === 'group' ? 'group' : 'private',
    name: c.title,
    description: (c as any).description || '',
    avatarUrl: (c as any).avatar || '',
    pinnedMessageId: c.pinnedMessageId || undefined,
    isPublic: false,
    ownerId,
    members: c.peers.map((pk) => ({
      id: pk, chatId: c.id, userId: pk,
      role: (ownerId && pk === ownerId) ? 'owner' : (admins.includes(pk) ? 'admin' : 'member'),
      isMuted: false, joinedAt: new Date().toISOString(),
      user: { id: pk, username: pk.slice(0, 8), firstName: pk.slice(0, 8), isOnline: false, createdAt: '', lastName: '' } as any,
    })),
    unreadCount: 0,
    createdAt: new Date(c.lastTs || Date.now()).toISOString(),
    updatedAt: new Date(c.lastTs || Date.now()).toISOString(),
  } as Chat;
}
function peerMsgToMsg(m: PeerMessage): Message {
  const att = (m as any).attachment;
  const attachments = Array.isArray((m as any).attachments)
    ? (m as any).attachments
    : att ? [att] : undefined;
  const kind = (m as any).kind || 'text';
  const isSelf = (m as any).self === true;
  const selfUser = useAuthStore.getState().user;
  const selfId = selfUser?.id;
  // Если сообщение своё — принудительно кладём selfId в senderId, чтобы UI
  // (isOwn = senderId === user.id) корректно отрисовал пузырь справа.
  const senderId = isSelf && selfId ? selfId : m.from;
  const sender = isSelf && selfUser
    ? {
        id: selfUser.id,
        username: selfUser.username,
        firstName: selfUser.firstName,
        lastName: selfUser.lastName,
        avatarUrl: selfUser.avatarUrl,
        isOnline: true,
        createdAt: selfUser.createdAt || '',
      }
    : { id: senderId, username: m.fromName, firstName: m.fromName, isOnline: true, createdAt: '', lastName: '' };
  return {
    id: m.id,
    chatId: m.chatId,
    senderId,
    sender: sender as any,
    type: kind,
    content: m.text,
    attachments,
    reactions: (m as any).reactions || undefined,
    forwardFromId: (m as any).forwardFromId,
    forwardFromName: (m as any).forwardFromName,
    isEdited: (m as any).edited === true, isPinned: false, isDeleted: (m as any).deleted === true,
    createdAt: new Date(m.ts).toISOString(),
    updatedAt: new Date(m.ts).toISOString(),
  } as Message;
}


const attachReplyPreview = (message: Message, messages: Record<string, Message[]>): Message => {
  if (!message.replyToId || message.replyTo) return message;
  const source = messages[message.chatId] || [];
  const replyTo = source.find((m) => m.id === message.replyToId);
  return replyTo ? { ...message, replyTo } : message;
};

/* ---------- Локальные заглушки сообщений (id `temp-...`) ---------- */
/** Показывается только когда заглушка ещё не подтверждена сервером. */
const PENDING_SEND_ERROR = 'Сообщение ещё отправляется — подождите пару секунд';

const isTemporaryId = (id: unknown): boolean => typeof id === 'string' && id.startsWith('temp-');

/** Подтверждённое сервером сообщение для локальной заглушки (если уже пришло). */
function findConfirmedMessage(messages: Record<string, Message[]>, tempId: string): Message | undefined {
  for (const list of Object.values(messages || {})) {
    for (const m of list || []) {
      if (m && m.id !== tempId && (m as any).clientTempId === tempId) return m;
    }
  }
  return undefined;
}

/**
 * Идентификатор, по которому можно вызывать серверные действия.
 * Если сообщение уже подтверждено сервером, возвращаем реальный id — правка и
 * закрепление работают даже когда в списке осталась локальная заглушка.
 * null — заглушка действительно ещё не отправлена.
 */
function resolveActionableId(messages: Record<string, Message[]>, messageId: string): string | null {
  if (!isTemporaryId(messageId)) return messageId;
  return findConfirmedMessage(messages, messageId)?.id || null;
}

/**
 * Убирает локальную заглушку, когда пришло подтверждённое сообщение.
 * Обычно сервер возвращает clientTempId, но старые сборки и P2P-мост могут его
 * не присылать — тогда подстраховываемся совпадением текста и отправителя.
 */
function withoutTemporaryCopy(list: Message[], confirmed: Message, myId?: string): Message[] {
  const tempId = (confirmed as any).clientTempId as string | undefined;
  const senderId = (confirmed as any).authorId || confirmed.senderId;
  let fallbackRemoved = false;
  return (list || []).filter((m) => {
    if (!m || m.id === confirmed.id) return true;
    if (!isTemporaryId(m.id)) return true;
    if (tempId && m.id === tempId) return false;
    if (!tempId && !fallbackRemoved && myId && senderId === myId && m.senderId === myId
      && !!m.content && m.content === confirmed.content) {
      fallbackRemoved = true;
      return false;
    }
    return true;
  });
}

/** Текущие закреплённые id чата (поддерживает старый формат с одним id). */
function chatPinnedIds(chat: Chat | null | undefined): string[] {
  if (!chat) return [];
  return Array.isArray(chat.pinnedMessageIds)
    ? chat.pinnedMessageIds.filter(Boolean)
    : (chat.pinnedMessageId ? [chat.pinnedMessageId] : []);
}

interface ChatState {
  chats: Chat[];
  activeChat: Chat | null;
  messages: Record<string, Message[]>;
  loadingMessages: boolean;
  typingUsers: Record<string, string[]>;
  onlineUsers: Set<string>;

  loadChats: () => Promise<void>;
  setActiveChat: (chat: Chat | null) => void;
  loadMessages: (chatId: string, before?: string) => Promise<void>;
  sendMessage: (chatId: string, content: string, replyToId?: string) => Promise<void>;
  forwardMessage: (chatId: string, source: Message) => Promise<void>;
  sendMessageWithFile: (chatId: string, attachment: any, replyToId?: string, type?: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, chatId: string) => Promise<void>;
  pinMessage: (chatId: string, messageId: string | null) => Promise<void>;
  /** Открепить одно сообщение — остальные закреплённые остаются. */
  unpinMessage: (chatId: string, messageId: string) => Promise<void>;
  addReaction: (chatId: string, messageId: string, emoji: string) => Promise<void>;
  leaveChat: (chatId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  replaceOrAddMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (messageId: string, chatId: string) => void;
  applyPinnedMessage: (chatId: string, messageId: string | null, pinnedMessage?: Message | null, pinnedMessageIds?: string[], pinnedMessageList?: Message[] | null) => void;
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
  markRead: (chatId: string, messageId: string) => void;
  markChatRead: (chatId: string) => void;
  updateChatList: (chat: Chat) => void;
  setUserOnline: (userId: string) => void;
  setUserOffline: (userId: string) => void;
  clearOnlineUsers: () => void;
  markMessageRead: (chatId: string, messageId: string, userId: string) => void;
}

const VERA_AI_ID = 'vera-ai';
function veraAiChat(): Chat {
  const now = new Date().toISOString();
  return { id: VERA_AI_ID, type: 'private', name: 'Vera AI', description: 'Локальная нейросеть Ollama', avatarUrl: '', isPublic: false, members: [], unreadCount: 0, createdAt: now, updatedAt: now };
}
function withVeraAi(chats: Chat[]): Chat[] {
  const withoutVera = chats.filter(c => c.id !== VERA_AI_ID);
  if (!useAuthStore.getState().user?.isAdmin) return withoutVera;
  const ai = veraAiChat();
  const existing = chats.find(c => c.id === VERA_AI_ID);
  return [{ ...ai, ...existing, name: ai.name }, ...withoutVera];
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChat: null,
  messages: {},
  loadingMessages: false,
  typingUsers: {},
  onlineUsers: new Set<string>(),

  setUserOnline: (userId) => {
    set((state) => {
      const next = new Set(state.onlineUsers);
      next.add(userId);
      return { onlineUsers: next };
    });
  },

  setUserOffline: (userId) => {
    set((state) => {
      const next = new Set(state.onlineUsers);
      next.delete(userId);
      return { onlineUsers: next };
    });
  },

  clearOnlineUsers: () => set({ onlineUsers: new Set<string>() }),

  loadChats: async () => {
    // Сначала мгновенно показываем локальный архив (если есть).
    try {
      const archived = await loadArchivedChats();
      if (archived.length > 0 && get().chats.length === 0) {
        set({ chats: archived });
      }
    } catch {}

    // P2P-режим: список чатов приходит из локального узла (peer.listChats).
    if (isPeerAvailable()) {
      try {
        const raw = await peer.listChats();
        const chats = raw.map(peerChatToChat);
        set({ chats: withVeraAi(chats) });
        saveArchivedChats(chats).catch(() => {});
      } catch (err) { console.error('[peer] loadChats error:', err); }
      return;
    }
    try {
      const res = await chatsApi.getAll();
      const normalized = (res.data as any[]).filter((chat: any) => chat && chat.id).map((chat: any) => {
        const rawType = chat.type || 'private';
        const type = rawType === 'direct' ? 'private' : rawType;
        const members: import('../types').ChatMember[] = (chat.members || []).map((m: any) => {
          if (m.userId !== undefined) {
            return {
              id: m.id || m.userId,
              chatId: chat.id,
              userId: m.userId,
              user: m.user || undefined,
              role: m.role || 'member',
              isMuted: m.muted || false,
              joinedAt: m.joinedAt || chat.createdAt,
            } as import('../types').ChatMember;
          }
          return {
            id: m.id,
            chatId: chat.id,
            userId: m.id,
            user: m,
            role: m.role || 'member',
            isMuted: false,
            joinedAt: chat.createdAt,
          } as import('../types').ChatMember;
        });
        return {
          ...chat,
          type,
          members,
          isPublic: chat.isPublic ?? false,
          unreadCount: chat.unreadCount ?? 0,
          updatedAt: chat.updatedAt || chat.createdAt,
        } as import('../types').Chat;
      });
      // Мерджим с архивом: чаты которые сервер потерял (Render /tmp почистился)
      // остаются у пользователя, а свежие данные с сервера обновляют локальные.
      const archived = await loadArchivedChats().catch(() => [] as Chat[]);
      const merged = mergeById(archived, normalized);
      set({ chats: withVeraAi(merged) });
      normalized.forEach(chat => get().applyPinnedMessage(
        chat.id,
        chat.pinnedMessageId || null,
        chat.pinnedMessage || null,
        chat.pinnedMessageIds,
        chat.pinnedMessages,
      ));
      saveArchivedChats(normalized).catch(() => {});
    } catch (err) {
      console.error('loadChats error:', err);
    }
  },

  setActiveChat: (chat) => {
    set({ activeChat: chat });
    if (chat) {
      try {
        const socket = getSocket();
        socket?.emit('chat:join', chat.id);
      } catch {}
      get().loadMessages(chat.id).then(() => {
        const msgs = get().messages[chat.id] || [];
        const lastIncoming = [...msgs].reverse().find((m) => m.senderId !== useAuthStore.getState().user?.id);
        const lastAny = msgs[msgs.length - 1];
        const last = lastIncoming || lastAny;
        if (last?.id) get().markRead(chat.id, last.id);
      });
      set((state) => ({
        chats: state.chats.map((c) =>
          c.id === chat.id ? { ...c, unreadCount: 0 } : c
        ),
      }));
    }
  },

  loadMessages: async (chatId, before) => {
    if (!before && !isPeerAvailable() && chatId !== VERA_AI_ID) {
      const { useOutboxStore } = await import('./outboxStore');
      const user = useAuthStore.getState().user;
      const pending: Message[] = useOutboxStore.getState().items.filter(item => item.chatId === chatId).map(item => ({
        id: item.clientTempId, chatId, senderId: user?.id, sender: user || undefined,
        content: item.content, replyToId: item.replyToId, type: 'text' as const,
        createdAt: item.createdAt, updatedAt: item.createdAt,
        isEdited: false, isPinned: false, isDeleted: false,
      }));
      set(state => ({ messages: { ...state.messages, [chatId]: mergeById(pending, state.messages[chatId] || []) } }));
    }
    // Показываем архивную историю мгновенно (только для первой загрузки чата).
    if (!before) {
      try {
        const archived = await loadArchivedMessages(chatId);
        if (archived.length > 0 && (!get().messages[chatId] || get().messages[chatId].length === 0)) {
          set((state) => ({ messages: { ...state.messages, [chatId]: archived } }));
        }
      } catch {}
    }

    if (chatId === VERA_AI_ID) return;
    // P2P-режим: сообщения хранятся локально в peer/src/store.
    if (isPeerAvailable()) {
      set({ loadingMessages: true });
      try {
        const raw = await peer.listMessages(chatId);
        const pinnedMessageId = get().chats.find((c) => c.id === chatId)?.pinnedMessageId;
        const msgs = raw.map(peerMsgToMsg).filter((m) => !m.isDeleted).map((m) => ({
          ...m,
          isPinned: m.id === pinnedMessageId,
        }));
        set((state) => ({ messages: { ...state.messages, [chatId]: msgs } }));
        saveArchivedMessages(msgs).catch(() => {});
      } catch (err) { console.error('[peer] loadMessages error:', err); }
      finally { set({ loadingMessages: false }); }
      return;
    }
    set({ loadingMessages: true });
    try {
      const res = await messagesApi.getMessages(chatId, before, 50);
      const incoming: Message[] = res.data;
      // Мерджим свежее с сервера и архив, чтобы сообщения не пропадали при
      // очистке /tmp на Render. Только для первой страницы (без before).
      let merged: Message[];
      if (before) {
        merged = mergeById(get().messages[chatId] || [], incoming);
      } else {
        const archived = await loadArchivedMessages(chatId).catch(() => [] as Message[]);
        merged = mergeById(mergeById(archived, get().messages[chatId] || []), incoming);
      }
      set((state) => ({
        messages: { ...state.messages, [chatId]: merged.filter(m => !merged.some(saved => (saved as any).clientTempId === m.id)) },
      }));
      saveArchivedMessages(incoming).catch(() => {});
      if (!before && get().activeChat?.id === chatId && incoming.length) {
        const userId = useAuthStore.getState().user?.id;
        const lastIncoming = [...incoming].reverse().find((m) => m.senderId !== userId);
        const last = lastIncoming || incoming[incoming.length - 1];
        if (last?.id) get().markRead(chatId, last.id);
      }
    } catch (err) {
      console.error('loadMessages error:', err);
    } finally {
      set({ loadingMessages: false });
    }
  },

  sendMessage: async (chatId, content, replyToId) => {
    const user = useAuthStore.getState().user;
    const clientTempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const tempMsg: Message = {
      id: clientTempId,
      chatId,
      senderId: user?.id,
      sender: user || undefined,
      content,
      type: 'text',
      isEdited: false,
      isPinned: false,
      isDeleted: false,
      replyToId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), attachReplyPreview(tempMsg, state.messages)],
      },
    }));
    // Vera AI is a local chat: persist the user's message immediately so it
    // cannot disappear when the chat is reopened or the server is unavailable.
    if (chatId === VERA_AI_ID) {
      // IndexedDB intentionally skips temporary IDs used by the server outbox.
      // Vera is local, so give its user message a permanent archive ID now.
      saveArchivedMessages([{ ...tempMsg, id: `vera-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }]).catch(() => {});
    }

    if (chatId === VERA_AI_ID) {
      try {
        const response = await aiApi.chat(content);
        const answerText = String(response.data?.answer || '').trim();
        if (!answerText) throw new Error('Vera AI вернула пустой ответ');
        const answer: Message = { id: `vera-${Date.now()}`, chatId, senderId: VERA_AI_ID, sender: { id: VERA_AI_ID, username: 'vera-ai', firstName: 'Vera AI', isOnline: true, createdAt: new Date().toISOString() } as any, type: 'text', content: answerText, isEdited: false, isPinned: false, isDeleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        set(state => ({ messages: { ...state.messages, [chatId]: [...(state.messages[chatId] || []), answer] } }));
        saveArchivedMessages([answer]).catch(() => {});
      } catch (error: any) {
        const errorText = error?.response?.data?.message || error?.message || 'Не удалось получить ответ от Vera AI';
        const failed: Message = { id: `vera-error-${Date.now()}`, chatId, senderId: VERA_AI_ID, sender: { id: VERA_AI_ID, username: 'vera-ai', firstName: 'Vera AI', isOnline: false, createdAt: new Date().toISOString() } as any, type: 'text', content: `Ошибка: ${errorText}`, isEdited: false, isPinned: false, isDeleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        set(state => ({ messages: { ...state.messages, [chatId]: [...(state.messages[chatId] || []), failed] } }));
        saveArchivedMessages([failed]).catch(() => {});
      }
      return;
    }

    try {
      // P2P: адресат — pubkey/nodeId контакта. В direct-чате берём его из
      // members (кладётся туда `peerChatToChat`). Сам chatId — это составной
      // ключ вида "<selfId>|<peerId>", отправить по нему нельзя.
      if (isPeerAvailable()) {
        const chat = get().chats.find((c) => c.id === chatId) || get().activeChat;
        const isGroup = chat?.type === 'group' || String(chatId).startsWith('group-');
        // Группы: mesh пока не умеет fanout — сохраняем локально под реальным
        // chatId (group-*), чтобы сообщение осталось после перезахода.
        if (isGroup) {
          const r = await peer.sendMessage(chatId, content);
          if (r && (r as any).id) {
            set((state) => ({
              messages: {
                ...state.messages,
                [chatId]: (state.messages[chatId] || []).map((m) =>
                  m.id === tempMsg.id ? { ...m, id: (r as any).id } : m
                ),
              },
            }));
          }
          return;
        }
        // Direct-чат: chatId = sort([myPk, peerPk]).join('|'). Отправитель
        // — тот из peers, кто не мы. Сам peerPk = nostrPk другого устройства.
        const info = await peer.info();
        const myPk = info.nostrPk || useAuthStore.getState().user?.id;
        const peerId = (chat?.members || [])
          .map((m: any) => m.userId)
          .find((id: string) => id && id !== myPk)
          || String(chatId).split('|').find((p) => p && p !== myPk);
        if (!peerId) {
          console.warn('[peer] sendMessage: не нашли pubkey собеседника в chat', chatId);
          return;
        }
        const r = await peer.sendMessage(peerId, content);
        if (!r.ok) console.warn('[peer] sendMessage not ok:', r);
        // Заменяем temp-сообщение реальным id, чтобы после reload дубля не было.
        if (r && (r as any).id) {
          set((state) => ({
            messages: {
              ...state.messages,
              [chatId]: (state.messages[chatId] || []).map((m) =>
                m.id === tempMsg.id ? { ...m, id: (r as any).id } : m
              ),
            },
          }));
        }
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const { useOutboxStore } = await import('./outboxStore');
        useOutboxStore.getState().enqueue({ clientTempId, chatId, content, replyToId });
        return;
      }
      const { data } = await messagesApi.send(chatId, { text: content, replyToId, clientTempId });
      if (!data?.id) throw new Error('Нет подтверждения сохранения');
      get().replaceOrAddMessage({ ...data, clientTempId });
    } catch (err) {
      console.error('sendMessage error:', err);
      // Не удаляем — оставляем pending, попробуем через outbox.
      const { useOutboxStore } = await import('./outboxStore');
      useOutboxStore.getState().enqueue({ clientTempId, chatId, content, replyToId });
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: (state.messages[chatId] || []).map((m) =>
            m.id === tempMsg.id ? { ...m, status: 'pending' } as any : m
          ),
        },
      }));
    }
  },

  forwardMessage: async (chatId, source) => {
    if (source.isDeleted) throw new Error('Удалённое сообщение переслать нельзя');
    // Если сервер уже подтвердил отправку — пересылаем по реальному id.
    const sourceId = resolveActionableId(get().messages, source.id);
    if (!sourceId) throw new Error('Дождитесь отправки исходного сообщения');
    if (chatId === VERA_AI_ID) throw new Error('Пересылка в Vera AI пока не поддерживается');
    if (isPeerAvailable()) {
      // The legacy bridge only transports text. Do not report a local file
      // copy as a successful delivery to another peer.
      if (source.attachments?.length || source.poll) {
        throw new Error('Этот P2P-мост не поддерживает пересылку вложений');
      }
      const chat = get().chats.find(c => c.id === chatId);
      const info = await peer.info();
      const myPk = info.nostrPk || info.deviceId;
      const target = chat?.type === 'group' ? chatId : chat?.members.find(m => m.userId !== myPk && m.userId !== info.deviceId)?.userId;
      if (!target) throw new Error('Не найден получатель пересылки');
      const name = source.forwardFromName || source.sender?.firstName || source.sender?.username || 'Пользователь';
      const result = await peer.sendMessage(target, `Переслано от ${name}:\n${source.content || ''}`);
      if (!result.ok) throw new Error(result.note || 'Не удалось переслать сообщение');
      await get().loadMessages(chatId);
      return;
    }
    const { data } = await messagesApi.send(chatId, { forwardFromId: sourceId });
    if (!data?.id) throw new Error('Нет подтверждения пересылки');
    get().replaceOrAddMessage(data);
  },

  sendMessageWithFile: async (chatId, attachment, replyToId, type = 'document') => {
    const user = useAuthStore.getState().user;
    const tempId = 'temp-' + Date.now();
    const tempMsg: Message = {
      id: tempId,
      chatId,
      senderId: user?.id,
      sender: user || undefined,
      content: '',
      type: type as any,
      isEdited: false,
      isPinned: false,
      isDeleted: false,
      replyToId,
      attachments: [attachment],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), attachReplyPreview(tempMsg, state.messages)],
      },
    }));

    try {
      // P2P: mesh не умеет slać attachments — сохраняем сообщение локально,
      // чтобы ГС/файлы не пропадали при перезаходе в чат.
      if (isPeerAvailable()) {
        const saved = await peer.storeMessage({
          chatId,
          text: '',
          attachment,
          kind: type,
        });
        set((state) => {
          const existing = state.messages[chatId] || [];
          const filtered = existing.filter((m) => m.id !== tempId);
          const finalMsg: Message = {
            ...tempMsg,
            id: saved.id,
            createdAt: new Date(saved.ts).toISOString(),
            updatedAt: new Date(saved.ts).toISOString(),
          };
          return {
            messages: {
              ...state.messages,
              [chatId]: [...filtered, attachReplyPreview(finalMsg, state.messages)],
            },
          };
        });
        return;
      }
      const res = await messagesApi.send(chatId, {
        text: '',
        replyToId,
        attachments: [attachment],
        type,
        // Тот же контракт, что у текстовых сообщений: сервер вернёт clientTempId,
        // и локальная заглушка гарантированно заменится подтверждённым сообщением.
        clientTempId: tempId,
      });
      set((state) => {
        const existing = state.messages[chatId] || [];
        const filtered = existing.filter(
          (m) => m.id !== tempId && m.id !== res.data?.id
        );
        return {
          messages: {
            ...state.messages,
            [chatId]: [...filtered, attachReplyPreview(res.data, state.messages)],
          },
        };
      });
    } catch (err) {
      console.error('sendMessageWithFile error:', err);
      get().removeMessage(tempId, chatId);
      throw err;
    }

  },

  editMessage: async (messageId, content) => {
    // Заглушку `temp-*` переводим в реальный id, если подтверждение уже пришло.
    const resolvedId = resolveActionableId(get().messages, messageId);
    if (!resolvedId) throw new Error(PENDING_SEND_ERROR);
    messageId = resolvedId;
    const original = Object.values(get().messages).flat().find(m => m.id === messageId);
    try {
      let chatId = original?.chatId;
      if (!chatId) {
        const entry = Object.entries(get().messages).find(([, list]) =>
          list.some((m) => m.id === messageId),
        );
        chatId = entry?.[0];
      }

      if (chatId) {
        set((state) => ({
          messages: {
            ...state.messages,
            [chatId!]: (state.messages[chatId!] || []).map((m) =>
              m.id === messageId
                ? { ...m, content, isEdited: true, updatedAt: new Date().toISOString() }
                : m,
            ),
          },
        }));
      }

      // P2P: сохраняем правку локально через peer store.
      if (chatId && isPeerAvailable()) {
        await peer.updateMessage(chatId, messageId, { text: content, edited: true });
        await saveArchivedMessages(get().messages[chatId] || []);
        return;
      }

      // Сервер не слушает socket-событие `message:edit` (есть только REST
      // PUT /api/messages/:id), поэтому всегда сохраняем правку через HTTP.
      // Ответ сервера нормализуем: там поле `text`, а UI использует `content`.
      const res = await messagesApi.edit(messageId, content);
      const saved = res.data;
      if (saved?.id) {
        get().updateMessage({
          ...saved,
          content: saved.content ?? saved.text ?? content,
          isEdited: true,
        });
      }
    } catch (err) {
      if (original) get().updateMessage(original);
      console.error('editMessage error:', err);
      throw err;
    }
  },

  deleteMessage: async (messageId, chatId) => {
    const resolvedId = resolveActionableId(get().messages, messageId);
    if (!resolvedId) throw new Error(PENDING_SEND_ERROR);
    messageId = resolvedId;
    try {
      if (isPeerAvailable()) {
        // P2P: физически удаляем через peer.updateMessage → пометим deleted=true,
        // и убираем из UI. Полное удаление можно добавить позже отдельным API.
        await peer.updateMessage(chatId, messageId, { deleted: true, text: '' });
        get().removeMessage(messageId, chatId);
        return;
      }
      await messagesApi.delete(messageId);
      get().removeMessage(messageId, chatId);
    } catch (err) {
      console.error('deleteMessage error:', err);
      throw err;
    }
  },

  pinMessage: async (chatId, messageId) => {
    if (messageId) {
      // Заглушка `temp-*` → реальный id, если сервер уже подтвердил отправку.
      const resolvedId = resolveActionableId(get().messages, messageId);
      if (!resolvedId) throw new Error(PENDING_SEND_ERROR);
      messageId = resolvedId;
    }
    if (isPeerAvailable()) {
      // P2P: список закреплённых ведём локально, чтобы поддержать несколько.
      const next = messageId
        ? [messageId, ...chatPinnedIds(get().chats.find((c) => c.id === chatId) || get().activeChat).filter((id) => id !== messageId)]
        : [];
      await peer.updateChat(chatId, { pinnedMessageId: next[0] || null, pinnedMessageIds: next });
      get().applyPinnedMessage(chatId, messageId, undefined, next);
    } else {
      const res = await messagesApi.pin(messageId, chatId);
      const payload: any = res.data || {};
      get().applyPinnedMessage(
        chatId,
        payload.messageId ?? messageId,
        payload.pinnedMessage ?? null,
        payload.pinnedMessageIds,
        payload.pinnedMessages,
      );
    }
  },

  /** Открепить одно сообщение — остальные закреплённые остаются. */
  unpinMessage: async (chatId, messageId) => {
    const resolvedId = resolveActionableId(get().messages, messageId);
    if (!resolvedId) throw new Error(PENDING_SEND_ERROR);
    if (isPeerAvailable()) {
      const next = chatPinnedIds(get().chats.find((c) => c.id === chatId) || get().activeChat)
        .filter((id) => id !== resolvedId);
      await peer.updateChat(chatId, { pinnedMessageId: next[0] || null, pinnedMessageIds: next });
      get().applyPinnedMessage(chatId, resolvedId, undefined, next);
    } else {
      const res = await messagesApi.unpin(resolvedId, chatId);
      const payload: any = res.data || {};
      get().applyPinnedMessage(
        chatId,
        payload.messageId ?? resolvedId,
        payload.pinnedMessage ?? null,
        payload.pinnedMessageIds,
        payload.pinnedMessages,
      );
    }
  },

  addReaction: async (chatId, messageId, emoji) => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const resolvedId = resolveActionableId(get().messages, messageId);
    if (!resolvedId) throw new Error(PENDING_SEND_ERROR);
    messageId = resolvedId;
    const original = (get().messages[chatId] || []).find(m => m.id === messageId);
    try {

    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map((m) => {
          if (m.id !== messageId) return m;
          const reactions = [...(m.reactions || [])];
          const idx = reactions.findIndex((r) => r.emoji === emoji);
          if (idx >= 0) {
            const r = reactions[idx];
            if (r.userIds.includes(user.id)) {
              const newUserIds = r.userIds.filter((id) => id !== user.id);
              if (newUserIds.length === 0) {
                reactions.splice(idx, 1);
              } else {
                reactions[idx] = { ...r, count: newUserIds.length, userIds: newUserIds };
              }
            } else {
              reactions[idx] = { ...r, count: r.count + 1, userIds: [...r.userIds, user.id] };
            }
          } else {
            reactions.push({ emoji, count: 1, userIds: [user.id] });
          }
          return { ...m, reactions };
        }),
      },
    }));

    // P2P: сохраняем реакции локально в peer store — иначе после перезахода
    // в чат loadMessages их не увидит.
    if (isPeerAvailable()) {
      const current = (get().messages[chatId] || []).find((m) => m.id === messageId);
      const reactions = current?.reactions || [];
      await peer.updateMessage(chatId, messageId, { reactions });
      await saveArchivedMessages(get().messages[chatId] || []);
      return;
    }

    // Сервер НЕ слушает socket-событие `message:reaction` — обработчик есть
    // только в REST (POST /api/messages/:chatId/reaction), который заодно
    // рассылает io-уведомление остальным участникам. Шлём всегда через HTTP,
    // чтобы реакция пережила reload и не затёрлась серверной копией.
    await messagesApi.addReaction(chatId, messageId, emoji)
      .then((res) => {
        const reactions = res.data?.reactions;
        if (!Array.isArray(reactions)) return;
        set((state) => ({
          messages: {
            ...state.messages,
            [chatId]: (state.messages[chatId] || []).map((m) =>
              m.id === messageId ? { ...m, reactions } : m
            ),
          },
        }));
      });
    await saveArchivedMessages(get().messages[chatId] || []);
    } catch (err) {
      if (original) {
        const current = (get().messages[chatId] || []).find(m => m.id === messageId);
        if (current) get().updateMessage({ ...current, reactions: original.reactions });
      }
      throw err;
    }
  },

  leaveChat: async (chatId) => {
    try {
      await chatsApi.leaveChat(chatId);
    } catch {}
    deleteArchivedChat(chatId).catch(() => {});
    set((state) => ({
      chats: state.chats.filter((c) => c.id !== chatId),
      activeChat: state.activeChat?.id === chatId ? null : state.activeChat,
    }));
  },

  replaceOrAddMessage: (message) => {
    saveArchivedMessages([message]).catch(() => {});
    set((state) => {
      const chatMsgs = state.messages[message.chatId] || [];
      const normalizedMessage = attachReplyPreview(message, state.messages);
      // Дедуп по реальному id (если сообщение уже добавлено REST-ответом,
      // сокет-эхо не должно создавать дубликат).
      const realIdx = chatMsgs.findIndex((m) => m.id === message.id);
      let tempIdx = -1;
      if (realIdx < 0) {
        for (let i = chatMsgs.length - 1; i >= 0; i--) {
          if (chatMsgs[i].id === (message as any).clientTempId && chatMsgs[i].senderId === ((message as any).authorId || message.senderId)) {
            tempIdx = i;
            break;
          }
        }
      }
      const updatedMsgs = realIdx >= 0
        ? chatMsgs.map((m, i) => (i === realIdx ? normalizedMessage : m))
        : tempIdx >= 0
        ? chatMsgs.map((m, i) => (i === tempIdx ? normalizedMessage : m))
        : [...chatMsgs, normalizedMessage];

      const isActive = state.activeChat?.id === message.chatId;
      const safeChats = state.chats.filter(c => c && c.id);

      // Убираем локальную заглушку: сервер подтвердил сообщение реальным id.
      const cleanMsgs = withoutTemporaryCopy(updatedMsgs, normalizedMessage, useAuthStore.getState().user?.id);

      return {
        messages: { ...state.messages, [message.chatId]: cleanMsgs },
        chats: safeChats.map((c) =>
          c.id === message.chatId && !(c.type === 'channel' && message.replyToId)
            ? {
                ...c,
                lastMessage: normalizedMessage,
                updatedAt: normalizedMessage.createdAt,
                unreadCount: isActive ? 0 : (c.unreadCount || 0) + 1,
              }
            : c
        ).sort((a, b) => {
          const ta = a?.lastMessage?.createdAt || a?.updatedAt || a?.createdAt || '';
          const tb = b?.lastMessage?.createdAt || b?.updatedAt || b?.createdAt || '';
          return new Date(tb).getTime() - new Date(ta).getTime();
        }),
      };
    });
  },

  addMessage: (message) => {
    set((state) => {
      const safeChats = state.chats.filter(c => c && c.id);
      const normalizedMessage = attachReplyPreview(message, state.messages);
      const myId = useAuthStore.getState().user?.id;
      const isActive = state.activeChat?.id === message.chatId;
      const isMine = message.senderId === myId;
      const existing = state.messages[message.chatId] || [];
      // Дедуп: если сообщение с таким id уже есть — просто обновляем на месте.
      const dupIdx = existing.findIndex((m) => m.id === message.id);
      const baseMsgs = dupIdx >= 0
        ? existing.map((m, i) => (i === dupIdx ? normalizedMessage : m))
        : [...existing, normalizedMessage];
      // Сокетное эхо своего сообщения (например, пост канала) должно убрать
      // локальную заглушку, иначе по ней нельзя будет править/закреплять.
      const nextMsgs = withoutTemporaryCopy(baseMsgs, normalizedMessage, myId);
      return {
        messages: {
          ...state.messages,
          [message.chatId]: nextMsgs,
        },
        chats: safeChats.map((c) =>
          c.id === message.chatId && !(c.type === 'channel' && message.replyToId)
            ? {
                ...c,
                lastMessage: normalizedMessage,
                updatedAt: normalizedMessage.createdAt,
                // Инкрементим счётчик только если сообщение чужое и чат не открыт.
                unreadCount: (!isActive && !isMine)
                  ? ((c.unreadCount || 0) + 1)
                  : (isActive ? 0 : (c.unreadCount || 0)),
              }
            : c
        ).sort((a, b) => {
          const ta = a?.lastMessage?.createdAt || a?.updatedAt || a?.createdAt || '';
          const tb = b?.lastMessage?.createdAt || b?.updatedAt || b?.createdAt || '';
          return new Date(tb).getTime() - new Date(ta).getTime();
        }),
      };
    });
  },

  updateMessage: (message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [message.chatId]: (state.messages[message.chatId] || []).map((m) =>
          m.id === message.id ? attachReplyPreview(message, state.messages) : m
        ),
      },
    }));
    saveArchivedMessages([message]).catch(() => {});
  },

  removeMessage: (messageId, chatId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).filter((m) => m.id !== messageId),
      },
    }));
  },

  applyPinnedMessage: (chatId, messageId, pinnedMessage, pinnedMessageIds, pinnedMessageList) => {
    const { setPinnedMessage } = useChatPrefsStore.getState();
    set((state) => {
      const msgs = state.messages[chatId] || [];
      // Если сервер прислал список — доверяем ему полностью (пустой список =
      // «сняли все закрепления»). Без списка работаем как раньше: один id.
      const ids = Array.isArray(pinnedMessageIds)
        ? pinnedMessageIds.filter(Boolean)
        : (messageId ? [messageId] : []);
      // Полные объекты: сначала из загруженных сообщений (там свежие правки),
      // затем из payload сервера, затем одиночное pinnedMessage.
      const list: Message[] = ids
        .map((pid) => msgs.find((m) => m.id === pid)
          || (Array.isArray(pinnedMessageList) ? pinnedMessageList.find((m) => m.id === pid) : undefined)
          || (pinnedMessage?.id === pid ? pinnedMessage : undefined))
        .filter(Boolean) as Message[];
      const firstId = ids[0] || null;
      const first = list[0] || null;
      setPinnedMessage(chatId, first || null);
      const patch = {
        pinnedMessageId: firstId || undefined,
        pinnedMessageIds: ids,
        pinnedMessage: first || undefined,
        pinnedMessages: list,
      };
      return {
        activeChat: state.activeChat?.id === chatId
          ? { ...state.activeChat, ...patch }
          : state.activeChat,
        chats: state.chats.map((c) => (c.id === chatId ? { ...c, ...patch } : c)),
        messages: {
          ...state.messages,
          [chatId]: msgs.map((m) => ({ ...m, isPinned: ids.includes(m.id) })),
        },
      };
    });
    saveArchivedChats(get().chats.filter(c => c.id === chatId)).catch(() => {});
    saveArchivedMessages(get().messages[chatId] || []).catch(() => {});
  },

  setTyping: (chatId, userId, isTyping) => {
    set((state) => {
      const current = state.typingUsers[chatId] || [];
      const updated = isTyping
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId);
      return { typingUsers: { ...state.typingUsers, [chatId]: updated } };
    });
  },

  markRead: (chatId, messageId) => {
    // P2P-режим: просто обнуляем счетчик локально, нет HTTP API
    if (isPeerAvailable()) {
      get().markChatRead(chatId);
      return;
    }
    try {
      messagesApi.markRead(messageId, chatId);
      const socket = getSocket();
      socket?.emit('message:read', { chatId, messageId });
    } catch {}
    get().markChatRead(chatId);
  },

  markChatRead: (chatId) => {
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, unreadCount: 0 } : c
      ),
    }));
  },

  updateChatList: (chat) => {
    if (!chat || !chat.id) return;
    const normalized = { ...chat, type: chat.type === 'direct' ? 'private' : chat.type } as Chat;
    set((state) => ({
      activeChat: state.activeChat?.id === normalized.id
        ? { ...state.activeChat, ...normalized, unreadCount: 0 }
        : state.activeChat,
      chats: state.chats.some((c) => c?.id === normalized.id)
        ? state.chats.map((c) => {
            if (c?.id !== normalized.id) return c;
            const isActive = state.activeChat?.id === normalized.id;
            return {
              ...normalized,
              unreadCount: isActive ? 0 : (normalized.unreadCount ?? c.unreadCount ?? 0),
            };
          }).filter(Boolean) as Chat[]
        : [{ ...normalized, unreadCount: state.activeChat?.id === normalized.id ? 0 : (normalized.unreadCount ?? 0) }, ...state.chats].filter(Boolean) as Chat[],
    }));
  },

  markMessageRead: (chatId, messageId, userId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map((m) => {
          if (m.id !== messageId) return m;
          const readBy = m.readBy ? [...m.readBy] : [];
          if (!readBy.includes(userId)) readBy.push(userId);
          return { ...m, readBy };
        }),
      },
    }));
  },
}));

registerAccountStore('chats', useChatStore);

/* ---------- Автоматический синк в IndexedDB-архив ---------- */
// При любых изменениях messages/chats пишем всё, что добавилось или изменилось,
// в локальный архив. Это гарантирует что даже если сервер (Render Free /tmp)
// потеряет данные — у пользователя в браузере/десктопе история сохранится.
{
  let prevMessages: Record<string, Message[]> = {};
  let prevChats: Chat[] = [];
  useChatStore.subscribe((state) => {
    const nextMessages = state.messages;
    for (const chatId of Object.keys(nextMessages)) {
      const before = prevMessages[chatId] || [];
      const after = nextMessages[chatId] || [];
      if (before === after) continue;
      const beforeMap = new Map(before.map((m) => [m.id, m]));
      const changed: Message[] = [];
      for (const m of after) {
        const b = beforeMap.get(m.id);
        if (!b || b !== m) changed.push(m);
      }
      if (changed.length) saveArchivedMessages(changed).catch(() => {});
      const afterIds = new Set(after.map((m) => m.id));
      for (const m of before) {
        if (!afterIds.has(m.id)) deleteArchivedMessage(m.id).catch(() => {});
      }
    }
    prevMessages = nextMessages;

    if (state.chats !== prevChats) {
      saveArchivedChats(state.chats).catch(() => {});
      prevChats = state.chats;
    }
  });
}

