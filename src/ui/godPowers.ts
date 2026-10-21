/**
 * godPowers.ts — the god powers toolbar. Click a power, then click the map.
 * Bless uses the resource picker; Whisper uses the text box.
 */
import { CONFIG } from '../config';
import { GOD_POWERS, cooldownLeft, useGodPower, type GodPower } from '../sim/events';
import type { Game } from '../sim/game';
import type { Res } from '../sim/types';

export class GodBar {
  selected: GodPower | null = null;
  private el = document.getElementById('godbar')!;
  private hint = document.getElementById('godhint')!;
  private msg!: HTMLElement;

  constructor(private game: Game) {
    this.el.innerHTML = `<span class="label">God powers</span>
      ${GOD_POWERS.map((p) => `<button class="btn gp" data-p="${p.key}" title="${p.hint}">${p.glyph} ${p.label}<span class="cd"></span></button>`).join('')}
      <select id="blessRes" title="Resource to bless with"><option value="food">food</option><option value="wood">wood</option><option value="gold">gold</option></select>
      <input id="whisperText" maxlength="200" placeholder="Whisper text, e.g. The River Folk plan to betray you." />
      <span class="godmsg" id="godmsg"></span>`;
    this.msg = document.getElementById('godmsg')!;
    this.el.querySelectorAll<HTMLButtonElement>('.gp').forEach((b) => {
      b.onclick = () => this.select(this.selected === b.dataset.p ? null : (b.dataset.p as GodPower));
    });
  }

  select(p: GodPower | null) {
    this.selected = p;
    this.el.querySelectorAll<HTMLButtonElement>('.gp').forEach((b) => b.classList.toggle('selected', b.dataset.p === p));
    const info = GOD_POWERS.find((g) => g.key === p);
    this.hint.classList.toggle('hidden', !info);
    if (info) this.hint.textContent = `${info.label}: ${info.hint} (Esc to cancel)`;
  }

  /** Map click. Returns true if a power consumed the click. */
  click(x: number, y: number): boolean {
    if (!this.selected) return false;
    const resource = (document.getElementById('blessRes') as HTMLSelectElement).value as Res;
    const textEl = document.getElementById('whisperText') as HTMLInputElement;
    const err = useGodPower(this.game, this.selected, x, y, { resource, text: textEl.value });
    if (err) {
      this.msg.textContent = err;
    } else {
      this.msg.textContent = '';
      if (this.selected === 'whisper') textEl.value = '';
      this.select(null);
    }
    return true;
  }

  update() {
    this.el.querySelectorAll<HTMLButtonElement>('.gp').forEach((b) => {
      const p = b.dataset.p as GodPower;
      const left = cooldownLeft(this.game, p);
      b.disabled = left > 0 || this.game.over;
      const bar = b.querySelector<HTMLElement>('.cd')!;
      bar.style.width = left > 0 ? `${Math.min(100, (left / CONFIG.god.cooldownSec[p]) * 100)}%` : '0';
      b.title = left > 0 ? `Recharging: ${Math.ceil(left)}s` : GOD_POWERS.find((g) => g.key === p)!.hint;
    });
  }
}
