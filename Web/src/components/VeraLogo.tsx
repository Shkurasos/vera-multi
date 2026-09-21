import React from 'react';

interface Props {
  size?: number;
  showText?: boolean;
  textColor?: string;
}

/**
 * Логотип Vera: скруглённый квадрат с перевёрнутым треугольником,
 * пересечённым кругом, и горизонтальными полосами внутри.
 * Соответствует иконке приложения (public/vera.svg).
 */
export default function VeraLogo({ size = 40, showText = true, textColor = '#E0E0F0' }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="2" y="2" width="60" height="60" rx="12" fill="#EDEDED" />
        <path d="M12 18 L52 18 L32 52 Z" fill="#252525" />
        <circle cx="34" cy="28" r="14" fill="#EDEDED" />
        <circle cx="34" cy="28" r="14" fill="none" stroke="#252525" strokeWidth="3" />
        <path d="M22 24 h20 l-2 4 h-16 z" fill="#252525" />
        <rect x="24" y="30" width="16" height="3.6" rx="1.8" fill="#252525" />
        <rect x="26" y="36" width="10" height="3.6" rx="1.8" fill="#252525" />
        <line x1="22" y1="26" x2="27" y2="26" stroke="#EDEDED" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="24" y1="32" x2="29" y2="32" stroke="#EDEDED" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="26" y1="38" x2="30" y2="38" stroke="#EDEDED" strokeWidth="2.2" strokeLinecap="round" />
      </svg>

      {showText && (
        <span style={{
          fontSize: size * 0.55,
          fontWeight: 800,
          color: textColor,
          letterSpacing: '0.04em',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: 'linear-gradient(135deg, #C084FC, #7C6AF7)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Vera
        </span>
      )}
    </div>
  );
}
