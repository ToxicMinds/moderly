-- user_settings.briefing now also carries the evening hold's switch.
--
-- {"on": true, "after": "06:00", "hold": true}. "hold" is the evening hold:
-- the evening's plan, posted the first time the phone is unlocked after 19:30
-- (17:00 Friday to Sunday) by MomentReceiver.java; src/lib/hold.ts writes it.
-- Same column, same RLS, nothing new to sync; only the documented shape changes.

comment on column public.user_settings.briefing is
  'Morning briefing and evening hold {"on": boolean, "after": "HH:MM", "hold": boolean}; null = both off.';
