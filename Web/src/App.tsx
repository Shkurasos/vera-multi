import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from './store/authStore';
import { useChatStore } from './store/chatStore';
import { useChatPrefsStore } from './store/chatPrefsStore';
import { getSocket } from './services/socket';
import { requestNotificationPermission, showMessageNotification } from './services/notifications';
import MainLayout from './pages/MainLayout';
import ProfilePage from './pages/ProfilePage';
import DevicesPage from './pages/DevicesPage';
import AcceptLinkPage from './pages/AcceptLinkPage';
import DownloadPage from './pages/DownloadPage';
import ContactsPage from './pages/ContactsPage';
import CallLogPage from './pages/CallLogPage';
import BotFatherPage from './pages/BotFatherPage';
import AdminToolsPage from './pages/AdminToolsPage';
import MusicPlayer from './components/MusicPlayer';
import MobileBottomNav from './components/MobileBottomNav';
import { IncomingCallModal } from './components/CallModal';
import { peer, isPeerAvailable } from './services/peer';

// Звук уведомления
let audioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {}
}

interface IncomingCallState {
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  offer: RTCSessionDescriptionInit;
  type: 'audio' | 'video';
}

export default function App() {
  const { checkAuth, isAuthenticated, isLoading, user, isPeerMode } = useAuthStore();
  const {
    addMessage, replaceOrAddMessage, updateMessage, removeMessage,
    applyPinnedMessage, setTyping, updateChatList, setUserOnline, setUserOffline, clearOnlineUsers, markMessageRead,
  } = useChatStore();
  const listenersAttached = useRef(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);

  useEffect(() => {
    // На публичной странице /link авто-логин запрещён: устройство ещё не
    // привязано к аккаунту-владельцу QR, и создание своего аккаунта помешает
    // последующему POST /devices/link/accept. checkAuth вызовется после accept.
    if (window.location.pathname.startsWith('/link') || window.location.pathname.startsWith('/download')) {
      useAuthStore.setState({ isLoading: false });
    } else {
      checkAuth();
    }
    requestNotificationPermission();
  }, []);

  /*
   * P2P-режим: подписываемся на события локального узла (window.vera.on).
   * Здесь ловим входящие сообщения — маппим к UI-модели через chatStore.addMessage.
   * Компонент событий такой же, как из peer/node.js: { chatId, from, fromName, text, ts, id }.
   */
  useEffect(() => {
    if (!isPeerMode || !isAuthenticated) return;
    const w: any = (window as any).vera;
    if (!w) return;
    const offMsg = w.on('message', (m: any) => {
      console.log('🔔 [App] message event:', m);
      const uiMsg: any = {
        id: m.id || ('remote-' + Date.now()),
        chatId: m.chatId || m.from,
        senderId: m.from,
        sender: { id: m.from, username: m.fromName || 'peer', firstName: m.fromName || 'peer', isOnline: true, createdAt: '', lastName: '' },
        type: 'text',
        content: m.text,
        isEdited: false, isPinned: false, isDeleted: false,
        createdAt: new Date(m.ts || Date.now()).toISOString(),
        updatedAt: new Date(m.ts || Date.now()).toISOString(),
      };
      addMessage(uiMsg);
      // Обновляем список чатов — вдруг это первое сообщение от нового контакта
      // и чата ещё нет в сайдбаре.
      try { useChatStore.getState().loadChats(); } catch {}
      playNotificationSound();
    });
    const offSent = w.on('message-sent', () => { /* можно обновлять статус галочек */ });
    const offPres = w.on('presence',    (p: any) => { p?.online ? setUserOnline(p.peer) : setUserOffline(p.peer); });
    const offLog = w.on('log', (log: any) => { console.log('📋 [App] log event:', log); });
    const offReady = w.on('ready', (info: any) => { console.log('✅ [App] ready event:', info); });
    return () => { try { offMsg(); offSent(); offPres(); offLog(); offReady(); } catch {} };
  }, [isPeerMode, isAuthenticated]);

  /*
   * Deep-link vera:// (Electron main → renderer). Понимаем:
   *   vera://add?pk=<pubkey>&name=...      — добавить контакт и открыть чат
   *   vera://join?gid=<id>&pk=<owner>&t=.. — вступить в группу
   * HashRouter, поэтому навигируем через window.location.hash.
   */
  useEffect(() => {
    if (!isAuthenticated || !isPeerAvailable()) return;
    const w: any = (window as any).vera;
    if (!w || typeof w.onDeepLink !== 'function') return;
    const off = w.onDeepLink(async (url: string) => {
      try {
        const m = String(url || '').match(/^vera:\/\/([a-z-]+)\?(.+)$/i);
        if (!m) return;
        const action = m[1].toLowerCase();
        const params = new URLSearchParams(m[2]);
        if (action === 'add') {
          const pk = (params.get('pk') || '').trim();
          if (!pk) return;
          const info = await peer.info();
          if (info.nostrPk && pk === info.nostrPk) return;
          await peer.addContact({ pubkey: pk, nodeId: pk, name: params.get('name') || undefined });
          await useChatStore.getState().loadChats();
          const myPk = info.nostrPk;
          const chatId = myPk ? [myPk, pk].sort().join('|') : pk;
          window.location.hash = '#/chat/' + chatId;
        } else if (action === 'join') {
          const gid = (params.get('gid') || '').trim();
          const ownerPk = (params.get('pk') || '').trim();
          const title = params.get('t') || params.get('name') || undefined;
          if (!gid || !ownerPk) return;
          try {
            await peer.joinGroup({ gid, ownerPk, title });
          } catch (e) {
            console.error('[deeplink] joinGroup failed', e);
          }
          await useChatStore.getState().loadChats();
          // Убеждаемся, что чат появился локально. joinGroup создаёт его
          // синхронно в peer-хранилище, так что после loadChats он должен
          // быть в списке. Если нет — не переходим в него, оставляем
          // пользователя на текущем экране, чтобы не показывать вечный спиннер.
          const exists = useChatStore.getState().chats.some((c) => c && c.id === gid);
          if (exists) {
            window.location.hash = '#/chat/' + gid;
          } else {
            console.warn('[deeplink] group chat not found after joinGroup', gid);
          }
        }
      } catch (e) { console.error('[deeplink]', e); }
    });
    return () => { try { off && off(); } catch {} };
  }, [isAuthenticated]);

  // Подключаем WebSocket слушатели — строго один раз.
  // В P2P-режиме сокет не используется: события приходят через window.vera.on(...)
  // (подписки оформлены в отдельных сторах). Здесь мы просто пропускаем весь блок.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (isPeerMode) return;

    const attach = () => {
      const socket = getSocket();
      if (!socket || listenersAttached.current) return;

      listenersAttached.current = true;

      socket.on('message:new', (message: any) => {
        if (message.senderId === user?.id) {
          replaceOrAddMessage(message);
        } else {
          addMessage(message);
          playNotificationSound();

          // Push-уведомление если чат не в фокусе и не замьючен
          const { isMuted } = useChatPrefsStore.getState();
          if (!isMuted(message.chatId)) {
            const { chats } = useChatStore.getState();
            const chat = chats.find(c => c.id === message.chatId);
            const senderName = message.sender
              ? [message.sender.firstName, message.sender.lastName].filter(Boolean).join(' ') || message.sender.username || 'Сообщение'
              : 'Новое сообщение';
            const chatName = chat?.name || senderName;
            showMessageNotification({
              title: chatName,
              body: message.content || '📎 Вложение',
              chatId: message.chatId,
              icon: chat?.avatarUrl || message.sender?.avatarUrl,
              onClick: () => {
                window.location.hash = '';
                window.location.hash = `#/chat/${message.chatId}`;
              },
            });
          }
        }
      });

      socket.on('message:edited', updateMessage);

      socket.on('message:deleted', ({ id, chatId }: { id: string; chatId: string }) => {
        removeMessage(id, chatId);
      });

      socket.on('message:pinned', ({ chatId, messageId, pinnedMessage }: { chatId: string; messageId: string | null; pinnedMessage?: any }) => {
        applyPinnedMessage(chatId, messageId, pinnedMessage);
      });

      // Обновление реакций от сервера
      socket.on('message:reaction', ({ messageId, chatId, reactions }: { messageId: string; chatId: string; reactions: any[] }) => {
        const { messages } = useChatStore.getState();
        const msgs = messages[chatId] || [];
        const updated = msgs.map((m) => m.id === messageId ? { ...m, reactions } : m);
        useChatStore.setState((state) => ({
          messages: { ...state.messages, [chatId]: updated },
        }));
      });

      // Чат удалён — убираем из списка
      socket.on('chat:deleted', ({ chatId }: { chatId: string }) => {
        useChatStore.setState((state) => ({
          chats: state.chats.filter((c) => c.id !== chatId),
          activeChat: state.activeChat?.id === chatId ? null : state.activeChat,
        }));
      });

      // Участник покинул чат
      socket.on('chat:member_left', ({ chatId, userId: leftUserId }: { chatId: string; userId: string }) => {
        useChatStore.setState((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? { ...c, members: c.members.filter((m) => m.userId !== leftUserId) }
              : c
          ),
        }));
      });

      socket.on('typing:start', ({ userId, chatId }: { userId: string; chatId: string }) => {
        if (userId !== user?.id) setTyping(chatId, userId, true);
      });

      socket.on('typing:stop', ({ userId, chatId }: { userId: string; chatId: string }) => {
        setTyping(chatId, userId, false);
      });

      socket.on('chat:updated', (chat: any) => {
        updateChatList(chat);
      });

      socket.on('user:online', ({ userId }: { userId: string }) => {
        setUserOnline(userId);
      });

      socket.on('user:offline', ({ userId }: { userId: string }) => {
        setUserOffline(userId);
      });

      socket.on('disconnect', () => {
        clearOnlineUsers();
      });

      socket.on('connect_error', () => {
        clearOnlineUsers();
      });

      // Когда партнёр прочитал наше сообщение — обновляем readBy
      socket.on('message:read', ({ chatId, messageId, userId }: { chatId: string; messageId: string; userId: string }) => {
        markMessageRead(chatId, messageId, userId);
      });

      // Входящий звонок
      socket.on('call:incoming', (data: IncomingCallState) => {
        setIncomingCall(data);
      });
    };

    // Пробуем сразу, потом через интервал если сокет ещё не подключён
    const interval = setInterval(() => {
      const socket = getSocket();
      if (socket && !listenersAttached.current) {
        attach();
        clearInterval(interval);
      }
    }, 300);

    attach();

    return () => {
      clearInterval(interval);
    };
  }, [isAuthenticated, isPeerMode, user?.id]);

  // Сброс флага при логауте
  useEffect(() => {
    if (!isAuthenticated) {
      listenersAttached.current = false;
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh"
        sx={{ bgcolor: '#1a1a2e' }}>
        <CircularProgress sx={{ color: '#7C6AF7' }} />
      </Box>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/link" element={<AcceptLinkPage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/profile" element={isAuthenticated ? <ProfilePage /> : <Navigate to="/" />} />
        <Route path="/devices" element={isAuthenticated ? <DevicesPage /> : <Navigate to="/" />} />
        <Route path="/contacts" element={isAuthenticated ? <ContactsPage /> : <Navigate to="/" />} />
        <Route path="/calls" element={isAuthenticated ? <CallLogPage /> : <Navigate to="/" />} />
        <Route path="/*" element={isAuthenticated ? <MainLayout /> : (
          <Box display="flex" justifyContent="center" alignItems="center" height="100vh" sx={{ bgcolor: '#1a1a2e' }}>
            <CircularProgress sx={{ color: '#7C6AF7' }} />
          </Box>
        )} />
      </Routes>

      {/* Плеер рендерится глобально над всеми маршрутами — не размонтируется при навигации */}
      {isAuthenticated && <MusicPlayer />}

      {/* Мобильная нижняя навигация — глобально на всех авторизованных экранах */}
      {isAuthenticated && <MobileBottomNav />}

      {/* Глобальный модал входящего звонка */}
      {incomingCall && (
        <IncomingCallModal
          data={incomingCall}
          onClose={() => setIncomingCall(null)}
        />
      )}
    </>
  );
}
