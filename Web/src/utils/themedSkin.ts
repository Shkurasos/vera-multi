import { PACK_ART } from './packArt';
import { artDataUrl, DRAGON_ART } from './collectionArt';

interface Material {
  ink: string;
  accent: string;
  surface: string;
  texture: string;
  radius: string;
  edge: string;
  motion: 'fall' | 'scan' | 'breathe' | 'reveal';
  duration: number;
  staticArt?: boolean;
}

const svg = (body: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">${body}</svg>`)}")`;
const strokes = (path: string, color: string, width = 2) => `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const spray = svg('<g fill="#e383ab" opacity=".6"><ellipse cx="176" cy="50" rx="34" ry="19"/><circle cx="133" cy="29" r="3"/><circle cx="218" cy="69" r="2"/><circle cx="147" cy="78" r="2"/><circle cx="209" cy="21" r="4"/></g><g fill="#77c9b7" opacity=".5"><ellipse cx="40" cy="94" rx="28" ry="12"/><circle cx="78" cy="80" r="3"/><circle cx="16" cy="68" r="2"/></g>' + strokes('M179 61V96M193 62V81', '#e383ab', 3));
// Hand-drawn Dragon Lore-inspired illustration, not the original weapon texture.
const dragonLore = `url("${artDataUrl(DRAGON_ART)}")`;
const graffiti = (color: string, second: string, variant: number) => svg(
  `<g transform="translate(${variant * 3} 0) rotate(-8 120 60)">` +
  strokes('M12 85L37 28L58 32L43 57L65 48L58 83M75 81L89 29L121 30L104 49L118 57L99 83M134 80L140 30L174 31L156 50L175 55L157 82M181 81L207 28L222 79M194 60L216 59', '#101519', 13) +
  strokes('M12 85L37 28L58 32L43 57L65 48L58 83M75 81L89 29L121 30L104 49L118 57L99 83M134 80L140 30L174 31L156 50L175 55L157 82M181 81L207 28L222 79M194 60L216 59', color, 7) +
  strokes('M10 98L228 89M32 85V110M102 86V106M175 83V115M8 32L20 40M215 15L223 25', second, 3) + '</g>');

const BUBBLE_MOTIF_KEYS = new Set([
  'games-plumber', 'games-bonfire', 'corp-pass', 'corp-director',
  'street-spray', 'culture-book', 'culture-theatre', 'culture-cinema',
  'games-racer', 'games-mech', 'corp-terminal', 'corp-vault',
  'street-sticker', 'street-skate', 'culture-ink', 'culture-orchestra',
  'myths-medusa', 'myths-fenrir', 'myths-grail',
  'nightmare-doll', 'nightmare-eyes', 'nightmare-abyss',
  'ashes-ember', 'ashes-volcano', 'ashes-afterglow',
]);

// Each material owns its palette; selected skins also share their pack emblem.
const material = (ink: string, accent: string, surface: string, pattern: string,
  radius: string, edge: string, motion: Material['motion'], duration: number): Material => ({
  ink, accent, surface, texture: svg(pattern), radius, edge, motion, duration,
});

