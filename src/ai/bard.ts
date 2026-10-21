/**
 * bard.ts — Bard mode. At the end of each year (and when the age ends) one
 * AI rewrites that year's Chronicle lines as a short paragraph of epic prose.
 *
 * Like the council, it is fire-and-forget: it never blocks the game, and a
 * failed call just leaves that year without a ballad (logged in Debug).
 * Without a key it uses a simple offline bard that stitches the lines.
 */
import { CONFIG } from '../config';
import type { Game } from '../sim/game';
import type { Ballad, ChronEntry } from '../sim/types';
import { chat } from './openrouter';

/** Chronicle kinds worth singing about first when a year was busy. */
const IMPORTANT = ['victory', 'fall', 'fall_other', 'betrayal', 'alliance', 'war', 'peace', 'attack_win', 'raid', 'raid_again', 'field_battle', 'starvation', 'muster'];

export interface BardOptions {
  apiKey: string;
  model: string;
  instant?: boolean; // headless tests: offline bard, synchronous
}

export class Bard {
  constructor(
    private game: Game,
    private opts: BardOptions,
  ) {}

  /** Write the ballad for `year`. Safe to call more than once per year. */
  sing(year: number) {
    const game = this.game;
    if (game.ballads.some((b) => b.year === year)) return;
    const per = CONFIG.sim.seasonsPerYear;
    const lines = game.chronicle.filter((c) => Math.floor(c.turn / per) + 1 === year);
    const ballad: Ballad = { year, text: '', model: this.offline ? 'offline bard' : this.opts.model, pending: true, at: 0 };
    game.ballads.push(ballad);
    if (lines.length === 0) {
      this.finish(ballad, `Year ${year} passed in uneasy quiet. The banners hung still, and the realm held its breath.`);
      return;
    }
    if (this.offline) {
      this.finish(ballad, offlineBallad(year, lines));
      return;
    }
    void this.askModel(ballad, year, lines);
  }

  private get offline() {
    return !this.opts.apiKey || this.opts.model.trim().toLowerCase() === 'mock' || !!this.opts.instant;
  }

  private finish(b: Ballad, text: string) {
    b.text = text;
    b.pending = false;
    b.at = typeof performance !== 'undefined' ? performance.now() : 0;
  }

  private async askModel(ballad: Ballad, year: number, lines: ChronEntry[]) {
    const game = this.game;
    const picked = pickLines(lines, CONFIG.bard.maxLines);
    const system = `You are the royal bard of a fantasy realm with three kingdoms: ${game.kingdoms.map((k) => `the ${k.name}`).join(', ')}.
Rewrite the chronicle of one year as ONE paragraph of epic, slightly dramatic prose, ${CONFIG.bard.minWords}-${CONFIG.bard.maxWords} words, past tense.
Rules: use only the events listed (do not invent battles, deaths, or outcomes); name kingdoms exactly as given; no title, no lists, no markdown, no emojis, no modern slang. Keep it PG-13: war is fine, no gore.`;
    const user = `Chronicle of Year ${year}:\n${picked.map((c) => `- ${c.when.split(', ')[1]}: ${c.text}`).join('\n')}`;
    const t0 = performance.now();
    let text = '';
    let error: string | undefined;
    let tokensIn = Math.ceil((system.length + user.length) / 4);
    let tokensOut = 0;
    try {
      const res = await chat(
        this.opts.apiKey,
        this.opts.model,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { json: false, maxTokens: CONFIG.bard.maxTokens },
      );
      text = cleanProse(res.text);
      tokensIn = res.tokensIn ?? tokensIn;
      tokensOut = res.tokensOut ?? Math.ceil(text.length / 4);
      if (!text) error = 'empty reply';
    } catch (e: any) {
      error = String(e?.message ?? e);
    }
    game.debug.push({
      turn: game.turn,
      kingdom: -1,
      model: this.opts.model,
      latencyMs: Math.round(performance.now() - t0),
      tokensIn,
      tokensOut,
      prompt: `${system}\n\n${user}`,
      response: text,
      rejected: [],
      error,
    });
    // on failure, fall back to the offline bard so the year is never blank
    if (error) ballad.model = 'offline bard (AI bard failed)';
    this.finish(ballad, error ? offlineBallad(year, lines) : text);
  }
}

function pickLines(lines: ChronEntry[], max: number) {
  if (lines.length <= max) return lines;
  const rank = (c: ChronEntry) => {
    const i = IMPORTANT.indexOf(c.kind);
    return i < 0 ? IMPORTANT.length : i;
  };
  const keep = new Set([...lines].sort((a, b) => rank(a) - rank(b)).slice(0, max));
  return lines.filter((c) => keep.has(c)); // keep chronological order
}

/** Strip quotes/markdown and cap the length; keeps the feed tidy and postable. */
function cleanProse(t: string) {
  const words = t
    .replace(/[*_#`>]/g, '')
    .replace(/^["“]|["”]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const capped = words.slice(0, CONFIG.bard.maxWords + 30).join(' ');
  return words.length > CONFIG.bard.maxWords + 30 ? capped + '…' : capped;
}

/** No key: stitch the year's biggest moments into a paragraph. */
function offlineBallad(year: number, lines: ChronEntry[]) {
  const picked = pickLines(lines, 4);
  const openers = ['In those days,', 'Then', 'And so', 'Soon after,'];
  const body = picked
    .map((c, i) => {
      // drop leading exclamations ("Betrayal! ", "War horns sounded: ") so the line joins a sentence
      const s = c.text
        .replace(/\s*\(\d+ fell\)/, '')
        .replace(/^[A-Z][a-z]+( [a-z]+){0,2}[!:]\s+/, '')
        .replace(/\.$/, '');
      const joined = /^(The|A|An|At|Again|War|Wagons|Raiders|Envoys|Steel|Fire|Famine|Wild|Plague) /.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
      return `${openers[i % openers.length]} ${joined}.`;
    })
    .join(' ');
  return `Hear now the tale of Year ${year}. ${body}`.replace(/ the The /g, ' the ');
}
