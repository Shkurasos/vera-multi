/* ─── Защищённое хранилище секретов (только десктоп) ────────────────────────
 * В приложении (Electron) токен авторизации и снимок профиля шифруются через
 * safeStorage ОС (на Windows — DPAPI) и хранятся в secure-store.json, а не в
 * localStorage открытым текстом. В вебе функций нет: это намеренно только для
 * приложения, поэтому все вызовы тут — безопасные no-op в браузере.
 */

interface DesktopSecure {
  available: () => Promise<boolean>;
  set: (key: string, value: string) => Promise<boolean>;
  get: (key: string) => Promise<string | null>;
  delete: (key?: string | null) => Promise<boolean>;
}

function bridge(): DesktopSecure | null {
  const d = (window as unknown as { veraDesktop?: { secure?: DesktopSecure } }).veraDesktop;
  return d?.secure || null;
}

/** true — это десктоп-приложение с доступным шифрованием секретов. */
export function isDesktop(): boolean {
  return !!(window as unknown as { veraDesktop?: unknown }).veraDesktop;
}

/** Доступно ли шифрование ОС (только тогда есть смысл в авто-входе без сети). */
export async function secureAvailable(): Promise<boolean> {
  const b = bridge();
  if (!b) return false;
  try { return await b.available(); } catch { return false; }
}

export async function secureSet(key: string, value: string): Promise<boolean> {
  const b = bridge();
  if (!b) return false;
  try { return await b.set(key, value); } catch { return false; }
}

export async function secureGet(key: string): Promise<string | null> {
  const b = bridge();
  if (!b) return null;
  try { return await b.get(key); } catch { return null; }
}

/** Удалить один секрет или (без ключа) весь secure-store — при выходе. */
export async function secureDelete(key?: string | null): Promise<boolean> {
  const b = bridge();
  if (!b) return false;
  try { return await b.delete(key ?? null); } catch { return false; }
}

/* Ключи секретов. */
export const SECURE_TOKEN_KEY = 'vera_token';
export const SECURE_USER_KEY = 'vera_user';

/** Сохранить токен и снимок профиля в защищённое хранилище (только десктоп). */
export async function saveSecureSession(token: string | null, user: unknown): Promise<void> {
  if (!token || !isDesktop()) return;
  await secureSet(SECURE_TOKEN_KEY, token);
  if (user) { try { await secureSet(SECURE_USER_KEY, JSON.stringify(user)); } catch { /* snapshot */ } }
}

/** Прочитать сохранённую сессию из защищённого хранилища (десктоп, офлайн-старт). */
export async function loadSecureSession(): Promise<{ token: string; user: unknown | null } | null> {
  if (!isDesktop()) return null;
  const token = await secureGet(SECURE_TOKEN_KEY);
  if (!token) return null;
  let user: unknown | null = null;
  try {
    const raw = await secureGet(SECURE_USER_KEY);
    user = raw ? JSON.parse(raw) : null;
  } catch { user = null; }
  return { token, user };
}

/** Забыть сохранённую сессию (выход из аккаунта). */
export async function clearSecureSession(): Promise<void> {
  if (!isDesktop()) return;
  await secureDelete(SECURE_TOKEN_KEY);
  await secureDelete(SECURE_USER_KEY);
}