export const THEMED_MATERIALS: Record<string, Material> = {
  'games-racer': { ink: '#f4f8ef', accent: '#cbdf82', surface: '#29342d', texture: svg(strokes('M0 105H240M0 112H240M12 92H40M80 92H108M148 92H176M216 92H240', '#a5b782')), radius: '4px', edge: '1px solid', motion: 'scan', duration: 30 },
  'games-invader': { ink: '#f0fbe8', accent: '#9fd477', surface: '#192623', texture: svg('<g fill="#90bf75"><path d="M168 24h24v8h8v16h-8v8h-24v-8h-8V32h8zM166 56h8v12h-8zm20 0h8v12h-8z"/><path d="M38 90h3v3h-3zM105 20h3v3h-3zM220 96h3v3h-3z"/></g>'), radius: '2px', edge: '2px solid', motion: 'fall', duration: 35 },
  'games-dungeon': { ink: '#fff0db', accent: '#c9a477', surface: '#302d2d', texture: svg(strokes('M156 110V46Q156 16 190 16Q224 16 224 46V110M167 110V48Q167 29 190 29Q213 29 213 48V110M150 110H230M150 62H165M215 62H230M150 85H165M215 85H230', '#aa8864')), radius: '4px', edge: '2px solid', motion: 'breathe', duration: 14 },
  'games-mech': { ink: '#ecf6ff', accent: '#91b7d2', surface: '#26313c', texture: svg(strokes('M12 12H75L91 28M148 108H228V75M12 108V90M228 12V30M180 22H210M194 15V29', '#789bb4')), radius: '2px', edge: '2px solid', motion: 'reveal', duration: 18 },
  'games-crown': { ink: '#faf1ff', accent: '#d2afd8', surface: '#362c40', texture: svg(strokes('M150 98Q120 66 149 32M154 87L137 80M151 69L134 58M154 49L144 34M205 98Q235 66 206 32M201 87L218 80M204 69L221 58M201 49L211 34M161 102H194', '#b599bd')), radius: '4px', edge: '3px double', motion: 'breathe', duration: 16 },
  'corp-terminal': { ink: '#ebf9f3', accent: '#8ecbb0', surface: '#233530', texture: svg(strokes('M16 18H76M16 25H40M180 91H224M180 99H208M16 105H21M29 105H34', '#80ad9c')), radius: '2px', edge: '1px solid', motion: 'reveal', duration: 22 },
  'corp-briefcase': { ink: '#f8eddd', accent: '#c3a182', surface: '#3b302c', texture: svg(strokes('M0 8H240M0 112H240', '#a3836b') + strokes('M5 15H235M5 105H235', '#816958', 1)), radius: '4px', edge: '1px solid', motion: 'breathe', duration: 20, staticArt: true },
  'corp-vault': { ink: '#eaf1f5', accent: '#a1b6c1', surface: '#2d363d', texture: svg(strokes('M14 14H226V106H14ZM21 21H219V99H21M31 30H35M205 30H209M31 90H35M205 90H209', '#788c9b')), radius: '2px', edge: '3px double', motion: 'breathe', duration: 18, staticArt: true },
  'corp-satellite': { ink: '#edf4ff', accent: '#94badd', surface: '#1f2d42', texture: svg(strokes('M128 100Q163 15 225 29M140 110Q185 35 238 52M173 43L177 43M199 80H203M215 17H219', '#7fa0c9') + '<circle cx="180" cy="62" r="21" fill="none" stroke="#a5bad8"/>'), radius: '4px', edge: '1px solid', motion: 'reveal', duration: 18 },
  'corp-citadel': { ink: '#f3eee3', accent: '#bbae8e', surface: '#292e34', texture: svg(strokes('M130 112V53L153 33V112M157 112V34L181 12L204 34V112M208 112V54L229 34V112M125 112H235', '#9c957e')), radius: '2px', edge: '3px double', motion: 'breathe', duration: 20 },
  'street-sticker': { ink: '#303335', accent: '#687e88', surface: '#e6e3d9', texture: svg('<path fill="#bf9567" d="M12 15l47-5 2 12-47 5z"/><path fill="#829b9d" d="M178 101l42-9 3 11-42 9z"/>'), radius: '3px', edge: '1px solid', motion: 'reveal', duration: 20, staticArt: true },
  'street-poster': { ink: '#f7ece1', accent: '#d2ac88', surface: '#49372f', texture: svg('<path fill="#c9a589" d="M150 0h90v18l-12-7-16 13-14-9-19 5-13-12-16 9zM0 105l20 6 14-8 19 10 18-8 12 15H0z"/>'), radius: '2px', edge: '1px solid', motion: 'reveal', duration: 25, staticArt: true },
  'street-skate': { ink: '#f6f1e8', accent: '#d0b783', surface: '#343637', texture: svg(strokes('M132 98L220 70M140 105L228 77M14 22L41 17M20 30L55 23', '#ab9977')), radius: '3px', edge: '2px solid', motion: 'scan', duration: 38 },
  'street-neon': { ink: '#faedf8', accent: '#df9fc9', surface: '#30253b', texture: svg(strokes('M149 24H220V94H149M160 36H208M160 82H208', '#d489be', 3) + strokes('M154 29H225V99', '#7eafb8')), radius: '4px', edge: '1px solid', motion: 'breathe', duration: 16 },
  'street-crown': { ink: '#f9efd8', accent: '#d4bb78', surface: '#34312b', texture: svg(strokes('M145 90L158 44L179 66L199 30L208 66L229 49L219 90ZM151 99L226 94M167 100V111M207 99V107', '#c0a460', 4)), radius: '2px', edge: '2px solid', motion: 'reveal', duration: 18 },
  'culture-ink': { ink: '#303b47', accent: '#566e86', surface: '#e5e9e6', texture: svg(strokes('M16 95Q40 86 62 94T112 92M16 103H69', '#627b91', 1)), radius: '2px', edge: '1px solid', motion: 'reveal', duration: 24, staticArt: true },
  'culture-gallery': { ink: '#373d40', accent: '#7c7970', surface: '#efece4', texture: svg(strokes('M154 20H222V100H154ZM161 27H215V93H161M174 72L184 43L205 79', '#a29784', 2)), radius: '2px', edge: '1px solid', motion: 'breathe', duration: 22, staticArt: true },
  'culture-ballet': { ink: '#f7edf3', accent: '#cfaac2', surface: '#3b2d3c', texture: svg(strokes('M150 112Q225 72 176 19Q154 0 181 5M176 19Q221 28 210 55Q196 76 226 88', '#b797ae')), radius: '4px', edge: '1px solid', motion: 'breathe', duration: 18 },
  'culture-orchestra': { ink: '#fff2e4', accent: '#c8aa87', surface: '#3e2f2b', texture: svg(strokes('M0 92H240M0 98H240M0 104H240M0 110H240M0 116H240M181 97V66L199 61V93', '#9e856b', 1)), radius: '3px', edge: '2px solid', motion: 'reveal', duration: 22 },
  'culture-observatory': { ink: '#eef4ff', accent: '#acbbda', surface: '#252d43', texture: svg(strokes('M137 83L158 39L195 63L221 20M158 39L184 13M137 83L210 106', '#8091b4', 1) + '<g fill="#bdc7df"><circle cx="137" cy="83" r="3"/><circle cx="158" cy="39" r="3"/><circle cx="195" cy="63" r="3"/><circle cx="221" cy="20" r="3"/><circle cx="184" cy="13" r="2"/><circle cx="210" cy="106" r="2"/></g>'), radius: '4px', edge: '3px double', motion: 'breathe', duration: 24 },
  'games-blocks': { ink: '#eafcff', accent: '#50e5db', surface: '#121c27', texture: svg('<path fill="#50e5db" d="M0 80h18v18H0zm20 0h18v18H20zm0 20h18v18H0zm40 0h18v18H40z"/><path fill="#fa687c" d="M100 20h18v18h-18zm20 0h18v18h-18zm0 20h18v18h-18zm20 0h18v18h-18z"/><path fill="#eed45b" d="M200 70h18v18h-18zm20 0h18v18h-18zm-20 20h18v18h-18zm20 0h18v18h-18z"/>'), radius: '2px', edge: '3px solid', motion: 'fall', duration: 16 },
  'games-plumber': { ink: '#f7fff5', accent: '#79de67', surface: '#193c38', texture: svg('<path fill="#d2724e" d="M0 92h240v28H0z"/>' + strokes('M0 106H240M30 92V106M90 92V106M150 92V106M210 92V106M60 106V120M120 106V120M180 106V120', '#482d34') + '<path fill="#75cf68" d="M175 92V52h-5V40h40v12h-5v40z"/><path fill="#f1d878" d="M45 30h20v20H45zM75 30h20v20H75z"/>'), radius: '8px 8px 2px 2px', edge: '3px solid', motion: 'scan', duration: 28 },
  'games-portal': { ink: '#eafaff', accent: '#5edbff', surface: '#16242b', texture: svg('<g fill="none" stroke-width="5"><ellipse cx="42" cy="60" rx="24" ry="48" stroke="#49cfff"/><ellipse cx="190" cy="60" rx="24" ry="48" stroke="#ff994e"/></g>' + strokes('M75 60H155M140 45L155 60L140 75', '#91b6c1')), radius: '28px 6px 28px 6px', edge: '2px solid', motion: 'breathe', duration: 5 },
  'games-bonfire': { ink: '#fff2df', accent: '#ff995b', surface: '#281e22', texture: svg('<path fill="#b44932" d="M145 110Q100 80 140 45L135 75Q165 45 160 10Q218 77 190 110Z"/><path fill="#ffba62" d="M155 110Q137 86 165 66Q163 84 180 91L174 110Z"/>' + strokes('M20 18V25M75 68V76M214 30V35M112 20V25M182 6V12', '#ffcf86', 3)), radius: '4px 18px 4px 4px', edge: '2px solid', motion: 'fall', duration: 9 },
  'games-dragon': { ink: '#fff5dd', accent: '#b89a55', surface: '#302c22', texture: dragonLore, radius: '4px', edge: '1px solid', motion: 'breathe', duration: 7, staticArt: true },
  'corp-pass': { ink: '#20323c', accent: '#358896', surface: '#e4edef', texture: svg(strokes('M14 0V120M20 0V120M26 0V120M36 0V120M40 0V120M49 0V120M57 0V120', '#63858c', 3) + '<path fill="#358896" d="M180 12h48v16h-48zM180 36h30v5h-30zM180 48h42v5h-42z"/>'), radius: '3px', edge: '1px solid', motion: 'scan', duration: 30 },
  'corp-tower': { ink: '#edfaff', accent: '#7ac8de', surface: '#203c48', texture: 'repeating-linear-gradient(90deg,transparent 0 26px,#9cd6e238 27px 29px), repeating-linear-gradient(0deg,transparent 0 18px,#8fbfcd40 19px 21px), linear-gradient(120deg,transparent 20%,#c8eafa55 45%,transparent 65%)', radius: '0px 12px 0px 0px', edge: '2px solid', motion: 'scan', duration: 18 },
  'corp-network': { ink: '#ddfff2', accent: '#51dba3', surface: '#112d2c', texture: svg(strokes('M0 20H65L85 40H150V90H240M0 95H45V65H110L140 35H205V0M25 0V40H55M180 120V70H225V25H240', '#51dba3') + '<g fill="#c7ffe6"><circle cx="85" cy="40" r="4"/><circle cx="45" cy="65" r="4"/><circle cx="205" cy="35" r="4"/></g>'), radius: '2px 14px 2px 2px', edge: '1px solid', motion: 'reveal', duration: 6 },
  'corp-contract': { ink: '#f6e9eb', accent: '#d88898', surface: '#261f29', texture: svg(strokes('M10 20H155M10 35H200M10 50H140M10 65H190M10 80H120', '#887580') + '<path fill="#121017" d="M30 29h100v11H30zM80 59h100v11H80z"/>' + strokes('M158 92L172 71L178 96L195 76L214 86', '#edb3bd', 3)), radius: '1px', edge: '3px double', motion: 'reveal', duration: 12 },
  'corp-director': { ink: '#eef9f7', accent: '#8ed8c6', surface: '#193330', texture: 'repeating-linear-gradient(90deg,transparent 0 38px,#90bdb133 39px 40px), repeating-linear-gradient(135deg,transparent 0 70px,#c8e7dd24 71px 73px,transparent 74px 110px)', radius: '6px', edge: '4px double', motion: 'breathe', duration: 9 },
  'street-tag': { ink: '#f5f7fa', accent: '#e7e95c', surface: '#303238', texture: graffiti('#e7e95c', '#faf9d0', 0), radius: '3px 12px 5px 2px', edge: '2px dashed', motion: 'reveal', duration: 11 },
  'street-spray': { ink: '#f4f5f5', accent: '#b49aa6', surface: '#343638', texture: spray, radius: '4px', edge: '1px solid', motion: 'breathe', duration: 8, staticArt: true },
  'street-stencil': { ink: '#202a29', accent: '#357d72', surface: '#dce4d9', texture: svg('<path fill="#337b70" d="M40 10l14 30 34 4-25 23 7 34-30-16-30 16 7-34L0 44l26-4zM170 10l14 30 34 4-25 23 7 34-30-16-30 16 7-34-25-23 34-4z"/><path fill="#dce4d9" d="M0 52h240v7H0z"/>'), radius: '0px', edge: '3px dashed', motion: 'scan', duration: 35 },
  'street-wildstyle': { ink: '#f5f8ff', accent: '#8abaff', surface: '#242440', texture: graffiti('#85aeff', '#ff9b61', 3), radius: '2px 20px 2px 12px', edge: '3px solid', motion: 'scan', duration: 22 },
  'street-mural': { ink: '#fff7ed', accent: '#ffad77', surface: '#382c33', texture: svg('<path fill="#55c8bd" d="M0 120V55l35-25 45 50 30-40 50 80z"/><path fill="#ee7798" d="M120 120V45l35-35 30 50 35-25 20 85z"/>') + ', ' + graffiti('#ffcb80', '#e58aad', 4), radius: '12px 4px 4px 18px', edge: '3px solid', motion: 'reveal', duration: 10 },
  'culture-book': { ink: '#32353c', accent: '#557e98', surface: '#edf0e8', texture: 'repeating-linear-gradient(0deg,transparent 0 19px,#57748b33 20px 21px), linear-gradient(90deg,transparent 0 20px,#be777955 21px 22px,transparent 23px)', radius: '2px 8px 8px 2px', edge: '1px solid', motion: 'reveal', duration: 16 },
  'culture-jazz': { ink: '#f7ecef', accent: '#e99dad', surface: '#302335', texture: svg(strokes('M0 35H240M0 45H240M0 55H240M0 65H240M0 75H240', '#987d9f') + '<g fill="#efa7b9"><ellipse cx="60" cy="65" rx="9" ry="6"/><ellipse cx="160" cy="45" rx="9" ry="6"/></g>' + strokes('M68 65V20L88 27M168 45V5L188 12', '#efa7b9', 3)), radius: '18px 4px 18px 4px', edge: '2px solid', motion: 'scan', duration: 24 },
  'culture-theatre': { ink: '#ffeef1', accent: '#f3a4ad', surface: '#4b1f31', texture: 'repeating-linear-gradient(90deg,#260c2022 0 10px,#f3a4ad44 14px,#260c2033 23px 32px), linear-gradient(0deg,#190d2780,transparent)', radius: '16px 16px 3px 3px', edge: '3px double', motion: 'breathe', duration: 8 },
  'culture-cinema': { ink: '#eef6ff', accent: '#b6cbe3', surface: '#252b34', texture: svg('<path fill="#adc2d4" d="M0 0h240v16H0zm0 104h240v16H0z"/><path fill="#252b34" d="M12 3h18v10H12zm40 0h18v10H52zm40 0h18v10H92zm40 0h18v10h-18zm40 0h18v10h-18zm40 0h18v10h-18zM12 107h18v10H12zm40 0h18v10H52zm40 0h18v10H92zm40 0h18v10h-18zm40 0h18v10h-18zm40 0h18v10h-18z"/>' + strokes('M80 20V100M160 20V100', '#8193a5')), radius: '2px', edge: '2px solid', motion: 'scan', duration: 20 },
  'culture-heritage': { ink: '#effcfb', accent: '#8eddd2', surface: '#234341', texture: svg(strokes('M0 15H240M0 105H240M10 15V45H40V30H25M60 15V45H90V30H75M110 15V45H140V30H125M160 15V45H190V30H175M210 15V45H240M10 105V75H40V90H25M60 105V75H90V90H75M110 105V75H140V90H125M160 105V75H190V90H175M210 105V75H240', '#8eddd2', 3)), radius: '4px 4px 14px 14px', edge: '4px double', motion: 'breathe', duration: 12 },
  'myths-icarus': material('#fff5cf', '#d7a84a', '#3b2b1b', strokes('M0 95L55 32L110 95M130 95L185 32L240 95M120 18V108', '#bd8d36', 3), '4px 18px 4px 4px', '2px solid', 'breathe', 12),
  'myths-medusa': material('#efffdc', '#9fca68', '#263522', '<circle cx="178" cy="48" r="32" fill="#719343" opacity=".25"/>' + strokes('M145 92Q175 48 205 92M160 52H170M184 52H194', '#9fca68', 3), '14px 3px 14px 3px', '2px solid', 'fall', 18),
  'myths-minotaur': material('#ffe9c7', '#b97845', '#38261f', strokes('M12 20H228V100H12ZM32 40H208V80H32ZM62 40V80M118 40V80M174 40V80', '#b97845', 3), '4px', '3px solid', 'scan', 22),
  'myths-fenrir': material('#f2eaff', '#b38be8', '#292237', '<circle cx="190" cy="35" r="22" fill="#b38be8" opacity=".2"/>' + strokes('M0 108L42 72L78 108M160 108L198 60L240 108', '#b38be8', 4), '6px 18px 6px 18px', '2px solid', 'breathe', 8),
  'myths-odyssey': material('#e5faff', '#55c5d8', '#173845', strokes('M0 82Q30 45 60 82T120 82T180 82T240 82M20 40H220M120 18V40', '#55c5d8', 3), '4px', '2px solid', 'scan', 26),
  'myths-valkyrie': material('#fff2d6', '#e6bf65', '#34291f', strokes('M120 20L55 72L100 63L120 105L140 63L185 72Z', '#e6bf65', 3), '50%', '3px double', 'breathe', 10),
  'myths-phoenix': material('#fff0dc', '#f07842', '#3b211e', '<path fill="#d84d38" opacity=".35" d="M120 110Q60 75 120 12Q180 75 120 110Z"/>' + strokes('M120 15V106M72 70L120 92L168 70', '#ffaf4d', 3), '18px 4px 18px 4px', '2px solid', 'fall', 9),
  'myths-excalibur': material('#e9f5ff', '#86c9ef', '#203246', strokes('M120 8V112M95 22L120 45L145 22M72 82H168', '#86c9ef', 3), '4px', '2px solid', 'reveal', 16),
  'myths-olympus': material('#fff7dc', '#f0cf77', '#3a3023', strokes('M20 105H220M36 25V105M84 25V105M156 25V105M204 25V105M20 25H220L120 5Z', '#d4aa52', 3), '4px', '3px double', 'scan', 24),
  'myths-grail': material('#fff1bc', '#e3bd55', '#35291d', '<circle cx="120" cy="54" r="34" fill="#e3bd55" opacity=".2"/>' + strokes('M82 35H158M92 35V65Q120 88 148 65V35M120 65V108M92 108H148', '#e3bd55', 3), '8px 8px 18px 18px', '2px solid', 'breathe', 11),
  'nightmare-whisper': material('#f9dce5', '#d96b8a', '#301d2b', strokes('M30 105V22H210V105M60 42H180M120 42V92M95 68H145', '#d96b8a', 3), '2px 14px 2px 14px', '2px solid', 'reveal', 19),
  'nightmare-mirror': material('#e9f6ff', '#86c4e8', '#172834', strokes('M15 15L225 105M225 15L15 105M120 10V110M10 60H230', '#86c4e8', 2), '2px', '1px solid', 'scan', 20),
  'nightmare-doll': material('#ffe8ee', '#e58ba1', '#3b2530', '<circle cx="180" cy="48" r="32" fill="#e58ba1" opacity=".2"/>' + strokes('M150 98Q180 55 210 98M166 45H174M186 45H194M170 65Q180 72 190 65', '#e58ba1', 3), '18px 4px 18px 4px', '2px solid', 'breathe', 7),
  'nightmare-hall': material('#e2e8ff', '#847ed1', '#22243d', strokes('M0 20H240M0 100H240M35 20V100M205 20V100M72 20V100M168 20V100M110 20V100', '#625eaa', 3), '3px', '2px solid', 'reveal', 15),
  'nightmare-sleepwalker': material('#e7edff', '#9a9ee8', '#20233d', '<circle cx="190" cy="30" r="24" fill="#9a9ee8" opacity=".3"/>' + strokes('M20 100L70 48L120 100M120 100L170 48L220 100M70 48H170', '#9a9ee8', 3), '24px 4px', '2px solid', 'breathe', 13),
  'nightmare-mouth': material('#ffe4e8', '#f06b83', '#351a27', '<path fill="#f06b83" opacity=".25" d="M20 65Q120 10 220 65Q120 115 20 65Z"/>' + strokes('M30 65L55 82L80 65L105 82L130 65L155 82L180 65L205 82', '#f06b83', 3), '20px', '2px solid', 'fall', 12),
  'nightmare-eyes': material('#eafff9', '#63d7c8', '#142e31', '<ellipse cx="72" cy="60" rx="28" ry="40" fill="#63d7c8" opacity=".18"/><ellipse cx="168" cy="60" rx="28" ry="40" fill="#63d7c8" opacity=".18"/>' + strokes('M72 35V85M168 35V85', '#63d7c8', 3), '50%', '2px solid', 'breathe', 6),
  'nightmare-crow': material('#e7e1ff', '#9c84c9', '#211d32', strokes('M25 100L85 20L120 90L155 20L215 100M45 76H195', '#9c84c9', 4), '4px 20px 4px 20px', '2px solid', 'fall', 17),
  'nightmare-puppet': material('#fff0d9', '#ce9276', '#352523', strokes('M20 18L120 58L220 18M120 58V110M80 43V92M160 43V92', '#ce9276', 3), '4px', '2px dashed', 'scan', 23),
  'nightmare-abyss': material('#f1eaff', '#a36ee8', '#1b1530', '<circle cx="120" cy="60" r="45" fill="#a36ee8" opacity=".18"/>' + strokes('M120 15C65 15 65 105 120 105C175 105 175 15 120 15M120 38V82M98 60H142', '#a36ee8', 3), '50%', '3px double', 'breathe', 10),
  'ashes-ember': material('#fff2d2', '#f09255', '#40251d', '<path fill="#d85d38" opacity=".25" d="M120 110Q60 70 120 10Q180 70 120 110Z"/>' + strokes('M120 20V105M80 70L120 88L160 70', '#f09255', 3), '4px 18px 4px 18px', '2px solid', 'fall', 8),
  'ashes-cinder': material('#ede5dd', '#a99d98', '#302d2e', strokes('M15 22L225 42M15 55L225 75M15 88L225 108M55 12L35 108M145 12L125 108', '#a99d98', 3), '3px', '2px solid', 'scan', 28),
  'ashes-smoke': material('#f2edff', '#a995cc', '#282535', strokes('M80 110Q20 75 80 42T160 10M160 110Q220 75 160 42T80 10', '#a995cc', 3), '18px 4px 18px 4px', '2px solid', 'breathe', 14),
  'ashes-forge': material('#fff0d0', '#d77b45', '#3a2922', strokes('M20 105H220M55 25V105M185 25V105M55 25H185M90 25V70H150V25', '#d77b45', 3), '4px', '3px double', 'scan', 21),
  'ashes-phoenix': material('#fff0cf', '#e56e3f', '#3b211b', '<path fill="#d94f32" opacity=".25" d="M120 110Q55 70 120 8Q185 70 120 110Z"/>' + strokes('M120 12V108M65 55L120 85L175 55', '#ffb04e', 3), '18px 4px', '2px solid', 'fall', 9),
  'ashes-charcoal': material('#e8e5e1', '#8c8581', '#2b2929', strokes('M20 18H220V102H20ZM60 38H180V82H60ZM100 52H140V68H100', '#8c8581', 3), '2px', '2px solid', 'reveal', 18),
  'ashes-ruins': material('#f4e3d4', '#bd876c', '#382b2a', strokes('M0 105H240M20 105V55L55 28V105M75 105V42L110 18V105M135 105V35L170 54V105M195 105V60L230 75V105', '#bd876c', 3), '4px', '2px solid', 'scan', 25),
  'ashes-volcano': material('#fff0d2', '#ef7040', '#42251e', '<path fill="#d74c31" opacity=".3" d="M25 105L95 35L120 58L145 20L215 105Z"/>' + strokes('M120 18V105M80 70L120 84L160 70', '#ef7040', 3), '4px 16px', '2px solid', 'fall', 7),
  'ashes-scorch': material('#ffe4d9', '#df664c', '#3e2423', strokes('M15 25L80 55L55 105M225 25L160 55L185 105M80 55H160M120 15V105', '#df664c', 3), '3px 14px 3px 14px', '2px solid', 'reveal', 16),
  'ashes-afterglow': material('#fff4c9', '#e9ad52', '#3a2b1d', '<circle cx="120" cy="60" r="45" fill="#e9ad52" opacity=".2"/>' + strokes('M120 15A45 45 0 1 0 120 105A45 45 0 1 0 120 15M120 40V80M100 60H140', '#e9ad52', 3), '50%', '3px double', 'breathe', 11),
};

