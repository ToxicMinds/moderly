<script lang="ts">
  // ── PULSE ─────────────────────────────────────────────────────────────────
  // The face of RecompOS. One readout answers the only question that matters in
  // a body recomposition: "am I losing fat while keeping muscle, and what do I
  // do today?" Its number and cells are the recomp score, its colour is today's
  // verdict, and it speaks ONE narrated sentence. Everything else on the page
  // is a footnote to this.
  //
  // The verdict itself is computed ONCE in $lib/stores/verdict and shared, so
  // this readout and the app-wide verdict light can never disagree.
  import { type RecompBand } from '$lib/recompScore';
  import { todayVerdict } from '$lib/stores/verdict';
  import { body } from '$lib/stores/body';
  import { dayOne } from '$lib/stores/dayOne';
  import { goalDateLabel } from '$lib/dayOne';
  import { base } from '$app/paths';
  import PageHero from './PageHero.svelte';
  import Modal from './Modal.svelte';
  import ReadinessCard from './ReadinessCard.svelte';

  let breakdownOpen = $state(false);
  let recoveryOpen = $state(false);

  let { greeting = 'Today', sub = '', mornings = null,
        kgLost = '--', kgNow = '--', weeks = '--' } = $props<{
    greeting?: string; sub?: string;
    /** Weigh-ins this week against the mornings so far — never a streak to lose. */
    mornings?: { weighed: number; days: number } | null;
    kgLost?: string | number; kgNow?: string | number; weeks?: string | number;
  }>();

  const result = $derived($todayVerdict.result);
  // The next stop is nearer than the goal, so it's the number worth a glance.
  const next = $derived($body.next);
  const tone = $derived($todayVerdict.tone);
  const insufficient = $derived(result.band === 'insufficient');

  // Show the day-one plan only while there is no real verdict to show. The
  // moment recompScore can answer honestly, the readout goes back to the score —
  // this never competes with a real reading.
  const plan = $derived($dayOne);
  const showPlan = $derived(insufficient && plan != null);
  const planPct = $derived(plan ? (plan.stepsDone / plan.steps.length) * 100 : 0);

  function bandLabel(b: RecompBand): string {
    return b === 'dialed-in' ? 'Dialed in'
      : b === 'on-track' ? 'On track'
      : b === 'mixed' ? 'Mixed signals'
      : b === 'off-track' ? 'Off track'
      : 'Warming up';
  }
</script>

