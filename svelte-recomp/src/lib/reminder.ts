// The morning weigh-in reminder for a browser that can't take a push: setup
// leaves the chosen time here, and Today offers it as a daily event in the
// person's own calendar (supabase/functions/reminder-ics).
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

export const CALENDAR_KEY = 'recompos.reminder.calendar';

/** The calendar file for a daily event at hh:mm. */
export const calendarUrl = (hhmm: string) => `${PUBLIC_SUPABASE_URL}/functions/v1/reminder-ics?t=${encodeURIComponent(hhmm)}`;

/** Whether this browser can take a push at all (Safari on an iPhone can't, outside the Home Screen). */
export const canPush = (): boolean => typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator;

/** The browser's own time zone, for the server to fire the reminder at the person's 07:00. */
export function localTz(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}
