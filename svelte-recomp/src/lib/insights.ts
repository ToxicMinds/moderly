/**
 * Insights that are allowed to say "I don't know yet".
 *
 * THE THESIS: weigh-in density is the binding constraint on every claim this
 * app wants to make. Body weight swings ±1-2 kg a day on water and gut content
 * alone, so with a handful of readings the scatter is larger than the signal —
 * and a verdict computed on top of that is a guess in a confident font.
 *
 * So the flagship insight states what is known, attaches the error bar, and
 * names the DATE it will know more. That earns more trust than a confident
 * verdict, and it manufactures the exact behaviour (weighing most mornings)
 * that unlocks every other insight downstream.
 *
 * Every function here returns `null` when its data gate is not met. Silence is
 * a valid, deliberate output: an insight that fires on three data points is
 * worse than no insight, because it teaches the user to distrust the ones that
 * are real.
 *
 * Pure — no Svelte, no Dexie, no Supabase — so it is all unit-tested in
 * selfcheck.js.
 */

export interface WeighIn {
  date: string; // YMD
  weight: number; // kg
}

/**
 * Two-sided 95% t quantiles by degrees of freedom.
 *
 * A lookup beats pulling in a stats library for one number, and beats the
 * normal approximation outright: at n=8 (df=6) the true multiplier is 2.45,
 * not 1.96 — using 1.96 would understate the error bar by 25% at exactly the
 * sample size where honesty matters most.
 */
const T95: Record<number, number> = {
  1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
  15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
  25: 2.060, 30: 2.042, 40: 2.021, 60: 2.000, 120: 1.980,
};

export function tCritical(df: number): number {
  if (df < 1) return T95[1];
  if (T95[df] != null) return T95[df];
  // Between tabulated points, take the next LOWER df — i.e. the wider, more
  // conservative interval. Erring toward "we're less sure" is the right
  // direction for a claim about someone's body.
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  let best = 1.96;
  for (const k of keys) {
    if (k <= df) best = T95[k];
    else break;
  }
  return best;
}

/** Minimum weigh-ins before the residual scatter itself is meaningful. */
const MIN_WEIGHINS = 7;
/** Trailing window. Longer than this and a real change of pace gets averaged away. */
export const WINDOW_DAYS = 35;
/** Below this the rate is indistinguishable from maintaining, in practice. */
const RATE_FLOOR_KG_WK = 0.15;
/** Never promise an answer further out than this — past it, "log more" is the honest advice. */
const MAX_FORECAST_DAYS = 60;

export type TrendState = 'not-enough' | 'too-noisy' | 'answerable';

export interface WeightVerdict {
  state: TrendState;
  /** kg/week. POSITIVE = losing, to match the rest of the app. */
  rateKgPerWeek: number;
  /** Half-width of the 95% interval on the rate, kg/week. */
  halfWidthKgPerWeek: number;
  /** The interval itself, in the same positive-is-losing convention. */
  loKgPerWeek: number;
  hiKgPerWeek: number;
  /** Residual scatter around the fitted line, kg. This is "how noisy is my scale". */
  scatterKg: number;
  /** Weigh-ins used. */
  n: number;
  /** Days spanned by those weigh-ins. */
  spanDays: number;
  /** Only when state is 'too-noisy': roughly how many more daily weigh-ins are needed. */
  weighInsNeeded: number | null;
  /** Only when state is 'too-noisy': days away, assuming near-daily weighing. */
  daysUntilAnswer: number | null;
  /** Where the fitted line says you are at the last weigh-in — the number to
   *  show instead of one morning's reading. null until there is a line. */
  trendKg: number | null;
  /** The most recent reading, any age. */
  latestKg: number | null;
}

/**
 * The ONE least-squares line through weigh-ins: the trend, the learned burn
 * and every verdict read their slope from here, so no two screens can fit the
 * same scale readings differently. null when no slope is defined.
 */
