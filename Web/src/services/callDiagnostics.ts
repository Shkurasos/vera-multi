/**
 * callDiagnostics — проверка WebRTC/медиа перед звонком.
 * Выводит результат в консоль и возвращает объект со статусами.
 */

interface DiagnosticsResult {
  mediaDevicesAPI: boolean;
  micPermission: 'granted' | 'denied' | 'prompt' | 'unavailable';
  camPermission: 'granted' | 'denied' | 'prompt' | 'unavailable';
  displayPermission: 'granted' | 'denied' | 'prompt' | 'unavailable';
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  getUserMediaWorks: boolean;
  getUserMediaError?: string;
  getDisplayMediaWorks: boolean;
  getDisplayMediaError?: string;
  stunReachable: boolean;
  turnReachable: boolean;
  cloudflareWarpDetected: boolean;
}

export async function runCallDiagnostics(): Promise<DiagnosticsResult> {
  const result: DiagnosticsResult = {
    mediaDevicesAPI: false,
    micPermission: 'unavailable',
    camPermission: 'unavailable',
    displayPermission: 'unavailable',
    audioDevices: [],
    videoDevices: [],
    getUserMediaWorks: false,
    getDisplayMediaWorks: false,
    stunReachable: false,
    turnReachable: false,
    cloudflareWarpDetected: false,
  };

  console.group('🔍 WebRTC Diagnostics');

  // 1. MediaDevices API
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error('❌ navigator.mediaDevices.getUserMedia не доступен');
    result.mediaDevicesAPI = false;
  } else {
    console.log('✅ navigator.mediaDevices.getUserMedia доступен');
    result.mediaDevicesAPI = true;
  }

  // 2. Permissions
  if (navigator.permissions) {
    try {
      const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      result.micPermission = mic.state;
      console.log(`🎙️ Микрофон: ${mic.state}`);
    } catch {
      result.micPermission = 'unavailable';
      console.log('🎙️ Микрофон: недоступно (браузер не поддерживает проверку)');
    }
    try {
      const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
      result.camPermission = cam.state;
      console.log(`📷 Камера: ${cam.state}`);
    } catch {
      result.camPermission = 'unavailable';
      console.log('📷 Камера: недоступно');
    }
    try {
      const disp = await navigator.permissions.query({ name: 'display-capture' as any });
      result.displayPermission = disp.state;
      console.log(`🖥️ Экран: ${disp.state}`);
    } catch {
      result.displayPermission = 'prompt';
      console.log('🖥️ Экран: будет запрошено при вызове getDisplayMedia');
    }
  } else {
    console.log('⚠️ navigator.permissions не поддерживается');
  }

  // 3. Список устройств
  if (result.mediaDevicesAPI) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      result.audioDevices = devices.filter((d) => d.kind === 'audioinput');
      result.videoDevices = devices.filter((d) => d.kind === 'videoinput');
      console.log(`🎤 Аудиовходы: ${result.audioDevices.length}`, result.audioDevices.map(d => d.label || d.deviceId));
      console.log(`📹 Видеовходы: ${result.videoDevices.length}`, result.videoDevices.map(d => d.label || d.deviceId));
    } catch (e) {
      console.error('❌ Не удалось перечислить устройства:', e);
    }
  }

  // 4. getUserMedia (аудио)
  if (result.mediaDevicesAPI) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      result.getUserMediaWorks = true;
      console.log('✅ getUserMedia (audio) работает. Треки:', stream.getTracks().map(t => `${t.kind}: ${t.label}`));
      stream.getTracks().forEach((t) => t.stop());
    } catch (e: any) {
      result.getUserMediaWorks = false;
      result.getUserMediaError = e.message || String(e);
      console.error('❌ getUserMedia (audio) не работает:', e.name, e.message);
    }
  }

  // 5. getDisplayMedia
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    console.log('🖥️ getDisplayMedia доступен (требует действия пользователя)');
    result.getDisplayMediaWorks = true;
  } else {
    result.getDisplayMediaWorks = false;
    result.getDisplayMediaError = 'API не поддерживается';
    console.error('❌ getDisplayMedia не поддерживается');
  }

  // 6. STUN/TURN reachability
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      ],
    });
    const candidates: string[] = [];
    pc.onicecandidate = (e) => {
      if (e.candidate) candidates.push(e.candidate.candidate);
      else {
        const hasStun = candidates.some((c) => c.includes('typ srflx'));
        const hasTurn = candidates.some((c) => c.includes('typ relay'));
        result.stunReachable = hasStun;
        result.turnReachable = hasTurn;
        console.log(`🌐 STUN (srflx): ${hasStun ? '✅' : '❌'}`);
        console.log(`🌐 TURN (relay): ${hasTurn ? '✅' : '❌'}`);
        if (!hasStun && !hasTurn) {
          console.warn('⚠️ Ни STUN, ни TURN кандидаты не получены — блокировка UDP или VPN');
        }
        pc.close();
      }
    };
    await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription();
    await new Promise((r) => setTimeout(r, 3000));
    pc.close();
  } catch (e) {
    console.error('❌ Не удалось проверить STUN/TURN:', e);
  }

  // 7. Cloudflare WARP detection
  try {
    const resp = await fetch('https://1.1.1.1/cdn-cgi/trace', { cache: 'no-store' });
    const text = await resp.text();
    const warp = text.includes('warp=on') || text.includes('warp=plus');
    result.cloudflareWarpDetected = warp;
    if (warp) {
      console.warn('⚠️ Cloudflare WARP обнаружен. Может блокировать WebRTC UDP.');
    } else {
      console.log('✅ Cloudflare WARP не обнаружен');
    }
  } catch {
    console.log('⚠️ Не удалось проверить Cloudflare WARP');
  }

  console.groupEnd();
  return result;
}

export async function showCallDiagnosticsAlert() {
  const r = await runCallDiagnostics();
  const issues: string[] = [];
  if (!r.mediaDevicesAPI) issues.push('❌ getUserMedia API недоступен');
  if (r.micPermission === 'denied') issues.push('❌ Доступ к микрофону запрещён');
  if (r.camPermission === 'denied') issues.push('❌ Доступ к камере запрещён');
  if (!r.getUserMediaWorks) issues.push(`❌ getUserMedia: ${r.getUserMediaError || 'ошибка'}`);
  if (!r.getDisplayMediaWorks) issues.push(`❌ getDisplayMedia: ${r.getDisplayMediaError || ''}`);
  if (!r.stunReachable && !r.turnReachable) issues.push('❌ STUN и TURN недоступны (UDP заблокирован)');
  if (r.cloudflareWarpDetected) issues.push('⚠️ Cloudflare WARP включён');

  if (issues.length === 0) {
    alert('✅ Всё работает! WebRTC, медиа и STUN/TURN доступны.');
  } else {
    alert(`Проблемы:\n\n${issues.join('\n')}\n\nПодробности в консоли (F12).`);
  }
}

