-- Unify progress photos with body-fat / physique analysis.
--
-- Two photo pipelines existed side by side and shared nothing:
--   * progress_photos  — front/side/back photos in Storage, used only for the
--                        before/after comparison slider. Never analysed.
--   * physique_snapshots — AI body-fat % + per-region scores from a SEPARATE
--                        photo upload; the photo itself was thrown away and the
--                        bf% never reached the TDEE / composition engine.
--
-- This migration lets a physique_snapshot LINK back to the exact progress
-- photo it was computed from, so:
--   * uploading a progress photo can also run the body-fat analysis, and
--   * we can retroactively analyse photos that already exist WITHOUT double-
--     counting (dedupe on storage_path).
--
-- physique_snapshots was created directly in the dashboard and never had a
-- migration, so this file is written to be safe whether or not the table
-- already exists (create-if-not-exists + add-column-if-not-exists), and it
-- (re)asserts the standard owner-only RLS either way.

create table if not exists public.physique_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  bf_percent numeric,
  regions jsonb not null default '[]'::jsonb,
  summary text,
  created_at timestamptz not null default now()
);

-- New link + provenance columns. storage_path ties a snapshot to a specific
-- progress-photos object; source records where the analysis was triggered
-- ('progress' upload, 'manual' one-off estimate, or 'backfill').
alter table public.physique_snapshots add column if not exists storage_path text;
alter table public.physique_snapshots add column if not exists source text;

-- One analysis per photo: makes the retroactive backfill idempotent (re-running
-- it can't create duplicate snapshots for the same photo). Partial unique index
-- so the many legacy rows with a NULL storage_path are unaffected.
create unique index if not exists physique_snapshots_storage_path_uniq
  on public.physique_snapshots(user_id, storage_path)
  where storage_path is not null;

create index if not exists physique_snapshots_user_created_idx
  on public.physique_snapshots(user_id, created_at);

alter table public.physique_snapshots enable row level security;

drop policy if exists "own_rows_select" on public.physique_snapshots;
create policy "own_rows_select" on public.physique_snapshots
  for select using (auth.uid() = user_id);

drop policy if exists "own_rows_insert" on public.physique_snapshots;
create policy "own_rows_insert" on public.physique_snapshots
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_rows_update" on public.physique_snapshots;
create policy "own_rows_update" on public.physique_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_rows_delete" on public.physique_snapshots;
create policy "own_rows_delete" on public.physique_snapshots
  for delete using (auth.uid() = user_id);
