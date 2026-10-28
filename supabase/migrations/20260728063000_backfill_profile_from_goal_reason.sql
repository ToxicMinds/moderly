-- Recover height/sex/start weight for users who predate the profile columns.
--
-- THE PROBLEM: height and sex were never persisted anywhere. They lived as local
-- component state inside BodyGoals.svelte and were retyped on every visit, so
-- when user_settings gained real profile columns there was nothing to migrate
-- them from — and every existing user was therefore treated as brand new and
-- pushed into first-run onboarding, which looks exactly like "my data is gone".
--
-- But the values DO survive, in prose. The "Set as my goal" flow wrote a
-- goal_reason narrative that embeds them verbatim, e.g.:
--
--   "...at 92.4kg, 175cm, 35yo female, moderately active..."
--
-- So we parse them back out. Only fills columns that are still NULL, so anyone
-- who has since entered real values is untouched.

-- Height: the "175cm" in the narrative.
update public.user_settings
   set height_cm = (substring(goal_reason from '([0-9]{2,3}(?:\.[0-9]+)?)\s*cm'))::numeric
 where height_cm is null
   and goal_reason ~ '[0-9]{2,3}(\.[0-9]+)?\s*cm'
   -- Guard the range: a bad parse must not feed a nonsense height into
   -- Mifflin-St Jeor, which would silently produce a wrong calorie target
   -- rather than failing loudly.
   and (substring(goal_reason from '([0-9]{2,3}(?:\.[0-9]+)?)\s*cm'))::numeric between 100 and 250;

-- Sex: "35yo female" / "male" in the same sentence.
update public.user_settings
   set sex = 'female'
 where sex is null and goal_reason ~* '\yfemale\y';

update public.user_settings
   set sex = 'male'
 where sex is null and goal_reason ~* '\ymale\y' and goal_reason !~* '\yfemale\y';

-- Starting weight: the "at 92.4kg" the projection was calculated from. Only
-- used for the "how far you've come" bar, so a miss is cosmetic.
update public.user_settings
   set start_kg = (substring(goal_reason from 'at\s+([0-9]{2,3}(?:\.[0-9]+)?)\s*kg'))::numeric
 where start_kg is null
   and goal_reason ~ 'at\s+[0-9]{2,3}(\.[0-9]+)?\s*kg'
   and (substring(goal_reason from 'at\s+([0-9]{2,3}(?:\.[0-9]+)?)\s*kg'))::numeric between 30 and 400;

-- Anyone who now has a complete profile has effectively already onboarded;
-- stamp it so the app treats them as an existing user, not a new one.
update public.user_settings
   set onboarded_at = coalesce(onboarded_at, updated_at, now())
 where onboarded_at is null
   and height_cm is not null
   and sex is not null
   and birth_year is not null
   and goal_kg is not null;
