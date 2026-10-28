// Pull-to-refresh for the main scroll container.
//
// Native apps have no reload button, so the drag-down gesture IS the reload —
// people try it instinctively and it feeling dead reads as the app being stuck.
// Applied once to #pages in the root layout, so every screen gets it.
//
// Deliberately hand-rolled rather than pulling in a library: the whole gesture
// is ~60 lines of pointer maths, and a dependency here would also have to be
// taught about this app's scroll container and safe-area insets anyway.
//
// Usage:
//   <main use:pullToRefresh={{ onRefresh, enabled, onPull: (px) => pull = px }}>

export interface PullToRefreshOptions {
  /** Runs when the user pulls past the threshold. Indicator holds until it settles. */
  onRefresh: () => void | Promise<void>;
  /** Continuous pull distance in px (0 when idle) — drive the indicator with it. */
  onPull?: (px: number) => void;
  /** Set false to disable (e.g. a modal is open). Default true. */
  enabled?: boolean;
  /** Pull distance that triggers a refresh. Default 72px. */
  threshold?: number;
  /** Hard cap on how far the content follows the finger. Default 120px. */
  maxPull?: number;
}

export function pullToRefresh(node: HTMLElement, opts: PullToRefreshOptions) {
  let current = opts;
  let startY = 0;
  let pulling = false;
  let armed = false;
  let busy = false;
  let pull = 0;

  const threshold = () => current.threshold ?? 72;
  const maxPull = () => current.maxPull ?? 120;
  const enabled = () => current.enabled !== false;

  function setPull(px: number) {
    pull = px;
    current.onPull?.(px);
  }

  function begin(y: number) {
    if (!enabled() || busy) return;
    // Only arm at the very top — otherwise this would fight normal scrolling.
    armed = node.scrollTop <= 0;
    if (!armed) return;
    startY = y;
    pulling = true;
  }

  /** @returns true if the caller should preventDefault (we own this gesture). */
  function move(y: number): boolean {
    if (!pulling || !armed) return false;
    const dy = y - startY;
    if (dy <= 0 || node.scrollTop > 0) {
      // Pulled back up (or the list scrolled) — release and let it scroll.
      setPull(0);
      pulling = false;
      return false;
    }
    // Rubber-band: resistance grows with distance so it feels attached to the
    // finger rather than sliding freely, and can't be yanked off-screen.
    setPull(Math.min(maxPull(), dy * 0.5));
    return true;
  }

  // --- Touch. NOT pointer events. -----------------------------------------
  // The browser fires `pointercancel` and seizes the gesture the moment it
  // decides a touch drag is a scroll, which on a scrollable container is
  // immediately. The pointer-event version of this action therefore did
  // nothing at all on a phone while working perfectly under a desktop mouse —
  // which is exactly how it shipped broken. Touch events survive that, and a
  // non-passive touchmove can still preventDefault the native scroll.
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    begin(e.touches[0].clientY);
  }

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    // Content must not scroll while the indicator is being dragged out.
    if (move(e.touches[0].clientY) && e.cancelable) e.preventDefault();
  }

  // --- Mouse, so the gesture is still testable on desktop. -----------------
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    begin(e.clientY);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    if (move(e.clientY) && e.cancelable) e.preventDefault();
  }

  async function onPointerUp() {
    if (!pulling) return;
    pulling = false;
    const shouldRefresh = !busy && armed && pull >= threshold();
    armed = false;

    if (!shouldRefresh) {
      setPull(0);
      return;
    }

    busy = true;
    // Hold the indicator at the threshold while the work runs, so the spinner
    // has somewhere to live instead of snapping shut immediately.
    setPull(threshold());
    try {
      await current.onRefresh();
    } finally {
      busy = false;
      setPull(0);
    }
  }

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('touchend', onPointerUp);
  node.addEventListener('touchcancel', onPointerUp);
  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove, { passive: false });
  node.addEventListener('pointerup', onPointerUp);
  // No pointerleave: with touch it fires mid-drag and aborts the gesture.

  return {
    update(newOpts: PullToRefreshOptions) {
      current = newOpts;
    },
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onPointerUp);
      node.removeEventListener('touchcancel', onPointerUp);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
    }
  };
}