export interface WeightLine {
  n: number;
  /** kg/day; negative = losing. */
  slopePerDay: number;
  /** Half-width of the 95% interval on the slope, kg/day (0 when df < 1). */
  halfWidthPerDay: number;
  /** Residual scatter around the line, kg. */
  scatterKg: number;
  /** The line's value at the last weigh-in. */
  endKg: number;
  spanDays: number;
}

function inWindow(points: WeighIn[], asOfMs: number, windowDays: number) {
  const cutoff = asOfMs - windowDays * 86400000;
  return (points ?? [])
    .filter((p) => p && p.date && isFinite(p.weight) && p.weight > 0)
    .map((p) => ({ t: new Date(`${p.date}T12:00:00`).getTime(), w: p.weight }))
    .filter((p) => isFinite(p.t) && p.t >= cutoff && p.t <= asOfMs + 86400000)
    .sort((a, b) => a.t - b.t);
}

export function fitWeightLine(points: WeighIn[], asOfMs: number, windowDays = WINDOW_DAYS): WeightLine | null {
  const rows = inWindow(points, asOfMs, windowDays);
  const n = rows.length;
  if (n < 2) return null;
  const x = rows.map((r) => (r.t - rows[0].t) / 86400000);
  const y = rows.map((r) => r.w);
  const xbar = x.reduce((a, b) => a + b, 0) / n;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - xbar) ** 2;
    sxy += (x[i] - xbar) * (y[i] - ybar);
  }
  // Everything logged on one day: no slope is defined, and pretending otherwise
  // would divide by zero.
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  const resid = y.map((v, i) => v - (intercept + slope * x[i]));
  const sse = resid.reduce((a, r) => a + r * r, 0);
  const df = n - 2;
  const scatter = df > 0 ? Math.sqrt(sse / df) : 0;
  // A heavy morning tends to follow a heavy morning (water and gut content
  // carry over), so daily readings are not independent and the textbook error
  // bar is too narrow. Widen it by the residuals' own lag-1 autocorrelation:
  // with ρ = 0.4 the honest interval is 1.5× the naive one.
  let lag = 0;
  for (let i = 0; i < n - 1; i++) lag += resid[i] * resid[i + 1];
  const rho = sse > 0 ? Math.min(0.9, Math.max(0, lag / sse)) : 0;
  const seSlope = df > 0 ? (scatter / Math.sqrt(sxx)) * Math.sqrt((1 + rho) / (1 - rho)) : 0;
  return {
    n, slopePerDay: slope, halfWidthPerDay: tCritical(df) * seSlope, scatterKg: scatter,
    endKg: intercept + slope * x[n - 1], spanDays: Math.round(x[n - 1]),
  };
}

/**
 * Fit weight against time and report the rate WITH its uncertainty.
 *
 * A slope alone is not a verdict; this also says whether that slope is
 * distinguishable from zero. Those are very different claims, and the app
 * once made the first while implying the second.
 */
