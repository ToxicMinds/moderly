// One night of sleep, from however many sessions the watch split it into.
//
// Waking at 3 a.m. and falling asleep again an hour later gives two Health
// Connect sessions for one night. Taking the longest session (the old rule,
// there to keep naps out of last night) kept 4.3 of 6.5 hours on 29 Oct 2026.
// So sessions from one source with less than NIGHT_GAP_MIN between them are one
// night, added up and attributed to the day it ends; a nap hours away from the
// night stays its own, and the caller still keeps a day's longest night.

// ponytail: a fixed gap. Long middle-of-the-night wakes beyond it split the
// night again; widen it if real nights show that, at the cost of folding in
// naps that close to bedtime.
export const NIGHT_GAP_MIN = 120;

export interface Night<T> {
  day: string;
  origin: string;
  minutes: number;
  sessions: T[];
}

export function sleepNights<T extends { startTime: string | Date; endTime: string | Date }>(
  sessions: T[],
  o: { originOf: (s: T) => string; minutesOf: (s: T) => number; dayOf: (t: string | Date) => string }
): Night<T>[] {
  const byOrigin = new Map<string, T[]>();
  for (const s of sessions) {
    const k = o.originOf(s);
    if (!byOrigin.has(k)) byOrigin.set(k, []);
    byOrigin.get(k)!.push(s);
  }
  const nights: Night<T>[] = [];
  for (const [origin, list] of byOrigin) {
    list.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    let night: Night<T> | null = null;
    let end = 0;
    for (const s of list) {
      const start = +new Date(s.startTime);
      const stop = +new Date(s.endTime);
      const minutes = o.minutesOf(s);
      if (night && start - end <= NIGHT_GAP_MIN * 60_000) {
        // An overlapping session is the same sleep recorded twice: keep the larger.
        night.minutes = start < end ? Math.max(night.minutes, minutes) : night.minutes + minutes;
        night.sessions.push(s);
        end = Math.max(end, stop);
        night.day = o.dayOf(new Date(end));
      } else {
        night = { day: o.dayOf(s.endTime), origin, minutes, sessions: [s] };
        nights.push(night);
        end = stop;
      }
    }
  }
  return nights;
}
