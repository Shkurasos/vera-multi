/* ─── Офлайн-вход по паролю ─────────────────────────────────────────────────
 * Без сервера пароль не проверить, поэтому при входе по паролю (и при его
 * смене) кладём в localStorage PBKDF2-хэш с солью — только для последнего
 * пользователя этого устройства. Без сети приложение спрашивает один пароль
 * и открывает сохранённые чаты и музыку.
 *
 * Это замок интерфейса, а не шифрование: архив чатов в IndexedDB лежит как
 * есть. Сам пароль не хранится.
 */
import type { User } from '../types';

const KEY = 'vera_offline_auth';
const ITERATIONS = 210_000;

interface StoredCredential {
  v: 1;
  userId: string;
  username: string;
  salt: string;
  hash: string;
  iterations: number;
  user: User;
}

export interface OfflineLockInfo {
  userId: string;
  username: string;
  displayName: string;
  /** false — на этом устройстве ещё не входили по паролю, офлайн-вход недоступен. */
  hasCredential: boolean;
}

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

function subtle(): SubtleCrypto | null {
  return (typeof crypto !== 'undefined' && crypto.subtle) || null;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const s = subtle();
  if (!s) throw new Error('WebCrypto недоступен');
  const key = await s.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

function readCredential(): StoredCredential | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c?.v !== 1 || typeof c.userId !== 'string' || typeof c.salt !== 'string'
      || typeof c.hash !== 'string' || !(c.iterations > 0) || !c.user) return null;
    return c as StoredCredential;
  } catch {
    return null;
  }
}

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem('vera_user');
    const user = raw ? JSON.parse(raw) : null;
    return user && typeof user.id === 'string' ? user : null;
  } catch {
    return null;
  }
}

/** Запомнить пароль пользователя для входа без сети (заменяет прежнего). */
export async function saveOfflineCredential(user: User | null | undefined, password: string): Promise<void> {
  if (!user?.id || !password || !subtle()) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  const stored: StoredCredential = {
    v: 1, userId: user.id, username: user.username,
    salt: toB64(salt), hash: toB64(hash), iterations: ITERATIONS, user,
  };
  localStorage.setItem(KEY, JSON.stringify(stored));
}

/** Пароль совпал — пользователь (свежий профиль, если он есть); иначе null. */
export async function verifyOfflinePassword(password: string): Promise<User | null> {
  const c = readCredential();
  if (!c || !password || !subtle()) return null;
  let actual: Uint8Array;
  try {
    actual = await derive(password, fromB64(c.salt), c.iterations);
  } catch {
    return null;
  }
  const expected = fromB64(c.hash);
  if (actual.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  if (diff !== 0) return null;
  const cached = readCachedUser();
  return cached?.id === c.userId ? cached : c.user;
}

/**
 * Вошёл другой аккаунт — старый пароль больше не должен открывать устройство.
 * Тот же аккаунт — обновляем снимок профиля (имя, аватар).
 */
export function syncOfflineCredentialUser(user: User): void {
  const c = readCredential();
  if (!c) return;
  if (c.userId !== user.id) {
    clearOfflineCredential();
    return;
  }
  try { localStorage.setItem(KEY, JSON.stringify({ ...c, username: user.username, user })); } catch { /* квота */ }
}

export function clearOfflineCredential(): void {
  try { localStorage.removeItem(KEY); } catch { /* недоступно */ }
}

/** Кого показывать на экране офлайн-входа; null — на устройстве никто не входил. */
export function offlineLockInfo(): OfflineLockInfo | null {
  const c = readCredential();
  const cached = readCachedUser();
  const user = c ? (cached?.id === c.userId ? cached : c.user) : cached;
  if (!user?.id) return null;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Vera';
  return { userId: user.id, username: user.username || '', displayName, hasCredential: !!c };
}
