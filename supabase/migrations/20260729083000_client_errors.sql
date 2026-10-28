-- Client-side error capture.
--
-- THE GAP: when the user hit errors in the app, there was nowhere to look. The
-- `notices` store is an in-memory Svelte writable — it is wiped on reload, so
-- by the time anyone asks "what was that error?" the answer is gone. Meanwhile
-- Supabase's own logs showed 478 requests in 40 hours, all HTTP 200, because
-- these failures never reach the server: they are TypeErrors, failed native
-- bridge calls, render crashes and rejected promises inside the WebView.
--
-- So the only debugging protocol available was "please take a screenshot next
-- time", which loses the first occurrence of every bug by construction.
--
-- Deliberately kept cheap and self-limiting:
--   * `fingerprint` collapses repeats — the same error firing 400 times in a
--     render loop is ONE row with a count, not 400 rows. Without this, a loop
--     would fill the table faster than anyone could read it.
--   * No stack traces from third-party origins and a hard length cap, so this
--     cannot become an exfiltration path for page content.
--   * RLS from the start (see below): an error log is arguably MORE sensitive
--     than the fitness data, since messages can quote user input.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Stable hash of (message + first stack frame). The dedup key.
  fingerprint text not null,
  message text not null,
  stack text,
  -- 'error' | 'unhandledrejection' | 'notice' | 'render'
  kind text not null default 'error',
  -- Where in the app it happened, e.g. "/workouts".
  route text,
  -- Enough to tell a phone bug from a browser bug, without fingerprinting.
  platform text,
  app_version text,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- One row per distinct error per user; repeats bump count/last_seen.
create unique index if not exists client_errors_user_fingerprint_idx
  on public.client_errors(user_id, fingerprint);
create index if not exists client_errors_last_seen_idx
  on public.client_errors(user_id, last_seen desc);

alter table public.client_errors enable row level security;

drop policy if exists "own_rows_select" on public.client_errors;
create policy "own_rows_select" on public.client_errors
  for select using (auth.uid() = user_id);

drop policy if exists "own_rows_insert" on public.client_errors;
create policy "own_rows_insert" on public.client_errors
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_rows_update" on public.client_errors;
create policy "own_rows_update" on public.client_errors
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_rows_delete" on public.client_errors;
create policy "own_rows_delete" on public.client_errors
  for delete using (auth.uid() = user_id);

-- Atomic upsert-and-increment. Doing this client-side as select-then-update
-- would race with itself the moment two errors fire in the same tick, which is
-- exactly what happens during a render loop — the failure mode this table
-- exists to capture.
create or replace function public.record_client_error(
  p_fingerprint text,
  p_message text,
  p_stack text,
  p_kind text,
  p_route text,
  p_platform text,
  p_app_version text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.client_errors as ce
    (user_id, fingerprint, message, stack, kind, route, platform, app_version)
  values
    (auth.uid(), p_fingerprint, left(p_message, 500), left(p_stack, 2000),
     coalesce(p_kind, 'error'), p_route, p_platform, p_app_version)
  on conflict (user_id, fingerprint) do update
    set count = ce.count + 1,
        last_seen = now(),
        -- Keep the newest route/stack: the most recent occurrence is the one
        -- someone is about to go and reproduce.
        route = excluded.route,
        stack = coalesce(excluded.stack, ce.stack);
end;
$$;

revoke all on function public.record_client_error(text, text, text, text, text, text, text) from public;
grant execute on function public.record_client_error(text, text, text, text, text, text, text) to authenticated;
