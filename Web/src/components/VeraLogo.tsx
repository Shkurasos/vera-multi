import React from 'react';

interface Props {
  size?: number;
  showText?: boolean;
  textColor?: string;
}

export default function VeraLogo({ size = 40, showText = true, textColor = '#E0E0F0' }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="vera-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.22" />
          </filter>
        </defs>
        <g filter="url(#vera-shadow)">
          <path d="M24 43 L5.6 9.5 C4.8 8 5.9 6.2 7.6 6.2H40.4C42.1 6.2 43.2 8 42.4 9.5L24 43Z" fill="#252525" />
          <circle cx="24" cy="22.5" r="14.2" fill="none" stroke="#F5F5F5" strokeWidth="4.6" />
          <path d="M11 13.4H37L24 36.8L11 13.4Z" fill="#F5F5F5" />
          <path d="M17.1 16.2H30.9L28.6 20.6H18.6L17.1 16.2Z" fill="#252525" />
          <path d="M18.8 22.7H32.2" stroke="#252525" strokeWidth="4.2" strokeLinecap="round" />
          <path d="M20.8 28H27.5" stroke="#252525" strokeWidth="4.2" strokeLinecap="round" />
          <path d="M12.7 18.5L16.2 25.2L20.1 33.2" stroke="#252525" strokeWidth="4.2" strokeLinecap="round" />
          <circle cx="14.2" cy="21" r="2.2" fill="#F5F5F5" />
          <circle cx="16.8" cy="26.5" r="2.2" fill="#F5F5F5" />
        </g>
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