<PageHero title={greeting} {sub} {tone} pct={showPlan ? planPct : insufficient ? null : result.score}
  value={showPlan ? plan!.stepsDone : insufficient ? '—' : result.score}
  unit={showPlan ? `/ ${plan!.steps.length}` : ''}
  caption={showPlan ? 'First-week steps' : bandLabel(result.band)}
  story={showPlan ? plan!.headline : result.headline}
  stats={showPlan
    ? [{ v: $body.target.target ?? plan!.targetKcal, l: 'kcal / day' }, { v: `${$body.proteinTargetG} g`, l: 'protein' }, { v: goalDateLabel(plan!.goalDate), l: `goal ${plan!.goalKg} kg` }]
    : [{ v: kgLost, l: 'kg lost' }, { v: kgNow, l: 'kg trend' }, next && next.toGoKg != null
        ? (next.reached ? { v: '✓', l: `${next.kg} reached` } : { v: next.toGoKg.toFixed(1), l: `kg to ${next.kg}` })
        : { v: weeks, l: 'wks to goal' }]}>
  {#snippet aside()}
    {#if mornings}
      <div class="ph-streak" class:full={mornings.weighed === mornings.days} title="Mornings weighed this week">Mornings <b>{mornings.weighed}/{mornings.days}</b></div>
    {/if}
  {/snippet}

  {#if !showPlan && !insufficient}
    <!-- WHERE THE NUMBER COMES FROM.
         The score used to be a bare 89 with a sentence of band prose under it,
         and recovery was a SECOND, unexplained number sitting in the top bar —
         two rival figures, neither showing its working. They were never rivals:
         recovery is one of the four weighted inputs to this score. Showing the
         four with their real measurements makes the 89 checkable and puts the
         recovery number back where it belongs — inside, not beside. -->
    <button class="ph-why" onclick={() => (breakdownOpen = true)}>
      {#each result.components as c}
        <span class="ph-why-row">
          <span class="ph-why-name">{c.name}</span>
          <span class="ph-why-bar"><span class="ph-why-fill" style="width:{c.score}%" data-tone={c.score >= 80 ? 'good' : c.score >= 55 ? 'ok' : 'bad'}></span></span>
          <span class="ph-why-val">{c.score}</span>
        </span>
      {/each}
      <span class="ph-why-more">What do these mean? →</span>
    </button>
  {/if}

  {#if showPlan}
    <!-- Day one. The verdict is genuinely unknowable, but the PLAN is not: these
         numbers come straight from the height/age/sex/activity/goal onboarding
         already collected, so a brand-new account gets a real, personal answer
         instead of a blank readout. -->
    <ol class="ph-steps">
      {#each plan!.steps as s}
        <li class:done={s.done}>
          <a href={base + s.href}>
            <span class="ph-step-tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
            <span class="ph-step-txt">
              <b>{s.label}</b>
              <em>{s.hint}</em>
            </span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</PageHero>

<Modal open={breakdownOpen} onclose={() => (breakdownOpen = false)}>
  <div class="bd-h">Your score, in full</div>
  <p class="bd-lede">
    <b>{result.score}</b> out of 100. A weighted average of four things, each measured
    from your own logs. Nothing here is an opinion — every line says what it was read off.
  </p>

  {#each result.components as c}
    <div class="bd-row">
      <div class="bd-row-top">
        <span class="bd-name">{c.name}</span>
        <span class="bd-score" data-tone={c.score >= 80 ? 'good' : c.score >= 55 ? 'ok' : 'bad'}>{c.score}</span>
      </div>
      <div class="bd-measured">{c.measured}</div>
      <div class="bd-note">{c.note}</div>
      <div class="bd-weight">counts for {Math.round(c.weight * 100)}% of the score</div>
    </div>
  {/each}

  {#if result.topLever}
    <div class="bd-lever">
      <div class="bd-lever-t">🎯 {result.topLever.title}</div>
      <div class="bd-lever-m">{result.topLever.msg}</div>
    </div>
  {/if}

  <button class="btn bg_ bfl" onclick={() => { breakdownOpen = false; recoveryOpen = true; }}>
    Recovery detail — sleep &amp; heart rate →
  </button>
</Modal>

<Modal open={recoveryOpen} onclose={() => (recoveryOpen = false)}>
  <div class="bd-h">Readiness &amp; recovery</div>
  <ReadinessCard bare />
</Modal>

<style>
  .ph-streak{flex-shrink:0;font-family:var(--font-display);font-size:0.9375rem;font-weight:700;
    text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
    border:1px solid var(--border2);border-radius:var(--r-sm);padding:4px 9px;white-space:nowrap}
  .ph-streak b{font-family:var(--font-led);font-style:italic;font-weight:700;font-size:1rem;color:var(--text);margin-left:4px}
  .ph-streak.full b{color:var(--led-good)}

  /* Day-one checklist. Four taps, each one a real first action — this is what
     occupies the space the empty readout would otherwise leave blank. */
  .ph-steps{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
  .ph-steps a{display:flex;align-items:flex-start;gap:10px;text-decoration:none;
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md);
    padding:10px 12px;transition:transform .18s var(--ease),border-color .18s var(--ease)}
  .ph-steps a:active{transform:scale(.985)}
  .ph-step-tick{flex-shrink:0;width:20px;height:20px;border-radius:var(--r-sm);margin-top:1px;
    border:1.5px solid var(--border2);display:flex;align-items:center;justify-content:center;
    font-size:0.6875rem;font-weight:900;color:#06110b}
  .ph-steps li.done .ph-step-tick{background:var(--led-good);border-color:var(--led-good)}
  .ph-steps li.done .ph-step-txt b{text-decoration:line-through;color:var(--muted)}
  .ph-steps li.done .ph-step-txt em{display:none}
  .ph-step-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
  .ph-step-txt b{font-size:0.875rem;font-weight:800;color:var(--text)}
  .ph-step-txt em{font-style:normal;font-size:0.75rem;line-height:1.4;color:var(--muted)}

  /* The score's ingredients, inline: four segmented bars, the readout's own
     cells in miniature. The mask cuts the track AND its fill into ten cells,
     so a score of 64 lights six and a bit — honest, and still a scoreboard. */
  .ph-why{display:flex;flex-direction:column;gap:7px;width:100%;margin-top:12px;padding:11px 12px;
    cursor:pointer;text-align:left;font-family:inherit;color:inherit;
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md);
    transition:transform .18s var(--ease)}
  .ph-why:active{transform:scale(.99)}
  .ph-why-row{display:grid;grid-template-columns:92px 1fr 28px;align-items:center;gap:10px}
  .ph-why-name{font-size:0.75rem;font-weight:700;color:var(--muted);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .ph-why-bar{height:8px;background:var(--bg3);overflow:hidden;
    -webkit-mask:repeating-linear-gradient(90deg,#000 0 calc(10% - 2px),transparent calc(10% - 2px) 10%);
    mask:repeating-linear-gradient(90deg,#000 0 calc(10% - 2px),transparent calc(10% - 2px) 10%)}
  .ph-why-fill{display:block;height:100%;background:var(--muted)}
  .ph-why-fill[data-tone="good"]{background:var(--led-good)}
  .ph-why-fill[data-tone="ok"]{background:var(--led-warn)}
  .ph-why-fill[data-tone="bad"]{background:var(--led-bad)}
  .ph-why-val{font-family:var(--font-display);font-size:1rem;font-weight:800;color:var(--text);text-align:right;font-variant-numeric:tabular-nums}
  .ph-why-more{font-size:0.75rem;font-weight:700;color:var(--text);margin-top:2px;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2)}

  .bd-h{font-family:var(--font-display);font-size:1.5rem;font-weight:800;text-transform:uppercase;color:var(--text);margin-bottom:8px;letter-spacing:.01em}
  .bd-lede{font-size:0.8125rem;line-height:1.5;color:var(--muted);margin:0 0 14px}
  .bd-lede b{color:var(--text);font-size:1.125rem;font-weight:900}
  .bd-row{padding:10px 0;border-bottom:1px solid var(--border)}
  .bd-row-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .bd-name{font-size:0.875rem;font-weight:800;color:var(--text)}
  .bd-score{font-size:1rem;font-weight:900;font-variant-numeric:tabular-nums}
  .bd-score[data-tone="good"]{color:var(--led-good)}
  .bd-score[data-tone="ok"]{color:var(--led-warn)}
  .bd-score[data-tone="bad"]{color:var(--led-bad)}
  .bd-measured{font-size:0.75rem;font-weight:700;color:var(--text);margin-top:3px}
  .bd-note{font-size:0.75rem;line-height:1.45;color:var(--muted);margin-top:2px}
  .bd-weight{font-size:0.6875rem;color:var(--muted);opacity:.75;margin-top:3px}
  .bd-lever{margin:12px 0;padding:10px 12px;border-radius:var(--r-md);
    background:var(--bg3);border-left:3px solid var(--text)}
  .bd-lever-t{font-size:0.8125rem;font-weight:800;color:var(--text)}
  .bd-lever-m{font-size:0.75rem;line-height:1.45;color:var(--muted);margin-top:3px}
</style>
