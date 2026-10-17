-- user_settings.milestone — the next stop on the way to the goal.
--
-- {"kg": 105, "set": "2026-10-17"}. A goal 17 kg away is a year off; a stop 8
-- kg away is a season. Near goals are the ones people act on (proximal goals
-- raise effort and self-efficacy more than distant ones — Bandura & Schunk,
-- 1981), and a stop can mean something on its own: 105 kg at 187 cm is where
-- the "obese" BMI band ends.
--
-- The first user typed 105 into the line (the ceiling above you) because there
-- was nowhere else to put a target below you; that's what this is for.
--
-- A column on user_settings: keyed by user_id, RLS-protected by the own_rows_*
-- policies and already synced — no new surface that could leak.

alter table public.user_settings
  add column if not exists milestone jsonb;

comment on column public.user_settings.milestone is
  'Next stop below the current weight {"kg": number, "set": "YYYY-MM-DD"}; null when not set.';
