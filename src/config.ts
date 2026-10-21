/**
 * config.ts — EVERY tunable number in the game lives here.
 *
 * Balancing the game should be a one-file job: change a value, save, and the
 * dev server reloads. Times are in sim ticks unless the name says otherwise
 * (the sim runs at CONFIG.sim.ticksPerSecond ticks per second at 1x speed).
 */

export const CONFIG = {
  sim: {
    ticksPerSecond: 10,
    /** Seconds of game time between Council Turns (one turn = one season). */
    councilIntervalSec: 45,
    councilIntervalMinSec: 20,
    councilIntervalMaxSec: 120,
    seasonsPerYear: 4,
    /** The age ends after this many years; strongest kingdom wins. */
    maxYears: 20,
    /** Speed buttons; keys 1-5 pick them in order. */
    speeds: [1, 2, 4, 8, 20] as number[],
    /** Safety cap so a slow frame never runs hundreds of ticks at once. */
    maxTicksPerFrame: 40,
  },

  map: {
    sizes: {
      S: { w: 90, h: 60 },
      M: { w: 120, h: 80 },
      L: { w: 160, h: 100 },
    } as Record<string, { w: number; h: number }>,
    defaultSize: 'M',
    noiseScale: 16,
    waterLevel: 0.31,
    sandLevel: 0.34,
    mountainLevel: 0.645,
    forestMoisture: 0.54,
    /** Radius of guaranteed buildable land around each starting town hall. */
    startClearRadius: 6,
  },

  start: { food: 100, wood: 50, gold: 20, workers: 6 },

  economy: {
    /** Ticks a worker spends at a job site per trip. */
    workTicks: 30,
    /** Resource produced per completed trip at a proper building. */
    yields: { food: 3, wood: 2, gold: 1.5 },
    /** Gathering with no building (foraging) gives this fraction of the yield. */
    forageMultiplier: 0.5,
    /** Max workers that can use one farm / lumber camp / mine at a time. */
    siteCapacity: 3,
    /** The town hall slowly produces food on its own. */
    hallFoodPerSec: 0.4,
    /** Every upkeepTicks, each person (workers + soldiers + archers) eats foodPerPop. */
    upkeepTicks: 100,
    foodPerPop: 1,
    /** Soldiers and archers also cost gold wages every upkeep. Unpaid troops desert. */
    goldPerSoldier: 0.4,
    /** Max of each resource a kingdom can store; anything above is wasted. */
    storageCap: 800,
    /** % of population lost each upkeep while starving (min 1). */
    starvationLossPct: 0.1,
    /** New workers are born every growthTicks if food >= growthMinFood and pop < cap. */
    growthTicks: 120,
    growthMinFood: 40,
    growthFoodCost: 20,
    /** Births stop once workers fill this share of the pop cap (leaves room for troops). */
    growthMaxWorkerShare: 0.6,
    /** How often workers are re-assigned to match the AI's priorities. */
    reassignTicks: 50,
    /** Low morale (< threshold) multiplies all yields by lowMoraleYield. */
    lowMoraleThreshold: 30,
    lowMoraleYield: 0.75,
    moraleStarvePenalty: 10,
    moraleRecoverPerTurn: 3,
    /** Drought multiplies farm output by this, for droughtTurns council turns. */
    droughtMultiplier: 0.5,
  },

  /** maxHouses caps population (~70 per kingdom) so the map stays readable. */
  pop: { hallCap: 10, houseCap: 5, maxHouses: 12 },

  /** Building costs, construction time (ticks), HP, and territory radius. */
  buildings: {
    hall: { cost: { food: 0, wood: 0, gold: 0 }, buildTicks: 0, hp: 100, territory: 7, defense: 14 },
    farm: { cost: { food: 0, wood: 30, gold: 0 }, buildTicks: 80, hp: 40, territory: 3, defense: 2 },
    lumber: { cost: { food: 0, wood: 25, gold: 0 }, buildTicks: 80, hp: 40, territory: 3, defense: 2 },
    mine: { cost: { food: 0, wood: 40, gold: 0 }, buildTicks: 100, hp: 40, territory: 3, defense: 2 },
    house: { cost: { food: 0, wood: 35, gold: 0 }, buildTicks: 80, hp: 40, territory: 3, defense: 2 },
    barracks: { cost: { food: 0, wood: 70, gold: 20 }, buildTicks: 150, hp: 60, territory: 3, defense: 4 },
    wall: { cost: { food: 0, wood: 12, gold: 0 }, buildTicks: 40, hp: 60, territory: 1, defense: 1 },
  } as Record<string, { cost: { food: number; wood: number; gold: number }; buildTicks: number; hp: number; territory: number; defense: number }>,

  /** Max of one building type a single order can request. */
  maxBuildPerOrder: 4,
  /** How far from the town hall new buildings may be placed. */
  maxBuildRadius: 16,
  /** Walls are placed in a ring this far (Chebyshev) from the hall. */
  wallRadius: 5,

  units: {
    worker: { cost: { food: 25, wood: 0, gold: 0 }, trainTicks: 60 },
    soldier: { cost: { food: 15, wood: 0, gold: 10 }, trainTicks: 70 },
    archer: { cost: { food: 15, wood: 5, gold: 8 }, trainTicks: 70 },
  } as Record<string, { cost: { food: number; wood: number; gold: number }; trainTicks: number }>,
  maxTrainPerOrder: 12,

  movement: {
    /** Ticks per tile step. Lower = faster. */
    worker: 3,
    army: 4,
    monster: 5,
    garrisonWanderTicks: 25,
  },

  combat: {
    soldierPower: 3,
    archerPower: 2,
    /** Extra power per archer when defending a kingdom with enough walls. */
    archerWallBonus: 2,
    wallsForBonus: 4,
    monsterPower: 2.5,
    /** Workers fight (badly) only when their town hall is attacked. */
    workerPower: 0.5,
    randomMin: 0.8,
    randomMax: 1.2,
    /** Fraction of the loser's units that die. */
    loserLossMin: 0.6,
    loserLossMax: 0.9,
    /** Winner losses scale with how close the fight was. */
    winnerLossScale: 0.45,
    /** A raid that wins steals up to this much of each resource. */
    raidSteal: { food: 40, wood: 30, gold: 25 },
    /** Battle marker lifetime (ticks). */
    battleMarkerTicks: 30,
    fireTicks: 60,
  },

  diplomacy: {
    /** Alliance/peace forms only if both sides agree within this many turns. */
    proposalWindowTurns: 2,
    maxTributePerOrder: 200,
    maxMessageWords: 25,
    /** Distance (tiles) between halls under which a kingdom is "near". */
    nearDistance: 45,
  },

  god: {
    /** Cooldowns in seconds of game time. */
    cooldownSec: { bless: 30, drought: 60, plague: 90, monsters: 45, whisper: 10, meteor: 30 } as Record<string, number>,
    blessAmount: 100,
    droughtTurns: 2,
    plaguePct: 0.2,
    monsterCount: 8,
    meteorDamage: 60,
  },

  /** Random neutral raider bands, so peaceful games still have drama. */
  randomEvents: {
    monsterChancePerTurn: 0.06,
    monsterCount: 6,
    firstTurn: 8,
  },

  ai: {
    timeoutMs: 20000,
    temperature: 0.9,
    maxTokens: 700,
    /** Fake "thinking" delay for mock AI so the spinner is visible (ms). */
    mockDelayMinMs: 400,
    mockDelayMaxMs: 1800,
    /** Turns of diplomacy remembered in the prompt. */
    memoryTurns: 3,
  },

  /**
   * Suggested OpenRouter model IDs for the setup dropdown. Model names change
   * often: edit freely. Any model ID typed by the player also works.
   * Type "mock" as a model to make just that kingdom use the offline AI.
   */
  modelSuggestions: [
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash',
    'anthropic/claude-haiku-4.5',
    'deepseek/deepseek-chat-v3.1',
    'meta-llama/llama-3.3-70b-instruct',
    'x-ai/grok-4-fast',
    'mistralai/mistral-small-3.2-24b-instruct',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-chat-v3.1:free',
    'qwen/qwen3-235b-a22b:free',
    'mock',
  ],
  defaultModels: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat-v3.1'],

  render: {
    zoomLevels: [12, 16, 24],
    defaultZoom: 1,
    panSpeed: 600, // pixels per second for WASD
    territoryAlpha: 0.08,
    cinematicHoldSec: 8,
  },
};

export type Config = typeof CONFIG;
