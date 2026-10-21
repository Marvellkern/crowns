# Crowns: AI Kingdoms

A browser colony sim where **three kingdoms are each ruled by a different AI** (via OpenRouter).
The rulers build, gather, raise armies, make alliances, lie, betray each other, and go to war.
You are the god: you watch, and you can meddle.

The game engine runs the whole simulation. The AIs only give high-level orders once per
"Council Turn" (one season, every 45 seconds by default), so a full game costs about
3 AI calls per turn × 80 turns = ~240 calls.

---

## 1. Run it on your computer

You need **Node.js** (version 18 or newer) installed once: download the "LTS" version from https://nodejs.org.

Then open a terminal in this folder and run:

```bash
npm install
```

```bash
npm run dev
```

Open the address it prints (usually http://localhost:5173). On the setup screen, leave
**"Offline / Mock AI"** ticked to play without any key, then press **Begin the Age**.

The game keeps running in a background tab (and AI turns keep costing tokens). Pause it, or set `sim.runInBackground: false` in config.ts, if you do not want that.

**Controls:** drag or WASD to move the map · mouse wheel to zoom · Space to pause ·
1–5 for speed (1×, 2×, 4×, 8×, 20×) · G for the army graph · C for cinematic mode · Esc to cancel a god power · click a kingdom card to jump to it.

---

## 2. Get an OpenRouter key (to use real AIs)

1. Go to https://openrouter.ai and sign in (Google login works).
2. Add a few dollars of credit under **Credits** (or only use models ending in `:free`).
3. Go to https://openrouter.ai/keys, press **Create Key**, and copy it (it starts with `sk-or-`).
4. In the game's setup screen, paste it into **OpenRouter API key** and **untick** "Offline / Mock AI".
5. Pick a model for each kingdom (type any OpenRouter model ID, or pick from the list).

Your key is saved **only in your own browser** and is only sent to openrouter.ai.
Press **Forget key** to delete it. It is never written into the code or shown in the Debug tab.

Tips:
- Free models (`:free`) are often rate-limited. When that happens the kingdom just skips that turn.
- Type `mock` as one kingdom's model to have a real AI fight the offline AI.
- The **Debug** tab shows every prompt and reply, rejected orders, response time, and token counts.

---

## 3. Put it online with Vercel (free)

1. Put this folder on GitHub (GitHub Desktop is the easiest way: *File → Add local repository*, then *Publish*).
2. Go to https://vercel.com, sign in with GitHub, press **Add New → Project**, and pick the repo.
3. Vercel detects Vite automatically (build command `npm run build`, output folder `dist`). Press **Deploy**.
4. You get a link like `https://crowns-yourname.vercel.app`. Every push to GitHub redeploys it.

No server or secrets are needed: every player pastes their own key.

---

## 4. Tweak the balance

**Every number lives in [`src/config.ts`](src/config.ts).** Examples:

| Want to… | Change |
|---|---|
| Faster/slower AI turns | `sim.councilIntervalSec` |
| Longer/shorter games | `sim.maxYears` |
| Richer economy | `economy.yields` |
| Bigger armies | `pop.maxHouses`, `economy.growthMaxWorkerShare` |
| Stronger defenders | `buildings.hall.defense`, `combat.archerWallBonus` |
| More/fewer random raiders | `randomEvents.monsterChancePerTurn` |
| Different model suggestions | `modelSuggestions`, `defaultModels` |

After changing numbers, run a quick balance check. It plays 10 full offline games in a few seconds
and prints when each one ended and who won:

```bash
npm run simtest -- 10 M
```

---

## 5. How the code is organised (for the next AI that works on it)

```
src/
  config.ts          all tunable numbers
  main.ts            boot, game loop (fixed 10 ticks/sec sim, 60fps render), input, end screen
  sim/               pure simulation, no DOM (runs headless in scripts/simtest.ts)
    game.ts          Game class: state, tick, council timer, defeat/victory
    world.ts         seeded map generation + BFS pathfinding
    kingdom.ts       counting, costs, building placement, territory
    economy.ts       workers, upkeep, wages, starvation, growth, training
    combat.ts        armies, battles, raids, capturing buildings
    diplomacy.ts     messages, alliances, betrayals, war, peace, tribute
    orders.ts        validate + clamp + execute AI orders
    events.ts        god powers and random raiders
  ai/
    council.ts       one Council Turn: parallel async calls, never blocks the game
    openrouter.ts    API client (20s timeout, 1 retry, 429 = skip turn)
    prompt.ts        system prompt + compact state JSON (fog of war)
    parse.ts         JSON → object, with fallbacks; failure = "Hold"
    mock.ts          offline AI with persona-flavoured legal orders
    personas.ts      persona presets
  render/            canvas glyph renderer + tooltip
  ui/                setup screen, side panels, god powers bar
  data/chronicle.ts  event → history-book sentence templates
```

---

## 6. Decisions made on the "your call" items

- **Stack:** plain Vite + TypeScript, no React, no game engine. The map is one `<canvas>`; terrain is cached offscreen and only units/buildings redraw each frame.
- **Font:** JetBrains Mono (open source, loaded from Google Fonts) with system monospace fallbacks. No Dwarf Fortress tileset or assets.
- **Glyphs:** soldiers are `!` and archers `}` (not `♠`, which is used for some trees). Armies on the march are a filled square in the kingdom colour showing the troop count, with a dashed line to their target. Wild raiders are purple `&`.
- **Pathfinding:** 8-direction BFS (simple and fast enough at this map size).
- **Noise:** value noise with 4 octaves. Start zones are cleared and given a nearby forest and ore patch, the centre gets extra resources, and land corridors guarantee every kingdom can reach the others.
- **Balance additions** not in the brief, to stop endless stockpiles: troops are paid a small gold wage (unpaid troops desert), storage caps at 800 of each resource, and worker births stop at 60% of the pop cap so there is room for an army. Random raider bands appear sometimes so peaceful games still have drama.
- **Model list:** suggestions only, editable in `config.ts`. Model IDs change often on OpenRouter, so if one stops working, swap it.
- **Mock AI:** goes through the exact same JSON parse + validation path as a real model.
- **Bard mode:** on by default (setup screen). One call per year to the bard model (default gpt-4o-mini, about $0.02 per game). Without a key, an offline bard stitches the year's biggest lines together. Ballads appear in the Bard tab, as the cinematic subtitle for a few seconds, on the end screen, and in the exported Chronicle.
- **Not built yet (stretch goals):** serverless key proxy, replays, 2–6 kingdoms.
