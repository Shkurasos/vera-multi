/*
 * CallAudioSink — невидимый компонент, воспроизводит аудио всех удалённых
 * пиров. Не рендерится внутри CallTile, потому что тайлы могут скрываться
 * (сворачивание оверлея) — а звук должен продолжать играть.
 */
import React, { useEffect, useRef } from 'react';
import { useCallStore } from '../store/callStore';

function PeerAudio({ id, stream, muted }: { id: string; stream?: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} data-peer={id} autoPlay playsInline muted={muted} />;
}

export default function CallAudioSink() {
  const peers = useCallStore((s) => s.peers);
  const deaf = useCallStore((s) => s.local.deaf);
  return (
    <div style={{ display: 'none' }}>
      {Object.values(peers).map((p) => (
        <PeerAudio key={p.userId} id={p.userId} stream={p.stream} muted={deaf} />
      ))}
    </div>
  );
}
