// The GLP-1 companion's arithmetic (a Plus extra; free while in preview). A
// tracker only: when the person's own schedule puts the next dose, which
// injection site has rested longest, and when a logged feeling should come
// with the line pointing to their prescriber. Nothing here suggests a dose or
// says what a symptom might be. Pure; see selfcheck.js.
import { shiftYmd } from './date.ts';
import { wt, dwt, type WeightUnit } from './units.ts';

export const SITES = ['Belly, left', 'Belly, right', 'Thigh, left', 'Thigh, right', 'Arm, left', 'Arm, right'] as const;
export const FEELINGS = ['Nausea', 'Vomiting', 'Constipation', 'Diarrhoea', 'Heartburn', 'Stomach pain', 'Tiredness', 'Headache', 'Dizziness', 'Injection site'] as const;
export const SEVERITY = ['Mild', 'Moderate', 'Severe'] as const;

/** Shown beside every feeling logged, and called out when one needs it. */
export const PRESCRIBER_LINE = 'Severe stomach pain that won’t go away, vomiting you can’t keep fluids down, or swelling of the face, lips or throat: contact your prescriber now, or emergency services. This app only keeps the record.';

export interface Med {
  id: string;
  name: string;
  dose: number | null;
  unit: string;
  every_days: number;
  /** Weekly: JS getDay(), 0 = Sunday. */
  weekday: number | null;
  /** 'HH:MM' reminder, null for none. */
  time: string | null;
  started: string;
  stopped: string | null;
}

export interface MedEvent {
  id: string;
  med_id: string | null;
  kind: 'dose' | 'effect' | 'lab';
  date: string;
  dose?: number | null;
  site?: string | null;
  symptom?: string | null;
  severity?: number | null;
  test?: string | null;
  value?: number | null;
  unit?: string | null;
  ref_low?: number | null;
  ref_high?: number | null;
}

const noon = (ymd: string) => new Date(`${ymd}T12:00:00`);
const daysBetween = (a: string, b: string) => Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000);

/** The next dose by the person's own schedule: the weekday they set for a
 *  weekly one, otherwise the last dose plus the interval. */
export function nextDose(med: Med, events: MedEvent[], today: string): { date: string; inDays: number; doneToday: boolean } | null {
  if (med.stopped && med.stopped <= today) return null;
  const last = events.filter((e) => e.kind === 'dose' && e.med_id === med.id).map((e) => e.date).sort().at(-1) ?? null;
  let date: string;
  if (med.every_days === 7 && med.weekday != null) {
    date = last ? shiftYmd(1, noon(last)) : med.started;
    while (noon(date).getDay() !== med.weekday) date = shiftYmd(1, noon(date));
  } else {
    date = last ? shiftYmd(med.every_days, noon(last)) : med.started;
  }
  return { date, inDays: daysBetween(today, date), doneToday: last === today };
}

/** Every site, the longest-rested first, with the day each was last used. */
export function sitesByRest(events: MedEvent[]): Array<{ site: string; last: string | null }> {
  const last = new Map<string, string>();
  for (const e of events) if (e.kind === 'dose' && e.site && (last.get(e.site) ?? '') < e.date) last.set(e.site, e.date);
  return SITES.map((site) => ({ site, last: last.get(site) ?? null })).sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''));
}

/** A feeling that should come with the prescriber line called out: any severe
 *  one, and stomach pain or vomiting from moderate up. */
export function needsPrescriber(e: { symptom?: string | null; severity?: number | null }): boolean {
  const s = e.severity ?? 0;
  return s >= 3 || (s >= 2 && (e.symptom === 'Stomach pain' || e.symptom === 'Vomiting'));
}

/** The medication's reminder as an alarms row: weekly on its day, or daily.
 *  The alarms table repeats by weekday, so other intervals get none. */
