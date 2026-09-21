// Local, hand-authored SVG artwork shared by previews and equipped skins.
const path = (d: string, fill: string, stroke = '#352c32', width = 1) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const line = (d: string, color: string, width = 1) => path(d, 'none', color, width);
const wrap = (body: string, viewBox = '0 0 100 100') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
export const artDataUrl = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

const details: Record<string, string> = {
  'myths-icarus': 'M23 31L39 49M20 42L37 54M18 57L34 58M77 31L61 49M80 42L63 54M82 57L66 58M45 69L40 86M55 69L60 86',
  'myths-medusa': 'M31 35Q12 12 18 43T30 64M69 35Q88 12 82 43T70 64M39 24Q34 7 27 18M61 24Q66 7 73 18M37 43L42 45M58 45L63 43M50 45L46 54H52M43 67Q50 72 57 67M32 73L40 80M68 73L60 80',
  'myths-minotaur': 'M30 34Q15 12 25 15L40 29L50 25L60 29L75 15Q85 12 70 34L67 55L57 68H43L33 55ZM37 40L44 44M63 40L56 44M43 57H57M45 52V56M55 52V56',
  'myths-fenrir': 'M35 38L39 31L44 39M56 39L61 31L65 38M28 58L38 55L33 65M72 58L62 55L67 65M43 63L50 68L57 63M40 70L44 77L50 73L56 77L60 70M22 78L17 86M78 78L83 86',
  'myths-odyssey': 'M23 63L33 70H67L77 63M34 64V71M45 64V73M56 64V73M67 64V71M48 31Q33 46 30 55H47ZM54 32Q70 45 72 55H54ZM27 72L18 81M38 76L32 85M62 76L68 85M73 72L82 81',
  'myths-valkyrie': 'M35 27L12 18L17 35L30 48M65 27L88 18L83 35L70 48M17 25L30 37M83 25L70 37M20 35L30 43M80 35L70 43M50 32L59 43L50 57L41 43ZM44 65L38 83M56 65L62 83',
  'myths-phoenix': 'M43 40Q24 39 13 22L20 50L38 63M57 40Q76 39 87 22L80 50L62 63M20 33L36 49M80 33L64 49M25 47L39 56M75 47L61 56M43 72Q30 86 40 91M50 74V94M57 72Q70 86 60 91',
  'myths-excalibur': 'M33 78L20 88H80L68 74L57 70M29 86L38 80L45 88M62 80L55 88M47 20H53M47 27H53M47 34H53M30 50L35 56M70 50L65 56M50 47L55 52L50 57L45 52Z',
  'myths-olympus': 'M14 83H86M10 88H90M22 36H78M32 44V74M38 44V74M47 44V74M53 44V74M62 44V74M68 44V74M40 30L50 23L60 30ZM29 47H41M44 47H56M59 47H71M29 72H41M44 72H56M59 72H71',
  'myths-grail': 'M32 29H68M34 44Q50 55 66 44M37 34L42 41L47 34M53 34L58 41L63 34M50 50L56 57L50 64L44 57ZM46 72H54M42 79H58M32 90H68M19 22L14 17M81 22L86 17M50 15V7',
  'nightmare-whisper': 'M25 85V17H75V85M35 28L61 24V78L35 82ZM56 53V58M40 33V43M40 65V74M66 27L69 38L65 45M15 87L30 82M85 87L70 82M46 51L48 52M52 52L54 51',
  'nightmare-mirror': 'M23 18Q50 1 77 18V82Q50 99 23 82ZM32 19L38 26M68 19L62 26M50 28L44 40L54 47L46 61L50 72M54 47L63 42M44 40L38 36M46 61L38 66M42 44L45 45M55 45L58 44M43 57Q50 53 57 57',
  'nightmare-doll': 'M37 30Q30 16 43 12L50 18L58 12Q70 16 63 30M41 34L47 40M47 34L41 40M53 34L59 40M59 34L53 40M42 55L58 56M44 52V59M49 53V60M54 53V60M36 69L43 65L50 71L57 65L64 69M44 75V83M56 75V83',
  'nightmare-hall': 'M8 12L40 38M92 12L60 38M8 92L40 65M92 92L60 65M17 22V77M27 30V71M83 22V77M73 30V71M12 85H88M27 75H73M37 68H63M44 42H56V64H44ZM48 51V62M52 51V62',
  'nightmare-sleepwalker': 'M41 21Q50 13 59 21L57 31H43ZM39 39L33 57L42 62L45 46M61 39L67 57L58 62L55 46M39 62L36 77M61 62L64 77M23 88L33 85M67 85L77 88M46 23H48M52 23H54',
  'nightmare-mouth': 'M18 35Q50 19 82 35M24 51Q50 76 76 51M30 49L33 58L39 54L43 64L49 58L55 65L60 56L67 60L70 49M31 24L35 19M47 22V16M63 24L67 19M38 76L36 84M62 76L64 84',
  'nightmare-eyes': 'M10 41L18 35L27 32L36 36L43 42M57 42L64 36L73 32L82 35L90 41M17 62L19 77M26 67L27 87M36 62L34 73M64 62L66 73M74 67L73 87M83 62L81 77M22 46L25 42M68 46L71 42',
  'nightmare-crow': 'M23 66L36 48L33 65M31 71L42 50L41 72M77 66L64 48L67 65M69 71L58 50L59 72M47 28L56 32L64 29M52 31H53M45 76L41 86M55 76L59 86M14 88H86M18 15V88M82 15V88M18 18Q50 0 82 18',
  'nightmare-puppet': 'M15 10H85M35 10L40 30M65 10L60 30M22 10L24 62M78 10L76 62M40 36L46 42M46 36L40 42M54 36L60 42M60 36L54 42M39 58L44 64L50 61L56 64L61 58M41 71L44 76M59 71L56 76',
  'nightmare-abyss': 'M23 26Q8 50 23 74M77 26Q92 50 77 74M29 19Q50 7 71 19M29 81Q50 93 71 81M31 50Q50 32 69 50Q50 68 31 50ZM46 43L50 39L54 43V57L50 61L46 57ZM12 42L17 46M88 58L83 54',
  'ashes-ember': 'M44 24Q38 40 44 46M37 57Q30 71 47 80M58 54Q67 70 54 77M29 83L21 88L38 92L49 87L60 92L79 88L70 82M37 87L40 90M64 87L60 90',
  'ashes-cinder': 'M24 18L42 33L76 28M42 33L37 55L18 70M37 55L62 82M37 55L63 48L76 28M63 48L55 67L62 82M42 33L49 43L45 53M29 64L35 69M59 33L66 37',
  'ashes-smoke': 'M32 86Q8 66 28 51Q17 31 36 21M68 86Q92 66 72 51Q83 31 64 21M42 42Q46 37 48 44M52 44Q54 37 58 42M45 58Q50 63 55 58M42 73Q32 80 41 90M58 73Q68 80 59 90',
  'ashes-forge': 'M26 50H74L82 40H63V34H37V40H18ZM34 53L38 74M66 53L62 74M43 53V73M57 53V73M32 81H68M29 86H71M46 19H54M46 28H54M21 35L15 28M79 35L85 28',
  'ashes-phoenix': 'M18 33L38 47L27 49M82 33L62 47L73 49M24 54L42 57L31 64M76 54L58 57L69 64M44 33L50 29L57 34L53 38M48 35H49M43 67Q28 84 33 91M57 67Q72 84 67 91M47 71L43 94M53 71L57 94',
  'ashes-charcoal': 'M22 17L78 20L81 78L25 84ZM25 25L33 33L29 43L38 50M75 65L65 62L61 70L53 68M42 43L48 48L43 54L57 58M31 74L39 71M67 29L61 35M18 89L29 91M70 89L83 86',
  'ashes-ruins': 'M20 46H26M20 55H26M20 64H26M38 60H44M38 69H44M56 49H62M56 58H62M56 67H62M74 65H79M74 74H79M10 88L28 85L36 91L55 85L71 91L90 86M25 24Q17 15 27 8M61 30Q73 20 64 10',
  'ashes-volcano': 'M36 47Q45 42 55 30L61 41L54 44L51 54L45 50L41 59M25 72L34 60L37 71M68 64L76 77M49 21Q35 18 40 11Q47 4 52 12Q65 2 69 12Q73 21 60 23M15 86H85M39 82L45 68L52 75',
  'ashes-scorch': 'M27 17L38 27L42 38M71 19L60 31L58 48M82 68L91 78M22 78L13 87M43 67L47 82L43 94M35 56L47 53L50 61L58 48M16 28L25 32M72 84L77 90',
  'ashes-afterglow': 'M17 69L29 57L41 68L59 49L81 70M13 77H87M20 82H80M32 87H68M36 54Q50 42 64 54M39 58H61M43 62H57M50 17V22M23 29L27 33M77 29L73 33',
};

