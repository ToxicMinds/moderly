-- Where new people give up, counted inside Moderly's own database. No
-- trackers and nothing leaves: one row per person, event and day.
--
-- The pattern of 20261018180000_ai_usage.sql: app_events has RLS on and no
-- policies, so no client reads or writes it through the API; note_event
-- (security definer) writes it, accepting only the names on its list, and
-- owner_metrics reads it, answering only the people in app_owners. It never
-- joins the sync TABLES list.
create table if not exists public.app_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  day date not null default (now() at time zone 'utc')::date,
  at timestamptz not null default now(),
  primary key (user_id, event, day)
);
alter table public.app_events enable row level security;

-- Who may read the totals. Filled by hand with the owner's user id, never in
-- this public repo. RLS on, no policies: invisible through the API.
create table if not exists public.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_owners enable row level security;

-- The events the app notes (src/lib/events.ts; selfcheck keeps the lists equal).
-- Any other name is ignored, so a script can't fill the table with made-up ones.
create or replace function public.note_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_event not in ('open', 'setup_1', 'setup_2', 'setup_3', 'setup_done') then
    return;
  end if;
  insert into public.app_events (user_id, event) values (auth.uid(), p_event)
  on conflict do nothing;
end;
$$;
revoke all on function public.note_event(text) from public, anon;
grant execute on function public.note_event(text) to authenticated;

-- Totals for the owner's Numbers page: everyone who joined in the last
-- p_days, the owners themselves left out. Counts only, never a person.
create or replace function public.owner_metrics(p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.app_owners where user_id = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with people as (
    select u.id, (u.created_at at time zone 'utc')::date as joined, u.is_anonymous
    from auth.users u
    where u.created_at > now() - make_interval(days => greatest(p_days, 1))
      and u.id not in (select user_id from public.app_owners)
  ),
  per as (
    select
      p.id, p.joined, p.is_anonymous,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_1') as setup_1,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_2') as setup_2,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_3') as setup_3,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_done')
        or exists (select 1 from public.user_settings s where s.user_id = p.id and s.onboarded_at is not null) as setup_done,
      (select min(w.date) from public.weights w where w.user_id = p.id) as first_weigh,
      (select count(*) from public.food_logs f where f.user_id = p.id) as food_rows,
      greatest(
        (select max(w.date) from public.weights w where w.user_id = p.id),
        (select max(f.date) from public.food_logs f where f.user_id = p.id),
        (select max(e.day) from public.app_events e where e.user_id = p.id)
      ) as last_seen
    from people p
  ),
  scored as (
    select per.*,
      (select count(distinct w.date) from public.weights w
        where w.user_id = per.id and w.date <= per.first_weigh + 6) as first_week_weighs
    from per
  )
  select jsonb_build_object(
    'days', greatest(p_days, 1),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'Signed up', 'people', count(*)),
      jsonb_build_object('step', 'Saw setup', 'people', count(*) filter (where setup_1 or setup_done)),
      jsonb_build_object('step', 'Setup screen 2', 'people', count(*) filter (where setup_2 or setup_done)),
      jsonb_build_object('step', 'Setup screen 3', 'people', count(*) filter (where setup_3 or setup_done)),
      jsonb_build_object('step', 'Finished setup', 'people', count(*) filter (where setup_done)),
      jsonb_build_object('step', 'First weigh-in', 'people', count(*) filter (where first_weigh is not null)),
      jsonb_build_object('step', 'Weighed in 3 of first 7 days', 'people', count(*) filter (where first_week_weighs >= 3)),
      jsonb_build_object('step', 'Back after a week', 'people', count(*) filter (where last_seen >= joined + 7)),
      jsonb_build_object('step', 'Back after four weeks', 'people', count(*) filter (where last_seen >= joined + 28))
    ),
    'logged_food', count(*) filter (where food_rows > 0),
    'trials', count(*) filter (where is_anonymous),
    'saved_accounts', count(*) filter (where not is_anonymous),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'people', n) order by wk)
      from (select date_trunc('week', joined)::date as wk, count(*) as n from scored group by 1) w
    ), '[]'::jsonb),
    'opens', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'people', n) order by day)
      from (
        select e.day, count(distinct e.user_id) as n from public.app_events e
        where e.event = 'open' and e.day > (now() at time zone 'utc')::date - 30
          and e.user_id not in (select user_id from public.app_owners)
        group by 1
      ) o
    ), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object('message', message, 'times', times, 'people', people, 'last', last) order by last desc)
      from (
        select c.message, sum(c.count) as times, count(distinct c.user_id) as people, max(c.last_seen) as last
        from public.client_errors c
        where c.last_seen > now() - interval '14 days'
          and c.user_id not in (select user_id from public.app_owners)
        group by c.message
        order by max(c.last_seen) desc
        limit 15
      ) x
    ), '[]'::jsonb)
  ) into result
  from scored;
  return result;
end;
$$;
revoke all on function public.owner_metrics(integer) from public, anon;
grant execute on function public.owner_metrics(integer) to authenticated;
