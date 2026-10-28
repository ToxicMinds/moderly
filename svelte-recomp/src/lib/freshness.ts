// Signal freshness — is a watch/health signal actually from the period it's
// being shown for, or is it a stale reading being silently presented as current?
//
// THE BUG THIS GENERALISES: when the watch isn't worn overnight, no new sleep
// (or steps, or heart-rate) lands for today. Screens that quietly fell back to
// "the most recent reading" then coached off two-day-old numbers as if they
// were last night's. The honest answer to "what is this number's age?" belongs
// in one place, so every surface can label it — or refuse to use it — the same
// way. Pure + unit-tested; no Dexie/Svelte.

export type Freshness = 'fresh' | 'stale' | 'missing';

export interface SignalFreshness {
  state: Freshness;
  /** Whole calendar days between the latest reading and `today`. null = missing. */
  ageDays: number | null;
  /** Short human label, e.g. "Last night", "Yesterday", "3 days ago", "No data". */
  label: string;
}

/** Whole calendar days from `a` to `b` (both YYYY-MM-DD). Positive when b is later. */
export function daysBetweenYmd(a: string, b: string): number {
  const ta = new Date(a + 'T00:00:00').getTime();
  const tb = new Date(b + 'T00:00:00').getTime();
  return Math.round((tb - ta) / 86400000);
}

export interface FreshnessOpts {
  /** A reading up to this many days old still counts as "fresh". Default 0 (today only). */
  freshWithinDays?: number;
  /** Noun for a zero-day-old reading. "last night" for sleep, "today" for steps. */
  zeroLabel?: string;
  /** Label shown when there is no reading at all. */
  missingLabel?: string;
}

/**
 * Classify a signal by the date of its most recent reading relative to today.
 * `latestDate` is the YYYY-MM-DD the freshest reading is attributed to (for
 * sleep that's the wake day), or null/undefined when nothing has arrived.
 */
export function signalFreshness(
  latestDate: string | null | undefined,
  today: string,
  opts: FreshnessOpts = {}
): SignalFreshness {
  const freshWithin = opts.freshWithinDays ?? 0;
  const zeroLabel = opts.zeroLabel ?? 'today';
  const missingLabel = opts.missingLabel ?? 'No data yet';

  if (!latestDate) return { state: 'missing', ageDays: null, label: missingLabel };

  const ageDays = Math.max(0, daysBetweenYmd(latestDate, today));
  const state: Freshness = ageDays <= freshWithin ? 'fresh' : 'stale';

  let label: string;
  if (ageDays <= 0) label = zeroLabel;
  else if (ageDays === 1) label = 'Yesterday';
  else label = `${ageDays} days ago`;

  return { state, ageDays, label };
}

/** The most recent date in a list of dated rows (YYYY-MM-DD), or null if empty. */
export function latestDate<T extends { date: string }>(
  rows: T[],
  predicate: (r: T) => boolean = () => true
): string | null {
  let best: string | null = null;
  for (const r of rows) {
    if (!r?.date || !predicate(r)) continue;
    if (best == null || r.date > best) best = r.date;
  }
  return best;
}
