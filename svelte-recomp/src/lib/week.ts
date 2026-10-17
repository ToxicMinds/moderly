// The week as the unit of eating: one budget, Monday to Sunday.
//
// A daily target turns one big meal into a lost day, and a lost day is how one
// big meal becomes a big weekend — "the diet's broken anyway". A weekly budget
// makes the same meal a cost: a big Saturday leaves less for Sunday, it doesn't
// break anything. Pure; see selfcheck.js.

import { mondayOf } from './date.ts';
import { fitWeightLine, weightVerdict, type WeighIn } from './insights.ts';

export interface WeekBudget {
  start: string;
  /** target × 7. */
  budget: number;
  /** Logged Monday..today. */
  logged: number;
  /** Logged Monday..yesterday — what today's share is worked out from. */
  before: number;
  /** Days left including today. */
  daysLeft: number;
  /** What's left, spread evenly over the days left. */
  share: number;
}

export function weekBudget(target: number | null, intake: Map<string, { kcal: number }>, today: string): WeekBudget | null {
  if (target == null || target <= 0) return null;
  const at = new Date(`${today}T12:00:00`);
  const start = mondayOf(at);
  let logged = 0, before = 0;
  for (const [d, v] of intake) {
    if (d < start || d > today) continue;
    logged += v.kcal;
    if (d < today) before += v.kcal;
  }
  const daysLeft = 7 - ((at.getDay() + 6) % 7);
  const budget = target * 7;
  return { start, budget, logged: Math.round(logged), before: Math.round(before), daysLeft, share: Math.round((budget - before) / daysLeft) };
}

// ---------------------------------------------------------------------------
// The week's shape: where in it the food goes, and what the scale does with it
// ---------------------------------------------------------------------------


export interface WeekShape {
  /** Median logged kcal per weekday, Monday first. */
  kcal: number[];
  /** That weekday's mornings against the local trend, kg, Monday first; null
   *  where there are too few mornings to say. */
  scale: (number | null)[];
  /** Median logged day Monday–Thursday, and Friday–Sunday. */
  weekdayKcal: number;
  weekendKcal: number;
  /** weekendKcal − weekdayKcal, kcal a day. */
  weekendGap: number;
  /** Weekday index (0 = Monday) the scale reads heaviest / lightest; null without scale data. */
  heaviest: number | null;
  lightest: number | null;
}

const DAY_MS = 86400000;
const monFirst = (d: string) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Twelve weeks folded onto one: the median logged day for each weekday, and
 * how each weekday's mornings sit against the local trend (a line through the
 * three weeks around each one, so a cut or a gain doesn't read as a rhythm).
 *
 * Most people's weeks have a shape — the weekend eats more and the scale shows
 * it two days later — and seeing your own is what turns "the weekend" from a
 * vague guilt into a number with a plan attached. null until every weekday has
 * at least four logged days behind it.
 */
export function weekShape(intake: Map<string, { kcal: number }>, weights: WeighIn[], today: string, days = 84): WeekShape | null {
  const end = Date.parse(`${today}T12:00:00`);
  const recent = (d: string) => { const t = Date.parse(`${d}T12:00:00`); return t <= end && t > end - days * DAY_MS; };

  const byDay: number[][] = [[], [], [], [], [], [], []];
  for (const [d, v] of intake) if (recent(d) && v.kcal >= 800) byDay[monFirst(d)].push(v.kcal);
  if (byDay.some((a) => a.length < 4)) return null;
  const kcal = byDay.map((a) => Math.round(median(a)));

  const resid: number[][] = [[], [], [], [], [], [], []];
  const valid = (weights ?? []).filter((w) => w?.date && w.weight > 0 && recent(w.date));
  for (const w of valid) {
    const t = Date.parse(`${w.date}T12:00:00`);
    const near = valid.filter((x) => Math.abs(Date.parse(`${x.date}T12:00:00`) - t) <= 10 * DAY_MS);
    if (near.length < 6) continue;
    const fit = fitWeightLine(near, t + 10 * DAY_MS, 21);
    if (!fit) continue;
    const lastT = Math.max(...near.map((x) => Date.parse(`${x.date}T12:00:00`)));
    resid[monFirst(w.date)].push(w.weight - (fit.endKg + fit.slopePerDay * ((t - lastT) / DAY_MS)));
  }
  const scale = resid.map((a) => (a.length >= 3 ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null));
  const known = scale.map((v, i) => [v, i] as const).filter(([v]) => v != null) as Array<readonly [number, number]>;
  const heaviest = known.length >= 5 ? known.reduce((a, b) => (b[0] > a[0] ? b : a))[1] : null;
  const lightest = known.length >= 5 ? known.reduce((a, b) => (b[0] < a[0] ? b : a))[1] : null;

  const weekendKcal = Math.round(median([4, 5, 6].flatMap((i) => byDay[i])) / 10) * 10;
  const weekdayKcal = Math.round(median([0, 1, 2, 3].flatMap((i) => byDay[i])) / 10) * 10;
  return { kcal, scale, weekdayKcal, weekendKcal, weekendGap: weekendKcal - weekdayKcal, heaviest, lightest };
}

// ---------------------------------------------------------------------------
// Week by week: the journal the Sunday check-in writes, a line at a time
// ---------------------------------------------------------------------------

export interface JournalWeek {
  /** Monday the check-in was filed under. */
  weekStart: string;
  /** The trend at that week's end, and its change from the week before. */
  trendKg: number | null;
  deltaKg: number | null;
  /** The plan reviewed that week, in the words it had then. */
  planText: string | null;
  held: 'kept' | 'mostly' | 'not this time' | null;
  note: string | null;
}

const HELD = { nailed: 'kept', mostly: 'mostly', struggled: 'not this time' } as const;

/** Every answered week, newest first: the trend, the plan and how it held,
 *  and the user's own line. Built from what the check-in already stores. */
export function journalWeeks(dailyLogs: Array<{ date: string; week_check?: any }>, weights: WeighIn[], limit = 12): JournalWeek[] {
  const weeks = (dailyLogs ?? []).filter((l) => l?.week_check?.effort).sort((a, b) => a.date.localeCompare(b.date));
  let prev: number | null = null;
  const out: JournalWeek[] = [];
  for (const l of weeks) {
    const sunday = Date.parse(`${l.date}T12:00:00`) + 6 * DAY_MS;
    const trendKg = weightVerdict(weights, sunday)?.trendKg ?? null;
    const c = l.week_check;
    out.push({
      weekStart: l.date, trendKg,
      deltaKg: trendKg != null && prev != null ? Math.round((trendKg - prev) * 10) / 10 : null,
      planText: c.planText ?? null,
      held: c.planText ? HELD[c.adherence as keyof typeof HELD] ?? null : null,
      note: c.note?.trim() || null,
    });
    if (trendKg != null) prev = trendKg;
  }
  return out.reverse().slice(0, limit);
}
