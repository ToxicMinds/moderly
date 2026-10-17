// The morning briefing's text for today and tomorrow, built from the same
// stores every screen reads (src/lib/briefing.ts says what goes in it and
// why). The app shell hands it to Android (+layout.svelte); the Alarms card
// shows it, so what arrives is never a surprise.
import { derived, get, writable, type Readable } from 'svelte/store';
import { body } from './body';
import { liveOwnSessions, liveProfile, liveSchedule } from './live';
import { upsertRecord } from './sync';
import { userId } from './user';
import { composeBriefing, type Briefing, type DayForecast } from '$lib/briefing';
import { overlaySessions, programWeek } from '$lib/program';
import { WEEKS } from '$lib/data/backRebuild';
import { cleanPlans } from '$lib/plans';
import { shiftYmd } from '$lib/date';
import { forecastHere } from '$lib/weather';

/** user_settings.briefing. Off until the user turns it on. */
export interface BriefingSetting { on: boolean; after: string }

export const briefingSetting: Readable<BriefingSetting | null> = derived(liveProfile(), ($p) => {
  const b = ($p as any)?.briefing;
  if (!b || typeof b !== 'object') return null;
  return { on: !!b.on, after: typeof b.after === 'string' && /^\d\d:\d\d$/.test(b.after) ? b.after : '06:00' };
});

export const forecast = writable<DayForecast[] | null>(null);

/** The forecast here, reused while under an hour old. Set only on a change:
 *  a fresh copy of the same forecast would rebuild the briefings for nothing. */
export async function refreshForecast(ask = false): Promise<void> {
  const f = await forecastHere(ask);
  if (f && JSON.stringify(f) !== JSON.stringify(get(forecast))) forecast.set(f);
}

export const briefings: Readable<Briefing[]> = derived(
  [body, liveSchedule(), liveOwnSessions(), liveProfile(), forecast],
  ([$body, $schedule, $sessions, $profile, $forecast]) => {
    const sched = ($schedule as any[]) ?? [];
    const program = ($profile as any)?.program;
    const plans = cleanPlans(($profile as any)?.plans);
    const tomorrow = shiftYmd(1, new Date(`${$body.today}T12:00:00`));
    return [$body.today, tomorrow].map((date, i) => {
      const dow = new Date(`${date}T12:00:00`).getDay();
      const day = sched.find((s) => s.day_of_week === dow) ?? null;
      // That day's session, program and all — what Today will show then.
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

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export async function saveBriefing(s: BriefingSetting): Promise<void> {
  const uid = get(userId);
  if (!uid) throw new Error('Not signed in — sign back in.');
  await upsertRecord('user_settings', { user_id: uid, briefing: { on: s.on, after: s.after }, updated_at: new Date().toISOString() });
}
