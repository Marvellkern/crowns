/**
 * council.ts — runs a Council Turn: asks every living ruler for orders IN
 * PARALLEL and applies each kingdom's orders whenever its reply arrives.
 *
 * Nothing here blocks the game loop: calls are fire-and-forget promises.
 * If a ruler is still "thinking" when the next turn comes, it skips that turn.
 * Any failure (bad JSON, timeout, 429, illegal order) becomes "Hold" and is
 * logged, never thrown.
 */
import { CONFIG } from '../config';
import type { Game } from '../sim/game';
import type { DebugEntry, Kingdom } from '../sim/types';
import { executeOrders, sanitizeOrders } from '../sim/orders';
import { buildStateObject, buildSystemPrompt } from './prompt';
import { parseAIResponse } from './parse';
import { mockOrders } from './mock';
import { RateLimitError, chat } from './openrouter';

export interface CouncilOptions {
  apiKey: string;
  /** When true, mock orders are applied synchronously (headless tests). */
  instantMock?: boolean;
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

export class Council {
  constructor(
    private game: Game,
    private opts: CouncilOptions,
  ) {}

  runTurn() {
    for (const k of this.game.kingdoms) {
      if (!k.alive) continue;
      if (k.thinking) {
        this.game.debug.push(this.entry(k, { error: 'still deliberating from last turn; skipped' }));
        continue;
      }
      void this.ask(k);
    }
  }

  private entry(k: Kingdom, part: Partial<DebugEntry>): DebugEntry {
    return {
      turn: this.game.turn,
      kingdom: k.id,
      model: k.useMock ? 'mock' : k.model,
      latencyMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      prompt: '',
      response: '',
      rejected: [],
      ...part,
    };
  }

  private async ask(k: Kingdom) {
    const game = this.game;
    const turnAsked = game.turn;
    const system = buildSystemPrompt(game, k);
    const state = JSON.stringify(buildStateObject(game, k));
    // the ruler has now "read" its mail and news
    k.inbox = [];
    k.recentEvents = [];
    const prompt = `${system}\n\n--- STATE ---\n${state}`;
    const t0 = performance.now();
    k.thinking = true;

    let responseText = '';
    let tokensIn = approxTokens(prompt);
    let tokensOut = 0;
    let error: string | undefined;
    try {
      if (k.useMock || !this.opts.apiKey) {
        if (!this.opts.instantMock) {
          const delay = CONFIG.ai.mockDelayMinMs + Math.random() * (CONFIG.ai.mockDelayMaxMs - CONFIG.ai.mockDelayMinMs);
          await new Promise((r) => setTimeout(r, delay));
        }
        responseText = JSON.stringify(mockOrders(game, k));
        tokensOut = approxTokens(responseText);
      } else {
        const res = await chat(this.opts.apiKey, k.model, [
          { role: 'system', content: system },
          { role: 'user', content: `Current state:\n${state}\n\nGive your orders for this season as JSON only.` },
        ]);
        responseText = res.text;
        if (res.tokensIn) tokensIn = res.tokensIn;
        tokensOut = res.tokensOut ?? approxTokens(responseText);
      }
    } catch (e: any) {
      error = e instanceof RateLimitError ? 'rate limited (429): skipping this turn' : String(e?.message ?? e);
    }
    k.thinking = false;
    const latencyMs = Math.round(performance.now() - t0);
    const entry = this.entry(k, { turn: turnAsked, latencyMs, tokensIn, tokensOut, prompt, response: responseText, error });

    if (!k.alive || game.over) {
      game.debug.push(entry);
      return;
    }
    if (error) {
      this.hold(k, entry);
      return;
    }
    const parsed = parseAIResponse(responseText);
    if (!parsed.ok) {
      entry.error = parsed.error;
      this.hold(k, entry);
      return;
    }
    try {
      entry.rejected = executeOrders(game, k, sanitizeOrders(parsed.value));
    } catch (e: any) {
      // should never happen, but a bad order must never crash the game
      entry.error = 'order execution failed: ' + String(e?.message ?? e);
    }
    game.debug.push(entry);
    if (game.debug.length > 300) game.debug.splice(0, game.debug.length - 300);
  }

  /** The ruler did nothing this turn. */
  private hold(k: Kingdom, entry: DebugEntry) {
    entry.rejected.push('HOLD: no orders applied this turn');
    this.game.debug.push(entry);
    if (!entry.error?.startsWith('rate limited')) this.game.log('council_fail', { a: k.name }, k.hx, k.hy);
    k.thoughts = '(the council could not agree)';
    k.lastOrders = entry.error?.startsWith('rate limited') ? 'skipped this turn (rate limited by the model)' : `held: ${entry.error ?? 'no valid orders'}`.slice(0, 120);
  }
}
