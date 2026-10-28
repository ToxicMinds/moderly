<script lang="ts">
  let { open = false, onclose, children }: {
    open?: boolean;
    onclose?: () => void;
    children?: import('svelte').Snippet;
  } = $props();

  // Swipe-down-to-dismiss: the drag handle at the top of every bottom
  // sheet used to be purely decorative (no touch handling at all), so the
  // only way to close was tapping the dimmed backdrop -- easy to miss,
  // especially once content fills most of the screen. Track vertical drag
  // on the handle/header area; past a threshold (or a fast flick) closes
  // the sheet, otherwise it snaps back.
  let dragY = $state(0);
  let dragging = $state(false);
  let startY = 0;
  let startT = 0;

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    startY = e.clientY;
    startT = performance.now();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - startY;
    dragY = Math.max(0, dy);
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const elapsed = performance.now() - startT;
    const velocity = dragY / Math.max(elapsed, 1);
    if (dragY > 100 || velocity > 0.5) {
      onclose?.();
    }
    dragY = 0;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="moverlay" class:open onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="mbox" class:dragging onclick={(e) => e.stopPropagation()} style={dragY ? `transform:translateY(${dragY}px)` : ''}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mhandle-area" onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp}>
      <div class="mhandle"></div>
    </div>
    <button class="mclose" onclick={onclose} aria-label="Close">&times;</button>
    {#if children}{@render children()}{/if}
  </div>
</div>

<style>
  :global(.mbox){position:relative}
  .mhandle-area{padding:4px 0 14px;margin:-8px 0 0;cursor:grab;touch-action:none}
  .mclose{position:absolute;top:10px;right:12px;width:32px;height:32px;border-radius:50%;background:var(--bg3);border:1px solid var(--border2);color:var(--muted);font-size:1.25rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5}
  .mbox.dragging{transition:none}
</style>
