<script lang="ts">
  // The measure: each tab's one number in brass serif, and a measuring rule
  // under it whose ticks light as the number gets there (twenty, every fifth
  // long, like a rule's centimetres). On entry, and whenever the data changes,
  // the number counts and the ticks light together. Colour comes from `tone`
  // (the verdict palette in app.css) and only ever means data; no verdict yet
  // is the brand's brass.
  type Tone = 'good' | 'ok' | 'warn' | 'bad' | 'na';
  let { value = '', unit = '', caption = '', pct = null, tone = 'na', beam = null } = $props<{
    value?: string | number; unit?: string; caption?: string; pct?: number | null; tone?: Tone;
    /** Today's balance instead of the rule: `tilt` -1..1 leans toward the
     *  right end (where the trend is heading) or the left; 0 is level. */
    beam?: { tilt: number; left: string; right: string } | null;
  }>();

  // A seven-segment display shows numbers only. Whatever trails the number
  // ("84g") becomes the painted unit beside it; a value with no number at all
  // ("—") shows dashes, as a scoreboard does between games.
  const parsed = $derived.by(() => {
    const s = String(value);
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const decimals = m[0].includes('.') ? m[0].split('.')[1].length : 0;
    return { num: parseFloat(m[0]), decimals, suffix: s.slice(m.index! + m[0].length).trim() };
  });
  const shownUnit = $derived(unit || parsed?.suffix || '');

  // A hero number is never red: a bad week is copper, "look here", not an
  // alarm (red read as guilt, and a big serif zero in red shouts).
  // easeOutCubic over 850 ms. The *From mirrors are plain locals, not state,
  // so reading them as the start point doesn't make the effect depend on the
  // values it writes.
  const DUR = 850;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let num = $state(0);
  let fill = $state(0);
  let numFrom = 0;
  let fillFrom = 0;
  $effect(() => {
    const toNum = parsed?.num ?? 0;
    const toFill = Math.max(0, Math.min(100, pct ?? 0));
    const n0 = numFrom, f0 = fillFrom, start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = still ? 1 : Math.min(1, (now - start) / DUR);
      num = numFrom = n0 + (toNum - n0) * ease(t);
      fill = fillFrom = f0 + (toFill - f0) * ease(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  const digits = $derived(parsed ? num.toFixed(parsed.decimals) : '--');
  const lit = $derived(Math.round(fill / 5));
  const CELLS = Array.from({ length: 20 }, (_, i) => i);
</script>

<div class="ro tone-{tone === 'bad' ? 'warn' : tone}" role="img" aria-label={`${value}${unit ? ' ' + unit : ''}${caption ? ', ' + caption : ''}`}>
  <div class="ro-main">
    <span class="ro-num">{digits}</span>
    <span class="ro-side">
      {#if shownUnit}<span class="ro-unit">{shownUnit}</span>{/if}
      {#if caption}<span class="ro-cap">{caption}</span>{/if}
    </span>
  </div>
  {#if beam}
    <!-- The mark, as an instrument: level while the trend holds, tipping toward
         where it is heading, never more than 8°. -->
    <svg class="ro-beam" viewBox="0 0 316 58" role="img" aria-label={beam.tilt === 0 ? 'The balance is level' : `The balance leans toward ${beam.tilt > 0 ? beam.right : beam.left}`}>
      <g class="ro-arm" style="transform: rotate({Math.max(-1, Math.min(1, beam.tilt)) * 8}deg)">
        <path d="M28 16H288" class="ro-line" stroke-width="2.5"></path>
        <path d="M28 16v8M288 16v8" class="ro-line" stroke-width="1.5"></path>
        <path d="M12 24h32a16 9 0 0 1-32 0z" class="ro-line" stroke-width="1.5"></path>
        <path d="M272 24h32a16 9 0 0 1-32 0z" class="ro-line" stroke-width="1.5"></path>
      </g>
      <path d="M158 16l-9 16h18z" class="ro-fill"></path>
      <text x="28" y="54" text-anchor="middle">{beam.left}</text>
      <text x="288" y="54" text-anchor="middle">{beam.right}</text>
    </svg>
  {:else if pct != null}
    <div class="ro-rule">{#each CELLS as i}<i class:on={i < lit}></i>{/each}</div>
  {/if}
</div>

<style>
  .ro{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px 18px;color:var(--text)}
  .ro-main{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px}
  .ro-num{font-family:var(--font-display);font-weight:700;font-size:4.75rem;line-height:.95;letter-spacing:-.01em;
    color:var(--band);font-variant-numeric:lining-nums tabular-nums;white-space:pre}
  .ro-side{display:flex;flex-direction:column;gap:3px;min-width:0}
  .ro-unit{font-family:var(--font-body);font-size:1.0625rem;font-weight:700;line-height:1;color:var(--text)}
  .ro-cap{font-family:var(--font-label);font-size:0.75rem;font-weight:700;line-height:1.3;
    text-transform:uppercase;letter-spacing:.09em;color:var(--muted);text-wrap:balance}
  .ro-rule{display:grid;grid-template-columns:repeat(20,1fr);align-items:end;height:14px;margin-top:12px;border-bottom:2px solid var(--border2)}
  .ro-rule i{justify-self:center;width:2px;height:7px;border-radius:1px 1px 0 0;background:var(--border2)}
  .ro-rule i:nth-child(5n){height:13px}
  .ro-rule i.on{background:var(--band)}
  .ro-beam{display:block;width:100%;max-width:340px;height:auto;margin-top:8px;overflow:visible}
  .ro-arm{transform-origin:158px 16px;transform-box:view-box;transition:transform 1.2s var(--ease)}
  @media (prefers-reduced-motion:reduce){.ro-arm{transition:none}}
  .ro-line{fill:none;stroke:var(--band);stroke-linecap:round}
  .ro-fill{fill:var(--band)}
  .ro-beam text{fill:var(--muted);font-family:var(--font-label);font-size:0.6875rem}
</style>