export function medAlarm(med: Med, uid: string, tz: string) {
  const days = med.every_days === 7 && med.weekday != null ? [med.weekday] : med.every_days === 1 ? [0, 1, 2, 3, 4, 5, 6] : [];
  return {
    id: med.id, user_id: uid, auto_key: `med:${med.id}`,
    title: `💊 ${med.name}`,
    message: `${med.dose ?? ''} ${med.unit}`.trim() + ', as your prescriber set it.',
    time: med.time ?? '09:00', tz, days,
    enabled: !!med.time && !med.stopped && days.length > 0,
  };
}

/** "today", "tomorrow", "yesterday", or "Wed 5 Nov". */
export function dayWord(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return noon(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Tests people on these medicines are commonly sent for, with the unit most
 *  European labs print. Any other test can be typed in. */
export const LAB_TESTS = [
  { test: 'HbA1c', unit: '%' },
  { test: 'Fasting glucose', unit: 'mmol/L' },
  { test: 'LDL cholesterol', unit: 'mmol/L' },
  { test: 'HDL cholesterol', unit: 'mmol/L' },
  { test: 'Triglycerides', unit: 'mmol/L' },
  { test: 'ALT', unit: 'U/L' },
  { test: 'eGFR', unit: 'mL/min/1.73m²' },
] as const;

export interface LabResult { date: string; value: number; unit: string; ref_low: number | null; ref_high: number | null }

/** Each test's results as typed, newest first; the most recently tested first.
 *  Shown beside the lab's own range, never judged against it. */
export function labResults(events: MedEvent[]): Array<{ test: string; results: LabResult[] }> {
  const by = new Map<string, { test: string; results: LabResult[] }>();
  for (const e of events) {
    if (e.kind !== 'lab' || !e.test || e.value == null) continue;
    const key = e.test.trim().toLowerCase();
    if (!by.has(key)) by.set(key, { test: e.test.trim(), results: [] });
    by.get(key)!.results.push({ date: e.date, value: e.value, unit: e.unit ?? '', ref_low: e.ref_low ?? null, ref_high: e.ref_high ?? null });
  }
  const out = [...by.values()];
  for (const t of out) t.results.sort((a, b) => b.date.localeCompare(a.date));
  return out.sort((a, b) => b.results[0].date.localeCompare(a.results[0].date));
}

/** "5.9 % (lab range 4–5.6)", the range only as far as it was typed. */
export function labLine(r: LabResult): string {
  const range = r.ref_low != null && r.ref_high != null ? `${r.ref_low}–${r.ref_high}`
    : r.ref_high != null ? `up to ${r.ref_high}` : r.ref_low != null ? `from ${r.ref_low}` : '';
  return `${r.value}${r.unit ? ` ${r.unit}` : ''}${range ? ` (lab range ${range})` : ''}`;
}

/** The day each different amount was first logged. */
export function doseSteps(events: MedEvent[], medId: string): Array<{ from: string; dose: number }> {
  const out: Array<{ from: string; dose: number }> = [];
  for (const e of [...events].filter((x) => x.kind === 'dose' && x.med_id === medId && x.dose != null).sort((a, b) => a.date.localeCompare(b.date))) {
    if (out.at(-1)?.dose !== e.dose) out.push({ from: e.date, dose: e.dose as number });
  }
  return out;
}

/** How often each feeling was logged since a day, and how bad it got. */
export function feelingSummary(events: MedEvent[], since: string): Array<{ symptom: string; times: number; worst: number }> {
  const by = new Map<string, { symptom: string; times: number; worst: number }>();
  for (const e of events) {
    if (e.kind !== 'effect' || !e.symptom || e.date < since) continue;
    const s = by.get(e.symptom) ?? { symptom: e.symptom, times: 0, worst: 0 };
    s.times++; s.worst = Math.max(s.worst, e.severity ?? 1);
    by.set(e.symptom, s);
  }
  return [...by.values()].sort((a, b) => b.times - a.times || b.worst - a.worst);
}

/** Protein a day over the last `days` logged days, or null with none. */
export function proteinAverage(intake: Array<{ date: string; protein: number }>, today: string, days = 14): number | null {
  const from = shiftYmd(-days, noon(today));
  const xs = intake.filter((d) => d.date > from && d.date <= today && d.protein > 0).map((d) => d.protein);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

export interface ReportInput {
  med: Med;
  events: MedEvent[];
  today: string;
  /** The weight trend by day (stores/body.ts trendSeries). */
  trend: Array<{ date: string; trendKg: number | null }>;
  proteinAvgG: number | null;
  proteinTargetG: number | null;
  /** "Getting fitter?"'s training line, as Progress says it. */
  training: string | null;
  unit: WeightUnit;
}

const long = (ymd: string) => noon(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const short = (ymd: string) => noon(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The record as plain text for the person's doctor: what they logged, the
 *  weight trend since they started, and nothing the app concluded. */
export function reportText(i: ReportInput): string {
  const { med, events, today } = i;
  const since = shiftYmd(-84, noon(today));
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const how = med.every_days === 7 ? `once a week${med.weekday != null ? ` (${days[med.weekday]})` : ''}` : med.every_days === 1 ? 'every day' : `every ${med.every_days} days`;
  const out = [
    'Slim Chance: medication record',
    `Prepared ${long(today)} by the person it belongs to, from what they recorded. Not a medical document.`,
    '',
    `Medication: ${med.name}${med.dose != null ? `, ${med.dose} ${med.unit}` : ''}, ${how}, since ${long(med.started)}.`,
  ];
  const steps = doseSteps(events, med.id);
  if (steps.length > 1) out.push(`Dose steps: ${steps.map((s) => `${s.dose} ${med.unit} from ${short(s.from)}`).join('; ')}.`);
  const doses = events.filter((e) => e.kind === 'dose' && e.med_id === med.id && e.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  if (doses.length) {
    const last = doses.at(-1)!;
    out.push(`Doses logged in the last 12 weeks: ${doses.length} (last ${short(last.date)}${last.site ? `, ${last.site}` : ''}).`);
  }
  const pts = i.trend.filter((p) => p.trendKg != null);
  const start = [...pts].reverse().find((p) => p.date <= med.started) ?? pts.find((p) => p.date > med.started);
  const end = pts.at(-1);
  if (start && end && end.date > start.date) {
    const change = (end.trendKg as number) - (start.trendKg as number);
    const weeks = Math.max(1, Math.round((noon(end.date).getTime() - noon(start.date).getTime()) / (7 * 86_400_000)));
    out.push('', `Weight trend since starting: ${wt(start.trendKg, 1, i.unit)} on ${short(start.date)}, ${wt(end.trendKg, 1, i.unit)} on ${short(end.date)} (${change <= 0 ? 'down' : 'up'} ${dwt(change, 1, i.unit)} in ${weeks} week${weeks === 1 ? '' : 's'}).`);
  }
  const felt = feelingSummary(events, since);
  if (felt.length) {
    out.push('', 'How they felt, last 12 weeks:');
    for (const f of felt) out.push(`- ${f.symptom}: ${f.times} time${f.times === 1 ? '' : 's'}, at worst ${SEVERITY[f.worst - 1].toLowerCase()}`);
  }
  const labs = labResults(events);
  if (labs.length) {
    out.push('', 'Blood tests, as typed from the lab report:');
    for (const t of labs) out.push(`- ${t.test}: ${t.results.slice(0, 4).map((r) => `${labLine(r)} on ${short(r.date)}`).join('; ')}`);
  }
  const muscle = [
    i.proteinAvgG != null ? `protein averaged ${i.proteinAvgG} g a day over the last two weeks${i.proteinTargetG ? ` (their target ${i.proteinTargetG} g)` : ''}` : null,
    i.training ? i.training.replace(/\.$/, '').replace(/^T/, 't') : null,
  ].filter(Boolean);
  if (muscle.length) out.push('', `Keeping muscle: ${muscle.join('; ')}.`);
  return out.join('\n');
}

