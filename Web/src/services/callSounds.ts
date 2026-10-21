/* Звуки звонков: гудки вызова, принятие, отклонение, завершение.
 * Все тона генерируются через WebAudio — без ассетов. Учитывают настройку
 * «Звуки в приложении» (inAppSounds). */

import { useUserSettingsStore } from '../store/userSettingsStore';

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function soundsEnabled(): boolean {
  try { return useUserSettingsStore.getState().inAppSounds !== false; } catch { return true; }
}

/** Один тон: частота, задержка старта и длительность в секундах. */
function tone(freq: number, start: number, dur: number, gain = 0.15, type: OscillatorType = 'sine') {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.05);
}

/** Соединение установлено: два восходящих тона. */
export function playCallAccept() {
  if (!soundsEnabled()) return;
  tone(523, 0, 0.12);
  tone(784, 0.13, 0.18);
}

/** Вызов отклонён: два нисходящих тона. */
export function playCallDecline() {
  if (!soundsEnabled()) return;
  tone(440, 0, 0.14);
  tone(311, 0.17, 0.26);
}

/** Звонок снят/завершён: тройной нисходящий аккорд. */
export function playCallHangup() {
  if (!soundsEnabled()) return;
  tone(660, 0, 0.1, 0.12);
  tone(415, 0.09, 0.1, 0.12);
  tone(262, 0.18, 0.24, 0.12);
}

// ── Гудки вызова (ringback) ──
let ringTimer: ReturnType<typeof setInterval> | null = null;

/** Двойной гудок каждые ~2.6 с — звонящий слушает, пока собеседник не примет. */
export function startRingback() {
  if (ringTimer || !soundsEnabled()) return;
  const beep = () => { tone(425, 0, 0.36, 0.1); tone(425, 0.55, 0.36, 0.1); };
  beep();
  ringTimer = setInterval(beep, 2600);
}

export function stopRingback() {
  if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
}
