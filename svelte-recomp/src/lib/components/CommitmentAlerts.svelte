<script lang="ts">
  // The two moments the commitments speak up on Today: the trend over the line,
  // and a plan whose moment has come round (Friday evening, the weekend, home
  // from badminton…). Renders nothing the rest of the time — silence on the
  // ordinary days is what makes these worth reading.
  import { line } from '$lib/stores/body';
  import { liveProfile } from '$lib/stores/live';
  import { editing } from '$lib/commitments';
  import { activePlan, cleanPlans, type PlanMoment } from '$lib/plans';

  let { moment }: { moment: Omit<PlanMoment, 'overLine'> } = $props();

  const _profile = liveProfile();
  const plans = $derived(cleanPlans(($_profile as any)?.plans));
  const over = $derived($line != null && $line.zone !== 'under');
  const why = $derived((($_profile as any)?.why ?? '').trim());
  // The line has its own card; the strip shows the moment's other plan.
  const plan = $derived(activePlan({ ...plans, line: undefined }, { ...moment, overLine: over }));
</script>

{#if over && $line}
  <button class="ca ca-line tone-{$line.zone === 'well-over' ? 'bad' : 'warn'}" onclick={() => editing.set('line')}>
    <span class="ca-k">{$line.zone === 'well-over' ? 'Well over your line' : 'Over your line'} <b>+{$line.overKg.toFixed(1)}</b> kg</span>
    <span class="ca-t">{plans.line ?? 'You haven’t decided what happens now. Decide it once, here.'}</span>
    {#if why}<span class="ca-why">You said: “{why}”</span>{/if}
    <span class="ca-f">Trend {$line.trendKg.toFixed(1)} · line {$line.kg.toFixed(1)}. One week over is a signal, not a verdict.</span>
  </button>
{/if}

{#if plan}
  <button class="ca" onclick={() => editing.set('plans')}>
    <span class="ca-k">{plan.label} · your plan</span>
    <span class="ca-t">{plan.then}</span>
  </button>
{/if}

<style>
  .ca{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;cursor:pointer;font-family:inherit;color:inherit;
    background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--text);
    border-radius:var(--r-sm) var(--r-lg) var(--r-lg) var(--r-sm);padding:11px 13px;margin-bottom:12px;
    transition:transform .18s var(--ease)}
  .ca:active{transform:scale(.99)}
  .ca-line{border-left-color:var(--band)}
  .ca-k{font-family:var(--font-display);font-size:0.875rem;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
  .ca-line .ca-k{color:var(--band)}
  .ca-k b{font-family:var(--font-led);font-style:italic;letter-spacing:0;margin-left:6px}
  .ca-t{font-size:0.9375rem;font-weight:700;line-height:1.4;color:var(--text)}
  .ca-f{font-size:0.75rem;line-height:1.45;color:var(--muted)}
  .ca-why{font-size:0.8125rem;font-weight:700;line-height:1.4;color:var(--text);padding-left:9px;border-left:2px solid var(--border2)}
</style>
