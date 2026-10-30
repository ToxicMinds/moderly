// The GLP-1 companion's arithmetic (a Plus extra; free while in preview). A
// tracker only: when the person's own schedule puts the next dose, which
// injection site has rested longest, and when a logged feeling should come
// with the line pointing to their prescriber. Nothing here suggests a dose or
// says what a symptom might be. Pure; see selfcheck.js.
import { shiftYmd } from './date.ts';

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
