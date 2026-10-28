<script lang="ts">
  let { vid = '', label = '', compact = false }: { vid?: string; label?: string; compact?: boolean } = $props();

  let open = $state(false);
  let failed = $state(false);
  let online = $state(true);

  function openVideo() {
    failed = false;
    online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    open = true;
  }
  function closeVideo() { open = false; failed = false; }
  function onIframeError() { failed = true; }

  // Belt-and-suspenders escape hatch: the visible × button (and tap-outside)
  // should always work, but Escape/Android-back closes it too, in case any
  // future layout change accidentally clips the button again like it did
  // before (overflow:hidden on .video-box was silently eating a
  // position:absolute close button placed outside its bounds).
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) closeVideo();
  }

  const embedUrl = $derived(vid ? `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0` : '');
  const watchUrl = $derived(vid ? `https://www.youtube.com/watch?v=${vid}` : '');

  // Exercise cards live inside the bottom-sheet Modal, whose box slides in
  // via `transform: translateY(...)`. Any CSS transform on an ancestor
  // creates a new containing block for `position: fixed` descendants, so
  // without this the overlay below renders relative to the (scrolled)
  // modal box instead of the viewport — it ends up positioned off-screen.
  // Moving the node to <body> on mount sidesteps that entirely.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if vid}
  {#if compact}
    <button class="watch-link" onclick={openVideo} title="Plays in-app (needs internet)">{label || 'Watch how ▸'}</button>
  {:else}
    <button class="watch-btn" onclick={openVideo} title="Requires an internet connection">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      {label || 'Watch full video (online)'}
    </button>
  {/if}
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="video-overlay" class:open onclick={closeVideo} use:portal>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="video-box" onclick={(e) => e.stopPropagation()}>
    <button class="video-close" onclick={closeVideo}>&times;</button>
    {#if open}
      {#if !online}
        <div class="video-fallback">
          <p>No internet connection — video can't play offline.</p>
          <p class="hint">Use the exercise photos above for offline reference.</p>
        </div>
      {:else if failed}
        <div class="video-fallback">
          <p>Cannot play video here.</p>
          <a href={watchUrl} target="_blank" rel="noopener noreferrer">Open on YouTube instead ↗</a>
        </div>
      {:else}
        <iframe
          id="video-embed"
          src={embedUrl}
          allow="autoplay; encrypted-media"
          allowfullscreen
          title="Exercise video"
          onerror={onIframeError}
        ></iframe>
        <!-- Always-visible escape hatch. YouTube embed-disabled videos load
             the iframe fine but render "Video unavailable" inside it, so the
             onerror handler never fires and no fallback shows. This footer
             link guarantees the user can always reach a working video. -->
        <a class="video-yt-link" href={watchUrl} target="_blank" rel="noopener noreferrer">
          Video not playing? Open on YouTube ↗
        </a>
      {/if}
    {/if}
  </div>
</div>

<style>
  #video-embed{width:100%;height:100%;border:none}
  .video-fallback{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;height:100%;padding:2rem;text-align:center;color:var(--text2, #aaa)}
  .video-fallback a{color:var(--amber, #c084fc);font-weight:600}
  .video-fallback .hint{font-size:.85rem;opacity:.8}
  .video-yt-link{position:absolute;left:0;right:0;bottom:0;padding:7px 10px;font-size:0.6875rem;font-weight:700;text-align:center;color:#fff;background:linear-gradient(0deg,rgba(0,0,0,.82),rgba(0,0,0,0));text-decoration:none;z-index:5}
  .video-yt-link:active{opacity:.7}
  .watch-link{display:inline-block;margin-top:8px;padding:0;background:transparent;border:none;font-size:0.75rem;font-weight:700;color:var(--ac,var(--amber));cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}
  .watch-link:active{opacity:.7}
</style>
