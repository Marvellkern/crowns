/**
 * game.ts — the Game object: owns all simulation state and advances it one
 * fixed tick at a time (CONFIG.sim.ticksPerSecond ticks per game second).
 *
 * The Game never calls an AI and never waits on anything. Every
 * councilIntervalSec it fires `onCouncil`; the AI layer (ai/council.ts)
 * answers asynchronously and applies orders whenever they arrive.
 */
import { CONFIG } from '../config';
import type {
  Army,
  Building,
  BuildingType,
  ChronEntry,
  DebugEntry,
  DipMsg,
  Kingdom,
  Relation,
} from './types';
import { World, generateWorld } from './world';
import { Rng, hashSeed } from './rng';
import { counts, destroyBuilding, newUnit, placeBuilding } from './kingdom';
import { updateKingdom } from './economy';
import { updateArmies } from './combat';
import { randomTurnEvents, type GodPower } from './events';
import { chronicleLine, townName } from '../data/chronicle';

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const KINGDOM_COLORS = ['#e5484d', '#3e8ef7', '#f5c518'];

export interface KingdomSetup {
  name: string;
  personaKey: string;
  personaText: string;
  model: string;
  useMock: boolean;
}

export interface GameSetup {
  seed: string;
  size: string; // S | M | L
  councilSec: number;
  kingdoms: KingdomSetup[];
}

export class Game {
  setup: GameSetup;
  seedNum: number;
  world: World;
  rng: Rng;
  kingdoms: Kingdom[] = [];
  buildings = new Map<number, Building>();
  armies: Army[] = [];
  relations: Relation[][];
  proposals: { from: number; to: number; kind: 'alliance' | 'peace'; turn: number }[] = [];

  tick = 0;
  /** Season index: 0 = Year 1 Spring. Advances once per Council Turn. */
  turn = 0;
  councilCount = 0;
  councilTicks: number;
  councilCountdown: number;

  chronicle: ChronEntry[] = [];
  dipLog: DipMsg[] = [];
  debug: DebugEntry[] = [];
  markers: { x: number; y: number; ttl: number; kind: 'battle' | 'fire' }[] = [];
  /** Where the latest action happened (cinematic camera target). */
  focus: { x: number; y: number; tick: number } | null = null;
  godReadyAt: Partial<Record<GodPower, number>> = {};

  over = false;
  winner = -1;
  endReason = '';
  nextId = 1;

  onCouncil: (() => void) | null = null;
  onEnd: (() => void) | null = null;

  constructor(setup: GameSetup) {
    this.setup = setup;
    this.seedNum = hashSeed(setup.seed);
    this.rng = new Rng(this.seedNum + 17);
    const size = CONFIG.map.sizes[setup.size] ?? CONFIG.map.sizes.M;
    const { world, starts } = generateWorld(size.w, size.h, this.seedNum, setup.kingdoms.length);
    this.world = world;
    const n = setup.kingdoms.length;
    this.relations = Array.from({ length: n }, () => Array<Relation>(n).fill('neutral'));
    this.councilTicks = Math.round(setup.councilSec * CONFIG.sim.ticksPerSecond);
    this.councilCountdown = 3 * CONFIG.sim.ticksPerSecond; // first council shortly after the start

    const taken = new Set<string>();
    const nameRng = new Rng(this.seedNum + 99);
    setup.kingdoms.forEach((ks, id) => {
      const st = starts[id];
      const k: Kingdom = {
        id,
        name: ks.name,
        town: townName(() => nameRng.next(), taken),
        color: KINGDOM_COLORS[id % KINGDOM_COLORS.length],
        personaKey: ks.personaKey,
        personaText: ks.personaText,
        model: ks.model,
        useMock: ks.useMock,
        alive: true,
        res: { food: CONFIG.start.food, wood: CONFIG.start.wood, gold: CONFIG.start.gold },
        priorities: { food: 50, wood: 35, gold: 15 },
        hallId: -1,
        hx: st.x,
        hy: st.y,
        units: [],
        trainQueue: [],
        morale: 70,
        droughtTurns: 0,
        starvedThisTurn: false,
        thoughts: '',
        lastOrders: '',
        thinking: false,
        recentEvents: [],
        inbox: [],
        stats: { peakArmy: 0, battlesWon: 0, battlesLost: 0, betrayals: 0, gathered: { food: 0, wood: 0, gold: 0 }, unitsLost: 0 },
        fellTurn: -1,
      };
      this.kingdoms.push(k);
      const hall = placeBuilding(this, k, 'hall', st.x, st.y, true);
      k.hallId = hall.id;
      for (let i = 0; i < CONFIG.start.workers; i++) k.units.push(newUnit(this, k, 'worker', st.x, st.y));
      this.log('founding', { a: k.name, town: k.town }, st.x, st.y);
    });
  }

  // ---------- helpers used across the sim ----------
  when(turn = this.turn) {
    return `Year ${Math.floor(turn / CONFIG.sim.seasonsPerYear) + 1}, ${SEASONS[turn % CONFIG.sim.seasonsPerYear]}`;
  }
  get year() {
    return Math.floor(this.turn / CONFIG.sim.seasonsPerYear) + 1;
  }

  buildingsOfType(k: Kingdom, type: BuildingType): Building[] {
    const out: Building[] = [];
    for (const b of this.buildings.values()) if (b.kingdom === k.id && b.type === type) out.push(b);
    return out;
  }

