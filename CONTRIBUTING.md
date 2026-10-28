# Contributing to Moderly

Thank you for wanting to help. A few things keep this app honest and calm.

## Before you open a pull request

- Run `npm run verify` in `svelte-recomp/`. It must print **All checks passed.**,
  then type-check and build cleanly.
- Add a check to `scripts/selfcheck.js` for any logic you change, and make sure it
  fails when your change is reverted.
- Keep one source of truth: the weight trend, the calorie and protein targets and the
  week's budget come from `src/lib/stores/body.ts`.

## Things this app never does

- Judge a person by a generic norm (meal times, breakfast, a fixed hour). Compare them
  with their own history, or say nothing.
- Ask people to log more than they do, use streaks or loss aversion, or show a bad
  week in red.
- Put real people's data in tests, fixtures, comments or commit messages. Use made-up
  numbers.

## Data and security

- A new table needs row-level security and its four `own_rows_*` policies before it
  joins the sync list in `src/lib/stores/sync.ts`.
- Functions that spend outside quota go through `supabase/functions/_shared/auth.ts`
  (signed in, under a daily cap).
- Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

By contributing, you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE).