export function weightVerdict(points: WeighIn[], asOfMs?: number): WeightVerdict | null {
  if (!Array.isArray(points) || points.length === 0) return null;

  const now = asOfMs ?? Date.now();
  const valid = points.filter((p) => p && p.date && isFinite(p.weight) && p.weight > 0 && new Date(`${p.date}T12:00:00`).getTime() <= now + 86400000).sort((a, b) => a.date.localeCompare(b.date));
  const latestKg = valid.length ? valid[valid.length - 1].weight : null;
  const n = inWindow(points, now, WINDOW_DAYS).length;
  const line = n >= MIN_WEIGHINS ? fitWeightLine(points, now) : null;
  if (!line) {
    return {
      state: 'not-enough', rateKgPerWeek: 0, halfWidthKgPerWeek: 0,
      loKgPerWeek: 0, hiKgPerWeek: 0, scatterKg: 0, n,
      spanDays: n > 1 ? fitWeightLine(points, now)?.spanDays ?? 0 : 0,
      weighInsNeeded: Math.max(1, MIN_WEIGHINS - n), daysUntilAnswer: Math.max(1, MIN_WEIGHINS - n),
      trendKg: null, latestKg,
    };
  }

  const rate = -line.slopePerDay * 7;          // positive = losing
  const halfWidth = line.halfWidthPerDay * 7;  // kg/week
  const scatter = line.scatterKg;
  const base = {
    rateKgPerWeek: rate, halfWidthKgPerWeek: halfWidth,
    loKgPerWeek: rate - halfWidth, hiKgPerWeek: rate + halfWidth,
    scatterKg: scatter, n, spanDays: line.spanDays,
    trendKg: +line.endKg.toFixed(1), latestKg,
  };

  // The interval excludes zero => the direction is real, not scale noise.
  if (halfWidth < Math.abs(rate)) {
    return { state: 'answerable', ...base, weighInsNeeded: null, daysUntilAnswer: null };
  }

  // Too noisy to call. Work out how many near-daily weigh-ins WOULD settle it.
  // For evenly spaced points, Σ(x-x̄)² = n(n²−1)/12, so the half-width shrinks
  // predictably with n and we can solve for the smallest n that clears the bar.
  const target = Math.max(Math.abs(rate), RATE_FLOOR_KG_WK);
  let needed: number | null = null;
  for (let k = n + 1; k <= n + MAX_FORECAST_DAYS; k++) {
    const sxxK = (k * (k * k - 1)) / 12;
    const hw = tCritical(k - 2) * (scatter / Math.sqrt(sxxK)) * 7;
    if (hw < target) { needed = k; break; }
  }

  return {
    state: 'too-noisy', ...base,
    weighInsNeeded: needed ? needed - n : null,
    daysUntilAnswer: needed ? Math.min(MAX_FORECAST_DAYS, needed - n) : null,
  };
}

/**
 * Pace against the PLAN, not against zero — the question a cut actually asks.
 *
 * "Too noisy to tell if you're losing" and "you are not losing at the pace you
 * planned" are different claims, and the second is often already certain: a
 * flat month with a ±1 kg scale can't prove a small loss, but it can rule out
 * 0.6 kg a week. Each answer below is only given when the 95% interval
 * supports it; everything else is 'too-early'.
 *
 *   gaining  — the whole interval is weight going UP
 *   stalled  — ruled out the plan's pace, and the best estimate is ~flat
 *   slower   — ruled out the plan's pace, but genuinely losing
 *   faster   — losing well over 1.5× the plan (muscle is at risk)
 *   on-pace  — confirmed losing, and the plan's pace is still in the interval
 */
export type Pace = 'too-early' | 'gaining' | 'stalled' | 'slower' | 'on-pace' | 'faster';

export function paceVsPlan(v: WeightVerdict | null, planKgPerWeek: number | null): Pace {
  if (!v || v.state === 'not-enough') return 'too-early';
  if (v.hiKgPerWeek < 0) return 'gaining';
  if (planKgPerWeek == null || planKgPerWeek <= 0) return 'too-early';
  if (v.hiKgPerWeek < planKgPerWeek) {
    return v.loKgPerWeek <= 0 || v.rateKgPerWeek < RATE_FLOOR_KG_WK ? 'stalled' : 'slower';
  }
  if (v.loKgPerWeek > planKgPerWeek * 1.5) return 'faster';
  if (v.loKgPerWeek > 0) return 'on-pace';
  return 'too-early';
}

// ---------------------------------------------------------------------------
// Protein on training days vs rest days
// ---------------------------------------------------------------------------

export interface ProteinByDayResult {
  liftDays: number;
  restDays: number;
  liftAvgG: number;
  restAvgG: number;
  /** restAvg − liftAvg. Positive means protein DROPS on training days. */
  gapG: number;
  /** target − liftAvg, i.e. how far short training days fall. */
  shortOfTargetG: number;
}