  /** Forgiving name lookup: "river folk", "The River Folk", "River" all work. */
  findKingdom(name: string): Kingdom | null {
    const n = name.toLowerCase().replace(/^the\s+/, '').trim();
    if (!n) return null;
    return (
      this.kingdoms.find((k) => k.name.toLowerCase() === n) ??
      this.kingdoms.find((k) => k.name.toLowerCase().includes(n) || n.includes(k.name.toLowerCase())) ??
      null
    );
  }

  /** Add a Chronicle line. */
  log(kind: string, params: Record<string, string | number>, x?: number, y?: number) {
    const text = chronicleLine(kind, params, () => this.rng.next());
    this.chronicle.push({ turn: this.turn, when: this.when(), text, kind, x, y });
  }

  /** Something the kingdom's ruler will hear about next Council Turn. */
  event(k: Kingdom, text: string) {
    k.recentEvents.push(text);
    if (k.recentEvents.length > 12) k.recentEvents.shift();
  }

  focusOn(x: number, y: number) {
    this.focus = { x, y, tick: this.tick };
  }

  strength(k: Kingdom) {
    if (!k.alive) return 0;
    const c = counts(this, k);
    let blds = 0;
    for (const b of this.buildings.values()) if (b.kingdom === k.id) blds++;
    return Math.round(c.military * 3 + c.workers + blds * 2 + (k.res.food + k.res.wood + k.res.gold) / 20);
  }

  // ---------- the tick ----------
  step() {
    if (this.over) return;
    this.tick++;
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      updateKingdom(this, k);
      const cap = CONFIG.economy.storageCap;
      if (k.res.food > cap) k.res.food = cap;
      if (k.res.wood > cap) k.res.wood = cap;
      if (k.res.gold > cap) k.res.gold = cap;
      for (const b of this.buildings.values()) if (b.kingdom === k.id && b.buildLeft > 0) b.buildLeft--;
    }
    updateArmies(this);
    for (const m of this.markers) m.ttl--;
    this.markers = this.markers.filter((m) => m.ttl > 0);
    if (this.over) return;

    // The next council waits until every ruler has answered the last one, so at
    // high speed slow AIs get a longer season instead of skipping turns. The
    // world keeps running while it waits.
    if (this.councilCountdown > 0) this.councilCountdown--;
    if (this.councilCountdown <= 0 && !this.waitingForRulers) {
      this.councilCountdown = this.councilTicks;
      this.councilBoundary();
    }
  }

  /** True while any living ruler is still answering the previous council. */
  get waitingForRulers() {
    return this.kingdoms.some((k) => k.alive && k.thinking);
  }

  setCouncilInterval(sec: number) {
    const t = Math.round(sec * CONFIG.sim.ticksPerSecond);
    this.councilCountdown = Math.min(this.councilCountdown, t);
    this.councilTicks = t;
  }

  /** A new season begins and the rulers convene. */
  private councilBoundary() {
    // the last season of the final year has passed: the age ends
    if (this.councilCount > 0 && this.turn + 1 >= CONFIG.sim.maxYears * CONFIG.sim.seasonsPerYear) {
      this.end('time');
      return;
    }
    if (this.councilCount > 0) this.turn++;
    this.councilCount++;
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      if (k.droughtTurns > 0) k.droughtTurns--;
      if (!k.starvedThisTurn) k.morale = Math.min(100, k.morale + CONFIG.economy.moraleRecoverPerTurn);
      k.starvedThisTurn = false;
      k.stats.peakArmy = Math.max(k.stats.peakArmy, counts(this, k).military);
    }
    this.proposals = this.proposals.filter((p) => this.turn - p.turn <= CONFIG.diplomacy.proposalWindowTurns);
    randomTurnEvents(this);
    this.onCouncil?.();
  }

  /** A town hall fell: the kingdom is out. Its field armies turn into wild raiders. */
  defeat(k: Kingdom, by: Kingdom | null) {
    if (!k.alive) return;
    k.alive = false;
    k.fellTurn = this.turn;
    k.thinking = false;
    k.trainQueue = [];
    k.stats.unitsLost += k.units.length;
    k.units = [];
    for (const b of [...this.buildings.values()]) if (b.kingdom === k.id) destroyBuilding(this, b);
    for (const a of this.armies)
      if (a.kingdom === k.id) {
        a.kingdom = -1;
        a.monsters = a.soldiers + a.archers;
        a.soldiers = 0;
        a.archers = 0;
        a.action = 'monster';
        a.targetBuilding = -1;
        a.path = [];
      }
    if (by) this.log('fall', { a: k.name, b: by.name, town: k.town }, k.hx, k.hy);
    else this.log('fall_other', { a: k.name, town: k.town }, k.hx, k.hy);
    this.focusOn(k.hx, k.hy);
    for (const o of this.kingdoms) if (o.alive) this.event(o, `The ${k.name} have fallen; their capital ${k.town} is in ruins`);
    if (this.kingdoms.filter((x) => x.alive).length <= 1) this.end('conquest');
  }

  end(reason: 'time' | 'conquest') {
    if (this.over) return;
    this.over = true;
    this.endReason = reason;
    let best = -1;
    let bs = -1;
    for (const k of this.kingdoms) {
      const s = this.strength(k);
      if (k.alive && s > bs) {
        bs = s;
        best = k.id;
      }
    }
    this.winner = best;
    if (best >= 0) {
      const w = this.kingdoms[best];
      this.log('victory', { a: w.name }, w.hx, w.hy);
      this.focusOn(w.hx, w.hy);
    }
    this.onEnd?.();
  }
}
