# Moderly

**Lose weight moderately. Keep it off.**

A calm weight-loss app for people doing it on their own. It measures you against
yourself: a trend instead of the daily scale, a week of food instead of a perfect day,
and a plan for the moments that undo most diets (the evening, the Friday, the
weekend), handed to you when the phone is picked up rather than on a clock. No
streaks, no guilt.

Live at [moderly.vercel.app](https://moderly.vercel.app). Licensed AGPL-3.0.

- `svelte-recomp/` is the app: a SvelteKit PWA, shipped to Android as a thin
  Capacitor shell that loads the live site.
- `supabase/` holds the database migrations and edge functions.

See `CLAUDE.md` for how it's built, tested and deployed.
