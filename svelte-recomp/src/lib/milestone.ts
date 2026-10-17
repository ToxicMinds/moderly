// NEXT STOP — the near goal on the way to the far one.
//
// A goal 17 kg away is a year off and too far to steer by on a Friday night; a
// stop 8 kg away is a season. Near goals are the ones people act on: proximal
// subgoals raise effort and self-efficacy more than a distant goal alone
// (Bandura & Schunk 1981). And a stop can mean something by itself — where the
// "obese" BMI band ends for this height — which the app can say, because it
// knows the height.
//
// Below you, unlike the ceiling (line.ts), which sits above you. Pure; see
// selfcheck.js.

export interface MilestoneSetting { kg: number; set: string }

export interface MilestoneState {
  kg: number;
  /** Trend minus the stop, kg; null without a trend. */
  toGoKg: number | null;
  reached: boolean;
  /** BMI at the stop, for this height. */
  bmi: number | null;
  /** What the stop means, when it means something. */
  meaning: string | null;
}

const BANDS: Array<{ bmi: number; name: string }> = [
  { bmi: 30, name: 'obese' },
  { bmi: 25, name: 'overweight' },
];

export function bmiAt(kg: number, heightCm: number): number {
  return kg / (heightCm / 100) ** 2;
}

/** The heaviest weight, to 0.1 kg, still under a BMI line at this height. */
export function weightUnderBmi(bmi: number, heightCm: number): number {
  return Math.ceil(bmi * (heightCm / 100) ** 2 * 10 - 1) / 10;
}

export function milestoneState(s: MilestoneSetting | null | undefined, trendKg: number | null, heightCm: number | null): MilestoneState | null {
  if (!s || !(s.kg > 0)) return null;
  const toGoKg = trendKg != null ? Math.round((trendKg - s.kg) * 10) / 10 : null;
  let meaning: string | null = null;
  if (heightCm && heightCm > 0) {
    for (const b of BANDS) {
      const under = weightUnderBmi(b.bmi, heightCm);
      if (s.kg <= under && (trendKg == null || trendKg > under)) { meaning = `out of the “${b.name}” BMI range`; break; }
      if (s.kg > under && s.kg - under <= 1) { meaning = `the “${b.name}” BMI range ends at ${under.toFixed(1)} kg`; break; }
    }
  }
  return {
    kg: s.kg, toGoKg, reached: toGoKg != null && toGoKg <= 0,
    bmi: heightCm ? Math.round(bmiAt(s.kg, heightCm) * 10) / 10 : null,
    meaning,
  };
}

/** Stops worth offering from here: the next round five, the BMI lines still
 *  ahead, and the goal itself. */
export function suggestStops(trendKg: number, heightCm: number | null, goalKg: number | null): number[] {
  const out = new Set<number>();
  const five = Math.floor((trendKg - 0.5) / 5) * 5;
  if (five > 0 && five < trendKg) out.add(five);
  if (heightCm) for (const b of BANDS) { const u = weightUnderBmi(b.bmi, heightCm); if (u < trendKg) out.add(u); }
  if (goalKg && goalKg < trendKg) out.add(goalKg);
  return [...out].sort((a, b) => b - a).slice(0, 4);
}
