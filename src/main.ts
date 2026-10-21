/**
 * main.ts — boots the app and runs the game loop.
 *
 * Loop: requestAnimationFrame renders at display rate (~60fps); the sim
 * advances in fixed ticks (CONFIG.sim.ticksPerSecond × speed) using an
 * accumulator. Council Turns fire from inside the sim and call the AI
 * asynchronously, so the loop never waits on an AI.
 */
import './style.css';
import { CONFIG } from './config';
import { Game, type GameSetup } from './sim/game';
import { Council } from './ai/council';
import { Renderer } from './render/renderer';
import { describeTile, esc } from './render/tooltip';
import { Panels, chronicleText, downloadText } from './ui/panels';
import { GodBar } from './ui/godPowers';
import { showSetup } from './ui/setup';
import { getPersona } from './ai/personas';
import { counts } from './sim/kingdom';
import { StatsOverlay } from './render/statsOverlay';

const setupEl = document.getElementById('setup')!;
const gameEl = document.getElementById('game')!;
const endEl = document.getElementById('endscreen')!;
const canvas = document.getElementById('map') as HTMLCanvasElement;
const tooltip = document.getElementById('tooltip')!;
const subtitle = document.getElementById('subtitle')!;

const renderer = new Renderer(canvas);
const stats = new StatsOverlay(document.getElementById('stats') as HTMLCanvasElement);
const toggleStats = () => document.body.classList.toggle('nostats');

interface Session {
  game: Game;
  council: Council;
  panels: Panels;
  god: GodBar;
  apiKey: string;
}
let S: Session | null = null;
let speed = 1;
let paused = false;
let cinematic = false;
let lastSetup: GameSetup | null = null;
let lastKey = '';
let rafId = 0;

// ---------- setup ----------
function openSetup() {
  cancelAnimationFrame(rafId);
  S = null;
  setCinematic(false);
  endEl.classList.add('hidden');
  gameEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
  showSetup(setupEl, lastSetup, ({ setup, apiKey }) => startGame(setup, apiKey));
}

function startGame(setup: GameSetup, apiKey: string) {
  lastSetup = setup;
  lastKey = apiKey;
  setupEl.classList.add('hidden');
  endEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  speed = 1;
  paused = false;
  const game = new Game(structuredClone(setup));
  const council = new Council(game, { apiKey });
  game.onCouncil = () => council.runTurn();
  game.onEnd = () => setTimeout(showEnd, 1500);
  const god = new GodBar(game);
  const panels = new Panels(game, {
    getSpeed: () => speed,
    setSpeed: (s) => (speed = s),
    isPaused: () => paused,
    togglePause: () => (paused = !paused),
    toggleCinematic: () => setCinematic(!cinematic),
    toggleStats,
    exportChronicle,
    newGame: () => {
      if (game.over || confirm('Abandon this age and return to setup?')) openSetup();
    },
    onKingdomClick: (id) => {
      const k = game.kingdoms[id];
      renderer.centerOnTile(k.hx, k.hy);
    },
  });
  S = { game, council, panels, god, apiKey };
  renderer.resize();
  renderer.setGame(game);
  panels.update();
  last = performance.now();
  acc = 0;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
}

function exportChronicle() {
  if (!S) return;
  const safe = S.game.setup.seed.replace(/[^a-z0-9-_]+/gi, '_');
  downloadText(`crowns-chronicle-${safe}.txt`, chronicleText(S.game));
}

