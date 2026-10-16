// One LLM call path for every AI feature (estimate-food, estimate-bf,
// generate-recipe), free providers only, hedged so that one slow, rate-limited
// or retired provider costs seconds instead of the feature:
//
//   1. Gemini (our key)  best quality; fast models with thinking minimised
//   2. Kilo gateway      keyless free tier — other companies' models; text + vision
//   3. Pollinations      keyless; text only
//
// WHY (2026-10-16): each function called ONE hardcoded Gemini model with no
// timeout. Measured from this project's edge runtime that day,
// gemini-flash-latest did not answer a one-word prompt in 25 s, flash-lite took
// 22 s, and gemini-2.5-flash had been retired (404). Food estimates hung for
// minutes, recipes hung, and the body-fat estimate had been dead outright.
//
// Providers are HEDGED, not queued: when the current one hasn't answered within
// `staggerMs`, the next starts in parallel; the first answer that passes the
// caller's `parse` wins and cancels the rest. A provider that fails fast hands
// over immediately.

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
// Ordered by measured latency with thinking minimised (~1.5 s each). A model
// that 404s is skipped; if every one is gone the live model list is consulted,
// so a retirement degrades to "a different flash model", not an outage.
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
const KILO_URL = 'https://api.kilo.ai/api/gateway/chat/completions';
// Measured on a Slovak dish: beam-free 3 s, kilo-auto 7 s, nemotron-super 6.5 s.
// Free model lists churn; a dead one fails fast (404/429) and the next is tried.
const KILO_TEXT = ['reflection/beam-free', 'kilo-auto/free', 'nvidia/nemotron-3-super-120b-a12b:free'];
// openrouter/free read a curved Slovak yogurt label exactly; nemotron-vl returned nulls.
const KILO_VISION = ['openrouter/free', 'dots-studio/dots-3-note-preview:free'];
const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** The model looked and gave a reasoned "no" (no food in the photo, …). Final:
 *  it ends the race instead of failing over to a provider that might guess. */
export class Refusal extends Error {}

export type Image = { mime: string; data: string };
export const imageFrom = (v: unknown): Image | undefined => {
  const m = typeof v === 'string' ? v.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s) : null;
  return m ? { mime: m[1], data: m[2] } : undefined;
};

/** Last balanced {...} in the text that parses as JSON. Free models wrap their
 *  answer in fences, prose, or their own visible reasoning; the answer is last. */
export function extractJson(text: string): Record<string, unknown> | null {
  for (let end = text.lastIndexOf('}'); end > 0; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0, inStr = false;
    for (let i = end; i >= 0; i--) {
      const ch = text[i];
      if (inStr) { if (ch === '"' && text[i - 1] !== '\\') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '}') depth++;
      else if (ch === '{' && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(i, end + 1));
          if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch { /* not this one */ }
        break;
      }
    }
  }
  return null;
}

export type Ask = {
  prompt: string;
  image?: Image;
  /** Gemini responseSchema; other providers get only the prompt, so the prompt
   *  must describe the JSON shape too. */
  schema?: unknown;
  temperature?: number;
  /** Per-attempt timeout; defaults 12 s text / 20 s image (Gemini) and +8 s elsewhere. */
  timeoutMs?: number;
};
export type Options = { only?: unknown[] | null; staggerMs?: number; deadlineMs?: number };
type Provider = { name: string; vision: boolean; run: <T>(a: Ask, parse: (t: string) => T, s: AbortSignal) => Promise<{ value: T; provider: string }> };

const withTimeout = (s: AbortSignal, ms: number) => AbortSignal.any([s, AbortSignal.timeout(ms)]);
// Never let an upstream message carry a credential back to a client.
const scrub = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').slice(0, 200);

let geminiModels = GEMINI_MODELS;
let rediscovered = false;

function geminiCall(model: string, a: Ask, thinking: 'minimal' | 'low', signal: AbortSignal) {
  const parts: unknown[] = [{ text: a.prompt }];
  if (a.image) parts.push({ inlineData: { mimeType: a.image.mime, data: a.image.data } });
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    // Key in a header, never the URL: fetch errors echo the URL, and the old code
    // forwarded those messages to the client.
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(a.schema ? { responseSchema: a.schema } : {}),
        temperature: a.temperature ?? 0.2,
        thinkingConfig: { thinkingLevel: thinking },
      },
    }),
    signal: withTimeout(signal, a.timeoutMs ?? (a.image ? 20_000 : 12_000)),
  });
}

/** Every configured model 404'd: ask the API which flash models exist now and
 *  use those, newest first. Once per isolate. */
async function rediscover() {
  rediscovered = true;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': GEMINI_KEY }, signal: AbortSignal.timeout(5000),
    });
    const names: string[] = ((await r.json())?.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace('models/', ''))
      .filter((m: string) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(m))
      .sort((a: string, b: string) => parseFloat(b.slice(7)) - parseFloat(a.slice(7)));
    if (names.length) geminiModels = names.slice(0, 4);
  } catch { /* keep the old list; the other providers still run */ }
}

