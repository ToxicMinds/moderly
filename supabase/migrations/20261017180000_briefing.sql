-- user_settings.briefing: the morning briefing's switch and time.
--
-- {"on": true, "after": "06:00"}. One notification the first time the phone
-- is unlocked after that time: the weather, the day's session, the day's food
-- and the day's plan (src/lib/briefing.ts; posted by MorningReceiver.java).
-- Not an alarm: the user asked for no more of those.
--
-- Only the switch and the time live here. The location used for the weather
-- never leaves the phone except, rounded to about a kilometre, to the forecast
-- service (src/lib/weather.ts).
--
-- A column on user_settings: keyed by user_id, RLS-protected by the own_rows_*
-- policies and already synced, so there's no new surface that could leak.

alter table public.user_settings
  add column if not exists briefing jsonb;

comment on column public.user_settings.briefing is
  'Morning briefing {"on": boolean, "after": "HH:MM"}; null = off.';
