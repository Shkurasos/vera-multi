/**
 * Свои паки иконок — одинаковые на всех устройствах аккаунта.
 *
 * Паки с картинками весят до 4 МБ, поэтому в общий синк сторов (лимит 128 КБ)
 * они не помещаются. У них свой канал (Server/community-icon-packs.js →
 * /api/icon-packs/mine): сервер хранит каждый пак отдельным файлом и отдаёт
 * список «id + время изменения». Устройство сверяет список со своими паками
 * и докачивает или выгружает только то, что изменилось.
 *
 * Какой пак включён, хранит uiPrefsStore.customPack — своё у каждого
 * устройства, не синкается. Здесь — только содержимое паков. Если пак удалили
 * на другом устройстве, а здесь он был включён, выбор снимается.
 *
 * Удаление отправляется только для пака, который пользователь удалил сам
 * (deletePack). Пак, которого просто нет на устройстве, на сервере не трогаем:
 * иначе новое устройство с пустым IndexedDB стёрло бы паки всего аккаунта.
 */
import { useIconPackStore } from '../store/iconPackStore';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import type { CustomIconPack } from '../utils/iconPackFormat';
import { getSyncClientId } from './storeSyncSimple';

interface RemoteMeta { id: string; name: string; updatedAt: number }

const UPLOAD_DEBOUNCE = 1500;

let accountId: string | null = null;
let generation = 0;
let unsubscribe: (() => void) | null = null;
let socketBound: { off?: (e: string, h: (p: any) => void) => void } | null = null;
let socketHandler: ((payload: any) => void) | null = null;
/** id → updatedAt, уже совпадающие с сервером. */
let known = new Map<string, number>();
let applyingRemote = false;
let uploadTimer: ReturnType<typeof setTimeout> | null = null;
const pendingUpload = new Set<string>();
const pendingDelete = new Set<string>();

function token(): string | null {
  return localStorage.getItem('vera_token');
}

function isCurrent(gen: number, account: string, tok: string): boolean {
  return gen === generation && accountId === account && token() === tok;
}

async function api(path: string, tok: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api/icon-packs/mine${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, ...(init.headers || {}) },
  });
}

/** Записать паки с сервера, не запуская обратную выгрузку. */
function putLocal(next: Record<string, CustomIconPack>): void {
  applyingRemote = true;
  try { useIconPackStore.setState({ packs: next }); } finally { applyingRemote = false; }
}

async function download(ids: string[], gen: number, account: string, tok: string): Promise<void> {
  for (const id of ids) {
    try {
      const r = await api(`/${encodeURIComponent(id)}`, tok);
      if (!isCurrent(gen, account, tok)) return;
      if (!r.ok) continue;
      const { pack } = await r.json();
      if (!isCurrent(gen, account, tok) || !pack || typeof pack !== 'object') return;
      const clean: CustomIconPack = {
        id: String(pack.id || id), name: String(pack.name || 'Пак иконок'),
        base: pack.base, icons: pack.icons && typeof pack.icons === 'object' ? pack.icons : {},
        updatedAt: Number(pack.updatedAt) || Date.now(),
      };
      putLocal({ ...useIconPackStore.getState().packs, [clean.id]: clean });
      known.set(clean.id, clean.updatedAt);
    } catch {
      // Сеть пропала — догрузим на следующей сверке.
    }
  }
}

async function upload(gen: number, account: string, tok: string): Promise<void> {
  const ids = [...pendingUpload];
  pendingUpload.clear();
  const packs = useIconPackStore.getState().packs;
  for (const id of ids) {
    const pack = packs[id];
    if (!pack) continue;
    try {
      const r = await api(`/${encodeURIComponent(id)}`, tok, {
        method: 'PUT',
        body: JSON.stringify({
          pack: { name: pack.name, base: pack.base, icons: pack.icons },
          updatedAt: pack.updatedAt, clientId: getSyncClientId(),
        }),
      });
      if (!isCurrent(gen, account, tok)) return;
      if (r.ok) known.set(id, pack.updatedAt);
      else console.warn('[icon-packs] выгрузка пака не удалась:', r.status);
    } catch {
      if (isCurrent(gen, account, tok)) pendingUpload.add(id);
    }
  }
  for (const id of [...pendingDelete]) {
    pendingDelete.delete(id);
    try {
      const r = await api(`/${encodeURIComponent(id)}?clientId=${encodeURIComponent(getSyncClientId())}`, tok, { method: 'DELETE' });
      if (!isCurrent(gen, account, tok)) return;
      if (r.ok) known.delete(id);
    } catch {
      if (isCurrent(gen, account, tok)) pendingDelete.add(id);
    }
  }
}

