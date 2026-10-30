# Engineering rules

How Slim Chance changes without breaking what already works. These hold for
every change, from a typo to a new feature.

## The baseline

The baseline is the running list of everything the app has promised to do.
Every deploy is checked against all of it.

- **Each promise is a named check** in `svelte-recomp/scripts/selfcheck.js`,
  named for what a person sees: "a gym week recorded only on the watch counts
  as training in the weekly review". The list of names is
  `svelte-recomp/scripts/baseline.txt`, the running sheet.
- **It only grows.** A new check joins the sheet on its first run. A check that
  stops running fails the suite, so a guarantee can't disappear quietly. Taking
  one out means deleting its line by hand and saying why in the commit.
- **Every bug becomes a check first.** Reproduce it, write the check that fails
  because of it, fix it, and watch the check pass. A comment beside the check
  says what happened and when.
- **Every concept has one home, and the suite guards it.** When two screens each
  work out "did they train?" in their own way, one of them ends up wrong (it
  happened on 2026-10-30). The shared function is the only way in, and a check
  fails if a screen goes around it.

## Every change, every deploy

1. **`npm run verify` before every commit:** the whole baseline, the type check
   and the production build.
2. **Push.** GitHub runs the same verify on every push
   (`.github/workflows/verify.yml`), away from the laptop the change was
   written on.
3. **`npm run ship` is the only way the web app goes live.** It refuses
   uncommitted or unpushed work, runs verify, and deploys with the commit as the
   build's version. Then it checks the live site (`scripts/smoke.mjs`): every
   address serves that commit, the pages people land on load, and the edge
   functions answer. If that check fails, it rolls back to the deployment that
   was live before.
4. **Native changes** (anything under `android/` or `ios/`, plugins,
   `capacitor.config.json`) also go through the APK workflow and the phone
   proof. The APK workflow installs the current release on an emulator and
   updates it in place. The phone proof runs the first-run flow on both phones.
   Bump `versionCode` and `LATEST_NATIVE_BUILD` together, and ship the web only
   after the release is published.
5. **A change people will see is looked at on a phone-sized screen** before it
   ships. The suite can't see layout.

**Personas** (`scripts/personas.mjs`): made-up people run through the app's
pure logic, each one from something that broke for a real person. What they
would read is kept in `scripts/personas.snap.json`; any change fails the
suite until it's accepted with `node scripts/personas.mjs --update`, and the
snapshot's diff goes into the commit, so a change in what people read is
always seen.

Not covered yet: **edge-function tests** against a local Supabase.

## Watching the live app

Three watches run on GitHub, away from the laptop that deploys. A failed run
emails the owner (GitHub's own notice).
- **Live check, every three hours** (`.github/workflows/live-check.yml`): the
  same smoke test as after a deploy. Every address serves the same build,
  which must be a commit on main; the pages load; the first screen runs; the
  edge functions answer.
- **Health digest, daily** (`health-digest.yml`): the `health` edge function
  answers its own token with the last 24 hours in totals, nothing about any
  one person. The run fails for a kind of error nobody had before, or when
  the check itself fails.
- **Phone proof, nightly** (`phone-proof.yml`): both phones' first minute
  against the live site.

## Practices

- **One source of truth (DRY).** Each concept is worked out in one place: the
  weight trend, targets and intake in `stores/body.ts`, a trained day in
  `trainedDates`, a table's conflict key in `CONFLICT`. A second copy is a bug
  waiting to happen.
- **All or nothing (ACID).**
  - Rows that belong together are saved in one request (`upsertRecords`).
  - A migration runs in one transaction, is safe to run twice, and is recorded
    in `schema_migrations`.
  - Isolation is row-level security: every table gets it, with the four
    own-rows policies, before it joins the sync.
  - The server holds the record; the phone's copy is a cache.
- **One job per piece (SOLID, as it applies here).**
  - Pure modules in `src/lib` decide, stores fetch and combine, and components
    show.
  - Logic takes its inputs as data and never reaches for a store or the
    network, so it can be tested on its own.
  - New behaviour goes in a new function, not in a flag threaded through an old
    one.
  - A function asks only for what it uses.
- **Simple first (KISS, YAGNI).** The smallest change that works, and no code
  for a need that hasn't arrived yet.
- **Fail loudly.** Errors are recorded (`client_errors`), never swallowed where
  they could lose data.
- **Never break the installed base.** A web deploy must work on every app build
  still installed. Storage keys, ids and the app id keep their old names.
- **Least privilege.** Database tools are read-only, and changes go through
  migrations. Keys live outside the repo.
- **Honest numbers.** When a number's meaning changes, its label changes with
  it, or the change reads as lost data.
- **Small, reversible steps.** One concern per commit, pushed the same day.
  Every deploy can be rolled back.
