// Sends real Web Push notifications for alarms that are due right now.
// Triggered every minute by a pg_cron job (see the cron migration) calling this
// function over HTTP via pg_net. This exists because Service Worker `setTimeout`
// scheduling (the old approach) gets killed by the browser when the SW goes idle,
// so long-delayed local timers don't reliably fire. A real Web Push message wakes
// the Service Worker even after it's been terminated.
//
// Required secrets (set via `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the platform.
//
// Simplification: alarm times are compared in a single fixed timezone (APP_TIMEZONE,
// default Europe/Bratislava) rather than per-user timezone, since this app currently
// has no per-user timezone setting. Override APP_TIMEZONE via a function secret if needed.

import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const TIMEZONE = Deno.env.get('APP_TIMEZONE') ?? 'Europe/Bratislava';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function currentTimeAndDay(): { time: string; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const hh = map.hour === '24' ? '00' : map.hour;
  return { time: `${hh}:${map.minute}`, day: DAY_INDEX[map.weekday] };
}

async function restQuery(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`REST query failed (${res.status}): ${await res.text()}`);
  return res.json();
}

Deno.serve(async () => {
  try {
    const { time, day } = currentTimeAndDay();

    const alarms = (await restQuery(
      `alarms?enabled=eq.true&time=eq.${time}&select=id,user_id,title,message,days`
    )) as Array<{ id: string; user_id: string; title: string; message: string | null; days: number[] }>;

    const due = alarms.filter((a) => Array.isArray(a.days) && a.days.includes(day));

    let sent = 0;
    let failed = 0;

    for (const alarm of due) {
      const subs = (await restQuery(
        `push_subscriptions?user_id=eq.${alarm.user_id}&select=subscription`
      )) as Array<{ subscription: any }>;

      for (const row of subs) {
        try {
          await webpush.sendNotification(
            row.subscription,
            JSON.stringify({ title: alarm.title, body: alarm.message || '', tag: `alarm-${alarm.id}` })
          );
          sent++;
        } catch (e) {
          failed++;
          console.error(`Push send failed for user ${alarm.user_id}:`, e);
        }
      }
    }

    return new Response(JSON.stringify({ checked: alarms.length, due: due.length, sent, failed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('send-alarm-push error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
