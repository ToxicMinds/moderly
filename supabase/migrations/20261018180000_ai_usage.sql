-- A per-user daily cap on the functions that spend outside quota (the AI
-- providers' free tiers, Open Food Facts' goodwill). They already refuse
-- anyone not signed in (20261018 functions change), but signing up is open,
-- so a script with a fresh account could still spend it.
--
-- ai_usage is written only by ai_take (security definer) and read by no
-- client: RLS on, no policies, and it never joins the sync TABLES list.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  bucket text not null,
  calls integer not null default 0,
  primary key (user_id, day, bucket)
);
alter table public.ai_usage enable row level security;

-- Counts one call for the caller (auth.uid() from their own token) and says
-- whether it is within today's limit. An anon key has no user: no row, false.
create or replace function public.ai_take(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then
    return false;
  end if;
  insert into public.ai_usage (user_id, day, bucket, calls)
  values (uid, (now() at time zone 'utc')::date, p_bucket, 1)
  on conflict (user_id, day, bucket) do update set calls = public.ai_usage.calls + 1
  returning calls into n;
  return n <= p_limit;
end;
$$;
revoke all on function public.ai_take(text, integer) from public, anon;
grant execute on function public.ai_take(text, integer) to authenticated;
