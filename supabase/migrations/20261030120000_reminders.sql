-- The morning weigh-in reminder, in each person's own time zone, and what
-- became of it at setup. Until now every reminder fired at its time in
-- Bratislava wherever the person was, and setup stored one even when the
-- browser could never receive it: no stranger ever got one.

-- The browser's own zone (Intl), written with the reminder; send-alarm-push
-- compares each alarm in it. Older rows have none and keep APP_TIMEZONE.
alter table public.alarms add column if not exists tz text;

-- note_event takes what became of the reminder at setup: a push that works,
-- one the browser couldn't take (Today then offers the calendar), or the
-- calendar event added. src/lib/events.ts lists the same names.
create or replace function public.note_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_event not in ('open', 'setup_1', 'setup_2', 'setup_3', 'setup_done', 'reminder_push', 'reminder_failed', 'reminder_calendar') then
    return;
  end if;
  insert into public.app_events (user_id, event) values (auth.uid(), p_event)
  on conflict do nothing;
end;
$$;
revoke all on function public.note_event(text) from public, anon;
grant execute on function public.note_event(text) to authenticated;
