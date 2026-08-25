import { create } from 'zustand';
import { Chat, Message } from '../types';
import { chatsApi, messagesApi } from '../services/api';
import { getSocket } from '../services/socket';
import { peer, isPeerAvailable, PeerChat, PeerMessage } from '../services/peer';
import { useAuthStore } from './authStore';
import { useChatPrefsStore } from './chatPrefsStore';
import {
  loadArchivedChats, saveArchivedChats, deleteArchivedChat,
  loadArchivedMessages, saveArchivedMessages, deleteArchivedMessage,
  mergeById,
} from '../services/localArchive';

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
    attachments: att ? [att] : undefined,
    reactions: (m as any).reactions || undefined,
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
  sendMessageWithFile: (chatId: string, attachment: any, replyToId?: string, type?: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, chatId: string) => Promise<void>;
  pinMessage: (chatId: string, messageId: string | null) => void;
  addReaction: (chatId: string, messageId: string, emoji: string) => void;
  leaveChat: (chatId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  replaceOrAddMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (messageId: string, chatId: string) => void;
  applyPinnedMessage: (chatId: string, messageId: string | null, pinnedMessage?: Message | null) => void;
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
  markRead: (chatId: string, messageId: string) => void;
  markChatRead: (chatId: string) => void;
  updateChatList: (chat: Chat) => void;
  setUserOnline: (userId: string) => void;
  setUserOffline: (userId: string) => void;
  clearOnlineUsers: () => void;
  markMessageRead: (chatId: string, messageId: string, userId: string) => void;
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
        set({ chats });
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
      set({ chats: merged });
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
    // Показываем архивную историю мгновенно (только для первой загрузки чата).
    if (!before) {
      try {
        const archived = await loadArchivedMessages(chatId);
        if (archived.length > 0 && (!get().messages[chatId] || get().messages[chatId].length === 0)) {
          set((state) => ({ messages: { ...state.messages, [chatId]: archived } }));
        }
      } catch {}
    }

    // P2P-режим: сообщения хранятся локально в peer/src/store.
    if (isPeerAvailable()) {
      set({ loadingMessages: true });
      try {
        const raw = await peer.listMessages(chatId);
        const msgs = raw.map(peerMsgToMsg).filter((m) => !m.isDeleted);
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
        merged = [...incoming, ...(get().messages[chatId] || [])];
      } else {
        const archived = await loadArchivedMessages(chatId).catch(() => [] as Message[]);
        merged = mergeById(archived, incoming);
      }
      set((state) => ({
        messages: { ...state.messages, [chatId]: merged },
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
    const tempMsg: Message = {
      id: 'temp-' + Date.now(),
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
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('message:send', { chatId, text: content, replyToId });
      } else {
        const res = await messagesApi.send(chatId, { text: content, replyToId });
        set((state) => ({
          messages: {
            ...state.messages,
            [chatId]: (state.messages[chatId] || []).map((m) =>
              m.id === tempMsg.id ? attachReplyPreview(res.data, state.messages) : m
            ),
          },
        }));
      }
    } catch (err) {
      console.error('sendMessage error:', err);
      get().removeMessage(tempMsg.id, chatId);
    }
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
    }

  },

  editMessage: async (messageId, content) => {
    try {
      let chatId = get().activeChat?.id;
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
        try {
          await peer.updateMessage(chatId, messageId, { text: content, edited: true });
        } catch (e) { console.error('[peer] editMessage:', e); }
        return;
      }

      const socket = getSocket();
      if (socket?.connected) {
        try {
          const message = await new Promise<Message>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('edit ack timeout')), 3000);
            socket.emit('message:edit', { messageId, content }, (savedMessage?: Message) => {
              window.clearTimeout(timer);
              if (savedMessage?.id) resolve(savedMessage);
              else reject(new Error('edit was not confirmed by server'));
            });
          });
          get().updateMessage(message);
          return;
        } catch (socketErr) {
          console.warn('message:edit socket confirm failed, saving through REST:', socketErr);
        }
      }

      const res = await messagesApi.edit(messageId, content);
      get().updateMessage(res.data);
    } catch (err) {
      console.error('editMessage error:', err);
    }
  },

  deleteMessage: async (messageId, chatId) => {
    try {
      if (isPeerAvailable()) {
        // P2P: физически удаляем через peer.updateMessage → пометим deleted=true,
        // и убираем из UI. Полное удаление можно добавить позже отдельным API.
        try { await peer.updateMessage(chatId, messageId, { deleted: true, text: '' }); } catch {}
        get().removeMessage(messageId, chatId);
        return;
      }
      await messagesApi.delete(messageId);
      get().removeMessage(messageId, chatId);
    } catch (err) {
      console.error('deleteMessage error:', err);
    }
  },

  pinMessage: (chatId, messageId) => {
    get().applyPinnedMessage(chatId, messageId);

    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('message:pin', { chatId, messageId });
      return;
    }

    messagesApi.pin(messageId, chatId)
      .then((res) => get().applyPinnedMessage(chatId, messageId, res.data))
      .catch((err) => console.error('pinMessage error:', err));
  },

  addReaction: (chatId, messageId, emoji) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

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

    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('message:reaction', { chatId, messageId, emoji });
      return;
    }

    // P2P: сохраняем реакции локально в peer store — иначе после перезахода
    // в чат loadMessages их не увидит.
    if (isPeerAvailable()) {
      const current = (get().messages[chatId] || []).find((m) => m.id === messageId);
      const reactions = current?.reactions || [];
      peer.updateMessage(chatId, messageId, { reactions })
        .catch((err) => console.error('[peer] updateMessage reaction error:', err));
      return;
    }

    messagesApi.addReaction(chatId, messageId, emoji)
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
      })
      .catch((err) => {
        console.error('addReaction error:', err);
      });
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
    set((state) => {
      const chatMsgs = state.messages[message.chatId] || [];
      const normalizedMessage = attachReplyPreview(message, state.messages);
      let tempIdx = -1;
      for (let i = chatMsgs.length - 1; i >= 0; i--) {
        if (chatMsgs[i].id.startsWith('temp-') && chatMsgs[i].senderId === message.senderId) {
          tempIdx = i;
          break;
        }
      }
      const updatedMsgs = tempIdx >= 0
        ? chatMsgs.map((m, i) => (i === tempIdx ? normalizedMessage : m))
        : [...chatMsgs, normalizedMessage];

      const isActive = state.activeChat?.id === message.chatId;
      const safeChats = state.chats.filter(c => c && c.id);

      return {
        messages: { ...state.messages, [message.chatId]: updatedMsgs },
        chats: safeChats.map((c) =>
          c.id === message.chatId
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
      return {
        messages: {
          ...state.messages,
          [message.chatId]: [...(state.messages[message.chatId] || []), normalizedMessage],
        },
        chats: safeChats.map((c) =>
          c.id === message.chatId
            ? { ...c, lastMessage: normalizedMessage, updatedAt: normalizedMessage.createdAt }
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
  },

  removeMessage: (messageId, chatId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).filter((m) => m.id !== messageId),
      },
    }));
  },

  applyPinnedMessage: (chatId, messageId, pinnedMessage) => {
    const { setPinnedMessage } = useChatPrefsStore.getState();
    set((state) => {
      const msgs = state.messages[chatId] || [];
      const pinned = pinnedMessage !== undefined
        ? pinnedMessage
        : messageId
          ? msgs.find((m) => m.id === messageId) || null
          : null;
      setPinnedMessage(chatId, pinned || null);
      return {
        chats: state.chats.map((c) =>
          c.id === chatId
            ? { ...c, pinnedMessageId: messageId || undefined, pinnedMessage: pinned || undefined }
            : c
        ),
        messages: {
          ...state.messages,
          [chatId]: msgs.map((m) =>
            messageId
              ? { ...m, isPinned: m.id === messageId }
              : { ...m, isPinned: false }
          ),
        },
      };
    });
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