/** Days below this are abandoned logging, not a real intake — same gate adaptiveTdee uses. */
const MIN_LOGGED_KCAL = 800;

/**
 * Do they under-eat protein on the days their body is actually repairing?
 *
 * Deliberately keyed on hand-logged workout dates rather than watch sessions:
 * the lift log has months of history where activity_sessions has days. An
 * insight is only as old as its thinnest input.
 */
export function proteinByTrainingDay(
  foodByDate: Map<string, { protein: number; kcal: number }>,
  liftDates: Set<string>,
  proteinTargetG: number,
  opts: { minDaysEachSide?: number; minGapG?: number; minShortG?: number } = {}
): ProteinByDayResult | null {
  const minDays = opts.minDaysEachSide ?? 5;
  const minGap = opts.minGapG ?? 15;
  const minShort = opts.minShortG ?? 20;

  const lift: number[] = [];
  const rest: number[] = [];
  for (const [date, v] of foodByDate) {
    if (!v || v.kcal < MIN_LOGGED_KCAL) continue;
    (liftDates.has(date) ? lift : rest).push(v.protein);
  }
  if (lift.length < minDays || rest.length < minDays) return null;

  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const liftAvg = mean(lift);
  const restAvg = mean(rest);
  const gap = restAvg - liftAvg;
  const short = proteinTargetG - liftAvg;

  // Only worth saying if it is both a real gap AND actually costing them.
  if (gap < minGap || short < minShort) return null;

  return {
    liftDays: lift.length, restDays: rest.length,
    liftAvgG: Math.round(liftAvg), restAvgG: Math.round(restAvg),
    gapG: Math.round(gap), shortOfTargetG: Math.round(short),
  };
}

// ---------------------------------------------------------------------------
// Does the watch corroborate the training the verdict rests on?
// ---------------------------------------------------------------------------

export interface WatchAgreement {
  handLoggedDays: number;
  confirmedDays: number;
  /** Days the watch saw a strength session that was never hand-logged. */
  unloggedByHand: number;
}

/**
 * Cross-check hand-logged lifting against what the watch independently saw.
 *
 * This is the one claim in the app that two instruments can corroborate, which
 * is exactly what makes it worth showing. Deliberately type-agnostic on the
 * watch side: watches routinely label lifting as a generic workout, and
 * demanding an exact type match would manufacture disagreement.
 *
 * The copy built on this must never imply the user skipped training — an
 * unconfirmed day is overwhelmingly a watch on a charger.
 */
export function watchAgreement(
  handLoggedDates: Set<string>,
  watchSessions: { date: string; duration_min: number; kind?: string }[],
  opts: { minDurationMin?: number; minHandDays?: number } = {}
): WatchAgreement | null {
  const minDur = opts.minDurationMin ?? 20;
  const minHand = opts.minHandDays ?? 3;

  if (!watchSessions.length) return null;      // no instrument, not a failure
  if (handLoggedDates.size < minHand) return null;

  const watchDates = new Set(
    watchSessions.filter((s) => (s.duration_min ?? 0) >= minDur).map((s) => s.date)
  );
  let confirmed = 0;
  for (const d of handLoggedDates) if (watchDates.has(d)) confirmed++;

  let unlogged = 0;
  for (const s of watchSessions) {
    if (s.kind === 'strength' && !handLoggedDates.has(s.date)) unlogged++;
  }

  return {
    handLoggedDays: handLoggedDates.size,
    confirmedDays: confirmed,
    unloggedByHand: unlogged,
  };
}

// ---------------------------------------------------------------------------
// What the heaviest sessions cost the next morning
// ---------------------------------------------------------------------------

export interface RecoveryCost {
  pairs: number;
  heavyRhr: number;
  lightRhr: number;
  deltaBpm: number;
  heavyTonnageKg: number;
  lightTonnageKg: number;
}

