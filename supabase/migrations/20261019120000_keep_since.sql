-- Keeping it off: the day someone chose to hold their weight rather than lose
-- more (at their goal, or from the start). While set, the budget is their
-- maintenance under the ceiling and a gentle deficit over it, and Today counts
-- the days the trend stayed inside their range.
alter table public.user_settings add column if not exists keep_since date;
