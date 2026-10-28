-- Your line, and your plans: the two commitments the app holds for the user.
--
-- user_settings.line   {"kg": 114.0, "set": "2026-10-17"}
--   The weight the trend shouldn't cross again (STOP Regain's zones). It only
--   ever moves down — 1 kg above the lowest trend that held a week since it was
--   drawn (src/lib/line.ts) — and is never raised automatically.
--
-- user_settings.plans  {"weekend": "Leftovers go in a box…", "line": "…"}
--   If-then plans, one per moment (src/lib/plans.ts), shown when the moment
--   comes round.
--
-- Columns on user_settings rather than tables: that row is already keyed by
-- user_id, already RLS-protected by the own_rows_* policies and already synced,
-- so this adds no new surface that could leak between accounts.

alter table public.user_settings
  add column if not exists line jsonb,
  add column if not exists plans jsonb;

comment on column public.user_settings.line is
  'The weight line {"kg": number, "set": "YYYY-MM-DD"}; ratchets down with the held low trend; null when not drawn.';
comment on column public.user_settings.plans is
  'If-then plans keyed by moment: line | back | badminton | friday | weekend | evening -> text.';
