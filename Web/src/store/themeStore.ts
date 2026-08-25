import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usersApi } from '../services/api';

export interface Theme {
  id: number;
  name: string;
  bg: string;
  text: string;
  accent: string;
  bgSidebar: string;
  bgChat: string;
  bgHeader: string;
  bgInput: string;
  bgBubbleOwn: string;
  bgBubbleOther: string;
  bgHover: string;
  bgActive: string;
  textSec: string;
  border: string;
  online: string;
  // CSS background-image для фона области сообщений (SVG-паттерн или null)
  chatPattern?: string;
  // base64 или data URL пользовательского фото-фона чата
  chatBgImage?: string;
  // прозрачность пользовательского фото-фона (0-1)
  chatBgImageOpacity?: number;
  // Градиент для своих пузырей (если задан — перекрывает bgBubbleOwn)
  bubbleOwnGradient?: string;
  // box-shadow / glow для своих пузырей
  bubbleOwnShadow?: string;
  // box-shadow для чужих пузырей
  bubbleOtherShadow?: string;
  // Градиент/фон для сайдбара (если задан — перекрывает bgSidebar)
  sidebarGradient?: string;
  // Glassmorphism backdrop-filter для сайдбара
  sidebarBlur?: string;
  // Градиент для хедера чата
  headerGradient?: string;
  // Цвет текста на своём пузыре
  bubbleOwnText?: string;
  // Фото чата (аватар чата), base64/data URL, независимо от темы
  chatPhoto?: string;
}

function adjustBrightness(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ─── SVG паттерны ─────────────────────────────────────────────────────────────
function svg(content: string) {
  return `url("data:image/svg+xml,${encodeURIComponent(content)}")`;
}

// Мелкие точки
const dots = (color: string, size = 24) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${size/2}' cy='${size/2}' r='1.2' fill='${color}'/></svg>`);

// Ромбики
const diamonds = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M12 2 L22 12 L12 22 L2 12 Z' fill='none' stroke='${color}' stroke-width='0.8'/></svg>`);

// Гексагоны
const hexagons = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='46'><polygon points='20,2 38,12 38,34 20,44 2,34 2,12' fill='none' stroke='${color}' stroke-width='0.7'/></svg>`);

// Тонкая сетка
const grid = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><path d='M20 0 L0 0 0 20' fill='none' stroke='${color}' stroke-width='0.5'/></svg>`);

// Волны
const waves = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='60' height='20'><path d='M0 10 Q15 0 30 10 Q45 20 60 10' fill='none' stroke='${color}' stroke-width='0.8'/></svg>`);

// Диагональные полосы (тонкие)
const diagonals = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><line x1='0' y1='12' x2='12' y2='0' stroke='${color}' stroke-width='0.6'/></svg>`);

// Звёздочки
const stars = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-size='10' fill='${color}'>✦</text></svg>`);

// Крестики
const crosses = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><line x1='10' y1='4' x2='10' y2='16' stroke='${color}' stroke-width='0.7'/><line x1='4' y1='10' x2='16' y2='10' stroke='${color}' stroke-width='0.7'/></svg>`);

// Цветочки
const flowers = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><circle cx='18' cy='12' r='3' fill='${color}' opacity='0.5'/><circle cx='24' cy='18' r='3' fill='${color}' opacity='0.5'/><circle cx='18' cy='24' r='3' fill='${color}' opacity='0.5'/><circle cx='12' cy='18' r='3' fill='${color}' opacity='0.5'/><circle cx='18' cy='18' r='2.5' fill='${color}' opacity='0.7'/></svg>`);

// Треугольники
const triangles = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><polygon points='14,3 25,24 3,24' fill='none' stroke='${color}' stroke-width='0.7'/></svg>`);

// Рыбья чешуя
const scales = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><path d='M0 20 Q10 10 20 20 Q30 10 40 20' fill='none' stroke='${color}' stroke-width='0.7'/><path d='M-20 10 Q-10 0 0 10 Q10 0 20 10 Q30 0 40 10 Q50 0 60 10' fill='none' stroke='${color}' stroke-width='0.7'/></svg>`);

// Спирали / завитки
const spirals = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M20,20 m-8,0 a8,8 0 1,1 16,0 a12,12 0 1,0 -24,0 a16,16 0 1,1 32,0' fill='none' stroke='${color}' stroke-width='0.7'/></svg>`);

// Двойные линии (решётка с точками на пересечении)
const dotGrid = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect x='11.5' y='11.5' width='1' height='1' fill='${color}'/></svg>`);

// Снежинки
const snowflakes = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><line x1='18' y1='4' x2='18' y2='32' stroke='${color}' stroke-width='0.7'/><line x1='4' y1='18' x2='32' y2='18' stroke='${color}' stroke-width='0.7'/><line x1='7' y1='7' x2='29' y2='29' stroke='${color}' stroke-width='0.7'/><line x1='29' y1='7' x2='7' y2='29' stroke='${color}' stroke-width='0.7'/><circle cx='18' cy='18' r='2' fill='${color}'/></svg>`);

// Лунные серпы
const moons = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M20,16 A8,8 0 1,1 16,8 A6,6 0 1,0 20,16 Z' fill='${color}' opacity='0.4'/></svg>`);

// Листья / вьюнок
const leaves = (color: string) =>
  svg(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M5,35 Q20,5 35,5 Q35,20 20,30 Q12,35 5,35 Z' fill='none' stroke='${color}' stroke-width='0.8'/><line x1='5' y1='35' x2='30' y2='10' stroke='${color}' stroke-width='0.5'/></svg>`);

// ID кастомных тем начинается с 1000
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
      ci: theme.chatBgImage,
      co: theme.chatBgImageOpacity,
      og: theme.bubbleOwnGradient,
      os: theme.bubbleOwnShadow,
      ps: theme.bubbleOtherShadow,
      sg: theme.sidebarGradient,
      sl: theme.sidebarBlur,
      hg: theme.headerGradient,
      ot: theme.bubbleOwnText,
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
      chatBgImage: p.ci,
      chatBgImageOpacity: p.co ?? 0.35,
      bubbleOwnGradient: p.og,
      bubbleOwnShadow: p.os,
      bubbleOtherShadow: p.ps,
      sidebarGradient: p.sg,
      sidebarBlur: p.sl,
      headerGradient: p.hg,
      bubbleOwnText: p.ot,
    };
  } catch {
    return null;
  }
}

