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
import { raiseArmy, sendHome, sendSettlers, troops } from './combat';
import { allSettlements, chooseTownSite, findSettlement, newTownName, regionName, settlementsOf } from './towns';
import { DIP_TYPES, applyDiplomacy, cleanText, declareWar, type DipOrder, type DipType } from './diplomacy';
import type { Game } from './game';

export interface Orders {
  thoughts: string;
  worker_priorities: Record<Res, number> | null;
  build: { type: BuildingType; count: number }[];
  train: Record<UnitType, number>;
  armies: { action: 'attack' | 'defend' | 'raid' | 'retreat'; target: string; size: number }[];
  diplomacy: DipOrder[];
  /** Send settlers to found a town, biased toward "center", a rival's name, or a direction. */
  found_town: { toward: string } | null;
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
  let found_town: Orders['found_town'] = null;
  const ft = o.found_town ?? o.found_towns ?? o.settle ?? o.expand;
  if (ft === true || (typeof ft === 'number' && ft > 0)) found_town = { toward: 'center' };
  else if (typeof ft === 'string' && ft.trim() && !/^(false|no|none|0)$/i.test(ft.trim())) found_town = { toward: ft.trim() };
  else if (ft && typeof ft === 'object' && !Array.isArray(ft)) found_town = { toward: str(ft.toward ?? ft.near ?? ft.direction) || 'center' };
  return { thoughts: cleanText(o.thoughts, 45), worker_priorities: priorities, build, train, armies, diplomacy: diplomacy.slice(0, 6), found_town };
}

/** Apply sanitized orders to the game. Returns human-readable rejections. */
export function executeOrders(game: Game, k: Kingdom, o: Orders): string[] {
  const rejected: string[] = [];
  const done: string[] = []; // human-readable summary shown on the kingdom card
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
      if (b.type === 'barracks' && game.buildingsOfType(k, 'barracks').length === 0)
        game.log('barracks', { a: k.name, town: k.town }, site.x, site.y);
      pay(k.res, def.cost);
      placeBuilding(game, k, b.type, site.x, site.y);
      built++;
    }
    if (built) done.push(`built ${built} ${b.type}${built > 1 ? 's' : ''}`);
  }

  if (o.found_town) {
    const TW = CONFIG.towns;
    const towns = settlementsOf(game, k).length + game.armies.filter((a) => a.kingdom === k.id && a.settlers > 0).length;
    const workers = counts(game, k).workers;
    if (allSettlements(game).length + game.armies.filter((x) => x.settlers > 0).length >= TW.maxOnMap)
      rejected.push(`${k.name} tried to found a town, but the land is full (${TW.maxOnMap} towns): capture one instead`);
    else if (towns >= TW.maxPerKingdom) rejected.push(`${k.name} tried to found a town, but already has the maximum (${TW.maxPerKingdom})`);
    else if (workers < TW.settlers + TW.minWorkersLeft)
      rejected.push(`${k.name} tried to found a town with ${workers} workers (needs ${TW.settlers + TW.minWorkersLeft})`);
    else if (!canAfford(k.res, TW.cost)) rejected.push(`${k.name} tried to found a town but could not afford it`);
    else {
      const site = chooseTownSite(game, k, o.found_town.toward);
      if (!site) rejected.push(`${k.name} tried to found a town toward "${o.found_town.toward}" but found no free land`);
      else {
        pay(k.res, TW.cost);
        const name = newTownName(game);
        sendSettlers(game, k, site.x, site.y, name);
        game.log('settlers_depart', { a: k.name, town: name, where: regionName(game, site.x, site.y) }, k.hx, k.hy);
        done.push(`sent settlers to found ${name}`);
      }
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
    done.push(`trained ${n} ${type}${n > 1 ? 's' : ''}`);
  }

  for (const a of o.armies) {
    const town = a.target ? findSettlement(game, a.target) : null;
    // defend one of our towns (not the capital): march troops there and post them as its garrison
    if (a.action === 'defend' && town && town.kingdom === k.id && town.type !== 'hall') {
      const home = counts(game, k);
      const avail = home.soldiers + home.archers;
      const size = Math.min(a.size >= 9999 ? Math.ceil(avail / 2) : a.size, avail);
      if (size <= 0) {
        rejected.push(`${k.name} tried to garrison ${town.name} with no troops at home`);
        continue;
      }
      const army = raiseArmy(game, k, size, 'station', -1, town.id);
      if (army) done.push(`sent ${army.soldiers + army.archers} to garrison ${town.name}`);
      continue;
    }
    if (a.action === 'defend' || a.action === 'retreat') {
      let recalled = 0;
      for (const army of game.armies)
        if (army.kingdom === k.id && army.action !== 'return') {
          sendHome(game, army);
          recalled++;
        }
      done.push(recalled ? 'recalled its armies' : 'stood on defence');
      continue;
    }
    // the target can be a kingdom, or one of its towns by name
    const target = town ? game.kingdoms[town.kingdom] : game.findKingdom(a.target);
    if (!target || target.id === k.id || !target.alive) {
      rejected.push(`${k.name}: ${a.action} target "${a.target}" is not a living rival or one of its towns`);
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
    const aimed = town && a.action === 'attack' ? town : null;
    const army = raiseArmy(game, k, size, a.action, target.id, aimed?.id ?? -1);
    if (army) {
      const n = army.soldiers + army.archers;
      const where = aimed ? aimed.name! : target.name;
      game.event(target, `Scouts report an army of ~${n} from ${k.name} marching toward ${aimed ? aimed.name : 'you'}`);
      // raids are logged when they land (see combat.ts); only full attacks get a muster line
      if (a.action === 'attack') game.log('muster', { a: k.name, b: aimed ? `${target.name} at ${aimed.name}` : target.name, troops: troops(n) }, k.hx, k.hy);
      game.focusOn(k.hx, k.hy);
      done.push(`${a.action === 'raid' ? 'raided' : 'attacked'} ${where} with ${n}`);
    }
  }

  for (const d of o.diplomacy) {
    if (d.type === 'message' || !game.findKingdom(d.to)) continue;
    done.push(`${d.type.replace(/_/g, ' ')} → ${game.findKingdom(d.to)!.name}`);
  }
  const msgs = o.diplomacy.filter((d) => d.type === 'message').length;
  if (msgs) done.push(`sent ${msgs} message${msgs > 1 ? 's' : ''}`);
  k.lastOrders = done.length ? done.join(' · ') : 'gave no orders';
  return rejected;
}