// Collection finishes sit below the original transparent illustrations.
function collectionFinish(key: string, m: Material): Record<string, string> | undefined {
  if (key.startsWith('myths-')) return {
    background: `linear-gradient(115deg, ${m.accent}28, transparent 32%, #ffffff0a 49%, transparent 52%), repeating-linear-gradient(0deg, transparent 0 3px, ${m.accent}08 3px 4px), linear-gradient(145deg, ${m.surface}, #14161c)`,
    boxShadow: `inset 0 1px 0 ${m.accent}80, inset 0 0 0 3px #00000030, inset 0 -2px 0 ${m.accent}30, 0 6px 18px #00000035`,
  };
  if (key.startsWith('nightmare-')) return {
    background: `linear-gradient(125deg, transparent 25%, ${m.accent}18 26%, transparent 27% 72%, ${m.accent}12 73%, transparent 74%), radial-gradient(ellipse at 100% 0%, ${m.accent}30, transparent 65%), linear-gradient(160deg, ${m.surface}, #0e101b)`,
    boxShadow: `inset 0 1px 0 ${m.accent}55, inset 0 -10px 20px #00000040, 3px 4px 0 #090b1240, 0 0 16px ${m.accent}12`,
  };
  if (key.startsWith('ashes-')) return {
    background: `linear-gradient(155deg, transparent 70%, ${m.accent}28 71%, transparent 73%), radial-gradient(ellipse at 20% 100%, ${m.accent}30, transparent 55%), repeating-linear-gradient(120deg, transparent 0 18px, #ffffff04 19px 20px), linear-gradient(145deg, ${m.surface}, #17171b)`,
    boxShadow: `inset 0 1px 0 #ffffff18, inset 0 -2px 0 ${m.accent}88, inset 3px 0 0 ${m.accent}25, 0 6px 16px #00000040`,
  };
  return undefined;
}

