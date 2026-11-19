/**
 * towns.ts — settlements: a kingdom's capital ('hall') plus any towns it
 * founds or captures.
 *
 * - Settlers (an Army with action 'settle') walk to a chosen site and found
 *   a named town there.
 * - Every non-settlement building "belongs" to its kingdom's nearest
 *   settlement. When an army captures a settlement, that settlement, its
 *   buildings and its workers switch sides.
 * - Losing the capital is not the end: the kingdom flees to its next town.
 *   A kingdom falls only when it holds no settlements at all.
 */
import { CONFIG } from '../config';
import { T, type Army, type Building, type Kingdom } from './types';
import { destroyBuilding, newUnit, placeBuilding, recomputeTerritory } from './kingdom';
import { townName } from '../data/chronicle';
import type { Game } from './game';

export const isSettlement = (b: Building) => b.type === 'hall' || b.type === 'town';

export function settlementsOf(game: Game, k: Kingdom): Building[] {
  const out: Building[] = [];
  for (const b of game.buildings.values()) if (b.kingdom === k.id && isSettlement(b)) out.push(b);
  return out;
}

export function allSettlements(game: Game): Building[] {
  const out: Building[] = [];
  for (const b of game.buildings.values()) if (isSettlement(b)) out.push(b);
  return out;
}

/** The kingdom's settlement closest to (x,y). */
export function nearestSettlement(game: Game, k: Kingdom, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of game.buildings.values()) {
    if (b.kingdom !== k.id || !isSettlement(b)) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Forgiving town-name lookup ("ashford", "Ashford", "the town of Ashford"). */
export function findSettlement(game: Game, name: string): Building | null {
  const n = name.toLowerCase().replace(/^(the )?(town|city|capital) of /, '').trim();
  if (!n) return null;
  const all = allSettlements(game);
  return all.find((b) => b.name?.toLowerCase() === n) ?? all.find((b) => !!b.name && n.includes(b.name.toLowerCase())) ?? null;
}

export function newTownName(game: Game) {
  return townName(() => game.rng.next(), game.takenNames);
}

/** Non-settlement buildings whose nearest settlement (of the same kingdom) is `s`. */
export function dependentsOf(game: Game, s: Building): Building[] {
  const k = game.kingdoms[s.kingdom];
  const out: Building[] = [];
  for (const b of game.buildings.values()) {
    if (b.kingdom !== s.kingdom || isSettlement(b)) continue;
    if (nearestSettlement(game, k, b.x, b.y) === s) out.push(b);
  }
  return out;
}

/** Garrison troops of `k` within defendRadius of (x,y). */
export function localUnits(k: Kingdom, x: number, y: number, radius = CONFIG.towns.defendRadius) {
  return k.units.filter((u) => Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) <= radius);
}

/** "the central plains", "the northern reaches", ... (for Chronicle lines). */
export function regionName(game: Game, x: number, y: number) {
  const { w, h } = game.world;
  const dx = (x - w / 2) / (w / 2);
  const dy = (y - h / 2) / (h / 2);
  if (Math.hypot(dx, dy) < 0.3) return 'the central plains';
  const ns = dy < -0.3 ? 'north' : dy > 0.3 ? 'south' : '';
  const ew = dx < -0.3 ? 'west' : dx > 0.3 ? 'east' : '';
  const dir = ns && ew ? `${ns}${ew}ern` : ns ? `${ns}ern` : `${ew}ern`;
  const land = game.world.terrain[game.world.idx(x, y)] === T.SAND ? 'shores' : 'reaches';
  return `the ${dir} ${land}`;
}

/**
 * Pick where settlers should go. `toward` biases the choice: "center"
 * (default), a rival kingdom's name (expand toward them), or a compass
 * direction. Returns null if nowhere suitable is reachable.
 */
