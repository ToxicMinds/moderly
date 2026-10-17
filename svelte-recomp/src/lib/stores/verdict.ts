// The one verdict, computed once and shared. Today's Pulse and the app-wide
// aura both need "how is the recomposition going right now" — the same fusion
// of weight trend, strength, protein and readiness the score card already does.
// Deriving it here (instead of in each component) keeps a single source of
// truth AND lets the background glow reflect the verdict on EVERY page, not
// just Today.
import { derived, type Readable } from 'svelte/store';
import { liveWorkoutLogs, liveBiometrics } from '$lib/stores/live';
import { body } from '$lib/stores/body';
import { strengthTrend } from '$lib/strength';
import { computeReadiness } from '$lib/readiness';
import { recompScore, type RecompScore, type RecompBand } from '$lib/recompScore';
import { shiftYmd } from '$lib/date';

export type Tone = 'good' | 'ok' | 'warn' | 'bad' | 'na';

export function bandTone(b: RecompBand): Tone {
  return b === 'dialed-in' ? 'good'
    : b === 'on-track' ? 'ok'
    : b === 'mixed' ? 'warn'
    : b === 'off-track' ? 'bad'
    : 'na';
}

export interface TodayVerdict {
  result: RecompScore;
  tone: Tone;
  readinessScore: number | null;
}

// Instantiate the live queries once for the whole app.
const _workoutLogs = liveWorkoutLogs();
const _bio = liveBiometrics();

export const todayVerdict: Readable<TodayVerdict> = derived(
  [body, _workoutLogs, _bio],
  ([$body, $workoutLogs, $bio]) => {
    const today = $body.today;
    const strength = strengthTrend($workoutLogs as any);

    // Protein adherence: mean of the last 7 LOGGED days' (protein / target).
    let proteinAdherencePct: number | null = null;
    if ($body.goalKg) {
      const cutoff = shiftYmd(-7, new Date(`${today}T12:00:00`));
      const days = [...$body.intake].filter(([d, v]) => d >= cutoff && v.items > 0);
      if (days.length) {
        let sum = 0;
        for (const [, v] of days) sum += Math.min(100, (v.protein / $body.proteinTargetG) * 100);
        proteinAdherencePct = sum / days.length;
      }
    }

    const todayBio = ($bio as any[]).find((b) => b.date === today);
    const history = ($bio as any[]).filter((b) => b.date < today).slice(-14);
    const readinessScore = computeReadiness(todayBio, history)?.score ?? null;

    const result = recompScore({
      weeklyLossRateKg: $body.weight?.rateKgPerWeek ?? 0,
      currentWeightKg: $body.currentKg,
      goalKg: $body.goalKg,
      strength: { direction: strength.direction, avgPct: strength.avgPct },
      proteinAdherencePct,
      readinessScore,
    });

    return { result, tone: bandTone(result.band), readinessScore };
  }
);
