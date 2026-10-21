/**
 * diplomacy.ts — relations between kingdoms: messages, alliances, betrayals,
 * war, peace, and tribute.
 *
 * Rules:
 *  - An alliance forms only when both sides propose/accept within
 *    CONFIG.diplomacy.proposalWindowTurns turns.
 *  - Allies cannot attack each other. Breaking an alliance (or declaring
 *    war on an ally) is a betrayal and gets a big Chronicle line.
 *  - Peace forms when both sides offer_peace within the window.
 */
import { CONFIG } from '../config';
import { RESOURCES, type Kingdom, type Res } from './types';
import type { Game } from './game';

export const DIP_TYPES = [
  'message',
  'propose_alliance',
  'accept_alliance',
  'break_alliance',
  'declare_war',
  'offer_peace',
  'send_tribute',
  'demand_tribute',
] as const;
export type DipType = (typeof DIP_TYPES)[number];

export interface DipOrder {
  to: string;
  type: DipType;
  message: string;
  resource?: Res;
  amount?: number;
}

/** Strip control chars, collapse whitespace, cap words. Keeps the feed tidy and postable. */
export function cleanText(text: unknown, maxWords = CONFIG.diplomacy.maxMessageWords): string {
  if (typeof text !== 'string') return '';
  const words = text
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const out = words.slice(0, maxWords).join(' ');
  return (words.length > maxWords ? out + '…' : out).slice(0, 220);
}

export function setRelation(game: Game, a: number, b: number, rel: 'neutral' | 'allied' | 'war') {
  game.relations[a][b] = rel;
  game.relations[b][a] = rel;
  game.proposals = game.proposals.filter((p) => !((p.from === a && p.to === b) || (p.from === b && p.to === a)));
}

function pending(game: Game, from: number, to: number, kind: 'alliance' | 'peace') {
  return game.proposals.some(
    (p) => p.from === from && p.to === to && p.kind === kind && game.turn - p.turn <= CONFIG.diplomacy.proposalWindowTurns,
  );
}

export function declareWar(game: Game, a: Kingdom, b: Kingdom) {
  const rel = game.relations[a.id][b.id];
  if (rel === 'war') return;
  if (rel === 'allied') betray(game, a, b);
  setRelation(game, a.id, b.id, 'war');
  game.log('war', { a: a.name, b: b.name }, b.hx, b.hy);
  game.event(b, `${a.name} declared war on you`);
}

function betray(game: Game, a: Kingdom, b: Kingdom) {
  a.stats.betrayals++;
  setRelation(game, a.id, b.id, 'neutral');
  game.log('betrayal', { a: a.name, b: b.name }, a.hx, a.hy);
  game.event(b, `${a.name} BROKE its alliance with you`);
  game.focusOn(a.hx, a.hy);
}

export function applyDiplomacy(game: Game, from: Kingdom, d: DipOrder, rejected: string[]) {
  const to = game.findKingdom(d.to);
  if (!to || to.id === from.id) {
    rejected.push(to ? `${from.name}: cannot send diplomacy to itself` : `${from.name}: diplomacy to unknown kingdom "${d.to}"`);
    return;
  }
  if (!to.alive) {
    rejected.push(`${from.name}: ${to.name} has fallen; message not delivered`);
    return;
  }
  const rel = game.relations[from.id][to.id];
  const say = (prefix: string) => {
    const text = d.message ? `${prefix}${d.message}` : prefix.replace(/: $/, '');
    to.inbox.push({ from: from.name, text });
    game.dipLog.push({ turn: game.turn, from: from.id, to: to.id, type: d.type, text: d.message || prefix.replace(/: $/, '') });
  };

  switch (d.type) {
    case 'message':
      if (!d.message) return;
      say('');
      return;
    case 'propose_alliance':
    case 'accept_alliance':
      if (rel === 'allied') return;
      say(d.type === 'propose_alliance' ? '[proposes an alliance] ' : '[accepts the alliance] ');
      if (pending(game, to.id, from.id, 'alliance')) {
        setRelation(game, from.id, to.id, 'allied');
        game.log('alliance', { a: from.name, b: to.name }, from.hx, from.hy);
        game.event(to, `Alliance with ${from.name} is now in force`);
        game.event(from, `Alliance with ${to.name} is now in force`);
      } else {
        game.proposals.push({ from: from.id, to: to.id, kind: 'alliance', turn: game.turn });
      }
      return;
    case 'break_alliance':
      if (rel !== 'allied') {
        rejected.push(`${from.name}: cannot break an alliance with ${to.name} (not allied)`);
        return;
      }
      say('[breaks the alliance] ');
      betray(game, from, to);
      return;
    case 'declare_war':
      if (rel === 'war') return;
      say('[declares war] ');
      declareWar(game, from, to);
      return;
    case 'offer_peace':
      if (rel !== 'war') return;
      say('[offers peace] ');
      if (pending(game, to.id, from.id, 'peace')) {
        setRelation(game, from.id, to.id, 'neutral');
        game.log('peace', { a: from.name, b: to.name }, from.hx, from.hy);
        game.event(to, `Peace with ${from.name} has been made`);
        game.event(from, `Peace with ${to.name} has been made`);
        // armies marching on each other turn back
        for (const a of game.armies)
          if ((a.kingdom === from.id && a.targetKingdom === to.id) || (a.kingdom === to.id && a.targetKingdom === from.id)) {
            a.action = 'return';
            a.path = [];
          }
      } else {
        game.proposals.push({ from: from.id, to: to.id, kind: 'peace', turn: game.turn });
      }
      return;
    case 'send_tribute': {
      const res = d.resource && RESOURCES.includes(d.resource) ? d.resource : 'gold';
      const want = Math.floor(Math.max(0, Math.min(Number(d.amount) || 0, CONFIG.diplomacy.maxTributePerOrder)));
      const amount = Math.floor(Math.min(want, from.res[res]));
      if (amount <= 0) {
        rejected.push(`${from.name} tried to send ${want} ${res} to ${to.name}, had ${Math.floor(from.res[res])}`);
        return;
      }
      if (amount < want) rejected.push(`${from.name} tried to send ${want} ${res}, could only send ${amount}`);
      from.res[res] -= amount;
      to.res[res] += amount;
      say(`[sends ${amount} ${res}] `);
      game.log('tribute', { a: from.name, b: to.name, n: amount, res }, to.hx, to.hy);
      game.event(to, `${from.name} sent you ${amount} ${res}`);
      return;
    }
    case 'demand_tribute': {
      const res = d.resource && RESOURCES.includes(d.resource) ? d.resource : 'gold';
      const amount = Math.floor(Math.max(0, Math.min(Number(d.amount) || 50, CONFIG.diplomacy.maxTributePerOrder)));
      say(`[demands ${amount} ${res}] `);
      game.log('tribute_demand', { a: from.name, b: to.name, n: amount, res }, to.hx, to.hy);
      return;
    }
  }
}
