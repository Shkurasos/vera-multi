import React from 'react';

interface Props {
  /** Размер иконки в px (ширина и высота). */
  size?: number;
  /**
   * Рисовать светлый скруглённый квадрат-подложку.
   * false — только тёмный знак (для мелких врезок в текст).
   */
  background?: boolean;
}

/**
 * Знак валюты ВП: светлый скруглённый квадрат с тёмными геометрическими
 * осколками-треугольниками — точная копия эталонного макета (скриншот).
 * Используется вместо текстового «ВП» рядом с суммами и ценами.
 */
export default function VpIcon({ size = 16, background = true }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ВП"
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: '-0.15em' }}
    >
      {background && <rect x="2" y="2" width="60" height="60" rx="12" fill="#EFEFEF" />}
      <g fill="#2B2B2B">
        {/* Большой осколок: верхняя кромка, вырез «<», правый выступ и нижний кончик. */}
        <polygon points="6,9 39,9 21,31 45,40 34,58" />
        {/* Малый осколок справа сверху. */}
        <polygon points="47,9 60.5,9 52,29" />
      </g>
    </svg>
  );
}
