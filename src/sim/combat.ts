/**
 * combat.ts — army movement, battle resolution, building capture, and
 * kingdom defeat.
 *
 * Battles are auto-resolved:
 *   power = soldiers*3 + archers*2 (+ archers*2 if defending behind walls)
 *   times a random factor 0.8–1.2. The loser takes most casualties, the
 *   winner takes some (more if the fight was close).
 */
import { CONFIG } from '../config';
import { RESOURCES, type Army, type Building, type Kingdom, type Resources, type Unit } from './types';
import { buildingsOf, destroyBuilding, newUnit } from './kingdom';
import { stepAlongPath } from './economy';
import { isSettlement, localUnits, loseSettlement, nearestSettlement, returnSettlers, settlementsOf, settlersArrive } from './towns';
import type { Game } from './game';

const C = () => CONFIG.combat;

/** Destroy a building. A settlement is "lost" instead (capital moves, or the kingdom falls). */
export function destroyBuildingAndCheck(game: Game, b: Building, by: Kingdom | null) {
  if (isSettlement(b)) loseSettlement(game, b, by);
  else destroyBuilding(game, b);
}

export interface Side {
  soldiers: number;
  archers: number;
  monsters: number;
  workers: number;
  flat: number;
  walls: boolean;
}

export function power(s: Side) {
  const c = C();
  return (
    s.soldiers * c.soldierPower +
    s.archers * c.archerPower +
    (s.walls ? s.archers * c.archerWallBonus : 0) +
    s.monsters * c.monsterPower +
    s.workers * c.workerPower +
    s.flat
  );
}

/** Fractional casualties rounded randomly so small armies still lose people. */
function lose(n: number, frac: number, rand: () => number) {
  const exact = n * frac;
  return Math.min(n, Math.floor(exact) + (rand() < exact - Math.floor(exact) ? 1 : 0));
}

export function resolve(att: Side, def: Side, rand: () => number) {
  const c = C();
  const pa = power(att) * (c.randomMin + rand() * (c.randomMax - c.randomMin));
  const pd = power(def) * (c.randomMin + rand() * (c.randomMax - c.randomMin));
  const attackerWins = pa > pd;
  const [wp, lp] = attackerWins ? [pa, pd] : [pd, pa];
  const loserFrac = c.loserLossMin + rand() * (c.loserLossMax - c.loserLossMin);
  const winnerFrac = Math.min(0.6, c.winnerLossScale * (lp / Math.max(1, wp)) * (0.7 + rand() * 0.5));
  const fa = attackerWins ? winnerFrac : loserFrac;
  const fd = attackerWins ? loserFrac : winnerFrac;
  return {
    attackerWins,
    aLoss: { soldiers: lose(att.soldiers, fa, rand), archers: lose(att.archers, fa, rand), monsters: lose(att.monsters, fa, rand) },
    dLoss: {
      soldiers: lose(def.soldiers, fd, rand),
      archers: lose(def.archers, fd, rand),
      monsters: lose(def.monsters, fd, rand),
      workers: lose(def.workers, fd * 0.5, rand),
    },
  };
}

export function armySize(a: Army) {
  return a.soldiers + a.archers + a.monsters + a.settlers;
}
/** Troops that can actually fight (settlers cannot). */
const fighters = (a: Army) => a.soldiers + a.archers + a.monsters;

/** True if the two parties will fight on contact. */
export function hostile(game: Game, a: number, b: number) {
  if (a === b) return false;
  if (a === -1 || b === -1) return true;
  return game.relations[a][b] === 'war';
}

