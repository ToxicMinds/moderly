-- Complete the four-policy set on the three tables that were missing one.
--
-- AUDIT RESULT (2026-07-29): reads were never at risk. Every table in the
-- schema has `select using (auth.uid() = user_id)`, so no user has ever been
-- able to see another user's rows — that was verified again by listing every
-- policy, not assumed.
--
-- What WAS missing is the ability to modify your own data:
--
--   biometrics      — no DELETE policy. RLS is default-deny, so a user could
--                     not delete their own sleep/heart-rate rows at all. A bad
--                     manual entry was permanent.
--   user_settings   — no DELETE policy. Blocks a genuine "delete my account and
--                     everything in it" flow from client code.
--   progress_photos — no UPDATE policy. A photo's caption or date could never
--                     be corrected after upload.
--
-- These are the mirror image of a leak: too little access to your OWN data
-- rather than too much to someone else's. Both are worth getting right.
--
-- Naming note: these three tables predate the own_rows_* convention and use
-- "<verb> own <table>" names. New policies follow the current convention; the
-- older ones are left alone so this migration cannot disturb working access.

-- biometrics: let a user delete their own measurements.
drop policy if exists "own_rows_delete" on public.biometrics;
create policy "own_rows_delete" on public.biometrics
  for delete using (auth.uid() = user_id);

-- user_settings: needed for account deletion to be doable from the client.
drop policy if exists "own_rows_delete" on public.user_settings;
create policy "own_rows_delete" on public.user_settings
  for delete using (auth.uid() = user_id);

-- progress_photos: allow correcting a photo's own row.
-- with_check is stated explicitly rather than relying on it defaulting to the
-- using expression, so the row can never be re-pointed at another user_id.
drop policy if exists "own_rows_update" on public.progress_photos;
create policy "own_rows_update" on public.progress_photos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
