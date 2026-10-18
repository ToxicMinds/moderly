<script lang="ts">
  // YOUR WEEK. Twelve weeks folded onto one: how much each weekday logs, and
  // what the scale does two days later. Drawn on the scoreboard's own black
  // panel, one segmented column per day, because it is the same kind of thing
  // as the hero readout — a number about you, lit up. The weekend's columns
  // light amber only when they really run over the weekdays.
  import { shape as weekShape } from '$lib/stores/body';

  const shape = $derived($weekShape);
  import { changeWord, dwtNum } from '$lib/units';
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const range = $derived(shape ? { lo: Math.min(...shape.kcal) * 0.75, hi: Math.max(...shape.kcal) } : null);
  // Monday–Thursday's middle: a weekend column lights amber only well above it.
  const weekdayMid = $derived.by(() => {
    if (!shape) return 0;
    const s = [...shape.kcal.slice(0, 4)].sort((a, b) => a - b);
    return (s[1] + s[2]) / 2;
  });
  const pct = (k: number) => (range ? Math.max(8, Math.round(((k - range.lo) / (range.hi - range.lo || 1)) * 100)) : 0);

  const fmtKg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${dwtNum(v)}`;
  const amplitude = $derived(shape ? Math.max(...shape.scale.filter((v) => v != null) as number[], 0) - Math.min(...shape.scale.filter((v) => v != null) as number[], 0) : 0);
  const worth = $derived(shape != null && (shape.weekendGap >= 200 || amplitude >= 0.6));
</script>

{#if shape && worth}
  <div class="card ws">
    <div class="card-lbl">Your week</div>
    {#if shape.weekendGap >= 200}
      <div class="ws-head">Friday to Sunday you log about <b>{shape.weekendGap.toLocaleString()} a day</b> more than Monday to Thursday.</div>
    {:else}
      <div class="ws-head">Your weekdays and weekends log about the same.</div>
    {/if}

    <div class="ws-panel" role="img" aria-label={`Median logged kcal by weekday: ${shape.kcal.map((k, i) => `${DAYS[i]} ${k}`).join(', ')}`}>
      {#each shape.kcal as k, i}
        <div class="ws-col" class:hot={k > weekdayMid + 200}>
          <span class="ws-n">{k.toLocaleString()}</span>
          <span class="ws-bar"><i style="height:{pct(k)}%"></i></span>
          <span class="ws-d">{LETTERS[i]}</span>
          <span class="ws-kg" class:hi={i === shape.heaviest} class:lo={i === shape.lightest}>{shape.scale[i] != null ? fmtKg(shape.scale[i] as number) : ''}</span>
        </div>
      {/each}
    </div>
    <div class="ws-key"><span>Logged kcal, median day</span><span>Scale vs trend, {changeWord()}</span></div>

    {#if shape.heaviest != null && shape.lightest != null}
      <p class="ws-foot">
        Your scale reads heaviest on {DAYS[shape.heaviest]} ({fmtKg(shape.scale[shape.heaviest] as number)} {changeWord()}) and lightest on
        {DAYS[shape.lightest]} ({fmtKg(shape.scale[shape.lightest] as number)}): that's the weekend's food and salt passing through,
        not fat. The trend averages it out, which is why a Monday reading never sets anything.
      </p>
    {/if}
  </div>
{/if}

<style>
  .ws-head{font-size:1rem;font-weight:700;line-height:1.4;color:var(--text);margin-bottom:12px;text-wrap:pretty}
  .ws-head b{font-weight:900}
  .ws-panel{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;background:var(--bg2);border:1px solid var(--border);
    border-radius:var(--r-md);padding:12px 10px 8px;color:var(--text)}
  .ws-col{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;--c:var(--muted)}
  .ws-col.hot{--c:var(--led-warn)}
  .ws-n{font-family:var(--font-display);font-size:0.9375rem;font-weight:700;letter-spacing:.01em;color:var(--c);
    font-variant-numeric:lining-nums tabular-nums;white-space:nowrap;text-shadow:0 0 8px color-mix(in srgb,var(--c) 45%,transparent)}
  .ws-bar{position:relative;width:70%;height:84px;background:color-mix(in srgb,var(--c) 12%,#000);
    -webkit-mask:repeating-linear-gradient(0deg,#000 0 5px,transparent 5px 7px);mask:repeating-linear-gradient(0deg,#000 0 5px,transparent 5px 7px)}
  .ws-bar i{position:absolute;left:0;right:0;bottom:0;background:var(--c);box-shadow:0 0 8px color-mix(in srgb,var(--c) 55%,transparent)}
  .ws-d{font-family:var(--font-label);font-size:0.875rem;font-weight:700;color:#ece9e2}
  .ws-kg{font-size:0.6875rem;font-weight:700;color:#8b9097;min-height:1em;font-variant-numeric:lining-nums tabular-nums}
  .ws-kg.hi{color:var(--led-warn)}
  .ws-kg.lo{color:#ece9e2}
  .ws-key{display:flex;justify-content:space-between;gap:10px;font-size:0.6875rem;color:var(--muted);margin-top:6px}
  .ws-foot{font-size:0.8125rem;line-height:1.5;color:var(--muted);margin:10px 0 0}
</style>
