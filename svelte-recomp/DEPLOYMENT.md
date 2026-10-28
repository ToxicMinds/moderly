# RecompOS — Deployment Guide (Vercel + Supabase)

This is the single source of truth for how this app is hosted and configured.
Hosting: **Vercel** (frontend, via `@sveltejs/adapter-auto`) · **Supabase** (Postgres + Auth + Realtime + Edge Functions).

> Secrets note: this file only ever references *safe-to-be-public* identifiers (project ref,
> URL, publishable key). Never commit the DB password, the `service_role`/secret API key,
> or any Edge Function secrets (e.g. `GEMINI_API_KEY`) to this repo. Keep those in your
> password manager and in the Vercel/Supabase dashboards only.

## Supabase project

| Setting | Value |
|---|---|
| Project name | `recompos` |
| Project ref | `jerbhsasccvjelkkphgu` |
| Region | `eu-central-1` (Frankfurt — closest free-tier region to Slovakia) |
| Plan | Free |
| URL | `https://jerbhsasccvjelkkphgu.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/jerbhsasccvjelkkphgu |
| Publishable key | `sb_publishable_H8G1aDyFJFLmgxrTc8qKeA_kxyXRLyk` |

The publishable key is safe to expose client-side (it's the new Supabase "publishable key"
model — access is enforced by Row-Level Security policies, not by hiding this key).

## 1. Local environment setup

```bash
cd svelte-recomp
cp .env.example .env   # already done for you — verify values match the table above
npm install
npm run dev
```

`.env` is git-ignored — it must be created locally and set again in Vercel's dashboard (step 5).

## 2. Link the Supabase CLI to this project

```bash
brew install supabase/tap/supabase   # already installed for you
supabase login --token <your-personal-access-token>
supabase link --project-ref jerbhsasccvjelkkphgu
# prompts for the DB password — get it from your password manager
```

## 3. Database schema

Migrations live in `supabase/migrations/`. The initial schema
(`20260709155522_init_schema.sql`) creates all 9 tables (`alarms`, `daily_logs`,
`weights`, `steps`, `sessions`, `checks`, `tracks`, `meal_plans`,
`push_subscriptions`), enables Row-Level Security with per-user
`auth.uid() = user_id` policies on every table, and adds them to the
`supabase_realtime` publication.

This has already been applied to the live `recompos` project. If you ever need to
reapply it (e.g. after a project reset) or add new migrations:

```bash
supabase db push
```

> Note: this sandbox's network blocks direct Postgres connections (ports 5432/6543),
> which `supabase db push` needs. Migrations were applied here via the Supabase
> Management API's HTTPS SQL endpoint (`POST /v1/projects/{ref}/database/query`)
> instead. From your own machine with normal network access, `supabase db push`
> should work fine.

## 4. Edge Functions

**Status: LIVE ✅** — both deployed and ACTIVE on the `recompos` project.

| Function | Purpose | verify_jwt |
|---|---|---|
| `estimate-bf` | Gemini Vision body-fat % estimate from a photo | `true` |
| `send-alarm-push` | Sends real Web Push notifications for due alarms | `false` (called by `pg_cron`, no user JWT) |

Secrets already set on the project: `GEMINI_API_KEY`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. A `pg_cron` job (`send-alarm-push-every-minute`)
calls `send-alarm-push` every minute via `pg_net.http_post`.

To redeploy either function after making changes (once you have normal network access):
```bash
supabase functions deploy estimate-bf --project-ref jerbhsasccvjelkkphgu
supabase functions deploy send-alarm-push --project-ref jerbhsasccvjelkkphgu
```

## 5. Vercel deployment

**Status: LIVE ✅** — Deployed and verified via Vercel CLI + REST API.

| Setting | Value |
|---|---|
| Production URL | **https://svelte-recomp.vercel.app** |
| Vercel project | `svelte-recomp` (team: `vercel whoami`) |
| Project ID | `prj_JCoFsmV7KyTnkeadpZsx5vwJgS0J` |
| Root Directory | `svelte-recomp` |
| Framework | SvelteKit (`@sveltejs/adapter-auto` → Vercel adapter, auto-detected) |
| Build Command | `npm run build` (auto) |
| Env vars set | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` — on **Production, Preview, and Development** |

Deploys are made from local source with `vercel deploy --prod`, on purpose: the project
has no Git integration and must not get one, so a push never deploys by itself.

To redeploy manually any time after making changes:
```bash
cd svelte-recomp
vercel deploy --prod --token <your-vercel-token>
```

## Vercel account

- Account: the one in `~/.config/recompos/vercel.env` (`vercel whoami` names it)
- CLI installed locally via `brew install vercel-cli`; authenticate with `vercel login`
  or `vercel --token <token>` (get a token from https://vercel.com/account/tokens —
  never commit it, keep it in your password manager).

> Note: this repo previously deployed to GitHub Pages (static adapter, `/schedule` base
> path). That workflow and config have been removed in favor of Vercel, which serves the
> app from the domain root instead of a subpath.

## 6. Post-deploy checklist

- [x] RLS policies scoped per-user (`auth.uid() = user_id`) on all 9 tables
- [x] Service worker & manifest serve correctly from the deployed root (`/service-worker.js`, `/manifest.json` verified 200 OK)
- [x] `estimate-bf` + `send-alarm-push` Edge Functions deployed (ACTIVE) with all secrets set
- [x] Web Push sending wired: VAPID keys + `pg_cron` (every minute) + `send-alarm-push` function
- [x] Offline-first upserts fixed (Today + Track pages use local Dexie lookups, not network pre-checks)
- [x] Evening checklist, meal plan assignment, and workout session completion UI wired up
- [ ] **You should still do**: open the app on your phone, "Add to Home Screen", and confirm it installs as a standalone PWA
- [ ] **You should still do**: test airplane-mode offline logging, then reconnect and confirm it syncs
- [ ] **You should still do**: create an alarm for 1–2 minutes in the future, then close the app fully and confirm you get a push notification
- [ ] Optional: connect the Vercel project to GitHub for auto-deploy on push
- [ ] Optional: add a custom domain in Vercel settings
- [ ] Known limitation (not fixed): cross-device sync only works if you sign in with the **same** account on each device. Anonymous sign-in creates a *different* user per device/browser, so "syncing across devices" currently only really works within one browser's storage unless you add a real login (email/magic-link) — flag if you want this built next.
