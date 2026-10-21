/**
 * prompt.ts — builds the system prompt and the compact state summary
 * (target < ~800 tokens) that each ruler sees on a Council Turn.
 *
 * Fog of war: rivals' armies are only estimates ("~12"), or "unknown" when
 * far away, so bluffing works. Allies share rough numbers.
 */
import { CONFIG } from '../config';
import { buildingsOf, counts, popCap } from '../sim/kingdom';
import type { Game } from '../sim/game';
import type { Kingdom } from '../sim/types';
import { getPersona } from './personas';

export function personaText(k: Kingdom) {
  const base = getPersona(k.personaKey).prompt;
  return k.personaText.trim() ? `${base} Additional character notes: ${k.personaText.trim().slice(0, 400)}` : base;
}

const cost = (c: { food: number; wood: number; gold: number }) =>
  Object.entries(c)
    .filter(([, v]) => v > 0)
    .map(([r, v]) => `${v} ${r}`)
    .join(' + ') || 'free';

export function buildSystemPrompt(game: Game, k: Kingdom): string {
  const B = CONFIG.buildings;
  const U = CONFIG.units;
  const rivals = game.kingdoms.filter((o) => o.id !== k.id).map((o) => o.name).join(' and ');
  return `You are the ruler of the ${k.name}, one of three kingdoms in a medieval strategy game. Your rivals are the ${rivals}.
PERSONA: ${personaText(k)}
GOAL: Survive and become the dominant kingdom. You win by destroying the other town halls, or by being strongest after Year ${CONFIG.sim.maxYears}. Each turn is one season; you give orders once per season.

RULES
- Workers gather automatically. You only set worker_priorities (percent of workers on food/wood/gold).
- Everyone eats ${CONFIG.economy.foodPerPop} food every ${CONFIG.economy.upkeepTicks / CONFIG.sim.ticksPerSecond}s. If food hits 0, people starve. Each soldier/archer is also paid ${CONFIG.economy.goldPerSoldier} gold at the same interval; with no gold, troops desert. Storage holds at most ${CONFIG.economy.storageCap} of each resource; extra is wasted, so spend it.
- Buildings: farm (${cost(B.farm.cost)}, more food), lumber (${cost(B.lumber.cost)}, more wood), mine (${cost(B.mine.cost)}, more gold), house (${cost(B.house.cost)}, +${CONFIG.pop.houseCap} pop cap), barracks (${cost(B.barracks.cost)}, needed to train soldiers/archers), wall (${cost(B.wall.cost)}; ${CONFIG.combat.wallsForBonus}+ walls double archer defense).
- Units: worker (${cost(U.worker.cost)}), soldier (${cost(U.soldier.cost)}, power 3), archer (${cost(U.archer.cost)}, power 2, +2 when defending behind walls). Population cannot exceed cap.
- Armies: "attack" (march on a kingdom, destroy buildings; taking the town hall destroys that kingdom), "raid" (steal resources from an outer building, then return), "defend"/"retreat" (bring all armies home). Attacking someone you are not at war with declares war. You cannot attack an ally; you must break_alliance first (a betrayal everyone will remember).
- Diplomacy types: message, propose_alliance, accept_alliance, break_alliance, declare_war, offer_peace, send_tribute (needs resource + amount), demand_tribute (resource + amount). An alliance forms only when both sides propose/accept within ${CONFIG.diplomacy.proposalWindowTurns} turns. Peace needs both sides to offer_peace.
- Defence: a town hall alone fights like about ${Math.round(CONFIG.buildings.hall.defense / CONFIG.combat.soldierPower)} soldiers, and ALL troops at home (plus workers) defend it. To take a town, send clearly more troops than their estimated army plus ${Math.round(CONFIG.buildings.hall.defense / CONFIG.combat.soldierPower)}. Sending a handful of troops only gets them killed.
- Raids steal resources but burn nothing. Only an "attack" destroys buildings and can end a kingdom.
- Other rulers may lie. Army sizes you see are estimates (a rough range when the rival is far away).

HOW TO RULE (important)
- People are watching this age unfold like a story. Be decisive and act in character every season. A ruler who only builds farms is forgotten.
- If no town hall falls, the strongest kingdom after Year ${CONFIG.sim.maxYears} wins, and soldiers and archers count most toward strength. Peace and hoarding alone will not win.
- A solid plan: farms and a lumber camp first, a barracks by Year 2, then keep training troops. Raids are a cheap way to weaken a rival and steal resources. A big enough army can take a town hall.
- Alliances are tools, not friendships: only one crown can rule in the end, so your ally is also your rival.
- Use diplomacy often: threats, bluffs, offers, demands, and lies all make the story. Even a peaceful ruler defends itself, demands respect, and strikes back when wronged.

RESPOND WITH ONLY VALID JSON matching this schema. No markdown, no code fences, no extra text:
{"thoughts":"1-2 sentences of private reasoning","worker_priorities":{"food":50,"wood":30,"gold":20},"build":[{"type":"farm","count":1}],"train":{"soldier":0,"archer":0,"worker":0},"armies":[{"action":"attack","target":"<kingdom name>","size":10}],"diplomacy":[{"to":"<kingdom name>","type":"message","message":"text"}]}
Use empty arrays when you have nothing to order. Only spend what you have.
Stay in character. Keep diplomacy messages short (max ${CONFIG.diplomacy.maxMessageWords} words). Keep all content PG-13: war is fine, but no gore, slurs, or real-world politics or religions.`;
}

