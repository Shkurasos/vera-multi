// Local, hand-authored SVG artwork shared by previews and equipped skins.
const path = (d: string, fill: string, stroke = '#352c32', width = 1) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const line = (d: string, color: string, width = 1) => path(d, 'none', color, width);
const wrap = (body: string, viewBox = '0 0 100 100') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
export const artDataUrl = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

// A horizontal illuminated-manuscript composition inspired by the supplied reference.
export const DRAGON_ART = wrap(`
  <defs>
    <linearGradient id="parchment" x2="0" y2="1"><stop stop-color="#d9d5a0"/><stop offset=".5" stop-color="#b6ba87"/><stop offset="1" stop-color="#e7d6a0"/></linearGradient>
    <linearGradient id="dragon" x1="0" y1="1" x2=".7" y2="0"><stop stop-color="#675a4e"/><stop offset=".45" stop-color="#b57e5d"/><stop offset=".75" stop-color="#ce772a"/><stop offset="1" stop-color="#f4c75b"/></linearGradient>
    <linearGradient id="fire"><stop stop-color="#fffde1"/><stop offset=".32" stop-color="#fff386"/><stop offset=".7" stop-color="#ecbe17"/><stop offset="1" stop-color="#b94b09"/></linearGradient>
    <pattern id="checks" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#777626"/><path d="M0 4L4 0L8 4L4 8Z" fill="#302d1d"/></pattern>
    <pattern id="scroll" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 6Q6 0 9 4T5 10Q1 9 4 6T8 8M9 0Q6 3 12 6" fill="none" stroke="#777c56" stroke-width=".45" opacity=".45"/></pattern>
  </defs>
  <circle cx="35" cy="59" r="39" fill="#858879" stroke="#292b26" stroke-width="2"/><circle cx="35" cy="59" r="34" fill="none" stroke="#c0bca1" stroke-width="2"/>
  ${Array.from({ length: 12 }, (_, i) => `<path d="M35 25Q55 38 35 48Q15 38 35 25ZM35 29Q47 38 35 44" fill="none" stroke="#2f332c" stroke-width="1.2" transform="rotate(${i * 30} 35 59)"/>`).join('')}
  <path d="M0 51H124V64H0Z" fill="none" stroke="#5b5c42"/>
  ${Array.from({ length: 15 }, (_, i) => line(`M${i * 8 + 2} 61v-7l4 5v-5m-4 3h5`, '#626549', .85)).join('')}
  <path d="M3 76C39 23 57 110 103 80Q126 64 145 48L151 34L174 27L184 30L175 41L156 49Q153 72 132 85Q89 118 50 81Q25 56 3 89Z" fill="url(#dragon)" stroke="#302921" stroke-width="1.7"/>
  ${line('M6 80C37 35 58 100 98 78Q124 64 145 44M7 85C38 44 58 107 104 84Q129 72 148 51', '#edd4ab', 1.1)}
  ${Array.from({ length: 17 }, (_, i) => {
    const x = 22 + i * 7, y = 65 + Math.sin(i * .36) * 18;
    return `<path d="M${x - 6} ${y}q7 -13 13 0q-7 13 -13 0m3 0q4 -7 7 0q-4 7 -7 0" fill="none" stroke="#392e29" stroke-width="1" transform="rotate(${i > 10 ? -35 : 20} ${x} ${y})"/>`;
  }).join('')}
  <path d="M147 37Q113 14 88 26Q76 28 81 13Q79 22 91 20Q127 8 155 31M159 29Q143 16 144 4L159 20L164 28" fill="#cbb59b" stroke="#382e27" stroke-width="1.3"/>
  ${line('M91 20L92 26M101 18L104 25M112 18L115 26M123 20L126 29M133 23L136 32M149 17L154 14', '#645046', 1)}
  <path d="M137 44L125 32L146 35L139 21L158 31Q169 20 185 22L181 15Q190 15 188 28L181 37L170 40Q164 47 169 57L181 67L173 76L157 62L146 56L132 66L138 52L122 57Z" fill="url(#dragon)" stroke="#36281c" stroke-width="1.5"/>
  <path d="M180 37L168 42Q165 54 181 67L173 65L159 52L160 43Z" fill="#4a241b" stroke="#36281c"/>
  <path d="M178 38L175 46L172 40L170 48L167 43M172 61L177 57L178 65L183 62L181 68" fill="#fff1bd" stroke="#66552e" stroke-width=".7"/>
  <path d="M151 37L164 35L159 40Z" fill="#fff9aa" stroke="#76652c"/><path d="M157 36L157 39" stroke="#615f29"/>
  <path d="M129 76Q146 61 156 73L169 76L173 85L166 81L164 86L159 78L151 78Q142 76 136 84" fill="url(#dragon)" stroke="#382e27" stroke-width="1.2"/>
  <path d="M169 76L175 79L173 85L171 80M162 79L166 83L164 87" fill="#fff0c5" stroke="#554632" stroke-width=".7"/>
  ${line('M134 58Q99 50 84 99Q70 116 43 107M144 66Q100 108 70 112M138 78Q178 96 146 117M145 84Q167 100 188 103', '#3d3029', 3.8)}
  ${line('M134 58Q99 50 84 99Q70 116 43 107M144 66Q100 108 70 112M138 78Q178 96 146 117M145 84Q167 100 188 103', '#c39172', 2)}
  <path d="M170 49Q192 29 240 13V106Q204 85 170 49Z" fill="url(#fire)" opacity=".95"/>
  ${line('M171 49Q201 35 240 18M171 49Q205 47 240 37M171 49Q206 58 240 65M171 49Q200 72 240 98M181 49Q204 35 227 41T240 40M180 51Q207 69 230 64T240 67', '#fff9b0', 1.1)}
  ${line('M175 49Q196 45 221 51T240 52M182 52Q210 81 232 79M188 43Q211 24 228 26', '#ffffff', .65)}
  ${Array.from({ length: 13 }, (_, i) => `<path d="M${12 + i * 17} ${17 + (i * 29) % 88}q-5 8 3 6q-4 -1 -3 -6" fill="#ffed93"/>`).join('')}
`, '0 0 240 120');
