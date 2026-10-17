// Adaptive (learned) TDEE.
//
// The formula TDEE in `tdee.ts` (Mifflin-St Jeor x an activity guess) is only a
// STARTING estimate. Real maintenance varies a lot person-to-person and drifts
// during a cut — metabolic adaptation, an activity multiplier that's just a
// guess, and (for this user) GLP-1 appetite suppression all move the true
// number. Rather than trust the formula forever, we LEARN the real burn from
// the one identity that can't lie over time:
//
//   intake - TDEE = energy stored per day
//   energy stored per day ≈ weightChangeKgPerDay x 7700 kcal/kg
//   =>  TDEE ≈ meanDailyIntake - weightSlopeKgPerDay x 7700
//
// (weightSlopeKgPerDay is negative when losing, so it ADDS to intake — a person
//  eating 2000 and dropping 0.5 kg/wk is really burning ~2550.)
//
// This is only trustworthy when food logging is reasonably COMPLETE over the
// window (missing days bias intake low → TDEE low → a dangerous "eat even less"
// message). So we count only plausibly-logged days, gate on how many we have,
// and expose a confidence level the caller must respect. Pure + unit-tested.
//
// Confidence is the weight slope's own 95% interval, converted to kcal/day —
// not just a count of days. A ±1 kg scale over five weeks leaves the slope
// uncertain by ±0.4 kg/week, which is ±440 kcal/day of "learned burn": far too
// loose to steer a target with, however many days were logged. (Counting days
// alone once labelled four estimates between 1,736 and 2,732 kcal all "high".)

import { fitWeightLine, WINDOW_DAYS } from './insights.ts';

/** Standard energy density of body-mass change (~7700 kcal per kg). */
export const KCAL_PER_KG = 7700;

export interface AdaptiveTdeeInput {
  /** Per-day intake in kcal. Only pass days the user actually logged. */
  intake: Array<{ date: string; kcal: number }>;
  /** Body-weight measurements (kg). */
  weights: Array<{ date: string; weight: number }>;
  /** Trailing window to fit over, in days. Default: the trend window (35). */
  windowDays?: number;
  /** Below this a day is treated as "not really logged" and ignored. Default 800. */
  minLoggedKcal?: number;
  /** Reference date (ISO) the window ends at. Default: latest data point / today. */
  asOf?: string;
}

export type TdeeConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export interface AdaptiveTdee {
  /** Learned maintenance kcal/day. null when there isn't enough data. */
  tdee: number | null;
  confidence: TdeeConfidence;
  /** Number of plausibly-logged intake days used. */
  loggedDays: number;
  /** Mean of those logged days' intake. null if none. */
  meanIntake: number | null;
  /** Weight-trend slope over the window, kg/week (negative = losing). */
  weightRateKgPerWeek: number;
  /** Days the weight regression spanned. */
  weightSpanDays: number;
  /** ± kcal/day on tdee, from the weight slope's 95% interval. null without a line. */
  uncertaintyKcal: number | null;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** ± kcal/day of learned burn below which the estimate may steer a target. */
const HIGH_KCAL = 150;
const MEDIUM_KCAL = 300;

/**
 * Learn maintenance calories from logged intake + the weight trend over a
 * trailing window. Returns tdee=null (confidence 'insufficient') unless there's
 * enough complete-enough data to be trustworthy.
 */
export function adaptiveTdee(input: AdaptiveTdeeInput): AdaptiveTdee {
  const windowDays = input.windowDays ?? WINDOW_DAYS;
  const minKcal = input.minLoggedKcal ?? 800;

  const dates = [
    ...input.intake.map((i) => i.date),
    ...input.weights.map((w) => w.date),
  ].sort();
  const endMs = input.asOf
    ? new Date(`${input.asOf}T12:00:00`).getTime()
    : dates.length
      ? new Date(`${dates[dates.length - 1]}T12:00:00`).getTime()
      : Date.now();
  const cutoffMs = endMs - windowDays * 86400000;
  const inWindow = (d: string) => {
    const t = new Date(`${d}T12:00:00`).getTime();
    return t >= cutoffMs && t <= endMs;
  };

  // Only days with a plausible amount logged count — a blank or 200-kcal day is
  // missing data, not a genuine near-fast, and would drag the mean down.
  const logged = input.intake.filter((i) => inWindow(i.date) && i.kcal >= minKcal);
  const line = fitWeightLine(input.weights, endMs, windowDays);
  const slope = line?.slopePerDay ?? 0;
  const span = line?.spanDays ?? 0;

  const base: AdaptiveTdee = {
    tdee: null,
    confidence: 'insufficient',
    loggedDays: logged.length,
    meanIntake: logged.length ? Math.round(logged.reduce((s, i) => s + i.kcal, 0) / logged.length) : null,
    weightRateKgPerWeek: +(-slope * 7).toFixed(2),
    weightSpanDays: span,
    uncertaintyKcal: line && line.n > 2 ? Math.round(line.halfWidthPerDay * KCAL_PER_KG) : null,
  };

  // Need a real weight span AND enough logged intake days to trust the identity.
  if (!line || span < 14 || logged.length < 10 || base.meanIntake == null) return base;

  // Use the median logged intake (robust to the odd cheat/feast day) as the
  // steady-state intake, then apply the energy-balance identity.
  const medIntake = median(logged.map((i) => i.kcal));
  const tdee = Math.round(medIntake - slope * KCAL_PER_KG);

  // Sanity clamp — a wildly out-of-range value means the data (usually
  // incomplete logging) can't be trusted; downgrade rather than mislead.
  if (tdee < 1200 || tdee > 5500) {
    return { ...base, confidence: 'insufficient' };
  }

  const u = base.uncertaintyKcal ?? Infinity;
  let confidence: TdeeConfidence;
  if (logged.length >= 21 && span >= 21 && u <= HIGH_KCAL) confidence = 'high';
  else if (logged.length >= 14 && span >= 14 && u <= MEDIUM_KCAL) confidence = 'medium';
  else confidence = 'low';

  return { ...base, tdee, meanIntake: Math.round(medIntake), confidence };
}

/**
 * Daily intake to lose `kgPerWeek` at a known maintenance, floored so we never
 * recommend an unsafely low target even if the maths says so.
 */
export function targetIntakeForLoss(tdee: number, kgPerWeek: number, floorKcal = 1500): number {
  const dailyDeficit = (kgPerWeek * KCAL_PER_KG) / 7;
  return Math.max(floorKcal, Math.round(tdee - dailyDeficit));
}
