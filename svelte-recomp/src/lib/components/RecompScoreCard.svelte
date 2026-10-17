<script lang="ts">
  // One-glance recomposition verdict for the Today page: are you losing FAT
  // while keeping MUSCLE, and what is the single best thing to fix next. Fuses
  // the weight trend, strength trend, protein adherence and readiness that the
  // app already tracks (see $lib/recompScore).
  import { liveWeights, liveGoal, liveWorkoutLogs, liveFoodLogs, liveBiometrics } from '$lib/stores/live';
  import { weightTrend } from '$lib/coach';
  import { strengthTrend } from '$lib/strength';
  import { computeReadiness } from '$lib/readiness';
  import { recompScore } from '$lib/recompScore';
  import { todayYmd, shiftYmd } from '$lib/date';
  import { nowTick } from '$lib/stores/refresh';

  const _weights = liveWeights();
  const _goal = liveGoal();
  const _workoutLogs = liveWorkoutLogs();
  const _foodLogs = liveFoodLogs();
  const _bio = liveBiometrics();

  const today = $derived.by(() => { void $nowTick; return todayYmd(); });
  const goalKg = $derived($_goal ?? null);
  const currentWeight = $derived(($_weights as any[]).length ? ($_weights as any[])[($_weights as any[]).length - 1].weight : null);
  const proteinTargetG = $derived(goalKg ? Math.round(goalKg * 1.8) : 0);

  const trend = $derived(weightTrend(($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight })), goalKg ?? 0));
  const strength = $derived(strengthTrend($_workoutLogs as any));

  // Protein adherence: mean of the last 7 LOGGED days' (protein / target).
  const proteinAdherencePct = $derived.by(() => {
    if (!proteinTargetG) return null;
    const cutoff = shiftYmd(-7, new Date($nowTick));
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs as any[]) {
      if (f.date < cutoff) continue;
      byDate.set(f.date, (byDate.get(f.date) ?? 0) + (f.protein_g || 0));
    }
    if (byDate.size === 0) return null;
    let sum = 0;
    for (const g of byDate.values()) sum += Math.min(100, (g / proteinTargetG) * 100);
    return sum / byDate.size;
  });

  const readinessScore = $derived.by(() => {
    void $nowTick;
    const todayBio = ($_bio as any[]).find((b) => b.date === today);
    const history = ($_bio as any[]).filter((b) => b.date < today).slice(-14);
    return computeReadiness(todayBio, history)?.score ?? null;
  });

  const result = $derived(recompScore({
    weeklyLossRateKg: trend.rateKgPerWeek,
    currentWeightKg: currentWeight,
    goalKg,
    strength: { direction: strength.direction, avgPct: strength.avgPct },
    proteinAdherencePct,
    readinessScore,
  }));

  let showDetail = $state(false);
</script>

<div class="card recomp">
  <div class="flex jb ac" style="margin-bottom:8px">
    <div class="card-lbl" style="margin-bottom:0">Recomp Quality</div>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <span class="edit-link" role="button" tabindex="0"
      onclick={() => showDetail = !showDetail}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail = !showDetail; } }}
    >{showDetail ? 'Hide ▲' : 'Breakdown ▼'}</span>
  </div>

  <div class="recomp-row">
    <div class="recomp-ring" style="--pct:{result.band === 'insufficient' ? 0 : result.score}"
      class:dialed={result.band==='dialed-in'} class:ontrack={result.band==='on-track'}
      class:mixed={result.band==='mixed'} class:off={result.band==='off-track'} class:na={result.band==='insufficient'}>
      <span>{result.band === 'insufficient' ? '—' : result.score}</span>
    </div>
    <div class="f1">
      <div class="recomp-band">{bandLabel(result.band)}</div>
      <div class="recomp-headline">{result.headline}</div>
    </div>
  </div>

  {#if result.topLever}
    <div class="lever">
      <div class="lever-title">🎯 {result.topLever.title}</div>
      <div class="lever-msg">{result.topLever.msg}</div>
    </div>
  {/if}

  {#if showDetail}
    <div class="breakdown">
      {#each result.components as c (c.key)}
        <div class="bd-row">
          <div class="bd-head">
            <span class="bd-name">{c.name}</span>
            <span class="bd-score" class:hi={c.score>=80} class:mid={c.score>=50 && c.score<80} class:lo={c.score<50}>{c.score}</span>
          </div>
          <div class="bd-bar"><div class="bd-fill" class:hi={c.score>=80} class:mid={c.score>=50 && c.score<80} class:lo={c.score<50} style="width:{c.score}%"></div></div>
          <div class="bd-note">{c.note}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<script module lang="ts">
  function bandLabel(b: string): string {
    switch (b) {
      case 'dialed-in': return 'Dialed in';
      case 'on-track': return 'On track';
      case 'mixed': return 'Mixed';
      case 'off-track': return 'Off track';
      default: return 'Not enough data yet';
    }
  }
</script>

<style>
  .edit-link{font-size:0.75rem;font-weight:700;color:var(--amber);cursor:pointer}
  .recomp-row{display:flex;align-items:center;gap:14px}
  .recomp-ring{width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.25rem;font-weight:800;color:var(--text);background:conic-gradient(var(--ring-color,#888) calc(var(--pct) * 1%), var(--bg3) 0)}
  .recomp-ring span{background:var(--bg2);width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center}
  .recomp-ring.dialed{--ring-color:#2ecc71}
  .recomp-ring.ontrack{--ring-color:#60a5fa}
  .recomp-ring.mixed{--ring-color:#ffd166}
  .recomp-ring.off{--ring-color:#ff6b6b}
  .recomp-ring.na{--ring-color:#3a4258}
  .recomp-band{font-size:0.9375rem;font-weight:800;color:var(--text);margin-bottom:2px}
  .recomp-headline{font-size:0.7188rem;color:var(--muted);line-height:1.4}
  .lever{margin-top:12px;padding:10px 12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:10px}
  .lever-title{font-size:0.7812rem;font-weight:800;color:var(--amber);margin-bottom:3px}
  .lever-msg{font-size:0.7188rem;color:var(--text);line-height:1.45}
  .breakdown{margin-top:12px;display:flex;flex-direction:column;gap:10px;padding-top:10px;border-top:1px solid var(--border)}
  .bd-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px}
  .bd-name{font-size:0.75rem;font-weight:700;color:var(--text)}
  .bd-score{font-size:0.75rem;font-weight:800}
  .bd-score.hi{color:#2ecc71}.bd-score.mid{color:#ffd166}.bd-score.lo{color:#ff6b6b}
  .bd-bar{height:5px;border-radius:3px;background:var(--bg3);overflow:hidden}
  .bd-fill{height:100%;border-radius:3px}
  .bd-fill.hi{background:#2ecc71}.bd-fill.mid{background:#ffd166}.bd-fill.lo{background:#ff6b6b}
  .bd-note{font-size:0.6875rem;color:var(--muted);margin-top:3px;line-height:1.35}
</style>
