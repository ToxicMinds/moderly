// The one verdict, computed once and shared. Today's Pulse and the app-wide
// aura both need "how is the recomposition going right now" — the same fusion
// of weight trend, strength, protein and readiness the score card already does.
// Deriving it here (instead of in each component) keeps a single source of
// truth AND lets the background glow reflect the verdict on EVERY page, not
// just Today.
import { derived, type Readable } from 'svelte/store';
import {
  liveWeights, liveGoal, liveWorkoutLogs, liveFoodLogs, liveBiometrics
} from '$lib/stores/live';
import { nowTick } from '$lib/stores/refresh';
import { weightTrend } from '$lib/coach';
import { strengthTrend } from '$lib/strength';
import { computeReadiness } from '$lib/readiness';
import { recompScore, type RecompScore, type RecompBand } from '$lib/recompScore';
import { todayYmd, shiftYmd } from '$lib/date';

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
const _weights = liveWeights();
const _goal = liveGoal();
const _workoutLogs = liveWorkoutLogs();
const _foodLogs = liveFoodLogs();
const _bio = liveBiometrics();

export const todayVerdict: Readable<TodayVerdict> = derived(
  [_weights, _goal, _workoutLogs, _foodLogs, _bio, nowTick],
  ([$weights, $goal, $workoutLogs, $foodLogs, $bio, $tick]) => {
    void $tick;
    const today = todayYmd();
    const goalKg = ($goal as number | null) ?? null;
    const weights = ($weights as any[]) ?? [];
    const currentWeight = weights.length ? weights[weights.length - 1].weight : null;
    const proteinTargetG = goalKg ? Math.round(goalKg * 1.8) : 0;
    const trend = weightTrend(weights.map((w) => ({ date: w.date, weight: w.weight })), goalKg ?? 0);
    const strength = strengthTrend($workoutLogs as any);

    let proteinAdherencePct: number | null = null;
    if (proteinTargetG) {
      const cutoff = shiftYmd(-7, new Date($tick as number));
      const byDate = new Map<string, number>();
      for (const f of ($foodLogs as any[])) {
        if (f.date < cutoff) continue;
        byDate.set(f.date, (byDate.get(f.date) ?? 0) + (f.protein_g || 0));
      }
      if (byDate.size) {
        let sum = 0;
        for (const g of byDate.values()) sum += Math.min(100, (g / proteinTargetG) * 100);
        proteinAdherencePct = sum / byDate.size;
      }
    }

    const todayBio = ($bio as any[]).find((b) => b.date === today);
    const history = ($bio as any[]).filter((b) => b.date < today).slice(-14);
    const readinessScore = computeReadiness(todayBio, history)?.score ?? null;

    const result = recompScore({
      weeklyLossRateKg: trend.rateKgPerWeek,
      currentWeightKg: currentWeight,
      goalKg,
      strength: { direction: strength.direction, avgPct: strength.avgPct },
      proteinAdherencePct,
      readinessScore,
    });

    return { result, tone: bandTone(result.band), readinessScore };
  }
);