const gemini: Provider = {
  name: 'gemini', vision: true,
  async run(a, parse, signal) {
    if (!GEMINI_KEY) throw new Error('gemini: no key');
    let last = 'gemini: no model answered';
    for (let i = 0; i < geminiModels.length; i++) {
      const model = geminiModels[i];
      try {
        let res = await geminiCall(model, a, 'minimal', signal);
        let body = await res.json().catch(() => ({}));
        // Some models (gemini-flash-latest) reject 'minimal'; 'low' is the floor there.
        if (res.status === 400 && /thinking/i.test(body?.error?.message ?? '')) {
          res = await geminiCall(model, a, 'low', signal);
          body = await res.json().catch(() => ({}));
        }
        if (!res.ok) {
          last = `${model}: HTTP ${res.status} ${scrub(body?.error?.message ?? '')}`;
          if (res.status === 404 && i === geminiModels.length - 1 && !rediscovered) await rediscover();
          continue;
        }
        const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
        return { value: parse(text), provider: model };
      } catch (e) {
        if (e instanceof Refusal || signal.aborted) throw e;
        last = `${model}: ${scrub(String((e as Error)?.message ?? e))}`;
      }
    }
    throw new Error(last);
  },
};

function openAiCompatible(name: string, url: string, vision: boolean, models: (a: Ask) => string[], extra: Record<string, unknown> = {}): Provider {
  return {
    name, vision,
    async run(a, parse, signal) {
      let last = `${name}: no model answered`;
      for (const model of models(a)) {
        try {
          const content = a.image
            ? [{ type: 'text', text: a.prompt }, { type: 'image_url', image_url: { url: `data:${a.image.mime};base64,${a.image.data}` } }]
            : a.prompt;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: a.temperature ?? 0.2, ...extra }),
            signal: withTimeout(signal, (a.timeoutMs ?? (a.image ? 20_000 : 12_000)) + 8_000),
          });
          const body = await res.json().catch(() => ({}));
          const text = body?.choices?.[0]?.message?.content;
          if (!res.ok || typeof text !== 'string') {
            last = `${name}/${model}: HTTP ${res.status} ${scrub(JSON.stringify(body?.error ?? '').slice(0, 120))}`;
            continue;
          }
          return { value: parse(text), provider: `${name}:${model}` };
        } catch (e) {
          if (e instanceof Refusal || signal.aborted) throw e;
          last = `${name}/${model}: ${scrub(String((e as Error)?.message ?? e))}`;
        }
      }
      throw new Error(last);
    },
  };
}

const PROVIDERS: Provider[] = [
  gemini,
  openAiCompatible('kilo', KILO_URL, true, (a) => (a.image ? KILO_VISION : KILO_TEXT)),
  // Its anonymous model reasons before answering and the tier caps output, so a
  // long answer (a recipe) came back empty with finish_reason "length" until
  // reasoning was turned down. (max_tokens is a paid feature: HTTP 402.)
  openAiCompatible('pollinations', POLLINATIONS_URL, false, () => ['openai'], { reasoning_effort: 'low' }),
];

/**
 * Ask every eligible provider, hedged. `parse` turns raw model text into the
 * caller's value: throw an Error to fail over to the next provider, throw a
 * Refusal to end the race with that answer. `only` narrows the chain by
 * provider name so each fallback can be exercised on its own.
 */
export function ask<T>(a: Ask, parse: (text: string) => T, opts: Options = {}): Promise<{ value: T; provider: string }> {
  const providers = PROVIDERS.filter((p) => (!a.image || p.vision) && (!opts.only || opts.only.includes(p.name)));
  const stagger = opts.staggerMs ?? (a.image ? 9_000 : 6_000);
  const ctrl = new AbortController();
  const errors: string[] = [];
  return new Promise((resolve, reject) => {
    if (!providers.length) return reject(Object.assign(new Error('no provider matches'), { errors }));
    let next = 0, running = 0, done = false, timer: number | undefined;
    const deadline = setTimeout(() => end(new Error('deadline')), opts.deadlineMs ?? 40_000);
    function end(v: { value: T; provider: string } | Error) {
      if (done) return;
      done = true;
      clearTimeout(deadline); clearTimeout(timer); ctrl.abort();
      if (v instanceof Error) reject(Object.assign(v, { errors })); else resolve(v);
    }
    function launch() {
      clearTimeout(timer);
      if (done || next >= providers.length) return;
      const p = providers[next++];
      running++;
      p.run(a, parse, ctrl.signal).then(end, (e) => {
        running--;
        if (e instanceof Refusal) return end(e);
        errors.push(String(e?.message ?? e));
        if (next < providers.length) launch();
        else if (running === 0) end(new Error('all providers failed'));
      });
      timer = setTimeout(launch, stagger);
    }
    launch();
  });
}