/** Far rivals: only a coarse range like "10-25". */
function rough(n: number) {
  if (n <= 0) return 'none seen';
  const lo = Math.floor((n * 0.6) / 5) * 5;
  const hi = Math.max(5, Math.ceil((n * 1.4) / 5) * 5);
  return `${lo}-${hi}`;
}

function estimate(n: number, rand: () => number) {
  if (n <= 0) return '0';
  const noisy = n * (0.8 + rand() * 0.4);
  return '~' + Math.max(1, Math.round(noisy / 5) * 5 || Math.round(noisy));
}

/** Compact JSON state for one kingdom. Reads (does not clear) events/inbox. */
export function buildStateObject(game: Game, k: Kingdom) {
  const c = counts(game, k);
  const blds: Record<string, number> = {};
  for (const b of buildingsOf(game, k)) {
    if (b.type === 'hall') continue;
    const key = b.buildLeft > 0 ? `${b.type}_building` : b.type;
    blds[key] = (blds[key] ?? 0) + 1;
  }
  const armies = game.armies
    .filter((a) => a.kingdom === k.id)
    .map((a) => ({
      id: 'a' + a.id,
      size: a.soldiers + a.archers,
      doing: a.action === 'return' ? 'returning home' : `${a.action} ${game.kingdoms[a.targetKingdom]?.name ?? ''}`.trim(),
    }));
  const rand = () => game.rng.next();
  const known = game.kingdoms
    .filter((o) => o.id !== k.id)
    .map((o) => {
      if (!o.alive) return { kingdom: o.name, status: 'fallen' };
      const dist = Math.hypot(o.hx - k.hx, o.hy - k.hy);
      const near = dist < CONFIG.diplomacy.nearDistance;
      const rel = game.relations[k.id][o.id];
      const mil = counts(game, o).military;
      return {
        kingdom: o.name,
        relation: rel,
        estimated_army: rel === 'allied' || near ? estimate(mil, rand) : rough(mil),
        buildings_seen: buildingsOf(game, o).filter((b) => b.type !== 'wall').length,
        distance: near ? 'near' : 'far',
      };
    });
  const memTurns = CONFIG.ai.memoryTurns;
  const memory = game.dipLog
    .filter((m) => m.turn >= game.turn - memTurns && (m.from === k.id || m.to === k.id) && m.from !== -1)
    .slice(-10)
    .map((m) => {
      const from = m.from === k.id ? 'you' : game.kingdoms[m.from].name;
      const to = m.to === k.id ? 'you' : game.kingdoms[m.to].name;
      return `${game.when(m.turn)}: ${from} -> ${to} (${m.type}): ${m.text}`;
    });

  // rumoured ranking: true strength with a little noise, strongest first
  const ranking = game.kingdoms
    .filter((o) => o.alive)
    .map((o) => ({ name: o.id === k.id ? `${o.name} (you)` : o.name, s: game.strength(o) * (0.85 + rand() * 0.3) }))
    .sort((a, b) => b.s - a.s)
    .map((o) => o.name);

  return {
    turn: game.turn + 1,
    year: game.year,
    years_left: CONFIG.sim.maxYears - game.year,
    rumoured_strength_ranking: ranking,
    season: game.when().split(', ')[1],
    you: {
      name: k.name,
      resources: { food: Math.floor(k.res.food), wood: Math.floor(k.res.wood), gold: Math.floor(k.res.gold) },
      population: { workers: c.workers, soldiers: c.soldiers + c.fieldSoldiers, archers: c.archers + c.fieldArchers, cap: popCap(game, k), training: k.trainQueue.length },
      troops_at_home: c.soldiers + c.archers,
      buildings: blds,
      armies,
      worker_priorities: k.priorities,
      morale: Math.round(k.morale),
      ...(k.droughtTurns > 0 ? { drought_turns_left: k.droughtTurns } : {}),
    },
    known_world: known,
    recent_events: k.recentEvents.slice(-8),
    inbox: k.inbox.slice(-6),
    your_last_thoughts: k.thoughts || undefined,
    recent_diplomacy: memory,
  };
}
