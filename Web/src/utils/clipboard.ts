/**
 * Копирует текст в буфер обмена.
 *
 * Порядок:
 * 1) мост десктопного приложения (window.veraDesktop.clipboard) — пишет прямо
 *    в буфер ОС, не зависит от разрешений Chromium;
 * 2) navigator.clipboard — сайт и Android;
 * 3) скрытая textarea + document.execCommand('copy') — старые сборки
 *    приложения, где navigator.clipboard отвечает «Write permission denied».
 */
export async function copyText(text: string): Promise<boolean> {
  const bridge = desktopClipboard();
  if (bridge) {
    try { if (bridge.writeText(text)) return true; } catch { /* дальше */ }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // падаем в запасной вариант ниже
  }
  return legacyCopy(text);
}

/**
 * Копирует картинку (как PNG) в буфер обмена. Тот же порядок, что у copyText;
 * последний запасной путь — выделить <img> в скрытом contenteditable и
 * выполнить execCommand('copy'): Chromium кладёт в буфер и саму картинку.
 */
export async function copyImageBlob(png: Blob): Promise<boolean> {
  const bridge = desktopClipboard();
  if (bridge?.writeImage) {
    try {
      if (bridge.writeImage(await png.arrayBuffer())) return true;
    } catch { /* дальше */ }
  }
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return true;
    }
  } catch {
    // дальше — запасной вариант
  }
  return legacyCopyImage(png);
}

interface DesktopClipboard {
  writeText: (text: string) => boolean;
  writeImage?: (png: ArrayBuffer) => boolean;
}

function desktopClipboard(): DesktopClipboard | null {
  const c = (window as unknown as { veraDesktop?: { clipboard?: DesktopClipboard } }).veraDesktop?.clipboard;
  return c && typeof c.writeText === 'function' ? c : null;
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  try { active?.focus({ preventScroll: true }); } catch {}
  return ok;
}

async function legacyCopyImage(png: Blob): Promise<boolean> {
  // data: URL, а не blob: — так картинка в буфере не зависит от жизни blob.
  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(png);
  });
  if (!dataUrl) return false;

  const active = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  host.contentEditable = 'true';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  const img = document.createElement('img');
  img.src = dataUrl;
  host.appendChild(img);
  document.body.appendChild(host);

  let ok = false;
  try {
    await img.decode().catch(() => undefined);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNode(img);
    sel?.removeAllRanges();
    sel?.addRange(range);
    ok = document.execCommand('copy');
    sel?.removeAllRanges();
  } catch {
    ok = false;
  }
  document.body.removeChild(host);
  try { active?.focus({ preventScroll: true }); } catch {}
  return ok;
}

