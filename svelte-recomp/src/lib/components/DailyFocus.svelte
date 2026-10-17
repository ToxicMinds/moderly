<script lang="ts">
  import { foldDailyFocus, type FocusItem, type FocusGroup, type Severity } from '$lib/coach';
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
  const folded = $derived(foldDailyFocus(items));
  const hero = $derived(folded.headline ?? folded.groups[0]?.lead ?? null);
  // Don't repeat the lead in the row beneath it when it was promoted to hero.
  const groups = $derived(
    folded.headline ? folded.groups : folded.groups.slice(1)
  );
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

    <!-- Fuel · Train · Recover — one row each, leading with that topic's worst -->
    {#each groups as g (g.key)}
      {#if g.lead.href}
        <div class="pill card-tap" style="--ac:{COLORS[g.severity].c};--abg:{COLORS[g.severity].bg}" use:cardNav={base + g.lead.href}>
          {@render groupBody(g)}
        </div>
      {:else}
        <div class="pill" style="--ac:{COLORS[g.severity].c};--abg:{COLORS[g.severity].bg}">
          {@render groupBody(g)}
        </div>
      {/if}
    {/each}
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

{#snippet groupBody(g: FocusGroup)}
  <div class="f1">
    <div class="pill-title">
      <span class="topic">{g.label}</span>{g.lead.title}{#if g.lead.metric}<span class="pill-metric">{g.lead.metric}</span>{/if}{#if g.more > 0}<span class="more-n">+{g.more}</span>{/if}
    </div>
    <div class="pill-msg">{g.lead.msg}</div>
    {#if g.lead.vid}
      <div class="focus-video" data-no-nav><VideoEmbed vid={g.lead.vid} label={g.lead.videoLabel ?? 'Watch how ▸'} compact /></div>
    {/if}
  </div>
{/snippet}

<style>
  .focus-wrap { margin-bottom: 16px; }
  .focus-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .focus-title { font-family: var(--font-display); font-size: 0.875rem; font-weight: 800; text-transform: uppercase; letter-spacing: .14em; color: var(--muted); }
  .focus-dot { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
  .focus-dot.sm { width: 6px; height: 6px; }
  .focus-x { background: transparent; border: none; color: var(--muted); font-size: 0.875rem; cursor: pointer; padding: 4px 6px; line-height: 1; border-radius: var(--r-sm); -webkit-tap-highlight-color: transparent; }
  .focus-x:active { transform: scale(.9); color: var(--text); }
  .focus-chip { display: flex; align-items: center; gap: 7px; width: 100%; justify-content: center; background: transparent; border: 1px dashed var(--border2); border-radius: var(--r-md); padding: 8px; color: var(--muted); font-family: var(--font-display); font-size: 0.8125rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; margin-bottom: 16px; -webkit-tap-highlight-color: transparent; }
  .focus-chip:active { transform: scale(.99); border-color: var(--text); }

  .hero {
    position: relative; overflow: hidden;
    border: 1px solid var(--border); border-left: 3px solid var(--ac);
    background: var(--abg);
    border-radius: var(--r-md); padding: 14px 15px; margin-bottom: 8px; touch-action: pan-y;
  }
  .hero-top { display: flex; align-items: center; gap: 12px; }
  .hero-title { font-size: 1rem; font-weight: 800; color: var(--text); }
  .hero-metric { font-size: 0.8125rem; font-weight: 700; color: var(--ac); margin-top: 1px; }
  .hero-msg { font-size: 0.875rem; line-height: 1.5; color: var(--text); margin-top: 7px; }

  .pill {
    display: flex; align-items: flex-start; gap: 11px;
    background: var(--bg2);
    border: 1px solid var(--border); border-left: 3px solid var(--ac);
    border-radius: var(--r-md); padding: 11px 13px; margin-bottom: 7px;
  }
  .pill-title { font-size: 0.875rem; font-weight: 700; color: var(--text); display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; }
  .topic { font-family: var(--font-display); font-size: 0.875rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: var(--ac); flex-shrink: 0; }
  .more-n { font-size: 0.75rem; font-weight: 700; color: var(--muted); }
  .pill-metric { font-size: 0.75rem; font-weight: 700; color: var(--ac); }
  .pill-msg { font-size: 0.8125rem; line-height: 1.45; color: var(--muted); margin-top: 2px; }
  .focus-video { display: block; }
</style>
