<script lang="ts">
  // The scoreboard readout — the one bold element on every tab. A recessed
  // black LED panel, like a gym's interval clock: seven-segment digits lit over
  // their own unlit 8s, and a 20-cell bar that lights cell by cell. On entry,
  // and whenever the data changes, the number counts and the cells light
  // together, the board powering on. Colour comes from `tone` (the verdict
  // palette in app.css) and only ever means data. The panel stays black in the
  // light theme too: a scoreboard is black in daylight.
  type Tone = 'good' | 'ok' | 'warn' | 'bad' | 'na';
  let { value = '', unit = '', caption = '', pct = null, tone = 'na' } = $props<{
    value?: string | number; unit?: string; caption?: string; pct?: number | null; tone?: Tone;
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

  // The unlit segments: the final value's shape with every digit an 8, at
  // least three digits wide, so the board never changes size as it counts.
  const ghost = $derived.by(() => {
    const g = (parsed ? parsed.num.toFixed(parsed.decimals) : '--').replace(/[0-9-]/g, '8');
    return '8'.repeat(Math.max(0, 3 - g.replace('.', '').length)) + g;
  });

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

<div class="ro tone-{tone}" role="img" aria-label={`${value}${unit ? ' ' + unit : ''}${caption ? ', ' + caption : ''}`}>
  <div class="ro-main">
    <span class="ro-led">
      <span class="ro-ghost">{ghost}</span>
      <span class="ro-digits">{digits}</span>
    </span>
    <span class="ro-side">
      {#if shownUnit}<span class="ro-unit">{shownUnit}</span>{/if}
      {#if caption}<span class="ro-cap">{caption}</span>{/if}
    </span>
  </div>
  {#if pct != null}
    <div class="ro-bar">{#each CELLS as i}<i class:on={i < lit}></i>{/each}</div>
  {/if}
</div>

<style>
  .ro{
    /* Bright LEDs in both themes. Re-declared here so the .tone-* rule on this
       same element resolves --band against them, not the light theme's inks. */
    --led-good:#31f28a;--led-ok:#4da3ff;--led-warn:#ffb020;--led-bad:#ff3b47;--muted:#6f747c;
    background:#08090a;border:1px solid #000;border-radius:var(--r-md);
    box-shadow:inset 0 2px 14px rgba(0,0,0,.75),0 1px 0 rgba(255,255,255,.05);
    padding:12px 14px 13px;color:#d9d6ce;
  }
  .ro-main{display:flex;align-items:flex-end;flex-wrap:wrap;gap:4px 12px}
  .ro-led{display:inline-grid;font-family:var(--font-led);font-style:italic;font-weight:700;
    font-size:4.25rem;line-height:1;letter-spacing:.03em}
  .ro-led>span{grid-area:1/1;justify-self:end;white-space:pre}
  .ro-ghost{color:var(--band);opacity:.09}
  .ro-digits{color:var(--band);
    text-shadow:0 0 2px color-mix(in srgb,var(--band) 80%,transparent),0 0 16px color-mix(in srgb,var(--band) 55%,transparent)}
  .ro-side{display:flex;flex-direction:column;gap:3px;padding-bottom:4px;min-width:0}
  .ro-unit{font-family:var(--font-display);font-size:1.75rem;font-weight:800;line-height:1;color:#ece9e2}
  .ro-cap{font-family:var(--font-display);font-size:0.9375rem;font-weight:700;line-height:1.15;
    text-transform:uppercase;letter-spacing:.06em;color:#9a9ea5;text-wrap:balance}
  .ro-bar{display:grid;grid-template-columns:repeat(20,1fr);gap:3px;margin-top:12px}
  .ro-bar i{height:8px;border-radius:1px;background:color-mix(in srgb,var(--band) 13%,#000)}
  .ro-bar i.on{background:var(--band);box-shadow:0 0 7px color-mix(in srgb,var(--band) 55%,transparent)}
</style>
