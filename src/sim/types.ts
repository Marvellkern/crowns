/**
 * types.ts — shared data shapes for the simulation.
 *
 * The sim is plain data + functions with no DOM access, so it can run headless
 * (see scripts/simtest.ts). Rendering and UI only READ these objects.
 */

export const T = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, MOUNTAIN: 4 } as const;
export const TERRAIN_NAMES = ['water', 'sand', 'grass', 'forest', 'mountain'];

export type Res = 'food' | 'wood' | 'gold';
export const RESOURCES: Res[] = ['food', 'wood', 'gold'];
export type Resources = Record<Res, number>;

export type BuildingType = 'hall' | 'farm' | 'lumber' | 'mine' | 'house' | 'barracks' | 'wall';
export const BUILDABLE: BuildingType[] = ['farm', 'lumber', 'mine', 'house', 'barracks', 'wall'];

export type UnitType = 'worker' | 'soldier' | 'archer';
export type Relation = 'neutral' | 'allied' | 'war';

export interface Building {
  id: number;
  kingdom: number;
  type: BuildingType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Ticks of construction left. 0 = finished and working. */
  buildLeft: number;
}

/** A worker, or a soldier/archer standing in the home garrison. */
export interface Unit {
  id: number;
  kingdom: number;
  type: UnitType;
  x: number;
  y: number;
  path: number[];
  moveCd: number;
  state: 'idle' | 'toWork' | 'working' | 'toHome';
  role: Res;
  siteId: number; // building id being worked, or -1 for foraging
  workLeft: number;
  carry: number;
  carryRes: Res;
}

export type ArmyAction = 'attack' | 'raid' | 'return' | 'monster';

/** Soldiers/archers marching together, rendered as one stacked glyph. Kingdom -1 = monsters. */
export interface Army {
  id: number;
  kingdom: number;
  soldiers: number;
  archers: number;
  monsters: number;
  x: number;
  y: number;
  path: number[];
  moveCd: number;
  action: ArmyAction;
  targetKingdom: number;
  targetBuilding: number;
  loot: Resources;
}

export interface KingdomStats {
  peakArmy: number;
  battlesWon: number;
  battlesLost: number;
  betrayals: number;
  gathered: Resources;
  unitsLost: number;
}

export interface InboxMsg {
  from: string;
  text: string;
}

export interface Kingdom {
  id: number;
  name: string;
  town: string; // name of the capital settlement, used in the Chronicle
  color: string;
  personaKey: string;
  personaText: string;
  model: string;
  useMock: boolean;
  alive: boolean;
  res: Resources;
  priorities: Resources;
  hallId: number;
  hx: number;
  hy: number;
  units: Unit[];
  trainQueue: { type: UnitType; left: number }[];
  morale: number;
  droughtTurns: number;
  starvedThisTurn: boolean;
  thoughts: string;
  /** One-line summary of what the last council actually did (shown on the card). */
  lastOrders: string;
  thinking: boolean;
  recentEvents: string[];
  inbox: InboxMsg[];
  stats: KingdomStats;
  fellTurn: number;
}

export interface ChronEntry {
  turn: number;
  when: string; // "Year 3, Spring"
  text: string;
  kind: string;
  x?: number;
  y?: number;
}

export interface DipMsg {
  turn: number;
  from: number; // kingdom id, -1 = mysterious voice (god)
  to: number;
  type: string;
  text: string;
}

export interface DebugEntry {
  turn: number;
  kingdom: number;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  prompt: string;
  response: string;
  rejected: string[];
  error?: string;
}
