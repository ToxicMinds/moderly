<script lang="ts">
  // WEEK BY WEEK. The Sunday check-in, kept: each week's trend, the plan it
  // asked about and how it held, and the one line the user wrote. A journal
  // that writes itself a week at a time — private, and only ever in the
  // user's own words.
  import { liveDailyLogs, liveWeights } from '$lib/stores/live';
  import { journalWeeks } from '$lib/week';

  const _daily = liveDailyLogs();
  const _weights = liveWeights();
  const weeks = $derived(journalWeeks($_daily as any[], ($_weights as any[]).map((w) => ({ date: w.date, weight: +w.weight }))));
  const fmt = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
</script>

{#if weeks.length}
  <div class="card wj">
    <div class="card-lbl">Week by week</div>
    {#each weeks as w (w.weekStart)}
      <div class="wj-row">
        <div class="wj-top">
          <span class="wj-date">Week of {fmt(w.weekStart)}</span>
          {#if w.trendKg != null}
            <span class="wj-kg">{w.trendKg.toFixed(1)}{#if w.deltaKg != null}<em class:down={w.deltaKg < 0} class:up={w.deltaKg > 0}>{w.deltaKg > 0 ? '+' : w.deltaKg < 0 ? '−' : '±'}{Math.abs(w.deltaKg).toFixed(1)}</em>{/if}</span>
          {/if}
        </div>
        {#if w.planText}<div class="wj-plan">“{w.planText}” — <b>{w.held ?? '—'}</b></div>{/if}
        {#if w.note}<div class="wj-note">{w.note}</div>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .wj-row{padding:10px 0;border-bottom:1px solid var(--border)}
  .wj-row:last-child{border-bottom:none}
  .wj-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .wj-date{font-family:var(--font-display);font-size:0.9375rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text)}
  .wj-kg{font-family:var(--font-display);font-size:1.0625rem;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums}
  .wj-kg em{font-style:normal;font-size:0.8125rem;margin-left:6px;color:var(--muted)}
  .wj-kg em.down{color:var(--led-good)}
  .wj-kg em.up{color:var(--led-warn)}
  .wj-plan{font-size:0.8125rem;line-height:1.45;color:var(--muted);margin-top:4px}
  .wj-plan b{color:var(--text)}
  .wj-note{font-size:0.875rem;line-height:1.5;color:var(--text);margin-top:5px;padding-left:9px;border-left:2px solid var(--border2)}
</style>
