/**
 * panels.ts — the side panel (kingdom cards + Chronicle / Diplomacy / Debug
 * tabs) and the top bar. Reads game state a few times per second; never
 * writes to the sim except through the callbacks main.ts passes in.
 */
import { CONFIG } from '../config';
import { counts, popCap } from '../sim/kingdom';
import { getPersona } from '../ai/personas';
import { esc } from '../render/tooltip';
import type { Game } from '../sim/game';
import type { ChronEntry, DebugEntry } from '../sim/types';

const BIG = new Set(['betrayal', 'fall', 'fall_other', 'victory', 'alliance', 'war']);
const ALERT = new Set(['attack_win', 'raid', 'starvation', 'field_battle', 'monsters_win', 'god_plague', 'god_meteor', 'god_drought', 'monsters_appear']);

export function chronicleText(game: Game): string {
  const lines = [
    'THE CHRONICLE OF CROWNS',
    `World seed: ${game.setup.seed}`,
    '',
    'The rulers:',
    ...game.kingdoms.map((k) => `  ${k.name} (capital ${k.town}): ${k.useMock ? 'mock AI' : k.model}, ${getPersona(k.personaKey).label}`),
    '',
    ...game.chronicle.map((c) => `${c.when}: ${c.text}`),
    '',
  ];
  return lines.join('\r\n');
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface TopbarControls {
  getSpeed(): number;
  setSpeed(s: number): void;
  isPaused(): boolean;
  togglePause(): void;
  toggleCinematic(): void;
  toggleStats(): void;
  exportChronicle(): void;
  newGame(): void;
  onKingdomClick(id: number): void;
}

export class Panels {
  private chronicleShown = 0;
  private dipShown = 0;
  private debugShown = new WeakSet<DebugEntry>();
  private cardsEl = document.getElementById('cards')!;
  private chronEl = document.getElementById('tab-chronicle')!;
  private dipEl = document.getElementById('tab-diplomacy')!;
  private debugEl = document.getElementById('tab-debug')!;
  private topEl = document.getElementById('topbar')!;
  private chronList!: HTMLElement;
  private dipList!: HTMLElement;
  private debugList!: HTMLElement;

  constructor(
    private game: Game,
    private ctl: TopbarControls,
  ) {
    this.chronEl.innerHTML = `<div class="tabtools"><button class="btn small" id="exportBtn">Export Chronicle (.txt)</button></div><div id="chronList"></div>`;
    this.dipEl.innerHTML = `<div id="dipList"><p class="dim" id="dipEmpty">No envoys have ridden yet.</p></div>`;
    this.debugEl.innerHTML = `<p class="note">Raw prompts and replies per Council Turn (newest first). Your API key is never shown here.</p><div id="debugList"></div>`;
    this.chronList = document.getElementById('chronList')!;
    this.dipList = document.getElementById('dipList')!;
    this.debugList = document.getElementById('debugList')!;
    document.getElementById('exportBtn')!.onclick = () => ctl.exportChronicle();

    document.querySelectorAll<HTMLButtonElement>('#tabs .tab').forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
        document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${t.dataset.tab}`));
      };
    });

    this.topEl.innerHTML = `
      <span class="when" id="tbWhen"></span>
      <span class="group" id="tbSpeed">${CONFIG.sim.speeds.map((s) => `<button class="btn small" data-speed="${s}">${s}×</button>`).join('')}</span>
      <button class="btn small" id="tbPause"></button>
      <span class="countdown" id="tbCountdown"></span>
      <span class="group"><span class="dim">every</span>
        <select id="tbInterval">${[20, 30, 45, 60, 90, 120].map((s) => `<option value="${s}">${s}s</option>`).join('')}</select></span>
      <span class="spacer"></span>
      <span class="dim" title="World seed">seed: ${esc(game.setup.seed)}</span>
      <button class="btn small" id="tbStats" title="Army size graph (G)">Stats</button>
      <button class="btn small" id="tbCine" title="Hide panels for recording (C)">Cinematic</button>
      <button class="btn small" id="tbNew">New age</button>`;
    this.topEl.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => (b.onclick = () => ctl.setSpeed(Number(b.dataset.speed))));
    document.getElementById('tbPause')!.onclick = () => ctl.togglePause();
    document.getElementById('tbCine')!.onclick = () => ctl.toggleCinematic();
    document.getElementById('tbStats')!.onclick = () => ctl.toggleStats();
    document.getElementById('tbNew')!.onclick = () => ctl.newGame();
    const iv = document.getElementById('tbInterval') as HTMLSelectElement;
    if (![...iv.options].some((o) => Number(o.value) === game.setup.councilSec))
      iv.insertAdjacentHTML('beforeend', `<option value="${game.setup.councilSec}">${game.setup.councilSec}s</option>`);
    iv.value = String(game.setup.councilSec);
    iv.onchange = () => {
      game.setup.councilSec = Number(iv.value);
      game.setCouncilInterval(Number(iv.value));
    };
    this.cardsEl.onmousedown = (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.kcard');
      if (card) ctl.onKingdomClick(Number(card.dataset.k));
    };
  }

  update() {
    const g = this.game;
    // ---- top bar ----
    document.getElementById('tbWhen')!.textContent = g.when();
    this.topEl.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.speed) === this.ctl.getSpeed()),
    );
    const pause = document.getElementById('tbPause')!;
    pause.textContent = this.ctl.isPaused() ? '▶ Resume' : '❚❚ Pause';
    pause.classList.toggle('active', this.ctl.isPaused());
    document.getElementById('tbStats')!.classList.toggle('active', !document.body.classList.contains('nostats'));
    const secs = Math.ceil(g.councilCountdown / CONFIG.sim.ticksPerSecond);
    const anyThinking = g.kingdoms.some((k) => k.thinking);
    document.getElementById('tbCountdown')!.textContent = g.over
      ? 'The age has ended'
      : secs <= 0 && anyThinking
        ? 'Council waits for the rulers…'
        : `Council convenes in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${anyThinking ? ' · rulers deliberating…' : ''}`;

    // ---- kingdom cards ----
    this.cardsEl.innerHTML = g.kingdoms
      .map((k) => {
        const c = counts(g, k);
        const persona = getPersona(k.personaKey).label + (k.personaText.trim() ? '*' : '');
        const chips = g.kingdoms
          .filter((o) => o.id !== k.id)
          .map((o) => {
            const rel = o.alive ? g.relations[k.id][o.id] : 'fallen';
            return `<span class="chip ${rel}" style="--cc:${o.color}" title="${esc(o.name)}: ${rel}">${esc(o.name.split(' ')[0])}: ${rel}</span>`;
          })
          .join('');
        const marching = g.armies.filter((a) => a.kingdom === k.id).reduce((s, a) => s + a.soldiers + a.archers, 0);
        const badges = [
          k.droughtTurns > 0 ? `<span class="badge alert">drought</span>` : '',
          k.res.food < 5 && k.alive ? `<span class="badge alert">starving</span>` : '',
          k.morale < CONFIG.economy.lowMoraleThreshold && k.alive ? `<span class="badge alert">low morale</span>` : '',
        ].join('');
        return `<div class="kcard ${k.alive ? '' : 'fallen'}" data-k="${k.id}" style="--kc:${k.color}" title="Click to look at ${esc(k.town)}">
          <div class="khead"><span class="kname">${esc(k.name)}</span>${k.alive ? '' : `<span class="badge">FALLEN ${esc(g.when(k.fellTurn))}</span>`}
            ${k.thinking ? '<span class="thinking">thinking…</span>' : ''} ${badges}</div>
          <div class="kmeta">${esc(k.useMock ? 'mock AI' : k.model)} · ${esc(persona)} · ${esc(k.town)}</div>
          ${
            k.alive
              ? `<div class="krow"><span>Food ${Math.floor(k.res.food)}</span><span>Wood ${Math.floor(k.res.wood)}</span><span>Gold ${Math.floor(k.res.gold)}</span></div>
          <div class="krow"><span title="workers">☺ ${c.workers}</span><span title="soldiers">! ${c.soldiers + c.fieldSoldiers}</span><span title="archers">} ${c.archers + c.fieldArchers}</span>
            <span class="dim">pop ${c.pop}/${popCap(g, k)}</span>${marching ? `<span class="dim">marching ${marching}</span>` : ''}<span class="dim">morale ${Math.round(k.morale)}</span></div>
          <div class="chips">${chips}</div>`
              : ''
          }
          ${k.lastOrders && k.alive ? `<div class="lastorders" title="What this ruler did at the last council">▸ ${esc(k.lastOrders)}</div>` : ''}
          ${k.thoughts ? `<div class="thought">“${esc(k.thoughts)}”</div>` : ''}
        </div>`;
      })
      .join('');

    // ---- chronicle (newest first) ----
    while (this.chronicleShown < g.chronicle.length) {
      this.chronList.prepend(this.chronLine(g.chronicle[this.chronicleShown++]));
    }
    // ---- diplomacy feed ----
    if (this.dipShown < g.dipLog.length) document.getElementById('dipEmpty')?.remove();
    while (this.dipShown < g.dipLog.length) {
      const m = g.dipLog[this.dipShown++];
      const from = m.from < 0 ? null : g.kingdoms[m.from];
      const to = g.kingdoms[m.to];
      const el = document.createElement('div');
      el.className = 'dmsg';
      const sc = from ? from.color : '#b07cff';
      el.innerHTML = `<div class="meta">${esc(g.when(m.turn))} · <span style="color:${sc}">${esc(from ? from.name : 'A mysterious voice')}</span> → <span style="color:${to.color}">${esc(to.name)}</span> · ${esc(m.type.replace(/_/g, ' '))}</div>
        <div class="body" style="--sc:${sc}">${esc(m.text)}</div>`;
      this.dipList.prepend(el);
    }
    // ---- debug ----
    for (const d of g.debug.slice(-30)) {
      if (this.debugShown.has(d)) continue;
      this.debugShown.add(d);
      this.debugList.prepend(this.debugItem(d));
    }
    while (this.debugList.childElementCount > 150) this.debugList.lastElementChild!.remove();
  }

  private chronLine(c: ChronEntry) {
    const el = document.createElement('div');
    el.className = `cline ${BIG.has(c.kind) ? 'big' : ''} ${ALERT.has(c.kind) ? 'alert' : ''}`;
    el.innerHTML = `<span class="when">${esc(c.when)}:</span> <span class="text">${esc(c.text)}</span>`;
    return el;
  }

  private debugItem(d: DebugEntry) {
    const k = this.game.kingdoms[d.kingdom];
    const el = document.createElement('details');
    el.className = 'dbg';
    const flags = [d.error ? `<span class="rej">${esc(d.error)}</span>` : '', d.rejected.length ? `<span class="rej">${d.rejected.length} rejected</span>` : '']
      .filter(Boolean)
      .join(' · ');
    el.innerHTML = `<summary><span style="color:${k.color}">${esc(this.game.when(d.turn))} · ${esc(k.name)}</span> · ${esc(d.model)} · ${d.latencyMs}ms · ~${d.tokensIn}→${d.tokensOut} tok ${flags ? '· ' + flags : ''}</summary>
      ${d.rejected.length ? `<div class="rej">${d.rejected.map(esc).join('<br>')}</div>` : ''}
      <div class="label">Response</div><pre>${esc(d.response || '(none)')}</pre>
      <div class="label">Prompt</div><pre>${esc(d.prompt || '(none)')}</pre>`;
    return el;
  }
}
