// "Am I getting fitter?", answered as plainly as "am I losing weight?": the
// resting heart rate's trend (the same honest line as the weight's), lifts
// from the log, training days and steps. Each is said only when the data can
// carry it, and the answer rests on the heart and the lifts. Pure; see
// selfcheck.js.
import { fitWeightLine } from './insights.ts';
import type { StrengthTrend } from './strength.ts';
import { shiftYmd } from './date.ts';

export interface FitnessSign {
  key: 'heart' | 'strength' | 'training' | 'steps';
  /** true better, false worse, null steady. */
  good: boolean | null;
  text: string;
}

export interface Fitness {
  state: 'fitter' | 'holding' | 'mixed' | 'slipping' | 'not-enough';
  headline: string;
  signs: FitnessSign[];
}

export interface FitnessInput {
  today: string;
  restingHr: Array<{ date: string; bpm: number }>;
  /** Steps per day. */
  steps: Map<string, number>;
  trained: Set<string>;
  strength: StrengthTrend;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const halves = (n: number) => String(Math.round(n * 2) / 2);

/** The resting heart rate over the last 90 days: a fall the line is sure of
 *  is the clearest sign of a fitter heart. */
function heart(points: FitnessInput['restingHr'], today: string): FitnessSign | null {
  const asOf = Date.parse(`${today}T12:00:00`);
  // ponytail: the weight line's own fit, reused as-is: a linear trend with an
  // interval widened for day-to-day carry-over. It never sees a weight here.
  const line = fitWeightLine(points.filter((p) => p.bpm >= 30 && p.bpm <= 120).map((p) => ({ date: p.date, weight: p.bpm })), asOf, 90);
  if (!line || line.n < 21 || line.spanDays < 28) return null;
  const change = line.slopePerDay * line.spanDays;
  const sure = Math.abs(line.slopePerDay) > line.halfWidthPerDay;
  const from = Math.round(line.endKg - change), to = Math.round(line.endKg);
  const since = MONTHS[new Date(`${shiftYmd(-line.spanDays, new Date(asOf))}T12:00:00`).getMonth()];
  if (sure && change <= -1.5) return { key: 'heart', good: true, text: `Resting heart rate ${from} → ${to} bpm since ${since}: your heart does the same work with fewer beats.` };
  if (sure && change >= 1.5) return { key: 'heart', good: false, text: `Resting heart rate ${from} → ${to} bpm since ${since}. Short sleep, stress, an illness or a hard week of training can all do that.` };
  return { key: 'heart', good: null, text: `Resting heart rate steady, around ${to} bpm.` };
}

function strength(s: FitnessInput['strength']): FitnessSign | null {
  if (s.direction === 'insufficient') return null;
  const weeks = Math.round(s.windowDays / 7);
  const top = s.topMover ? ` (${s.topMover.name} ${s.topMover.pct > 0 ? '+' : ''}${s.topMover.pct}%)` : '';
  const pct = Math.abs(Math.round(s.avgPct));
  if (s.direction === 'up') return { key: 'strength', good: true, text: `Lifts up ${pct}% on the ${weeks} weeks before${top}.` };
  if (s.direction === 'down') return { key: 'strength', good: false, text: `Lifts down ${pct}% on the ${weeks} weeks before${top}.` };
  return { key: 'strength', good: null, text: 'Lifts holding: losing weight, that is the muscle staying.' };
}

/** Days trained a week, the last four weeks against the four before. */
function training(trained: Set<string>, today: string): FitnessSign | null {
  const base = new Date(`${today}T12:00:00`);
  const perWeek = (from: number, to: number) => {
    let n = 0;
    for (let k = from; k < to; k++) if (trained.has(shiftYmd(-k, base))) n++;
    return n / 4;
  };
  const recent = perWeek(0, 28), before = perWeek(28, 56);
  if (recent === 0 && before === 0) return null;
  if (recent >= before + 0.5) return { key: 'training', good: true, text: `Training ${halves(recent)} days a week, up from ${halves(before)}.` };
  if (recent <= before - 1) return { key: 'training', good: false, text: `Training ${halves(recent)} days a week, down from ${halves(before)}.` };
  return { key: 'training', good: null, text: `Training ${halves(recent)} days a week, as before.` };
}

/** Steps a day, the last four weeks against the four before; today, half
 *  walked, isn't counted. */
function steps(perDay: Map<string, number>, today: string): FitnessSign | null {
  const base = new Date(`${today}T12:00:00`);
  const avg = (from: number, to: number) => {
    const xs: number[] = [];
    for (let k = from; k < to; k++) {
      const v = perDay.get(shiftYmd(-k, base));
      if (v != null && v > 0) xs.push(v);
    }
    return xs.length >= 20 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const recent = avg(1, 29), before = avg(29, 57);
  if (recent == null) return null;
  const r = thousands(Math.round(recent / 100) * 100);
  if (before == null) return { key: 'steps', good: null, text: `${r} steps a day.` };
  const b = thousands(Math.round(before / 100) * 100);
  if (recent >= before * 1.1) return { key: 'steps', good: true, text: `${r} steps a day, up from ${b}.` };
  if (recent <= before * 0.9) return { key: 'steps', good: false, text: `${r} steps a day, down from ${b}.` };
  return { key: 'steps', good: null, text: `${r} steps a day, as before.` };
}

export function fitness(i: FitnessInput): Fitness {
  const signs = [heart(i.restingHr, i.today), strength(i.strength), training(i.trained, i.today), steps(i.steps, i.today)]
    .filter((s): s is FitnessSign => s != null);
  // The answer rests on the heart and the lifts; training and steps are what
  // feeds them, shown beside it.
  const core = signs.filter((s) => s.key === 'heart' || s.key === 'strength');
  const up = core.some((s) => s.good === true), down = core.some((s) => s.good === false);
  const state: Fitness['state'] = !core.length ? 'not-enough' : up && down ? 'mixed' : up ? 'fitter' : down ? 'slipping' : 'holding';
  const headline = {
    fitter: 'Yes, you’re getting fitter.',
    holding: 'Holding steady.',
    mixed: 'Mixed: one sign up, one down.',
    slipping: 'A step back lately.',
    'not-enough': 'Not enough yet to say.',
  }[state];
  return { state, headline, signs };
}
