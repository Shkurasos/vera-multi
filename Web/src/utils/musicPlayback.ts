/** Restore once on metadata; canplay also fires after seeking and buffering. */
export function bindMusicPlayback(
  audio: HTMLAudioElement,
  position: number,
  shouldPlay: () => boolean,
  onDuration: (duration: number) => void,
) {
  let restored = false;
  const metadata = () => {
    onDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    if (restored) return;
    restored = true;
    if (Number.isFinite(position) && position > 0 && position < audio.duration) {
      audio.currentTime = position;
    }
  };
  const ready = () => {
    if (shouldPlay() && audio.paused) void audio.play().catch(() => {});
  };
  audio.addEventListener('loadedmetadata', metadata);
  audio.addEventListener('canplay', ready);
  return () => {
    audio.removeEventListener('loadedmetadata', metadata);
    audio.removeEventListener('canplay', ready);
  };
}