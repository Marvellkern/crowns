/**
 * simtest.ts — plays full mock-AI games headless (no browser) as fast as
 * possible and prints how long each lasted and who won. Use it after
 * changing config.ts to check balance:  npm run simtest
 *
 * Optional args: number of games and map size, e.g.  npm run simtest -- 10 M
 */
import { Game } from '../src/sim/game';
import { Council } from '../src/ai/council';
import { CONFIG } from '../src/config';
import { counts } from '../src/sim/kingdom';
import { T } from '../src/sim/types';

const games = Number(globalThis.process?.argv?.[2] ?? 6);
const size = String(globalThis.process?.argv?.[3] ?? 'M');
const personas = ['warlord', 'merchant', 'builder', 'schemer', 'zealot'];
const results: string[] = [];
let failures = 0;

for (let g = 0; g < games; g++) {
  const seed = String(1000 + g * 7);
  const game = new Game({
    seed,
    size,
    councilSec: CONFIG.sim.councilIntervalSec,
    kingdoms: ['Iron Clan', 'River Folk', 'Sun Court'].map((name, i) => ({
      name,
      personaKey: personas[(g + i) % personas.length],
      personaText: '',
      model: 'mock',
      useMock: true,
    })),
  });
  if (g === 0) {
    const hist = [0, 0, 0, 0, 0];
    for (const t of game.world.terrain) hist[t]++;
    const n = game.world.terrain.length;
    console.log('terrain %:', Object.keys(T).map((k, i) => `${k} ${((hist[i] / n) * 100).toFixed(0)}`).join(', '));
  }
  const council = new Council(game, { apiKey: '', instantMock: true });
  game.onCouncil = () => council.runTurn();
  const t0 = Date.now();
  try {
    const maxTicks = (CONFIG.sim.maxYears * 4 + 2) * game.councilTicks + 100;
    for (let i = 0; i < maxTicks && !game.over; i++) game.step();
  } catch (e) {
    failures++;
    console.error(`game ${g} CRASHED at tick ${game.tick}:`, e);
    continue;
  }
  const errs = game.debug.filter((d) => d.error).length;
  const w = game.kingdoms[game.winner];
  const line =
    `seed ${seed}: ended ${game.when()} (${game.endReason}), winner ${w?.name ?? 'none'} [${w?.personaKey}] ` +
    `| ${game.kingdoms.map((k) => `${k.name}/${k.personaKey}: ${k.alive ? `alive res ${Math.round(k.res.food)}/${Math.round(k.res.wood)}/${Math.round(k.res.gold)}` : "fell " + game.when(k.fellTurn)} pop ${counts(game, k).pop} peakArmy ${k.stats.peakArmy} won ${k.stats.battlesWon} betray ${k.stats.betrayals}`).join(' | ')} ` +
    `| chronicle ${game.chronicle.length} lines, ai errors ${errs}, ${Date.now() - t0}ms`;
  results.push(line);
  if (g === 0) {
    console.log('--- sample chronicle (game 0) ---');
    for (const c of game.chronicle.slice(0, 40)) console.log(`${c.when}: ${c.text}`);
    console.log('...');
    for (const c of game.chronicle.slice(-8)) console.log(`${c.when}: ${c.text}`);
    const rej = game.debug.flatMap((d) => d.rejected).slice(0, 8);
    console.log('--- sample rejections ---\n' + rej.join('\n'));
  }
}
console.log('\n=== RESULTS ===');
for (const r of results) console.log(r);
if (failures) throw new Error(`${failures} game(s) crashed`);
