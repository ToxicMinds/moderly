-- The GLP-1 companion (a Plus extra; free while in preview): a person's
-- medication as their prescriber set it, and what happened with it. A tracker
-- only. Nothing here advises a dose: every value is what the person typed.
--
-- One-row-owner model like every other table: RLS and the four own_rows
-- policies are created here, before either table joins the sync list.

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                    -- as the person calls it
  dose numeric,                          -- the current dose, as prescribed
  unit text not null default 'mg',
  every_days integer not null default 7 check (every_days between 1 and 31),
  weekday integer check (weekday between 0 and 6),  -- weekly: JS getDay()
  time text,                             -- 'HH:MM' reminder, null = none
  started date not null default current_date,
  stopped date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Doses, how the person felt, and (later) test results, as typed.
create table if not exists public.med_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  med_id uuid references public.medications(id) on delete cascade,
  kind text not null check (kind in ('dose', 'effect', 'lab')),
  date date not null,
  dose numeric,                          -- dose: the amount taken
  site text,                             -- dose: where it went in
  symptom text,                          -- effect: what they felt
  severity integer check (severity between 1 and 3),  -- 1 mild, 2 moderate, 3 severe
  test text,                             -- lab: as on the lab report
  value numeric,
  unit text,
  ref_low numeric,                       -- lab: the lab's own range, as typed
  ref_high numeric,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists medications_user_id_idx on public.medications(user_id);
create index if not exists med_events_user_date_idx on public.med_events(user_id, date desc);

alter table public.medications enable row level security;
alter table public.med_events enable row level security;

drop policy if exists "own_rows_select" on public.medications;
create policy "own_rows_select" on public.medications for select using (auth.uid() = user_id);
drop policy if exists "own_rows_insert" on public.medications;
create policy "own_rows_insert" on public.medications for insert with check (auth.uid() = user_id);
drop policy if exists "own_rows_update" on public.medications;
create policy "own_rows_update" on public.medications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own_rows_delete" on public.medications;
create policy "own_rows_delete" on public.medications for delete using (auth.uid() = user_id);

drop policy if exists "own_rows_select" on public.med_events;
create policy "own_rows_select" on public.med_events for select using (auth.uid() = user_id);
drop policy if exists "own_rows_insert" on public.med_events;
create policy "own_rows_insert" on public.med_events for insert with check (auth.uid() = user_id);
drop policy if exists "own_rows_update" on public.med_events;
create policy "own_rows_update" on public.med_events for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own_rows_delete" on public.med_events;
create policy "own_rows_delete" on public.med_events for delete using (auth.uid() = user_id);

-- Realtime needs the full old row to broadcast UPDATE/DELETE correctly.
alter table public.medications replica identity full;
alter table public.med_events replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.medications;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.med_events;
exception
  when duplicate_object then null;
end $$;
