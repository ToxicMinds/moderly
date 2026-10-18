-- Trial accounts: "Start now" signs people in anonymously (Supabase anonymous
-- sign-ins), so they can try everything before giving an email. Saving the
-- account later turns the same user into an email one; nothing moves.
--
-- What changes because of that, and why:
--
-- 1. A script can mint trial accounts (Supabase allows 30 an hour per IP), so
--    each one gets a smaller daily AI allowance, and all accounts together
--    have a ceiling, which bounds what the AI and search quotas can cost on
--    the worst day.
-- 2. Trials nobody saves would otherwise keep health data forever. One that
--    hasn't been used for 30 days is deleted (every table cascades from
--    auth.users), nightly.
-- 3. That nightly delete can't remove stored files, so trials can't upload
--    photos: saving the account unlocks progress photos.

create table if not exists public.ai_usage_global (
  day    date    not null,
  bucket text    not null,
  calls  integer not null default 0,
  primary key (day, bucket)
);
alter table public.ai_usage_global enable row level security;
-- No policies: only ai_take (security definer) touches it.

create or replace function public.ai_take(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid    := auth.uid();
  trial boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  lim   integer := case when trial then least(p_limit, 15) else p_limit end;
  -- Everyone together, per day.
  ceiling integer := case p_bucket when 'ai' then 2000 when 'search' then 20000 else 1000 end;
  n integer;
  g integer;
begin
  if uid is null then
    return false;
  end if;
  insert into public.ai_usage (user_id, day, bucket, calls)
  values (uid, (now() at time zone 'utc')::date, p_bucket, 1)
  on conflict (user_id, day, bucket) do update set calls = public.ai_usage.calls + 1
  returning calls into n;
  if n > lim then
    return false;
  end if;
  -- Counted only for calls inside a person's own allowance, so one account
  -- hammering past its cap can't use up everyone's day.
  insert into public.ai_usage_global (day, bucket, calls)
  values ((now() at time zone 'utc')::date, p_bucket, 1)
  on conflict (day, bucket) do update set calls = public.ai_usage_global.calls + 1
  returning calls into g;
  return g <= ceiling;
end;
$$;
revoke all on function public.ai_take(text, integer) from public, anon;
grant execute on function public.ai_take(text, integer) to authenticated;

create or replace function public.purge_idle_trials()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  n integer;
begin
  with gone as (
    delete from auth.users u
    where u.is_anonymous
      and u.created_at < now() - interval '30 days'
      and not exists (
        select 1 from auth.sessions s
        where s.user_id = u.id
          and greatest(s.updated_at, coalesce(s.refreshed_at at time zone 'utc', s.updated_at)) > now() - interval '30 days'
      )
    returning u.id
  )
  select count(*) into n from gone;
  return n;
end;
$$;
revoke all on function public.purge_idle_trials() from public, anon, authenticated;

select cron.unschedule('purge-idle-trials') where exists (select 1 from cron.job where jobname = 'purge-idle-trials');
select cron.schedule('purge-idle-trials', '23 3 * * *', 'select public.purge_idle_trials()');

drop policy if exists "insert own progress photos" on storage.objects;
create policy "insert own progress photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );
