-- Would people pay for Plus? Before building payments, a card on Progress
-- (past the first week) asks, with the price, and says Plus isn't on sale
-- yet. Each answer is counted like the setup steps: one row per person,
-- answer and day, in our own database. src/lib/events.ts lists the same names.
create or replace function public.note_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_event not in ('open', 'setup_1', 'setup_2', 'setup_3', 'setup_done', 'reminder_push', 'reminder_failed', 'reminder_calendar', 'plus_yes', 'plus_no') then
    return;
  end if;
  insert into public.app_events (user_id, event) values (auth.uid(), p_event)
  on conflict do nothing;
end;
$$;
revoke all on function public.note_event(text) from public, anon;
grant execute on function public.note_event(text) to authenticated;
