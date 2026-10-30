// THE WEEK ASKS BACK.
//
// Everything else in this app measures. The scale, the watch, the food log and
// the barbell all report numbers, and weeklyReview.ts turns them into a digest.
// But none of them can read the one signal that decides whether a plan survives:
// how it actually felt. A cut that is working on paper and leaving you starving
// at 10pm every night is a cut you will quit in three weeks, and no sensor in
// the world will say so.
//
// So once a week the app stops talking and asks three questions. The answers are
// not a diary entry — they change next week's numbers, combined with what was
// measured. That combination is the whole point: "I was starving" means one
// thing when the scale is falling 1.4%/week and something completely different
// when it hasn't moved at all.
//
// Pure and unit-tested; no Svelte, no Dexie. Stored as jsonb on daily_logs
// (keyed by the week's Monday), so it inherits that table's existing RLS rather
// than adding a new table to the sync surface.

import { dwt } from './units.ts';
export type Effort = 'easy' | 'right' | 'brutal';
export type Hunger = 'fine' | 'manageable' | 'constant';
export type Adherence = 'nailed' | 'mostly' | 'struggled';

export interface CheckInAnswers {
  effort: Effort;
  hunger: Hunger;
  adherence: Adherence;
  /** ISO timestamp — so a stored answer can be shown as "you said this on…". */
  answeredAt?: string;
  /** The plan the adherence question asked about, and its words that week. */
  plan?: string | null;
  planText?: string | null;
  /** One line about the week, for the user only — the journal, a week at a time. */
  note?: string | null;
}

export interface CheckInQuestion {
  key: 'effort' | 'hunger' | 'adherence';
  prompt: string;
  options: Array<{ value: string; label: string; hint: string }>;
}

/** The three questions. Deliberately three: a check-in that takes longer than
 *  ten seconds is a check-in that gets skipped, and a skipped one tells you
 *  nothing at all. */
export const CHECK_IN_QUESTIONS: CheckInQuestion[] = [
  {
    key: 'effort',
    prompt: 'How did training feel this week?',
    options: [
      { value: 'easy', label: 'Easy', hint: 'I had more in the tank' },
      { value: 'right', label: 'About right', hint: 'Hard but repeatable' },
      { value: 'brutal', label: 'Brutal', hint: 'I was dragging myself there' },
    ],
  },
  {
    key: 'hunger',
    prompt: 'And hunger?',
    options: [
      { value: 'fine', label: 'Barely noticed', hint: 'Comfortable all week' },
      { value: 'manageable', label: 'There, manageable', hint: 'Hungry sometimes, fine' },
      { value: 'constant', label: 'Constant', hint: 'Thinking about food all day' },
    ],
  },
  {
    key: 'adherence',
    prompt: 'Did you stick to the plan?',
    options: [
      { value: 'nailed', label: 'Nailed it', hint: 'Basically every day' },
      { value: 'mostly', label: 'Mostly', hint: 'A couple of loose days' },
      { value: 'struggled', label: 'Not really', hint: 'It got away from me' },
    ],
  },
];

/** What the app measured, which the answers get interpreted against. */
export interface CheckInContext {
  /** Weight change over the week in kg; NEGATIVE = lost. Null when unweighed. */
  weightChangeKg: number | null;
  currentWeightKg: number | null;
  /** Current daily calorie target, the thing an adjustment actually moves. */
  targetKcal: number | null;
  avgProteinG: number | null;
  proteinTargetG: number | null;
  avgSleepH: number | null;
  sessions: number;
  goalKg: number | null;
  /** The plan the adherence question asked about ("weekend"), when there was one. */
  planLabel?: string | null;
}

export interface CheckInAdjustment {
  /** kcal/day to add (positive) or remove (negative) from next week's target. */
  kcalDelta: number;
  nextTargetKcal: number | null;
  /** One line on training load for next week, or null when it's fine as-is. */
  trainingNote: string | null;
  headline: string;
  /** Why — each reason names the answer AND the measurement behind it. */
  reasons: string[];
}

/** Never move the target by more than this in one week. A check-in is a nudge,
 *  not a re-plan — a big swing here would whipsaw the adaptive TDEE. */
