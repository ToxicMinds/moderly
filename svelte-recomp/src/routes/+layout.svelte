<script lang="ts">
  import '../app.css';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import AuthGate from '$lib/components/AuthGate.svelte';
  import { syncStatus } from '$lib/stores/sync';
  import { user, authReady, initAuth, signOut } from '$lib/stores/user';
  import { initSync, destroySync } from '$lib/stores/sync';
  import { subscribeWebPush } from '$lib/push';
  import { playAlarmMelody } from '$lib/alarmSound';
  import { initAppUpdate } from '$lib/stores/appUpdate';
  import { applySafeAreaFallback } from '$lib/safeArea';
  import { recordError } from '$lib/errorLog';
  import UpdateBadge from '$lib/components/UpdateBadge.svelte';
  import Diagnostics from '$lib/components/Diagnostics.svelte';
  import CoachToast from '$lib/components/CoachToast.svelte';
  import NativeUpdateBanner from '$lib/components/NativeUpdateBanner.svelte';
  import { resetSpoken } from '$lib/stores/toast';
  import Modal from '$lib/components/Modal.svelte';
  import { base } from '$app/paths';
  import { syncHealthConnect } from '$lib/health/healthConnect';
  import { pullToRefresh } from '$lib/actions/pullToRefresh';
  import { refreshAll, refreshing, refreshError, lastRefresh, startClock, stopClock, nowTick } from '$lib/stores/refresh';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import { liveProfile, liveProfileLoaded, liveAlarms, liveFoodLogs, liveWeights, liveWorkoutLogs, liveGoal, liveSchedule } from '$lib/stores/live';
  import { scheduleNativeAlarms, scheduleNudges, isNativeApp, hasMorning, armMorning, disarmMorning, type AlarmRow } from '$lib/nativeAlarms';
  import { briefings, briefingSetting, refreshForecast, minutesOf } from '$lib/stores/morning';
  import { situationalNudges, minutesOfDay } from '$lib/situational';
  import { todayYmd } from '$lib/date';
  import { isComplete } from '$lib/profile';
  import { setWatchBrand } from '$lib/health/healthConnect';
  import { todayVerdict } from '$lib/stores/verdict';
  import { body } from '$lib/stores/body';
  import { initHaptics, hapticsEnabled, setHapticsEnabled, haptic } from '$lib/haptics';

  let { children }: { children: import('svelte').Snippet } = $props();
  let crashMsg = $state<string | null>(null);
  let menuOpen = $state(false);
  let syncStarted = false;

  // — Verdict light —
  // Tie a faint wash from the top edge to how the recomposition is actually
  // going, like the spill from a scoreboard: green on a dialed-in day, red
  // when it's off track. The verdict is shared (see stores/verdict), so this
  // colour follows you across every page, not just Today. Kept low-alpha so it
  // reads as atmosphere, never as chrome.
  $effect(() => {
    const tone = $todayVerdict.tone;
    const aura = tone === 'good' ? 'rgba(49,242,138,.10)'
      : tone === 'ok' ? 'rgba(77,163,255,.09)'
      : tone === 'warn' ? 'rgba(255,176,32,.09)'
      : tone === 'bad' ? 'rgba(255,59,71,.10)'
      : 'transparent';
    document.documentElement.style.setProperty('--aura', aura);
  });

  // — Pull to refresh —
  // An installed app has no reload button, so the drag-down gesture is the
  // reload. It refreshes EVERYTHING that can be stale in one go: every synced
  // table from Supabase, the watch's steps/sleep/heart-rate/workouts from
  // Health Connect, and the clock that muscle recovery and readiness are
  // measured against.
  let pull = $state(0);
  const PULL_THRESHOLD = 72;
  const pullPct = $derived(Math.min(1, pull / PULL_THRESHOLD));
  // Fire a single confident thump the instant the drag crosses the release
  // threshold — the physical "you've armed the refresh" confirmation that a
  // pure-visual gesture was missing. Re-arms once the finger relaxes back.
  let pullArmed = false;
  function onPull(px: number) {
    pull = px;
    if (px >= PULL_THRESHOLD && !pullArmed) {
      pullArmed = true;
      haptic('impact');
    } else if (px < PULL_THRESHOLD - 8) {
      pullArmed = false;
    }
  }

  async function doRefresh() {
    await refreshAll($user?.id ?? null);
  }

  // Keep time-derived screens (muscle recovery, "3h ago", readiness) honest
  // while the app sits open for days.
  $effect(() => {
    startClock();
    return stopClock;
  });

  function refreshLabel(): string {
    if ($refreshing) return 'Refreshing everything…';
    if (pullPct >= 1) return 'Release to refresh';
    return 'Pull to refresh';
  }

  // — First-run setup —
  // Height, age and sex used to be unsaved component state, and the goal weight
  // was a constant compiled into the bundle. Without them the calorie engine
  // can't run at all, so a new user is asked once, up front. Gated on
  // profileLoaded so the form never flashes before user_settings arrives.
  const _profile = liveProfile();
  const _profileLoaded = liveProfileLoaded();
  let onboardingDone = $state(false);
  const needsOnboarding = $derived(
    $_profileLoaded && !onboardingDone && !isComplete($_profile)
  );

  // The wearable brand is stored in the profile so it follows the user across
  // devices, but the health sync reads it synchronously from localStorage —
  // mirror it whenever the profile arrives.
  $effect(() => {
    const brand = $_profile?.watch_brand;
    if (brand) setWatchBrand(brand);
  });

  $effect(() => {
    initAuth();
  });

  $effect(() => {
    const u = $user;
    if (u && !syncStarted) {
      syncStarted = true;
      initSync(u.id);
      subscribeWebPush(u.id);
      // Native Android shell only: pull OnePlus Watch data from Health Connect
      // into the app. No-ops in the browser/PWA.
      syncHealthConnect(u.id);
    } else if (!u && syncStarted) {
      syncStarted = false;
      destroySync();
      resetSpoken();
    }
  });

  // ── EXPORT ────────────────────────────────────────────────────────────────
  // Straight from the local Dexie mirror, which RLS already guarantees holds
  // only this user's rows — so the export can never contain anyone else's data
  // even if a future table forgets a filter.
  let exporting = $state('');
  let exportMsg = $state('');

  async function exportData(format: 'json' | 'csv') {
    if (exporting) return;
    const uid = $user?.id;
    if (!uid) { exportMsg = 'Sign in first.'; return; }
    exporting = format;
    exportMsg = '';
    try {
      const [{ buildBundle, toCsv, exportFilename, summariseBundle, EXPORT_TABLES }, { deliverFile, deliveryMessage }, dbMod] =
        await Promise.all([import('$lib/exportData'), import('$lib/shareFile'), import('$lib/db/dexie')]);
      const db = dbMod.default;

      const tables: Record<string, unknown[]> = {};
      for (const t of EXPORT_TABLES) {
        try { tables[t] = await db.table(t).toArray(); }
        catch { tables[t] = []; } // a table this client hasn't created yet
      }
      const bundle = buildBundle(uid, tables);

      let filename: string;
      let contents: string;
      let mime: string;
      if (format === 'json') {
        filename = exportFilename('json');
        contents = JSON.stringify(bundle, null, 2);
        mime = 'application/json';
      } else {
        // One CSV would need one shared column set across 16 unrelated tables.
        // A labelled multi-section file opens fine in Sheets/Excel and keeps
        // every column meaningful.
        filename = exportFilename('csv');
        contents = EXPORT_TABLES
          .filter((t) => (bundle.tables[t] as unknown[]).length > 0)
          .map((t) => `# ${t}\n${toCsv(bundle.tables[t] as Array<Record<string, unknown>>)}`)
          .join('\n\n');
        mime = 'text/csv';
      }

      const res = await deliverFile(filename, contents, mime);
      exportMsg = res.method === 'failed'
        ? deliveryMessage(res)
        : `${summariseBundle(bundle)} ${deliveryMessage(res)}`;
    } catch (e: any) {
      exportMsg = 'Export failed: ' + (e?.message || String(e)).slice(0, 120);
      recordError('Export failed: ' + (e?.message || String(e)), { kind: 'error' });
    } finally {
      exporting = '';
    }
  }

  // Alarms have to be armed from the app SHELL, not from the Alarms page. They were
  // only ever scheduled inside that page's save/toggle/delete handlers, so an alarm
  // created on another device — or simply a phone that rebooted — was never armed
  // until you happened to open that screen and edit something. Re-arming on every
  // change to the synced alarm list covers launch, realtime push, and pull-refresh
  // in one place. Android replaces by notification id, so re-arming is idempotent.
  const _alarms = liveAlarms();
  $effect(() => {
    const rows = $_alarms as AlarmRow[];
    if (!$user || !isNativeApp() || rows.length === 0) return;
    scheduleNativeAlarms(rows);
  });

  // ── SITUATIONAL NUDGES ────────────────────────────────────────────────────
  // The alarms that know something. Re-armed on every change to today's data,
  // which is what keeps them honest: hit your protein at 18:50 and the 19:00
  // "40g to go" message is cancelled before it can fire. That works because
  // every fact these describe can only change by typing it into this app.
  const _nudgeFood = liveFoodLogs();
  const _nudgeWeights = liveWeights();
  const _nudgeWorkouts = liveWorkoutLogs();
  const _nudgeGoal = liveGoal();
  const _nudgeSchedule = liveSchedule();

  // ── MORNING BRIEFING ──────────────────────────────────────────────────────
  // Android posts it at the first unlock after the morning time; all this does
  // is keep today's and tomorrow's text current there (see stores/morning).
  // Old APKs have no Morning plugin: then nothing here runs, and nothing asks
  // for a location that build can't grant.
  let morningReady = $state(false);
  $effect(() => { if ($user && isNativeApp()) hasMorning().then((v) => (morningReady = v)); });
  const briefingOn = $derived(morningReady && !!$briefingSetting?.on);
  $effect(() => {
    if (!briefingOn) return;
    void $nowTick; // the forecast is reused while under an hour old
    refreshForecast();
  });
  $effect(() => {
    if (!$user || !morningReady || !$_profileLoaded) return;
    if (!$briefingSetting?.on) { disarmMorning(); return; }
    armMorning(minutesOf($briefingSetting.after), $briefings);
  });

  $effect(() => {
    if (!$user || !isNativeApp()) return;
    const now = new Date($nowTick);
    const today = todayYmd();

    const todayFood = ($_nudgeFood as any[]).filter((f) => f.date === today);
    const goalKg = ($_nudgeGoal as number | null) ?? null;
    const weightDates = ($_nudgeWeights as any[]).map((w) => w.date).sort();
    const lastWeigh = weightDates.length ? weightDates[weightDates.length - 1] : null;
    const daysSinceWeighIn = lastWeigh
      ? Math.round((Date.parse(today) - Date.parse(lastWeigh)) / 86400000)
      : null;

    const dow = now.getDay();
    const scheduledToday = ($_nudgeSchedule as any[]).find((s) => s.day_of_week === dow);

    scheduleNudges(situationalNudges({
      nowMinutes: minutesOfDay(now),
      proteinG: todayFood.reduce((s, f) => s + (f.protein_g || 0), 0),
      proteinTargetG: goalKg ? $body.proteinTargetG : null,
      kcal: todayFood.reduce((s, f) => s + (f.kcal || 0), 0),
      kcalTargetKcal: null,
      foodEntriesToday: todayFood.length,
      isTrainingDay: !!scheduledToday?.time,
      workoutLoggedToday: ($_nudgeWorkouts as any[]).some((w) => w.date === today),
      plans: ($_profile as any)?.plans ?? null,
      dow,
      badmintonDay: /badminton/i.test(`${scheduledToday?.label ?? ''} ${scheduledToday?.note ?? ''}`),
      daysSinceWeighIn,
      briefing: briefingOn,
    }), now);
  });

  // Global safety net: catch any error that escapes normal event handlers or
  // async code (these never trigger <svelte:boundary>, which only catches
  // errors thrown *during rendering*). Without this, an uncaught error here
  // just silently swallows a button tap with no feedback — which reads to a
  // user as "the app crashed/froze". Surface it instead of hiding it.
  $effect(() => {
    function onError(e: ErrorEvent) {
      console.error('Uncaught error:', e.error || e.message);
      crashMsg = (e.error?.message || e.message || 'Unknown error').slice(0, 200);
      // Persist it. Until this existed, every error the user hit vanished on
      // reload and the only debugging protocol was "screenshot it next time".
      recordError(e.error?.message || e.message, { stack: e.error?.stack, kind: 'error' });
    }
    function onRejection(e: PromiseRejectionEvent) {
      console.error('Unhandled rejection:', e.reason);
      crashMsg = (e.reason?.message || String(e.reason) || 'Unknown error').slice(0, 200);
      recordError(e.reason?.message || String(e.reason), {
        stack: e.reason?.stack, kind: 'unhandledrejection',
      });
    }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  });

  // Register the service worker for real (it previously existed on disk but
  // was never registered anywhere, so offline caching + push never actually
  // worked). The SW activates aggressively (skipWaiting + claim, see
  // service-worker.ts) specifically so that closing and reopening the PWA
  // always picks up whatever is currently deployed -- a fresh app open
  // always fetches fresh HTML referencing the current build, so there's no
  // stale-chunk risk on a normal close/reopen.
  //
  // IMPORTANT: do NOT react to 'controllerchange' here by reloading the
  // page. skipWaiting()+clients.claim() fire routinely (essentially on
  // every registration/activation cycle, not only on genuine version
  // bumps), so listening for that event and calling location.reload()
  // causes a real, observed infinite reload loop: reload -> fresh
  // registration -> claim fires again -> controllerchange -> reload ->
  // forever. This was tried and reverted after being caught by a
  // Playwright test. If a "force refresh on update" feature is wanted
  // again later, it must be built around a genuinely new *waiting*
  // worker (reg.waiting after an update() call) with a manual,
  // user-triggered "Update available" tap -- never an automatic reload
  // driven by the ambient controllerchange event.
  $effect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).catch((e) => {
      console.error('SW registration failed:', e);
    });
    // Watch for new deploys and drive the top-bar update badge.
    initAppUpdate();
  });

  // Android draws the app under the status bar (forced edge-to-edge on
  // targetSdk 35+) but its WebView reports no safe-area inset, which put the
  // top bar — and the Update button — behind the camera cutout.
  $effect(() => {
    applySafeAreaFallback();
  });

  // Plays a short synthesized melody (see $lib/alarmSound.ts) whenever
  // the service worker tells us an alarm just fired -- the system
  // notification's own sound is a short, generic ping with no way to
  // attach a custom sound file via the Web Notification API, so this
  // gives a fuller "this is an alarm, not just a ping" experience
  // whenever the app is actually open (foreground/background tab) or
  // gets opened by tapping the notification.
  $effect(() => {
    if (!('serviceWorker' in navigator)) return;
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'PLAY_ALARM_SOUND') playAlarmMelody();
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  });

  $effect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  });

  // — Haptics —
  // Load the saved on/off preference at boot. Mirrored into reactive state so
  // the Settings toggle reflects and updates it live.
  let haptics = $state(true);
  $effect(() => {
    initHaptics();
    haptics = hapticsEnabled();
  });
  function toggleHaptics() {
    haptics = !haptics;
    setHapticsEnabled(haptics);
    if (haptics) haptic('success'); // let them feel what they just turned on
  }

  function toggleTheme() {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    html.toggleAttribute('data-theme', !isLight);
    localStorage.setItem('theme', isLight ? 'dark' : 'light');
  }

  // — Text size —
  // The complaint was simply "the font is WAY too small". Every font-size in
  // the app is a rem, so one number on <html> moves all of them at once; the
  // layout is flex/grid throughout and reflows around the larger text. The
  // three explicit steps now live in the Settings sheet (⋯) as A / A⁺ / A⁺⁺.
  // The applied value is read back from the DOM, so this stays in sync with
  // the pre-paint script in app.html rather than keeping a second copy of it.
  const UI_SCALES = [1, 1.15, 1.3];
  let uiScale = $state(1);
  $effect(() => {
    const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
    if (s >= 1 && s <= 1.4) uiScale = s;
  });

  function setTextSize(s: number) {
    uiScale = s;
    document.documentElement.style.setProperty('--ui-scale', String(s));
    try { localStorage.setItem('uiScale', String(s)); } catch { /* storage disabled */ }
  }
