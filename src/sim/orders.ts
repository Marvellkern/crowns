/**
 * orders.ts — validate and execute a ruler's orders.
 *
 * Input is whatever the AI sent (already JSON-parsed, possibly garbage).
 * Everything is coerced, clamped, and checked against the current game
 * state. Illegal or unaffordable parts are dropped and described in the
 * returned `rejected` list (shown in the Debug tab). This never throws.
 */
import { CONFIG } from '../config';
import { RESOURCES, type BuildingType, type Kingdom, type Res, type UnitType } from './types';
import { canAfford, counts, findBuildSite, maxAffordable, pay, placeBuilding, popCap } from './kingdom';
import { raiseArmy, sendHome } from './combat';
import { DIP_TYPES, applyDiplomacy, cleanText, declareWar, type DipOrder, type DipType } from './diplomacy';
import type { Game } from './game';

export interface Orders {
  thoughts: string;
  worker_priorities: Record<Res, number> | null;
  build: { type: BuildingType; count: number }[];
  train: Record<UnitType, number>;
  armies: { action: 'attack' | 'defend' | 'raid' | 'retreat'; target: string; size: number }[];
  diplomacy: DipOrder[];
}

const num = (v: unknown, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

const BUILD_ALIASES: Record<string, BuildingType> = {
  farm: 'farm',
  farms: 'farm',
  lumber: 'lumber',
  lumber_camp: 'lumber',
  lumbercamp: 'lumber',
  sawmill: 'lumber',
  mine: 'mine',
  mines: 'mine',
  gold_mine: 'mine',
  house: 'house',
  houses: 'house',
  barracks: 'barracks',
  wall: 'wall',
  walls: 'wall',
  wall_segment: 'wall',
};

/** Turn arbitrary JSON into a well-typed Orders object (no game checks yet). */
export function sanitizeOrders(raw: any): Orders {
  const o = raw && typeof raw === 'object' ? raw : {};
  let priorities: Orders['worker_priorities'] = null;
  if (o.worker_priorities && typeof o.worker_priorities === 'object') {
    const p = o.worker_priorities;
    const f = Math.max(0, num(p.food));
    const w = Math.max(0, num(p.wood));
    const g = Math.max(0, num(p.gold));
    const total = f + w + g;
    if (total > 0) {
      priorities = { food: Math.round((f / total) * 100), wood: Math.round((w / total) * 100), gold: 0 };
      priorities.gold = 100 - priorities.food - priorities.wood;
    }
  }
  const build: Orders['build'] = [];
  for (const b of arr(o.build)) {
    const item = typeof b === 'string' ? { type: b, count: 1 } : (b as any);
    const type = BUILD_ALIASES[str(item?.type).toLowerCase().replace(/[\s-]/g, '_')];
    if (!type) continue;
    build.push({ type, count: Math.max(0, Math.min(CONFIG.maxBuildPerOrder, Math.floor(num(item.count, 1)))) });
  }
  const t = o.train && typeof o.train === 'object' && !Array.isArray(o.train) ? o.train : {};
  const train: Orders['train'] = {
    worker: Math.max(0, Math.floor(num(t.worker ?? t.workers))),
    soldier: Math.max(0, Math.floor(num(t.soldier ?? t.soldiers))),
    archer: Math.max(0, Math.floor(num(t.archer ?? t.archers))),
  };
  const armies: Orders['armies'] = [];
  for (const a of arr(o.armies)) {
    const action = str((a as any)?.action).toLowerCase();
    if (!['attack', 'defend', 'raid', 'retreat'].includes(action)) continue;
    armies.push({ action: action as any, target: str((a as any).target), size: Math.max(0, Math.floor(num((a as any).size, 9999))) });
  }
  const diplomacy: DipOrder[] = [];
  for (const d of arr(o.diplomacy)) {
    const type = str((d as any)?.type).toLowerCase() as DipType;
    if (!DIP_TYPES.includes(type)) continue;
    const res = str((d as any).resource).toLowerCase() as Res;
    diplomacy.push({
      to: str((d as any).to),
      type,
      message: cleanText((d as any).message),
      resource: RESOURCES.includes(res) ? res : undefined,
      amount: num((d as any).amount, 0),
    });
  }
  return { thoughts: cleanText(o.thoughts, 45), worker_priorities: priorities, build, train, armies, diplomacy: diplomacy.slice(0, 6) };
}

/** Apply sanitized orders to the game. Returns human-readable rejections. */
export function executeOrders(game: Game, k: Kingdom, o: Orders): string[] {
  const rejected: string[] = [];
  if (!k.alive || game.over) return rejected;
  if (o.thoughts) k.thoughts = o.thoughts;
  if (o.worker_priorities) k.priorities = { ...o.worker_priorities };

  // diplomacy first, so "declare war + attack" in one turn works
  for (const d of o.diplomacy) applyDiplomacy(game, k, d, rejected);

  for (const b of o.build) {
    const def = CONFIG.buildings[b.type];
    let built = 0;
    for (let i = 0; i < b.count; i++) {
      if (!canAfford(k.res, def.cost)) {
        rejected.push(`${k.name} tried to build ${b.count} ${b.type}, could afford ${built}`);
        break;
      }
      if (b.type === 'house' && game.buildingsOfType(k, 'house').length >= CONFIG.pop.maxHouses) {
        rejected.push(`${k.name} tried to build a house, but already has the maximum (${CONFIG.pop.maxHouses})`);
        break;
      }
      const site = findBuildSite(game, k, b.type);
      if (!site) {
        rejected.push(`${k.name} tried to build ${b.type}, but found no suitable site`);
        break;
      }
      pay(k.res, def.cost);
      placeBuilding(game, k, b.type, site.x, site.y);
      built++;
    }
  }

  const hasBarracks = game.buildingsOfType(k, 'barracks').some((b) => b.buildLeft === 0);
  for (const type of ['worker', 'soldier', 'archer'] as UnitType[]) {
    const want = Math.min(o.train[type], CONFIG.maxTrainPerOrder);
    if (want <= 0) continue;
    if (type !== 'worker' && !hasBarracks) {
      rejected.push(`${k.name} tried to train ${want} ${type}s without a finished barracks`);
      continue;
    }
    const room = popCap(game, k) - counts(game, k).pop - k.trainQueue.length;
    const afford = maxAffordable(k.res, CONFIG.units[type].cost);
    const n = Math.max(0, Math.min(want, room, afford));
    if (n < want) rejected.push(`${k.name} tried to train ${o.train[type]} ${type}s, could manage ${n} (room ${Math.max(0, room)}, afford ${afford})`);
    if (n <= 0) continue;
    pay(k.res, CONFIG.units[type].cost, n);
    for (let i = 0; i < n; i++) k.trainQueue.push({ type, left: CONFIG.units[type].trainTicks });
  }

  for (const a of o.armies) {
    if (a.action === 'defend' || a.action === 'retreat') {
      for (const army of game.armies) if (army.kingdom === k.id && army.action !== 'return') sendHome(game, army);
      continue;
    }
    const target = game.findKingdom(a.target);
    if (!target || target.id === k.id || !target.alive) {
      rejected.push(`${k.name}: ${a.action} target "${a.target}" is not a living rival`);
      continue;
    }
    if (game.relations[k.id][target.id] === 'allied') {
      rejected.push(`${k.name} tried to ${a.action} its ally ${target.name} (must break_alliance first)`);
      continue;
    }
    const home = counts(game, k);
    const avail = home.soldiers + home.archers;
    if (avail <= 0) {
      rejected.push(`${k.name} tried to ${a.action} ${target.name} with no troops at home`);
      continue;
    }
    const size = Math.min(a.size || avail, avail);
    if (game.relations[k.id][target.id] !== 'war') declareWar(game, k, target);
    const army = raiseArmy(game, k, size, a.action, target.id);
    if (army) game.event(target, `Scouts report an army of ~${size} from ${k.name} marching toward you`);
  }
  return rejected;
}
