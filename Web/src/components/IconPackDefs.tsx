import React from 'react';

/**
 * SVG-фильтры стилевых паков иконок («Рельеф», «Надутые», «Стикеры»).
 *
 * Монтируется один раз в корне приложения; CSS в main.tsx вешает
 * `filter: url(#…)` на иконки шима (класс `vera-ico`). Фильтры работают с
 * уже отрисованной иконкой, поэтому цвет берётся из самой иконки
 * (currentColor) — никаких отдельных наборов картинок не нужно.
 *
 * Параметры подобраны в пикселях под иконку 24px: на 16–32px смотрится так же.
 * Не display:none — в таком <svg> фильтры не везде применяются.
 */
export default function IconPackDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <defs>
        {/* Рельеф: блик от света сверху-слева + мягкая тень под знаком. */}
        <filter id="vera-ico-relief" x="-25%" y="-25%" width="150%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur" />
          <feSpecularLighting in="blur" surfaceScale="2.4" specularConstant="0.95" specularExponent="16"
            lightingColor="#ffffff" result="spec">
            <feDistantLight azimuth="225" elevation="50" />
          </feSpecularLighting>
          <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
          <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.8" k4="0" result="lit" />
          <feOffset in="SourceAlpha" dy="1.2" result="off" />
          <feGaussianBlur in="off" stdDeviation="0.8" result="offBlur" />
          <feColorMatrix in="offBlur" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="lit" />
          </feMerge>
        </filter>

        {/* Надутые: форму «раздуваем» и скругляем (gooey), сверху — глянец. */}
        <filter id="vera-ico-puffy" x="-25%" y="-25%" width="150%" height="160%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceGraphic" operator="dilate" radius="0.45" result="fat" />
          <feGaussianBlur in="fat" stdDeviation="0.75" result="fatBlur" />
          <feColorMatrix in="fatBlur" type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -5.5" result="goo" />
          <feGaussianBlur in="goo" stdDeviation="1.4" result="gooBlur" />
          <feSpecularLighting in="gooBlur" surfaceScale="3.5" specularConstant="1.1" specularExponent="10"
            lightingColor="#ffffff" result="spec">
            <fePointLight x="6" y="3" z="16" />
          </feSpecularLighting>
          <feComposite in="spec" in2="goo" operator="in" result="specIn" />
          <feComposite in="goo" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.65" k4="0" result="lit" />
          <feOffset in="goo" dy="1" result="off" />
          <feGaussianBlur in="off" stdDeviation="1" result="offBlur" />
          <feColorMatrix in="offBlur" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="lit" />
          </feMerge>
        </filter>

        {/* Стикер: белая кромка вокруг всего знака + тонкий тёмный кант
            (виден и на светлых темах) + тень «наклейки». */}
        <filter id="vera-ico-sticker" x="-30%" y="-30%" width="160%" height="170%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="edgeAlpha" />
          <feGaussianBlur in="edgeAlpha" stdDeviation="0.3" result="edgeSoft" />
          <feFlood floodColor="#ffffff" result="white" />
          <feComposite in="white" in2="edgeSoft" operator="in" result="edge" />
          <feMorphology in="SourceAlpha" operator="dilate" radius="2.1" result="rimAlpha" />
          <feFlood floodColor="#000000" floodOpacity="0.22" result="dark" />
          <feComposite in="dark" in2="rimAlpha" operator="in" result="rim" />
          <feOffset in="edgeSoft" dy="1.1" result="off" />
          <feGaussianBlur in="off" stdDeviation="0.9" result="offBlur" />
          <feColorMatrix in="offBlur" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.4 0" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="rim" />
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
