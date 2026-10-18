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
//
// The calorie target is the WEEK's: set from data up to last Sunday, so it holds
// still for seven days and the week's budget is a number you can plan against.
import { derived, type Readable } from 'svelte/store';
import { liveWeights, liveGoal, liveFoodLogs, liveDailyLogs, liveProfile, liveTracks, liveGoalReason, liveWorkoutLogs, liveActivitySessions } from './live';
import { todayDate } from './refresh';
import { weightVerdict, paceVsPlan, diagnoseStall, type WeightVerdict, type Pace, type StallDiagnosis } from '$lib/insights';
import { weeklyMaintenance, type AdaptiveTdee } from '$lib/adaptiveTdee';
import { resolveCalorieTarget, burnFloor, calcTdee, type LiveTargetResult, type ActivityLevel } from '$lib/tdee';
import { proteinTargetG, ageFrom } from '$lib/profile';
import { parseCalorieTarget } from '$lib/coach';
import { mondayOf, shiftYmd } from '$lib/date';
import { weekBudget, weekShape, type WeekBudget, type WeekShape } from '$lib/week';
import { lineState, type LineState } from '$lib/line';
import { milestoneState, type MilestoneState } from '$lib/milestone';
import { pulse, type Pulse } from '$lib/pulse';
import { programWeek } from '$lib/program';

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
  /** Last Sunday's learned estimate: logged days, rate, interval. The target
   *  itself is built on target.maintenance (smoothed across Sundays). */
  learned: AdaptiveTdee;
  target: LiveTargetResult;
  week: WeekBudget | null;
  /** Tomorrow's share, from what's logged through today: what the morning
   *  briefing says. On a Sunday it's a fresh week at this week's target. */
  tomorrow: WeekBudget | null;
  proteinTargetG: number;
  bodyFatPct: number | null;
  profile: BodyProfile | null;
  /** The least this body can burn (resting × 1.2), when the profile allows. */
  floorKcal: number | null;
  /** The next stop on the way to the goal (user_settings.milestone). */
  next: MilestoneState | null;
  /** How far the learned maintenance sits under that floor: food the log
   *  consistently doesn't carry. Fine while it's steady — the target is in
   *  the log's units. null when the log isn't short. */
  logShortKcal: number | null;
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
  [liveWeights(), liveGoal(), liveFoodLogs(), liveDailyLogs(), liveProfile(), liveTracks(), liveGoalReason(), todayDate],
  ([$weights, $goal, $food, $daily, $profile, $tracks, $goalReason, $today]) => {
    const today = $today as string;
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
    const weekStart = mondayOf(new Date(`${today}T12:00:00`));
    const weekly = weeklyMaintenance({
      intake: Array.from(intake, ([date, d]) => ({ date, kcal: d.kcal })), weights, weekStart,
      formulaKcal: profile && currentKg ? calcTdee({ weightKg: currentKg, ...profile }) : null,
    });
    // Last week's check-in answers move this week's target, for this week only
    // (stored on the reviewed week's Monday; see WeekCheckIn).
    const reviewed = shiftYmd(-7, new Date(`${weekStart}T12:00:00`));
    const nudge = +((($daily as any[]) ?? []).find((l) => l.date === reviewed)?.week_check?.kcalDelta ?? 0) || 0;
    const target = resolveCalorieTarget({
      goalKg, currentWeightKg: currentKg, learnedTdee: weekly.kcal,
      profile, storedTarget: parseCalorieTarget($goalReason as string | null), adjustKcal: nudge,
      usualKcal: weekly.latest.meanIntake,
    });
    // The pace the plan is built for; 0.5 kg/week when only a stored target exists.
    const cutting = goalKg != null && currentKg != null && currentKg - goalKg > 0.5;
    const plan = target.direction === 'lose' ? target.planKgPerWeek : cutting && target.direction == null ? 0.5 : null;
    // "Too fast" means past 1% of bodyweight a week, whatever the plan said.
    const pace = paceVsPlan(weight, plan, currentKg ? currentKg * 0.01 : null);

    // A finish date only from a loss the interval confirms — never from two
    // mornings' readings, and never while the trend is flat or rising.
    const losing = weight && weight.loKgPerWeek > 0 && (pace === 'on-pace' || pace === 'faster' || pace === 'slower');
    const weeksToGoal = losing && goalKg != null && currentKg != null && currentKg > goalKg
      ? Math.ceil((currentKg - goalKg) / (weight as WeightVerdict).rateKgPerWeek)
      : null;

    const floorKcal = profile && currentKg ? burnFloor({ weightKg: currentKg, ...profile }) : null;
    const short = target.basis === 'learned' && floorKcal != null && target.maintenance != null ? floorKcal - target.maintenance : 0;

    return {
      today, weight, currentKg, firstKg, goalKg, pace, weeksToGoal, intake, learned: weekly.latest, target,
      week: weekBudget(target.target, intake, today),
      tomorrow: weekBudget(target.target, intake, shiftYmd(1, new Date(`${today}T12:00:00`))),
      proteinTargetG: Math.max(1, proteinTargetG(goalKg, currentKg)),
      bodyFatPct, profile, floorKcal,
      next: milestoneState(p?.milestone ?? null, currentKg, p?.height_cm ? +p.height_cm : null, {
        today, trendOn: (ymd) => weightVerdict(weights, Date.parse(`${ymd}T12:00:00`))?.trendKg ?? null,
      }),
      logShortKcal: short >= 100 ? Math.round(short / 10) * 10 : null,
    };
  },
);