export function collectionArtwork(key: string, silhouette: string): string | undefined {
  if (!details[key]) return undefined;
  const myths = key.startsWith('myths-');
  const nightmare = key.startsWith('nightmare-');
  const [sky, ground, light, metal] = myths
    ? ['#253d59', '#607c8b', '#ffe8ad', '#bc8751']
    : nightmare ? ['#241c3a', '#674665', '#f1b6b2', '#a86a89']
      : ['#382f3b', '#8d4941', '#ffde85', '#e87b42'];
  const particles = Array.from({ length: 24 }, (_, i) => {
    const x = 8 + (i * 37) % 84, y = 9 + (i * 23) % 81;
    return `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? .7 : .35}" fill="${light}" opacity=".65"/>`;
  }).join('');
  const scenery = myths
    ? `<circle cx="50" cy="39" r="28" fill="none" stroke="${light}" opacity=".35"/><circle cx="50" cy="39" r="25" fill="none" stroke="${light}" opacity=".18"/>` + line('M7 81Q14 65 9 47M93 81Q86 65 91 47M10 69L5 61M10 63L16 55M90 69L95 61M90 63L84 55', metal, 1.7)
    : nightmare
      ? `<circle cx="73" cy="23" r="12" fill="#e1a6a5" opacity=".4"/>` + line('M5 75L13 49L9 26M13 49L23 35M10 36L4 30M95 80L87 56L93 32M87 56L78 42M91 40L98 31', '#1a182b', 2.2)
      : line('M0 87L12 74L21 82L33 72L43 88L61 76L74 83L87 70L100 82M9 96L23 88L32 92L45 85M67 94L74 89L87 91', '#ef9a56', .9);
  return wrap(`<defs><linearGradient id="metal" x2=".7" y2="1"><stop stop-color="${light}"/><stop offset=".5" stop-color="${metal}"/><stop offset="1" stop-color="${ground}"/></linearGradient></defs>${scenery}${particles}<g transform="translate(7 6) scale(.86)">${path(silhouette, 'url(#metal)', 'none', 2.5)}${line(silhouette, light, .8)}${line(details[key], 'none', 2.5)}${line(details[key], light, .85)}</g>${line('M6 24V6H24M76 6H94V24M6 76V94H24M76 94H94V76', metal, .7)}`);
}

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