function pickTarget(game: Game, army: Army): Building | null {
  const alive = (id: number) => id >= 0 && game.kingdoms[id]?.alive;
  if (army.action === 'monster') {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of game.buildings.values()) {
      if (!alive(b.kingdom)) continue;
      const d = Math.abs(b.x - army.x) + Math.abs(b.y - army.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }
  const tk = game.kingdoms[army.targetKingdom];
  if (!tk || !tk.alive) return null;
  // attacks go for settlements (to capture them); raids hit outlying buildings
  let list = army.action === 'attack' ? settlementsOf(game, tk) : buildingsOf(game, tk);
  if (army.action === 'raid') {
    const outer = list.filter((b) => !isSettlement(b) && b.type !== 'wall');
    if (outer.length) list = outer;
  }
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of list) {
    const d = Math.abs(b.x - army.x) + Math.abs(b.y - army.y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

export function sendHome(game: Game, army: Army) {
  army.action = 'return';
  army.targetBuilding = -1;
  army.path = [];
}

export function updateArmies(game: Game) {
  const { world } = game;
  for (const army of [...game.armies]) {
    if (!game.armies.includes(army)) continue;
    const isMonster = army.kingdom === -1;
    stepAlongPath(game, army, isMonster ? CONFIG.movement.monster : CONFIG.movement.army);

    if (army.action === 'settle') {
      const k = game.kingdoms[army.kingdom];
      if (!k || !k.alive) {
        removeArmy(game, army);
        continue;
      }
      if (Math.abs(army.x - army.tx) <= 1 && Math.abs(army.y - army.ty) <= 1) {
        settlersArrive(game, army);
        continue;
      }
      if (army.path.length === 0) {
        const p = world.pathNear(army.x, army.y, army.tx, army.ty);
        if (!p) returnSettlers(game, army);
        else army.path = p;
      }
      continue;
    }

    if (army.action === 'return' || army.action === 'station') {
      const k = game.kingdoms[army.kingdom];
      if (!k || !k.alive) {
        removeArmy(game, army);
        continue;
      }
      // station: march to one of our towns; return: go to the nearest settlement
      let dest = army.action === 'station' ? game.buildings.get(army.targetBuilding) : undefined;
      if (!dest || dest.kingdom !== k.id) {
        army.action = 'return';
        dest = nearestSettlement(game, k, army.x, army.y) ?? undefined;
      }
      if (!dest) {
        removeArmy(game, army);
        continue;
      }
      if (Math.abs(army.x - dest.x) <= 1 && Math.abs(army.y - dest.y) <= 1) {
        disband(game, army, k, dest);
        continue;
      }
      if (army.path.length === 0) {
        const p = world.pathNear(army.x, army.y, dest.x, dest.y);
        if (!p) {
          disband(game, army, k, dest);
          continue;
        }
        army.path = p;
      }
      continue;
    }

    // attack / raid / monster: stop if the war ended or the target is gone
    if (!isMonster) {
      const tk = game.kingdoms[army.targetKingdom];
      if (!tk || !tk.alive || game.relations[army.kingdom][army.targetKingdom] === 'allied') {
        sendHome(game, army);
        continue;
      }
    }
    let target = game.buildings.get(army.targetBuilding);
    if (!target || (isMonster && !game.kingdoms[target.kingdom]?.alive)) {
      const t = pickTarget(game, army);
      if (!t) {
        if (isMonster) removeArmy(game, army);
        else sendHome(game, army);
        continue;
      }
      target = t;
      army.targetBuilding = t.id;
      army.path = [];
    }
    if (Math.abs(army.x - target.x) <= 1 && Math.abs(army.y - target.y) <= 1) {
      assaultBuilding(game, army, target);
      continue;
    }
    if (army.path.length === 0) {
      const p = world.pathNear(army.x, army.y, target.x, target.y);
      if (!p) {
        if (isMonster) removeArmy(game, army);
        else sendHome(game, army);
        continue;
      }
      army.path = p;
    }
  }
  fieldBattles(game);
}

function removeArmy(game: Game, army: Army) {
  const i = game.armies.indexOf(army);
  if (i >= 0) game.armies.splice(i, 1);
}

/** Army arrives at a settlement: its troops join that garrison and loot goes to the stores. */
function disband(game: Game, army: Army, k: Kingdom, post: Building) {
  const add = (type: 'soldier' | 'archer') => {
    const u = newUnit(game, k, type, army.x, army.y);
    u.post = post.id;
    k.units.push(u);
  };
  for (let i = 0; i < army.soldiers; i++) add('soldier');
  for (let i = 0; i < army.archers; i++) add('archer');
  for (const r of RESOURCES) k.res[r] += army.loot[r];
  removeArmy(game, army);
}

/** Remove n units of a type from a given pool (and from the kingdom). */
function killFrom(k: Kingdom, pool: Unit[], type: Unit['type'], n: number, rand: () => number) {
  let killed = 0;
  let candidates = pool.filter((u) => u.type === type);
  while (killed < n && candidates.length) {
    const v = candidates[Math.floor(rand() * candidates.length)];
    candidates = candidates.filter((u) => u !== v);
    k.units.splice(k.units.indexOf(v), 1);
    killed++;
  }
  k.stats.unitsLost += killed;
  return killed;
}

function assaultBuilding(game: Game, army: Army, b: Building) {
  const dk = game.kingdoms[b.kingdom];
  // only troops (and, at a settlement, townsfolk) near the building defend it
  const local = localUnits(dk, b.x, b.y);
  const nearCapital = Math.max(Math.abs(b.x - dk.hx), Math.abs(b.y - dk.hy)) <= CONFIG.wallRadius + 2;
  const walls = nearCapital && buildingsOf(game, dk, 'wall').length >= CONFIG.combat.wallsForBonus;
  const def = {
    soldiers: local.filter((u) => u.type === 'soldier').length,
    archers: local.filter((u) => u.type === 'archer').length,
    monsters: 0,
    workers: isSettlement(b) ? local.filter((u) => u.type === 'worker').length : 0,
    flat: CONFIG.buildings[b.type].defense,
    walls,
  };
  const att = { soldiers: army.soldiers, archers: army.archers, monsters: army.monsters, workers: 0, flat: 0, walls: false };
  const r = resolve(att, def, () => game.rng.next());
  army.soldiers -= r.aLoss.soldiers;
  army.archers -= r.aLoss.archers;
  army.monsters -= r.aLoss.monsters;
  const rand = () => game.rng.next();
  const dDead =
    killFrom(dk, local, 'soldier', r.dLoss.soldiers, rand) +
    killFrom(dk, local, 'archer', r.dLoss.archers, rand) +
    killFrom(dk, local, 'worker', r.dLoss.workers, rand);
  const aDead = r.aLoss.soldiers + r.aLoss.archers + r.aLoss.monsters;
  const fell = aDead + dDead;
  game.markers.push({ x: b.x, y: b.y, ttl: CONFIG.combat.battleMarkerTicks, kind: 'battle' });
  game.focusOn(b.x, b.y);

  const ak = army.kingdom >= 0 ? game.kingdoms[army.kingdom] : null;
  if (ak) ak.stats.unitsLost += aDead;
  const bldName = isSettlement(b) ? (b.name ?? 'town') : b.type === 'lumber' ? 'lumber camp' : b.type;
  const fellText = fellSuffix(fell);
  // what each side brought, so rulers learn why they won or lost
  const odds = `your ${troops(att.soldiers + att.archers)} vs ${troops(def.soldiers + def.archers)} defending${isSettlement(b) ? ` plus the walls of ${bldName} itself` : ''}`;

  if (r.attackerWins) {
    if (ak) {
      ak.stats.battlesWon++;
      dk.stats.battlesLost++;
    }
    if (army.action === 'raid' && ak) {
      // raids steal and leave; burning buildings is what attacks are for
      const loot: string[] = [];
      for (const res of RESOURCES) {
        const take = Math.floor(Math.min(dk.res[res], CONFIG.combat.raidSteal[res]));
        if (take > 0) {
          dk.res[res] -= take;
          army.loot[res] += take;
          loot.push(`${take} ${res}`);
        }
      }
      const lootText = loot.length ? loot.join(', ') : 'nothing of worth';
      logRaid(game, ak, dk, bldName, lootText, b);
      game.event(dk, `${ak.name} raided your ${bldName} and stole ${lootText}`);
      game.event(ak, `Your raid on ${dk.name} won ${lootText} (${odds})`);
      sendHome(game, army);
      return;
    }
    if (ak && isSettlement(b)) {
      // capture: the town, its buildings and its people change hands
      const wasCapital = b.type === 'hall';
      game.log(wasCapital ? 'capital_captured' : 'town_captured', { a: ak.name, b: dk.name, town: bldName, fell: fellText }, b.x, b.y);
      game.event(dk, `${ak.name} captured ${bldName}${wasCapital ? ', your capital!' : ''}${fellText}`);
      game.event(ak, `You captured ${bldName} from ${dk.name} (${odds}). Your army now garrisons it.`);
      for (const o of game.kingdoms) if (o.alive && o !== ak && o !== dk) game.event(o, `${ak.name} captured ${bldName} from ${dk.name}`);
      loseSettlement(game, b, ak);
      if (fighters(army) > 0) disband(game, army, ak, b);
      else removeArmy(game, army);
      return;
    }
    if (!ak && isSettlement(b)) {
      // raiders cannot hold a town: they plunder it and melt away
      const loot: string[] = [];
      for (const res of RESOURCES) {
        const take = Math.floor(Math.min(dk.res[res], CONFIG.combat.raidSteal[res]));
        if (take > 0) {
          dk.res[res] -= take;
          loot.push(`${take} ${res}`);
        }
      }
      game.log('monsters_sack', { town: bldName, b: dk.name, loot: loot.join(', ') || 'little of worth', fell: fellText }, b.x, b.y);
      game.event(dk, `Wild raiders sacked ${bldName} and stole ${loot.join(', ') || 'little'}`);
      removeArmy(game, army);
      return;
    }
    if (ak) {
      game.log('attack_win', { a: ak.name, b: dk.name, town: dk.town, bld: bldName, fell: fellText }, b.x, b.y);
      game.event(dk, `${ak.name} destroyed your ${bldName}${fellText}`);
      game.event(ak, `You destroyed the ${bldName} of ${dk.name} (${odds})`);
    } else {
      // one Chronicle line per raider band, not one per building
      const burned = (monsterBurns.get(army) ?? 0) + 1;
      monsterBurns.set(army, burned);
      if (burned === 1) game.log('monsters_win', { b: dk.name, town: dk.town, bld: bldName, fell: fellText }, b.x, b.y);
      game.event(dk, `Wild raiders destroyed your ${bldName}`);
    }
    destroyBuildingAndCheck(game, b, ak);
    army.targetBuilding = -1;
    if (armySize(army) <= 0) removeArmy(game, army);
  } else {
    if (ak) {
      ak.stats.battlesLost++;
      dk.stats.battlesWon++;
      game.log('attack_lose', { a: ak.name, b: dk.name, town: isSettlement(b) ? bldName : dk.town, fell: fellText }, b.x, b.y);
      game.event(dk, `You repelled an attack by ${ak.name}${fellText}`);
      game.event(ak, `Your attack on ${dk.name} failed: ${odds}. Bring a bigger army.`);
      dk.morale = Math.min(100, dk.morale + 5);
      if (armySize(army) <= 0) removeArmy(game, army);
      else sendHome(game, army);
    } else {
      // beaten raiders scatter: the band is gone, one line
      const burned = monsterBurns.get(army) ?? 0;
      game.log(burned ? 'monsters_lose_after' : 'monsters_lose', { a: dk.name, town: dk.town, burned: burned === 1 ? 'a building' : `${burned} buildings` }, b.x, b.y);
      game.event(dk, `You defeated a band of wild raiders`);
      removeArmy(game, army);
    }
  }
}

/** Buildings burned per raider band (for one-line Chronicle summaries). */
const monsterBurns = new WeakMap<Army, number>();

/** "" for no deaths, " (3 fell)" otherwise. */
export function fellSuffix(n: number) {
  return n > 0 ? ` (${n} fell)` : '';
}
/** "1 soldier" / "12 troops" / "no troops". */
export function troops(n: number) {
  return n <= 0 ? 'no troops' : n === 1 ? '1 soldier' : `${n} troops`;
}

/** Repeated raids on the same kingdom are summarised instead of logged every time. */
function logRaid(game: Game, ak: Kingdom, dk: Kingdom, bldName: string, lootText: string, b: Building) {
  const key = `${ak.id}>${dk.id}`;
  const prev = game.raidStreaks.get(key);
  const count = prev && game.turn - prev.turn <= 2 ? prev.count + 1 : 1;
  game.raidStreaks.set(key, { count, turn: game.turn });
  if (count === 1) game.log('raid', { a: ak.name, b: dk.name, town: dk.town, bld: bldName, loot: lootText }, b.x, b.y);
  else if (count % 3 === 0) game.log('raid_again', { a: ak.name, b: dk.name, town: dk.town, n: count, nth: ordinal(count), loot: lootText }, b.x, b.y);
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

/** Hostile armies that meet in the open fight it out. */
function fieldBattles(game: Game) {
  const list = game.armies;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!hostile(game, a.kingdom, b.kingdom)) continue;
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) continue;
      if (armySize(a) <= 0 || armySize(b) <= 0) continue;
      // a war band that catches settlers on the road cuts them down
      if (!fighters(a) || !fighters(b)) {
        const prey = !fighters(a) ? a : b;
        const hunter = prey === a ? b : a;
        if (!fighters(hunter) || !prey.settlers) continue;
        const pk = game.kingdoms[prey.kingdom];
        const hunterName = hunter.kingdom === -1 ? 'wild raiders' : `the ${game.kingdoms[hunter.kingdom].name}`;
        game.log('settlers_lost', { a: pk.name, b: hunterName, town: prey.townName }, prey.x, prey.y);
        game.event(pk, `Your settlers bound for ${prey.townName} were killed by ${hunterName}`);
        pk.stats.unitsLost += prey.settlers;
        game.markers.push({ x: prey.x, y: prey.y, ttl: CONFIG.combat.battleMarkerTicks, kind: 'battle' });
        removeArmy(game, prey);
        continue;
      }
      const sa = { soldiers: a.soldiers, archers: a.archers, monsters: a.monsters, workers: 0, flat: 0, walls: false };
      const sb = { soldiers: b.soldiers, archers: b.archers, monsters: b.monsters, workers: 0, flat: 0, walls: false };
      const r = resolve(sa, sb, () => game.rng.next());
      a.soldiers -= r.aLoss.soldiers;
      a.archers -= r.aLoss.archers;
      a.monsters -= r.aLoss.monsters;
      b.soldiers -= r.dLoss.soldiers;
      b.archers -= r.dLoss.archers;
      b.monsters -= r.dLoss.monsters;
      const fell =
        r.aLoss.soldiers + r.aLoss.archers + r.aLoss.monsters + r.dLoss.soldiers + r.dLoss.archers + r.dLoss.monsters;
      const name = (id: number) => (id === -1 ? 'wild raiders' : game.kingdoms[id].name);
      const winner = r.attackerWins ? a : b;
      const loser = r.attackerWins ? b : a;
      game.markers.push({ x: a.x, y: a.y, ttl: CONFIG.combat.battleMarkerTicks, kind: 'battle' });
      game.focusOn(a.x, a.y);
      game.log('field_battle', { a: name(a.kingdom), b: name(b.kingdom), w: name(winner.kingdom), fell: fellSuffix(fell) }, a.x, a.y);
      for (const side of [a, b]) {
        if (side.kingdom < 0) continue;
        const k = game.kingdoms[side.kingdom];
        const won = side === winner;
        if (won) k.stats.battlesWon++;
        else k.stats.battlesLost++;
        game.event(k, `Your army ${won ? 'won' : 'lost'} a field battle against ${name((side === a ? b : a).kingdom)} (${fell} fell)`);
      }
      if (loser.kingdom === -1) removeArmy(game, loser); // beaten raiders scatter
      else if (armySize(loser) <= 0) removeArmy(game, loser);
      else sendHome(game, loser);
      if (armySize(winner) <= 0) removeArmy(game, winner);
    }
  }
}