// ---------- end screen ----------
function showEnd() {
  if (!S) return;
  const g = S.game;
  const w = g.kingdoms[g.winner];
  const rows = g.kingdoms
    .map((k) => {
      const gathered = Math.round(k.stats.gathered.food + k.stats.gathered.wood + k.stats.gathered.gold);
      return `<tr><td style="color:${k.color};font-weight:700">${esc(k.name)}</td><td>${esc(k.useMock ? 'mock AI' : k.model)}</td><td>${esc(getPersona(k.personaKey).label)}</td>
        <td>${k.alive ? 'standing' : 'fell ' + esc(g.when(k.fellTurn))}</td><td>${k.stats.peakArmy}</td><td>${k.stats.battlesWon}</td><td>${k.stats.betrayals}</td><td>${gathered}</td></tr>`;
    })
    .join('');
  endEl.innerHTML = `<div class="endbox" style="--kc:${w?.color ?? '#d6d9de'}">
    <div class="dim">${esc(g.when())} · ${g.endReason === 'conquest' ? 'Conquest' : `The ${CONFIG.sim.maxYears}-year age is over`}</div>
    <h1>${w ? `The ${esc(w.name)} rule the land` : 'No kingdom survived'}</h1>
    ${w ? `<div>Ruled by <b>${esc(w.useMock ? 'mock AI' : w.model)}</b> as a ${esc(getPersona(w.personaKey).label)}. Capital: ${esc(w.town)}.</div>` : ''}
    <table><thead><tr><th>Kingdom</th><th>Model</th><th>Persona</th><th>Fate</th><th>Peak army</th><th>Battles won</th><th>Betrayals</th><th>Resources gathered</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="endbtns">
      <button class="btn primary" id="endExport">Export Chronicle</button>
      <button class="btn" id="endReplay">Play again with same seed</button>
      <button class="btn" id="endNew">New age</button>
      <button class="btn" id="endLook">Look at the map</button>
    </div></div>`;
  endEl.classList.remove('hidden');
  document.getElementById('endExport')!.onclick = exportChronicle;
  document.getElementById('endReplay')!.onclick = () => lastSetup && startGame(lastSetup, lastKey);
  document.getElementById('endNew')!.onclick = openSetup;
  document.getElementById('endLook')!.onclick = () => endEl.classList.add('hidden');
}

// ---------- cinematic mode ----------
let cineTarget = { x: 0, y: 0 };
let cineSince = 0;
let cineIdx = 0;
function setCinematic(on: boolean) {
  cinematic = on;
  document.body.classList.toggle('cinematic', on);
  requestAnimationFrame(() => renderer.resize());
  cineSince = 0;
}
document.getElementById('exitCinematic')!.onclick = () => setCinematic(false);

function updateCinematic(dtMs: number, now: number) {
  if (!S) return;
  const g = S.game;
  const f = g.focus;
  const recent = f && g.tick - f.tick < 15 * CONFIG.sim.ticksPerSecond;
  if (recent) {
    cineTarget = { x: f!.x, y: f!.y };
  } else if (now - cineSince > CONFIG.render.cinematicHoldSec * 1000) {
    // nothing happening: drift between capitals and marching armies
    const alive = g.kingdoms.filter((k) => k.alive);
    const spots = [...alive.map((k) => ({ x: k.hx, y: k.hy })), ...g.armies.slice(0, 3).map((a) => ({ x: a.x, y: a.y }))];
    if (spots.length) cineTarget = spots[cineIdx++ % spots.length];
    cineSince = now;
  }
  const c = renderer.centerTile();
  const t = 1 - Math.pow(0.5, dtMs / 900); // smooth, slow pan
  renderer.centerOnTile(c.x - 0.5 + (cineTarget.x - (c.x - 0.5)) * t, c.y - 0.5 + (cineTarget.y - (c.y - 0.5)) * t);
  const lastLine = g.chronicle[g.chronicle.length - 1];
  const html = lastLine ? `<span class="when">${esc(lastLine.when)}</span>${esc(lastLine.text)}` : '';
  if (subtitle.innerHTML !== html) subtitle.innerHTML = html;
}

// ---------- the loop ----------
let last = performance.now();
let acc = 0;
let lastUi = 0;
const keys = new Set<string>();

/** Advance the sim by `dtMs` of real time (times the game speed), up to maxTicks. */
function advance(dtMs: number, maxTicks: number) {
  if (!S || paused || S.game.over) return;
  try {
    acc += dtMs * speed;
    const tickMs = 1000 / CONFIG.sim.ticksPerSecond;
    let n = 0;
    while (acc >= tickMs && n < maxTicks && !S.game.over) {
      S.game.step();
      acc -= tickMs;
      n++;
    }
    if (n >= maxTicks) acc = 0; // too far behind: drop the rest rather than stall
  } catch (e) {
    // a sim bug should never freeze the page; log it and keep going
    console.error('sim error', e);
  }
}

