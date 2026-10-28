-- Which wearable the user actually owns.
--
-- Health Connect is brand-agnostic for READING data, so nothing per-brand is
-- needed to pull steps or workouts. Two things do depend on knowing the brand:
--
--   1. De-duplication. Several apps write the same day's steps into Health
--      Connect (the phone's own counter AND the watch's companion app), and
--      summing them double-counts. Picking the right one requires knowing which
--      package is the watch — previously a hand-maintained regex that did not
--      include Samsung, so a Galaxy Watch user could silently have the phone
--      chosen over the watch.
--   2. Setup help. Every companion app hides the Health Connect switch in a
--      different place and several default it to OFF, which is nearly always
--      the real cause of "it isn't syncing".
--
-- Nullable: the app auto-detects from the data origins when this is unset, so
-- an existing user loses nothing by never answering.

alter table public.user_settings
  add column if not exists watch_brand text;

comment on column public.user_settings.watch_brand is
  'Wearable brand id from src/lib/health/watches.ts (oneplus, samsung, garmin, fitbit, xiaomi, huawei, whoop, polar, withings, phone, other). Null = auto-detect.';