/** Raise an army from the home garrison. Returns null if no troops are home. */
export function raiseArmy(game: Game, k: Kingdom, size: number, action: 'attack' | 'raid' | 'station', target: number, targetBuilding = -1) {
  // muster from the capital garrison first, then from further away
  const byDist = (u: Unit) => Math.abs(u.x - k.hx) + Math.abs(u.y - k.hy);
  const soldiers = k.units.filter((u) => u.type === 'soldier').sort((p, q) => byDist(p) - byDist(q));
  const archers = k.units.filter((u) => u.type === 'archer').sort((p, q) => byDist(p) - byDist(q));
  // keep a mix: take soldiers first, then archers
  const takeS = Math.min(soldiers.length, Math.ceil(size * 0.65));
  const takeA = Math.min(archers.length, size - takeS);
  const extraS = Math.min(soldiers.length - takeS, size - takeS - takeA);
  const s = takeS + Math.max(0, extraS);
  const a = takeA;
  if (s + a <= 0) return null;
  for (const u of soldiers.slice(0, s)) k.units.splice(k.units.indexOf(u), 1);
  for (const u of archers.slice(0, a)) k.units.splice(k.units.indexOf(u), 1);
  const loot: Resources = { food: 0, wood: 0, gold: 0 };
  const army: Army = {
    id: game.nextId++,
    kingdom: k.id,
    soldiers: s,
    archers: a,
    monsters: 0,
    x: k.hx,
    y: k.hy,
    path: [],
    moveCd: 0,
    action,
    targetKingdom: target,
    targetBuilding,
    loot,
    settlers: 0,
    tx: 0,
    ty: 0,
    townName: '',
  };
  game.armies.push(army);
  return army;
}

