# PROJECT BRIEF: Crowns — AI Kingdoms Colony Sim

> **For the AI reading this:** Read this whole brief before you write any code. Make the "your call" decisions yourself. Only ask me if something is truly blocking you. Where you see `[PLACEHOLDER]`, use clearly marked dummy content. Build in the order given in §11, and make sure every step runs before you move to the next one. I don't write code myself, so give me run and deploy steps in plain language.

---

## 1. Who this is for

- **Owner:** Marvell, a freelance video editor from Indonesia. He builds his web and game projects with AI, so he doesn't hand-write code. Keep the code clean, commented, and easy for *another AI* to extend later.
- **What it is:** a browser-based 2D colony sim/sandbox with a Dwarf Fortress-style look. **Three kingdoms are each ruled by a different LLM**, called through OpenRouter. The AIs build villages, gather resources, raise armies, do diplomacy, betray each other, and go to war. The player is a "god" who watches the whole thing and can meddle.
- **Audience:** Marvell first. After that, people on Reddit, YouTube, and TikTok who enjoy watching AI-vs-AI content. Clips of AI drama are part of the plan, so **the game has to be readable on screen and screenshot-friendly.**
- **One-line goal:** *This exists so that people can drop three AIs into a world and watch emergent politics and wars unfold, with a chronicle log worth screenshotting.*

---

## 2. Concept & creative direction

### 2.1 Core idea
- The **game engine runs the whole simulation**: gathering, movement, building timers, population, combat math.
- **The LLMs are only the rulers.** On every "Council Turn" (default every 45 seconds of game time), each AI gets a compact summary of its kingdom and what it knows about the world. It replies with **high-level orders in JSON**. The engine checks those orders and carries them out.
- **Never** call the LLM per unit, per tick, or per frame. That's too slow and too expensive. Expect about 3 calls per Council Turn in total.

### 2.2 Vibe
"Dwarf Fortress legends mode meets a Twitch 'AI plays Civ' stream." The world should feel dense, alive, and a little chaotic, and the story should be easy to follow.

### 2.3 What makes it fun (protect these)
1. **Personalities.** Each ruler has a persona. The same model with a different persona should behave differently.
2. **Diplomacy.** AIs send each other messages, threats, deals, and alliances, and they can lie.
3. **The Chronicle.** Major events get written up as short "history book" lines, e.g. *"Year 3, Spring: The Iron Clan broke its pact with the River Folk and burned Mossford."*
4. **God powers.** The player can intervene and then watch the AIs react.
5. **Model vs model.** Each kingdom can run on a different OpenRouter model, so the player can see which AI rules best.

### 2.4 Guardrails
- **Copy DF's look, not its depth.** No individual dwarf moods, fluid physics, or body-part combat. Aim for roughly WorldBox-level depth. *Why: scope. The MVP has to actually ship.*
- **No real-world IP.** Don't use DF's name, tilesets, or assets, and no copyrighted characters. Use a free or open CP437-style font or tileset, or plain monospace glyphs. *Why: he may post this publicly.*
- **The API key must never be hardcoded or committed.** See §4.3. *Why: a leaked key gets drained.*
- **The game must never crash or freeze because an AI misbehaves.** Bad JSON, a timeout, an illegal order, or a rate limit should all get handled gracefully (§5.5). *Why: cheap and free models fail often.*
- **Keep the AI prompts and the in-game content PG-13.** War is fine. No gore descriptions, slurs, or real political groups or religions. Add a line about this to the system prompt. *Why: the content is meant to be postable.*

---

## 3. Design system

### 3.1 Look
Dark background, a colored glyph grid, and info-dense side panels. Everything renders on `<canvas>` with a monospace glyph per tile.

### 3.2 Palette (fixed unless it fails contrast)
```css
--bg:        #0b0d10;  /* page + map background */
--panel:     #14171c;  /* side panels */
--border:    #2a2f37;
--text:      #d6d9de;
--text-dim:  #7a818c;
/* terrain: always dim so units pop */
--grass:     #3d5a2e;
--forest:    #2f5a3a;
--water:     #1f4a6e;
--mountain:  #6b6b6b;
--sand:      #8a7a4a;
/* kingdoms: always bright */
--kingdom-a: #e5484d;  /* red */
--kingdom-b: #3e8ef7;  /* blue */
--kingdom-c: #f5c518;  /* gold */
--neutral:   #b07cff;  /* monsters/neutral events */
--alert:     #ff7a1a;  /* battles, fires, god events */
```
**Rule:** terrain is dim and kingdoms are bright. A viewer should be able to tell who owns what in under 1 second.

