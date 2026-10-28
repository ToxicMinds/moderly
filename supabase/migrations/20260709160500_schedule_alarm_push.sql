-- Schedule the send-alarm-push edge function to run every minute so alarms fire
-- as real Web Push notifications (works even when the app/tab is closed), instead
-- of relying on Service Worker setTimeout (which gets killed when the SW idles out).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select
  cron.schedule(
    'send-alarm-push-every-minute',
    '* * * * *',
    $$
    select net.http_post(
      url := 'https://jerbhsasccvjelkkphgu.supabase.co/functions/v1/send-alarm-push',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
    $$
  )
where not exists (
  select 1 from cron.job where jobname = 'send-alarm-push-every-minute'
);
