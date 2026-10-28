-- RecompOS initial schema
-- One row-owner model: every table has a user_id column tied to auth.users(id),
-- and RLS restricts every operation to auth.uid() = user_id. Anonymous Supabase
-- auth sessions (signInAnonymously()) still get a real auth.users row + JWT, so
-- auth.uid() works normally for them too.

create extension if not exists pgcrypto;

-- Alarms: recurring reminders
create table if not exists public.alarms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text,
  time text not null,
  days integer[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists alarms_user_id_idx on public.alarms(user_id);

-- Daily logs: one row per user per day (kcal, water, evening checklist state)
create table if not exists public.daily_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  kcal integer,
  water_glasses integer not null default 0,
  evening_checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Weights: one entry per user per day
create table if not exists public.weights (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight numeric(5,2) not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- Steps: one entry per user per day
create table if not exists public.steps (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  count integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- Workout sessions completed (logging that session A/B happened on a date)
create table if not exists public.sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on public.sessions(user_id);

-- Evening checklist items
create table if not exists public.checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists checks_user_date_idx on public.checks(user_id, date);

-- Generic tracked metrics (body fat %, measurements, anything else over time)
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  name text not null,
  value numeric not null,
  unit text,
  created_at timestamptz not null default now()
);
create index if not exists tracks_user_date_idx on public.tracks(user_id, date);

-- Weekly meal plans (assign recipes to days of a week)
create table if not exists public.meal_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- Web Push subscriptions (one per user/device pairing kept simple as one per user)
create table if not exists public.push_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security: enable + per-user CRUD policies on every table
alter table public.alarms enable row level security;
alter table public.daily_logs enable row level security;
alter table public.weights enable row level security;
alter table public.steps enable row level security;
alter table public.sessions enable row level security;
alter table public.checks enable row level security;
alter table public.tracks enable row level security;
alter table public.meal_plans enable row level security;
alter table public.push_subscriptions enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'alarms', 'daily_logs', 'weights', 'steps',
    'sessions', 'checks', 'tracks', 'meal_plans', 'push_subscriptions'
  ])
  loop
    execute format('drop policy if exists "own_rows_select" on public.%I', t);
    execute format('create policy "own_rows_select" on public.%I for select using (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own_rows_insert" on public.%I', t);
    execute format('create policy "own_rows_insert" on public.%I for insert with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own_rows_update" on public.%I', t);
    execute format('create policy "own_rows_update" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own_rows_delete" on public.%I', t);
    execute format('create policy "own_rows_delete" on public.%I for delete using (auth.uid() = user_id)', t);

    -- Needed so Realtime broadcasts full old-row data on UPDATE/DELETE
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- Enable Realtime on the tables the app subscribes to (see sync.ts TABLES list)
alter publication supabase_realtime add table
  public.alarms, public.daily_logs, public.weights, public.steps,
  public.sessions, public.checks, public.tracks;
