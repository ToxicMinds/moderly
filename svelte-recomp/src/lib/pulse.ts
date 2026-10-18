// The Today hero: the weight trend, and how far it is to the next stop.
//
// It used to be a 0–100 "recomp score" (fat loss, strength, protein and
// recovery, weighted) that its one daily user never read. While that score
// couldn't be worked out, the hero fell back to a new account's checklist, so
// someone months in saw a grey "4 / 4 first-week steps" and asked what it
// meant. The trend is the number the scale, the food and the training all
// answer to, and the next stop is the one near enough to watch move.
//
// Pure, unit-tested in selfcheck.js. stores/body.ts derives it once
// (`pulse`), for the hero and the page's glow alike, so they can't disagree.
import { goalDirection } from './coach.ts';
import type { Pace, WeightVerdict } from './insights.ts';
import type { MilestoneState } from './milestone.ts';
import { changeWord, dwt, dwtNum, unitWord, weightUnit, wt, wtShort } from './units.ts';

/** Never 'bad': a bad week is amber. "Blown" is the thought that makes it so. */
export type PulseTone = 'good' | 'ok' | 'warn' | 'na';

export interface PulseInput {
  weight: WeightVerdict | null;
  pace: Pace;
  firstKg: number | null;
  goalKg: number | null;
  next: MilestoneState | null;
  /** The loss a week the plan is built for (stores/body target), when it is
   *  one: names what a too-noisy trend can't show yet. */
  planKgPerWeek?: number | null;
  /** The day training restarted (a program's first day), while it's under two
   *  weeks ago: new training holds water, and the scale can rise as the work
   *  starts. null otherwise. */
  restartedOn?: string | null;
}

export interface Pulse {
  /** The trend, else the latest weigh-in; null before the first. */
  kg: number | null;
  caption: string;
  /** How far from where the stop was set to the stop (else from the first
   *  weigh-in to the goal), 0–100; null when there's nothing to measure. */
  pct: number | null;
  tone: PulseTone;
  story: string;
  stats: Array<{ v: string; l: string }>;
  /** The balance on Today: level while the trend holds or can't tell yet,
   *  leaning toward the target when it moves that way (and toward "today"
   *  when it moves away), in proportion to the rate, full lean at 1 kg/week. */
  beam: { tilt: number; left: string; right: string } | null;
}

