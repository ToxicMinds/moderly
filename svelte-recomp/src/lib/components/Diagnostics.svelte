<script lang="ts">
  // "What's actually wrong right now?" — one place, on the device.
  //
  // Every subsystem that used to fail into console.warn now reports here (see
  // stores/notices.ts). The badge only appears when something has genuinely
  // gone wrong, so it stays ignorable until it matters.
  import { notices, unreadCount, clearNotices, markNoticesRead } from '$lib/stores/notices';
  import { sourceLabel } from '$lib/health/watches';
  import { safeAreaInfo } from '$lib/safeArea';
  import { recentErrors, clearErrors } from '$lib/errorLog';
  import { healthConnect } from '$lib/health/healthConnect';
  import { syncStatus, syncError } from '$lib/stores/sync';
  import { lastRefresh, lastRefreshTook } from '$lib/stores/refresh';
  import Modal from '$lib/components/Modal.svelte';

  let open = $state(false);
  const sa = $derived(open ? safeAreaInfo() : null);

  // Persisted errors — these survive a reload, unlike the in-memory notices
  // above, which is the whole point of them.
  let logged = $state<any[]>([]);
  let loggedErr = $state('');
  $effect(() => {
    if (!open) return;
    recentErrors(20).then((r) => (logged = r)).catch((e) => (loggedErr = e?.message || String(e)));
  });
  function fmtWhen(iso: string) {
    const d = new Date(iso), mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return d.toLocaleDateString();
  }

  function show() {
    open = true;
    markNoticesRead();
  }

  function ago(ms: number | null): string {
    if (!ms) return 'never';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  }

  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

  function when(at: number): string {
    return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<button class="diag-btn" class:alert={$unreadCount > 0} onclick={show} title="App status">
  {$unreadCount > 0 ? '⚠' : 'ⓘ'}
  {#if $unreadCount > 0}<span class="diag-count">{$unreadCount > 9 ? '9+' : $unreadCount}</span>{/if}
</button>

<Modal {open} onclose={() => (open = false)}>
  <div style="font-size:1.125rem;font-weight:800;color:var(--text);margin-bottom:10px">App status</div>

  <div class="diag-grid">
    <div class="diag-row">
      <span class="diag-k">Cloud sync</span>
      <span class="diag-v" class:ok={$syncStatus === 'synced'} class:bad={$syncStatus === 'error'}>
        {$syncStatus}
      </span>
    </div>
    <div class="diag-row">
      <span class="diag-k">Last full refresh</span>
      <span class="diag-v">{ago($lastRefresh)}{#if $lastRefreshTook}{' · '}server {secs($lastRefreshTook.cloud)}{#if $lastRefreshTook.watch != null}{' · '}watch {secs($lastRefreshTook.watch)}{/if}{/if}</span>
    </div>
    <div class="diag-row">
      <span class="diag-k">Watch data</span>
      <span class="diag-v" class:ok={$healthConnect.lastSync && !$healthConnect.lastError} class:bad={!!$healthConnect.lastError}>
        {$healthConnect.native ? ($healthConnect.lastError ? 'error' : ago($healthConnect.lastSync ? Date.parse($healthConnect.lastSync) : null)) : 'web — not available'}
      </span>
    </div>
    {#if $healthConnect.sources.length}
      <div class="diag-row">
        <span class="diag-k">Health sources</span>
        <span class="diag-v">{$healthConnect.sources.length} found</span>
      </div>
    {/if}
    <!-- "My watch says 5268, the app says 2069" is unanswerable without this.
         Shows every app that wrote steps today and what each one claims, so a
         source that has not synced yet is distinguishable from one that is
         genuinely partial. -->
    <!-- The top bar hid behind the notch twice before this was visible. -->
    {#if sa}
      <div class="diag-row">
        <span class="diag-k">Top inset ({sa.platform})</span>
        <span class="diag-v" class:ok={sa.effectiveTop > 20} class:bad={sa.effectiveTop <= 20}>
          {sa.effectiveTop}px{#if sa.applied} (floored from {sa.reportedTop}){/if}
        </span>
      </div>
    {/if}
    {#if $healthConnect.stepsToday}
      <div class="diag-row">
        <span class="diag-k">Steps today (used)</span>
        <span class="diag-v">{$healthConnect.stepsToday.total.toLocaleString()}</span>
      </div>
      {#each Object.entries($healthConnect.stepsToday.candidates) as [pkg, n]}
        <div class="diag-row diag-sub">
          <span class="diag-k">
            {sourceLabel(pkg)}{#if pkg === $healthConnect.stepsToday.origin} &larr; used{/if}
          </span>
          <span class="diag-v">{n.toLocaleString()}</span>
        </div>
      {/each}
      {#if Object.keys($healthConnect.stepsToday.candidates).length <= 1}
        <div class="diag-note">
          Only one app is writing steps. If your watch shows more, its companion
          app has not pushed to Health Connect yet — open it and pull to refresh.
        </div>
      {/if}
    {/if}
  </div>

  {#if logged.length > 0}
    <div class="diag-sec">
      <div class="diag-sec-h">
        <span>Errors on this account</span>
        <button class="diag-clear" onclick={() => { clearErrors().then(() => logged = []); }}>Clear</button>
      </div>
      {#each logged as e}
        <div class="diag-err">
          <div class="diag-err-top">
            <span class="diag-err-msg">{e.message}</span>
            {#if e.count > 1}<span class="diag-err-n">&times;{e.count}</span>{/if}
          </div>
          <div class="diag-err-sub">
            {e.kind} &middot; {e.route ?? '—'} &middot; {e.platform ?? '—'} &middot; {fmtWhen(e.last_seen)}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if $syncError}
    <div class="diag-note">{$syncError}</div>
  {/if}

  <div style="font-size:0.75rem;font-weight:700;color:var(--muted);margin:14px 0 6px">
    RECENT PROBLEMS
  </div>

  {#if $notices.length === 0}
    <div class="diag-empty">Nothing has gone wrong. When something does, it shows up here instead of failing quietly.</div>
  {:else}
    <div class="diag-list">
      {#each $notices as n (n.id)}
        <div class="diag-item diag-{n.level}">
          <div class="diag-item-hd">
            <span class="diag-src">{n.source}</span>
            <span class="diag-time">{when(n.at)}</span>
          </div>
          <div class="diag-msg">{n.message}</div>
          {#if n.hint}<div class="diag-hint">{n.hint}</div>{/if}
        </div>
      {/each}
    </div>
    <button class="btn bg_ bfl" style="margin-top:10px" onclick={clearNotices}>Clear</button>
  {/if}
</Modal>

<style>
  .diag-btn{position:relative;width:36px;height:36px;border-radius:var(--r-sm);border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.9375rem;transition:all .2s var(--ease)}
  .diag-btn:active{transform:scale(.9)}
  .diag-btn.alert{border-color:var(--red);color:var(--red)}
  .diag-count{position:absolute;top:-3px;right:-3px;background:var(--led-bad);color:#fff;font-size:0.6875rem;font-weight:800;border-radius:999px;padding:1px 4px;line-height:1.3}
  .diag-grid{display:flex;flex-direction:column;gap:2px}
  .diag-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.7812rem}
  .diag-k{color:var(--muted)}
  .diag-v{font-weight:700;color:var(--text)}
  .diag-v.ok{color:var(--green,#2ecc71)}
  .diag-v.bad{color:var(--red)}
  .diag-sec{margin-top:12px;border-top:1px solid var(--border);padding-top:10px}
  .diag-sec-h{display:flex;justify-content:space-between;align-items:center;font-size:0.6875rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:7px}
  .diag-clear{background:none;border:none;color:var(--amber);font-size:0.6875rem;font-weight:700;cursor:pointer;font-family:inherit;padding:2px 4px}
  .diag-err{padding:6px 0;border-bottom:1px solid color-mix(in srgb,var(--border) 55%,transparent)}
  .diag-err-top{display:flex;gap:6px;align-items:baseline}
  .diag-err-msg{flex:1;font-size:0.7188rem;color:var(--text);word-break:break-word}
  .diag-err-n{font-size:0.6875rem;font-weight:800;color:var(--red);flex-shrink:0}
  .diag-err-sub{font-size:0.6875rem;color:var(--muted);margin-top:2px}
  .diag-sub{opacity:.75;padding-left:10px}
  .diag-note{margin-top:10px;font-size:0.7188rem;color:var(--amber);line-height:1.45}
  .diag-empty{font-size:0.75rem;color:var(--muted);line-height:1.5}
  .diag-list{display:flex;flex-direction:column;gap:8px;max-height:45vh;overflow-y:auto}
  .diag-item{border-left:3px solid var(--border);padding:6px 0 6px 10px}
  .diag-item.diag-error{border-left-color:var(--red)}
  .diag-item.diag-warn{border-left-color:var(--amber)}
  .diag-item-hd{display:flex;justify-content:space-between;font-size:0.6875rem;color:var(--muted);margin-bottom:2px}
  .diag-src{font-weight:700}
  .diag-msg{font-size:0.75rem;color:var(--text);line-height:1.4;word-break:break-word}
  .diag-hint{font-size:0.6875rem;color:var(--muted);margin-top:3px;line-height:1.4}
</style>
