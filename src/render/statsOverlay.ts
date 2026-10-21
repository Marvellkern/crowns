/**
 * statsOverlay.ts — small "army size over time" line chart drawn on its own
 * canvas in the top-left of the map. Made for clips: shows who is winning at
 * a glance, in normal and cinematic mode. Toggle with the Stats button or G.
 *
 * One sample per season (game.history) plus a live point for "now".
 * Lines are labelled at their ends so identity never relies on colour alone.
 */
import type { Game } from '../sim/game';
import { FONT } from './renderer';

const W = 300;
const H = 156;
const PAD = { l: 30, r: 74, t: 30, b: 20 };
const TEXT = '#d6d9de';
const DIM = '#7a818c';
const GRID = '#2a2f37';

export class StatsOverlay {
  private ctx: CanvasRenderingContext2D;
  private hoverX: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
    });
    canvas.addEventListener('pointerleave', () => (this.hoverX = null));
  }

  draw(game: Game) {
    const { ctx } = this;
    const series = [...game.history.map((h) => ({ turn: h.turn, army: h.army })), { turn: game.turn + 0.5, army: game.armySizes() }];
    const n = series.length;
    const max = Math.max(10, ...series.flatMap((s) => s.army));
    const top = Math.ceil(max / 10) * 10;
    const pw = W - PAD.l - PAD.r;
    const ph = H - PAD.t - PAD.b;
    const minT = series[0].turn;
    const maxT = Math.max(minT + 1, series[n - 1].turn);
    const x = (t: number) => PAD.l + ((t - minT) / (maxT - minT)) * pw;
    const y = (v: number) => PAD.t + ph - (v / top) * ph;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(11,13,16,0.86)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = GRID;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // title
    ctx.font = `bold 12px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = TEXT;
    ctx.fillText('Army size', 8, 17);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = DIM;
    ctx.fillText('soldiers + archers', 88, 17);

    // recessive grid + y labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, top / 2, top]) {
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(PAD.l, Math.round(y(v)) + 0.5);
      ctx.lineTo(PAD.l + pw, Math.round(y(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = DIM;
      ctx.fillText(String(v), PAD.l - 5, y(v));
    }
    // x labels: first and current year
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(`Y${Math.floor(minT / 4) + 1}`, PAD.l, H - 6);
    ctx.textAlign = 'right';
    ctx.fillText(`Y${game.year}`, PAD.l + pw, H - 6);

    // lines (2px), one per kingdom, in fixed kingdom colours
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    const ends: { k: number; y: number; v: number }[] = [];
    game.kingdoms.forEach((k, i) => {
      ctx.strokeStyle = k.color;
      ctx.globalAlpha = k.alive ? 1 : 0.45;
      ctx.beginPath();
      let lastV = 0;
      let lastT = minT;
      series.forEach((s, j) => {
        // stop a fallen kingdom's line at its fall
        if (!k.alive && s.turn > k.fellTurn + 0.5) return;
        const px = x(s.turn);
        const py = y(s.army[i] ?? 0);
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        lastV = s.army[i] ?? 0;
        lastT = s.turn;
      });
      ctx.stroke();
      // end marker with a surface ring
      ctx.beginPath();
      ctx.arc(x(lastT), y(lastV), 4, 0, Math.PI * 2);
      ctx.fillStyle = k.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0b0d10';
      ctx.stroke();
      ctx.globalAlpha = 1;
      ends.push({ k: i, y: y(lastV), v: lastV });
    });

    // direct labels at the right edge, nudged apart so they never overlap
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const e of ends) {
      const k = game.kingdoms[e.k];
      const lx = PAD.l + pw + 8;
      ctx.fillStyle = k.color;
      ctx.fillRect(lx, e.y - 4, 8, 8);
      ctx.fillStyle = k.alive ? TEXT : DIM;
      ctx.fillText(`${k.name.split(' ')[0]} ${k.alive ? e.v : '†'}`, lx + 12, e.y);
    }

    // hover crosshair + values for that season
    if (this.hoverX !== null && this.hoverX >= PAD.l && this.hoverX <= PAD.l + pw && n > 1) {
      const t = minT + ((this.hoverX - PAD.l) / pw) * (maxT - minT);
      let best = series[0];
      for (const s of series) if (Math.abs(s.turn - t) < Math.abs(best.turn - t)) best = s;
      const hx = x(best.turn);
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, PAD.t);
      ctx.lineTo(Math.round(hx) + 0.5, PAD.t + ph);
      ctx.stroke();
      const label =
        (best === series[n - 1] ? 'Now: ' : game.when(Math.round(best.turn)) + ': ') +
        game.kingdoms.map((k, i) => `${k.name.split(' ')[0]} ${best.army[i] ?? 0}`).join(' · ');
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(11,13,16,0.95)';
      ctx.fillRect(4, PAD.t - 12, W - 8, 13);
      ctx.fillStyle = TEXT;
      ctx.fillText(label, 8, PAD.t - 2);
    }
  }
}
