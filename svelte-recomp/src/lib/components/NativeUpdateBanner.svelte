<script lang="ts">
  // Native update / migration prompt. Shows only on-device.
  //  • migrate  → the one-time "Reinstall" for the app people already have.
  //               The old app has no installer plugin, so the button is a real
  //               link: the WebView opens the APK in the system browser, it
  //               downloads, and the user taps Install once (Android needs one
  //               confirmed replace because the signing key changed).
  //  • inplace  → every future update: a silent one-tap in-place install via
  //               the native ApkInstaller plugin.
  // See stores/nativeUpdate for the detection logic.
  import { onMount } from 'svelte';
  import {
    updateState,
    checkForNativeUpdate,
    installNativeUpdate,
    markMigrationStarted,
    APK_URL,
  } from '$lib/stores/nativeUpdate';
  import { haptic } from '$lib/haptics';

  let dismissed = $state(false);

  onMount(() => {
    checkForNativeUpdate();
  });

  const isMigrate = $derived($updateState.mode === 'migrate');

  function onInPlace() {
    haptic('impact');
    installNativeUpdate();
  }

  // For migrate we DON'T preventDefault — let the <a> navigate so the WebView
  // hands the download off to the system browser. Just add the flourish.
  function onMigrate() {
    haptic('impact');
    markMigrationStarted();
  }
</script>

{#if $updateState.available && !dismissed}
  <div class="nu-wrap" role="status" aria-live="polite">
    <div class="nu-card" class:migrate={isMigrate}>
      <div class="nu-ico">{isMigrate ? '✦' : '↑'}</div>
      <div class="nu-body">
        <div class="nu-title">
          {isMigrate ? 'One-time reinstall — new look, new engine' : 'New version ready'}
        </div>
        <div class="nu-sub">
          {#if $updateState.error}
            <span class="nu-err">{$updateState.error}</span>
          {:else if isMigrate && $updateState.busy}
            Downloading… when it's done, open it and tap Install to finish.
          {:else if $updateState.busy}
            Downloading update…
          {:else if isMigrate}
            Tap Reinstall, then confirm once. Your data is safe in the cloud and
            syncs straight back — after this, updates are automatic.
          {:else}
            Installs right over the app — nothing to delete, nothing lost.
          {/if}
        </div>
      </div>
      <div class="nu-actions">
        {#if isMigrate}
          <a
            class="nu-btn"
            href={APK_URL}
            target="_blank"
            rel="noopener noreferrer"
            onclick={onMigrate}
          >Reinstall</a>
        {:else}
          <button class="nu-btn" onclick={onInPlace} disabled={$updateState.busy}>
            {$updateState.busy ? 'Updating…' : 'Update'}
          </button>
        {/if}
        <button
          class="nu-x"
          onclick={() => (dismissed = true)}
          aria-label="Later"
          title="Later"
        >&times;</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .nu-wrap{
    position:fixed;
    left:0;right:0;
    bottom:calc(var(--nav-h,64px) + var(--sb) + 12px);
    display:flex;justify-content:center;
    padding:0 12px;
    z-index:60;
    pointer-events:none;
    animation:nuIn .28s cubic-bezier(.2,.9,.3,1);
  }
  .nu-card{
    pointer-events:auto;
    display:flex;align-items:center;gap:12px;
    width:100%;max-width:440px;
    padding:12px 12px 12px 14px;
    background:var(--bg2);
    border:1px solid var(--border2);
    border-radius:var(--r-lg);
    box-shadow:0 10px 34px rgba(0,0,0,.45);
  }
  .nu-card.migrate{border-color:color-mix(in srgb,var(--amber) 55%,transparent)}
  .nu-ico{
    flex-shrink:0;
    width:34px;height:34px;border-radius:var(--r-sm);
    display:flex;align-items:center;justify-content:center;
    font-size:1.1rem;font-weight:800;color:var(--bg);
    background:var(--text);
    animation:nuBob 1.8s ease-in-out infinite;
  }
  .nu-body{flex:1;min-width:0}
  .nu-title{font-weight:800;font-size:0.875rem;letter-spacing:-.2px;color:var(--text)}
  .nu-sub{font-size:0.75rem;color:var(--text-dim,#9aa4af);margin-top:1px;line-height:1.3}
  .nu-err{color:var(--red,#fb7185)}
  .nu-actions{flex-shrink:0;display:flex;align-items:center;gap:6px}
  .nu-btn{
    border:none;cursor:pointer;font-family:inherit;font-weight:800;
    font-size:0.8125rem;color:var(--bg);text-decoration:none;
    display:inline-flex;align-items:center;justify-content:center;
    background:var(--text);
    border-radius:var(--r-sm);padding:9px 14px;min-height:40px;
    transition:transform .12s;
  }
  .nu-btn:active{transform:scale(.94)}
  .nu-btn:disabled{opacity:.7;cursor:default}
  .nu-x{
    border:none;background:none;cursor:pointer;
    color:var(--text-dim,#9aa4af);font-size:1.4rem;line-height:1;
    width:36px;height:36px;border-radius:9px;
    display:flex;align-items:center;justify-content:center;
  }
  .nu-x:active{background:var(--glass-brd)}
  @keyframes nuIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes nuBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
</style>
