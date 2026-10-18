// Nutrition pattern insights.
//
// The food log already knows every meal's macros and the clock time it was
// logged. foodCoach.ts speaks to a single day; this steps back and finds the
// repeating PATTERNS across weeks that quietly decide adherence: how reliably
// protein lands and whether the weekend erases the weekday deficit. Each is
// something you can act on without any new tracking. When in the day the food
// lands is not judged here: a late meal is often the plan (rhythm.ts learns it).
//
// Pure — no Svelte/Dexie — unit-tested in selfcheck.js.

export interface FoodEntry {
  date: string;          // YMD
  kcal: number;
  protein_g: number;
}

export interface NutritionPatterns {
  daysLogged: number;
  avgKcal: number | null;
  avgProtein: number | null;
  proteinTarget: number;
  proteinDaysHit: number;
  proteinHitPct: number | null;      // % of logged days meeting protein target
  proteinCV: number | null;          // coefficient of variation of daily protein (lower = steadier)
  weekdayAvgKcal: number | null;
  weekendAvgKcal: number | null;
  weekendGapKcal: number | null;     // weekend − weekday
  insights: string[];                // prioritised, plain-language findings
}

function dow(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay(); // 0 Sun..6 Sat
}

export function nutritionPatterns(
  entries: FoodEntry[],
  proteinTarget: number,
  opts: { minDays?: number } = {},
): NutritionPatterns {
  const minDays = opts.minDays ?? 5;

  // Aggregate per day.
  const byDay = new Map<string, { kcal: number; protein: number }>();
  for (const e of entries) {
    const d = byDay.get(e.date) || { kcal: 0, protein: 0 };
    d.kcal += e.kcal || 0; d.protein += e.protein_g || 0;
    byDay.set(e.date, d);
  }

  const days = [...byDay.entries()];
  const daysLogged = days.length;
  const empty: NutritionPatterns = {
    daysLogged, avgKcal: null, avgProtein: null, proteinTarget,
    proteinDaysHit: 0, proteinHitPct: null, proteinCV: null,
    weekdayAvgKcal: null, weekendAvgKcal: null, weekendGapKcal: null, insights: [],
  };
  if (daysLogged < minDays) return empty;

  const kcals = days.map(([, v]) => v.kcal);
  const proteins = days.map(([, v]) => v.protein);
  const avgKcal = Math.round(kcals.reduce((a, b) => a + b, 0) / daysLogged);
  const avgProtein = Math.round(proteins.reduce((a, b) => a + b, 0) / daysLogged);

  const proteinDaysHit = proteins.filter((p) => proteinTarget > 0 && p >= proteinTarget).length;
  const proteinHitPct = proteinTarget > 0 ? Math.round((proteinDaysHit / daysLogged) * 100) : null;

  const pMean = avgProtein;
  const pSd = Math.sqrt(proteins.reduce((a, p) => a + (p - pMean) ** 2, 0) / daysLogged);
  const proteinCV = pMean > 0 ? Math.round((pSd / pMean) * 100) : null;

  let wdSum = 0, wdN = 0, weSum = 0, weN = 0;
  for (const [date, v] of days) {
    const g = dow(date);
    if (g === 0 || g === 6) { weSum += v.kcal; weN++; } else { wdSum += v.kcal; wdN++; }
  }
  const weekdayAvgKcal = wdN ? Math.round(wdSum / wdN) : null;
  const weekendAvgKcal = weN ? Math.round(weSum / weN) : null;
  const weekendGapKcal = (weekdayAvgKcal != null && weekendAvgKcal != null) ? weekendAvgKcal - weekdayAvgKcal : null;

  // Prioritised, actionable insights.
  const insights: string[] = [];
  if (proteinHitPct != null) {
    if (proteinHitPct < 50) insights.push(`Protein hit its target on only ${proteinHitPct}% of logged days (avg ${avgProtein} g vs ${proteinTarget} g). This is the biggest lever on keeping muscle.`);
    else if (proteinHitPct >= 80) insights.push(`Protein is dialled in — ${proteinHitPct}% of days on target. Keep it.`);
  }
  if (proteinCV != null && proteinCV >= 35) insights.push(`Protein is swingy day-to-day (±${proteinCV}%). Steadier daily protein beats big-then-nothing.`);
  if (weekendGapKcal != null && weN >= 2 && wdN >= 2 && weekendGapKcal >= 300) insights.push(`Weekends run ~${weekendGapKcal} kcal/day above weekdays — that can erase the week's deficit in two days.`);
  if (insights.length === 0) insights.push('No problem patterns jump out — intake looks consistent across the week.');

  return {
    daysLogged, avgKcal, avgProtein, proteinTarget,
    proteinDaysHit, proteinHitPct, proteinCV,
    weekdayAvgKcal, weekendAvgKcal, weekendGapKcal, insights,
  };
}
