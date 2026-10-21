/**
 * renderer.ts — draws the map on a <canvas> as one monospace glyph per tile.
 *
 * Layers:
 *   1. cached terrain + territory tint (re-drawn only when the world changes)
 *   2. buildings, units, armies, march lines, battle/fire markers (every frame)
 * Camera: pan with drag/WASD, zoom with the wheel (CONFIG.render.zoomLevels).
 * Rule from the brief: terrain is dim, kingdoms are bright.
 */
import { CONFIG } from '../config';
import { T } from '../sim/types';
import type { Game } from '../sim/game';

export const FONT = '"JetBrains Mono", "DejaVu Sans Mono", Consolas, "Segoe UI Symbol", monospace';

const TERRAIN_COLOR = ['#1f4a6e', '#8a7a4a', '#3d5a2e', '#2f5a3a', '#6b6b6b'];
const GRASS_GLYPHS = ['.', ',', '"', '.', "'", '.'];
const BUILDING_GLYPH: Record<string, string> = {
  hall: 'Ħ',
  farm: '≡',
  lumber: '¶',
  mine: '☼',
  house: '⌂',
  barracks: 'Ω',
  wall: '#',
};
const ALERT = '#ff7a1a';
const NEUTRAL = '#b07cff';
const BG = '#0b0d10';

