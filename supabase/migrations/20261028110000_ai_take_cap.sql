-- ai_take: the per-person daily allowance is the server's, not the caller's.
--
-- Found 2026-10-28 in a security review: p_limit came from the caller, and the
-- function is callable by any signed-in person at /rest/v1/rpc/ai_take. The
-- edge functions pass their DAILY allowance (ai 60, search 400), but a saved
-- account could call it directly with p_limit = 1000000 and spend the shared
-- daily ceiling (ai 2000) in minutes, switching AI off for everyone until
-- midnight UTC. Money was never at risk (the Gemini account is prepaid); the
-- day's AI was. Now p_limit can only lower the allowance, never raise it.

create or replace function public.ai_take(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid   uuid    := auth.uid();
  trial boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  -- The most anyone gets a day, whatever the caller asks for.
  cap   integer := case p_bucket when 'ai' then 60 when 'search' then 400 else 60 end;
  lim   integer := least(greatest(coalesce(p_limit, 0), 0), cap);
  -- Everyone together, per day.
  ceiling integer := case p_bucket when 'ai' then 2000 when 'search' then 20000 else 1000 end;
  n integer;
  g integer;
begin
  if uid is null then
    return false;
  end if;
  if trial then
    lim := least(lim, 15);
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
$function$;
