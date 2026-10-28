// Body-photo analysis, shared by every entry point.
//
// THE FIX THIS ENABLES: body analysis used to live in two disconnected halves.
// Progress Photos (Storage + before/after slider) never ran any AI, and the
// "Photo Estimate" card ran estimate-bf but (a) threw the photo away and (b)
// only wrote a physique_snapshots row -- it NEVER wrote a body_fat `tracks`
// entry, so the AI-estimated body-fat % never reached the composition / TDEE
// engine that turns bf% + weight into lean mass and calorie targets.
//
// This module is the single path both flows now call. It:
//   1. calls estimate-bf,
//   2. saves a physique_snapshot (optionally linked to the Storage photo it
//      came from, so the retroactive backfill can dedupe on storage_path), and
//   3. writes a body_fat `tracks` row -- which is what makes a photo actually
//      "do the TDEE analysis" the way a typed measurement does.

import { supabase } from '$lib/db/client';
import { upsertRecord } from '$lib/stores/sync';
import { todayYmd } from '$lib/date';

export type Region = { key: string; label: string; score: number; note: string };

export interface AnalyzeResult {
  estimate: string;
  percent: number | null;
  regions: Region[];
  summary: string | null;
  error?: string;
}

export type SnapshotSource = 'manual' | 'progress' | 'backfill';

/** Call the estimate-bf edge function on a data-URL image. */
export async function analyzeBodyPhoto(imageDataUrl: string, gender: string): Promise<AnalyzeResult> {
  const { data, error } = await supabase.functions.invoke('estimate-bf', {
    body: { image: imageDataUrl, gender },
  });
  if (error) {
    // The function's own words (why it refused) beat "non-2xx status code".
    let msg: string | undefined;
    try { msg = (await (error as any)?.context?.json())?.error; } catch { /* no body */ }
    return { estimate: 'Analysis failed', percent: null, regions: [], summary: null, error: msg || error.message || String(error) };
  }
  if (data?.error) return { estimate: 'Analysis failed', percent: null, regions: [], summary: null, error: data.error };
  const percent = typeof data?.percent === 'number' ? data.percent : null;
  return {
    estimate: data?.estimate ?? 'Could not estimate',
    percent,
    regions: Array.isArray(data?.regions) ? data.regions : [],
    summary: data?.summary ?? null,
  };
}

export interface SaveSnapshotArgs {
  uid: string;
  date?: string;
  percent: number;
  regions: Region[];
  summary: string | null;
  /** Storage object path of the progress photo, when this came from one. */
  storagePath?: string | null;
  source: SnapshotSource;
}

/** Zero-pad a possibly loose date (e.g. "2026-8-6") to YYYY-MM-DD so track
 *  dates match weight dates when composition joins them. */
function normalizeYmd(d: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(d || '');
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : d;
}

/** Deterministic UUIDv5 from (uid, date) so one body_fat reading exists per
 *  day and re-analysis upserts it instead of colliding. `tracks.id` is a real
 *  Postgres uuid column, so a plain string like "bfphoto_<date>" is rejected —
 *  that was the "invalid input syntax for type uuid" error. */
async function bodyFatTrackId(uid: string, date: string): Promise<string> {
  const bytes = new TextEncoder().encode(`bodyfat:${uid}:${date}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Upsert the body_fat `tracks` row for a date — the piece that makes a photo
 *  estimate feed composition/TDEE. Idempotent per (uid, date). */
export async function writeBodyFatTrack(uid: string, dateRaw: string, percent: number): Promise<void> {
  const date = normalizeYmd(dateRaw);
  await upsertRecord('tracks', {
    id: await bodyFatTrackId(uid, date),
    user_id: uid,
    date,
    name: 'body_fat',
    value: parseFloat(percent.toFixed(1)),
    unit: '%',
    created_at: new Date().toISOString(),
  });
}

/**
 * Persist an analysis: a body_fat `tracks` row PLUS a physique_snapshots row.
 * The track is written FIRST so a snapshot can never exist without its track
 * (which would leave composition/TDEE blind to that reading).
 */
export async function saveAnalysis(args: SaveSnapshotArgs): Promise<{ ok: boolean; error?: string }> {
  const date = normalizeYmd(args.date || todayYmd());
  try {
    // 1) The measurement that feeds recomp/TDEE. Deterministic id => no dupes.
    await writeBodyFatTrack(args.uid, date, args.percent);

    // 2) The physique snapshot (bf% + regions + summary + photo link).
    const row: Record<string, unknown> = {
      user_id: args.uid,
      date,
      bf_percent: args.percent,
      regions: args.regions,
      summary: args.summary,
      source: args.source,
    };
    if (args.storagePath) row.storage_path = args.storagePath;

    let { error: snapErr } = await supabase.from('physique_snapshots').insert(row);
    // Resilience: if storage_path/source columns aren't present yet (migration
    // not applied), retry with just the original columns rather than failing.
    if (snapErr && /column|schema cache|storage_path|source/i.test(snapErr.message || '')) {
      const legacy = { user_id: args.uid, date, bf_percent: args.percent, regions: args.regions, summary: args.summary };
      ({ error: snapErr } = await supabase.from('physique_snapshots').insert(legacy));
    }
    if (snapErr) throw snapErr;

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Repair pass: ensure every date that has physique snapshots also has its
 * body_fat track. When a day has multiple reads (e.g. front + side), their
 * bf% is averaged into one clean daily measurement. Cheap (no AI calls) and
 * idempotent — fixes snapshots left without a track by an earlier partial
 * failure. Returns how many day-tracks it wrote.
 */
export async function healBodyFatTracks(uid: string): Promise<number> {
  const { data, error } = await supabase
    .from('physique_snapshots')
    .select('date, bf_percent')
    .eq('user_id', uid)
    .not('bf_percent', 'is', null);
  if (error) return 0;
  const byDate = new Map<string, number[]>();
  for (const s of data || []) {
    if (typeof s.bf_percent === 'number') {
      const d = normalizeYmd(s.date as string);
      (byDate.get(d) || byDate.set(d, []).get(d)!).push(s.bf_percent);
    }
  }
  let n = 0;
  for (const [date, vals] of byDate) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    try { await writeBodyFatTrack(uid, date, avg); n++; } catch { /* skip */ }
  }
  return n;
}

/** storage_paths that already have a snapshot, so a backfill can skip them. */
export async function analyzedStoragePaths(uid: string): Promise<Set<string>> {
  const done = new Set<string>();
  const { data } = await supabase
    .from('physique_snapshots')
    .select('storage_path')
    .eq('user_id', uid)
    .not('storage_path', 'is', null);
  for (const r of data || []) if (r.storage_path) done.add(r.storage_path as string);
  return done;
}