function tileHash(i: number) {
  let h = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return h >>> 0;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  game!: Game;
  zoomIdx = CONFIG.render.defaultZoom;
  camX = 0; // top-left corner of the view, in world pixels at the current zoom
  camY = 0;
  hover: { x: number; y: number } | null = null;
  private cache = document.createElement('canvas');
  private cacheKey = '';
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  get ts() {
    return CONFIG.render.zoomLevels[this.zoomIdx];
  }
  get viewW() {
    return this.canvas.width / this.dpr;
  }
  get viewH() {
    return this.canvas.height / this.dpr;
  }

  setGame(game: Game) {
    this.game = game;
    this.cacheKey = '';
    const h = game.kingdoms[0];
    this.centerOnTile(game.world.w / 2, (game.world.h / 2 + h.hy) / 2);
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * this.dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.clamp();
  }

  centerOnTile(tx: number, ty: number) {
    this.camX = (tx + 0.5) * this.ts - this.viewW / 2;
    this.camY = (ty + 0.5) * this.ts - this.viewH / 2;
    this.clamp();
  }
  /** Tile at the centre of the view (fractional). */
  centerTile() {
    return { x: (this.camX + this.viewW / 2) / this.ts, y: (this.camY + this.viewH / 2) / this.ts };
  }

  pan(dx: number, dy: number) {
    this.camX += dx;
    this.camY += dy;
    this.clamp();
  }

  /** Zoom one level in/out keeping the tile under (mx,my) fixed. */
  zoomAt(dir: number, mx: number, my: number) {
    const ni = Math.max(0, Math.min(CONFIG.render.zoomLevels.length - 1, this.zoomIdx + dir));
    if (ni === this.zoomIdx) return;
    const tx = (this.camX + mx) / this.ts;
    const ty = (this.camY + my) / this.ts;
    this.zoomIdx = ni;
    this.camX = tx * this.ts - mx;
    this.camY = ty * this.ts - my;
    this.clamp();
  }

  private clamp() {
    if (!this.game) return;
    const mw = this.game.world.w * this.ts;
    const mh = this.game.world.h * this.ts;
    const margin = 2 * this.ts;
    this.camX = mw + 2 * margin < this.viewW ? (mw - this.viewW) / 2 : Math.max(-margin, Math.min(mw - this.viewW + margin, this.camX));
    this.camY = mh + 2 * margin < this.viewH ? (mh - this.viewH) / 2 : Math.max(-margin, Math.min(mh - this.viewH + margin, this.camY));
  }

  screenToTile(mx: number, my: number) {
    const x = Math.floor((this.camX + mx) / this.ts);
    const y = Math.floor((this.camY + my) / this.ts);
    return this.game.world.inb(x, y) ? { x, y } : null;
  }

  private font(size: number, bold = false) {
    return `${bold ? 'bold ' : ''}${Math.round(size)}px ${FONT}`;
  }

  /** Terrain glyphs + territory tint + borders, cached in an offscreen canvas. */
  private rebuildCache() {
    const { world } = this.game;
    const ts = this.ts;
    const c = this.cache;
    c.width = world.w * ts;
    c.height = world.h * ts;
    const g = c.getContext('2d')!;
    g.fillStyle = BG;
    g.fillRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = this.font(ts * 0.85);
    const colors = this.game.kingdoms.map((k) => k.color);
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const i = world.idx(x, y);
        const own = world.owner[i];
        if (own >= 0) {
          g.fillStyle = hexA(colors[own], CONFIG.render.territoryAlpha);
          g.fillRect(x * ts, y * ts, ts, ts);
          // border line where territory changes hands
          g.fillStyle = hexA(colors[own], 0.45);
          const bw = Math.max(1, ts / 12);
          if (x === 0 || world.owner[i - 1] !== own) g.fillRect(x * ts, y * ts, bw, ts);
          if (x === world.w - 1 || world.owner[i + 1] !== own) g.fillRect((x + 1) * ts - bw, y * ts, bw, ts);
          if (y === 0 || world.owner[i - world.w] !== own) g.fillRect(x * ts, y * ts, ts, bw);
          if (y === world.h - 1 || world.owner[i + world.w] !== own) g.fillRect(x * ts, (y + 1) * ts - bw, ts, bw);
        }
        const t = world.terrain[i];
        const hsh = tileHash(i);
        let glyph = '.';
        if (world.ruins[i]) {
          g.fillStyle = '#5a4a3a';
          glyph = '%';
        } else {
          g.fillStyle = TERRAIN_COLOR[t];
          if (t === T.WATER) glyph = hsh % 3 === 0 ? '~' : '≈';
          else if (t === T.SAND) glyph = hsh % 2 ? '·' : '.';
          else if (t === T.GRASS) glyph = GRASS_GLYPHS[hsh % GRASS_GLYPHS.length];
          else if (t === T.FOREST) glyph = hsh % 4 === 0 ? '♠' : '♣';
          else glyph = hsh % 3 === 0 ? '^' : '▲';
        }
        if (t === T.FOREST && !world.ruins[i] && glyph === '♠') g.fillStyle = '#284d31'; // darker tree variant
        g.fillText(glyph, x * ts + ts / 2, y * ts + ts / 2 + 1);
      }
    }
  }

  draw(now: number) {
    const game = this.game;
    if (!game) return;
    const { ctx } = this;
    const ts = this.ts;
    const key = `${ts}|${game.world.terrainVersion}|${game.world.territoryVersion}`;
    if (key !== this.cacheKey) {
      this.rebuildCache();
      this.cacheKey = key;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    const ox = -Math.round(this.camX);
    const oy = -Math.round(this.camY);
    ctx.drawImage(this.cache, ox, oy);

    const x0 = Math.floor(this.camX / ts) - 1;
    const y0 = Math.floor(this.camY / ts) - 1;
    const x1 = x0 + Math.ceil(this.viewW / ts) + 2;
    const y1 = y0 + Math.ceil(this.viewH / ts) + 2;
    const vis = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const px = (x: number) => ox + x * ts;
    const py = (y: number) => oy + y * ts;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const glyph = (x: number, y: number, ch: string, color: string, opts: { bold?: boolean; bg?: string; scale?: number; alpha?: number } = {}) => {
      if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
      ctx.fillStyle = opts.bg ?? BG;
      ctx.fillRect(px(x), py(y), ts, ts);
      ctx.fillStyle = color;
      ctx.font = this.font(ts * (opts.scale ?? 0.9), opts.bold);
      ctx.fillText(ch, px(x) + ts / 2, py(y) + ts / 2 + 1);
      ctx.globalAlpha = 1;
    };

    // march lines: who is going where
    ctx.lineWidth = Math.max(1, ts / 10);
    ctx.setLineDash([ts / 3, ts / 3]);
    for (const a of game.armies) {
      const t = game.buildings.get(a.targetBuilding);
      const k = a.kingdom >= 0 ? game.kingdoms[a.kingdom] : null;
      const dest = a.action === 'return' && k ? { x: k.hx, y: k.hy } : t;
      if (!dest) continue;
      ctx.strokeStyle = hexA(k ? k.color : NEUTRAL, 0.4);
      ctx.beginPath();
      ctx.moveTo(px(a.x) + ts / 2, py(a.y) + ts / 2);
      ctx.lineTo(px(dest.x) + ts / 2, py(dest.y) + ts / 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const b of game.buildings.values()) {
      if (!vis(b.x, b.y)) continue;
      const k = game.kingdoms[b.kingdom];
      const done = b.buildLeft === 0;
      const isHall = b.type === 'hall';
      glyph(b.x, b.y, BUILDING_GLYPH[b.type], k.color, {
        bold: isHall,
        scale: isHall ? 1.05 : 0.9,
        bg: isHall ? hexA(k.color, 0.28) : BG,
        alpha: done ? (b.type === 'farm' ? 0.75 : 1) : 0.4,
      });
    }

    for (const k of game.kingdoms) {
      for (const u of k.units) {
        if (!vis(u.x, u.y)) continue;
        if (game.world.bld[game.world.idx(u.x, u.y)] && u.type === 'worker') continue; // don't hide buildings
        if (u.type === 'worker') glyph(u.x, u.y, '☺', k.color, { scale: 0.8 });
        else glyph(u.x, u.y, u.type === 'soldier' ? '!' : '}', k.color, { bold: true });
      }
    }

    // armies: a filled square in the kingdom colour with the troop count
    for (const a of game.armies) {
      if (!vis(a.x, a.y)) continue;
      const color = a.kingdom >= 0 ? game.kingdoms[a.kingdom].color : NEUTRAL;
      const n = a.soldiers + a.archers + a.monsters;
      ctx.fillStyle = color;
      ctx.fillRect(px(a.x), py(a.y), ts, ts);
      ctx.fillStyle = '#0b0d10';
      ctx.font = this.font(ts * (n > 9 ? 0.62 : 0.85), true);
      ctx.fillText(a.kingdom >= 0 ? String(Math.min(n, 99)) : n > 9 ? '&' + Math.min(n, 99) : '&' + n, px(a.x) + ts / 2, py(a.y) + ts / 2 + 1);
    }

    const blink = Math.floor(now / 160) % 2 === 0;
    for (const m of game.markers) {
      if (!vis(m.x, m.y)) continue;
      if (m.kind === 'battle') {
        if (blink) glyph(m.x, m.y, 'X', ALERT, { bold: true, scale: 1.1, bg: 'rgba(255,122,26,0.18)' });
      } else {
        glyph(m.x, m.y, '*', Math.floor(now / 90 + m.x) % 2 ? ALERT : '#ffb35a', { bold: true });
      }
    }

    if (this.hover) {
      ctx.strokeStyle = 'rgba(214,217,222,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px(this.hover.x) + 0.5, py(this.hover.y) + 0.5, ts - 1, ts - 1);
    }
  }
}
