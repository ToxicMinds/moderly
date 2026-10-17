<script lang="ts">
  // Daily readiness score card (Oura/WHOOP-style, no wearable needed).
  // Manual inputs: sleep hours, sleep quality (1-5), resting HR, HRV
  // (optional -- most people won't have this without a wearable, but
  // some fitness watches/apps expose it and the formula uses it if
  // present). See $lib/readiness.ts for the scoring formula + citations.
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveBiometrics } from '$lib/stores/live';
  import { computeReadiness } from '$lib/readiness';
  import { signalFreshness, latestDate } from '$lib/freshness';
  import { healthConnect, syncHealthConnect, openHealthConnectSettings, setPreferredSource } from '$lib/health/healthConnect';
  import { buildHealthStatus, statusGlyph } from '$lib/health/status';
  import { sourceLabel, setupHelp, brandById } from '$lib/health/watches';
  import { todayYmd } from '$lib/date';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let { bare = false }: { bare?: boolean } = $props();

  const hc = healthConnect;
  function agoLabel(iso: string | null): string {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
  // Manual tap = an explicit "sync everything now" — force:true re-requests any
  // permissions not yet granted (e.g. Exercise after you first only allowed
  // steps/sleep) so a freshly-played badminton session can actually come in.
  // The silent auto-sync on launch stays force:false so it never nags.
  async function resync() { if (uid) await syncHealthConnect(uid, { force: true }); }

  // Per-signal breakdown of what the watch is ACTUALLY feeding in — so "why do
  // I only see steps?" has a concrete, honest answer instead of a vague badge.
  const signalStatus = $derived(buildHealthStatus($hc.grantedPerms, $hc.lastResult));
  const showDiagnostics = $derived($hc.native || $hc.grantedPerms != null);
  const anyBlocked = $derived(signalStatus.some((s) => s.state === 'not-granted'));

  // Android stops showing the Health Connect permission dialog once you've
  // answered it, so an in-app "allow" button can be a silent no-op forever.
  // Deep-linking to the Health Connect settings screen is the only reliable way
  // back — that's where a permission you declined earlier can be switched on.
  let openingSettings = $state(false);
  async function openSettings() {
    openingSettings = true;
    try {
      const ok = await openHealthConnectSettings();
      if (!ok) saveMsg = 'Could not open Health Connect. Open it from your app drawer → Apps → RecompOS.';
    } finally {
      openingSettings = false;
    }
  }

  // More than one app writes the same signal into Health Connect (your phone
  // counts steps, and OHealth mirrors the watch's). Summing them was why the
  // numbers never matched — we now trust ONE source, and show which, because a
  // silently-chosen source is just a different kind of wrong number.
  const multiSource = $derived($hc.sources.length > 1);

  // "Allowed, but nothing arrived" is nearly always the switch inside the
  // WATCH'S OWN app being off — and that switch is in a different place for
  // every brand. Generic advice is useless here, so show theirs.
  const noDataYet = $derived(signalStatus.some((s) => s.state === 'granted-no-data'));
  const help = $derived(setupHelp($hc.watchBrand));
  const brandName = $derived(brandById($hc.watchBrand)?.name ?? 'your watch');
  let showHelp = $state(false);
  async function pinSource(pkg: string) {
    setPreferredSource(pkg);
    if (uid) await syncHealthConnect(uid);
  }

  const today = todayYmd();
  const _bio = liveBiometrics();

  const todayEntry = $derived($_bio.find((b: any) => b.date === today));
  const recentHistory = $derived($_bio.filter((b: any) => b.date < today).slice(-14));
  const readiness = $derived(computeReadiness(todayEntry, recentHistory));

  // Honesty about the sleep the score is (or isn't) built on. If the watch
  // wasn't worn last night there's no entry for today — say so plainly instead
  // of letting an older night masquerade as "last night".
  const sleepFresh = $derived(signalFreshness(
    latestDate($_bio as any[], (b: any) => b.sleep_hours != null),
    today,
    { zeroLabel: 'Last night', missingLabel: 'No sleep logged yet', freshWithinDays: 0 }
  ));

  let editing = $state(false);
  let sleepHours = $state('');
  let sleepQuality = $state('3');
  let restingHr = $state('');
  let hrv = $state('');
  let saveMsg = $state('');

  function startEdit() {
    sleepHours = todayEntry?.sleep_hours != null ? String(todayEntry.sleep_hours) : '';
    sleepQuality = todayEntry?.sleep_quality != null ? String(todayEntry.sleep_quality) : '3';
    restingHr = todayEntry?.resting_hr != null ? String(todayEntry.resting_hr) : '';
    hrv = todayEntry?.hrv != null ? String(todayEntry.hrv) : '';
    editing = true;
  }

  async function save() {
    if (!uid) return;
    try {
      await upsertRecord('biometrics', {
        user_id: uid, date: today,
        sleep_hours: sleepHours ? parseFloat(sleepHours) : null,
        sleep_quality: sleepQuality ? parseInt(sleepQuality, 10) : null,
        resting_hr: restingHr ? parseInt(restingHr, 10) : null,
        hrv: hrv ? parseFloat(hrv) : null,
        updated_at: new Date().toISOString(),
      });
      editing = false;
      saveMsg = 'Saved ✓';
      setTimeout(() => saveMsg = '', 2000);
    } catch (e: any) {
      saveMsg = 'Save failed: ' + (e?.message || String(e));
    }
  }
</script>

<div class={bare ? 'ready-bare' : 'card'}>
  <div class="flex jb ac" style="margin-bottom:4px">
    <div class="card-lbl" style="margin-bottom:0">Daily Readiness</div>
    <span class="edit-link" onclick={startEdit} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); } }}>{todayEntry ? 'Edit ✎' : 'Log today ✎'}</span>
  </div>

  {#if editing}
    <label class="flbl" for="ready-sleep">Sleep (hours)</label>
    <input id="ready-sleep" type="number" inputmode="decimal" step="0.5" bind:value={sleepHours} placeholder="e.g. 7.5" style="margin-bottom:10px">
    <label class="flbl" for="ready-quality">Sleep quality (1-5)</label>
    <input id="ready-quality" type="range" min="1" max="5" bind:value={sleepQuality} style="margin-bottom:10px">
    <label class="flbl" for="ready-rhr">Resting heart rate (optional)</label>
    <input id="ready-rhr" type="number" inputmode="numeric" bind:value={restingHr} placeholder="e.g. 58" style="margin-bottom:10px">
    <label class="flbl" for="ready-hrv">HRV in ms (optional, if you track it)</label>
    <input id="ready-hrv" type="number" inputmode="decimal" bind:value={hrv} placeholder="e.g. 65" style="margin-bottom:10px">
    <div class="flex gap2">
      <button class="btn bg_ bfl" onclick={() => editing = false}>Cancel</button>
      <button class="btn bp bfl" onclick={save}>Save</button>
    </div>
  {:else if readiness}
    <div class="ready-row">
      <div class="ready-ring" style="--pct:{readiness.score}" class:great={readiness.label==='Great'} class:good={readiness.label==='Good'} class:fair={readiness.label==='Fair'} class:low={readiness.label==='Low'}>
        <span>{readiness.score}</span>
      </div>
      <div class="f1">
        <div class="ready-label">{readiness.label}</div>
        {#each readiness.factors as f}<div class="ready-factor">{f}</div>{/each}
      </div>
    </div>
  {:else}
    <div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:8px 0">Log sleep/HR to see your readiness score.</div>
  {/if}
  {#if !editing && sleepFresh.state !== 'fresh'}
    <div class="sleep-fresh" class:missing={sleepFresh.state === 'missing'}>
      🌙 {sleepFresh.state === 'missing' ? sleepFresh.label : `Last sleep: ${sleepFresh.label}`} —
      {sleepFresh.state === 'missing' ? "readiness needs last night's sleep." : "not last night, so it isn't counted here."}
    </div>
  {/if}
  {#if saveMsg}
    <div style="font-size:0.75rem;text-align:center;margin-top:6px;color:{saveMsg.startsWith('Save failed') ? 'var(--red)' : 'var(--green)'}">{saveMsg}</div>
  {/if}

  {#if $hc.native || $hc.lastSync}
    <div class="watch-src">
      <span class="f1">
        ⌚ From your OnePlus watch{#if $hc.lastSync}{' · '}synced {agoLabel($hc.lastSync)}{/if}
        <br><span class="watch-detail">Steps &amp; sleep → today's coaching · sleep + heart rate → this readiness score · workouts → activity feed{#if $hc.lastResult}{' · '}{$hc.lastResult.sleep}d sleep · {$hc.lastResult.hr}d HR{#if $hc.lastResult.workouts}{' · '}{$hc.lastResult.workouts} workout{$hc.lastResult.workouts === 1 ? '' : 's'}{/if}{/if}</span>
        {#if $hc.lastError}<br><span class="watch-detail" style="color:var(--red)">{$hc.lastError}</span>{/if}
      </span>
      <button class="watch-sync" onclick={resync} disabled={$hc.syncing}>{$hc.syncing ? 'Syncing…' : 'Sync'}</button>
    </div>
    {#if showDiagnostics}
      <div class="hc-diag">
        {#each signalStatus as s (s.key)}
          <div class="hc-row hc-{s.state}">
            <span class="hc-emoji">{s.emoji}</span>
            <span class="hc-name">{s.label}</span>
            <span class="hc-state">
              {statusGlyph(s.state)}
              {#if s.state === 'ok'}{s.days}d in
              {:else if s.state === 'granted-no-data'}no data yet
              {:else if s.state === 'not-granted'}not allowed
              {:else}—{/if}
            </span>
          </div>
          {#if s.hint}<div class="hc-hint">{s.hint}</div>{/if}
        {/each}
        {#if anyBlocked}
          <button class="hc-fix" onclick={openSettings} disabled={openingSettings}>
            {openingSettings ? 'Opening…' : 'Open Health Connect permissions →'}
          </button>
          <div class="hc-hint" style="margin-left:0">
            Android only shows the permission popup once. Turn the missing ones on
            here, then come back and tap Sync.
          </div>
        {/if}
        {#if noDataYet}
          <button class="hc-fix" onclick={() => (showHelp = !showHelp)}>
            {showHelp ? 'Hide setup steps' : `Nothing arriving from ${brandName}? Setup steps →`}
          </button>
          {#if showHelp}
            <div class="hc-help">
              <div class="hc-help-h">{help.title}</div>
              <ol class="hc-help-l">
                {#each help.steps as stepText}<li>{stepText}</li>{/each}
              </ol>
              {#if help.caveat}<div class="hc-help-c">{help.caveat}</div>{/if}
            </div>
          {/if}
        {/if}
        {#if multiSource}
          <div class="hc-src">
            <div class="hc-src-lbl">
              {$hc.sources.length} apps write this data. Counting them all would double
              your steps — using {$hc.activeSource ? sourceLabel($hc.activeSource) : 'the fullest source'} only.
            </div>
            <div class="hc-src-row">
              {#each $hc.sources as pkg (pkg)}
                <button class="hc-chip" class:on={pkg === $hc.activeSource} onclick={() => pinSource(pkg)}>
                  {sourceLabel(pkg)}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <div class="watch-src">
      <span class="f1">
        ⌚ Watch &amp; health data
        <br><span class="watch-detail">Steps &amp; sleep → today's coaching · sleep + heart rate → this readiness score. Auto-sync from your OnePlus watch runs in the installed app; on the web, log sleep &amp; HR above and steps on Today.</span>
      </span>
    </div>
  {/if}
</div>

<style>
  .edit-link{font-size:0.75rem;font-weight:700;color:var(--amber);cursor:pointer}
  .ready-row{display:flex;align-items:center;gap:14px}
  .ready-ring{width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.25rem;font-weight:800;color:var(--text);background:conic-gradient(var(--ring-color,#888) calc(var(--pct) * 1%), var(--bg3) 0)}
  .ready-ring span{background:var(--bg2);width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center}
  .ready-ring.great{--ring-color:#2ecc71}
  .ready-ring.good{--ring-color:#60a5fa}
  .ready-ring.fair{--ring-color:#ffd166}
  .ready-ring.low{--ring-color:#ff6b6b}
  .ready-label{font-size:0.9375rem;font-weight:800;color:var(--text);margin-bottom:2px}
  .ready-factor{font-size:0.6875rem;color:var(--muted)}
  .sleep-fresh{font-size:0.6875rem;color:#ffd166;background:rgba(255,209,102,.08);border:1px solid rgba(255,209,102,.2);border-radius:8px;padding:6px 9px;margin-top:8px;line-height:1.4}
  .sleep-fresh.missing{color:var(--muted);background:var(--bg3);border-color:var(--border)}
  .watch-src{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:0.6875rem;color:var(--muted)}
  .watch-detail{font-size:0.6875rem;color:var(--muted);opacity:.85}
  .watch-sync{flex-shrink:0;background:var(--bg3);border:1px solid var(--border);color:var(--amber);font-size:0.6875rem;font-weight:700;border-radius:8px;padding:5px 12px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}
  .watch-sync:active{transform:scale(.96)}
  .watch-sync:disabled{opacity:.5}
  .hc-diag{margin-top:8px;display:flex;flex-direction:column;gap:2px}
  .hc-row{display:flex;align-items:center;gap:8px;font-size:0.7188rem;padding:3px 0}
  .hc-emoji{width:18px;text-align:center;flex-shrink:0}
  .hc-name{flex:1;color:var(--text);font-weight:600}
  .hc-state{font-size:0.6875rem;font-weight:700;white-space:nowrap}
  .hc-ok .hc-state{color:#2ecc71}
  .hc-granted-no-data .hc-state{color:#ffd166}
  .hc-not-granted .hc-state{color:#ff6b6b}
  .hc-unknown .hc-state{color:var(--muted)}
  .hc-hint{font-size:0.6875rem;color:var(--muted);opacity:.85;margin:0 0 4px 26px;line-height:1.35}
  .hc-fix{margin-top:6px;width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--amber);font-size:0.7188rem;font-weight:700;border-radius:8px;padding:8px 10px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}
  .hc-fix:active{transform:scale(.98)}
  .hc-fix:disabled{opacity:.5}
  .hc-src{margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
  .hc-src-lbl{font-size:0.6875rem;color:var(--muted);line-height:1.4;margin-bottom:6px}
  .hc-src-row{display:flex;flex-wrap:wrap;gap:6px}
  .hc-chip{background:var(--bg3);border:1px solid var(--border);color:var(--muted);font-size:0.6875rem;font-weight:600;border-radius:999px;padding:4px 10px;cursor:pointer;font-family:inherit}
  .hc-chip.on{border-color:var(--amber);color:var(--amber)}
  .hc-help{margin-top:8px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px}
  .hc-help-h{font-size:0.6875rem;font-weight:800;color:var(--muted);letter-spacing:.3px;margin-bottom:6px}
  .hc-help-l{margin:0;padding-left:16px;font-size:0.6875rem;color:var(--text);line-height:1.5}
  .hc-help-l li{margin-bottom:4px}
  .hc-help-c{font-size:0.6875rem;color:var(--muted);line-height:1.4;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)}
</style>