const MAX_STEP_KCAL = 250;

/** Weekly loss faster than this share of bodyweight risks muscle, so hunger at
 *  this pace is a signal to ease off rather than to push through. */
const FAST_LOSS_PCT = 1.0;

const clampStep = (n: number) => Math.max(-MAX_STEP_KCAL, Math.min(MAX_STEP_KCAL, n));

/**
 * Turn "how it felt" plus "what happened" into next week's numbers.
 *
 * The rules are deliberately conservative and each one is defensible out loud:
 * calories only go UP when hunger is genuinely biting and the scale proves there
 * is room to give some back; they only go DOWN when the week was comfortable,
 * adhered to, AND the scale did not move. Anything ambiguous changes nothing and
 * says why — a plan that lurches every seven days never gets a chance to work.
 */
export function checkInAdjustment(answers: CheckInAnswers, ctx: CheckInContext): CheckInAdjustment {
  const reasons: string[] = [];
  let kcalDelta = 0;

  const lossKg = ctx.weightChangeKg == null ? null : -ctx.weightChangeKg; // positive = lost
  const lossPct =
    lossKg != null && ctx.currentWeightKg && ctx.currentWeightKg > 0
      ? (lossKg / ctx.currentWeightKg) * 100
      : null;
  const atGoal = ctx.goalKg != null && ctx.currentWeightKg != null && ctx.currentWeightKg <= ctx.goalKg + 0.2;

  const proteinShort =
    ctx.avgProteinG != null && ctx.proteinTargetG != null && ctx.proteinTargetG > 0 &&
    ctx.avgProteinG < ctx.proteinTargetG * 0.85;

  // ── Hunger ───────────────────────────────────────────────────────────────
  if (answers.hunger === 'constant') {
    if (lossPct != null && lossPct >= FAST_LOSS_PCT) {
      kcalDelta += 200;
      reasons.push(`You were hungry all week and lost ${dwt(lossKg!)} — that's faster than ${FAST_LOSS_PCT}%/wk, so there is room to eat more without slowing the goal.`);
    } else if (proteinShort) {
      // Adding calories to a low-protein week fixes the symptom and not the cause.
      reasons.push(`Constant hunger on ${Math.round(ctx.avgProteinG!)} g protein against a ${ctx.proteinTargetG} g target — protein and fibre are what make a deficit tolerable. Fix that before adding calories.`);
    } else if (lossPct != null && lossPct < 0.2) {
      reasons.push('Hungry, but the scale barely moved — adding calories now would stall it completely. Hold the target and push protein, fibre and sleep first.');
    } else {
      kcalDelta += 100;
      reasons.push('Hunger was constant and the loss is on pace — a small increase buys adherence, which matters more than a fast week.');
    }
  } else if (answers.hunger === 'fine' && answers.adherence === 'nailed' && !atGoal) {
    if (lossPct != null && lossPct < 0.2) {
      kcalDelta -= 150;
      reasons.push('You stuck to it, never felt hungry, and the scale did not move — the target is at or above maintenance now. A small trim restarts it.');
    } else {
      reasons.push('Comfortable and on pace. Nothing to change — this is exactly what a sustainable deficit looks like.');
    }
  }

  // ── Effort ───────────────────────────────────────────────────────────────
  let trainingNote: string | null = null;
  if (answers.effort === 'brutal') {
    if (ctx.avgSleepH != null && ctx.avgSleepH < 7) {
      trainingNote = `Training felt brutal on ${ctx.avgSleepH.toFixed(1)} h of sleep. That is a recovery problem, not a toughness one — protect lights-out before adding any load.`;
    } else if (lossPct != null && lossPct >= FAST_LOSS_PCT) {
      trainingNote = 'Brutal sessions while dropping weight fast is the classic muscle-loss setup. Keep the loads, cut a set or two per session until the pace eases.';
    } else {
      trainingNote = 'Hold volume where it is next week — repeatable beats heroic. Add load only once a week feels merely hard.';
    }
  } else if (answers.effort === 'easy' && answers.adherence !== 'struggled') {
    trainingNote = ctx.sessions >= 3
      ? 'You had more in the tank — add one set to your main lift, or 2.5 kg where the last set moved cleanly.'
      : 'You had more in the tank, and only ' + ctx.sessions + ' training day' + (ctx.sessions === 1 ? '' : 's') + ' this week. Another training day is the cheapest win available.';
  }

  // ── Adherence ────────────────────────────────────────────────────────────
  if (answers.adherence === 'struggled') {
    // A plan nobody follows is not a plan. Never tighten one that already broke.
    if (kcalDelta < 0) {
      kcalDelta = 0;
      reasons.push('Holding the target rather than trimming it — a week that already got away from you does not need a harder number.');
    }
    reasons.push(ctx.planLabel
      ? `The ${ctx.planLabel.toLowerCase()} plan didn't survive the moment. Make it smaller — one thing you'd bet on doing — rather than trying harder at the same one.`
      : 'Pick ONE thing for next week: log every day, or hit protein every day. Not both. One kept promise rebuilds the habit faster than a perfect plan you abandon on Wednesday.');
  }

  kcalDelta = clampStep(kcalDelta);
  const nextTargetKcal = ctx.targetKcal != null ? Math.round(ctx.targetKcal + kcalDelta) : null;

  if (reasons.length === 0) {
    reasons.push('Nothing in this week argues for a change. Repeat it — consistency is what makes the next four weeks readable.');
  }

  const headline =
    kcalDelta > 0 ? `Eat ${kcalDelta} kcal more a day next week.`
    : kcalDelta < 0 ? `Trim ${Math.abs(kcalDelta)} kcal a day next week.`
    : 'Same targets next week.';

  return { kcalDelta, nextTargetKcal, trainingNote, headline, reasons };
}

