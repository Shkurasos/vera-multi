/*
 * CallAudioSink — невидимый компонент, воспроизводит аудио всех удалённых
 * пиров. Не рендерится внутри CallTile, потому что тайлы могут скрываться
 * (сворачивание оверлея) — а звук должен продолжать играть.
 */
import React, { useEffect, useRef } from 'react';
import { useCallStore } from '../store/callStore';

function PeerAudio({ id, stream, muted, outputId }: { id: string; stream?: MediaStream; muted: boolean; outputId: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  // Куда выводить звук: выбрано ПКМ по кнопке наушников в CallOverlay.
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    if (!el || typeof el.setSinkId !== 'function') return;
    el.setSinkId(outputId).catch(() => { /* устройство недоступно — остаёмся на системном */ });
  }, [outputId, stream]);
  return <audio ref={ref} data-peer={id} autoPlay playsInline muted={muted} />;
}

export default function CallAudioSink() {
  const peers = useCallStore((s) => s.peers);
  const deaf = useCallStore((s) => s.local.deaf);
  const audioOutputId = useCallStore((s) => s.audioOutputId);
  return (
    <div style={{ display: 'none' }}>
      {Object.values(peers).map((p) => (
        <PeerAudio key={p.userId} id={p.userId} stream={p.stream} muted={deaf} outputId={audioOutputId || ''} />
      ))}
    </div>
  );
}
