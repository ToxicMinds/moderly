-- user_settings.coach: the AI coach's switch and what it has learned.
--
-- {"on": true, "at": "2026-10-28T15:40:00Z", "privacy": "2026-10-28",
--  "notes": "Trains in the afternoon on gym days...", "notes_at": "..."}
--
-- "on" is the person's consent: off unless they turn it on, recorded with the
-- privacy page it was given against. "notes" is what the coach writes about
-- them, shown in Settings, where Forget clears it. A column on user_settings:
-- keyed by user_id, RLS-protected by the own_rows_* policies and already
-- synced, so no new surface that could leak.

alter table public.user_settings
  add column if not exists coach jsonb;
