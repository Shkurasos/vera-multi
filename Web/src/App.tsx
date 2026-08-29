import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from './store/authStore';
import { useChatStore } from './store/chatStore';
import { useChatPrefsStore } from './store/chatPrefsStore';
import { useChatSoundStore } from './store/chatSoundStore';
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
import CallOverlay from './components/CallOverlay';
import CallMiniBar from './components/CallMiniBar';
import CallRingModal from './components/CallRingModal';
import CallAudioSink from './components/CallAudioSink';
import { bindSocketHandlers as bindCallHandlers } from './services/callPeers';
import { peer, isPeerAvailable } from './services/peer';
import { useUserSettingsStore } from './store/userSettingsStore';
import { useShopStore } from './store/shopStore';
import Store, { StoreOpen } from './components/Store';
import AppLockGate from './components/AppLockGate';

// Звук уведомления
let audioCtx: AudioContext | null = null;
function playDefaultBeep(volume: number = 1) {
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
    gainNode.gain.setValueAtTime(0.3 * volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {}
}
function playNotificationSound(chatId?: string) {
  try {
    if (chatId) {
      const store = useChatSoundStore.getState();
      const volume = store.getVolume(chatId);
      if (volume <= 0) return; // громкость 0 = глушим полностью
      const custom = store.sounds[chatId];
      if (custom?.url) {
        const a = new Audio(custom.url);
        a.volume = volume;
        a.play().catch(() => playDefaultBeep(volume));
        return;
      }
      playDefaultBeep(volume);
      return;
    }
  } catch {}
  playDefaultBeep();
}

interface IncomingCallState {
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  offer: RTCSessionDescriptionInit;
  type: 'audio' | 'video';
}
// (legacy; больше не используется в UI, но тип оставлен на всякий случай для типизации старых событий)
void ({} as IncomingCallState);

export default function App() {
  const { checkAuth, isAuthenticated, isLoading, user, isPeerMode } = useAuthStore();
  const {
    addMessage, replaceOrAddMessage, updateMessage, removeMessage,
    applyPinnedMessage, setTyping, updateChatList, setUserOnline, setUserOffline, clearOnlineUsers, markMessageRead,
  } = useChatStore();
  const listenersAttached = useRef(false);

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
      playNotificationSound(uiMsg.chatId);
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
          const { isMuted } = useChatPrefsStore.getState();
          const chatMuted = isMuted(message.chatId);
          if (!chatMuted) playNotificationSound(message.chatId);

          // Push-уведомление если чат не в фокусе и не замьючен
          if (!chatMuted) {
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

      // Баланс ВП / купленные товары изменились на сервере (покупка, пополнение,
      // или действие с другого устройства) — синхронизируем магазин.
      socket.on('wallet:updated', ({ balance }: { balance: number }) => {
        useShopStore.getState().setBalance(balance);
      });

      socket.on('shop:owned', ({ ownedItems }: { ownedItems: string[] }) => {
        useShopStore.getState().mergeOwned(ownedItems || []);
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

      // Входящий звонок (legacy 1:1 protocol — новые звонки идут через callroom:*)
      // Оставлен только как no-op для старых клиентов; UI показывает CallRingModal.

      // Discord-style: биндим обработчики callroom:* один раз.
      bindCallHandlers();
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

  // Применяем глобальные настройки внешнего вида: яркость и масштаб текста.
  const brightness = useUserSettingsStore((s) => s.brightness);
  const textScale = useUserSettingsStore((s) => s.textScale);
  useEffect(() => {
    document.body.style.filter = brightness === 1 ? '' : `brightness(${brightness})`;
    document.documentElement.style.setProperty('--vera-text-scale', String(textScale));
    document.documentElement.style.fontSize = `${16 * textScale}px`;
  }, [brightness, textScale]);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh"
        sx={{ bgcolor: '#1a1a2e' }}>
        <CircularProgress sx={{ color: '#7C6AF7' }} />
      </Box>
    );
  }

  return (
    <AppLockGate>
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

      {/* Магазин — плашка-оверлей, открывается на любом экране */}
      {isAuthenticated && (
        <StoreOpen />
      )}

      {/* Мобильная нижняя навигация — глобально на всех авторизованных экранах */}
      {isAuthenticated && <MobileBottomNav />}

      {/* Discord-style звонки */}
      {isAuthenticated && (
        <>
          <CallRingModal />
          <CallOverlay />
          <CallMiniBar />
          <CallAudioSink />
        </>
      )}
    </AppLockGate>
  );
}
