-- user_settings.why — the user's reason, in their own words.
--
-- Written once, private, never shared. It comes back at the moments a plan is
-- tested (over the line, the Sunday review), because that is when a reason
-- does work a target can't. Values-writing has (small, early) evidence for
-- weight loss on its own (Logel & Cohen, Psychological Science 2012).
--
-- A column on user_settings: already keyed by user_id, RLS-protected by the
-- own_rows_* policies and synced — no new surface that could leak.

alter table public.user_settings
  add column if not exists why text;

comment on column public.user_settings.why is
  'The user''s reason for doing this, in their own words; shown back at hard moments; null when not written.';
