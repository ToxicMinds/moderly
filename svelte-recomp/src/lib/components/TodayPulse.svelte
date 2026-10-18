<script lang="ts">
  // ── PULSE ─────────────────────────────────────────────────────────────────
  // The face of RecompOS: the weight trend and how far it is to the next stop,
  // coloured by the pace (src/lib/pulse.ts, shared with the page's glow). A
  // brand-new account, before the scale has drawn a trend, gets its plan and
  // first steps instead, and only until those are done.
  import { body, todayPulse } from '$lib/stores/body';
  import { dayOne } from '$lib/stores/dayOne';
  import { goalDateLabel } from '$lib/dayOne';
  import { base } from '$app/paths';
  import PageHero from './PageHero.svelte';
  import { editing } from '$lib/commitments';

  let { greeting = 'Today', sub = '', mornings = null } = $props<{
    greeting?: string; sub?: string;
    /** Weigh-ins this week against the mornings so far — never a streak to lose. */
    mornings?: { weighed: number; days: number } | null;
  }>();

  const p = $derived($todayPulse);
  const plan = $derived($dayOne);
  const showPlan = $derived(plan != null && $body.weight?.trendKg == null && plan.stepsDone < plan.steps.length);
</script>

{#if showPlan}
  <PageHero title={greeting} {sub} pct={(plan!.stepsDone / plan!.steps.length) * 100}
    value={plan!.stepsDone} unit={`/ ${plan!.steps.length}`} caption="First-week steps" story={plan!.headline}
    stats={[{ v: $body.target.target ?? plan!.targetKcal, l: 'kcal / day' }, { v: `${$body.proteinTargetG} g`, l: 'protein' }, { v: goalDateLabel(plan!.goalDate), l: `goal ${plan!.goalKg} kg` }]}>
    {#snippet aside()}{@render streak()}{/snippet}
    <!-- Day one. These numbers come straight from onboarding, so a brand-new
         account gets a real, personal answer instead of a blank readout. -->
    <ol class="ph-steps">
      {#each plan!.steps as s}
        <li class:done={s.done}>
          {#if s.key === 'plan'}
            <!-- The plans editor lives on this page: open it, don't navigate. -->
            <button type="button" class="ph-step-btn" onclick={() => editing.set('plans')}>
              <span class="ph-step-tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
              <span class="ph-step-txt"><b>{s.label}</b><em>{s.hint}</em></span>
            </button>
          {:else}
            <a href={base + s.href}>
              <span class="ph-step-tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
              <span class="ph-step-txt"><b>{s.label}</b><em>{s.hint}</em></span>
            </a>
          {/if}
        </li>
      {/each}
    </ol>
  </PageHero>
{:else}
  <PageHero title={greeting} {sub} tone={p.tone} pct={p.pct}
    value={p.kg != null ? p.kg.toFixed(1) : '—'} caption={p.caption} story={p.story} stats={p.stats}>
    {#snippet aside()}{@render streak()}{/snippet}
  </PageHero>
{/if}

{#snippet streak()}
  {#if mornings}
    <div class="ph-streak" class:full={mornings.weighed === mornings.days} title="Mornings weighed this week">Mornings <b>{mornings.weighed}/{mornings.days}</b></div>
  {/if}
{/snippet}

<style>
  .ph-streak{flex-shrink:0;font-family:var(--font-display);font-size:0.9375rem;font-weight:700;
    text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
    border:1px solid var(--border2);border-radius:var(--r-sm);padding:4px 9px;white-space:nowrap}
  .ph-streak b{font-family:var(--font-led);font-style:italic;font-weight:700;font-size:1rem;color:var(--text);margin-left:4px}
  .ph-streak.full b{color:var(--led-good)}

  /* Day-one checklist. Four taps, each one a real first action — this is what
     occupies the space the empty readout would otherwise leave blank. */
  .ph-steps{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
  .ph-steps a,.ph-step-btn{display:flex;align-items:flex-start;gap:10px;text-decoration:none;width:100%;
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md);text-align:left;font:inherit;color:inherit;cursor:pointer;
    padding:10px 12px;transition:transform .18s var(--ease),border-color .18s var(--ease)}
  .ph-steps a:active,.ph-step-btn:active{transform:scale(.985)}
  .ph-step-tick{flex-shrink:0;width:20px;height:20px;border-radius:var(--r-sm);margin-top:1px;
    border:1.5px solid var(--border2);display:flex;align-items:center;justify-content:center;
    font-size:0.6875rem;font-weight:900;color:#06110b}
  .ph-steps li.done .ph-step-tick{background:var(--led-good);border-color:var(--led-good)}
  .ph-steps li.done .ph-step-txt b{text-decoration:line-through;color:var(--muted)}
  .ph-steps li.done .ph-step-txt em{display:none}
  .ph-step-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
  .ph-step-txt b{font-size:0.875rem;font-weight:800;color:var(--text)}
  .ph-step-txt em{font-style:normal;font-size:0.75rem;line-height:1.4;color:var(--muted)}
</style>
