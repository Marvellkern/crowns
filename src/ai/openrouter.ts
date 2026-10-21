/**
 * openrouter.ts — minimal OpenRouter chat-completions client (BYOK).
 *
 * - 20 s timeout per call (AbortController)
 * - one retry on network error
 * - 429 (rate limit) -> RateLimitError so the council skips this kingdom's turn
 * - if a model rejects response_format, retry once without it
 *
 * SECURITY: the API key is only ever placed in the Authorization header.
 * It is never logged, never put in a URL, and scrubbed from error text.
 */
import { CONFIG } from '../config';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export class RateLimitError extends Error {}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

function scrub(msg: string, key: string) {
  let out = msg;
  if (key) out = out.split(key).join('[redacted]');
  return out.replace(/sk-or-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 300);
}

async function once(key: string, model: string, messages: ChatMessage[], jsonMode: boolean, maxTokens: number): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.ai.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: CONFIG.ai.temperature,
      max_tokens: maxTokens,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://crowns.local',
        'X-Title': 'Crowns',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) throw new RateLimitError('rate limited (429)');
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      const err = new Error(`HTTP ${res.status}: ${msg}`);
      (err as any).status = res.status;
      throw err;
    }
    const msg = data?.choices?.[0]?.message;
    // some "thinking" models (e.g. DeepSeek V3.1 on certain providers) leave content
    // empty and put everything in a reasoning field; fall back to that
    let text = typeof msg?.content === 'string' ? msg.content : '';
    if (!text.trim() && typeof msg?.reasoning === 'string') text = msg.reasoning;
    return {
      text,
      tokensIn: data?.usage?.prompt_tokens,
      tokensOut: data?.usage?.completion_tokens,
    };
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`timed out after ${CONFIG.ai.timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** opts.json=false asks for plain text (used by the bard). */
export async function chat(
  key: string,
  model: string,
  messages: ChatMessage[],
  opts: { json?: boolean; maxTokens?: number } = {},
): Promise<ChatResult> {
  const json = opts.json ?? true;
  const max = opts.maxTokens ?? CONFIG.ai.maxTokens;
  try {
    try {
      return await once(key, model, messages, json, max);
    } catch (e: any) {
      if (e instanceof RateLimitError) throw e;
      // model does not support JSON mode -> try plain
      if (e?.status === 400 && /response_format|json/i.test(String(e.message))) return await once(key, model, messages, false, max);
      // network error (fetch threw TypeError) -> retry once
      if (e instanceof TypeError) return await once(key, model, messages, json, max);
      throw e;
    }
  } catch (e: any) {
    if (e instanceof RateLimitError) throw e;
    throw new Error(scrub(String(e?.message ?? e), key));
  }
}
