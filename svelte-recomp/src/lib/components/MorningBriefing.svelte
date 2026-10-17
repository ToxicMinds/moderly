<script lang="ts">
  // The morning briefing's switch, its time, and tomorrow's briefing exactly
  // as it would arrive. What goes in it: src/lib/briefing.ts. When it goes
  // out: MorningClock.java.
  import { onMount } from 'svelte';
  import { briefings, briefingSetting, forecast, refreshForecast, saveBriefing } from '$lib/stores/morning';
  import { hasMorning, isNativeApp, morningStatus, type MorningState } from '$lib/nativeAlarms';
  import { locationRefused } from '$lib/weather';
  import { todayDate } from '$lib/stores/refresh';

  const native = isNativeApp();
  let ready = $state<boolean | null>(null);
  let status = $state<MorningState | null>(null);
  let saving = $state(false);
  let locating = $state(false);
  let error = $state('');

  onMount(async () => {
    ready = await hasMorning();
    if (ready) status = await morningStatus();
  });

  const on = $derived(!!$briefingSetting?.on);
  const after = $derived($briefingSetting?.after ?? '06:00');
  const tomorrow = $derived($briefings[1] ?? null);
  const shownAt = $derived(status?.shown === $todayDate && status?.postedAt
    ? new Date(status.postedAt).toTimeString().slice(0, 5) : null);
  const refused = $derived(!$forecast && !locating && locationRefused());

  async function save(next: { on: boolean; after: string }) {
    saving = true;
    error = '';
    try {
      await saveBriefing(next);
    } catch (e: any) {
      error = 'Could not save — ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }
  const toggle = () => { if (!saving) save({ on: !on, after }); };
  function setAfter(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (/^\d\d:\d\d$/.test(v) && v >= '04:00' && v <= '11:00' && v !== after) save({ on, after: v });
  }
  async function useLocation() {
    locating = true;
    try { await refreshForecast(true); } finally { locating = false; }
  }
</script>

<div class="acard mb">
  <div class="flex jb ac">
    <div>
      <div class="mb-h">Morning briefing</div>
      <div class="amsg">The first time you unlock after {after}</div>
    </div>
    {#if native && ready}
      <div class="tog" class:on role="switch" tabindex="0" aria-checked={on} aria-label="Morning briefing"
        onclick={toggle} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}></div>
    {/if}
  </div>
  <p class="mb-lede">
    One notification: the weather where you are, the day's session and food, and your plan for the day.
    It's not an alarm and makes no sound. If you don't pick the phone up, nothing comes.
  </p>

  {#if !native}
    <div class="mb-note">It comes with the Android app.</div>
  {:else if ready === false}
    <div class="mb-note">It needs the app update: tap Update at the top of the screen.</div>
  {:else if ready && on}
    <label class="flbl mb-lbl" for="mb-after">After</label>
    <input id="mb-after" type="time" min="04:00" max="11:00" value={after} onchange={setAfter} disabled={saving}>

    {#if tomorrow}
      <div class="mb-tag">Tomorrow's, as it stands</div>
      <div class="mb-note-card">
        <div class="mb-app">RecompOS</div>
        <div class="mb-title">{tomorrow.title}</div>
        {#each tomorrow.body.split('\n') as line}<div class="mb-line">{line}</div>{/each}
      </div>
    {/if}

    <div class="mb-meta">
      {#if $forecast}
        Weather for roughly where the phone is.
      {:else if refused}
        Location is off for RecompOS. Allow it in Android Settings → Apps → RecompOS → Permissions, then
        <button type="button" class="mb-link" onclick={useLocation}>try again</button>.
      {:else}
        <button type="button" class="mb-link" onclick={useLocation} disabled={locating}>{locating ? 'Finding the weather…' : 'Use my location for the weather'}</button>
      {/if}
      {#if shownAt}<div>Shown today at {shownAt}.</div>{/if}
    </div>
  {/if}
  {#if error}<div class="mb-err">{error}</div>{/if}
</div>

<style>
  .mb{margin-bottom:14px}
  .mb-h{font-family:var(--font-display);font-size:1.25rem;font-weight:800;text-transform:uppercase;color:var(--text);letter-spacing:.01em;line-height:1.1}
  .mb-lede{font-size:0.8125rem;line-height:1.5;color:var(--muted);margin:10px 0 0}
  .mb-note{font-size:0.8125rem;color:var(--text);margin-top:10px}
  .mb-lbl{margin-top:12px}
  .mb-tag{font-family:var(--font-display);font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:14px 0 6px}
  /* Tomorrow's briefing drawn as the notification it will be. */
  .mb-note-card{background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r-md);padding:10px 12px}
  .mb-app{font-size:0.6875rem;color:var(--muted);margin-bottom:3px}
  .mb-title{font-size:0.9375rem;font-weight:800;color:var(--text);margin-bottom:3px}
  .mb-line{font-size:0.8125rem;line-height:1.45;color:var(--text)}
  .mb-meta{font-size:0.75rem;line-height:1.5;color:var(--muted);margin-top:8px}
  .mb-link{background:none;border:none;padding:0;font:inherit;font-weight:700;color:var(--text);cursor:pointer;
    text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2)}
  .mb-err{font-size:0.8125rem;color:var(--led-bad);margin-top:8px}
</style>
