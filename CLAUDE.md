# Moderly — CLAUDE.md

**This repo is Moderly** (called RecompOS until 2026-10-18). A calm weight-loss app for
people doing it on their own: weight trend, food, training, recovery, two daily
notifications. Svelte 5 + SvelteKit PWA, Supabase backend, shipped to Android as a thin
Capacitor shell.

**The old name lives on inside, on purpose.** Only what users read says Moderly. The
Android applicationId (`com.toxicminds.recompos`), the Java package, storage keys
(`recompos.*`), the Dexie db, plugin prefs, the `svelte-recomp/` folder, the Vercel
project `svelte-recomp`, `~/.config/recompos/` and the local path `/home/nik/schedule`
keep their names: renaming them makes a different app, loses local state, or orphans
Claude's memory (keyed by the path). Never "finish the rename" there.

It is **not** Synculariti. Synculariti (`/home/nik/synculariti-core`) is a restaurant
inventory-management monorepo — NestJS + Next.js + pnpm/Turborepo, Neo4j, Gemini invoice
extraction, Render/Railway deploys. Nothing in that repo applies here and nothing here
applies there. If a task mentions invoices, tenants, IMS, or `apps/ims/api`, you are in
the wrong directory.

| | Moderly (here) | Synculariti |
|---|---|---|
| Path | `/home/nik/schedule` | `/home/nik/synculariti-core` |
| Repo | `ToxicMinds/moderly` (**public**; was `schedule`, old URLs redirect) | private |
| Stack | SvelteKit 5 PWA + Capacitor Android | NestJS + Next.js, pnpm monorepo |
| Data | Supabase `jerbhsasccvjelkkphgu` | its own Supabase + Neo4j |
| Hosting | Vercel `svelte-recomp` (account: `vercel whoami`) | Render |
| Secrets | `~/.config/recompos/*.env` | `.env.local` in that repo |

## Credentials — all three are already stored. Never ask for them again.

| Service | Where | Load it |
|---|---|---|
| GitHub | `gh` CLI, OS keyring, account `ToxicMinds` | already active — just use `gh` |
| Vercel | `~/.config/recompos/vercel.env` (mode 600) | `set -a; . ~/.config/recompos/vercel.env; set +a` |
| Supabase | `~/.config/recompos/supabase.env` (mode 600) | `set -a; . ~/.config/recompos/supabase.env; set +a` |

`~/.config/recompos/` is the wall: it holds RecompOS credentials and nothing else, it is
outside the repo, and it is mode 600. **Secrets never go in this file, in the memory
directory, or anywhere under the repo** — `ToxicMinds/schedule` is a public repo.

Verify access without printing values:
```sh
gh auth status
set -a; . ~/.config/recompos/vercel.env;   set +a; vercel whoami --token "$VERCEL_TOKEN"
set -a; . ~/.config/recompos/supabase.env; set +a; \
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF"   # expect 200
```

## Layout

