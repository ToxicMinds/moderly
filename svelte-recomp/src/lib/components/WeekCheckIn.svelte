<script lang="ts">
  // The one place the app stops reporting and asks.
  //
  // Three taps on a Sunday, then it tells you what it's changing and why — the
  // "why" always naming both the answer and the measurement behind it, so an
  // adjustment never reads as an arbitrary number. Logic + rules live in
  // $lib/weekCheckIn; this component only feeds it live data and stores the
  // answers on daily_logs (see the 20260811120000 migration).
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveFoodLogs, liveDailyLogs, liveBiometrics, liveWorkoutLogs, liveProfile } from '$lib/stores/live';
  import { reviewInputs } from '$lib/stores/review';
  import { editing } from '$lib/commitments';
  import { cleanPlans } from '$lib/plans';
  import { weeklyReview } from '$lib/weeklyReview';
  import { body } from '$lib/stores/body';
  import { todayDate } from '$lib/stores/refresh';
  import { haptic } from '$lib/haptics';
  import {
    CHECK_IN_QUESTIONS, checkInAdjustment, reviewWeekStart, shouldAskCheckIn,
    type CheckInAnswers, type Effort, type Hunger, type Adherence,
  } from '$lib/weekCheckIn';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const _foodLogs = liveFoodLogs();
  const _dailyLogs = liveDailyLogs();
  const _bio = liveBiometrics();
  const _workoutLogs = liveWorkoutLogs();
  const _profile = liveProfile();

  const today = $derived($todayDate);
  const weekStart = $derived(reviewWeekStart(today));
  const weekEnd = $derived.by(() => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Weeks already answered — the key is the Monday the answers were filed under.
  const answeredWeeks = $derived(
    ($_dailyLogs as any[]).filter((l) => l?.week_check?.effort).map((l) => l.date)
  );
  const storedAnswers = $derived.by(() => {
    const row = ($_dailyLogs as any[]).find((l) => l.date === weekStart && l?.week_check?.effort);
    return (row?.week_check ?? null) as CheckInAnswers | null;
  });

  const daysLogged = $derived(new Set(($_foodLogs as any[]).map((f) => f.date)).size);
  const due = $derived(shouldAskCheckIn(today, answeredWeeks, daysLogged));

  // ── What was measured, for interpreting the answers against ───────────────
  // Weight, targets and protein come from stores/body — the same numbers the
  // Food page and Today show, so an adjustment is made against a target the
  // user has actually seen.
  const goalKg = $derived($body.goalKg);
  const proteinTargetG = $derived(goalKg ? $body.proteinTargetG : null);

  const ctx = $derived.by(() => {
    const inWeek = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= weekStart && r.date <= weekEnd);

    // The week's change is the TREND's — first-vs-last reading of one week is
    // mostly water and would read a flat week as a 1.5 kg swing.
    const w = $body.weight;
    const weightChangeKg = w && w.state !== 'not-enough' ? Math.round(-w.rateKgPerWeek * 10) / 10 : null;
    const currentWeightKg = $body.currentKg;

    const proteinByDate = new Map<string, number>();
    for (const f of $_foodLogs as any[]) {
      if (f.date < weekStart || f.date > weekEnd) continue;
      proteinByDate.set(f.date, (proteinByDate.get(f.date) ?? 0) + (f.protein_g || 0));
    }
    const avgProteinG = proteinByDate.size
      ? [...proteinByDate.values()].reduce((s, n) => s + n, 0) / proteinByDate.size
      : null;

    const sleeps = inWeek(($_bio as any[]).map((b) => ({ date: b.date, h: b.sleep_hours }))).map((b) => b.h).filter((h: any) => typeof h === 'number');
    const avgSleepH = sleeps.length ? sleeps.reduce((s: number, n: number) => s + n, 0) / sleeps.length : null;

    const sessions = new Set(inWeek(($_workoutLogs as any[]).map((w) => ({ date: w.date }))).map((w) => w.date)).size;

    // The engine's number without any earlier nudge, so a nudge never stacks.
    const targetKcal = $body.target.target != null ? $body.target.target - $body.target.adjustKcal : null;

    return { weightChangeKg, currentWeightKg, targetKcal, avgProteinG, proteinTargetG, avgSleepH, sessions, goalKg };
  });

  // ── Answering ─────────────────────────────────────────────────────────────
  let effort = $state<Effort | ''>('');
  let hunger = $state<Hunger | ''>('');
  let adherence = $state<Adherence | ''>('');
  let saving = $state(false);
  let error = $state('');
  let justSaved = $state(false);

  const answers = $derived(storedAnswers ?? (effort && hunger && adherence ? { effort, hunger, adherence } as CheckInAnswers : null));
  const result = $derived(answers ? checkInAdjustment(answers, ctx) : null);
  const answeredCount = $derived([effort, hunger, adherence].filter(Boolean).length);

  function pick(key: string, value: string) {
    haptic('tap');
    if (key === 'effort') effort = value as Effort;
    else if (key === 'hunger') hunger = value as Hunger;
    else adherence = value as Adherence;
  }

  function current(key: string): string {
    return key === 'effort' ? effort : key === 'hunger' ? hunger : adherence;
  }

  async function save() {
    if (!uid || !effort || !hunger || !adherence || saving) return;
    haptic('tap');
    saving = true;
    error = '';
    try {
      await upsertRecord('daily_logs', {
        user_id: uid,
        date: weekStart,
        // kcalDelta is what the answers change: stores/body applies it to the
        // following week's target, for that week only. A promise the app keeps.
        week_check: { effort, hunger, adherence, kcalDelta: result?.kcalDelta ?? 0, answeredAt: new Date().toISOString() },
      });
      justSaved = true;
    } catch (e: any) {
      error = 'Could not save — ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }

  // The week under review, as the share sheet sends it, with the plan most
  // likely to matter next week.
  const review = $derived(weeklyReview({ ...$reviewInputs, today: weekEnd }));
  const plans = $derived(cleanPlans(($_profile as any)?.plans));
  const sharedPlan = $derived(plans.weekend ?? plans.friday ?? plans.badminton ?? plans.evening ?? null);
  let sharing = $state(false);
  let shareMsg = $state('');
  async function share() {
    if (sharing) return;
    sharing = true;
    shareMsg = '';
    try {
      const { shareWeek } = await import('$lib/weeklyShare');
      shareMsg = await shareWeek(review, { name: ($_profile as any)?.display_name ?? null, plan: sharedPlan });
    } catch (e: any) {
      shareMsg = 'Share failed: ' + (e?.message || String(e)).slice(0, 100);
    } finally {
      sharing = false;
    }
  }

  const fmtDay = (s: string) => {
    const [, m, d] = s.split('-').map(Number);
    return `${d}/${m}`;
  };
</script>

{#if due || justSaved}
  <div class="card wc" class:answered={!!result && (!!storedAnswers || justSaved)}>
    <div class="wc-h">
      <span class="wc-eyebrow">Week of {fmtDay(weekStart)}–{fmtDay(weekEnd)}</span>
      <h3 class="wc-title">{result && (storedAnswers || justSaved) ? result.headline : 'How was your week?'}</h3>
    </div>

    {#if result && (storedAnswers || justSaved)}
      <!-- Answered. Show what changes and why — every reason names both the
           answer and the measurement, so no adjustment reads as arbitrary. -->
      {#if result.kcalDelta !== 0}
        <div class="wc-target">
          <span class="wc-target-n">{result.kcalDelta > 0 ? '+' : '−'}{Math.abs(result.kcalDelta)}</span>
          <span class="wc-target-l">kcal a day on next week's target, for that week</span>
        </div>
      {/if}
      <ul class="wc-reasons">
        {#each result.reasons as r}<li>{r}</li>{/each}
        {#if result.trainingNote}<li class="wc-train">🏋 {result.trainingNote}</li>{/if}
      </ul>
      <!-- Someone else knowing how the week went is one of the few things with
           real evidence for keeping weight off. One tap, the OS share sheet,
           the user picks who — the app never learns. -->
      {#if !sharedPlan}
        <button class="btn bg_ bfl wc-share" onclick={() => editing.set('plans')}>Plan next week's weekend</button>
      {/if}
      <button class="btn bg_ bfl wc-share" onclick={share} disabled={sharing}>{sharing ? '…' : 'Send my week to someone'}</button>
      {#if shareMsg}<div class="wc-share-msg">{shareMsg}</div>{/if}
    {:else}
      <p class="wc-lede">Three taps. The scale and your watch can't tell me how it felt — and that's what decides whether this plan lasts.</p>

      {#each CHECK_IN_QUESTIONS as q}
        <div class="wc-q">
          <div class="wc-prompt">{q.prompt}</div>
          <div class="wc-opts">
            {#each q.options as o}
              <button class="wc-opt" class:on={current(q.key) === o.value} onclick={() => pick(q.key, o.value)}>
                <b>{o.label}</b><em>{o.hint}</em>
              </button>
            {/each}
          </div>
        </div>
      {/each}

      <button class="btn bp bfl" disabled={answeredCount < 3 || saving} onclick={save}>
        {saving ? 'Saving…' : answeredCount < 3 ? `${answeredCount}/3 answered` : 'See what changes →'}
      </button>
      {#if error}<div class="wc-err">{error}</div>{/if}
    {/if}
  </div>
{/if}

<style>
  .wc{border-color:color-mix(in srgb,var(--amber) 30%,transparent)}
  .wc.answered{border-color:color-mix(in srgb,var(--green) 34%,transparent)}
  .wc-h{margin-bottom:8px}
  .wc-eyebrow{font-size:0.6875rem;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
  .wc-title{font-size:1.0625rem;font-weight:900;letter-spacing:-.3px;margin:2px 0 0;color:var(--text)}
  .wc-lede{font-size:0.8125rem;line-height:1.45;color:var(--muted);margin:0 0 12px}

  .wc-q{margin-bottom:10px}
  .wc-prompt{font-size:0.8125rem;font-weight:800;color:var(--text);margin-bottom:6px}
  .wc-opts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .wc-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;cursor:pointer;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:12px;padding:8px 9px;
    transition:transform .18s var(--ease),border-color .18s var(--ease),background .18s var(--ease)}
  .wc-opt:active{transform:scale(.95)}
  .wc-opt.on{border-color:var(--amber);background:var(--ab)}
  .wc-opt b{font-size:0.75rem;font-weight:800;color:var(--text);line-height:1.2}
  .wc-opt em{font-style:normal;font-size:0.6875rem;line-height:1.3;color:var(--muted)}

  .wc-target{display:flex;align-items:baseline;gap:8px;margin:4px 0 10px;padding:10px 12px;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:14px}
  .wc-target-n{font-size:1.5rem;font-weight:900;letter-spacing:-.6px;color:var(--text)}
  .wc-target-l{font-size:0.75rem;font-weight:700;color:var(--muted)}

  .wc-reasons{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
  .wc-reasons li{font-size:0.8125rem;line-height:1.45;color:var(--text);
    padding-left:12px;border-left:2px solid var(--glass-brd)}
  .wc-reasons li.wc-train{border-left-color:var(--amber)}
  .wc-err{font-size:0.75rem;color:var(--red);text-align:center;margin-top:6px}
  .wc-share{margin-top:12px}
  .wc-share + .wc-share{margin-top:8px}
  .wc-share-msg{font-size:0.75rem;font-weight:700;color:var(--led-good);text-align:center;margin-top:6px}
</style>
