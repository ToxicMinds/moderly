-- User profile fields on user_settings.
--
-- These were previously either hardcoded constants in the client
-- (config.ts: GOAL_KG = 90, START_KG = 133.5, both derived from one person's
-- body) or transient component state that was retyped on every visit and never
-- persisted (height / age / sex in BodyGoals.svelte). Neither is usable by a
-- second person, and the second case meant the TDEE engine could not run at all
-- unless you were actively filling in that one form.
--
-- Storage is ALWAYS metric. `units` is a display preference only — mixing
-- storage units is how weight histories get silently corrupted.

alter table public.user_settings
  add column if not exists display_name    text,
  -- Birth YEAR, not age: an age becomes wrong on its own, a birth year doesn't.
  add column if not exists birth_year      integer,
  add column if not exists height_cm       numeric(5,1),
  -- Required by Mifflin-St Jeor and the Navy body-fat formula, both sex-specific.
  add column if not exists sex             text,
  add column if not exists activity_level  text,
  add column if not exists units           text not null default 'metric',
  add column if not exists start_kg        numeric(5,2),
  add column if not exists onboarded_at    timestamptz;

-- Carry over the existing `age` column. It is left in place (dropping it would
-- be destructive and it costs nothing) but is no longer written to: an age is a
-- number that silently goes stale, and a stale age quietly shifts every calorie
-- target the app produces.
update public.user_settings
   set birth_year = extract(year from now())::int - age
 where birth_year is null
   and age is not null
   and age between 13 and 100;

-- Guard the values the calorie maths depends on. A negative age or a 3 m height
-- doesn't fail loudly in Mifflin-St Jeor — it silently returns a plausible-looking
-- but wrong calorie target, which is the worst possible failure for this app.
do $$
begin
  alter table public.user_settings
    add constraint user_settings_sex_check
    check (sex is null or sex in ('male', 'female'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.user_settings
    add constraint user_settings_units_check
    check (units in ('metric', 'imperial'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.user_settings
    add constraint user_settings_height_check
    check (height_cm is null or (height_cm >= 100 and height_cm <= 250));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.user_settings
    add constraint user_settings_birth_year_check
    check (birth_year is null or (birth_year >= 1900 and birth_year <= extract(year from now())::int - 13));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.user_settings
    add constraint user_settings_activity_check
    check (activity_level is null or activity_level in
      ('sedentary', 'light', 'moderate', 'active', 'very_active'));
exception when duplicate_object then null;
end $$;