/**
 * Split training days at their median tonnage and compare next-morning resting
 * HR. Rides biometrics (the densest table the app owns) against the lift log.
 *
 * Never phrased as proof of causation in the UI: alcohol, illness and a warm
 * room all move resting HR and the app cannot see any of them.
 */
export function recoveryCost(
  tonnageByDate: Map<string, number>,
  rhrByDate: Map<string, { rhr: number; sleptHours: number | null }>,
  nextDay: (ymd: string) => string,
  opts: { minPairs?: number; minPerBucket?: number; minDeltaBpm?: number } = {}
): RecoveryCost | null {
  const minPairs = opts.minPairs ?? 8;
  const minPerBucket = opts.minPerBucket ?? 4;
  const minDelta = opts.minDeltaBpm ?? 3;

  const pairs: { ton: number; rhr: number }[] = [];
  for (const [date, ton] of tonnageByDate) {
    if (!(ton > 0)) continue;
    const nxt = rhrByDate.get(nextDay(date));
    // Requiring sleep too is how we know the watch was actually WORN overnight;
    // a resting HR with no sleep beside it is usually a stray daytime reading.
    if (!nxt || nxt.rhr == null || nxt.sleptHours == null) continue;
    pairs.push({ ton, rhr: nxt.rhr });
  }
  if (pairs.length < minPairs) return null;

  const sorted = [...pairs].sort((a, b) => a.ton - b.ton);
  const mid = Math.floor(sorted.length / 2);
  const light = sorted.slice(0, mid);
  const heavy = sorted.slice(sorted.length % 2 === 1 ? mid + 1 : mid);
  if (light.length < minPerBucket || heavy.length < minPerBucket) return null;

  const mean = (a: { rhr: number }[]) => a.reduce((s, x) => s + x.rhr, 0) / a.length;
  const meanTon = (a: { ton: number }[]) => a.reduce((s, x) => s + x.ton, 0) / a.length;
  const hR = mean(heavy), lR = mean(light);
  const delta = hR - lR;

  // The buckets must actually differ in load, or this is measuring nothing.
  const hT = meanTon(heavy), lT = meanTon(light);
  if (lT <= 0 || (hT - lT) / lT < 0.2) return null;
  if (delta < minDelta) return null;

  return {
    pairs: pairs.length,
    heavyRhr: Math.round(hR), lightRhr: Math.round(lR),
    deltaBpm: Math.round(delta),
    heavyTonnageKg: Math.round(hT), lightTonnageKg: Math.round(lT),
  };
}

// ---------------------------------------------------------------------------
// Why the scale isn't moving
// ---------------------------------------------------------------------------

export interface StallClue { id: 'cooking-fat' | 'same-portion' | 'thin-days'; title: string; detail: string }

export interface StallDiagnosis {
  /** Median logged kcal on the days that count (≥ 800 kcal), over the trend window. */
  medianKcal: number;
  loggedDays: number;
  /** The least this body burns just living (resting × 1.2), when known. */
  floorKcal: number | null;
  /** floor − median, when the log sits below the floor: a LOWER bound on what's missing. */
  missingAtLeastKcal: number | null;
  clues: StallClue[];
}

const COOKED = /masala|curry|tikka|dal\b|daal|sambar|korma|biryani|stir[- ]?fr|fried|omelet|omelette|vajíčk|praženic|curr|gul[aá]š|soté|saut|roast|pečen|vyprážan|smažen|risotto|pasta|stew/i;
const COOKING_FAT = /\boil\b|olej|ghee|butter|maslo|máslo|masło|lard|bravčová mast|sádlo/i;

/**
 * Only when the trend has ruled out the plan (stalled or gaining): set what the
 * log says against what a body this size burns, and point at where food most
 * often goes missing — from this person's own entries.
 *
 * It never says "you under-log". An over-generous FORMULA and missing food look
 * identical, so the comparison is against the floor — resting metabolism plus
 * bare daily living — not the activity estimate; a log that holds weight below
 * that floor has its likeliest explanation in food that never reached it. The
 * clues are checkable facts about the entries, not accusations.
 */
