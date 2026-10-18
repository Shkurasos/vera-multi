/**
 * Игровая логика «Морского боя» (одиночная игра против ИИ).
 *
 * Поле 10×10, флот классический: 1×4, 2×3, 3×2, 4×1 (10 кораблей, 20 палуб).
 * Корабли не соприкасаются даже по диагонали. Игрок стреляет по чужому полю,
 * ИИ — по полю игрока. ИИ работает в двух режимах: «охота» (случайный поиск)
 * и «догонялки» (после попадания добивает сегменты корабля).
 *
 * Всё здесь — чистые функции без React и DOM, чтобы логику можно было
 * гонять тестами и переиспользовать.
 */

export const BOARD = 10;
/** Классический флот: 4-палубник, два 3-палубных, три 2-палубных, четыре однопалубных. */
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

export type Cell = [number, number]; // [row, col]

export interface Ship {
  cells: Cell[];
  sunk: boolean;
}

export interface GameState {
  playerShips: Ship[];
  enemyShips: Ship[];
  /** Выстрелы игрока по вражескому полю: «r,c» → 'miss'|'hit'|'sunk'. */
  playerShots: Map<string, 'miss' | 'hit' | 'sunk'>;
  /** Выстрелы ИИ по полю игрока. */
  enemyShots: Map<string, 'miss' | 'hit' | 'sunk'>;
  turn: 'player' | 'enemy';
  over: boolean;
  winner: 'player' | 'enemy' | null;
  shotsByPlayer: number;
  startedAt: number;
}

export const key = (r: number, c: number) => `${r},${c}`;
export const inBounds = (r: number, c: number) => r >= 0 && r < BOARD && c >= 0 && c < BOARD;

/** Все 8 соседей клетки (для проверки соприкосновения кораблей). */
function neighbors8(r: number, c: number): Cell[] {
  const out: Cell[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) out.push([nr, nc]);
    }
  return out;
}

/** Клетки, куда нельзя ставить корабль: занятые + соседи занятых. */
function blockedCells(ships: Ship[]): Set<string> {
  const s = new Set<string>();
  for (const ship of ships)
    for (const [r, c] of ship.cells) {
      s.add(key(r, c));
      for (const [nr, nc] of neighbors8(r, c)) s.add(key(nr, nc));
    }
  return s;
}

/** Расставить один корабль заданной длины. Возвращает null, если места нет. */
function placeOne(ships: Ship[], size: number): Ship | null {
  const blocked = blockedCells(ships);
  for (let attempt = 0; attempt < 200; attempt++) {
    const horizontal = Math.random() < 0.5;
    const r = Math.floor(Math.random() * BOARD);
    const c = Math.floor(Math.random() * BOARD);
    const cells: Cell[] = [];
    for (let i = 0; i < size; i++) {
      const rr = horizontal ? r : r + i;
      const cc = horizontal ? c + i : c;
      if (!inBounds(rr, cc) || blocked.has(key(rr, cc))) { cells.length = 0; break; }
      cells.push([rr, cc]);
    }
    if (cells.length === size) return { cells, sunk: false };
  }
  return null;
}

/** Случайный флот из FLEET. Если расставить не удалось — перебираем с начала. */
export function randomFleet(): Ship[] {
  for (let restart = 0; restart < 50; restart++) {
    const ships: Ship[] = [];
    let ok = true;
    for (const size of FLEET) {
      const ship = placeOne(ships, size);
      if (!ship) { ok = false; break; }
      ships.push(ship);
    }
    if (ok && ships.length === FLEET.length) return ships;
  }
  // Гарантированный фолбэк: раскладка змейкой по чётным строкам.
  const ships: Ship[] = [];
  let placed = 0;
  outer: for (let r = 0; r < BOARD; r += 2)
    for (let c = 0; c <= BOARD - FLEET[0]; c++) {
      if (placed >= FLEET.length) break outer;
      const size = FLEET[placed];
      const cells: Cell[] = [];
      for (let i = 0; i < size; i++) cells.push([r, c + i]);
      ships.push({ cells, sunk: false });
      placed++;
    }
  return ships;
}

/** Разложить корабли по булеву полю (для отрисовки). */
export function shipsToBoard(ships: Ship[]): boolean[][] {
  const board: boolean[][] = Array.from({ length: BOARD }, () => Array(BOARD).fill(false));
  for (const ship of ships) for (const [r, c] of ship.cells) board[r][c] = true;
  return board;
}

/** Найти корабль, содержащий клетку. */
export function shipAt(ships: Ship[], r: number, c: number): Ship | null {
  for (const ship of ships) if (ship.cells.some(([rr, cc]) => rr === r && cc === c)) return ship;
  return null;
}

export function allSunk(ships: Ship[]): boolean {
  return ships.every((s) => s.sunk);
}

export function newGame(now: number = Date.now()): GameState {
  return {
    playerShips: randomFleet(),
    enemyShips: randomFleet(),
    playerShots: new Map(),
    enemyShots: new Map(),
    turn: 'player',
    over: false,
    winner: null,
    shotsByPlayer: 0,
    startedAt: now,
  };
}

