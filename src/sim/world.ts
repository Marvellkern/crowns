/**
 * world.ts — the tile map: seeded terrain generation, per-tile ownership,
 * ruins, and BFS pathfinding.
 *
 * Tiles are stored in flat typed arrays indexed by i = y * w + x.
 * Water and mountains are impassable; everything else (including tiles with
 * buildings on them) can be walked on.
 */
import { CONFIG } from '../config';
import { T } from './types';
import { Rng } from './rng';

export class World {
  readonly w: number;
  readonly h: number;
  terrain: Uint8Array;
  /** Kingdom id that owns this tile's territory, -1 = nobody. */
  owner: Int8Array;
  /** 1 = ruins of a destroyed building. */
  ruins: Uint8Array;
  /** Building id on this tile, 0 = none. */
  bld: Int32Array;
  /** Bumped whenever terrain/ruins change so the renderer can redraw caches. */
  terrainVersion = 0;
  territoryVersion = 0;

  // pathfinding scratch buffers (reused to avoid allocations)
  private prev: Int32Array;
  private seen: Uint32Array;
  private stamp = 1;
  private queue: Int32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.terrain = new Uint8Array(n);
    this.owner = new Int8Array(n).fill(-1);
    this.ruins = new Uint8Array(n);
    this.bld = new Int32Array(n);
    this.prev = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.queue = new Int32Array(n);
  }

  idx(x: number, y: number) {
    return y * this.w + x;
  }
  inb(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  passable(i: number) {
    const t = this.terrain[i];
    return t !== T.WATER && t !== T.MOUNTAIN;
  }

  /**
   * Breadth-first search (8 directions) from (sx,sy) to the nearest tile that
   * satisfies `goal`. Returns the list of tile indices to walk (excluding the
   * start), [] if already at the goal, or null if unreachable.
   */
  findPath(sx: number, sy: number, goal: (i: number) => boolean, maxNodes = 12000): number[] | null {
    const start = this.idx(sx, sy);
    if (goal(start)) return [];
    const stamp = ++this.stamp;
    const { w, h } = this;
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.seen[start] = stamp;
    this.prev[start] = -1;
    let visited = 0;
    while (head < tail) {
      const cur = this.queue[head++];
      if (++visited > maxNodes) return null;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (this.seen[ni] === stamp) continue;
          this.seen[ni] = stamp;
          if (goal(ni)) {
            this.prev[ni] = cur;
            const path: number[] = [];
            let p = ni;
            while (p !== start) {
              path.push(p);
              p = this.prev[p];
            }
            return path.reverse();
          }
          if (!this.passable(ni)) continue;
          this.prev[ni] = cur;
          this.queue[tail++] = ni;
        }
      }
    }
    return null;
  }

  /** Path to any tile within 1 step of (tx,ty). */
  pathNear(sx: number, sy: number, tx: number, ty: number): number[] | null {
    return this.findPath(sx, sy, (i) => {
      const x = i % this.w;
      const y = (i - x) / this.w;
      return Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1 && this.passable(i);
    });
  }
}

