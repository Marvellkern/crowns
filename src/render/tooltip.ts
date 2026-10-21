/**
 * tooltip.ts — describes whatever is on a tile (terrain, owner, building,
 * units, armies) for the hover tooltip.
 */
import { CONFIG } from '../config';
import { TERRAIN_NAMES } from '../sim/types';
import type { Game } from '../sim/game';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const BUILDING_NAMES: Record<string, string> = {
  hall: 'Town hall',
  farm: 'Farm',
  lumber: 'Lumber camp',
  mine: 'Mine',
  house: 'House',
  barracks: 'Barracks',
  wall: 'Wall',
};

export function describeTile(game: Game, x: number, y: number): string {
  const { world } = game;
  const i = world.idx(x, y);
  const lines: string[] = [];
  const kname = (id: number) =>
    id < 0 ? `<span style="color:#b07cff">Wild raiders</span>` : `<span style="color:${game.kingdoms[id].color}">${esc(game.kingdoms[id].name)}</span>`;

  const terrain = world.ruins[i] ? 'ruins' : TERRAIN_NAMES[world.terrain[i]];
  const own = world.owner[i];
  lines.push(`<b>${terrain}</b> <span class="dim">(${x},${y})</span>${own >= 0 ? ' · land of ' + kname(own) : ''}`);

  const b = game.buildings.get(world.bld[i]);
  if (b) {
    const k = game.kingdoms[b.kingdom];
    let s = `${BUILDING_NAMES[b.type]} of ${kname(b.kingdom)} · HP ${Math.max(0, b.hp)}/${b.maxHp}`;
    if (b.type === 'hall') s += ` · capital <b>${esc(k.town)}</b>`;
    if (b.buildLeft > 0) s += ` · <i>building, ${Math.ceil(b.buildLeft / CONFIG.sim.ticksPerSecond)}s left</i>`;
    lines.push(s);
  }

  const here: Record<string, number> = {};
  for (const k of game.kingdoms)
    for (const u of k.units)
      if (u.x === x && u.y === y) {
        const key = `${k.id}|${u.type}`;
        here[key] = (here[key] ?? 0) + 1;
      }
  for (const [key, n] of Object.entries(here)) {
    const [kid, type] = key.split('|');
    lines.push(`${n} ${type}${n > 1 ? 's' : ''} of ${kname(Number(kid))}`);
  }

  for (const a of game.armies) {
    if (a.x !== x || a.y !== y) continue;
    const parts = [];
    if (a.soldiers) parts.push(`${a.soldiers} soldiers`);
    if (a.archers) parts.push(`${a.archers} archers`);
    if (a.monsters) parts.push(`${a.monsters} raiders`);
    const target = a.action === 'return' ? 'returning home' : a.action === 'monster' ? 'rampaging' : `${a.action} → ${esc(game.kingdoms[a.targetKingdom]?.name ?? '?')}`;
    lines.push(`Army of ${kname(a.kingdom)}: ${parts.join(', ')} · ${target}`);
  }
  return lines.join('<br>');
}