function scheduleUpload(): void {
  const account = accountId;
  const tok = token();
  if (!account || !tok) return;
  const gen = generation;
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    if (isCurrent(gen, account, tok)) void upload(gen, account, tok);
  }, UPLOAD_DEBOUNCE);
}

/**
 * Сверка с серверным списком. Свежее на сервере — докачиваем, свежее здесь
 * или нет на сервере — выгружаем; удалённый на другом устройстве (был
 * известен, а теперь пропал из списка) — убираем локально.
 */
async function reconcile(list: RemoteMeta[], gen: number, account: string, tok: string): Promise<void> {
  const local = useIconPackStore.getState().packs;
  const remote = new Map(list.map((m) => [m.id, Number(m.updatedAt) || 0]));
  const toDownload: string[] = [];
  for (const [id, at] of remote) {
    const mine = local[id];
    if (!mine || mine.updatedAt < at) toDownload.push(id);
    else if (mine.updatedAt > at) pendingUpload.add(id);
    else known.set(id, at);
  }
  const removedElsewhere: string[] = [];
  for (const id of Object.keys(local)) {
    if (remote.has(id)) continue;
    if (known.has(id)) removedElsewhere.push(id);
    else pendingUpload.add(id);
  }
  if (removedElsewhere.length) {
    const next = { ...local };
    for (const id of removedElsewhere) { delete next[id]; known.delete(id); }
    putLocal(next);
    const ui = useUiPrefsStore.getState();
    if (ui.customPack && removedElsewhere.includes(ui.customPack)) ui.setCustomPack(null);
  }
  await download(toDownload, gen, account, tok);
  if (pendingUpload.size && isCurrent(gen, account, tok)) scheduleUpload();
}

function waitHydrated(): Promise<void> {
  if (useIconPackStore.getState().hydrated) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useIconPackStore.subscribe((s) => { if (s.hydrated) { off(); resolve(); } });
  });
}

function bindSocket(gen: number, account: string, tok: string): void {
  import('./socket').then(({ getSocket }) => {
    if (!isCurrent(gen, account, tok)) return;
    const socket = getSocket?.() as any;
    if (!socket?.on) return;
    const handler = (payload: any) => {
      if (!isCurrent(gen, account, tok)) return;
      if (payload?.clientId && payload.clientId === getSyncClientId()) return;
      if (Array.isArray(payload?.packs)) void reconcile(payload.packs, gen, account, tok);
    };
    socket.on('icon-packs:updated', handler);
    socketBound = socket;
    socketHandler = handler;
  }).catch(() => {});
}

/** Остановить синк (выход, смена аккаунта). Локальные паки не трогает. */
export function stopIconPackSync(): void {
  generation += 1;
  accountId = null;
  unsubscribe?.();
  unsubscribe = null;
  if (socketBound && socketHandler) socketBound.off?.('icon-packs:updated', socketHandler);
  socketBound = null;
  socketHandler = null;
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = null;
  pendingUpload.clear();
  pendingDelete.clear();
  known = new Map();
  try { useIconPackStore.setState({ syncing: false }); } catch {}
}

/**
 * Запустить синк для вошедшего аккаунта. `accountChanged` — на устройстве
 * до этого был другой аккаунт: его паки убираются, чтобы не уехать новому.
 */
export async function startIconPackSync(account: string, accountChanged: boolean): Promise<void> {
  stopIconPackSync();
  const tok = token();
  if (!account || !tok) return;
  accountId = account;
  const gen = generation;
  useIconPackStore.setState({ syncing: true });
  try {
    await waitHydrated();
    if (!isCurrent(gen, account, tok)) return;
    if (accountChanged) {
      putLocal({});
      // Пак прежнего аккаунта здесь больше не существует.
      useUiPrefsStore.getState().setCustomPack(null);
    }

    unsubscribe = useIconPackStore.subscribe((state, prev) => {
      if (applyingRemote || state.packs === prev.packs || !isCurrent(gen, account, tok)) return;
      for (const [id, pack] of Object.entries(state.packs)) {
        if (prev.packs[id] !== pack) { pendingUpload.add(id); pendingDelete.delete(id); }
      }
      for (const id of Object.keys(prev.packs)) {
        if (!state.packs[id]) { pendingDelete.add(id); pendingUpload.delete(id); }
      }
      scheduleUpload();
    });

    const r = await api('', tok);
    if (!isCurrent(gen, account, tok) || !r.ok) return;
    const { packs } = await r.json();
    if (!isCurrent(gen, account, tok)) return;
    await reconcile(Array.isArray(packs) ? packs : [], gen, account, tok);
    if (isCurrent(gen, account, tok)) bindSocket(gen, account, tok);
  } catch {
    // Нет сети — паки остаются локальными, сверка пройдёт при следующем входе.
  } finally {
    if (gen === generation) useIconPackStore.setState({ syncing: false });
  }
}