// ---------- noise ----------
function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s);
  const b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s);
  const d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, oct = 4) {
  let sum = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, s + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Build a world: noise terrain, then make three fair starting zones and a
 * resource-rich neutral middle, with land corridors so everyone can reach
 * everyone. Returns the world and the 3 town hall positions.
 */
export function generateWorld(w: number, h: number, seed: number, kingdoms = 3) {
  const world = new World(w, h);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const m = CONFIG.map;
  const cx = w / 2;
  const cy = h / 2;
  const s = seed % 100000;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let e = fbm(x / m.noiseScale, y / m.noiseScale, s);
      const moist = fbm(x / (m.noiseScale * 0.8) + 500, y / (m.noiseScale * 0.8) + 500, s + 7);
      // sink the edges into the sea
      const d = Math.max(Math.abs(x - cx) / cx, Math.abs(y - cy) / cy);
      e -= Math.max(0, d - 0.78) * 1.6;
      let t: number = T.GRASS;
      if (e < m.waterLevel) t = T.WATER;
      else if (e < m.sandLevel) t = T.SAND;
      else if (e > m.mountainLevel) t = T.MOUNTAIN;
      else if (moist > m.forestMoisture) t = T.FOREST;
      world.terrain[world.idx(x, y)] = t;
    }
  }

  const set = (x: number, y: number, t: number, onlyIf?: (old: number) => boolean) => {
    if (!world.inb(x, y)) return;
    const i = world.idx(x, y);
    if (!onlyIf || onlyIf(world.terrain[i])) world.terrain[i] = t;
  };
  const blob = (bx: number, by: number, r: number, t: number) => {
    for (let y = Math.floor(by - r); y <= by + r; y++)
      for (let x = Math.floor(bx - r); x <= bx + r; x++) {
        const dd = Math.hypot(x - bx, y - by);
        if (dd <= r - rng.next() * 0.8) set(x, y, t);
      }
  };

  // three start points on an ellipse around the centre
  const starts: { x: number; y: number }[] = [];
  const rx = w * 0.33;
  const ry = h * 0.32;
  const base = -Math.PI / 2 + rng.range(-0.2, 0.2);
  for (let k = 0; k < kingdoms; k++) {
    const a = base + (k * Math.PI * 2) / kingdoms;
    starts.push({ x: Math.round(cx + Math.cos(a) * rx), y: Math.round(cy + Math.sin(a) * ry) });
  }

  // fair starting zones: cleared land, a forest patch and an ore (mountain) patch nearby
  for (const st of starts) {
    const r = m.startClearRadius;
    for (let y = st.y - r - 1; y <= st.y + r + 1; y++)
      for (let x = st.x - r - 1; x <= st.x + r + 1; x++) {
        if (Math.hypot(x - st.x, y - st.y) <= r + 0.5) set(x, y, T.GRASS);
        else set(x, y, T.GRASS, (o) => o === T.WATER || o === T.MOUNTAIN);
      }
    // point resource patches away from the centre so they are "home" resources
    const away = Math.atan2(st.y - cy, st.x - cx);
    blob(st.x + Math.cos(away + 1.1) * 5, st.y + Math.sin(away + 1.1) * 5, 2.6, T.FOREST);
    blob(st.x + Math.cos(away - 1.1) * 6, st.y + Math.sin(away - 1.1) * 6, 1.8, T.MOUNTAIN);
  }

  // rich neutral middle: open ground with extra forest and ore
  for (let y = Math.floor(cy - 4); y <= cy + 4; y++)
    for (let x = Math.floor(cx - 6); x <= cx + 6; x++) set(x, y, T.GRASS, (o) => o === T.WATER);
  for (let i = 0; i < 6; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = rng.range(4, 10);
    blob(cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d, rng.range(1.5, 2.5), i % 2 ? T.MOUNTAIN : T.FOREST);
  }
  // keep the very centre walkable after blobs
  for (let y = Math.floor(cy - 1); y <= cy + 1; y++)
    for (let x = Math.floor(cx - 1); x <= cx + 1; x++) set(x, y, T.GRASS);

  // land corridors from each start to the centre (fords over water, passes through
  // mountains). Done last so no later blob can cut a kingdom off.
  for (const st of starts) {
    const steps = Math.ceil(Math.hypot(cx - st.x, cy - st.y));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(st.x + ((cx - st.x) * i) / steps);
      const y = Math.round(st.y + ((cy - st.y) * i) / steps);
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          set(x + ox, y + oy, T.SAND, (o) => o === T.WATER);
          set(x + ox, y + oy, T.GRASS, (o) => o === T.MOUNTAIN);
        }
    }
  }

  // make sure the start tiles themselves are clear
  for (const st of starts) set(st.x, st.y, T.GRASS);

  world.terrainVersion++;
  return { world, starts };
}
