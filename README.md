# RecompOS

A personal body-recomposition app: weight trend, food, training, recovery, and two
daily notifications that arrive when the phone is picked up rather than on a clock.

- `svelte-recomp/` is the app: a SvelteKit PWA, shipped to Android as a thin
  Capacitor shell that loads the live site.
- `supabase/` holds the database migrations and edge functions.

See `CLAUDE.md` for how it's built, tested and deployed.
