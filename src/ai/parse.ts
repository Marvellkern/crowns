/**
 * parse.ts — turn a model's raw text reply into a JSON object.
 *
 * Fallback chain (never throws):
 *   1. JSON.parse the whole thing (after stripping ``` fences)
 *   2. extract the first balanced {...} block and parse that
 *   3. give up -> caller treats the turn as "Hold" (do nothing)
 * Schema checking/clamping happens afterwards in sim/orders.ts.
 */

export type ParseResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Find the first {...} block, respecting strings and escapes. */
export function extractFirstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAIResponse(text: unknown): ParseResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty response' };
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const direct = tryParse(cleaned);
  if (direct) return { ok: true, value: direct };
  const block = extractFirstObject(cleaned);
  if (block) {
    const v = tryParse(block) ?? tryParse(block.replace(/,\s*([}\]])/g, '$1')); // forgive trailing commas
    if (v) return { ok: true, value: v };
  }
  return { ok: false, error: 'could not find valid JSON in response' };
}
