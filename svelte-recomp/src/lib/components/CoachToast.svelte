<script lang="ts">
  // The visual half of the app's voice (see stores/toast.ts). Renders the queue
  // as a stack of glass cards that slide up from above the bottom nav, each with
  // its own auto-dismiss timer. Tones borrow the same palette as the Fuel coach
  // and the verdict aura, so a green line always means the same thing everywhere.
  //
  // Two physical touches make it feel native rather than web: a thin progress
  // bar in the tone colour DRAINS as the timer runs (you can see how long it'll
  // stay), and you can SWIPE it away in either direction — a flick, not a hunt
  // for a tiny x. Tapping still dismisses. A haptic already fired when it spoke
  // (see stores/toast); dismissing gives a light tick back.
  import { toasts, dismissToast } from '$lib/stores/toast';
  import { haptic } from '$lib/haptics';
  import { onDestroy } from 'svelte';

  // One timer per toast id, cleared on dismiss/destroy so nothing leaks.
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  // Live horizontal drag offset per toast id, for swipe-to-dismiss.
  let drag = $state<Record<number, number>>({});
  const DISMISS_PX = 84;

  $effect(() => {
    for (const t of $toasts) {
      if (t.ttl > 0 && !timers.has(t.id)) {
        timers.set(t.id, setTimeout(() => close(t.id), t.ttl));
      }
    }
    // Drop timers for toasts that are already gone.
    for (const [id, handle] of timers) {
      if (!$toasts.some((t) => t.id === id)) {
        clearTimeout(handle);
        timers.delete(id);
      }
    }
  });

  function close(id: number) {
    const h = timers.get(id);
    if (h) { clearTimeout(h); timers.delete(id); }
    delete drag[id];
    dismissToast(id);
  }

  // — Swipe gesture — pointer-based so it works with touch, pen and mouse.
  let startX = 0;
  let activeId = $state<number | null>(null);
  let moved = false;

  function onDown(e: PointerEvent, id: number) {
    activeId = id;
    startX = e.clientX;
    moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerEvent, id: number) {
    if (activeId !== id) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    drag[id] = dx;
  }
  function onUp(id: number) {
    if (activeId !== id) return;
    const dx = drag[id] ?? 0;
    if (Math.abs(dx) > DISMISS_PX) {
      haptic('tap');
      // Fling it the rest of the way, then remove.
      drag[id] = dx > 0 ? 480 : -480;
      setTimeout(() => close(id), 140);
    } else {
      drag[id] = 0; // snap back
    }
    activeId = null;
  }
  function onTap(id: number) {
    if (moved) return; // a swipe already handled it
    haptic('tap');
    close(id);
  }

  onDestroy(() => {
    for (const h of timers.values()) clearTimeout(h);
    timers.clear();
  });
</script>

<div class="toast-wrap" aria-live="polite">
  {#each $toasts as t (t.id)}
    <button
      class="toast toast-{t.tone}"
      class:swiping={activeId === t.id}
      style="transform:translateX({drag[t.id] ?? 0}px); opacity:{1 - Math.min(1, Math.abs(drag[t.id] ?? 0) / 260)}"
      onclick={() => onTap(t.id)}
      onpointerdown={(e) => onDown(e, t.id)}
      onpointermove={(e) => onMove(e, t.id)}
      onpointerup={() => onUp(t.id)}
      onpointercancel={() => onUp(t.id)}
      aria-label="Dismiss notification"
    >
      <span class="toast-icon">{t.icon}</span>
      <span class="toast-text">
        <span class="toast-title">{t.title}</span>
        {#if t.body}<span class="toast-body">{t.body}</span>{/if}
      </span>
      <span class="toast-x" aria-hidden="true">&times;</span>
      {#if t.ttl > 0}
        <span class="toast-bar" style="animation-duration:{t.ttl}ms"></span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .toast-wrap{position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h) + var(--sb) + 12px);z-index:120;display:flex;flex-direction:column;gap:8px;pointer-events:none}
  .toast{--tc:var(--led-ok);position:relative;overflow:hidden;pointer-events:auto;width:100%;text-align:left;font-family:inherit;display:flex;align-items:flex-start;gap:11px;padding:12px 13px;border-radius:var(--r-md);cursor:pointer;touch-action:pan-y;
    background:color-mix(in srgb, var(--tc) 8%, var(--bg2));
    border:1px solid var(--border2);
    box-shadow:0 10px 30px rgba(0,0,0,.45);
    animation:toast-in .32s cubic-bezier(.2,.9,.25,1);
    transition:transform .18s var(--ease), opacity .18s var(--ease)}
  /* While a finger is down, follow it 1:1 with no transition; on release the
     inline transform animates back (snap) or out (fling) via the ease above. */
  .toast.swiping{transition:none}
  .toast:active{filter:brightness(1.04)}
  .toast-good{--tc:var(--led-good)}
  .toast-ok{--tc:var(--led-ok)}
  .toast-warn{--tc:var(--led-warn)}
  .toast-bad{--tc:var(--led-bad)}
  .toast-icon{font-size:1.25rem;line-height:1.2;flex-shrink:0}
  .toast-text{flex:1;min-width:0;display:flex;flex-direction:column}
  .toast-title{font-size:0.875rem;font-weight:800;color:var(--text);line-height:1.35}
  .toast-body{font-size:0.8125rem;color:var(--muted);line-height:1.45;margin-top:2px}
  .toast-x{flex-shrink:0;color:var(--muted);font-size:1.2rem;line-height:1;opacity:.7}
  /* The draining timer bar — sits on the bottom edge, tone-coloured, shrinks
     from full width to nothing over exactly the toast's lifetime. */
  .toast-bar{position:absolute;left:0;bottom:0;height:2.5px;width:100%;transform-origin:left;
    background:var(--tc);
    animation:toast-drain linear forwards}
  @keyframes toast-in{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes toast-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
  @media (prefers-reduced-motion: reduce){.toast{animation:none}.toast-bar{display:none}}
</style>
