/**
 * economy.ts — per-tick kingdom upkeep: workers gathering, construction,
 * training, food upkeep / starvation, population growth, garrison wandering.
 *
 * Workers manage themselves. The AI only sets worker_priorities (% food /
 * wood / gold); every few seconds workers are re-assigned to match them.
 */
import { CONFIG } from '../config';
import { T, RESOURCES, type Kingdom, type Res, type Unit } from './types';
import { counts, killHomeUnits, newUnit, popCap } from './kingdom';
import type { Game } from './game';

const SITE_FOR: Record<Res, 'farm' | 'lumber' | 'mine'> = { food: 'farm', wood: 'lumber', gold: 'mine' };

export function updateKingdom(game: Game, k: Kingdom) {
  const E = CONFIG.economy;
  const tick = game.tick;

  if (tick % E.reassignTicks === 0) assignRoles(k);

  for (const u of k.units) {
    if (u.type === 'worker') updateWorker(game, k, u);
    else updateGarrison(game, k, u);
  }

  // passive hall food
  k.res.food += E.hallFoodPerSec / CONFIG.sim.ticksPerSecond;

  // training queue: one unit at a time per finished barracks
  const barracks = game.buildingsOfType(k, 'barracks').filter((b) => b.buildLeft === 0);
  const lanes = Math.max(1, barracks.length);
  for (let i = 0; i < Math.min(lanes, k.trainQueue.length); i++) {
    const q = k.trainQueue[i];
    if (q.type !== 'worker' && barracks.length === 0) continue;
    q.left--;
    if (q.left <= 0) {
      const at = q.type === 'worker' || !barracks[i] ? { x: k.hx, y: k.hy } : barracks[i];
      k.units.push(newUnit(game, k, q.type, at.x, at.y));
      k.trainQueue.splice(i, 1);
      i--;
    }
  }

  // upkeep and starvation
  if (tick % E.upkeepTicks === 0) {
    const c = counts(game, k);
    k.res.food -= c.pop * E.foodPerPop;
    // troop wages; if the treasury is empty, a soldier or archer at home deserts
    k.res.gold -= c.military * E.goldPerSoldier;
    if (k.res.gold < 0) {
      k.res.gold = 0;
      const gone = killHomeUnits(k, 'soldier', 1, () => game.rng.next()) || killHomeUnits(k, 'archer', 1, () => game.rng.next());
      if (gone) game.event(k, 'Unpaid troops deserted (gold ran out)');
    }
    if (k.res.food < 0) {
      k.res.food = 0;
      const loss = Math.max(1, Math.round(c.pop * E.starvationLossPct));
      const died = killHomeUnits(k, 'any', loss, () => game.rng.next());
      k.morale = Math.max(0, k.morale - E.moraleStarvePenalty);
      if (died > 0) {
        game.event(k, `${died} of your people starved (food ran out)`);
        if (!k.starvedThisTurn) {
          k.starvedThisTurn = true;
          game.log('starvation', { a: k.name, town: k.town, n: died }, k.hx, k.hy);
        }
      }
    }
  }

  // growth: new workers are born when food is plentiful
  if (tick % E.growthTicks === 0 && k.res.food >= E.growthMinFood) {
    const c = counts(game, k);
    const cap = popCap(game, k);
    if (c.pop + k.trainQueue.length < cap && c.workers < cap * E.growthMaxWorkerShare) {
      k.res.food -= E.growthFoodCost;
      k.units.push(newUnit(game, k, 'worker', k.hx, k.hy));
    }
  }
}

/** Split workers across food/wood/gold according to the AI's priorities. */
function assignRoles(k: Kingdom) {
  const workers = k.units.filter((u) => u.type === 'worker');
  const n = workers.length;
  const total = k.priorities.food + k.priorities.wood + k.priorities.gold || 1;
  const want: Record<Res, number> = {
    food: Math.round((k.priorities.food / total) * n),
    wood: Math.round((k.priorities.wood / total) * n),
    gold: 0,
  };
  want.gold = Math.max(0, n - want.food - want.wood);
  // keep existing roles where possible; move the surplus
  const have: Record<Res, number> = { food: 0, wood: 0, gold: 0 };
  const spare: Unit[] = [];
  for (const w of workers) {
    if (have[w.role] < want[w.role]) have[w.role]++;
    else spare.push(w);
  }
  for (const w of spare) {
    const r = RESOURCES.find((res) => have[res] < want[res]) ?? 'food';
    w.role = r;
    have[r]++;
  }
}

