/**
 * mock.ts — the offline "fake AI". Produces orders in exactly the same JSON
 * shape an LLM would, so they go through the same parse + validation path.
 *
 * It is persona-flavoured (warlords arm early, builders wall up, schemers
 * make and break alliances) so a no-key game is still watchable and lets
 * you balance the economy in config.ts.
 */
import { CONFIG } from '../config';
import { buildingsOf, counts, popCap } from '../sim/kingdom';
import type { Game } from '../sim/game';
import type { Kingdom } from '../sim/types';
import { getPersona } from './personas';

export function mockOrders(game: Game, k: Kingdom): Record<string, unknown> {
  const persona = getPersona(k.personaKey);
  const p = persona.mock;
  const r = () => game.rng.next();
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const c = counts(game, k);
  const cap = popCap(game, k);
  const have: Record<string, number> = {};
  for (const b of buildingsOf(game, k)) have[b.type] = (have[b.type] ?? 0) + 1;
  const n = (t: string) => have[t] ?? 0;
  const turn = game.turn;

  // --- worker priorities ---
  const upkeepPerTurn = c.pop * CONFIG.economy.foodPerPop * (game.councilTicks / CONFIG.economy.upkeepTicks);
  let food = 45;
  let wood = 35;
  let gold = 20 + p.goldLove * 15 + (n('barracks') ? p.military * 15 : 0);
  if (k.res.food < upkeepPerTurn * 1.2) food = 70;
  else if (k.res.food > upkeepPerTurn * 4) food = 30;
  if (k.res.wood > 250) wood = 15;

  // --- buildings (the engine rejects what we cannot afford) ---
  const build: { type: string; count: number }[] = [];
  if (n('farm') < 1 + Math.floor(c.workers / 5)) build.push({ type: 'farm', count: 1 });
  if (c.pop + k.trainQueue.length >= cap - 2) build.push({ type: 'house', count: c.pop > 20 ? 2 : 1 });
  if (n('lumber') < 1 + Math.floor(c.workers / 12)) build.push({ type: 'lumber', count: 1 });
  if (n('mine') < (turn >= 2 ? 1 + Math.floor(c.workers / 14) : 0)) build.push({ type: 'mine', count: 1 });
  if (n('barracks') < 1 && turn >= Math.round(4 - p.military * 4)) build.push({ type: 'barracks', count: 1 });
  if (n('barracks') < 2 && c.pop > 30 && p.military > 0.5) build.push({ type: 'barracks', count: 1 });
  if (n('wall') < 16 && turn >= 3 && r() < p.walls * 0.6) build.push({ type: 'wall', count: 2 });

  // --- training ---
  const train: Record<string, number> = { worker: 0, soldier: 0, archer: 0 };
  if (c.workers < 10 && k.res.food > 80) train.worker = 2;
  if (n('barracks')) {
    const wantMil = c.pop * (0.2 + p.military * 0.45);
    if (c.military < wantMil || r() < p.military * 0.5) {
      train.soldier = Math.round(2 + p.military * 5 * r());
      train.archer = Math.round(1 + (p.walls + 0.3) * 3 * r());
    }
  }

  // --- armies ---
  const armies: { action: string; target: string; size: number }[] = [];
  const others = game.kingdoms.filter((o) => o.alive && o.id !== k.id);
  const notAllied = others.filter((o) => game.relations[k.id][o.id] !== 'allied');
  const atWar = others.filter((o) => game.relations[k.id][o.id] === 'war');
  const home = c.soldiers + c.archers;
  const threatened = game.armies.some((a) => a.targetKingdom === k.id && a.kingdom !== k.id && a.action !== 'return');
  if (threatened && game.armies.some((a) => a.kingdom === k.id && a.action !== 'return') && r() < 0.6) {
    armies.push({ action: 'defend', target: '', size: 0 });
  } else if (notAllied.length && home >= 6) {
    const weakest = [...notAllied].sort((a, b) => game.strength(a) - game.strength(b))[0];
    const target = atWar.length && r() < 0.7 ? pick(atWar) : weakest;
    const theirMil = counts(game, target).military;
    const confident = home * 1.0 > theirMil * (1.3 - p.aggression * 0.6);
    const peaceful = p.aggression < 0.2 && !atWar.includes(target);
    const urge = p.aggression * 0.55 + (atWar.includes(target) ? 0.25 : 0) + Math.min(0.3, turn * 0.008);
    if (!peaceful && confident && r() < urge) {
      const raid = r() < 0.25 + p.goldLove * 0.2;
      armies.push({ action: raid ? 'raid' : 'attack', target: target.name, size: Math.ceil(home * (raid ? 0.5 : 0.85)) });
    }
  }

  // --- diplomacy ---
  const diplomacy: Record<string, unknown>[] = [];
  const say = (to: Kingdom, type: string, extra: Record<string, unknown> = {}) =>
    diplomacy.push({ to: to.name, type, message: pick(persona.lines), ...extra });
  for (const m of k.inbox) {
    const from = game.findKingdom(m.from);
    if (!from || !from.alive) continue;
    const rel = game.relations[k.id][from.id];
    if (m.text.includes('[proposes an alliance]') && rel !== 'war' && r() < p.trust) say(from, 'accept_alliance');
    if (m.text.includes('[offers peace]') && rel === 'war' && r() < 1 - p.aggression * 0.7) say(from, 'offer_peace');
  }
  if (others.length > 1 && !others.some((o) => game.relations[k.id][o.id] === 'allied') && r() < p.trust * 0.3) {
    const cand = others.filter((o) => game.relations[k.id][o.id] === 'neutral');
    if (cand.length) say(pick(cand), 'propose_alliance');
  }
  for (const o of others) {
    if (game.relations[k.id][o.id] === 'allied' && others.length > 1 && r() < p.treachery * 0.25) {
      say(o, 'break_alliance');
      break;
    }
  }
  if (r() < p.aggression * 0.08 && notAllied.length) {
    const t = pick(notAllied);
    if (game.relations[k.id][t.id] === 'neutral') say(t, 'declare_war');
  }
  for (const e of atWar) {
    if (counts(game, e).military > c.military * 1.6 && r() < 0.4) {
      say(e, 'offer_peace');
      if (p.goldLove > 0.6 && k.res.gold > 60) say(e, 'send_tribute', { resource: 'gold', amount: 40 });
    }
  }
  if (r() < 0.3 && others.length) say(pick(others), 'message');
  if (r() < p.aggression * 0.1 && notAllied.length) say(pick(notAllied), 'demand_tribute', { resource: 'gold', amount: 50 });

  return {
    thoughts: pick(persona.thoughts),
    worker_priorities: { food, wood, gold },
    build,
    train,
    armies,
    diplomacy,
  };
}