/** Send settlers (taken from the workers) to found a town at (tx,ty). */
export function sendSettlers(game: Game, k: Kingdom, tx: number, ty: number, townName: string) {
  const byDist = (u: Unit) => Math.abs(u.x - k.hx) + Math.abs(u.y - k.hy);
  const workers = k.units.filter((u) => u.type === 'worker').sort((p, q) => byDist(p) - byDist(q));
  const n = Math.min(CONFIG.towns.settlers, workers.length);
  for (const u of workers.slice(0, n)) k.units.splice(k.units.indexOf(u), 1);
  const army: Army = {
    id: game.nextId++,
    kingdom: k.id,
    soldiers: 0,
    archers: 0,
    monsters: 0,
    x: k.hx,
    y: k.hy,
    path: [],
    moveCd: 0,
    action: 'settle',
    targetKingdom: -1,
    targetBuilding: -1,
    loot: { food: 0, wood: 0, gold: 0 },
    settlers: n,
    tx,
    ty,
    townName,
  };
  game.armies.push(army);
  return army;
}

export function spawnMonsters(game: Game, x: number, y: number, n: number) {
  const army: Army = {
    id: game.nextId++,
    kingdom: -1,
    soldiers: 0,
    archers: 0,
    monsters: n,
    x,
    y,
    path: [],
    moveCd: 0,
    action: 'monster',
    targetKingdom: -1,
    targetBuilding: -1,
    loot: { food: 0, wood: 0, gold: 0 },
    settlers: 0,
    tx: 0,
    ty: 0,
    townName: '',
  };
  game.armies.push(army);
  game.focusOn(x, y);
  game.log('monsters_appear', { n }, x, y);
  return army;
}
