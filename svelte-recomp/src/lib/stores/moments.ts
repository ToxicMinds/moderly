// The app's two daily notifications, built from the same stores every screen
// reads: the morning briefing (src/lib/briefing.ts) and the evening hold
// (src/lib/hold.ts), each for today and tomorrow. The app shell hands them to
// Android (+layout.svelte), which posts each at the first unlock inside its
// window; the Alarms card shows them, so what arrives is never a surprise.
import { derived, get, writable, type Readable } from 'svelte/store';
import { body } from './body';
import { liveOwnSessions, liveProfile, liveSchedule } from './live';
import { upsertRecord } from './sync';
import { userId } from './user';
import { composeBriefing, type Briefing, type DayForecast } from '$lib/briefing';
import { composeHold, holdAfter, HOLD_UNTIL } from '$lib/hold';
import { overlaySessions, programWeek } from '$lib/program';
import { WEEKS } from '$lib/data/backRebuild';
import { cleanPlans } from '$lib/plans';
import { shiftYmd } from '$lib/date';
import { forecastHere } from '$lib/weather';

/** user_settings.briefing: the morning switch and time, and the evening's. */
export interface MomentSetting { on: boolean; after: string; hold: boolean }

export const momentSetting: Readable<MomentSetting | null> = derived(liveProfile(), ($p) => {
  const b = ($p as any)?.briefing;
  if (!b || typeof b !== 'object') return null;
  return { on: !!b.on, after: typeof b.after === 'string' && /^\d\d:\d\d$/.test(b.after) ? b.after : '06:00', hold: !!b.hold };
});

export const forecast = writable<DayForecast[] | null>(null);

/** The forecast here, reused while under an hour old. Set only on a change:
 *  a fresh copy of the same forecast would rebuild everything for nothing. */
export async function refreshForecast(ask = false): Promise<void> {
  const f = await forecastHere(ask);
  if (f && JSON.stringify(f) !== JSON.stringify(get(forecast))) forecast.set(f);
}

/** The morning briefing written for today and tomorrow. */
export const briefings: Readable<Briefing[]> = derived(
  [body, liveSchedule(), liveOwnSessions(), liveProfile(), forecast],
  ([$body, $schedule, $sessions, $profile, $forecast]) => {
    const sched = ($schedule as any[]) ?? [];
    const program = ($profile as any)?.program;
    const plans = cleanPlans(($profile as any)?.plans);
    return [$body.today, shiftYmd(1, new Date(`${$body.today}T12:00:00`))].map((date, i) => {
      const day = sched.find((s) => s.day_of_week === new Date(`${date}T12:00:00`).getDay()) ?? null;
      // That day's session, program and all: what Today will show then.
      const session = day?.session_key ? overlaySessions($sessions, sched, program, date).get(day.session_key) ?? null : null;
      const week = programWeek(program, date);
      return composeBriefing({
        date, forecast: $forecast?.find((f) => f.date === date) ?? null,
        day, session, rateBack: week >= 1 && week <= WEEKS, plans,
        week: i === 0 ? $body.week : $body.tomorrow,
      });
    });
  },
);

/** The evening hold written for today and tomorrow. Only today's knows the
 *  food; tomorrow's is rewritten tomorrow, whenever the app is next open. */
export const holds: Readable<Briefing[]> = derived(
  [body, liveSchedule(), liveProfile()],
  ([$body, $schedule, $profile]) => {
    const sched = ($schedule as any[]) ?? [];
    const plans = cleanPlans(($profile as any)?.plans);
    return [$body.today, shiftYmd(1, new Date(`${$body.today}T12:00:00`))].map((date, i) => {
      const day = sched.find((s) => s.day_of_week === new Date(`${date}T12:00:00`).getDay());
      return composeHold({
        date, plans, why: ($profile as any)?.why ?? null,
        badmintonDay: /badminton/i.test(`${day?.label ?? ''} ${day?.note ?? ''}`),
        food: i === 0 ? {
          kcal: $body.intake.get(date)?.kcal ?? 0, share: $body.week?.share ?? null,
          proteinG: $body.intake.get(date)?.protein ?? 0, proteinTargetG: $body.proteinTargetG,
        } : null,
      });
    });
  },
);

export interface Moment { date: string; key: 'morning' | 'evening'; after: number; until: number; title: string; body: string }

/** Everything Android should hold, with each one's window. */
export const moments: Readable<Moment[]> = derived([momentSetting, briefings, holds], ([$s, $b, $h]) => {
  if (!$s) return [];
  const out: Moment[] = [];
  if ($s.on) for (const b of $b) out.push({ ...b, key: 'morning', after: minutesOf($s.after), until: 12 * 60 });
  if ($s.hold) for (const h of $h) out.push({ ...h, key: 'evening', after: holdAfter(new Date(`${h.date}T12:00:00`).getDay()), until: HOLD_UNTIL });
  return out;
});

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export async function saveMoments(s: MomentSetting): Promise<void> {
  const uid = get(userId);
  if (!uid) throw new Error('Not signed in — sign back in.');
  await upsertRecord('user_settings', { user_id: uid, briefing: { on: s.on, after: s.after, hold: s.hold }, updated_at: new Date().toISOString() });
}
