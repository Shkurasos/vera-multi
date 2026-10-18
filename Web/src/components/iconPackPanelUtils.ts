/** Общие помощники панели своих паков. */
import { ICON_SLOTS } from '../mui-icons-shim';
import { packFileName } from '../utils/iconPackFormat';

/** Что показывать в превью пака: сначала заменённые слоты. */
const PREVIEW_DEFAULT = ['Search', 'Call', 'MoreVert', 'AttachFile', 'Send', 'Palette'];
export function previewSlots(icons: Record<string, unknown>, n = 6): string[] {
  const own = Object.keys(icons).filter((s) => ICON_SLOTS.includes(s));
  return [...own, ...PREVIEW_DEFAULT.filter((s) => !own.includes(s))].slice(0, n);
}

/** Имена слотов шима — для проверки чужих паков. */
export const KNOWN_SLOTS: ReadonlySet<string> = new Set(ICON_SLOTS);

export function downloadPackFile(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = packFileName(name);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