export function chooseTownSite(game: Game, k: Kingdom, toward = 'center'): { x: number; y: number } | null {
  const { world } = game;
  const TW = CONFIG.towns;
  const own = settlementsOf(game, k);
  const all = allSettlements(game);
  const t = toward.toLowerCase();
  let goal = { x: world.w / 2, y: world.h / 2 };
  const rival = game.findKingdom(toward);
  if (rival && rival.id !== k.id && rival.alive) goal = { x: rival.hx, y: rival.hy };
  else if (/north/.test(t)) goal = { x: k.hx, y: 0 };
  else if (/south/.test(t)) goal = { x: k.hx, y: world.h };
  else if (/west/.test(t)) goal = { x: 0, y: k.hy };
  else if (/east/.test(t)) goal = { x: world.w, y: k.hy };

  const cands: { x: number; y: number; score: number }[] = [];
  for (let y = 3; y < world.h - 3; y += 2) {
    for (let x = 3; x < world.w - 3; x += 2) {
      const i = world.idx(x, y);
      const ter = world.terrain[i];
      if ((ter !== T.GRASS && ter !== T.SAND) || world.bld[i]) continue;
      if (world.owner[i] !== -1 && world.owner[i] !== k.id) continue;
      if (all.some((s) => Math.hypot(s.x - x, s.y - y) < TW.minSpacing)) continue;
      const near = Math.min(...own.map((s) => Math.hypot(s.x - x, s.y - y)));
      if (near > TW.maxDistance) continue;
      // resources around the site
      let rich = 0;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (!world.inb(x + dx, y + dy)) continue;
          const tt = world.terrain[world.idx(x + dx, y + dy)];
          if (tt === T.FOREST || tt === T.MOUNTAIN) rich += 1;
          else if (tt === T.GRASS) rich += 0.3;
          else if (tt === T.WATER) rich -= 0.2;
        }
      const score = Math.min(rich, 30) - near * 0.25 - Math.hypot(goal.x - x, goal.y - y) * 0.45;
      cands.push({ x, y, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 6)) {
    if (world.pathNear(k.hx, k.hy, c.x, c.y)) return c;
  }
  return null;
}

/** Settlers arrive: found the town (or find a nearby spot if theirs was taken). */
export function settlersArrive(game: Game, army: Army) {
  const k = game.kingdoms[army.kingdom];
  const { world } = game;
  let spot: { x: number; y: number } | null = null;
  const free = (x: number, y: number) => {
    if (!world.inb(x, y)) return false;
    const i = world.idx(x, y);
    const ter = world.terrain[i];
    if ((ter !== T.GRASS && ter !== T.SAND) || world.bld[i]) return false;
    if (world.owner[i] !== -1 && world.owner[i] !== k.id) return false;
    return !allSettlements(game).some((s) => Math.hypot(s.x - x, s.y - y) < CONFIG.towns.minSpacing - 3);
  };
  for (let r = 0; r <= 4 && !spot; r++)
    for (let dy = -r; dy <= r && !spot; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (free(army.tx + dx, army.ty + dy)) {
          spot = { x: army.tx + dx, y: army.ty + dy };
          break;
        }
  if (!spot) {
    // the land was claimed first: they trudge home and rejoin the workforce
    game.event(k, `Your settlers bound for ${army.townName} found the land taken and returned`);
    returnSettlers(game, army);
    return;
  }
  const town = placeBuilding(game, k, 'town', spot.x, spot.y);
  town.name = army.townName;
  for (let i = 0; i < army.settlers; i++) {
    const u = newUnit(game, k, 'worker', spot.x, spot.y);
    u.post = town.id;
    k.units.push(u);
  }
  k.stats.townsFounded++;
  game.log('town_founded', { a: k.name, town: town.name, where: regionName(game, spot.x, spot.y) }, spot.x, spot.y);
  game.event(k, `Your settlers founded ${town.name}. It has no garrison yet.`);
  for (const o of game.kingdoms) if (o.alive && o.id !== k.id) game.event(o, `${k.name} founded a new town, ${town.name}`);
  game.focusOn(spot.x, spot.y);
  removeFromArmies(game, army);
}

/** Settlers give up: they become workers again at their nearest settlement. */
export function returnSettlers(game: Game, army: Army) {
  const k = game.kingdoms[army.kingdom];
  const home = k ? nearestSettlement(game, k, army.x, army.y) : null;
  if (k && home)
    for (let i = 0; i < army.settlers; i++) {
      const u = newUnit(game, k, 'worker', army.x, army.y);
      u.post = home.id;
      k.units.push(u);
    }
  removeFromArmies(game, army);
}

function removeFromArmies(game: Game, army: Army) {
  const i = game.armies.indexOf(army);
  if (i >= 0) game.armies.splice(i, 1);
}

/**
 * A settlement is lost. With `by` set, it is captured: it and its buildings
 * and workers switch to `by`. With `by` null (a meteor), it is destroyed.
 * Either way, losing the capital moves the capital, or ends the kingdom.
 */
export function loseSettlement(game: Game, s: Building, by: Kingdom | null) {
  const loser = game.kingdoms[s.kingdom];
  const wasCapital = s.type === 'hall';
  const deps = dependentsOf(game, s);
  const name = s.name ?? loser.town;

  if (by) {
    s.kingdom = by.id;
    s.type = 'town';
    for (const b of deps) b.kingdom = by.id;
    // the townsfolk now serve the conqueror; beaten troops nearby flee
    for (const u of localUnits(loser, s.x, s.y)) {
      if (u.type !== 'worker') continue;
      loser.units.splice(loser.units.indexOf(u), 1);
      u.kingdom = by.id;
      u.post = s.id;
      u.state = 'idle';
      u.path = [];
      u.siteId = -1;
      u.carry = 0;
      by.units.push(u);
    }
    by.stats.townsTaken++;
    recomputeTerritory(game);
    game.world.terrainVersion++; // redraw so the captured buildings change colour
  } else {
    destroyBuilding(game, s);
  }

  const remaining = settlementsOf(game, loser);
  if (remaining.length === 0) {
    loser.town = name;
    game.defeat(loser, by);
    return;
  }
  // anyone posted at the lost settlement falls back to the nearest one left
  for (const u of loser.units) if (u.post === s.id) u.post = nearestSettlement(game, loser, u.x, u.y)!.id;
  if (wasCapital) {
    const next = [...remaining].sort((a, b) => dependentsOf(game, b).length - dependentsOf(game, a).length)[0];
    next.type = 'hall';
    loser.hallId = next.id;
    loser.hx = next.x;
    loser.hy = next.y;
    loser.town = next.name ?? loser.town;
    loser.morale = Math.max(0, loser.morale - CONFIG.towns.capitalLossMorale);
    game.log('capital_moved', { a: loser.name, town: loser.town, old: name }, next.x, next.y);
    game.event(loser, `Your capital ${name} was lost. ${loser.town} is your new capital.`);
  }
}
