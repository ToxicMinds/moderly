-- Stone (st + lb), for UK users, alongside metric and imperial. Storage stays
-- metric: `units` is a display preference only (see 20260727121000).
alter table public.user_settings drop constraint if exists user_settings_units_check;
alter table public.user_settings
  add constraint user_settings_units_check check (units in ('metric', 'imperial', 'stone'));
