-- Watch-recorded workouts (badminton, runs, lifts) as owned rows.
--
-- These were deliberately Dexie-only: "native-derived, no Supabase table".
-- That was wrong. A watch session is the single hardest-won datum in the app —
-- it is the only proof that training actually happened — and keeping it on one
-- device means it dies with a reinstall, never reaches a second device, and is
-- invisible to anything server-side. It also made the data unverifiable: the
-- phone could show a workout that nothing else in the system could confirm.
--
-- Shape mirrors the ActivitySession interface in src/lib/health/exercise.ts
-- exactly, so the same row round-trips through Dexie and PostgREST untouched.
-- `id` is the Health Connect record UID (text, not uuid) so re-reading the same
-- session upserts in place instead of duplicating.

create table if not exists public.activity_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,                       -- YMD of session start, local
  exercise_type integer not null default 0, -- HC EXERCISE_TYPE_* code
  label text not null default 'Workout',
  emoji text not null default '🏋️',
  kind text not null default 'other',       -- sport | cardio | strength | mind | other
  start timestamptz not null,
  "end" timestamptz not null,
  duration_min numeric not null default 0,
  active_kcal numeric,
  distance_m numeric,
  avg_hr numeric,
  source text not null default 'watch',
  updated_at timestamptz not null default now()
);

create index if not exists activity_sessions_user_date_idx
  on public.activity_sessions(user_id, date desc);

alter table public.activity_sessions enable row level security;

-- Same one-row-owner model as every other table (see init_schema).
drop policy if exists "own_rows_select" on public.activity_sessions;
create policy "own_rows_select" on public.activity_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "own_rows_insert" on public.activity_sessions;
create policy "own_rows_insert" on public.activity_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_rows_update" on public.activity_sessions;
create policy "own_rows_update" on public.activity_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_rows_delete" on public.activity_sessions;
create policy "own_rows_delete" on public.activity_sessions
  for delete using (auth.uid() = user_id);

alter table public.activity_sessions replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.activity_sessions;
exception
  when duplicate_object then null;
end $$;