/** Days that count as training: a lifting log, or ≥ 30 minutes of sport the
 *  watch recorded (it also files a lot of 3-minute "sessions" that aren't). */
export function trainingDays(workoutLogs: any[], activity: any[]): Set<string> {
  const days = new Set<string>((workoutLogs ?? []).map((l) => l.date));
  const minutes = new Map<string, number>();
  for (const a of activity ?? []) minutes.set(a.date, (minutes.get(a.date) ?? 0) + (+a.duration_min || 0));
  for (const [d, m] of minutes) if (m >= 30) days.add(d);
  return days;
}

/** The week's shape: twelve weeks of logged days and mornings, by weekday. */
export const shape: Readable<WeekShape | null> = derived(
  [body, liveWeights()],
  ([$body, $weights]) => weekShape($body.intake, (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight })), $body.today),
);

/** The Today hero and the page's glow, read off the same trend (src/lib/pulse.ts). */
export const todayPulse: Readable<Pulse> = derived([body, liveProfile()], ([$b, $p]) => {
  const program = ($p as any)?.program ?? null;
  const week = programWeek(program, $b.today);
  return pulse({
    weight: $b.weight, pace: $b.pace, firstKg: $b.firstKg, goalKg: $b.goalKg, next: $b.next,
    restartedOn: week === 1 || week === 2 ? program.start : null,
  });
});

/** Why the scale isn't moving — once, for Today and Progress alike. */
export const stall: Readable<StallDiagnosis | null> = derived(
  [body, liveWorkoutLogs(), liveActivitySessions(), shape],
  ([$body, $logs, $activity, $shape]) => diagnoseStall({
    pace: $body.pace, intake: $body.intake, floorKcal: $body.floorKcal, today: $body.today,
    trainingDays: trainingDays($logs as any[], $activity as any[]), shape: $shape,
  }),
);

/** Your line, judged on the same trend every other screen shows. Its own store
 *  so a food entry doesn't recompute a year of daily trends. */
export const line: Readable<LineState | null> = derived(
  [liveWeights(), liveProfile(), todayDate],
  ([$weights, $profile, $today]) => lineState(
    ($profile as any)?.line ?? null,
    (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight })),
    $today as string,
  ),
);
