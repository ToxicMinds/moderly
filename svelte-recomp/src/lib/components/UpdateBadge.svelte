<script lang="ts">
  // One dot for the whole app. It used to check only the web build, so it said
  // "Up to date" while the phone app itself was mid-update (the banner below
  // was downloading build 10 at that moment). Up to date now means both.
  import { updateAvailable, checkingUpdate, swVersion, applyUpdate, checkForUpdate } from '$lib/stores/appUpdate';
  import { updateState, checkForNativeUpdate, installNativeUpdate } from '$lib/stores/nativeUpdate';

  /** The installed app is behind and can update in place. */
  const appBehind = $derived($updateState.available && $updateState.mode === 'inplace');
  function updateApp() {
    if (!$updateState.busy) installNativeUpdate();
  }

  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showToast(msg: string, ms = 2200) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), ms);
  }

  async function manualCheck() {
    if ($updateAvailable) { applyUpdate(); return; }
    if (appBehind) { updateApp(); return; }
    showToast('Checking…', 8000);
    await Promise.all([checkForUpdate(), checkForNativeUpdate()]);
    if ($updateAvailable) {
      showToast('Update found — tap to install', 4000);
    } else if (appBehind) {
      showToast('App update ready — tap to install', 4000);
    } else {
      showToast(`Up to date${$updateState.installedBuild ? ` · app ${$updateState.installedBuild}` : ''}`);
    }
  }
</script>

<span class="upd-wrap">
  {#if $updateAvailable}
    <button class="upd upd-new" onclick={applyUpdate} title="A new version is ready — tap to update">
      <span class="upd-ico">↻</span>Update
    </button>
  {:else if appBehind}
    <button class="upd upd-new" onclick={updateApp} disabled={$updateState.busy}
      title={`App update ready: build ${$updateState.latestBuild} (you have ${$updateState.installedBuild})`}>
      <span class="upd-ico">↻</span>{$updateState.busy ? 'Updating…' : 'Update'}
    </button>
  {:else}
    <button
      class="upd upd-ok"
      class:checking={$checkingUpdate}
      onclick={manualCheck}
      title={$swVersion ? `You're on the latest build (${$swVersion.slice(0, 8)}) — tap to re-check` : 'Up to date — tap to check for updates'}
    >
      <span class="upd-ico">{$checkingUpdate ? '⟳' : '●'}</span>
    </button>
  {/if}
  {#if toast}
    <span class="upd-toast">{toast}</span>
  {/if}
</span>

<style>
  .upd-wrap{position:relative;display:inline-flex;align-items:center}
  .upd{display:inline-flex;align-items:center;gap:3px;border:none;background:none;cursor:pointer;font-family:inherit;font-weight:700;padding:0;line-height:1}
  .upd-ok{position:relative;width:16px;height:16px;justify-content:center;color:var(--green);font-size:0.6875rem;opacity:.65;transition:opacity .2s}
  /* The dot stays a 16px dot visually, but 16px is far below the 44px minimum
     touch target — invisible padding makes it actually tappable without
     disturbing the top bar's layout. */
  .upd-ok::after{content:'';position:absolute;inset:-14px}
  .upd-ok:active{opacity:1}
  .upd-ok.checking .upd-ico{animation:updspin .8s linear infinite}
  .upd-new{font-size:0.6875rem;color:var(--bg);background:var(--amber);border-radius:var(--r-sm);padding:4px 8px;animation:updpulse 1.6s ease-in-out infinite}
  .upd-new:active{transform:scale(.94)}
  .upd-ico{font-size:0.6875rem;line-height:1}
  .upd-toast{position:absolute;top:calc(100% + 6px);right:0;white-space:nowrap;background:var(--bg2,#1b2028);color:var(--text,#e8edf2);border:1px solid var(--border2,#2a3038);border-radius:7px;padding:4px 8px;font-size:0.6875rem;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.35);z-index:50;animation:updfade .15s ease-out}
  @keyframes updfade{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
  @keyframes updspin{to{transform:rotate(360deg)}}
  @keyframes updpulse{0%,100%{opacity:1}50%{opacity:.72}}
</style>
