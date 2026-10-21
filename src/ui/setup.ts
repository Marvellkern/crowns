/**
 * setup.ts — the "Begin the Age" screen: API key (BYOK), mock toggle, seed,
 * map size, council interval, and the three kingdom cards (name, model,
 * persona, custom persona text).
 *
 * The API key is stored ONLY in this browser's localStorage (key below),
 * never sent anywhere except openrouter.ai, and can be forgotten.
 */
import { CONFIG } from '../config';
import { PERSONAS } from '../ai/personas';
import { KINGDOM_COLORS, type GameSetup } from '../sim/game';
import { esc } from '../render/tooltip';

const KEY_STORE = 'crowns.apiKey';
const SETTINGS_STORE = 'crowns.settings';

export interface SetupResult {
  setup: GameSetup;
  apiKey: string;
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked: fine, just not remembered */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const DEFAULT_NAMES = ['Iron Clan', 'River Folk', 'Sun Court'];
const DEFAULT_PERSONAS = ['warlord', 'schemer', 'builder'];

function randomSeed() {
  const a = ['mossy', 'iron', 'ashen', 'golden', 'frozen', 'quiet', 'red', 'misty', 'broken', 'silver'];
  const b = ['hills', 'vale', 'coast', 'marsh', 'crown', 'river', 'peaks', 'moor', 'isles', 'wood'];
  return `${a[Math.floor(Math.random() * a.length)]}-${b[Math.floor(Math.random() * b.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}

export function showSetup(root: HTMLElement, prev: GameSetup | null, onBegin: (r: SetupResult) => void) {
  let saved: any = null;
  try {
    saved = JSON.parse(store.get(SETTINGS_STORE) ?? 'null');
  } catch {
    saved = null;
  }
  const base = prev ?? saved;
  const savedKey = store.get(KEY_STORE) ?? '';
  const mockDefault = base?.mockAll ?? !savedKey;

  const kHtml = [0, 1, 2]
    .map((i) => {
      const k = base?.kingdoms?.[i];
      const name = k?.name ?? DEFAULT_NAMES[i];
      const model = k?.model ?? CONFIG.defaultModels[i];
      const persona = k?.personaKey ?? DEFAULT_PERSONAS[i];
      return `
      <div class="kset" style="--kc:${KINGDOM_COLORS[i]}">
        <div class="field"><label>Kingdom name</label><input data-k="${i}" data-f="name" maxlength="24" value="${esc(name)}"></div>
        <div class="field"><label>OpenRouter model</label><input data-k="${i}" data-f="model" list="model-list" value="${esc(model)}" spellcheck="false"></div>
        <div class="field"><label>Persona</label><select data-k="${i}" data-f="persona">
          ${PERSONAS.map((p) => `<option value="${p.key}" ${p.key === persona ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select></div>
        <div class="field"><label>Custom persona notes (optional)</label><textarea data-k="${i}" data-f="text" maxlength="400" placeholder="e.g. Secretly fears the sea. Loves long speeches.">${esc(k?.personaText ?? '')}</textarea></div>
      </div>`;
    })
    .join('');

  root.innerHTML = `
  <div class="setup-inner">
    <h1 class="title"><span class="c1">C</span>RO<span class="c2">W</span>N<span class="c3">S</span></h1>
    <p class="tagline">Three kingdoms. Three AI rulers. One land. You are the god watching over it.</p>

    <div class="setup-row">
      <div class="field grow">
        <label>OpenRouter API key</label>
        <input id="apikey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-or-..." value="${esc(savedKey)}">
      </div>
      <button class="btn" id="forget" type="button">Forget key</button>
      <label class="check"><input type="checkbox" id="mockall" ${mockDefault ? 'checked' : ''}> Offline / Mock AI (no key needed)</label>
    </div>
    <p class="note">Your key stays in this browser only and is sent only to openrouter.ai. Get one at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Type <b>mock</b> as a model to make just one kingdom use the offline AI.</p>

    <div class="setup-row">
      <div class="field"><label>World seed</label>
        <div style="display:flex;gap:6px"><input id="seed" value="${esc(base?.seed ?? randomSeed())}" maxlength="40"><button class="btn" id="reroll" type="button" title="Random seed">Reroll</button></div>
      </div>
      <div class="field"><label>Map size</label>
        <select id="size">${Object.entries(CONFIG.map.sizes)
          .map(([s, v]) => `<option value="${s}" ${s === (base?.size ?? CONFIG.map.defaultSize) ? 'selected' : ''}>${s} (${v.w}×${v.h})</option>`)
          .join('')}</select>
      </div>
      <div class="field grow"><label>Council convenes every <b id="ivlabel"></b></label>
        <input id="interval" type="range" min="${CONFIG.sim.councilIntervalMinSec}" max="${CONFIG.sim.councilIntervalMaxSec}" step="5" value="${base?.councilSec ?? CONFIG.sim.councilIntervalSec}">
      </div>
    </div>

    <datalist id="model-list">${CONFIG.modelSuggestions.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <div class="kcards-setup">${kHtml}</div>

    <div class="setup-row">
      <button class="btn primary begin" id="begin">Begin the Age</button>
      <span class="error" id="setuperr"></span>
    </div>
    <p class="note">Controls: drag or WASD to pan · mouse wheel to zoom · Space pauses · keys 1-5 set speed (1×–20×) · C toggles cinematic mode · Esc cancels a god power.</p>
  </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const interval = $<HTMLInputElement>('#interval');
  const ivlabel = $('#ivlabel');
  const syncIv = () => (ivlabel.textContent = `${interval.value}s`);
  interval.oninput = syncIv;
  syncIv();
  $('#reroll').onclick = () => ($<HTMLInputElement>('#seed').value = randomSeed());
  $('#forget').onclick = () => {
    store.del(KEY_STORE);
    $<HTMLInputElement>('#apikey').value = '';
    $<HTMLInputElement>('#mockall').checked = true;
    $('#setuperr').textContent = 'Key forgotten.';
  };

  $('#begin').onclick = () => {
    const key = $<HTMLInputElement>('#apikey').value.trim();
    const mockAll = $<HTMLInputElement>('#mockall').checked;
    const err = $('#setuperr');
    const val = (i: number, f: string) => (root.querySelector(`[data-k="${i}"][data-f="${f}"]`) as HTMLInputElement).value;
    const kingdoms = [0, 1, 2].map((i) => {
      const model = val(i, 'model').trim() || CONFIG.defaultModels[i];
      return {
        name: val(i, 'name').trim().slice(0, 24) || DEFAULT_NAMES[i],
        model,
        personaKey: val(i, 'persona'),
        personaText: val(i, 'text').slice(0, 400),
        useMock: mockAll || model.toLowerCase() === 'mock',
      };
    });
    const names = new Set(kingdoms.map((k) => k.name.toLowerCase()));
    if (names.size < 3) {
      err.textContent = 'Each kingdom needs a different name.';
      return;
    }
    if (!mockAll && !key && kingdoms.some((k) => !k.useMock)) {
      err.textContent = 'Paste an OpenRouter key, or tick "Offline / Mock AI".';
      return;
    }
    if (key) store.set(KEY_STORE, key);
    const setup: GameSetup = {
      seed: $<HTMLInputElement>('#seed').value.trim() || randomSeed(),
      size: $<HTMLSelectElement>('#size').value,
      councilSec: Number(interval.value),
      kingdoms,
    };
    // remember everything except the key (which has its own slot above)
    store.set(SETTINGS_STORE, JSON.stringify({ ...setup, mockAll }));
    onBegin({ setup, apiKey: mockAll ? '' : key });
  };
}
