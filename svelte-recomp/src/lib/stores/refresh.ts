// One "refresh everything" entry point, plus the clock that time-derived
// screens depend on.
//
// TWO PROBLEMS THIS SOLVES:
//
// 1. There was no single refresh. The Readiness card had a "Sync" button that
//    pulled Health Connect only; Supabase data relied on a realtime socket that
//    silently goes stale when the phone sleeps or loses signal; and nothing at
//    all re-read the clock. As an installed app rather than a browser tab, there
//    is no reload to fall back on — so "pull down to get the truth" has to be a
//    real, complete operation.
//
// 2. Recovery percentages froze. Muscle recovery, "3h ago", ACWR windows and
//    the coach's time-of-day advice are all computed from Date.now() inside
//    $derived blocks. A $derived only recomputes when a REACTIVE dependency
//    changes, and Date.now() is not reactive — so an app left open overnight
//    kept insisting a muscle needed 14 more hours, forever. `nowTick` is that
//    missing dependency: read it in any time-based $derived and the value moves
//    on a timer and on every manual refresh.

import { writable, derived, get } from 'svelte/store';
import { todayYmd } from '$lib/date';
import { refetchAll } from './sync';
import { syncHealthConnect } from '$lib/health/healthConnect';

/** Reactive "current time" in ms. Read this in any $derived that uses Date.now(). */
export const nowTick = writable<number>(Date.now());

/** Today's date (YYYY-MM-DD), rolling over at local midnight even in an app
 *  left open — the one place a screen gets "today" from. */
export const todayDate = derived(nowTick, () => todayYmd());

export const refreshing = writable(false);
export const lastRefresh = writable<number | null>(null);
export const refreshError = writable<string | null>(null);
/** How long each half of the last refresh took, ms (watch: null off the
 *  phone). Shown in App status, so a slow refresh on the phone can be read
 *  off rather than guessed at. */
export const lastRefreshTook = writable<{ cloud: number; watch: number | null } | null>(null);

/**
 * How often the clock advances on its own. One minute is plenty: recovery
 * windows are measured in hours, and anything faster just burns battery
 * re-rendering to show the same number.
 */
const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startClock() {
  if (timer) return;
  timer = setInterval(() => nowTick.set(Date.now()), TICK_MS);
  // Coming back from the background is the moment the on-screen numbers are
  // most likely to be hours stale, so re-read the clock immediately.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') nowTick.set(Date.now());
}

export function stopClock() {
  if (timer) clearInterval(timer);
  timer = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisible);
  }
}

let inFlight: Promise<void> | null = null;

/**
 * Refresh everything that can go stale, in parallel:
 *   • Supabase → Dexie for every synced table (weights, food, workouts, …)
 *   • Health Connect → steps, sleep, heart rate and watch workouts
 *   • the clock, so recovery/readiness/ACWR recompute against the real time
 *
 * Health Connect failing (web build, permission revoked) must not stop the
 * Supabase pull, and vice versa — `allSettled` keeps them independent, and a
 * partial failure is reported without throwing away the half that worked.
 */
export async function refreshAll(uid: string | null): Promise<void> {
  if (inFlight) return inFlight; // a second pull mid-refresh is a no-op, not a queue
  refreshing.set(true);
  refreshError.set(null);

  inFlight = (async () => {
    const t0 = performance.now();
    const took = { cloud: 0, watch: null as number | null };
    const results = await Promise.allSettled([
      refetchAll().finally(() => { took.cloud = performance.now() - t0; }),
      uid ? syncHealthConnect(uid).then((s) => { if (s?.native) took.watch = performance.now() - t0; return s; }) : Promise.resolve(null)
    ]);
    lastRefreshTook.set({ cloud: Math.round(took.cloud), watch: took.watch == null ? null : Math.round(took.watch) });

    nowTick.set(Date.now());
    lastRefresh.set(Date.now());

    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length === results.length) {
      refreshError.set(failed[0]?.reason?.message || 'Refresh failed — check your connection.');
    } else if (failed.length) {
      // Partial success is worth saying out loud rather than showing a green
      // tick over half-stale data.
      refreshError.set('Some data could not be refreshed.');
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
    refreshing.set(false);
  }
}

/** Whether a refresh is currently running (for callers outside Svelte). */
export function isRefreshing(): boolean {
  return get(refreshing);
}
