// When this person eats, learned from their own log instead of assumed.
//
// A 14:00 "nothing logged yet" nudge, an "after 8pm" warning and "protein at
// breakfast" advice all assumed three meals from the morning. Someone who fasts
// until mid-afternoon and eats late by design was told off every day for
// keeping their own plan. Anything that judges a day by the hour
// asks this instead: on a usual day, how much is in by now?
//
// Pure, unit-tested in selfcheck.js. Times are the device's clock, from each
// entry's created_at. A day logged after the fact (a created_at on another day)
// says nothing about when its meals happened, so it is left out whole.
import { shiftYmd, ymd } from './date.ts';

export interface FoodTime { date: string; created_at?: string | null; protein_g?: number | string | null }

export interface Rhythm {
  /** Days it was learned from. */
  days: number;
  /** The usual first and last entry, minutes from midnight (medians). */
  first: number;
  last: number;
  /** Protein usually in by this minute of the day, in g (median of the days). */
  proteinBy: (minute: number) => number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The last `lookback` days before `today`; null until `minDays` of them were
 *  logged as they happened (a week, so one odd day can't set the rhythm). */
export function eatingRhythm(rows: FoodTime[], today: string, lookback = 28, minDays = 7): Rhythm | null {
  const from = shiftYmd(-lookback, new Date(`${today}T12:00:00`));
  // null marks a day logged after the fact.
  const byDay = new Map<string, Array<{ min: number; p: number }> | null>();
  for (const r of rows) {
    if (r.date >= today || r.date < from || byDay.get(r.date) === null) continue;
    const t = r.created_at ? new Date(r.created_at) : null;
    if (!t || Number.isNaN(t.getTime()) || ymd(t) !== r.date) {
      byDay.set(r.date, null);
      continue;
    }
    const day = byDay.get(r.date) ?? [];
    day.push({ min: t.getHours() * 60 + t.getMinutes(), p: Number(r.protein_g) || 0 });
    byDay.set(r.date, day);
  }
  const days = [...byDay.values()].filter((d) => d != null);
  if (days.length < minDays) return null;
  return {
    days: days.length,
    first: median(days.map((d) => Math.min(...d.map((e) => e.min)))),
    last: median(days.map((d) => Math.max(...d.map((e) => e.min)))),
    proteinBy: (minute) => median(days.map((d) => d.reduce((a, e) => a + (e.min <= minute ? e.p : 0), 0))),
  };
}