### 3.3 Glyphs (suggested, your call to adjust)
| Thing | Glyph | Color |
|---|---|---|
| Grass | `.` or `"` | grass |
| Forest | `♣` | forest |
| Water | `≈` | water |
| Mountain | `▲` | mountain |
| Town hall | `Ħ` | kingdom color, bold |
| House | `⌂` | kingdom color |
| Farm | `÷` or `≡` | kingdom color (dim) |
| Lumber camp | `¶` | kingdom color |
| Mine | `☼` | kingdom color |
| Barracks | `Ω` | kingdom color |
| Wall | `#` | kingdom color |
| Worker | `☺` | kingdom color |
| Soldier | `♠` or `!` | kingdom color, bright |
| Archer | `↑` or `}` | kingdom color, bright |
| Army group (stacked) | number `1–9` or `▲` with a count tooltip | kingdom color |
| Battle | `X` blinking | alert |
| Fire / ruins | `*` / `%` | alert / dim |

### 3.4 Typography
- **Map:** a monospace CP437-friendly font. Your call; options include "Px437" (Ultimate Oldschool PC Font Pack, CC BY-SA), "IBM Plex Mono", or "JetBrains Mono". Tile size is 16px by default, with zoom levels of 12, 16, and 24.
- **UI panels:** the same monospace font, at 13–14px.

### 3.5 Readability rules (important for clips)
- Show a hover tooltip on any tile: what it is, who owns it, and its HP or count.
- Each kingdom's territory gets a faint tinted background (kingdom color at about 8% opacity).
- Battles flash and appear in the log right away.
- Add a "Cinematic mode" toggle that hides the panels, shows just the map plus a lower-third subtitle of the latest Chronicle line, and slowly pans to wherever the action is. This is the mode for recording clips.

---

## 4. Tech stack & constraints

### 4.1 Stack
- **Vite + vanilla TypeScript.** It's your call whether to add React for the side panels only. Keep the map on a raw `<canvas>`, not DOM elements, for performance.
- No game engine is needed. If you really want one, it's your call between plain canvas and something lightweight like PixiJS, but plain canvas is preferred.
- **Deploy target:** Vercel.
- No backend for the MVP, because of BYOK (§4.3).

### 4.2 Suggested file structure
```
/src
  main.ts               # boot, game loop
  config.ts             # all tunable numbers (costs, timers, speeds) in ONE place
  /sim
    world.ts            # map generation, tiles
    kingdom.ts          # kingdom state, resources, buildings, units
    economy.ts          # gathering, production, population
    combat.ts           # army vs army resolution
    events.ts           # god powers + random events
    orders.ts           # validate + execute AI orders
  /ai
    openrouter.ts       # API client (fetch, retries, timeout)
    prompt.ts           # builds system + state prompts per kingdom
    parse.ts            # JSON parsing + schema validation + fallback
    personas.ts         # persona presets
    mock.ts             # fake AI for offline testing (random legal orders)
  /render
    renderer.ts         # canvas glyph drawing, camera, zoom
    tooltip.ts
  /ui
    panels.ts           # kingdom cards, chronicle, diplomacy log
    setup.ts            # setup screen (keys, models, personas)
    godPowers.ts
  /data
    chronicle.ts        # event → chronicle sentence templates
/public
  fonts/
```

