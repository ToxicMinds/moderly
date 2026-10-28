-- Morning back-pain rating, 0–10, for the Back Rebuild program.
--
-- The program paces itself on how the back feels the morning after training —
-- the standard pain-monitoring rule for returning to load (≤3 progress, 4–5
-- hold, 6+ back off). One number per day, so a column on daily_logs: already
-- keyed (user_id, date), RLS-protected by the own_rows_* policies and synced,
-- so it adds no new surface that could leak rows between accounts.

alter table public.daily_logs
  add column if not exists back_pain smallint
  check (back_pain is null or back_pain between 0 and 10);

comment on column public.daily_logs.back_pain is
  'Morning back-pain rating 0–10 (Back Rebuild program); null when not rated.';
