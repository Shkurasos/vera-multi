/**
 * Push-уведомления через Web Notifications API.
 * На ПК: нативное уведомление (появляется снизу справа / снизу слева в зависимости от ОС).
 * На мобильном: стандартное уведомление браузера.
 */

let permissionGranted = false;

/** Запрашиваем разрешение при входе пользователя */
export async function requestNotificationPermission(): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    permissionGranted = true;
    return;
  }
  if (Notification.permission !== 'denied') {
    const result = await Notification.requestPermission();
    permissionGranted = result === 'granted';
  }
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  chatId?: string;
  onClick?: () => void;
}

/** Показывает уведомление если вкладка не в фокусе и чат не открыт */
export function showMessageNotification(payload: NotificationPayload): void {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  // Не показываем если документ в фокусе
  if (!document.hidden && document.hasFocus()) return;

  const n = new Notification(payload.title, {
    body: payload.body,
    icon: payload.icon || '/vera-icon.png',
    tag: payload.chatId ? `chat-${payload.chatId}` : undefined,
    silent: false,
  } as NotificationOptions);

  n.onclick = () => {
    window.focus();
    payload.onClick?.();
    n.close();
  };

  // Авто-закрытие через 5 сек
  setTimeout(() => n.close(), 5000);
}
