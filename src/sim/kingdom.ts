/**
 * kingdom.ts — kingdom state helpers: counting population, affordability,
 * finding building sites, placing/destroying buildings, and territory.
 */
import { CONFIG } from '../config';
import { T, type Building, type BuildingType, type Kingdom, type Resources, type Unit, type UnitType } from './types';
import type { Game } from './game';

export function newUnit(game: Game, k: Kingdom, type: UnitType, x: number, y: number): Unit {
  return {
    id: game.nextId++,
    kingdom: k.id,
    type,
    x,
    y,
    path: [],
    moveCd: 0,
    state: 'idle',
    role: 'food',
    siteId: -1,
    workLeft: 0,
    carry: 0,
    carryRes: 'food',
  };
}

/** Headcount of a kingdom, including armies in the field. */
export function counts(game: Game, k: Kingdom) {
  let workers = 0;
  let soldiers = 0;
  let archers = 0;
  for (const u of k.units) {
    if (u.type === 'worker') workers++;
    else if (u.type === 'soldier') soldiers++;
    else archers++;
  }
  let fieldS = 0;
  let fieldA = 0;
  for (const a of game.armies)
    if (a.kingdom === k.id) {
      fieldS += a.soldiers;
      fieldA += a.archers;
    }
  return {
    workers,
    soldiers, // at home
    archers, // at home
    fieldSoldiers: fieldS,
    fieldArchers: fieldA,
    military: soldiers + archers + fieldS + fieldA,
    pop: workers + soldiers + archers + fieldS + fieldA,
  };
}

export function buildingsOf(game: Game, k: Kingdom, type?: BuildingType): Building[] {
  const out: Building[] = [];
  for (const b of game.buildings.values()) if (b.kingdom === k.id && (!type || b.type === type)) out.push(b);
  return out;
}

export function popCap(game: Game, k: Kingdom): number {
  let cap = 0;
  for (const b of game.buildings.values()) {
    if (b.kingdom !== k.id || b.buildLeft > 0) continue;
    if (b.type === 'hall') cap += CONFIG.pop.hallCap;
    else if (b.type === 'house') cap += CONFIG.pop.houseCap;
  }
  return cap;
}

export function canAfford(res: Resources, cost: Resources, times = 1) {
  return res.food >= cost.food * times && res.wood >= cost.wood * times && res.gold >= cost.gold * times;
}
export function maxAffordable(res: Resources, cost: Resources) {
  let n = Infinity;
  if (cost.food > 0) n = Math.min(n, Math.floor(res.food / cost.food));
  if (cost.wood > 0) n = Math.min(n, Math.floor(res.wood / cost.wood));
  if (cost.gold > 0) n = Math.min(n, Math.floor(res.gold / cost.gold));
  return n === Infinity ? 999 : n;
}
export function pay(res: Resources, cost: Resources, times = 1) {
  res.food -= cost.food * times;
  res.wood -= cost.wood * times;
  res.gold -= cost.gold * times;
}

function near(game: Game, x: number, y: number, r: number, terrain: number) {
  const { world } = game;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (world.inb(nx, ny) && world.terrain[world.idx(nx, ny)] === terrain) return true;
    }
  return false;
}

/** Pick a tile for a new building of `type`, or null if there is no room. */
export function findBuildSite(game: Game, k: Kingdom, type: BuildingType): { x: number; y: number } | null {
  const { world } = game;
  const R = CONFIG.maxBuildRadius;
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = k.hx + dx;
      const y = k.hy + dy;
      if (!world.inb(x, y)) continue;
      const i = world.idx(x, y);
      const t = world.terrain[i];
      if (t !== T.GRASS && t !== T.SAND) continue;
      if (world.bld[i]) continue;
      const own = world.owner[i];
      if (own !== -1 && own !== k.id) continue;
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      const dist = Math.hypot(dx, dy);
      if (type === 'wall') {
        if (cheb !== CONFIG.wallRadius) continue;
      } else {
        if (cheb < 2) continue;
        if (cheb === CONFIG.wallRadius) continue; // keep the wall ring free
        // no buildings touching each other (walls excepted), so the map stays readable
        let crowded = false;
        for (let oy = -1; oy <= 1 && !crowded; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            if (!world.inb(x + ox, y + oy)) continue;
            const bid = world.bld[world.idx(x + ox, y + oy)];
            if (bid && game.buildings.get(bid)?.type !== 'wall') {
              crowded = true;
              break;
            }
          }
        if (crowded) continue;
      }
      let score = dist;
      if (type === 'farm' && t !== T.GRASS) continue;
      if (type === 'lumber' && !near(game, x, y, 2, T.FOREST)) continue;
      if (type === 'mine' && !near(game, x, y, 2, T.MOUNTAIN)) continue;
      if ((type === 'house' || type === 'barracks') && cheb > 9) score += 20;
      if (type === 'wall') score = (Math.atan2(dy, dx) + Math.PI) * 0.01 + game.rng.next() * 0.001;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

export function placeBuilding(game: Game, k: Kingdom, type: BuildingType, x: number, y: number, instant = false): Building {
  const def = CONFIG.buildings[type];
  const b: Building = {
    id: game.nextId++,
    kingdom: k.id,
    type,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    buildLeft: instant ? 0 : def.buildTicks,
  };
  game.buildings.set(b.id, b);
  const i = game.world.idx(x, y);
  game.world.bld[i] = b.id;
  if (game.world.ruins[i]) {
    game.world.ruins[i] = 0;
    game.world.terrainVersion++;
  }
  recomputeTerritory(game);
  return b;
}

/** Remove a building and leave ruins (plus a short fire). */
export function destroyBuilding(game: Game, b: Building) {
  game.buildings.delete(b.id);
  const i = game.world.idx(b.x, b.y);
  game.world.bld[i] = 0;
  game.world.ruins[i] = 1;
  game.world.terrainVersion++;
  game.markers.push({ x: b.x, y: b.y, ttl: CONFIG.combat.fireTicks, kind: 'fire' });
  recomputeTerritory(game);
}

/** Each tile belongs to the kingdom whose nearest building claims it. */
export function recomputeTerritory(game: Game) {
  const { world } = game;
  const n = world.w * world.h;
  const best = new Float32Array(n).fill(Infinity);
  world.owner.fill(-1);
  for (const b of game.buildings.values()) {
    const r = CONFIG.buildings[b.type].territory;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = b.x + dx;
        const y = b.y + dy;
        if (!world.inb(x, y)) continue;
        const d = Math.hypot(dx, dy);
        if (d > r + 0.5) continue;
        const i = world.idx(x, y);
        if (d < best[i]) {
          best[i] = d;
          world.owner[i] = b.kingdom;
        }
      }
  }
  world.territoryVersion++;
}

/** Remove `n` of a unit type from home units (used for casualties, plague, starvation). */
export function killHomeUnits(k: Kingdom, type: UnitType | 'any', n: number, rand: () => number): number {
  let killed = 0;
  while (killed < n) {
    const pool = type === 'any' ? k.units : k.units.filter((u) => u.type === type);
    if (pool.length === 0) break;
    const victim = pool[Math.floor(rand() * pool.length)];
    k.units.splice(k.units.indexOf(victim), 1);
    killed++;
  }
  k.stats.unitsLost += killed;
  return killed;
}
