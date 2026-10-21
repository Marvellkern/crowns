/**
 * events.ts — god powers (player tools) and random world events.
 *
 * Every god power has a cooldown (CONFIG.god.cooldownSec), is written to the
 * Chronicle, and shows up in the affected AI's `recent_events` next turn so
 * the rulers can react to it.
 */
import { CONFIG } from '../config';
import { T, type Kingdom, type Res } from './types';
import { counts, killHomeUnits } from './kingdom';
import { destroyBuildingAndCheck, spawnMonsters } from './combat';
import { cleanText } from './diplomacy';
import type { Game } from './game';

export type GodPower = 'bless' | 'drought' | 'plague' | 'monsters' | 'whisper' | 'meteor';

export const GOD_POWERS: { key: GodPower; label: string; glyph: string; hint: string }[] = [
  { key: 'bless', label: 'Bless', glyph: '✦', hint: 'Click a kingdom: +100 of a resource' },
  { key: 'drought', label: 'Drought', glyph: '☀', hint: 'Click a kingdom: farms yield half for 2 turns' },
  { key: 'plague', label: 'Plague', glyph: '☣', hint: 'Click a kingdom: 20% of its people die' },
  { key: 'monsters', label: 'Raiders', glyph: '&', hint: 'Click a tile: wild raiders appear and attack' },
  { key: 'whisper', label: 'Whisper', glyph: '“', hint: 'Click a kingdom: send a mysterious message' },
  { key: 'meteor', label: 'Meteor', glyph: '☄', hint: 'Click a tile: destroy a 3×3 area' },
];

/** Seconds (game time) until a power can be used again. 0 = ready. */
export function cooldownLeft(game: Game, p: GodPower) {
  return Math.max(0, ((game.godReadyAt[p] ?? 0) - game.tick) / CONFIG.sim.ticksPerSecond);
}

/** The kingdom a click "means": owner of the tile, else the nearest living hall. */
export function kingdomAt(game: Game, x: number, y: number): Kingdom | null {
  const own = game.world.owner[game.world.idx(x, y)];
  if (own >= 0 && game.kingdoms[own].alive) return game.kingdoms[own];
  let best: Kingdom | null = null;
  let bd = Infinity;
  for (const k of game.kingdoms) {
    if (!k.alive) continue;
    const d = Math.hypot(k.hx - x, k.hy - y);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return bd < 20 ? best : null;
}

/** Use a god power at tile (x,y). Returns an error string, or null on success. */
export function useGodPower(game: Game, p: GodPower, x: number, y: number, opts: { resource?: Res; text?: string } = {}): string | null {
  if (game.over) return 'The age has ended.';
  if (!game.world.inb(x, y)) return 'Outside the world.';
  if (cooldownLeft(game, p) > 0) return `${p} is still recharging.`;
  const G = CONFIG.god;
  const needsKingdom = p === 'bless' || p === 'drought' || p === 'plague' || p === 'whisper';
  const k = kingdomAt(game, x, y);
  if (needsKingdom && !k) return 'Click on or near a kingdom.';

  switch (p) {
    case 'bless': {
      const res = opts.resource ?? 'food';
      k!.res[res] += G.blessAmount;
      game.event(k!, `A divine blessing granted you ${G.blessAmount} ${res}`);
      game.log('god_bless', { a: k!.name, n: G.blessAmount, res }, k!.hx, k!.hy);
      break;
    }
    case 'drought':
      k!.droughtTurns = G.droughtTurns;
      game.event(k!, `A drought struck: your farms yield half for ${G.droughtTurns} turns`);
      game.log('god_drought', { a: k!.name }, k!.hx, k!.hy);
      break;
    case 'plague': {
      const c = counts(game, k!);
      const n = Math.max(1, Math.round(c.pop * G.plaguePct));
      let died = killHomeUnits(k!, 'any', n, () => game.rng.next());
      // armies in the field suffer too if home could not absorb it
      for (const a of game.armies) {
        if (a.kingdom !== k!.id || died >= n) continue;
        const take = Math.min(a.soldiers, n - died);
        a.soldiers -= take;
        died += take;
      }
      game.event(k!, `Plague killed ${died} of your people`);
      game.log('god_plague', { a: k!.name, town: k!.town, n: died }, k!.hx, k!.hy);
      k!.morale = Math.max(0, k!.morale - 10);
      break;
    }
    case 'whisper': {
      const text = cleanText(opts.text ?? '', 40);
      if (!text) return 'Type a message to whisper first.';
      k!.inbox.push({ from: 'A mysterious voice', text: `A mysterious voice says: ${text}` });
      game.dipLog.push({ turn: game.turn, from: -1, to: k!.id, type: 'whisper', text });
      game.log('god_whisper', { a: k!.name }, k!.hx, k!.hy);
      break;
    }
    case 'monsters': {
      const spot = nearestPassable(game, x, y);
      if (!spot) return 'No ground there for raiders to stand on.';
      spawnMonsters(game, spot.x, spot.y, G.monsterCount);
      break;
    }
    case 'meteor':
      meteor(game, x, y);
      break;
  }
  game.godReadyAt[p] = game.tick + G.cooldownSec[p] * CONFIG.sim.ticksPerSecond;
  return null;
}

function nearestPassable(game: Game, x: number, y: number) {
  const { world } = game;
  for (let r = 0; r < 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (world.inb(nx, ny) && world.passable(world.idx(nx, ny))) return { x: nx, y: ny };
      }
  return null;
}

function meteor(game: Game, x: number, y: number) {
  const { world } = game;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!world.inb(nx, ny)) continue;
      const i = world.idx(nx, ny);
      if (world.terrain[i] === T.FOREST || world.terrain[i] === T.GRASS) world.terrain[i] = T.SAND;
      game.markers.push({ x: nx, y: ny, ttl: CONFIG.combat.fireTicks, kind: 'fire' });
      const b = game.buildings.get(world.bld[i]);
      if (b) {
        b.hp -= CONFIG.god.meteorDamage;
        if (b.hp <= 0) destroyBuildingAndCheck(game, b, null);
      }
      for (const k of game.kingdoms) {
        const before = k.units.length;
        k.units = k.units.filter((u) => !(u.x === nx && u.y === ny));
        k.stats.unitsLost += before - k.units.length;
      }
      for (const a of game.armies)
        if (a.x === nx && a.y === ny) {
          a.soldiers = Math.floor(a.soldiers / 2);
          a.archers = Math.floor(a.archers / 2);
          a.monsters = Math.floor(a.monsters / 2);
        }
    }
  game.armies = game.armies.filter((a) => a.soldiers + a.archers + a.monsters > 0);
  world.terrainVersion++;
  const k = kingdomAt(game, x, y);
  game.focusOn(x, y);
  game.log('god_meteor', { place: k ? `the lands of the ${k.name}` : 'the wilds' }, x, y);
  if (k) game.event(k, 'A meteor struck your lands');
}

/** Called once per Council Turn: occasional wild raiders appear. */
export function randomTurnEvents(game: Game) {
  const R = CONFIG.randomEvents;
  if (game.turn < R.firstTurn || !game.rng.chance(R.monsterChancePerTurn)) return;
  const { world } = game;
  for (let tries = 0; tries < 50; tries++) {
    const x = game.rng.int(4, world.w - 5);
    const y = game.rng.int(4, world.h - 5);
    if (!world.passable(world.idx(x, y)) || world.owner[world.idx(x, y)] !== -1) continue;
    spawnMonsters(game, x, y, R.monsterCount + Math.floor(game.turn / 12));
    return;
  }
}
