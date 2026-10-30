// Period-aware weight, if the person turns it on.
//
// In the days around a period many people hold water, and the scale reads
// higher for reasons that have nothing to do with fat. How much varies a lot
// between people (studies find around half a kilo on average, small and
// mixed), so a general rule would be wrong for most. Slim Chance learns the
// person's own swing instead: from the first days of their periods (one tap on
// Today) and their mornings against the trend, over three or more cycles. Until
// then it says only that it's learning. Nothing is inferred and nothing else
// reads it. Pure; see selfcheck.js.

import { dwt } from './units.ts';

export interface CycleInfo {
  /** Completed cycles the pattern is learned from (18–45 days long). */
  cycles: number;
  /** Their usual cycle length, days; null before one completes. */
  lengthDays: number | null;
  /** The next start expected from that length; null without one. */
  nextStart: string | null;
  /** Mornings in the five days before a period and its first two, against
   *  their other mornings, kg; null until three cycles are in. */
  swingKg: number | null;
}

const DAY = 86400000;
const noon = (ymd: string) => Date.parse(`${ymd}T12:00:00`);
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
/** The window a period moves the scale: five days before it, and its first two. */
const inWindow = (daysToStart: number) => daysToStart >= -1 && daysToStart <= 5;

/**
 * `residuals` are mornings against the trend that day (reading − trend, kg),
 * from stores/body. `starts` are the first days of periods, any order.
 */
export function cycleInfo(starts: string[], residuals: Array<{ date: string; kg: number }>, today: string): CycleInfo {
  const s = [...new Set(starts)].filter((d) => d <= today).sort();
  const lengths: number[] = [];
  for (let k = 1; k < s.length; k++) {
    const n = Math.round((noon(s[k]) - noon(s[k - 1])) / DAY);
    if (n >= 18 && n <= 45) lengths.push(n);
  }
  const lengthDays = lengths.length ? Math.round(median(lengths)) : null;
  const nextStart = lengthDays && s.length ? ymd(noon(s[s.length - 1]) + lengthDays * DAY) : null;

  let swingKg: number | null = null;
  if (lengths.length >= 3) {
    // Each morning, measured to the start it belongs to: the next one, or the
    // one it follows by a day (the period's second day).
    const near: number[] = [], far: number[] = [];
    for (const r of residuals) {
      if (r.date < s[0]) continue;
      const t = noon(r.date);
      const next = s.find((x) => noon(x) >= t - DAY);
      if (!next) continue;
      const toStart = Math.round((noon(next) - t) / DAY);
      if (toStart > 45) continue;
      (inWindow(toStart) ? near : far).push(r.kg);
    }
    if (near.length >= 8 && far.length >= 15) swingKg = Math.round((mean(near) - mean(far)) * 10) / 10;
  }
  return { cycles: lengths.length, lengthDays, nextStart, swingKg };
}

/** What a high morning in the window can honestly say about it; null outside it. */
export function cycleNote(i: CycleInfo, starts: string[], today: string): string | null {
  const last = [...starts].filter((d) => d <= today).sort().at(-1) ?? null;
  const sinceLast = last ? Math.round((noon(today) - noon(last)) / DAY) : null;
  const toNext = i.nextStart ? Math.round((noon(i.nextStart) - noon(today)) / DAY) : null;
  const near = (sinceLast != null && sinceLast >= 0 && sinceLast <= 1) || (toNext != null && toNext >= 0 && toNext <= 5);
  if (!near) return null;
  if (i.swingKg != null && i.swingKg >= 0.3) {
    return `Around your period your mornings usually read ${dwt(i.swingKg)} above your trend; this looks like that.`;
  }
  if (i.swingKg != null) return null; // learned, and it barely moves them: say nothing
  return 'Around a period many people hold some water. After three cycles Slim Chance will know how much you do.';
}
