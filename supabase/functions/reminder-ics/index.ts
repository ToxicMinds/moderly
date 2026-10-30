// GET ?t=07:00 → the morning weigh-in as a daily calendar event (ics.ts).
// Public on purpose (no sign-in): it takes a time and returns the same file
// for everyone, so there is nothing personal to protect.
import { dailyReminderIcs } from './ics.ts';

Deno.serve((req) => {
  const ics = dailyReminderIcs(new URL(req.url).searchParams.get('t') ?? '', new Date().toISOString().slice(0, 10));
  if (!ics) return new Response('Give the time as ?t=07:00', { status: 400 });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="slim-chance-weigh-in.ics"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});