/**
 * The questions, with "did you stick to the plan?" made concrete when the user
 * has written one: it asks about THEIR words. Reviewing your own goal is one of
 * the few things that works without anyone else in the room — a buddy's main
 * job is asking "so, did you?", and this asks it.
 */
export function checkInQuestions(plan: { label: string; then: string } | null): CheckInQuestion[] {
  if (!plan) return CHECK_IN_QUESTIONS;
  return CHECK_IN_QUESTIONS.map((q) => q.key !== 'adherence' ? q : {
    key: 'adherence',
    prompt: `Your ${plan.label.toLowerCase()} plan: “${plan.then}” — did it hold?`,
    options: [
      { value: 'nailed', label: 'Kept it', hint: 'Every time it came up' },
      { value: 'mostly', label: 'Mostly', hint: 'Once or twice it slipped' },
      { value: 'struggled', label: 'Not this time', hint: 'It didn’t survive the moment' },
    ],
  });
}

/**
 * Monday (YYYY-MM-DD) of the week a check-in asked TODAY is about — and the key
 * the answers are stored under.
 *
 * Weeks run Monday-Sunday (matching weeklyReview.ts), so which week is "the one
 * that just ended" depends on the day you ask:
 *   Sunday  — the week ending today, i.e. this week's Monday (today - 6)
 *   Mon/Tue — the week that ended yesterday/Sunday, i.e. this week's Monday - 7
 * Getting this wrong by one week would ask about a week the user already
 * answered for, and file the answer against the wrong seven days of data.
 */
export function reviewWeekStart(todayYmdStr: string): string {
  const d = new Date(todayYmdStr + 'T00:00:00');
  const dow = d.getDay();
  const toMonday = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - toMonday - (dow === 0 ? 0 : 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Should the app ask right now? Only from Sunday onward (the week has to be
 * substantially over before "how did it feel" means anything), only once per
 * week, and never before there is a week of data to talk about.
 */
export function shouldAskCheckIn(
  todayYmdStr: string,
  answeredWeekStarts: string[],
  daysOfDataLogged: number
): boolean {
  if (daysOfDataLogged < 4) return false;
  const dow = new Date(todayYmdStr + 'T00:00:00').getDay();
  const weekIsOver = dow === 0 || dow === 1 || dow === 2; // Sun, Mon, Tue
  if (!weekIsOver) return false;
  return !answeredWeekStarts.includes(reviewWeekStart(todayYmdStr));
}
