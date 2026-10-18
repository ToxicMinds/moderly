// food-search — a CORS-capable doorway to Open Food Facts search.
//
// WHY (2026-10-16): the app searched OFF from the browser via /cgi/search.pl,
// which — like /api/v2/search — now answers 503. OFF's working search
// (search.openfoodfacts.org) sends no CORS headers, so a browser can't call it
// at all: food search had silently stopped finding anything.
//
// Deliberately thin. It runs a Slovakia/Czechia query and a world query in
// parallel and returns the raw hits, de-duplicated. Normalising (kJ-only
// products, names in any language) and ranking happen in the app, in
// src/lib/food.ts, where they are unit-tested and shared with barcode lookups.
//
//   POST {"q": "pilos tvaroh"}       -> {"hits": [...]}
//   POST {"code": "8585002503541"}   -> {"hits": [one product]}   (barcode fallback)

import { corsHeaders, json } from '../_shared/llm.ts';
import { signedIn } from '../_shared/auth.ts';

const SAL = 'https://search.openfoodfacts.org/search';
const FIELDS = [
  'code', 'product_name', 'product_name_sk', 'product_name_cs', 'product_name_en', 'product_name_de',
  'product_name_pl', 'product_name_hu', 'generic_name', 'brands', 'nutriments', 'serving_quantity',
  'product_quantity', 'countries_tags', 'unique_scans_n',
].join(',');

async function sal(q: string, size: number): Promise<Record<string, unknown>[]> {
  const url = `${SAL}?${new URLSearchParams({ q, langs: 'sk,cs,en', page_size: String(size), fields: FIELDS })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Moderly/1.0 (moderly.vercel.app)' } });
  if (!res.ok) throw new Error(`OFF search HTTP ${res.status}`);
  return (await res.json())?.hits ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  if (!(await signedIn(req))) return json({ error: 'Sign in to use this.' }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON.' }, 400); }

  const code = typeof body?.code === 'string' && /^\d{6,14}$/.test(body.code) ? body.code : null;
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 80) : '';
  if (!code && q.length < 2) return json({ hits: [] });

  // Lucene syntax: strip characters that would turn the user's words into operators.
  const safe = q.replace(/[+\-=&|><!(){}\[\]^"~*?:\\/]/g, ' ');
  const queries = code
    ? [sal(`code:${code}`, 1)]
    : [sal(`${safe} (countries_tags:"en:slovakia" OR countries_tags:"en:czech-republic")`, 24), sal(safe, 24)];
  const settled = await Promise.allSettled(queries);
  const seen = new Set<unknown>();
  const hits = settled
    .flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    .filter((h) => !seen.has(h.code) && seen.add(h.code));
  if (settled.every((s) => s.status === 'rejected')) {
    return json({ hits: [], error: 'Open Food Facts search is down right now.' });
  }
  return json({ hits });
});
