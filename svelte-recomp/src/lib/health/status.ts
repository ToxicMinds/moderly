// Per-signal health-data diagnostics.
//
// Answers the question the user actually has — "what is my watch actually
// feeding this app right now?" — instead of a vague "connected" badge. For each
// signal (steps, sleep, heart rate, workouts) it reports whether the Health
// Connect read permission is granted AND whether any data actually arrived in
// the last sync, plus a plain-language hint when something's missing. Pure so
// it's unit-testable and free of Capacitor/Dexie.

import { READ_PERMISSION } from './permissions';

export type SignalKey = 'steps' | 'sleep' | 'hr' | 'workouts';

export type SignalState = 'ok' | 'granted-no-data' | 'not-granted' | 'unknown';

export interface SignalStatus {
  key: SignalKey;
  label: string;
  emoji: string;
  /** True if at least one backing read permission is granted. */
  granted: boolean;
  /** Days of this signal captured in the last sync. */
  days: number;
  state: SignalState;
  /** One-line, plain-language "what to do" (empty when nothing to do). */
  hint: string;
}

export interface SyncResultCounts {
  steps: number;
  sleep: number;
  hr: number;
  workouts: number;
}

// Each signal can be backed by more than one record type (heart rate spans
// instantaneous, resting and HRV) — granted if ANY of them is.
const SIGNALS: Array<{ key: SignalKey; label: string; emoji: string; perms: string[] }> = [
  { key: 'steps', label: 'Steps', emoji: '👟', perms: [READ_PERMISSION.Steps] },
  { key: 'sleep', label: 'Sleep', emoji: '😴', perms: [READ_PERMISSION.SleepSession] },
  {
    key: 'hr',
    label: 'Heart rate',
    emoji: '❤️',
    perms: [
      READ_PERMISSION.HeartRateSeries,
      READ_PERMISSION.RestingHeartRate,
      READ_PERMISSION.HeartRateVariabilityRmssd
    ]
  },
  { key: 'workouts', label: 'Workouts', emoji: '🏸', perms: [READ_PERMISSION.ExerciseSession] }
];

/**
 * Build the per-signal status list.
 * @param granted  the granted read-permission strings, or null when unknown
 *                 (never synced / not on a device).
 * @param result   day-counts from the last sync, or null when none yet.
 */
export function buildHealthStatus(
  granted: Set<string> | string[] | null,
  result: SyncResultCounts | null
): SignalStatus[] {
  const grantedSet = granted == null ? null : granted instanceof Set ? granted : new Set(granted);

  return SIGNALS.map(({ key, label, emoji, perms }) => {
    const isGranted = grantedSet != null && perms.some((p) => grantedSet.has(p));
    const days = result ? Math.max(0, Math.round(result[key] ?? 0)) : 0;

    let state: SignalState;
    let hint = '';
    if (grantedSet == null) {
      state = 'unknown';
    } else if (!isGranted) {
      state = 'not-granted';
      hint = `Tap Sync and allow ${label} in the Health Connect prompt.`;
    } else if (days > 0) {
      state = 'ok';
    } else {
      state = 'granted-no-data';
      hint = `Allowed, but nothing arrived yet. Refresh OHealth first (it updates on its own schedule), then tap Sync.`;
    }

    return { key, label, emoji, granted: isGranted, days, state, hint };
  });
}

/** Short glyph for a status, for compact UI. */
export function statusGlyph(state: SignalState): string {
  switch (state) {
    case 'ok':
      return '✓';
    case 'granted-no-data':
      return '○';
    case 'not-granted':
      return '⚠️';
    default:
      return '·';
  }
}

/** True when at least one signal is actually delivering data. */
export function anyDataFlowing(list: SignalStatus[]): boolean {
  return list.some((s) => s.state === 'ok');
}
