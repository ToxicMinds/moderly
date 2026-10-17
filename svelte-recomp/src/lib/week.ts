// The week as the unit of eating: one budget, Monday to Sunday.
//
// A daily target turns one big meal into a lost day, and a lost day is how one
// big meal becomes a big weekend — "the diet's broken anyway". A weekly budget
// makes the same meal a cost: a big Saturday leaves less for Sunday, it doesn't
// break anything. Pure; see selfcheck.js.

import { mondayOf } from './date.ts';

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