</script>

<div id="app">
  {#if !$authReady}
    <div style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>
  {:else if !$user}
    <AuthGate />
  {:else if needsOnboarding}
    <div id="topbar">
      <div id="topbar-title">RecompOS</div>
      <div class="flex ac gap2">
        <Diagnostics />
        <button class="icn-btn" onclick={signOut} title="Sign out">⎋</button>
      </div>
    </div>
    <main id="pages">
      <!-- Escape hatch. If an existing user's profile hasn't reached this device
           yet, they'd otherwise be stuck staring at first-run setup with no way
           to say "no, I already have an account". Re-pulling from the server
           usually clears it outright. -->
      <button class="ob-recover" onclick={doRefresh} disabled={$refreshing}>
        {$refreshing ? 'Checking…' : 'Already have an account? Re-check my data →'}
      </button>
      <Onboarding onDone={() => (onboardingDone = true)} />
    </main>
  {:else}
  <div id="topbar">
    <div class="flex ac gap2">
      <div id="topbar-title">RecompOS</div>
      <div id="sync-dot"
        class:synced={$syncStatus === 'synced'}
        class:syncing={$syncStatus === 'syncing'}
        class:error={$syncStatus === 'error'}
        title={$syncStatus}
      ></div>
    </div>
    <div class="flex ac gap2">
      <UpdateBadge />
      <!-- The readiness score used to sit here as a second, unexplained number
           next to the Pulse score — two figures, neither showing its working,
           and no hint that one is a WEIGHTED INPUT to the other. It now appears
           as the "Recovery" row inside the Pulse breakdown, which is what it
           actually is. Full sleep/heart-rate detail is one tap further in. -->
      <a class="icn-btn" href="{base}/alarms" title="Alarms & reminders" aria-label="Alarms and reminders"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0"/></svg></a>
      <Diagnostics />
      <button class="icn-btn" onclick={() => (menuOpen = true)} title="More" aria-label="More options">⋯</button>
    </div>
  </div>

  <Modal open={menuOpen} onclose={() => (menuOpen = false)}>
    <div class="menu-h">Settings</div>
    <div class="menu-row">
      <span class="menu-lbl">Text size</span>
      <div class="menu-sizes">
        {#each UI_SCALES as s, i}
          <button class="menu-size" class:on={Math.abs(s - uiScale) < 0.01} onclick={() => setTextSize(s)}>{['A','A⁺','A⁺⁺'][i]}</button>
        {/each}
      </div>
    </div>
    <button class="menu-item" onclick={toggleTheme}>
      <span>Theme</span><span class="menu-val">☀️ / 🌙</span>
    </button>
    <button class="menu-item" onclick={toggleHaptics}>
      <span>Haptics</span><span class="menu-val">{haptics ? 'On 📳' : 'Off'}</span>
    </button>
    <!-- Your data is yours. Everything the account owns, in one tap, in a format
         a spreadsheet or another app can actually read. -->
    <button class="menu-item" onclick={() => exportData('json')} disabled={!!exporting}>
      <span>Export my data</span>
      <span class="menu-val">{exporting === 'json' ? '…' : 'JSON'}</span>
    </button>
    <button class="menu-item" onclick={() => exportData('csv')} disabled={!!exporting}>
      <span>Export as spreadsheet</span>
      <span class="menu-val">{exporting === 'csv' ? '…' : 'CSV'}</span>
    </button>
    {#if exportMsg}<div class="menu-note">{exportMsg}</div>{/if}
    <button class="menu-item danger" onclick={signOut}>
      <span>Sign out</span><span class="menu-val">⎋</span>
    </button>
  </Modal>

  <div id="ptr" style="height:{pull}px" class:active={$refreshing}>
    <div class="ptr-inner" style="opacity:{Math.min(1, pull / 24)}">
      <span class="ptr-spin" class:spinning={$refreshing} style="transform:rotate({pullPct * 270}deg)">↻</span>
      <span class="ptr-text">{refreshLabel()}</span>
    </div>
  </div>

  <main
    id="pages"
    use:pullToRefresh={{
      onRefresh: doRefresh,
      onPull,
      threshold: PULL_THRESHOLD,
      enabled: !$refreshing
    }}
  >
    <svelte:boundary onerror={(e) => { console.error('Render error:', e); crashMsg = (e as any)?.message || String(e); recordError((e as any)?.message || String(e), { stack: (e as any)?.stack, kind: 'render' }); }}>
      {@render children()}
      {#snippet failed(error, reset)}
        <div class="crash-box">
          <div style="font-size:2rem;margin-bottom:8px">⚠️</div>
          <div style="font-weight:700;color:var(--text);margin-bottom:6px">Something broke on this screen</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-bottom:14px;word-break:break-word">{String((error as any)?.message || error)}</div>
          <button class="btn bp bfl" onclick={() => { crashMsg = null; reset(); }}>Try again</button>
          <button class="btn bg_ bfl" style="margin-top:8px" onclick={() => location.assign('/')}>Go to Today</button>
        </div>
      {/snippet}
    </svelte:boundary>
  </main>

  {#if $refreshError}
    <div class="crash-toast" role="alert" style="background:var(--amber);color:#111">
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{$refreshError}</div>
      <button style="color:#111" onclick={() => refreshError.set(null)}>&times;</button>
    </div>
  {/if}

  {#if crashMsg}
    <div class="crash-toast" role="alert">
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{crashMsg}</div>
      <button onclick={() => crashMsg = null}>&times;</button>
    </div>
  {/if}

  <BottomNav />
  <CoachToast />
  <NativeUpdateBanner />
  {/if}
</div>

<style>
#topbar{background:var(--bg);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:calc(var(--st) + 10px) 18px 12px;min-height:calc(var(--st) + var(--top-h));z-index:50;flex-shrink:0}
#topbar-title{font-family:var(--font-display);font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;line-height:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* The topbar is chrome, so it is pinned in px and does NOT follow --ui-scale.
     At the largest text size a scaled brand mark plus the buttons is wider than
     a 360px phone, and what gets pushed off the edge is Sign out and the
     text-size control itself — i.e. you could make the text big enough that you
     could no longer make it small again. Pin the topbar and let buttons shrink. */
  .icn-btn{width:36px;height:36px;flex-shrink:0;border-radius:var(--r-sm);border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s var(--ease);font-size:16px;text-decoration:none}
.icn-btn:active{transform:scale(.9);border-color:var(--text)}
  .icn-btn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .menu-h{font-family:var(--font-display);font-size:1.5rem;font-weight:800;text-transform:uppercase;color:var(--text);margin-bottom:14px;letter-spacing:.01em}
  .menu-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)}
  .menu-lbl{font-size:0.9375rem;font-weight:700;color:var(--text)}
  .menu-sizes{display:flex;gap:6px}
  .menu-size{width:42px;height:36px;border-radius:var(--r-sm);border:1px solid var(--border2);background:var(--bg3);color:var(--muted);font-weight:800;cursor:pointer;font-family:inherit}
  .menu-size.on{background:var(--text);color:var(--bg);border-color:transparent}
  .menu-item{display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;padding:14px 0;border:none;border-bottom:1px solid var(--border);background:none;color:var(--text);font-size:0.9375rem;font-weight:700;cursor:pointer;font-family:inherit}
  .menu-item .menu-val{color:var(--muted);font-weight:600}
  .menu-item.danger{color:var(--red);border-bottom:none}
  .menu-item:disabled{opacity:.55}
  /* Says what actually left the app and where it went — an export you can't
     confirm is an export you don't trust. */
  .menu-note{font-size:0.6875rem;line-height:1.45;color:var(--muted);padding:8px 0 2px}
#pages{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px 16px calc(var(--nav-h) + 28px + var(--sb));overscroll-behavior-y:contain}
  /* Pull-to-refresh indicator: a zero-height strip above the scroll area that
     grows with the drag, so the content moves down with the finger. */
  #ptr{flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg2);transition:height .25s var(--ease)}
  #ptr.active{transition:none}
  .ptr-inner{display:flex;align-items:center;gap:8px;font-size:0.7188rem;font-weight:700;color:var(--amber);white-space:nowrap}
  .ptr-spin{display:inline-block;font-size:0.9375rem;line-height:1}
  .ptr-spin.spinning{animation:ptr-rot .8s linear infinite}
  @keyframes ptr-rot{to{transform:rotate(360deg)}}
  .ptr-text{letter-spacing:.2px}
#sync-dot{width:7px;height:7px;border-radius:50%;background:var(--border2);margin-left:4px;flex-shrink:0;transition:background .4s}
  #sync-dot.synced{background:var(--led-good);box-shadow:0 0 6px color-mix(in srgb,var(--led-good) 60%,transparent)}
  #sync-dot.syncing{background:var(--led-warn);animation:pulse 1s infinite}
  #sync-dot.error{background:var(--led-bad);box-shadow:0 0 6px color-mix(in srgb,var(--led-bad) 60%,transparent)}
  #app{display:flex;flex-direction:column;height:100vh;height:100dvh}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  #pages > :global(*){animation:fadeUp .35s var(--ease)}
  .ob-recover{display:block;width:100%;max-width:460px;margin:0 auto 4px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--amber);font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit}
  .ob-recover:disabled{opacity:.6}
  .crash-box{text-align:center;padding:40px 20px}
  .crash-toast{position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h) + var(--sb) + 12px);z-index:100;background:var(--red);color:#fff;font-size:0.75rem;font-weight:600;padding:10px 12px;border-radius:12px;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
  .crash-toast button{background:none;border:none;color:#fff;font-size:1.125rem;line-height:1;cursor:pointer;opacity:.8}
</style>
