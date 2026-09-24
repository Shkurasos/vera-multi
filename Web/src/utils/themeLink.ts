import type { Theme } from '../store/themeStore';

/**
 * Импорт/экспорт темы компактной ссылкой: base64 от JSON с короткими ключами.
 *
 * Функции чистые (без React и Zustand), поэтому лежат в utils и покрыты
 * unit-тестами (`themeLink.test.cjs`); `themeStore` реэкспортирует их для UI,
 * чтобы старые импорты продолжали работать.
 */

/** ID кастомных тем начинается с 1000. */
export const CUSTOM_THEME_ID_START = 1000;

export function themeToLink(theme: Theme): string {
  try {
    const payload = {
      n: theme.name,
      b: theme.bg,
      t: theme.text,
      a: theme.accent,
      s: theme.bgSidebar,
      c: theme.bgChat,
      h: theme.bgHeader,
      i: theme.bgInput,
      o: theme.bgBubbleOwn,
      p: theme.bgBubbleOther,
      v: theme.bgHover,
      x: theme.bgActive,
      ts: theme.textSec,
      bd: theme.border,
      on: theme.online,
      cp: theme.chatPattern,
      cpn: theme.chatPatternSizeMin,
      cpx: theme.chatPatternSizeMax,
      db: theme.disableBackgroundBlobs,
      dg: theme.disableBackgroundGlow,
      gc: theme.backgroundGlowColor,
      gi: theme.backgroundGlowIntensity,
      ci: theme.chatBgImage,
      co: theme.chatBgImageOpacity,
      og: theme.bubbleOwnGradient,
      os: theme.bubbleOwnShadow,
      ps: theme.bubbleOtherShadow,
      sg: theme.sidebarGradient,
      sl: theme.sidebarBlur,
      hg: theme.headerGradient,
      ot: theme.bubbleOwnText,
      pt: theme.bubbleOtherText,
      // Прозрачность фона пузырей: bo — свой, bt — чужой.
      bo: theme.bubbleOwnOpacity,
      bt: theme.bubbleOtherOpacity,
      // Цвета времени: на сообщениях и в списке чатов.
      mt: theme.messageTimeColor,
      ct: theme.chatTimeColor,
      f: theme.finish,
      fa: theme.finishAmount,
    };
    const json = JSON.stringify(payload);
    return btoa(unescape(encodeURIComponent(json)));
  } catch {
    return '';
  }
}

export function themeFromLink(link: string): Theme | null {
  try {
    const json = decodeURIComponent(escape(atob(link.trim())));
    const p = JSON.parse(json);
    const id = CUSTOM_THEME_ID_START + Math.floor(Math.random() * 9000000);
    return {
      id,
      name: p.n || 'Imported',
      bg: p.b || '#000',
      text: p.t || '#fff',
      accent: p.a || '#0f0',
      bgSidebar: p.s || '#000',
      bgChat: p.c || '#000',
      bgHeader: p.h || '#000',
      bgInput: p.i || '#111',
      bgBubbleOwn: p.o || '#0f0',
      bgBubbleOther: p.p || '#222',
      bgHover: p.v || '#111',
      bgActive: p.x || '#222',
      textSec: p.ts || '#aaa',
      border: p.bd || 'rgba(255,255,255,0.08)',
      online: p.on || '#0f0',
      chatPattern: p.cp,
      chatPatternSizeMin: p.cpn ?? 860,
      chatPatternSizeMax: p.cpx ?? 1400,
      disableBackgroundBlobs: p.db,
      disableBackgroundGlow: p.dg,
      backgroundGlowColor: p.gc || '#8FE3CF',
      backgroundGlowIntensity: p.gi ?? 0.18,
      chatBgImage: p.ci,
      chatBgImageOpacity: p.co ?? 0.35,
      bubbleOwnGradient: p.og,
      bubbleOwnShadow: p.os,
      bubbleOtherShadow: p.ps,
      sidebarGradient: p.sg,
      sidebarBlur: p.sl,
      headerGradient: p.hg,
      bubbleOwnText: p.ot,
      bubbleOtherText: p.pt || p.t,
      bubbleOwnOpacity: p.bo,
      bubbleOtherOpacity: p.bt,
      // Старые ссылки этих полей не содержат — тогда время берёт цвет из темы.
      messageTimeColor: p.mt,
      chatTimeColor: p.ct,
      finish: p.f,
      finishAmount: p.fa ?? 0.5,
    };
  } catch {
    return null;
  }
}