export function pulse(i: PulseInput): Pulse {
  const w = i.weight;
  const trend = w?.trendKg ?? null;
  const kg = trend ?? w?.latestKg ?? null;
  const stop = i.next && !i.next.reached ? i.next : null;
  const target = stop ? stop.kg : i.goalKg;
  const from = stop ? (stop.fromKg ?? i.firstKg) : i.firstKg;
  const dir = goalDirection(kg, target ?? 0);
  // A rate is worth saying once the line through the mornings is sure of it,
  // or (on a cut) sure enough to judge against the plan: a flat month is too
  // noisy for its exact rate yet certainly not the plan's pace, and "30 more
  // mornings" was no answer to someone sixty mornings in.
  const sure = w != null && trend != null && (w.state === 'answerable' || (dir === 'lose' && w.state === 'too-noisy' && i.pace !== 'too-early'));
  const rate = sure ? w!.rateKgPerWeek : null;

  const toGo = kg != null && target != null ? kg - target : null;
  // In stone the number itself says "st", and the distance reads in pounds.
  const st = weightUnit() === 'st';
  const u = st ? '' : `${unitWord()} `;
  const goal = target != null ? wtShort(target) : '';
  const caption = trend == null ? (kg != null ? (st ? 'not a trend yet' : `${unitWord()} · not a trend yet`) : '')
    : toGo == null ? `${u}trend`
    : Math.abs(toGo) < 0.05 ? `${u}trend · at ${goal}`
    : `${u}trend · ${st ? dwt(toGo) : dwtNum(toGo)} to ${goal}`;
  const pct = trend != null && target != null && from != null && Math.abs(from - target) >= 0.1
    ? Math.max(0, Math.min(100, ((from - trend) / (from - target)) * 100))
    : null;

  let tone: PulseTone = 'na';
  let story: string;
  if (rate == null) {
    const n = w?.weighInsNeeded;
    const plan = i.planKgPerWeek != null && i.planKgPerWeek > 0 ? i.planKgPerWeek : null;
    story = kg == null ? 'Weigh in tomorrow morning, before food or drink: the trend starts there.'
      : n && n <= 7 ? `${n} more morning${n === 1 ? '' : 's'} on the scale and the trend can say how fast it’s moving.`
      // Months of mornings, a gentle plan and a swinging scale: what IS known.
      : trend != null && plan != null && (w?.n ?? 0) >= 14
        ? `Holding around ${wt(trend, 0)}. A ${dwt(plan)}-a-week loss takes a few more weeks of mornings to show through the day-to-day swings.`
      : 'A few more weeks of mornings on the scale and the trend can say how fast it’s moving.';
  } else {
    const r = dwt(rate);
    const toward = toGo != null && (dir === 'lose' ? rate > 0 : dir === 'gain' ? rate < 0 : false);
    const weeks = toward && Math.abs(rate) >= 0.05 ? Math.ceil(Math.abs(toGo!) / Math.abs(rate)) : null;
    const eta = weeks != null && weeks <= 156 ? ` At that pace, ${goal} in about ${weeks} week${weeks === 1 ? '' : 's'}.` : '';
    if (dir === 'gain') {
      tone = w!.hiKgPerWeek < 0 ? 'good' : w!.loKgPerWeek > 0 ? 'warn' : 'ok';
      story = rate < 0 ? `Up ${r} a week.${eta}` : rate > 0.05 ? `Down ${r} a week, and the goal is up.` : 'The trend isn’t climbing yet.';
    } else if (dir === 'maintain') {
      tone = Math.abs(rate) <= 0.25 ? 'good' : 'warn';
      story = tone === 'good' ? 'Holding at your goal.' : `${rate > 0 ? 'Down' : 'Up'} ${r} a week, away from your goal.`;
    } else {
      tone = i.pace === 'on-pace' || i.pace === 'faster' ? 'good' : i.pace === 'slower' ? 'ok'
        : i.pace === 'stalled' || i.pace === 'gaining' ? 'warn' : 'na';
      story = i.pace === 'stalled' ? 'The trend is flat right now.'
        : rate < 0 ? `Up ${r} a week right now.`
        : i.pace === 'faster' ? `Down ${r} a week, faster than the plan. Keep the protein up.${eta}`
        : i.pace === 'slower' ? `Down ${r} a week, slower than the plan.${eta}`
        : `Down ${r} a week.${eta}`;
    }
  }

  // Two weeks after a restart, the water has settled; until then a flat or
  // rising trend is the work starting, not the plan failing.
  if (i.restartedOn && (tone === 'warn' || tone === 'na')) {
    const d = new Date(`${i.restartedOn}T12:00:00`);
    d.setDate(d.getDate() + 14);
    story += ` New training can hold extra water for a week or two: judge the trend from ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`;
  }

  const lost = i.firstKg != null && kg != null ? i.firstKg - kg : null;
  const stats = [
    { v: lost == null ? '—' : `${lost >= 0 ? '−' : '+'}${dwtNum(lost)}`, l: `${changeWord()} so far` },
    { v: rate == null ? '—' : `${rate >= 0 ? '−' : '+'}${dwtNum(rate, 2)}`, l: `${changeWord()} / week` },
    stop && i.goalKg != null && kg != null
      ? { v: dwtNum(kg - i.goalKg), l: `${changeWord()} to ${wtShort(i.goalKg)}` }
      : { v: i.goalKg != null ? wtShort(i.goalKg) : '—', l: st ? 'goal' : `goal ${unitWord()}` },
  ];
  const toward = rate == null || target == null || kg == null ? 0
    : Math.sign(kg - target) * rate; // positive: moving toward the target
  const beam = target != null && trend != null
    ? { tilt: Math.abs(toward) < 0.05 ? 0 : Math.max(-1, Math.min(1, toward)), left: 'today', right: goal }
    : null;
  return { kg, caption, pct, tone, story, stats, beam };
}