export const THEMES: Theme[] = [
  // ── 0 ── Vera 0.2 Betta — AMOLED Glass / 2026 ─────────────────────────────
  {
    id: 0, name: 'AMOLED Live',
    bg: '#000000', text: '#F8FBFF', accent: '#00F5D4',
    bgSidebar: 'rgba(0,0,0,0.86)', bgChat: '#000000', bgHeader: 'rgba(0,0,0,0.72)',
    bgInput: 'rgba(255,255,255,0.070)', bgBubbleOwn: '#00F5D4', bgBubbleOther: 'rgba(255,255,255,0.055)',
    bgHover: 'rgba(0,245,212,0.12)', bgActive: 'rgba(0,245,212,0.22)',
    textSec: '#8E98A8', border: 'rgba(0,245,212,0.18)', online: '#B8FF00',
    chatPattern: stars('rgba(0,245,212,0.055)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #B8FF00 0%, #00F5D4 42%, #00C2FF 72%, #FF2E93 100%)',
    bubbleOwnShadow: '0 0 34px rgba(0,245,212,0.34), 0 0 70px rgba(255,46,147,0.18), 0 0 0 1px rgba(255,255,255,0.22) inset',
    bubbleOtherShadow: '0 18px 44px rgba(0,0,0,0.62), 0 0 0 1px rgba(0,245,212,0.14) inset, 0 0 24px rgba(0,194,255,0.08)',
    sidebarGradient: 'radial-gradient(circle at 20% 0%, rgba(0,245,212,0.18), transparent 34%), radial-gradient(circle at 100% 72%, rgba(255,46,147,0.14), transparent 38%), linear-gradient(180deg, rgba(3,5,10,0.92) 0%, rgba(0,0,0,0.98) 100%)',
    sidebarBlur: 'blur(26px) saturate(1.45)',
    headerGradient: 'linear-gradient(90deg, rgba(0,0,0,0.76) 0%, rgba(0,245,212,0.10) 50%, rgba(0,0,0,0.76) 100%)',
    bubbleOwnText: '#00100E',
  },

  // ── 1 ── Vera Dark — чистая, без паттерна ─────────────────────────────────
  {
    id: 1, name: 'Deep Night',
    bg: '#0A0E1A', text: '#EEF3FF', accent: '#FFB86B',
    bgSidebar: 'rgba(10,14,26,0.86)', bgChat: '#080C16', bgHeader: 'rgba(10,14,26,0.70)',
    bgInput: 'rgba(255,255,255,0.085)', bgBubbleOwn: '#FFB86B', bgBubbleOther: 'rgba(22,31,50,0.66)',
    bgHover: 'rgba(255,184,107,0.11)', bgActive: 'rgba(255,184,107,0.20)',
    textSec: '#95A0B8', border: 'rgba(255,255,255,0.105)', online: '#69E6A3',
    chatPattern: moons('rgba(255,184,107,0.055)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #FFD29A 0%, #FFB86B 48%, #FF7A70 100%)',
    bubbleOwnShadow: '0 16px 46px rgba(255,184,107,0.24), 0 2px 10px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.20) inset',
    bubbleOtherShadow: '0 18px 42px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.075) inset',
    sidebarGradient: 'radial-gradient(circle at 10% 0%, rgba(255,184,107,0.13), transparent 32%), radial-gradient(circle at 100% 88%, rgba(98,119,255,0.12), transparent 36%), linear-gradient(180deg, rgba(16,24,42,0.92) 0%, rgba(10,14,26,0.96) 58%, #050814 100%)',
    sidebarBlur: 'blur(24px) saturate(1.22)',
    headerGradient: 'linear-gradient(90deg, rgba(7,10,18,0.80) 0%, rgba(25,34,56,0.66) 52%, rgba(7,10,18,0.80) 100%)',
    bubbleOwnText: '#160B02',
  },

  // ── 0 ── Vera Dark — чистая, без паттерна ─────────────────────────────────
  {
    id: 100, name: 'Vera Dark Legacy',
    bg: '#1E1D2B', text: '#E0DEFF', accent: '#7C6AF7',
    bgSidebar: '#1E1D2B', bgChat: '#1A1928', bgHeader: '#17162A',
    bgInput: '#252535', bgBubbleOwn: '#4A3F9F', bgBubbleOther: '#2A2940',
    bgHover: '#2A2940', bgActive: '#312F4A',
    textSec: '#8A88AA', border: 'rgba(255,255,255,0.06)', online: '#4CAF50',
    chatPattern: undefined,
    bubbleOwnGradient: 'linear-gradient(135deg, #6C5CE7 0%, #4A3F9F 60%, #3730A3 100%)',
    bubbleOwnShadow: '0 6px 20px rgba(124,106,247,0.26), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #22203A 0%, #1A1930 50%, #16152A 100%)',
    headerGradient: 'linear-gradient(90deg, #1D1C32 0%, #17162A 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 101 ── Ночной изумруд ─────────────────────────────────────────────────
  {
    id: 101, name: 'Ночной изумруд',
    bg: '#0d1f1a', text: '#e0f2e9', accent: '#2ecc71',
    bgSidebar: '#0d1f1a', bgChat: '#0a1a15', bgHeader: '#091510',
    bgInput: '#122618', bgBubbleOwn: '#1a6b3a', bgBubbleOther: '#152b1f',
    bgHover: '#152b1f', bgActive: '#1c3a28', textSec: '#7db896',
    border: 'rgba(46,204,113,0.1)', online: '#2ecc71',
    chatPattern: dots('rgba(46,204,113,0.07)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #27ae60 0%, #1a6b3a 60%, #14532d 100%)',
    bubbleOwnShadow: '0 6px 18px rgba(46,204,113,0.24), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #102820 0%, #0d1f1a 60%, #091510 100%)',
    headerGradient: 'linear-gradient(90deg, #0f1c15 0%, #091510 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 2 ── Тёплый закат ────────────────────────────────────────────────────
  {
    id: 2, name: 'Тёплый закат',
    bg: '#2c1810', text: '#fdebd0', accent: '#e67e22',
    bgSidebar: '#2c1810', bgChat: '#251410', bgHeader: '#1f100c',
    bgInput: '#331d14', bgBubbleOwn: '#7a3e10', bgBubbleOther: '#3a2015',
    bgHover: '#3a2015', bgActive: '#4a2a1c', textSec: '#c4946a',
    border: 'rgba(230,126,34,0.055)', online: '#4CAF50',
    chatPattern: diagonals('rgba(230,126,34,0.055)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #e67e22 0%, #7a3e10 60%, #5a2d08 100%)',
    bubbleOwnShadow: '0 6px 18px rgba(230,126,34,0.24), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #341d12 0%, #2c1810 60%, #1f100c 100%)',
    headerGradient: 'linear-gradient(90deg, #261510 0%, #1f100c 100%)',
    bubbleOwnText: '#fff8ee',
  },

  // ── 3 ── Light & Airy — молочное стекло / дневной воздух ─────────────────
  {
    id: 3, name: 'Light & Airy',
    bg: '#F8F2EA', text: '#172033', accent: '#5B6CFF',
    bgSidebar: 'rgba(255,252,247,0.78)', bgChat: '#FBF7F0', bgHeader: 'rgba(255,255,255,0.66)',
    bgInput: 'rgba(255,255,255,0.82)', bgBubbleOwn: '#5B6CFF', bgBubbleOther: 'rgba(255,255,255,0.78)',
    bgHover: 'rgba(91,108,255,0.075)', bgActive: 'rgba(91,108,255,0.14)', textSec: '#687085',
    border: 'rgba(41,52,82,0.105)', online: '#22C55E',
    chatPattern: dots('rgba(91,108,255,0.045)', 34),
    bubbleOwnGradient: 'linear-gradient(135deg, #7D89FF 0%, #5B6CFF 52%, #8A5CFF 100%)',
    bubbleOwnShadow: '0 18px 42px rgba(91,108,255,0.22), 0 8px 18px rgba(80,60,130,0.10), 0 1px 0 rgba(255,255,255,0.42) inset',
    bubbleOtherShadow: '0 16px 34px rgba(65,55,40,0.11), 0 0 0 1px rgba(255,255,255,0.80) inset',
    sidebarGradient: 'radial-gradient(circle at 14% 0%, rgba(255,232,197,0.85), transparent 34%), radial-gradient(circle at 100% 18%, rgba(198,218,255,0.72), transparent 38%), linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(248,242,234,0.92) 100%)',
    sidebarBlur: 'blur(26px) saturate(1.18)',
    headerGradient: 'linear-gradient(90deg, rgba(255,255,255,0.74) 0%, rgba(244,238,255,0.58) 52%, rgba(255,249,240,0.72) 100%)',
    bubbleOwnText: '#FFFFFF',
  },

  // ── 4 ── Индиго-голд ─────────────────────────────────────────────────────
  {
    id: 4, name: 'Индиго-голд',
    bg: '#0f0f2d', text: '#e0e7ff', accent: '#fbbf24',
    bgSidebar: '#0f0f2d', bgChat: '#0c0c26', bgHeader: '#08081e',
    bgInput: '#141440', bgBubbleOwn: '#7a5a10', bgBubbleOther: '#1a1a45',
    bgHover: '#1a1a45', bgActive: '#222260', textSec: '#8890c0',
    border: 'rgba(251,191,36,0.1)', online: '#4CAF50',
    chatPattern: stars('rgba(251,191,36,0.10)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #f59e0b 0%, #7a5a10 60%, #5a3d08 100%)',
    bubbleOwnShadow: '0 6px 20px rgba(251,191,36,0.28), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #141438 0%, #0f0f2d 60%, #08081e 100%)',
    headerGradient: 'linear-gradient(90deg, #131330 0%, #08081e 100%)',
    bubbleOwnText: '#fff8e0',
  },

  // ── 5 ── Тёмная вишня ────────────────────────────────────────────────────
  {
    id: 5, name: 'Тёмная вишня',
    bg: '#1a0d0d', text: '#fce4e4', accent: '#e74c3c',
    bgSidebar: '#1a0d0d', bgChat: '#150a0a', bgHeader: '#100808',
    bgInput: '#200f0f', bgBubbleOwn: '#6b1515', bgBubbleOther: '#2a1212',
    bgHover: '#2a1212', bgActive: '#381818', textSec: '#c08888',
    border: 'rgba(231,76,60,0.1)', online: '#4CAF50',
    chatPattern: diamonds('rgba(231,76,60,0.07)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #e74c3c 0%, #6b1515 60%, #4a0f0f 100%)',
    bubbleOwnShadow: '0 6px 18px rgba(231,76,60,0.27), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #200f0f 0%, #1a0d0d 60%, #100808 100%)',
    headerGradient: 'linear-gradient(90deg, #1c0c0c 0%, #100808 100%)',
    bubbleOwnText: '#fff0ee',
  },

  // ── 6 ── Лавандовый сон ──────────────────────────────────────────────────
  {
    id: 6, name: 'Лавандовый сон',
    bg: '#1a1528', text: '#e8e0f0', accent: '#a78bfa',
    bgSidebar: '#1a1528', bgChat: '#15111f', bgHeader: '#110d1a',
    bgInput: '#221c32', bgBubbleOwn: '#5b3fb0', bgBubbleOther: '#261e38',
    bgHover: '#261e38', bgActive: '#32274a', textSec: '#9080b8',
    border: 'rgba(167,139,250,0.1)', online: '#4CAF50',
    chatPattern: flowers('rgba(167,139,250,0.10)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #a78bfa 0%, #5b3fb0 60%, #4527a0 100%)',
    bubbleOwnShadow: '0 6px 20px rgba(167,139,250,0.27), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #201830 0%, #1a1528 60%, #110d1a 100%)',
    headerGradient: 'linear-gradient(90deg, #1c1625 0%, #110d1a 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 7 ── Океанская глубь ─────────────────────────────────────────────────
  {
    id: 7, name: 'Океанская глубь',
    bg: '#0a1628', text: '#dbeafe', accent: '#3b82f6',
    bgSidebar: '#0a1628', bgChat: '#081220', bgHeader: '#060e18',
    bgInput: '#0f1e35', bgBubbleOwn: '#1a3a80', bgBubbleOther: '#131e38',
    bgHover: '#131e38', bgActive: '#1a2848', textSec: '#7090c0',
    border: 'rgba(59,130,246,0.1)', online: '#4CAF50',
    chatPattern: waves('rgba(59,130,246,0.075)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #3b82f6 0%, #1a3a80 60%, #112060 100%)',
    bubbleOwnShadow: '0 6px 20px rgba(59,130,246,0.26), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #0d1c32 0%, #0a1628 60%, #060e18 100%)',
    headerGradient: 'linear-gradient(90deg, #0c1525 0%, #060e18 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 8 ── Песчаный берег ──────────────────────────────────────────────────
  {
    id: 8, name: 'Песчаный берег',
    bg: '#f5ebe0', text: '#5c4033', accent: '#d4a373',
    bgSidebar: '#f5ebe0', bgChat: '#faf0e6', bgHeader: '#ecdecf',
    bgInput: '#ffffff', bgBubbleOwn: '#d4a373', bgBubbleOther: '#e6d5c5',
    bgHover: '#e6d5c5', bgActive: '#d8c4b0', textSec: '#9c7060',
    border: 'rgba(92,64,51,0.12)', online: '#4CAF50',
    chatPattern: undefined,
    bubbleOwnGradient: 'linear-gradient(135deg, #e8b896 0%, #d4a373 60%, #b8845a 100%)',
    bubbleOwnShadow: '0 6px 14px rgba(212,163,115,0.24), 0 1px 4px rgba(0,0,0,0.10)',
    bubbleOtherShadow: '0 2px 6px rgba(92,64,51,0.15)',
    sidebarGradient: 'linear-gradient(180deg, #faf0e6 0%, #f5ebe0 60%, #ecdecf 100%)',
    headerGradient: 'linear-gradient(90deg, #ecdecf 0%, #ddd0c0 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 9 ── Смоки-розовый ───────────────────────────────────────────────────
  {
    id: 9, name: 'Смоки-розовый',
    bg: '#1a1418', text: '#f5e4ec', accent: '#f472b6',
    bgSidebar: '#1a1418', bgChat: '#150f13', bgHeader: '#110c0f',
    bgInput: '#221820', bgBubbleOwn: '#7a2050', bgBubbleOther: '#281820',
    bgHover: '#281820', bgActive: '#36202c', textSec: '#b87090',
    border: 'rgba(244,114,182,0.1)', online: '#4CAF50',
    chatPattern: leaves('rgba(244,114,182,0.08)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #f472b6 0%, #7a2050 60%, #5a1840 100%)',
    bubbleOwnShadow: '0 6px 18px rgba(244,114,182,0.27), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #221820 0%, #1a1418 60%, #110c0f 100%)',
    headerGradient: 'linear-gradient(90deg, #1c1618 0%, #110c0f 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 10 ── Тёмный нефрит ──────────────────────────────────────────────────
  {
    id: 10, name: 'Тёмный нефрит',
    bg: '#0d1f14', text: '#d1fae5', accent: '#10b981',
    bgSidebar: '#0d1f14', bgChat: '#0a1910', bgHeader: '#08140c',
    bgInput: '#12261a', bgBubbleOwn: '#0a6040', bgBubbleOther: '#142a1c',
    bgHover: '#142a1c', bgActive: '#1c3828', textSec: '#6ab890',
    border: 'rgba(16,185,129,0.1)', online: '#10b981',
    chatPattern: hexagons('rgba(16,185,129,0.075)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #10b981 0%, #0a6040 60%, #064d30 100%)',
    bubbleOwnShadow: '0 6px 18px rgba(16,185,129,0.24), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #102818 0%, #0d1f14 60%, #08140c 100%)',
    headerGradient: 'linear-gradient(90deg, #0f2016 0%, #08140c 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 11 ── Медовый месяц ──────────────────────────────────────────────────
  {
    id: 11, name: 'Медовый месяц',
    bg: '#1f180d', text: '#fef3c7', accent: '#f59e0b',
    bgSidebar: '#1f180d', bgChat: '#1a1408', bgHeader: '#141008',
    bgInput: '#261e10', bgBubbleOwn: '#7a4a05', bgBubbleOther: '#2e2010',
    bgHover: '#2e2010', bgActive: '#3c2c14', textSec: '#c0a040',
    border: 'rgba(245,158,11,0.1)', online: '#4CAF50',
    chatPattern: crosses('rgba(245,158,11,0.08)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #f59e0b 0%, #7a4a05 60%, #5a3404 100%)',
    bubbleOwnShadow: '0 6px 18px rgba(245,158,11,0.28), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #261c10 0%, #1f180d 60%, #141008 100%)',
    headerGradient: 'linear-gradient(90deg, #20160c 0%, #141008 100%)',
    bubbleOwnText: '#fff8e0',
  },

  // ── 12 ── Арктическая зима ───────────────────────────────────────────────
  {
    id: 12, name: 'Арктическая зима',
    bg: '#f0f4f8', text: '#1e293b', accent: '#38bdf8',
    bgSidebar: '#f0f4f8', bgChat: '#f8fafc', bgHeader: '#e2e8f0',
    bgInput: '#ffffff', bgBubbleOwn: '#0284c7', bgBubbleOther: '#e2f4fc',
    bgHover: '#e2e8f0', bgActive: '#cbd5e1', textSec: '#64748b',
    border: 'rgba(30,41,59,0.1)', online: '#22c55e',
    chatPattern: undefined,
    bubbleOwnGradient: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 60%, #0264a0 100%)',
    bubbleOwnShadow: '0 6px 16px rgba(56,189,248,0.22), 0 1px 4px rgba(0,0,0,0.10)',
    bubbleOtherShadow: '0 2px 6px rgba(30,41,59,0.1)',
    sidebarGradient: 'linear-gradient(180deg, #f8fafc 0%, #f0f4f8 60%, #e2e8f0 100%)',
    headerGradient: 'linear-gradient(90deg, #e2e8f0 0%, #d0dce8 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 13 ── Космический бархат ─────────────────────────────────────────────
  {
    id: 13, name: 'Космический бархат',
    bg: '#0d0b15', text: '#e5e0f0', accent: '#8b5cf6',
    bgSidebar: '#0d0b15', bgChat: '#0a0810', bgHeader: '#080610',
    bgInput: '#14101e', bgBubbleOwn: '#4c2090', bgBubbleOther: '#1a1628',
    bgHover: '#1a1628', bgActive: '#221e34', textSec: '#8070a8',
    border: 'rgba(139,92,246,0.1)', online: '#4CAF50',
    chatPattern: spirals('rgba(139,92,246,0.09)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #8b5cf6 0%, #4c2090 60%, #3b1878 100%)',
    bubbleOwnShadow: '0 6px 22px rgba(139,92,246,0.30), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.30)',
    sidebarGradient: 'linear-gradient(180deg, #120e1e 0%, #0d0b15 60%, #080610 100%)',
    headerGradient: 'linear-gradient(90deg, #100c18 0%, #080610 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 14 ── Болотный мох ───────────────────────────────────────────────────
  {
    id: 14, name: 'Болотный мох',
    bg: '#141a12', text: '#d4e8c4', accent: '#65a30d',
    bgSidebar: '#141a12', bgChat: '#10160e', bgHeader: '#0c120a',
    bgInput: '#1c2418', bgBubbleOwn: '#3a5808', bgBubbleOther: '#1c2a16',
    bgHover: '#1c2a16', bgActive: '#263818', textSec: '#80a860',
    border: 'rgba(101,163,13,0.1)', online: '#65a30d',
    chatPattern: scales('rgba(101,163,13,0.075)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #65a30d 0%, #3a5808 60%, #2a4005 100%)',
    bubbleOwnShadow: '0 6px 16px rgba(101,163,13,0.24), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #1a2218 0%, #141a12 60%, #0c120a 100%)',
    headerGradient: 'linear-gradient(90deg, #141c10 0%, #0c120a 100%)',
    bubbleOwnText: '#f0ffe0',
  },

  // ── 15 ── Коралл риф ────────────────────────────────────────────────────
  {
    id: 15, name: 'Коралл риф',
    bg: '#1f0f0f', text: '#ffe0d4', accent: '#f43f5e',
    bgSidebar: '#1f0f0f', bgChat: '#1a0c0c', bgHeader: '#140909',
    bgInput: '#281414', bgBubbleOwn: '#801020', bgBubbleOther: '#301818',
    bgHover: '#301818', bgActive: '#402020', textSec: '#c07070',
    border: 'rgba(244,63,94,0.1)', online: '#4CAF50',
    chatPattern: triangles('rgba(244,63,94,0.075)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #f43f5e 0%, #801020 60%, #600818 100%)',
    bubbleOwnShadow: '0 6px 20px rgba(244,63,94,0.28), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #261010 0%, #1f0f0f 60%, #140909 100%)',
    headerGradient: 'linear-gradient(90deg, #200e0e 0%, #140909 100%)',
    bubbleOwnText: '#fff0ee',
  },

  // ── 16 ── Серебряный туман ───────────────────────────────────────────────
  {
    id: 16, name: 'Серебряный туман',
    bg: '#1a1c1e', text: '#e8edf0', accent: '#94a3b8',
    bgSidebar: '#1a1c1e', bgChat: '#161819', bgHeader: '#121415',
    bgInput: '#222628', bgBubbleOwn: '#3a4a58', bgBubbleOther: '#242830',
    bgHover: '#242830', bgActive: '#2e343e', textSec: '#8090a0',
    border: 'rgba(148,163,184,0.1)', online: '#4CAF50',
    chatPattern: undefined,
    bubbleOwnGradient: 'linear-gradient(135deg, #6480a0 0%, #3a4a58 60%, #2a3848 100%)',
    bubbleOwnShadow: '0 6px 14px rgba(148,163,184,0.20), 0 1px 4px rgba(0,0,0,0.24)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #202428 0%, #1a1c1e 60%, #121415 100%)',
    headerGradient: 'linear-gradient(90deg, #1c2024 0%, #121415 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 17 ── Тыквенный пирог ────────────────────────────────────────────────
  {
    id: 17, name: 'Тыквенный пирог',
    bg: '#1f140d', text: '#ffedd5', accent: '#ea580c',
    bgSidebar: '#1f140d', bgChat: '#1a100a', bgHeader: '#140c08',
    bgInput: '#261a10', bgBubbleOwn: '#7c2d05', bgBubbleOther: '#2e1a10',
    bgHover: '#2e1a10', bgActive: '#3c2418', textSec: '#c07040',
    border: 'rgba(234,88,12,0.1)', online: '#4CAF50',
    chatPattern: dotGrid('rgba(234,88,12,0.10)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #ea580c 0%, #7c2d05 60%, #5c2004 100%)',
    bubbleOwnShadow: '0 6px 20px rgba(234,88,12,0.28), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #261810 0%, #1f140d 60%, #140c08 100%)',
    headerGradient: 'linear-gradient(90deg, #20120c 0%, #140c08 100%)',
    bubbleOwnText: '#fff8ee',
  },

  // ── 18 ── Тёмная фуксия ──────────────────────────────────────────────────
  {
    id: 18, name: 'Тёмная фуксия',
    bg: '#1a0d1a', text: '#fce4f0', accent: '#d946ef',
    bgSidebar: '#1a0d1a', bgChat: '#150a15', bgHeader: '#100810',
    bgInput: '#220f22', bgBubbleOwn: '#741070', bgBubbleOther: '#281228',
    bgHover: '#281228', bgActive: '#341634', textSec: '#b060a8',
    border: 'rgba(217,70,239,0.1)', online: '#4CAF50',
    chatPattern: dots('rgba(217,70,239,0.09)', 20),
    bubbleOwnGradient: 'linear-gradient(135deg, #d946ef 0%, #741070 60%, #580c58 100%)',
    bubbleOwnShadow: '0 6px 22px rgba(217,70,239,0.30), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #201020 0%, #1a0d1a 60%, #100810 100%)',
    headerGradient: 'linear-gradient(90deg, #1c0e1c 0%, #100810 100%)',
    bubbleOwnText: '#ffffff',
  },

  // ── 19 ── Аквамариновый грот ─────────────────────────────────────────────
  {
    id: 19, name: 'Аквамариновый грот',
    bg: '#0d1a1a', text: '#cce8e8', accent: '#14b8a6',
    bgSidebar: '#0d1a1a', bgChat: '#0a1515', bgHeader: '#081010',
    bgInput: '#122020', bgBubbleOwn: '#0a6060', bgBubbleOther: '#142828',
    bgHover: '#142828', bgActive: '#1c3838', textSec: '#60a0a0',
    border: 'rgba(20,184,166,0.1)', online: '#14b8a6',
    chatPattern: snowflakes('rgba(20,184,166,0.09)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #14b8a6 0%, #0a6060 60%, #084848 100%)',
    bubbleOwnShadow: '0 6px 18px rgba(20,184,166,0.26), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #102020 0%, #0d1a1a 60%, #081010 100%)',
    headerGradient: 'linear-gradient(90deg, #0e1c1c 0%, #081010 100%)',
    bubbleOwnText: '#e0fffc',
  },

  // ── 20 ── Шоколадный брауни ──────────────────────────────────────────────
  {
    id: 20, name: 'Шоколадный брауни',
    bg: '#1a1210', text: '#eed6c4', accent: '#a0522d',
    bgSidebar: '#1a1210', bgChat: '#150f0c', bgHeader: '#100c09',
    bgInput: '#221816', bgBubbleOwn: '#5a2815', bgBubbleOther: '#281a16',
    bgHover: '#281a16', bgActive: '#342018', textSec: '#a07060',
    border: 'rgba(160,82,45,0.1)', online: '#4CAF50',
    chatPattern: grid('rgba(160,82,45,0.08)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #a0522d 0%, #5a2815 60%, #401e10 100%)',
    bubbleOwnShadow: '0 6px 16px rgba(160,82,45,0.26), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #201614 0%, #1a1210 60%, #100c09 100%)',
    headerGradient: 'linear-gradient(90deg, #1c1412 0%, #100c09 100%)',
    bubbleOwnText: '#fff0e8',
  },

  // ── 21 ── Лунная ночь ────────────────────────────────────────────────────
  {
    id: 21, name: 'Лунная ночь',
    bg: '#0b0d1a', text: '#d4d8f0', accent: '#6c8aff',
    bgSidebar: '#0b0d1a', bgChat: '#090b14', bgHeader: '#07080f',
    bgInput: '#10142a', bgBubbleOwn: '#1e2a70', bgBubbleOther: '#131828',
    bgHover: '#131828', bgActive: '#1a2038', textSec: '#6870a0',
    border: 'rgba(108,138,255,0.1)', online: '#4CAF50',
    chatPattern: moons('rgba(108,138,255,0.10)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #6c8aff 0%, #1e2a70 60%, #141c58 100%)',
    bubbleOwnShadow: '0 6px 20px rgba(108,138,255,0.26), 0 1px 4px rgba(0,0,0,0.30)',
    bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
    sidebarGradient: 'linear-gradient(180deg, #0e1020 0%, #0b0d1a 60%, #07080f 100%)',
    headerGradient: 'linear-gradient(90deg, #0d0f1c 0%, #07080f 100%)',
    bubbleOwnText: '#eef2ff',
  },

  // ── 22 ── Crimson Chalk ──────────────────────────────────────────────────
  {
    id: 22, name: 'Crimson Chalk',
    bg: '#08080A', text: '#F8F2EE', accent: '#DC143C',
    bgSidebar: '#0C0A0B', bgChat: '#171316', bgHeader: '#050506',
    bgInput: '#2A2A2C', bgBubbleOwn: '#DC143C', bgBubbleOther: '#241E21',
    bgHover: 'rgba(220,20,60,0.12)', bgActive: 'rgba(220,20,60,0.22)', textSec: '#B7A8A8',
    border: 'rgba(242,239,231,0.14)', online: '#DC143C',
    chatPattern: dots('rgba(220,20,60,0.10)', 28),
    bubbleOwnGradient: 'linear-gradient(135deg, #F02655 0%, #DC143C 48%, #9E0E2A 100%)',
    bubbleOwnShadow: '0 8px 28px rgba(224,86,112,0.24), 0 2px 8px rgba(0,0,0,0.32)',
    bubbleOtherShadow: '0 8px 24px rgba(12,10,11,0.10)',
    sidebarGradient: 'linear-gradient(180deg, #121012 0%, #08080A 58%, #000000 100%)',
    headerGradient: 'linear-gradient(90deg, #050506 0%, #141012 55%, #050506 100%)',
    bubbleOwnText: '#FFFFFF',
  },

  // ── 23 ── Abyss Frost ────────────────────────────────────────────────────
  {
    id: 23, name: 'Abyss Frost',
    bg: '#050914', text: '#EAF6FF', accent: '#E4F0F6',
    bgSidebar: '#070C17', bgChat: '#0B1220', bgHeader: '#030611',
    bgInput: '#121A28', bgBubbleOwn: '#0A0F1E', bgBubbleOther: '#131C2B',
    bgHover: 'rgba(228,240,246,0.10)', bgActive: 'rgba(228,240,246,0.18)', textSec: '#8C98A8',
    border: 'rgba(228,240,246,0.13)', online: '#9DEBFF',
    chatPattern: grid('rgba(10,15,30,0.075)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #182235 0%, #0A0F1E 58%, #02050D 100%)',
    bubbleOwnShadow: '0 8px 30px rgba(4,8,18,0.45), 0 0 0 1px rgba(228,240,246,0.08) inset',
    bubbleOtherShadow: '0 9px 22px rgba(10,15,30,0.12)',
    sidebarGradient: 'linear-gradient(180deg, #101827 0%, #070C17 62%, #030611 100%)',
    headerGradient: 'linear-gradient(90deg, #030611 0%, #101827 50%, #030611 100%)',
    bubbleOwnText: '#F4FAFF',
  },

  // ── 24 ── Vault Gold ─────────────────────────────────────────────────────
  {
    id: 24, name: 'Vault Gold',
    bg: '#0A0A0A', text: '#F5E6BC', accent: '#C8A96E',
    bgSidebar: '#0E0E0D', bgChat: '#12110E', bgHeader: '#050505',
    bgInput: '#1C1A15', bgBubbleOwn: '#C8A96E', bgBubbleOther: '#111111',
    bgHover: 'rgba(200,169,110,0.12)', bgActive: 'rgba(200,169,110,0.22)', textSec: '#A79060',
    border: 'rgba(200,169,110,0.18)', online: '#D6BE82',
    chatPattern: diamonds('rgba(17,17,17,0.09)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #E0C989 0%, #C8A96E 55%, #8A6A34 100%)',
    bubbleOwnShadow: '0 8px 30px rgba(200,169,110,0.22), 0 1px 0 rgba(255,255,255,0.20) inset',
    bubbleOtherShadow: '0 8px 24px rgba(0,0,0,0.42), 0 0 0 1px rgba(200,169,110,0.10) inset',
    sidebarGradient: 'linear-gradient(180deg, #151410 0%, #0A0A0A 64%, #000000 100%)',
    headerGradient: 'linear-gradient(90deg, #050505 0%, #1B1710 52%, #050505 100%)',
    bubbleOwnText: '#111111',
  },

  // ── 25 ── Noir Rose ──────────────────────────────────────────────────────
  {
    id: 25, name: 'Noir Rose',
    bg: '#120607', text: '#FFEAF1', accent: '#E8729A',
    bgSidebar: '#160708', bgChat: '#170B10', bgHeader: '#080203',
    bgInput: '#241012', bgBubbleOwn: '#E8729A', bgBubbleOther: '#241016',
    bgHover: 'rgba(232,114,154,0.12)', bgActive: 'rgba(232,114,154,0.22)', textSec: '#BD6B82',
    border: 'rgba(232,114,154,0.16)', online: '#F9A8C5',
    chatPattern: leaves('rgba(26,10,10,0.10)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #FF8DB4 0%, #E8729A 56%, #B13F68 100%)',
    bubbleOwnShadow: '0 8px 30px rgba(232,114,154,0.24), 0 0 0 1px rgba(255,255,255,0.12) inset',
    bubbleOtherShadow: '0 8px 24px rgba(0,0,0,0.38), 0 0 0 1px rgba(232,114,154,0.10) inset',
    sidebarGradient: 'linear-gradient(180deg, #200A0C 0%, #120607 62%, #070202 100%)',
    headerGradient: 'linear-gradient(90deg, #080203 0%, #241012 52%, #080203 100%)',
    bubbleOwnText: '#160708',
  },

  // ── 26 ── Midnight Ember ─────────────────────────────────────────────────
  {
    id: 26, name: 'Midnight Ember',
    bg: '#061018', text: '#FFF1EA', accent: '#FF6B35',
    bgSidebar: '#07111A', bgChat: '#0A141D', bgHeader: '#03090E',
    bgInput: '#13202A', bgBubbleOwn: '#FF6B35', bgBubbleOther: '#0D1117',
    bgHover: 'rgba(255,107,53,0.12)', bgActive: 'rgba(255,107,53,0.22)', textSec: '#B9826F',
    border: 'rgba(255,107,53,0.16)', online: '#FFB088',
    chatPattern: diagonals('rgba(13,17,23,0.09)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #FF8A63 0%, #FF6B35 52%, #D84B1C 100%)',
    bubbleOwnShadow: '0 8px 32px rgba(255,107,53,0.25), 0 0 0 1px rgba(255,255,255,0.12) inset',
    bubbleOtherShadow: '0 9px 24px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,107,53,0.08) inset',
    sidebarGradient: 'linear-gradient(180deg, #0D1722 0%, #061018 62%, #03090E 100%)',
    headerGradient: 'linear-gradient(90deg, #03090E 0%, #142230 52%, #03090E 100%)',
    bubbleOwnText: '#111111',
  },

  // ── 27 ── Midnight Coral ─────────────────────────────────────────────────
  {
    id: 27, name: 'Midnight Coral',
    bg: '#0E1727', text: '#FFF4F1', accent: '#FF6B5F',
    bgSidebar: '#101827', bgChat: '#121B2A', bgHeader: '#080E18',
    bgInput: '#1B2535', bgBubbleOwn: '#FF6B5F', bgBubbleOther: '#1E293B',
    bgHover: 'rgba(255,107,95,0.12)', bgActive: 'rgba(255,107,95,0.22)', textSec: '#A7A0A0',
    border: 'rgba(255,107,95,0.15)', online: '#FFB0A7',
    chatPattern: dotGrid('rgba(14,23,39,0.14)'),
    bubbleOwnGradient: 'linear-gradient(135deg, #FF8B80 0%, #FF6B5F 56%, #D94B42 100%)',
    bubbleOwnShadow: '0 8px 32px rgba(255,107,95,0.24), 0 0 0 1px rgba(255,255,255,0.13) inset',
    bubbleOtherShadow: '0 8px 22px rgba(14,23,39,0.10)',
    sidebarGradient: 'linear-gradient(180deg, #142033 0%, #0E1727 62%, #080E18 100%)',
    headerGradient: 'linear-gradient(90deg, #080E18 0%, #172337 52%, #080E18 100%)',
    bubbleOwnText: '#101827',
  },

  // ── 28 ── Live Adaptive — время / освещение / батарея ────────────────────
  {
    id: 28, name: 'Live Adaptive',
    bg: '#070A10', text: '#F4F7FF', accent: '#7DFFB2',
    bgSidebar: 'rgba(8,12,18,0.82)', bgChat: '#05070B', bgHeader: 'rgba(8,12,18,0.68)',
    bgInput: 'rgba(255,255,255,0.075)', bgBubbleOwn: '#7DFFB2', bgBubbleOther: 'rgba(255,255,255,0.070)',
    bgHover: 'rgba(125,255,178,0.11)', bgActive: 'rgba(125,255,178,0.20)', textSec: '#93A0B5',
    border: 'rgba(125,255,178,0.15)', online: '#7DFFB2',
    chatPattern: dots('rgba(125,255,178,0.045)', 30),
    bubbleOwnGradient: 'linear-gradient(135deg, #FFF0C2 0%, #7DFFB2 34%, #00C2FF 68%, #8A5CFF 100%)',
    bubbleOwnShadow: '0 16px 44px rgba(125,255,178,0.22), 0 0 34px rgba(0,194,255,0.14), 0 0 0 1px rgba(255,255,255,0.18) inset',
    bubbleOtherShadow: '0 18px 42px rgba(0,0,0,0.44), 0 0 0 1px rgba(255,255,255,0.08) inset',
    sidebarGradient: 'radial-gradient(circle at 10% 0%, rgba(255,240,194,0.18), transparent 30%), radial-gradient(circle at 92% 20%, rgba(0,194,255,0.16), transparent 34%), radial-gradient(circle at 50% 100%, rgba(138,92,255,0.13), transparent 38%), linear-gradient(180deg, rgba(18,22,30,0.90) 0%, rgba(5,7,11,0.97) 100%)',
    sidebarBlur: 'blur(26px) saturate(1.32)',
    headerGradient: 'linear-gradient(90deg, rgba(255,240,194,0.10) 0%, rgba(0,194,255,0.11) 50%, rgba(138,92,255,0.10) 100%)',
    bubbleOwnText: '#03110A',
  },
];

interface ThemeState {
  themeId: number;
  theme: Theme;
  customThemes: Theme[];
  chatPhoto?: string;
  // Фото-фон чата (обои), отдельно от аватарки чата
  chatBgImage?: string;
  chatBgImageOpacity?: number;
  setTheme: (id: number) => void;
  saveCustomTheme: (t: Theme) => void;
  deleteCustomTheme: (id: number) => void;
  applyCustomTheme: (t: Theme) => void;
  setChatPhoto: (photo?: string) => void;
  setChatBgImage: (photo?: string, opacity?: number) => void;
}

// Удаляем старый переполненный ключ (с огромными base64), чтобы он не
// читался при каждой загрузке (это вызывало лаги) и не ломал persist.
try {
  const old = localStorage.getItem('vera-theme');
  if (old && old.length > 100000) {
    localStorage.removeItem('vera-theme');
  }
} catch {}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: 0,
      theme: THEMES[0],
      customThemes: [],
      setTheme: (id) => {
        // Сначала ищем в кастомных, потом во встроенных
        const custom = get().customThemes.find(t => t.id === id);
        const builtin = THEMES.find(t => t.id === id);
        const t = custom || builtin || THEMES[0];
        set({ themeId: id, theme: t });
        // Сохраняем тему в БД пользователя (если есть токен)
        try {
          if (localStorage.getItem('vera_token')) {
            usersApi.updateTheme(id).catch(() => {});
          }
        } catch {}
      },
      saveCustomTheme: (t) => {
        const customs = get().customThemes;
        // Если тема с таким id уже есть — обновляем, иначе добавляем
        const exists = customs.find(c => c.id === t.id);
        const updated = exists
          ? customs.map(c => c.id === t.id ? t : c)
          : [...customs, t];
        set({ customThemes: updated });
        // Если эта тема сейчас активна — применяем изменения
        if (get().themeId === t.id) set({ theme: t });
      },
      deleteCustomTheme: (id) => {
        const updated = get().customThemes.filter(c => c.id !== id);
        set({ customThemes: updated });
        // Если удалили активную — вернуть на Vera Dark
        if (get().themeId === id) set({ themeId: 0, theme: THEMES[0] });
      },
      applyCustomTheme: (t) => {
        set({ theme: t, themeId: t.id });
      },
      setChatPhoto: (photo) => set({ chatPhoto: photo }),
      setChatBgImage: (photo, opacity = 0.35) => {
        set({
          chatBgImage: photo,
          chatBgImageOpacity: photo ? opacity : undefined,
          theme: {
            ...get().theme,
            chatBgImage: photo,
            chatBgImageOpacity: photo ? opacity : undefined,
          },
        });
      },
    }),
    {
      // НОВЫЙ ключ — старые переполненные данные полностью игнорируются.
      // Это гарантирует, что тема сохраняется после обновления страницы.
      name: 'vera-theme-v2',
      version: 1,
      // Сохраняем только компактные поля. Полный объект theme может содержать
      // огромные data-URL (фото-фон чата base64), из-за чего localStorage
      // переполнялся и тема сбрасывалась при обновлении страницы.
      partialize: (s) => {
        // Разрешаем большие data URL для фото чата и обоев: до ~5МБ.
        const LIMIT = 5 * 1024 * 1024;
        const clean = (t?: Theme): Theme | undefined => {
          if (!t) return t;
          const out: Theme = { ...t };
          if (out.chatBgImage && out.chatBgImage.startsWith('data:') && out.chatBgImage.length > LIMIT) {
            delete out.chatBgImage;
            delete out.chatBgImageOpacity;
          }
          return out;
        };
        return {
          themeId: s.themeId,
          customThemes: s.customThemes.map(clean).filter(Boolean) as Theme[],
          chatPhoto: s.chatPhoto && s.chatPhoto.startsWith('data:') && s.chatPhoto.length > LIMIT
            ? undefined
            : s.chatPhoto,
          chatBgImage: s.chatBgImage && s.chatBgImage.startsWith('data:') && s.chatBgImage.length > LIMIT
            ? undefined
            : s.chatBgImage,
          chatBgImageOpacity: s.chatBgImage && s.chatBgImage.startsWith('data:') && s.chatBgImage.length > LIMIT
            ? undefined
            : s.chatBgImageOpacity,
        };
      },
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<ThemeState>;
        const themeId = typeof p.themeId === 'number' ? p.themeId : 0;
        const customThemes = Array.isArray(p.customThemes) ? p.customThemes : [];
        const custom = customThemes.find(t => t && t.id === themeId);
        const builtin = THEMES.find(t => t.id === themeId);
        const baseTheme = custom || builtin || THEMES[0];
        // Поверх базовой темы восстанавливаем пользовательское фото-фон чата
        const theme: Theme = {
          ...baseTheme,
          ...(p.chatBgImage ? { chatBgImage: p.chatBgImage } : { chatBgImage: baseTheme.chatBgImage }),
          ...(p.chatBgImageOpacity !== undefined
            ? { chatBgImageOpacity: p.chatBgImageOpacity }
            : { chatBgImageOpacity: baseTheme.chatBgImageOpacity }),
        };
        return {
          ...current,
          themeId,
          customThemes,
          theme,
          chatPhoto: p.chatPhoto,
          chatBgImage: p.chatBgImage,
          chatBgImageOpacity: p.chatBgImageOpacity,
        };
      },
    }
  )
);
