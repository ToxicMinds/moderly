-- Food log provenance + portion memory, and the active training program.
--
-- food_logs.grams / barcode / source
--   Until now a food row was a name and four numbers. Provenance lived INSIDE the
--   name ("Plain white rice (cooked) (AI estimate, high confidence)"), which kept
--   the two most-logged foods in the account — rice x48, whey x37 — out of the
--   quick-add chips, because the chips skip anything named "(AI estimate". And
--   with no grams stored, "the same food, a different portion" meant retyping.
--     grams    portion eaten, when known; per-100 g = kcal / grams * 100
--     barcode  EAN the row came from, so a re-scan resolves from your own history
--              even when Open Food Facts doesn't know the product
--     source   where the numbers came from: history | builtin | off | ai | label |
--              manual | recipe | quick
--
-- user_settings.program
--   The return-to-training program, e.g. {"id":"back-rebuild","start":"2026-10-19"}.
--   A column on user_settings rather than a table: that row is already keyed by
--   user_id, already RLS-protected by the own_rows_* policies, and already synced,
--   so this adds no new surface that could leak between accounts.

alter table public.food_logs
  add column if not exists grams numeric,
  add column if not exists barcode text,
  add column if not exists source text;

alter table public.user_settings
  add column if not exists program jsonb;

comment on column public.food_logs.source is
  'Where the macros came from: history | builtin | off | ai | label | manual | recipe | quick';
comment on column public.user_settings.program is
  'Active training program, e.g. {"id":"back-rebuild","start":"YYYY-MM-DD"}; null when none.';
