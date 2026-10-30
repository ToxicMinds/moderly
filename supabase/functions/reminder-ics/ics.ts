// The morning weigh-in as a daily calendar event, for a browser that can't
// take a push (Safari on an iPhone, notifications refused). Floating local
// time, no zone, so 07:00 stays 07:00 wherever the phone goes. Pure; see
// selfcheck.js.

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** RFC 5545: lines over 75 octets continue on the next, after a space. */
function fold(line: string): string {
  const out: string[] = [];
  for (let s = line; s.length; s = s.slice(out.length === 1 ? 75 : 74)) out.push((out.length ? ' ' : '') + s.slice(0, out.length ? 74 : 75));
  return out.join('\r\n');
}

/** A daily event at hh:mm from `today` (YYYY-MM-DD), with an alert at that minute; null for a bad time. */
export function dailyReminderIcs(hhmm: string, today: string, site = 'https://slimchance.vercel.app/'): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const day = today.replaceAll('-', '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Slim Chance//Morning weigh-in//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // One per time: adding the same reminder twice updates it instead of doubling it.
    `UID:morning-weigh-in-${m[1]}${m[2]}@slimchance.app`,
    `DTSTAMP:${day}T000000Z`,
    `DTSTART:${day}T${m[1]}${m[2]}00`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${esc('Step on the scale')}`,
    `DESCRIPTION:${esc(`Before food or drink, then log it in Slim Chance: ${site}`)}`,
    `URL:${site}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Step on the scale')}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}