export function themedSkin(key: string, part: 'ring' | 'selfcard' | 'bubble'): Record<string, any> | undefined {
  const m = THEMED_MATERIALS[key];
  if (!m) return undefined;
  const finish = part === 'selfcard' ? undefined : collectionFinish(key, m);
  const art = part !== 'bubble' || BUBBLE_MOTIF_KEYS.has(key) ? PACK_ART[`pack-${key}`] : undefined;
  const motif = art ? `url("${artDataUrl(art.illustration ?? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${strokes(art.path, m.accent, 3)}</svg>`)}")` : undefined;
  const emblem = { content: '""', pointerEvents: 'none', backgroundImage: motif,
    backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' };
  const frames = m.motion === 'scan' ? { from: { backgroundPosition: '0 0' }, to: { backgroundPosition: '240px 0' } }
    : m.motion === 'fall' ? { from: { backgroundPosition: '0 0' }, to: { backgroundPosition: '0 120px' } }
    : m.motion === 'breathe' ? { '0%,100%': { opacity: 0.18 }, '50%': { opacity: 0.35 } }
    : { '0%,100%': { opacity: 0.3 }, '50%': { opacity: 0.12 } };
  const animation = `veraMaterial-${key}`;
  const decoration = { content: '""', position: 'absolute', pointerEvents: 'none', borderRadius: 'inherit',
    backgroundImage: m.texture, backgroundSize: m.staticArt ? 'contain' : '240px 120px', opacity: m.staticArt ? 0.38 : 0.09,
    ...(m.staticArt ? { backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' } : {}),
    animation: m.staticArt ? 'none' : `${animation} ${m.duration}s ${m.motion === 'scan' || m.motion === 'fall' ? 'linear' : 'ease-in-out'} infinite` };
  const ringEdge = m.edge === '1px solid' ? '2px solid' : m.edge;
  const base = { position: 'relative', isolation: 'isolate', letterSpacing: 0,
    border: finish ? `${m.edge} ${m.accent}99` : `1px solid ${m.accent}66`, ...(part === 'selfcard' ? { borderRadius: '10px' } : {}),
    [`@keyframes ${animation}`]: frames,
    '@media (prefers-reduced-motion: reduce)': { '&::before, &::after': { animation: 'none' } } };
  if (part === 'ring') return { ...base, overflow: 'visible',
    border: `${ringEdge} ${m.accent}`,
    outline: `1px solid ${m.accent}66`,
    outlineOffset: '2px',
    boxShadow: `0 0 0 2px ${m.surface}, 0 0 0 4px ${m.accent}88, 0 0 12px ${m.accent}66, 0 6px 18px #00000055`,
    ...(motif ? { '&::before': { ...emblem, position: 'absolute', width: '52%', height: '52%',
      left: '52%', top: '52%', zIndex: 2, filter: 'drop-shadow(0 1px 2px #000)' } } : {}),
    '&::after': { ...decoration, inset: '-7px', padding: '5px',
      backgroundColor: m.accent, opacity: 0.6, zIndex: 1,
      maskImage: 'linear-gradient(#fff 0 0), linear-gradient(#fff 0 0)',
      maskClip: 'content-box, border-box', maskComposite: 'exclude',
      WebkitMaskComposite: 'xor' } };
  return { ...base,
    background: `radial-gradient(ellipse at 100% 0%, ${m.accent}38, transparent 65%), ${m.surface}`,
    color: m.ink, borderRadius: part === 'bubble' ? '18px 18px 6px 18px' : '10px',
    boxShadow: `inset 0 1px 0 ${m.accent}44, inset 0 -1px 0 #00000033, 0 5px 16px #00000026`,
    ...(finish ? { ...finish, borderRadius: m.radius === '50%' ? '22px 22px 10px 10px' : m.radius } : {}),
    '&::before': { ...decoration, inset: 0, zIndex: -1 },
    ...(motif ? { '&::after': part === 'bubble'
      ? { ...emblem, position: 'absolute', inset: 0, borderRadius: 'inherit', zIndex: -1,
        backgroundPosition: 'right 6px bottom 2px', backgroundSize: '48px 48px', opacity: 0.22 }
      : { ...emblem, flexShrink: 0, width: 20, height: 20, marginLeft: '4px' } } : {}),
    ...(part === 'selfcard' ? { display: 'inline-flex', alignItems: 'center', px: 1, py: 0.5, fontSize: 11, lineHeight: 1.4,
      minWidth: 30, backgroundSize: '120px 60px' } : {}) };
}