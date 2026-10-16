// food-search — one search over Open Food Facts that actually answers.
//
// WHY a server hop (2026-10-16): the app searched OFF straight from the
// browser via /cgi/search.pl, and that endpoint — like /api/v2/search — was
// returning 503. OFF's working search (search.openfoodfacts.org) sends no CORS
// headers, so a browser can't call it at all. Searching "food I eat" had
// quietly become searching nothing.
//
// Two queries run in parallel — Slovak/Czech products only, and the whole
// world — then everything is merged and RE-RANKED here, because OFF's own
// ranking is poor ("excelent protein" filtered to Slovakia ranked smoked tofu
// first). Energy is normalised so kJ-only products (common in the EU) are no
// longer dropped, and names fall back through every language OFF stores.
//
//   POST {"q": "pilos tvaroh"}       -> {"results": [...]}
//   POST {"code": "8585002503541"}   -> {"results": [one product]}  (barcode fallback)

const SAL = 'https://search.openfoodfacts.org/search';
const FIELDS = [
  'code', 'product_name', 'product_name_sk', 'product_name_cs', 'product_name_en', 'product_name_de',
  'product_name_pl', 'product_name_hu', 'generic_name', 'brands', 'nutriments', 'serving_quantity',
  'product_quantity', 'quantity', 'countries_tags', 'unique_scans_n',
].join(',');
const LOCAL = /en:(slovakia|czech-republic)/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const num = (v: unknown): number | null => {
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

export type Product = {
  code: string; name: string; brand: string;
  kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null;
  serving_g: number | null; package_g: number | null; local: boolean; scans: number;
};

/** One OFF product (search hit or API product) -> the app's per-100 g shape. */
export function normalize(p: Record<string, any>): Product | null {
  const name = [p.product_name_sk, p.product_name_cs, p.product_name, p.product_name_en, p.product_name_de,
    p.product_name_pl, p.product_name_hu, p.generic_name].find((s) => typeof s === 'string' && s.trim());
  if (!name || !p.code) return null;
  const nm = p.nutriments ?? {};
  const protein = num(nm.proteins_100g), carbs = num(nm.carbohydrates_100g), fat = num(nm.fat_100g);
  // kcal, else kJ (energy_100g is kJ in OFF), else rebuild from macros.
  const kj = num(nm['energy-kj_100g']) ?? num(nm.energy_100g);
  let kcal = num(nm['energy-kcal_100g']) ?? (kj != null ? kj / 4.184 : null);
  if (kcal == null && (protein != null || carbs != null || fat != null)) kcal = 4 * (protein ?? 0) + 4 * (carbs ?? 0) + 9 * (fat ?? 0);
  const brands = Array.isArray(p.brands) ? p.brands : String(p.brands ?? '').split(',');
  return {
    code: String(p.code), name: String(name).trim(), brand: String(brands[0] ?? '').trim(),
    kcal: kcal != null && kcal <= 950 ? Math.round(kcal) : null,
    protein_g: protein != null ? r1(protein) : null, carbs_g: carbs != null ? r1(carbs) : null, fat_g: fat != null ? r1(fat) : null,
    serving_g: num(p.serving_quantity), package_g: num(p.product_quantity),
    local: LOCAL.test(JSON.stringify(p.countries_tags ?? '')), scans: num(p.unique_scans_n) ?? 0,
  };
}

/** Our ranking: every query word should start a word in name/brand; local
 *  products and ones with real nutrition data rise; popular ones break ties. */
export function score(p: Product, q: string): number {
  const words = fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hayWords = fold(`${p.name} ${p.brand}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hits = words.filter((w) => hayWords.some((h) => h.startsWith(w))).length;
  if (!words.length || hits === 0) return -Infinity;
  return (hits / words.length) * 100
    + (p.local ? 15 : 0)
    + (p.kcal != null ? 10 : -40)
    + (fold(p.name).startsWith(words[0]) ? 6 : 0)
    + Math.min(10, Math.log2(p.scans + 1) * 2);
}

async function sal(q: string, size: number): Promise<Record<string, any>[]> {
  const url = `${SAL}?${new URLSearchParams({ q, langs: 'sk,cs,en', page_size: String(size), fields: FIELDS })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'RecompOS/1.0 (svelte-recomp.vercel.app)' } });
  if (!res.ok) throw new Error(`OFF search HTTP ${res.status}`);
  return (await res.json())?.hits ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const started = Date.now();
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON.' }, 400); }

  const code = typeof body?.code === 'string' && /^\d{6,14}$/.test(body.code) ? body.code : null;
  if (code) {
    try {
      const hit = (await sal(`code:"${code}"`, 1))[0];
      const p = hit ? normalize(hit) : null;
      return json({ results: p ? [p] : [], ms: Date.now() - started });
    } catch (e) {
      return json({ results: [], error: String((e as Error).message), ms: Date.now() - started });
    }
  }

  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 80) : '';
  if (q.length < 2) return json({ results: [] });
  // Lucene syntax: strip characters that would turn the user's words into operators.
  const safe = q.replace(/[+\-=&|><!(){}\[\]^"~*?:\\/]/g, ' ');

  const settled = await Promise.allSettled([
    sal(`${safe} (countries_tags:"en:slovakia" OR countries_tags:"en:czech-republic")`, 24),
    sal(safe, 24),
  ]);
  const seen = new Set<string>();
  const merged: Product[] = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const hit of s.value) {
      const p = normalize(hit);
      if (p && !seen.has(p.code)) { seen.add(p.code); merged.push(p); }
    }
  }
  if (!merged.length && settled.every((s) => s.status === 'rejected')) {
    return json({ results: [], error: 'Open Food Facts search is down right now.', ms: Date.now() - started });
  }
  const results = merged
    .map((p) => ({ p, s: score(p, q) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s)
    .slice(0, 15)
    .map((x) => x.p);
  return json({ results, ms: Date.now() - started });
});