function step(game: Game, u: { x: number; y: number; path: number[]; moveCd: number }, moveTicks: number) {
  if (u.path.length === 0) return;
  if (--u.moveCd > 0) return;
  u.moveCd = moveTicks;
  const i = u.path.shift()!;
  u.x = i % game.world.w;
  u.y = (i - u.x) / game.world.w;
}

function updateWorker(game: Game, k: Kingdom, u: Unit) {
  const E = CONFIG.economy;
  const { world } = game;
  step(game, u, CONFIG.movement.worker);

  switch (u.state) {
    case 'idle': {
      if (u.workLeft > 0) {
        u.workLeft--; // waiting after a failed search
        return;
      }
      // nearest finished site of the right type with a free slot
      const type = SITE_FOR[u.role];
      let site = null as null | { id: number; x: number; y: number };
      let bestD = Infinity;
      for (const b of game.buildingsOfType(k, type)) {
        if (b.buildLeft > 0) continue;
        let used = 0;
        for (const o of k.units) if (o !== u && o.siteId === b.id) used++;
        if (used >= E.siteCapacity) continue;
        const d = Math.abs(b.x - u.x) + Math.abs(b.y - u.y);
        if (d < bestD) {
          bestD = d;
          site = b;
        }
      }
      let path: number[] | null;
      if (site) {
        path = world.pathNear(u.x, u.y, site.x, site.y);
        u.siteId = site.id;
      } else {
        // forage: food on grass inside our land, wood at forest, gold next to mountains
        u.siteId = -1;
        const role = u.role;
        path = world.findPath(
          u.x,
          u.y,
          (i) => {
            const t = world.terrain[i];
            if (role === 'wood') return t === T.FOREST;
            if (role === 'food') return t === T.GRASS && world.owner[i] === k.id && !world.bld[i] && (i * 7919) % 5 === 0;
            if (t === T.MOUNTAIN) return false;
            const x = i % world.w;
            const y = (i - x) / world.w;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                if (world.inb(x + dx, y + dy) && world.terrain[world.idx(x + dx, y + dy)] === T.MOUNTAIN) return true;
            return false;
          },
          4000,
        );
      }
      if (!path) {
        u.siteId = -1;
        u.workLeft = 30;
        return;
      }
      u.path = path;
      u.state = 'toWork';
      return;
    }
    case 'toWork':
      if (u.path.length === 0) {
        if (u.siteId !== -1 && !game.buildings.has(u.siteId)) {
          u.state = 'idle';
          u.siteId = -1;
          return;
        }
        u.state = 'working';
        u.workLeft = E.workTicks;
      }
      return;
    case 'working': {
      if (--u.workLeft > 0) return;
      let amount = E.yields[u.role];
      if (u.siteId === -1) amount *= E.forageMultiplier;
      if (u.role === 'food' && k.droughtTurns > 0) amount *= E.droughtMultiplier;
      if (k.morale < E.lowMoraleThreshold) amount *= E.lowMoraleYield;
      u.carry = amount;
      u.carryRes = u.role;
      u.siteId = -1;
      u.path = world.pathNear(u.x, u.y, k.hx, k.hy) ?? [];
      u.state = 'toHome';
      return;
    }
    case 'toHome':
      if (u.path.length === 0) {
        k.res[u.carryRes] += u.carry;
        k.stats.gathered[u.carryRes] += u.carry;
        u.carry = 0;
        u.state = 'idle';
      }
      return;
  }
}

/** Soldiers/archers at home mill about near the town hall. */
function updateGarrison(game: Game, k: Kingdom, u: Unit) {
  step(game, u, CONFIG.movement.worker);
  if (u.path.length > 0) return;
  if (game.rng.next() > 1 / CONFIG.movement.garrisonWanderTicks) return;
  const { world } = game;
  for (let tries = 0; tries < 4; tries++) {
    const x = k.hx + game.rng.int(-3, 3);
    const y = k.hy + game.rng.int(-3, 3);
    if (world.inb(x, y) && world.passable(world.idx(x, y))) {
      u.path = world.findPath(u.x, u.y, (i) => i === world.idx(x, y), 400) ?? [];
      return;
    }
  }
}

export { step as stepAlongPath };