`svelte-recomp/` is the live app; `supabase/` holds migrations and edge functions. The old
vanilla JS version and `watch-bridge/` were deleted on 2026-10-17 (both in git history).
The `gh-pages` branch is now a single redirect page to `moderly.vercel.app` (the token
can't switch Pages off); the old build is in that branch's history.

## Ship model

The APK is a thin shell: `svelte-recomp/capacitor.config.json` sets `server.url` to the
live Vercel site, so the installed app loads the same build a browser does.

- **Web / UI / logic change** → deploy to Vercel. Installed apps pick it up on next
  launch. No reinstall, no APK.
- **Native change** (`AndroidManifest.xml`, Capacitor plugins, `capacitor.config.json`,
  launcher icons) → the APK must be rebuilt and installed. Pushing anything under
  `svelte-recomp/android/**` triggers `.github/workflows/build-app-apk.yml`, which
  publishes to the `recompos-app-latest` GitHub release.

Every APK is signed in CI from repository secrets, so installs are true in-place
updates (data and login survive); `ApkInstallerPlugin` gives a one-tap in-app update.
The original key leaked into this repo's history, so since build 13 every APK carries
APK Signature Scheme v3 key rotation (v1/v2 with the old key, v3 with the Moderly key and
an old -> new lineage). The workflow's `update` job installs the current release on an
Android 14 emulator, updates it to the new build, checks app data survived and that an
old-key-only APK is refused; `publish` runs only after it. Bump `versionCode` and
`LATEST_NATIVE_BUILD` together, and deploy the web only after the release is published,
or the app offers an update the release doesn't have yet.

## Deploy

```sh
cd /home/nik/schedule/svelte-recomp
set -a; . ~/.config/recompos/vercel.env; set +a
vercel --prod --yes --token "$VERCEL_TOKEN"
```

- **Never add a Vercel↔GitHub integration.** The absence of webhooks is deliberate.
  Don't offer one again.
- Use `/usr/local/bin/vercel`. `npx vercel` fails here (Node 25 vs the CLI engine range).
- Quote `"$VERCEL_TOKEN"` — unquoted trips the CLI's "contents are invalid" check.
- The live app is **`svelte-recomp.vercel.app`** (the APK's `server.url`), also served
  at **`moderly.vercel.app`** (the public name; landing page at `/about/`, guides under
  `/guides/`). `recompos.vercel.app` is NOT ours: a different Next.js "RecompOS"
  outside this Vercel account (verified 2026-10-18). Checking it after a deploy shows
  unrelated HTML and looks like a failure.
- Verify: `curl -sI https://svelte-recomp.vercel.app/ | grep -i '^age'`. A large `age`
  means the deploy didn't land.
- The `vercel` MCP tools are authed to a different account and cannot see this project.
  Same for the `supabase-prod` / `supabase-staging` MCP servers — they point at other
  refs. Never run RecompOS migrations through them.

## Before you commit

```sh
cd svelte-recomp && npm run verify
```

`verify` = `selfcheck.js` (the whole test suite, no framework) + `svelte-check` + the
build. selfcheck must print **All checks passed.** Async checks only report because of
`await Promise.all(pending)` at the end — if you ever see that line go missing, every
file-reading check is passing vacuously and the suite is lying to you. The type check is
not optional: selfcheck once passed with a reference to a variable that no longer
existed, in a branch no test reached.

## One source of truth (enforced by selfcheck)

- Weight trend, pace against the plan, learned burn, calorie and protein targets and
  intake-by-date come from `src/lib/stores/body.ts`. Never fit a weight slope, call
  `adaptiveTdee`/`weeklyMaintenance`/`resolveCalorieTarget`/`diagnoseStall`/`weekShape`
  or write `goalKg * 1.8` anywhere else.
- The calorie target is the WEEK's, in the log's own units: learned from the mean
  logged day, smoothed across Sundays, at most one 300-kcal step under the usual day.
  Never "fix" a stall by asking the user to log more completely — see
  `src/lib/adaptiveTdee.ts` (`weeklyMaintenance`) for why a consistent log is enough.
- A weigh-in is saved only through `saveWeighIn` (`src/lib/weighIn.ts`); the line and
  the plans only through `src/lib/commitments.ts`.
- The morning briefing and the evening hold are written only in `src/lib/stores/moments.ts`,
  from those same stores. Android (`MomentReceiver.java`) posts each at the first unlock
  inside its window and computes nothing about the day. Neither wakes the phone or rings:
  the user asked for no more alarms (selfcheck guards both).
- Rows that belong together (a meal, a seeded plan) go through `upsertRecords` — one
  request, all or nothing. No `for … await upsertRecord` loops.
- A table's conflict key lives in `CONFLICT` in `stores/sync.ts`; "today" comes from
  `todayDate` in `stores/refresh.ts`.

## Data isolation — read before adding a table

`stores/sync.ts` calls `supabase.from(table).select('*')` with **no `user_id` filter**.
Isolation rests entirely on RLS. Any new table must have RLS enabled and the four
`own_rows_*` policies **before** it joins the `TABLES` list, or it leaks every user's
rows into every user's local Dexie. Follow `20260727120000_recipes_custom.sql`.

Audited 2026-07-28 against a real second account: reads returned 0 rows, cross-user
insert rejected `42501`, cross-user update/delete affected 0 rows.

## Supabase notes

Project ref `jerbhsasccvjelkkphgu`. **The shell exports SUPABASE_PROJECT_REF and
SUPABASE_ACCESS_TOKEN for a different project**: always source
`~/.config/recompos/supabase.env` in the same command, and have scripts that write
assert the ref first. The anon and service_role JWTs authenticate data
calls only — service_role gets **401 from `api.supabase.com`** and cannot run migrations
or deploy functions. Only the `sbp_…` personal access token can. Edge functions live
under the **root** `supabase/functions/` — the only copy (a second copy under
`svelte-recomp/` drifted and was deleted 2026-10-16). Deploy one with:

```sh
cd /home/nik/schedule && set -a; . ~/.config/recompos/supabase.env; set +a
supabase functions deploy <name> --project-ref "$SUPABASE_PROJECT_REF"
```

Every AI call goes through `supabase/functions/_shared/llm.ts`: Gemini, then the keyless
Kilo gateway and Pollinations, hedged. Never call one Gemini model directly again — model
names get retired (2.5-flash: 404) and `-latest` aliases can take 25 s+. Each function
accepts `"only": ["kilo"]` in the body to test one fallback on its own.

Migrations: the CLI here can't list remote history without the DB password, so apply a
new file in `supabase/migrations/` through the Management API
(`POST /v1/projects/$SUPABASE_PROJECT_REF/database/query`) and insert its version into
`supabase_migrations.schema_migrations`.
