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
import { RESOURCES, type Army, type Building, type Kingdom, type Resources } from './types';
import { buildingsOf, counts, destroyBuilding, killHomeUnits, newUnit } from './kingdom';
import { stepAlongPath } from './economy';
import type { Game } from './game';

const C = () => CONFIG.combat;

/** Destroy a building; if it was a town hall, that kingdom falls. */
export function destroyBuildingAndCheck(game: Game, b: Building, by: Kingdom | null) {
  destroyBuilding(game, b);
  if (b.type === 'hall') game.defeat(game.kingdoms[b.kingdom], by);
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
  return a.soldiers + a.archers + a.monsters;
}

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
  let list = buildingsOf(game, tk);
  if (army.action === 'raid') {
    const outer = list.filter((b) => b.type !== 'hall' && b.type !== 'wall');
    if (outer.length) list = outer;
  }
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of list) {
    // attackers favour the hall: it ends the war
    const d = Math.abs(b.x - army.x) + Math.abs(b.y - army.y) - (army.action === 'attack' && b.type === 'hall' ? 12 : 0);
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

    if (army.action === 'return') {
      const k = game.kingdoms[army.kingdom];
      if (!k || !k.alive) {
        removeArmy(game, army);
        continue;
      }
      if (Math.abs(army.x - k.hx) <= 1 && Math.abs(army.y - k.hy) <= 1) {
        disband(game, army, k);
        continue;
      }
      if (army.path.length === 0) {
        const p = world.pathNear(army.x, army.y, k.hx, k.hy);
        if (!p) {
          disband(game, army, k);
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

/** Army arrives home: its troops rejoin the garrison and loot goes to the stores. */
function disband(game: Game, army: Army, k: Kingdom) {
  for (let i = 0; i < army.soldiers; i++) k.units.push(newUnit(game, k, 'soldier', army.x, army.y));
  for (let i = 0; i < army.archers; i++) k.units.push(newUnit(game, k, 'archer', army.x, army.y));
  for (const r of RESOURCES) k.res[r] += army.loot[r];
  removeArmy(game, army);
}

function assaultBuilding(game: Game, army: Army, b: Building) {
  const dk = game.kingdoms[b.kingdom];
  const c = counts(game, dk);
  const walls = buildingsOf(game, dk, 'wall').length >= CONFIG.combat.wallsForBonus;
  const def = {
    soldiers: c.soldiers,
    archers: c.archers,
    monsters: 0,
    workers: b.type === 'hall' ? c.workers : 0,
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
    killHomeUnits(dk, 'soldier', r.dLoss.soldiers, rand) +
    killHomeUnits(dk, 'archer', r.dLoss.archers, rand) +
    killHomeUnits(dk, 'worker', r.dLoss.workers, rand);
  const aDead = r.aLoss.soldiers + r.aLoss.archers + r.aLoss.monsters;
  const fell = aDead + dDead;
  game.markers.push({ x: b.x, y: b.y, ttl: CONFIG.combat.battleMarkerTicks, kind: 'battle' });
  game.focusOn(b.x, b.y);

  const ak = army.kingdom >= 0 ? game.kingdoms[army.kingdom] : null;
  if (ak) ak.stats.unitsLost += aDead;
  const bldName = b.type === 'hall' ? 'town hall' : b.type === 'lumber' ? 'lumber camp' : b.type;

  if (r.attackerWins) {
    if (ak) {
      ak.stats.battlesWon++;
      dk.stats.battlesLost++;
    }
    if (army.action === 'raid' && ak) {
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
      game.log('raid', { a: ak.name, b: dk.name, town: dk.town, bld: bldName, loot: lootText }, b.x, b.y);
      game.event(dk, `${ak.name} raided your ${bldName} and stole ${lootText}`);
      game.event(ak, `Your raid on ${dk.name} won ${lootText}`);
      sendHome(game, army);
      if (b.type !== 'hall') destroyBuildingAndCheck(game, b, ak);
      return;
    }
    if (ak) {
      game.log('attack_win', { a: ak.name, b: dk.name, town: dk.town, bld: bldName, n: fell }, b.x, b.y);
      game.event(dk, `${ak.name} destroyed your ${bldName} (${fell} fell)`);
      game.event(ak, `You destroyed the ${bldName} of ${dk.name} (${fell} fell)`);
    } else {
      game.log('monsters_win', { b: dk.name, town: dk.town, bld: bldName, n: fell }, b.x, b.y);
      game.event(dk, `Wild raiders destroyed your ${bldName}`);
    }
    destroyBuildingAndCheck(game, b, ak);
    army.targetBuilding = -1;
    if (armySize(army) <= 0) removeArmy(game, army);
  } else {
    if (ak) {
      ak.stats.battlesLost++;
      dk.stats.battlesWon++;
      game.log('attack_lose', { a: ak.name, b: dk.name, town: dk.town, n: fell }, b.x, b.y);
      game.event(dk, `You repelled an attack by ${ak.name} (${fell} fell)`);
      game.event(ak, `Your attack on ${dk.name} failed (${fell} fell)`);
      dk.morale = Math.min(100, dk.morale + 5);
      if (armySize(army) <= 0) removeArmy(game, army);
      else sendHome(game, army);
    } else {
      game.log('monsters_lose', { a: dk.name, town: dk.town, n: fell }, b.x, b.y);
      game.event(dk, `You defeated a band of wild raiders`);
      if (armySize(army) <= 0) removeArmy(game, army);
    }
  }
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
      game.log('field_battle', { a: name(a.kingdom), b: name(b.kingdom), w: name(winner.kingdom), n: fell }, a.x, a.y);
      for (const side of [a, b]) {
        if (side.kingdom < 0) continue;
        const k = game.kingdoms[side.kingdom];
        const won = side === winner;
        if (won) k.stats.battlesWon++;
        else k.stats.battlesLost++;
        game.event(k, `Your army ${won ? 'won' : 'lost'} a field battle against ${name((side === a ? b : a).kingdom)} (${fell} fell)`);
      }
      if (loser.kingdom === -1) {
        if (armySize(loser) <= 0) removeArmy(game, loser);
      } else if (armySize(loser) <= 0) removeArmy(game, loser);
      else sendHome(game, loser);
      if (armySize(winner) <= 0) removeArmy(game, winner);
    }
  }
}

/** Raise an army from the home garrison. Returns null if no troops are home. */
export function raiseArmy(game: Game, k: Kingdom, size: number, action: 'attack' | 'raid', target: number) {
  const soldiers = k.units.filter((u) => u.type === 'soldier');
  const archers = k.units.filter((u) => u.type === 'archer');
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
    targetBuilding: -1,
    loot,
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
  };
  game.armies.push(army);
  game.focusOn(x, y);
  game.log('monsters_appear', { n }, x, y);
  return army;
}
