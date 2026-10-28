-- The weekly check-in: how the week actually FELT.
--
-- Everything else the app stores is measured — the scale, the watch, the food
-- log. None of it can read whether a cut left someone starving at 10pm, which is
-- the signal that decides whether a plan survives contact with real life. Once a
-- week the app asks three questions, and the answers change next week's targets
-- (see src/lib/weekCheckIn.ts).
--
-- Deliberately a COLUMN on daily_logs rather than a new table. daily_logs is
-- already keyed (user_id, date), already has RLS enabled with the four
-- own_rows_* policies, and is already in the client's sync TABLES list — so a
-- column inherits all of that and adds no new surface that could leak rows
-- between accounts. A new table would have needed its own policies before it
-- could safely join the sync list.
--
-- Keyed by the MONDAY of the week under review, so one row per week and a
-- re-answer overwrites in place instead of accumulating duplicates.

alter table public.daily_logs
  add column if not exists week_check jsonb;

comment on column public.daily_logs.week_check is
  'Weekly check-in answers {effort, hunger, adherence, answeredAt}. Present only on rows whose date is a Monday (the week under review).';
