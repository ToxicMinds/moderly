<script lang="ts">
  import { todaysFocus, type FocusItem, type Severity } from '$lib/coach';
  import { cardNav } from '$lib/actions/cardNav';
  import { base } from '$app/paths';
  import VideoEmbed from '$lib/components/VideoEmbed.svelte';
  import { todayYmd } from '$lib/date';

  let { items = [] as FocusItem[] } = $props();

  const SEV_W: Record<Severity, number> = { bad: 0, warn: 1, info: 2, good: 3 };
  const DKEY = 'focus-dismissed-v1';
  const todayStr = () => todayYmd();

  function loadDismiss(): { date: string; worst: number } | null {
    try { return JSON.parse(localStorage.getItem(DKEY) || 'null'); } catch { return null; }
  }
  let dismissRec = $state(loadDismiss());
  let overrideShow = $state(false);

  // Worst (most severe) severity currently present.
  const worst = $derived(items.length ? Math.min(...items.map((i) => SEV_W[i.severity])) : 3);
  // Hidden if dismissed today AND nothing MORE severe has emerged since.
  const hidden = $derived(
    !overrideShow && !!dismissRec && dismissRec.date === todayStr() && worst >= dismissRec.worst
  );

  function dismiss() {
    dismissRec = { date: todayStr(), worst };
    try { localStorage.setItem(DKEY, JSON.stringify(dismissRec)); } catch {}
    overrideShow = false;
    dragX = 0;
  }
  function reveal() { overrideShow = true; }

  // Swipe-to-dismiss on the hero.
  let dragX = $state(0);
  let startX = 0, dragging = false;
  function onDown(e: PointerEvent) { dragging = true; startX = e.clientX; }
  function onMove(e: PointerEvent) { if (dragging) dragX = e.clientX - startX; }
  function onUp() {
    if (dragging && Math.abs(dragX) > 90) dismiss();
    else dragX = 0;
    dragging = false;
  }

  // severity → the LED tone it lights (app.css). Colour only ever means data.
  const COLORS: Record<Severity, { c: string; bg: string }> = {
    bad:  { c: 'var(--led-bad)',  bg: 'color-mix(in srgb,var(--led-bad) 7%,var(--bg2))' },
    warn: { c: 'var(--led-warn)', bg: 'color-mix(in srgb,var(--led-warn) 7%,var(--bg2))' },
    good: { c: 'var(--led-good)', bg: 'color-mix(in srgb,var(--led-good) 7%,var(--bg2))' },
    info: { c: 'var(--led-ok)',   bg: 'color-mix(in srgb,var(--led-ok) 7%,var(--bg2))' },
  };

  // Three topics, not a feed. The weight item becomes the headline when there
  // is one; otherwise the worst topic leads so the card is never headless.
  // ONE voice, and only when today needs it (see todaysFocus). The card used
  // to lead with the weight headline, which the Pulse above already says, and
  // add a row each for Fuel, Train and Recover: four voices before breakfast,
  // three of them repeating the Today card.
  const hero = $derived(todaysFocus(items));
</script>

{#if hero && hidden}
  <button class="focus-chip" onclick={reveal}>
    <span class="focus-dot sm" style="background:{COLORS[hero.severity].c}"></span>
    Today's Focus · tap to show
  </button>
{:else if hero}
  <div class="focus-wrap">
    <div class="focus-hd">
      <span class="focus-title">Today's Focus</span>
      <span class="focus-dot" style="background:{COLORS[hero.severity].c}"></span>
      <span class="f1"></span>
      <button class="focus-x" onclick={dismiss} title="Dismiss for today" aria-label="Dismiss for today">✕</button>
    </div>

    <!-- Hero: the single most important thing right now (swipe to dismiss) -->
    {#if hero.href}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="hero card-tap" style="--ac:{COLORS[hero.severity].c};--abg:{COLORS[hero.severity].bg};transform:translateX({dragX}px);opacity:{1 - Math.min(0.6, Math.abs(dragX) / 250)}"
        onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp}
        use:cardNav={base + hero.href}>
        {@render heroBody(hero)}
      </div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="hero" style="--ac:{COLORS[hero.severity].c};--abg:{COLORS[hero.severity].bg};transform:translateX({dragX}px);opacity:{1 - Math.min(0.6, Math.abs(dragX) / 250)}"
        onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp}>
        {@render heroBody(hero)}
      </div>
    {/if}

  </div>
{/if}

{#snippet heroBody(it: FocusItem)}
  <div class="hero-top">
    <div class="f1">
      <div class="hero-title">{it.title}</div>
      {#if it.metric}<div class="hero-metric">{it.metric}</div>{/if}
    </div>
  </div>
  <div class="hero-msg">{it.msg}</div>
  {#if it.vid}
    <div class="focus-video" data-no-nav><VideoEmbed vid={it.vid} label={it.videoLabel ?? 'Watch how ▸'} compact /></div>
  {/if}
{/snippet}


<style>
  .focus-wrap { margin-bottom: 16px; }
  .focus-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .focus-title { font-family: var(--font-label); font-size: 0.875rem; font-weight:700; text-transform: uppercase; letter-spacing:.08em; color: var(--muted); }
  .focus-dot { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
  .focus-dot.sm { width: 6px; height: 6px; }
  .focus-x { background: transparent; border: none; color: var(--muted); font-size: 0.875rem; cursor: pointer; padding: 4px 6px; line-height: 1; border-radius: var(--r-sm); -webkit-tap-highlight-color: transparent; }
  .focus-x:active { transform: scale(.9); color: var(--text); }
  .focus-chip { display: flex; align-items: center; gap: 7px; width: 100%; justify-content: center; background: transparent; border: 1px dashed var(--border2); border-radius: var(--r-md); padding: 8px; color: var(--muted); font-family: var(--font-label); font-size: 0.8125rem; font-weight: 700; letter-spacing:.08em; text-transform: uppercase; cursor: pointer; margin-bottom: 16px; -webkit-tap-highlight-color: transparent; }
  .focus-chip:active { transform: scale(.99); border-color: var(--text); }

  .hero {
    position: relative; overflow: hidden;
    border: 1px solid var(--border);
    background: var(--abg);
    border-radius: var(--r-md); padding: 14px 15px; margin-bottom: 8px; touch-action: pan-y;
  }
  .hero-top { display: flex; align-items: center; gap: 12px; }
  .hero-title { font-size: 1rem; font-weight: 800; color: var(--text); }
  .hero-metric { font-size: 0.8125rem; font-weight: 700; color: var(--ac); margin-top: 1px; }
  .hero-msg { font-size: 0.875rem; line-height: 1.5; color: var(--text); margin-top: 7px; }

  .focus-video { display: block; }
</style>