export function diagnoseStall(input: {
  pace: string;
  intake: Map<string, { kcal: number; items: number }>;
  foods: Array<{ date: string; name?: string | null; kcal?: number | null }>;
  floorKcal: number | null;
  today: string;
  windowDays?: number;
}): StallDiagnosis | null {
  if (input.pace !== 'stalled' && input.pace !== 'gaining') return null;
  const dayMs = 86400000;
  const end = new Date(`${input.today}T12:00:00`).getTime();
  const since = (days: number) => (d: string) => {
    const t = new Date(`${d}T12:00:00`).getTime();
    return t <= end && t > end - days * dayMs;
  };
  const inTrend = since(input.windowDays ?? WINDOW_DAYS);
  const days = [...input.intake].filter(([d, v]) => inTrend(d) && v.kcal >= 800).map(([, v]) => v);
  if (days.length < 10) return null;
  const sorted = days.map((d) => d.kcal).sort((a, b) => a - b);
  const median = Math.round(sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

  const clues: StallClue[] = [];
  const recent = input.foods.filter((f) => f?.date && since(60)(f.date));

  // 1. Cooking fat: days with a cooked dish and no oil, ghee or butter logged
  //    that same day.
  const cookedDays = new Set(recent.filter((f) => COOKED.test(f.name ?? '')).map((f) => f.date));
  const fatDays = new Set(recent.filter((f) => COOKING_FAT.test(f.name ?? '')).map((f) => f.date));
  const dry = [...cookedDays].filter((d) => !fatDays.has(d)).length;
  if (dry >= 7 && dry >= cookedDays.size * 0.7) {
    clues.push({
      id: 'cooking-fat', title: 'Is the cooking fat in the log?',
      detail: `${dry} of ${cookedDays.size} days with a cooked dish have no oil, ghee or butter logged that day. A tablespoon is about 120 kcal and a curry often takes two to four — unless the dish entries already include it.`,
    });
  }

  // 2. One portion logged the same way again and again — the biggest such
  //    lever (times × kcal), skipping anything already measured ("250 g").
  const MEASURED = /\d\s*(g|kg|ml|l|scoops?|ks|pcs)\b/i;
  const reps = new Map<string, { n: number; name: string; kcal: number }>();
  for (const f of recent) {
    const k = Math.round(+(f.kcal ?? 0));
    if (!f.name || k < 100 || MEASURED.test(f.name)) continue;
    const key = `${f.name.toLowerCase().replace(/\(.*?\)/g, '').trim()}|${k}`;
    const r = reps.get(key) ?? { n: 0, name: f.name.replace(/\s*\(.*?\)\s*/g, ' ').trim(), kcal: k };
    r.n++; reps.set(key, r);
  }
  const top = [...reps.values()].filter((r) => r.n >= 8).sort((a, b) => b.n * b.kcal - a.n * a.kcal)[0];
  if (top) {
    clues.push({
      id: 'same-portion', title: 'Is that portion right?',
      detail: `${top.name} is logged ${top.n} times at exactly ${top.kcal} kcal. Weigh it once: if the real portion is bigger, every one of those entries came up short.`,
    });
  }

  // 3. Days that are only half there.
  const thin = [...input.intake].filter(([d, v]) => inTrend(d) && v.items > 0 && v.items <= 2 && v.kcal < median * 0.6).length;
  if (thin >= 3) {
    clues.push({
      id: 'thin-days', title: 'Half-logged days?',
      detail: `${thin} days in the last five weeks have only one or two entries. A day that's half logged reads as a day you ate half.`,
    });
  }

  const missing = input.floorKcal != null && median < input.floorKcal ? input.floorKcal - median : null;
  return { medianKcal: median, loggedDays: days.length, floorKcal: input.floorKcal, missingAtLeastKcal: missing, clues };
}