### 4.3 OpenRouter connection (BYOK)
- On the **setup screen**, the player pastes their own OpenRouter API key. Store it in `localStorage`, wrapped in try/catch. Add a "Forget key" button.
- **Never** hardcode, log, or commit a key, and never print it to the console.
- **Endpoint:** `POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible).
- **Headers:** `Authorization: Bearer <key>`, `Content-Type: application/json`. Optionally add `HTTP-Referer` (the site URL) and `X-Title` (the game name) for OpenRouter attribution.
- **Per-kingdom model:** a free-text field, with a dropdown of suggestions that the player can edit. Prefill the suggestions with a few cheap/fast models plus some ending in `:free`. **Don't hardcode one "correct" list.** Model names change, so keep the suggestions in `config.ts` and easy to edit.
- Use `response_format: { type: "json_object" }` when the model supports it. Always also validate the JSON yourself (§5.5).
- **Timeout:** 20 seconds per call. Retry once on network error. On a 429 rate limit, wait and skip this turn for that kingdom.
- **Mock mode:** include an "Offline / Mock AI" option that makes random *legal* orders, so the whole game can be tested without a key.
- *Stretch:* add a Vercel serverless proxy (`/api/ai`) later so people can play without their own key. It's not in the MVP.

### 4.4 Performance targets
- Map is 120×80 tiles by default. Expect up to about 300 units total.
- 60fps render on a mid-range laptop. Sim ticks run at a fixed 10/sec, separate from rendering.
- AI calls are async and **never block the game loop**. The sim keeps running while the AIs "think".

---

## 5. Systems, in detail

### 5.1 World generation
- Seeded random generation, with the seed shown in the UI so a good world can be shared or replayed.
- Use noise (simple value or Perlin noise, your call) for terrain: water, sand, grass, forest, mountains.
- Split the map into **3 starting zones**, roughly evenly spaced, each with a fair mix of grass, forest, and a mountain or ore patch nearby. Keep a neutral middle area that's richer in resources, so the kingdoms have something to fight over.
- Each kingdom starts with 1 town hall, 6 workers, 100 food, 50 wood, and 20 gold.

### 5.2 Economy (MVP)
| Resource | Source | Used for |
|---|---|---|
| Food | Farms (and slowly from the town hall) | Population upkeep (1 food per pop every N ticks), training units |
| Wood | Lumber camps near forest | Buildings |
| Gold | Mines near mountains | Soldiers, archers, bribes/tribute |

**Buildings (MVP):** Farm, Lumber Camp, Mine, House (+5 pop cap), Barracks (unlocks soldiers and archers), Wall segment.
**Units (MVP):** Worker, Soldier (melee), Archer (ranged, weaker in melee).
- Workers auto-assign themselves to the nearest job, so the AI doesn't micromanage them. The AI only sets *priorities*, e.g. "60% food, 30% wood, 10% gold".
- If food runs out, pop starts dying and morale drops. Make sure that's visible and lands in the Chronicle.
- **Put every cost, timer, and stat in `config.ts`** so balancing is a one-file job.

### 5.3 Armies & combat
- Soldiers and archers get grouped into **armies** that have a target.
- Army movement uses simple pathfinding (A* on the tile grid, or BFS, your call). Avoid water and mountains.
- **Battle resolution:** auto-resolve when armies meet or reach a target.
  `power = soldiers×3 + archers×2 (+ archers×2 bonus if defending behind walls)`, times a random factor of 0.8–1.2. The loser takes most of the casualties, and the winner takes some.
- Show a short battle animation: a blinking `X`, then units disappear.
- **Capturing:** if an army beats the defenders of a building, it gets destroyed (turned into ruins `%`). If it takes the town hall, that kingdom is **defeated**. Its leftover units become neutral or flee, and the Chronicle records it.

### 5.4 Council Turns (the AI loop)
- **Default interval:** 45 seconds, adjustable from 20 to 120 seconds in settings. Add a **Pause** button and game speed controls (1×/2×/4×).
- On each turn, call all 3 AIs **in parallel**. Apply each order set when its response comes back.
- **State summary sent to each AI** (keep it compact, under ~800 tokens):
```json
{
  "turn": 12,
  "year": 3, "season": "Spring",
  "you": {
    "name": "Iron Clan", "persona": "paranoid warlord",
    "resources": {"food": 140, "wood": 60, "gold": 35},
    "population": {"workers": 18, "soldiers": 10, "archers": 4, "cap": 30},
    "buildings": {"farm": 3, "lumber": 2, "mine": 1, "house": 4, "barracks": 1, "wall": 6},
    "armies": [{"id": "a1", "size": 8, "location": "home"}],
    "worker_priorities": {"food": 50, "wood": 30, "gold": 20}
  },
  "known_world": [
    {"kingdom": "River Folk", "relation": "allied", "estimated_army": "~12", "distance": "near"},
    {"kingdom": "Sun Court", "relation": "neutral", "estimated_army": "unknown", "distance": "far"}
  ],
  "recent_events": ["River Folk sent you 20 food", "Drought hit your farms (god power)"],
  "inbox": [{"from": "Sun Court", "text": "Join me against River Folk and I'll pay 40 gold."}]
}
```
- **Fog of war (light):** an AI only gets *estimates* of the other kingdoms' armies (rounded, or "unknown" when far away). This is what makes bluffing work.

### 5.5 AI order format, validation, and fallback
**The AI must reply with JSON only:**
```json
{
  "thoughts": "1-2 sentences of private reasoning (shown in the UI as 'inner thoughts')",
  "worker_priorities": {"food": 50, "wood": 30, "gold": 20},
  "build": [{"type": "farm", "count": 1}, {"type": "barracks", "count": 1}],
  "train": {"soldier": 4, "archer": 2},
  "armies": [{"action": "attack", "target": "River Folk", "size": 10}],
  "diplomacy": [
    {"to": "Sun Court", "type": "propose_alliance", "message": "Together we crush the River Folk."},
    {"to": "River Folk", "type": "message", "message": "Our friendship is eternal."}
  ]
}
```
- **Army actions:** `attack` (target kingdom), `defend` (home), `raid` (steal resources from the target's outer buildings), `retreat`.
- **Diplomacy types:** `message`, `propose_alliance`, `accept_alliance`, `break_alliance`, `declare_war`, `offer_peace`, `send_tribute` (with `{resource, amount}`), `demand_tribute`.
- **Validation:** clamp numbers and drop anything unaffordable or illegal. Priorities get normalized to 100. Unknown fields are ignored. Log *what got rejected* in the debug panel, e.g. "Iron Clan tried to train 50 soldiers, could afford 6".
- **Fallback chain:** parse the JSON, then try to extract the first `{...}` block, then **"Hold" (do nothing this turn)** and log *"The Iron Clan's council could not agree"* in the Chronicle. Never crash.
- **Alliance rules:** allies can't attack each other until a `break_alliance` order has happened (a betrayal, which gets a big Chronicle line). An alliance only forms when both sides `propose`/`accept` within 2 turns.

### 5.6 Prompt design (in `prompt.ts`)
System prompt per kingdom (your call on exact wording):
- Its name, persona, and the win condition (*"Survive and become the dominant kingdom. You win by destroying the other town halls, or by being strongest after Year 20."*).
- The rules of the game: costs, units, the order schema, and that the other rulers may lie.
- *"Respond with ONLY valid JSON matching the schema. No markdown."*
- *"Stay in character. Keep messages short (max 25 words). Keep content PG-13."*
- Last turn's own `thoughts` and the **last 3 turns of diplomacy**, so the AI has short memory. Don't send the full history, to keep tokens low.

### 5.7 Personas (presets, editable in setup)
| Preset | Behavior hint |
|---|---|
| Paranoid Warlord | Builds military early, trusts no one, attacks the weak |
| Greedy Merchant | Hoards gold, buys peace, sells out allies for profit |
| Peaceful Builder | Grows the economy, defends, only fights when attacked |
| Schemer | Makes alliances it plans to break, lies often |
| Zealot | Wants to "unite the land" by any means, aggressive diplomacy |

Each kingdom also gets an **editable name** and an optional custom persona text box.

### 5.8 God powers (player tools)
Put these in a toolbar. Click a power, then click a tile or kingdom. Each one has a cooldown and gets logged in the AI's `recent_events` and in the Chronicle.
- **Bless:** gives +100 of a resource to a kingdom.
- **Drought:** halves farm output for a kingdom for 2 turns.
- **Plague:** kills 20% of pop in a kingdom.
- **Spawn monsters:** neutral raiders (`neutral` color) appear at a tile and attack the nearest kingdom.
- **Whisper:** the player types a message that arrives in a kingdom's inbox as *"A mysterious voice says: ..."*. This is a fun way to manipulate AIs.
- **Meteor:** destroys tiles in a 3×3 area.

### 5.9 The Chronicle
- An event-to-sentence template system in `/data/chronicle.ts`. Each event type has 2–3 template variants, so it doesn't feel repetitive.
- The time format is `Year N, Season` (1 season = 1 Council Turn, 4 seasons = 1 year).
- **Events that go in it:** founding, alliances, betrayals, wars declared, battles (with casualties), raids, starvation, god powers, a kingdom falling, and the final victory.
- Add an **Export Chronicle** button that downloads it as `.txt`. Great for posting on Reddit.
- *(Stretch: a "Bard mode" toggle that sends the raw event list to one LLM at the end of each year to rewrite it as epic prose.)*

---

## 6. Screens & layout

### 6.1 Setup screen
- Game title, then an **API key** field (with a "Mock AI" checkbox instead), a world seed field, and map size (S/M/L).
- **3 kingdom cards**, each with: name, color (fixed red/blue/gold), model field with a suggestion dropdown, persona preset plus a custom text box.
- Council Turn interval slider, and a **"Begin the Age"** button.

### 6.2 Main game screen (desktop-first, 1280px or wider)
```
┌────────────────────────────────────────────┬─────────────────────┐
│ top bar: Year/Season · speed · pause · next│  KINGDOM CARDS (x3) │
│ council turn countdown · cinematic toggle  │  name · model ·     │
├────────────────────────────────────────────┤  persona · res ·    │
│                                            │  pop · army ·       │
│              MAP (canvas)                  │  relations ·        │
│         pan: drag / WASD, zoom: wheel      │  "inner thoughts"   │
│                                            ├─────────────────────┤
│                                            │ TABS: Chronicle |   │
│                                            │ Diplomacy | Debug   │
├────────────────────────────────────────────┴─────────────────────┤
│ GOD POWERS toolbar                                               │
└──────────────────────────────────────────────────────────────────┘
```
- **Kingdom cards:** show a small "thinking…" spinner while a call is in flight. Show the latest `thoughts` in italics. Show the relation to the other two as colored chips (allied / neutral / war).
- **Diplomacy tab:** a chat-style feed between kingdoms, with each message colored by its sender.
- **Debug tab:** raw prompt and response per turn (key redacted), rejected orders, latency, and an approximate token count per call.
- **Mobile:** not a priority. Just make sure it doesn't break. The panels can stack under the map, and the map can be view-only at narrow widths.

### 6.3 End screen
Triggered when one kingdom remains or Year 20 is reached. Shows the winner, the model that ran it, its persona, a stats table (peak army, battles won, betrayals, resources gathered), and buttons for **Export Chronicle** and **Play again with same seed**.

---

## 7. Quality bars
- Runs locally with `npm install && npm run dev` and no other setup. Mock mode works with no key.
- No console errors during a 20-year mock-mode game.
- An LLM failure (bad JSON, 429, timeout) never freezes or crashes the game.
- The API key never shows up in logs, the debug panel, error messages, or URL params.
- All balance numbers live in `config.ts`.
- Code is commented at the module level so another AI can pick it up later.

---

## 8. Copy & voice
- UI labels are short and a bit medieval, but still clear: "Begin the Age", "Council convenes in 0:32", "The council could not agree".
- Chronicle tone is dry history-book with a little drama. No modern slang, no emojis.
- Default kingdom names (editable): **Iron Clan** (red), **River Folk** (blue), **Sun Court** (gold).

---

## 9. Stretch goals (only after the MVP is solid)
1. Vercel serverless proxy so people can play without a key.
2. Bard mode (LLM-written yearly history).
3. More units (cavalry, siege), tech tiers, and seasons affecting farms.
4. Replay system: record each turn's orders and re-run from the seed.
5. A "spectator stats" overlay for clips (army power graph over time).
6. Support 2–6 kingdoms.
7. Optional CP437 tileset graphics toggle.

---

## 10. Out of scope for MVP
Individual unit needs or moods, multiplayer, sound and music, a save/load system (beyond the seed), mobile controls, and accounts or login.

---

## 11. Build order (deliver in this order; each step must run)
1. **Scaffold + world:** Vite project, seeded map generation, canvas glyph renderer, pan/zoom, tooltips.
2. **Sim core:** 3 kingdoms, resources, workers auto-gathering, buildings, population, the fixed tick loop, and `config.ts`.
3. **Mock AI + orders:** the order schema, validation, `mock.ts` making random legal orders, and Council Turns running in mock mode. *The game should be fully watchable here.*
4. **Armies + combat:** training, army movement, battles, destruction, defeat, and the end screen.
5. **Diplomacy + Chronicle:** messages, alliances/betrayals, the Chronicle templates, and Export.
6. **OpenRouter:** setup screen, BYOK, per-kingdom model and persona, prompts, parsing and fallback, the debug tab.
7. **God powers + Cinematic mode.**
8. **Polish + deploy:** balance pass in mock mode (make sure games usually last 10–20 years), Vercel deploy steps, README.

After each step, tell me in plain words what works now and how to see it.

---

## 12. Deliverables
- The full source in the structure above.
- A `README.md` with: how to run locally, how to get an OpenRouter key (in plain steps), how to deploy to Vercel, and how to tweak balance in `config.ts`.
- A short note listing any decisions you made on the "your call" items.

---

## 13. Self-check before replying
- [ ] `npm run dev` works, and mock mode plays a full game with no key.
- [ ] The game loop never waits on an AI call.
- [ ] Bad, empty, or timed-out AI responses fall back to "Hold" and get logged.
- [ ] The key isn't in the code, the logs, or the debug output.
- [ ] Kingdom colors are distinct, terrain is dimmer than units, and tooltips work.
- [ ] Alliances block attacks until they're broken, and betrayals show in the Chronicle.
- [ ] Every balance number is in `config.ts`.
- [ ] Export Chronicle downloads a readable `.txt`.
- [ ] No DF assets or names, no copyrighted content.

---

## 14. Placeholder cheat-sheet
| Placeholder | What Marvell will supply |
|---|---|
| OpenRouter API key | Pasted in-game by the player. Never in code |
| Model suggestion list | Your call to prefill. Marvell may edit it in `config.ts` |
| Deploy URL | After the first Vercel deploy |