function frame(now: number) {
  rafId = requestAnimationFrame(frame);
  if (!S) return;
  const dt = Math.min(250, now - last);
  last = now;
  const g = S.game;
  advance(dt, CONFIG.sim.maxTicksPerFrame);
  // WASD / arrow panning
  const p = (CONFIG.render.panSpeed * dt) / 1000;
  if (keys.has('a') || keys.has('arrowleft')) renderer.pan(-p, 0);
  if (keys.has('d') || keys.has('arrowright')) renderer.pan(p, 0);
  if (keys.has('w') || keys.has('arrowup')) renderer.pan(0, -p);
  if (keys.has('s') || keys.has('arrowdown')) renderer.pan(0, p);
  if (cinematic) updateCinematic(dt, now);
  renderer.draw(now);
  if (now - lastUi > 250) {
    lastUi = now;
    S.panels.update();
    S.god.update();
    if (!document.body.classList.contains('nostats')) stats.draw(g);
    if (hoverTile && !tooltip.classList.contains('hidden')) tooltip.innerHTML = describeTile(g, hoverTile.x, hoverTile.y);
  }
}

// Background play: browsers stop requestAnimationFrame in hidden tabs, but
// still run timers (about once a second, or once a minute after a while).
// If no frame has run for a bit, catch the sim up here instead.
setInterval(() => {
  if (!CONFIG.sim.runInBackground) return;
  const now = performance.now();
  if (now - last < 400) return; // frames are running normally
  const dt = Math.min(now - last, CONFIG.sim.maxBackgroundCatchupSec * 1000);
  last = now;
  advance(dt, CONFIG.sim.maxBackgroundCatchupSec * CONFIG.sim.ticksPerSecond * Math.max(...CONFIG.sim.speeds));
}, 500);

// ---------- input ----------
let drag: { x: number; y: number; moved: boolean } | null = null;
let hoverTile: { x: number; y: number } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.moved || Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      renderer.pan(-dx, -dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  }
  if (!S) return;
  hoverTile = renderer.screenToTile(mx, my);
  renderer.hover = hoverTile;
  if (hoverTile && !drag?.moved && !cinematic) {
    tooltip.innerHTML = describeTile(S.game, hoverTile.x, hoverTile.y);
    tooltip.classList.remove('hidden');
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    tooltip.style.left = `${Math.min(mx + 14, r.width - tw - 4)}px`;
    tooltip.style.top = `${my + 18 + th > r.height ? my - th - 8 : my + 18}px`;
  } else tooltip.classList.add('hidden');
});
canvas.addEventListener('pointerup', (e) => {
  const r = canvas.getBoundingClientRect();
  if (drag && !drag.moved && S) {
    const t = renderer.screenToTile(e.clientX - r.left, e.clientY - r.top);
    if (t) S.god.click(t.x, t.y);
  }
  drag = null;
});
canvas.addEventListener('pointerleave', () => {
  tooltip.classList.add('hidden');
  renderer.hover = null;
  hoverTile = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    renderer.zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);
window.addEventListener('resize', () => renderer.resize());

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !S) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
    keys.add(k);
    e.preventDefault();
  } else if (k === ' ') {
    paused = !paused;
    e.preventDefault();
  } else if (k === 'c') setCinematic(!cinematic);
  else if (k === 'g') toggleStats();
  else if (k === 'escape') {
    if (cinematic) setCinematic(false);
    S.god.select(null);
  } else if (/^[1-9]$/.test(k) && CONFIG.sim.speeds[Number(k) - 1]) speed = CONFIG.sim.speeds[Number(k) - 1];
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// handy for debugging in the console: window.crowns.game
(window as any).crowns = {
  get game() {
    return S?.game;
  },
  counts: (id: number) => S && counts(S.game, S.game.kingdoms[id]),
};

openSetup();