/** Выстрел игрока по вражескому полю. Возвращает исход или null (некорректный ход). */
export function playerFire(state: GameState, r: number, c: number): 'miss' | 'hit' | 'sunk' | null {
  if (state.over || state.turn !== 'player') return null;
  const k = key(r, c);
  if (state.playerShots.has(k)) return null;
  const ship = shipAt(state.enemyShips, r, c);
  let outcome: 'miss' | 'hit' | 'sunk';
  if (!ship) {
    outcome = 'miss';
  } else {
    const hitSet = new Set(state.playerShots.keys());
    hitSet.add(k);
    ship.sunk = ship.cells.every(([rr, cc]) => hitSet.has(key(rr, cc)));
    outcome = ship.sunk ? 'sunk' : 'hit';
    if (ship.sunk) {
      for (const [rr, cc] of ship.cells) state.playerShots.set(key(rr, cc), 'sunk');
    }
  }
  state.playerShots.set(k, outcome);
  state.shotsByPlayer++;
  if (allSunk(state.enemyShips)) {
    state.over = true; state.winner = 'player'; state.turn = 'player';
    return outcome;
  }
  // Промах — ход ИИ; попадание/потопление — стреляем снова.
  state.turn = outcome === 'miss' ? 'enemy' : 'player';
  return outcome;
}

/** Соседние клетки для режима «догонялки» ИИ. */
function targetsAround(r: number, c: number): Cell[] {
  const out: Cell[] = [];
  for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) out.push([nr, nc]);
  }
  return out;
}

/**
 * Ход ИИ. Стратегия: если есть «раненые» корабли (недопотопленные), бьём
 * вокруг них; иначе — случайная непробитая клетка с шахматным приоритетом.
 * Возвращает исход или null, если ходить некуда.
 */
export function enemyFire(state: GameState): { r: number; c: number; outcome: 'miss' | 'hit' | 'sunk' } | null {
  if (state.over || state.turn !== 'enemy') return null;
  const damaged = state.playerShips.filter((s) => !s.sunk && s.cells.some(([rr, cc]) => state.enemyShots.has(key(rr, cc))));
  let candidates: Cell[] = [];
  for (const ship of damaged)
    for (const [rr, cc] of ship.cells)
      for (const t of targetsAround(rr, cc))
        if (!state.enemyShots.has(key(t[0], t[1]))) candidates.push(t);
  if (!candidates.length) {
    for (let r = 0; r < BOARD; r++)
      for (let c = 0; c < BOARD; c++)
        if ((r + c) % 2 === 0 && !state.enemyShots.has(key(r, c))) candidates.push([r, c]);
  }
  if (!candidates.length) {
    for (let r = 0; r < BOARD; r++)
      for (let c = 0; c < BOARD; c++)
        if (!state.enemyShots.has(key(r, c))) candidates.push([r, c]);
  }
  if (!candidates.length) return null;
  const [r, c] = candidates[Math.floor(Math.random() * candidates.length)];
  const k = key(r, c);
  const ship = shipAt(state.playerShips, r, c);
  let outcome: 'miss' | 'hit' | 'sunk';
  if (!ship) {
    outcome = 'miss';
  } else {
    const hitSet = new Set(state.enemyShots.keys());
    hitSet.add(k);
    ship.sunk = ship.cells.every(([rr, cc]) => hitSet.has(key(rr, cc)));
    outcome = ship.sunk ? 'sunk' : 'hit';
    if (ship.sunk) {
      for (const [rr, cc] of ship.cells) state.enemyShots.set(key(rr, cc), 'sunk');
    }
  }
  state.enemyShots.set(k, outcome);
  if (allSunk(state.playerShips)) {
    state.over = true; state.winner = 'enemy'; state.turn = 'enemy';
    return { r, c, outcome };
  }
  state.turn = outcome === 'miss' ? 'player' : 'enemy';
  return { r, c, outcome };
}

/** Поверхность клетки вражеского поля для отрисовки (скрыто/промах/попадание). */
export function enemyCellState(state: GameState, r: number, c: number): 'hidden' | 'miss' | 'hit' | 'sunk' {
  return state.playerShots.get(key(r, c)) || 'hidden';
}

/** Поверхность клетки своего поля для отрисовки. */
export function playerCellState(state: GameState, r: number, c: number): 'empty' | 'ship' | 'miss' | 'hit' | 'sunk' {
  const shot = state.enemyShots.get(key(r, c));
  if (shot) return shot;
  const ship = shipAt(state.playerShips, r, c);
  if (!ship) return 'empty';
  return ship.sunk ? 'sunk' : 'ship';
}

/** Вид дуэли с сервера (структура ответа GET /api/warships/:id/state). */
export interface DuelViewLike {
  myShips: Array<{ cells: Cell[]; sunk: boolean }>;
  myShots: Record<string, 'miss' | 'hit' | 'sunk'>;
  enemyShots: Record<string, 'miss' | 'hit' | 'sunk'>;
  myTurn: boolean;
  over: boolean;
  winnerId: string | null;
  myShotsCount: number;
  startedAt: number;
}

/**
 * Привести серверный вид дуэли к GameState, чтобы рисовать его тем же Grid,
 * что и игру против ИИ. Чужого флота у клиента нет — enemyShips пуст,
 * вражеское поле рисуется только по результатам своих выстрелов.
 */
export function duelToGameState(view: DuelViewLike, myId: string): GameState {
  return {
    playerShips: view.myShips.map((s) => ({ cells: s.cells.map(([r, c]) => [r, c] as Cell), sunk: s.sunk })),
    enemyShips: [],
    playerShots: new Map(Object.entries(view.myShots || {})),
    enemyShots: new Map(Object.entries(view.enemyShots || {})),
    turn: view.myTurn ? 'player' : 'enemy',
    over: view.over,
    winner: view.over ? (view.winnerId === myId ? 'player' : 'enemy') : null,
    shotsByPlayer: view.myShotsCount,
    startedAt: view.startedAt,
  };
}