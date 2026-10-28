-- Period-aware weight, opt-in. user_settings.cycle_aware switches it on;
-- daily_logs.period marks the first day of a period (one tap on Today). After
-- three cycles the app learns the person's own water swing before a period and
-- explains those mornings. Health data under the same consent as the rest;
-- nothing is inferred and nothing else reads it.
alter table public.user_settings add column if not exists cycle_aware boolean not null default false;
alter table public.daily_logs add column if not exists period boolean;
