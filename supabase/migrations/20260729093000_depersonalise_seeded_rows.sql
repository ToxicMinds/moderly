-- Remove one person's schedule from every other user's rows.
--
-- The starter sessions seeded into workout_sessions_custom carried text written
-- for one specific user: "kept clear of your Wed/Fri badminton legs" and
-- "Saturday, still clear of Sunday's total rest". 25 accounts have those rows,
-- including two real people who signed up today.
--
-- They are not merely awkward, they are FALSE for the reader. buildSchedule()
-- places sessions from the user's own template and sport days, so one of those
-- users has their full-body session on SUNDAY while the text tells them it is
-- Saturday and that Sunday is a rest day.
--
-- SAFETY: every update is an exact-match on the seeded default, so a row the
-- user has edited is never touched. There is no wildcard rewrite of user text.
--
-- WHAT IS DELIBERATELY NOT CHANGED: the sport name and time inside
-- workout_schedule.note. Those look personal but are the user's OWN answers
-- from onboarding — the two new users typed "Badminton — 7pm-9pm" and
-- "Badminton — 7:00PM - 9:00PM" respectively, which are genuinely theirs.
-- Rewriting those would destroy real input. Only the appended editorial suffix
-- is replaced, below.

-- 1. Starter session focus lines: exact-match only.
update public.workout_sessions_custom
   set focus = 'Quads, hamstrings, glutes — the heaviest lower-body day of your week',
       updated_at = now()
 where focus = 'Quads, hamstrings, glutes — kept clear of your Wed/Fri badminton legs';

update public.workout_sessions_custom
   set focus = 'Lighter compound volume — the easiest of the three, full body',
       updated_at = now()
 where focus = 'Lighter compound volume — Saturday, still clear of Sunday''s total rest';

-- 2. The deficit assumption appended to every sport day.
--
-- buildSchedule() appended "(this IS your fat-loss cardio)" to the user's own
-- sport note. Someone adding muscle is a legitimate recomp user, and telling
-- them their sport is fat-loss cardio is simply wrong. Replace ONLY the
-- suffix, so "Badminton — 7pm-9pm" survives intact.
update public.workout_schedule
   set note = replace(note, ' (this IS your fat-loss cardio)', ' — this counts as training'),
       updated_at = now()
 where note like '%(this IS your fat-loss cardio)%';

-- 3. Exercise tips inside the seeded session JSON that name a weekday.
--
-- These live in the `exercises` jsonb array, so they need a targeted text
-- replace rather than a column update. Again exact substring matches only.
update public.workout_sessions_custom
   set exercises = replace(
         exercises::text,
         'Wind down ahead of Sunday''s full rest day.',
         'Wind down — this is the last work before your rest day.'
       )::jsonb,
       updated_at = now()
 where exercises::text like '%Wind down ahead of Sunday''s full rest day.%';

update public.workout_sessions_custom
   set exercises = replace(
         exercises::text,
         'Same tempo cues as Monday, but lighter load',
         'Same tempo cues as your heavy lower day, but lighter load'
       )::jsonb,
       updated_at = now()
 where exercises::text like '%Same tempo cues as Monday, but lighter load%';
