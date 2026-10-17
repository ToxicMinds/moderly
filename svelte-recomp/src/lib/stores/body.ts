// The body's numbers, computed once for every screen: where the weight is (the
// trend, not one morning's reading), how fast it is moving against the plan,
// what the food log says the body burns, and the calorie and protein targets
// that follow from those.
//
// Today, Food, Progress, the weekly check-in, the review and the coach all read
// this. Before, each one recomputed its own — four weight slopes, five
// intake-by-date maps, three calorie targets — and they disagreed: one account
// was told "losing 1.5 kg a week, 11 weeks to goal" on Today while Progress
// called the same readings too noisy and the real eight-week trend was a gain.
import { derived, type Readable } from 'svelte/store';
import { liveWeights, liveGoal, liveFoodLogs, liveDailyLogs, liveProfile, liveTracks, liveGoalReason } from './live';
import { nowTick } from './refresh';
import { todayYmd } from '$lib/date';
import { weightVerdict, paceVsPlan, type WeightVerdict, type Pace } from '$lib/insights';
import { adaptiveTdee, type AdaptiveTdee } from '$lib/adaptiveTdee';
import { resolveCalorieTarget, burnFloor, type LiveTargetResult, type ActivityLevel } from '$lib/tdee';
import { proteinTargetG, ageFrom } from '$lib/profile';
import { parseCalorieTarget } from '$lib/coach';

export interface DayIntake { kcal: number; protein: number; carbs: number; fat: number; items: number }

export interface BodyProfile {
  heightCm: number; age: number; gender: 'male' | 'female'; activityLevel: ActivityLevel; bodyFatPct: number | null;
}

export interface Body {
  today: string;
  weight: WeightVerdict | null;
  /** The trend weight, else the latest reading, else the onboarding weight. */
  currentKg: number | null;
  firstKg: number | null;
  goalKg: number | null;
  pace: Pace;
  /** Only while genuinely losing toward a goal below; null otherwise. */
  weeksToGoal: number | null;
  /** Logged food per day. A day with no itemised food falls back to its
   *  quick-logged kcal, so older quick-log days still count. */
  intake: Map<string, DayIntake>;
  learned: AdaptiveTdee;
  target: LiveTargetResult;
  proteinTargetG: number;
  bodyFatPct: number | null;
  profile: BodyProfile | null;
  /** The least this body can burn (resting × 1.2), when the profile allows. */
  floorKcal: number | null;
}

function intakeByDate(food: any[], daily: any[]): Map<string, DayIntake> {
  const m = new Map<string, DayIntake>();
  for (const f of food) {
    const d = m.get(f.date) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, items: 0 };
    d.kcal += +f.kcal || 0; d.protein += +f.protein_g || 0; d.carbs += +f.carbs_g || 0; d.fat += +f.fat_g || 0; d.items++;
    m.set(f.date, d);
  }
  for (const l of daily) {
    if (!m.has(l.date) && (+l.kcal || 0) > 0) m.set(l.date, { kcal: +l.kcal, protein: 0, carbs: 0, fat: 0, items: 0 });
  }
  return m;
}

export const body: Readable<Body> = derived(
  [liveWeights(), liveGoal(), liveFoodLogs(), liveDailyLogs(), liveProfile(), liveTracks(), liveGoalReason(), nowTick],
  ([$weights, $goal, $food, $daily, $profile, $tracks, $goalReason, $tick]) => {
    void $tick;
    const today = todayYmd();
    const weights = (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight }));
    const p = $profile as any;
    const goalKg = ($goal as number | null) ?? null;

    const weight = weightVerdict(weights, Date.parse(`${today}T12:00:00`));
    const currentKg = weight?.trendKg ?? weight?.latestKg ?? (p?.start_kg != null ? +p.start_kg : null);
    const firstKg = weights.length ? weights[0].weight : null;

    const bf = (($tracks as any[]) ?? []).filter((t) => t.name === 'body_fat' && t.value > 0)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const bodyFatPct = bf.length ? +bf[bf.length - 1].value : null;
    const age = ageFrom(p?.birth_year);
    const profile: BodyProfile | null =
      p && p.height_cm && age != null && (p.sex === 'male' || p.sex === 'female') && p.activity_level
        ? { heightCm: +p.height_cm, age, gender: p.sex, activityLevel: p.activity_level as ActivityLevel, bodyFatPct }
        : null;

    const intake = intakeByDate(($food as any[]) ?? [], ($daily as any[]) ?? []);
    const learned = adaptiveTdee({ intake: Array.from(intake, ([date, d]) => ({ date, kcal: d.kcal })), weights, asOf: today });
    const target = resolveCalorieTarget({
      goalKg, currentWeightKg: currentKg,
      learnedTdee: learned.tdee,
      learnedConfidence: learned.confidence === 'insufficient' ? null : learned.confidence,
      profile, storedTarget: parseCalorieTarget($goalReason as string | null),
    });
    // The pace the plan is built for; 0.5 kg/week when only a stored target exists.
    const cutting = goalKg != null && currentKg != null && currentKg - goalKg > 0.5;
    const plan = target.direction === 'lose' ? target.planKgPerWeek : cutting && target.direction == null ? 0.5 : null;
    const pace = paceVsPlan(weight, plan);

    // A finish date only from a loss the interval confirms — never from two
    // mornings' readings, and never while the trend is flat or rising.
    const losing = weight && weight.loKgPerWeek > 0 && (pace === 'on-pace' || pace === 'faster' || pace === 'slower');
    const weeksToGoal = losing && goalKg != null && currentKg != null && currentKg > goalKg
      ? Math.ceil((currentKg - goalKg) / (weight as WeightVerdict).rateKgPerWeek)
      : null;

    return {
      today, weight, currentKg, firstKg, goalKg, pace, weeksToGoal, intake, learned, target,
      proteinTargetG: Math.max(1, proteinTargetG(goalKg, currentKg)),
      bodyFatPct, profile,
      floorKcal: profile && currentKg ? burnFloor({ weightKg: currentKg, ...profile }) : null,
    };
  },
);
