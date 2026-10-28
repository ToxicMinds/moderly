-- AI-generated / user-saved recipes.
--
-- The app previously shipped a frozen array of 19 recipes compiled into the
-- bundle (src/lib/data/recipes.ts). Those stay as the offline seed, but a
-- generated recipe is real user content — it should survive a reinstall and
-- follow the user across devices, so it lives in Postgres like every other
-- owned row rather than in the local-only Dexie cache.
--
-- Shape mirrors the static Recipe type exactly so both render through the same
-- card + modal: ing/prep/steps/instantPot are JSON arrays, macros are per
-- portion, `batch` is how many portions the ingredient list makes.

create table if not exists public.recipes_custom (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  e text not null default '🍽️',
  t integer not null default 30,          -- total minutes
  k integer not null default 0,           -- kcal per portion
  p integer not null default 0,           -- protein g per portion
  c integer not null default 0,           -- carbs g per portion
  f integer not null default 0,           -- fat g per portion
  batch integer not null default 1,
  descr text not null default '',
  ing jsonb not null default '[]'::jsonb,
  prep jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  instant_pot jsonb not null default '[]'::jsonb,
  kid boolean not null default false,
  coach_note text not null default '',
  -- What the user asked for. Kept so a recipe can be regenerated/varied later
  -- and so "more like this" has something to work from.
  request text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists recipes_custom_user_id_idx on public.recipes_custom(user_id);
create index if not exists recipes_custom_created_idx on public.recipes_custom(user_id, created_at desc);

alter table public.recipes_custom enable row level security;

-- Same one-row-owner model as every other table (see init_schema).
drop policy if exists "own_rows_select" on public.recipes_custom;
create policy "own_rows_select" on public.recipes_custom
  for select using (auth.uid() = user_id);

drop policy if exists "own_rows_insert" on public.recipes_custom;
create policy "own_rows_insert" on public.recipes_custom
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_rows_update" on public.recipes_custom;
create policy "own_rows_update" on public.recipes_custom
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_rows_delete" on public.recipes_custom;
create policy "own_rows_delete" on public.recipes_custom
  for delete using (auth.uid() = user_id);

-- Realtime needs the full old row to broadcast UPDATE/DELETE correctly.
alter table public.recipes_custom replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.recipes_custom;
exception
  when duplicate_object then null;
end $$;
