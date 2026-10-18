<script lang="ts">
  import { liveWeights, liveGoal, liveGoalReason, liveSchedule, liveWorkoutSessions, liveSessionCompletions, liveDailySteps, liveBiometrics, liveWorkoutLogs, liveActivitySessions, liveDailyLogs } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import { liveProfile } from '$lib/stores/live';
  import { DEFAULT_SESSIONS } from '$lib/data/workoutPlanDefaults';
  import { buildSchedule } from '$lib/data/planTemplates';

  // Neutral fallback only — the real week comes from the user's own schedule.
  const FALLBACK_SCHEDULE = buildSchedule({ templateId: 'gym3' });
  import { base } from '$app/paths';
  import { cardNav } from '$lib/actions/cardNav';
  import { morningsThisWeek } from '$lib/scale';
  import { saveWeighIn, NeedsConfirm } from '$lib/weighIn';
  import { buildDailyFocus, waterTargetLitres } from '$lib/coach';
  import { body, stall, line } from '$lib/stores/body';
  import { editing } from '$lib/commitments';
  import { cleanPlans } from '$lib/plans';
  import CommitmentAlerts from '$lib/components/CommitmentAlerts.svelte';
  import MilestoneMoment from '$lib/components/MilestoneMoment.svelte';
  import MonthLetter from '$lib/components/MonthLetter.svelte';
  import Commitments from '$lib/components/Commitments.svelte';
  import { strengthTrend } from '$lib/strength';
  import { primaryActivity } from '$lib/health/exercise';
  import DailyFocus from '$lib/components/DailyFocus.svelte';
  import TodayPulse from '$lib/components/TodayPulse.svelte';
  import WeekCheckIn from '$lib/components/WeekCheckIn.svelte';
  import BackRebuild from '$lib/components/BackRebuild.svelte';
  import { shiftYmd } from '$lib/date';
  import { programActive, badmintonRule } from '$lib/program';
  import { nowTick, todayDate } from '$lib/stores/refresh';

  const dayIdx = $derived(new Date($nowTick).getDay());
  const today = $derived($todayDate);
  const dayName = $derived(new Date($nowTick).toLocaleDateString('en-US', { weekday: 'long' }));
  const dateStr = $derived(new Date($nowTick).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  const greeting = $derived.by(() => {
    const h = new Date($nowTick).getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  });

  const _weights = liveWeights();
  const _goal = liveGoal();
  const _goalReason = liveGoalReason();
  const _profile = liveProfile();
  // No hardcoded fallback: onboarding guarantees a goal, and inventing someone
  // else's target is worse than showing none.
  const GOAL_KG = $derived($_goal ?? 0);

  // — Today's meal plan (from the Nutrition/Recipes page's weekly plan) —
  // The "Today's Meal" card and its meal_plans lookup are gone. Its planner was
  // deleted in 3319060, so nothing has written meal_plans since — the card could
  // only ever render its empty branch, which told users to go set a meal on a
  // page that no longer offers one. The legacy rows held integer ids into the
  // static recipe array, which is also now deleted, so they are unresolvable;
  // recipes_custom uses UUIDs and there is no remapping.

  // — Today's gym session (from the Workouts page's weekly schedule) —
  const _schedule = liveSchedule();
  const _sessions = liveWorkoutSessions();
  const _completions = liveSessionCompletions();
  const todaySchedule = $derived.by(() => {
    const sched = $_schedule.length > 0 ? $_schedule : FALLBACK_SCHEDULE;
    return sched.find((d: any) => d.day_of_week === dayIdx) ?? null;
  });
  const todaySession = $derived.by(() => {
    if (!todaySchedule?.session_key) return null;
    const sessions = $_sessions.size > 0 ? $_sessions : new Map(DEFAULT_SESSIONS.map((s) => [s.key, s]));
    return sessions.get(todaySchedule.session_key) ?? null;
  });
  const todaySessionDone = $derived(
    !!todaySchedule?.session_key && $_completions.some((c: any) => c.date === today && c.type === todaySchedule.session_key)
  );
  // This week's mornings on the scale. Not a streak: a missed morning costs one
  // morning, never the whole count, and Monday starts fresh.
  const mornings = $derived(morningsThisWeek($_weights as any[], today));

  let editingGoal = $state(false);
  let goalInput = $state('');

  async function saveGoal() {
    if (!uid || !goalInput) return;
    const g = parseFloat(goalInput);
    if (!g || g <= 0) return;
    try {
      await upsertRecord('user_settings', { user_id: uid, goal_kg: g, updated_at: new Date().toISOString() });
      editingGoal = false;
    } catch (e) { console.error('Goal save failed:', e); }
  }

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let weight = $state('');
  let saving = $state(false);
  let saveMsg = $state('');
  /** A reading far off the trend, waiting for its second tap. */
  let confirmKg = $state<number | null>(null);

  // Every weight number on this screen is the trend's (stores/body): one
  // morning's reading swings a kilo either way and is never the headline.
  const currentKg = $derived($body.currentKg);
  const todayWeighIn = $derived(($_weights as any[]).find((w) => w.date === today) ?? null);
  // The raw reading stays visible beside the trend — the trend replaces it as
  // the headline, never as the record.
  const lastWeighIn = $derived(($_weights as any[]).at(-1) ?? null);
  const lastWeighLabel = $derived(lastWeighIn
    ? `${lastWeighIn.weight} on ${new Date(lastWeighIn.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
    : null);



  // The morning weigh-in. This card once took a bare kcal number too, written
  // to daily_logs.kcal — a second, item-less food log that the Food page never
  // saw and that competed with it in every calorie sum. Food has one way in now.
  async function saveEntry(what: 'weight') {
    if (!uid) { saveMsg = 'Not signed in — please sign back in.'; return; }
    saving = true;
    saveMsg = '';
    try {
      if (what === 'weight' && weight) {
        const kg = parseFloat(weight);
        await saveWeighIn(uid, kg, {
          today, weights: $_weights as any[], goalKg: $body.goalKg, trendKg: currentKg, confirmed: confirmKg === kg,
          startKg: ($_profile as any)?.start_kg != null ? +($_profile as any).start_kg : null,
        });
        weight = '';
        confirmKg = null;
      }
    } catch (e: any) {
      if (e instanceof NeedsConfirm) { confirmKg = parseFloat(weight); saveMsg = e.message; return; }
      console.error('Log failed:', e);
      saveMsg = 'Save failed: ' + (e?.message || e?.error_description || String(e)).slice(0, 150);
    } finally {
      saving = false;
    }
  }

  const _steps = liveDailySteps();
  const _dailyLogs = liveDailyLogs();
  // Today's daily_logs row, derived reactively from the full set + the reactive
  // `today` — so when the calendar day rolls over (a native app left open past
  // midnight), this snaps to the new, empty day instead of showing yesterday's
  // kcal/water as if they were today's. The old `liveLog(today)` captured the
  // date once at mount and never rolled over.
  const todayLog = $derived(($_dailyLogs as any[]).find((l: any) => l.date === today) ?? null);
  // Steps live in their own `steps` table (field `count`), NOT on
  // daily_logs — the old `$_todayLog?.steps` always read undefined so
  // steps never displayed. Take the most recent entry logged today.
  const todaySteps = $derived($_steps.get(today) ?? null);
  // Water is logged under Progress → Body & Goals now; the coach still reads it.
  const todayWater = $derived(todayLog?.water_glasses ?? 0);
  const waterGoalL = $derived(waterTargetLitres(currentKg));

  // — Daily Focus coaching layer —
  // Derive prioritised, actionable guidance from every signal the app
  // collects (calories, protein, sleep, steps, water, weight trend, training —
  // including watch/Health-Connect data) framed toward the goal weight.
  const _biometrics = liveBiometrics();
  const _workoutLogs = liveWorkoutLogs();
  const _activity = liveActivitySessions();

  // Muscle-retention read from the lift log (see $lib/strength): are the main
  // lifts holding/climbing while the fat comes off? Feeds the coach headline.
  const strengthRead = $derived(strengthTrend($_workoutLogs as any));

  // Today's watch-recorded workout (badminton, run, strength) if the OnePlus
  // watch caught one — lets the coach confirm the session with real numbers.
  const watchToday = $derived.by(() => {
    const a = primaryActivity(($_activity as any[]) || [], today);
    if (!a) return null;
    return {
      label: a.label,
      emoji: a.emoji,
      kind: a.kind,
      durationMin: a.duration_min,
      kcal: a.active_kcal,
      distanceM: a.distance_m,
    };
  });

  // Per-day totals come from stores/body — the same map every screen reads,
  // with quick-logged kcal standing in for days that have no itemised food.
  const coachTodayKcal = $derived($body.intake.get(today)?.kcal ?? null);
  const coachTodayProtein = $derived($body.intake.get(today)?.protein ?? null);
  const todayShare = $derived($body.week?.share ?? null);
  // Trained today: the session marked done on the Gym page, a set logged, or
  // the watch saw a workout.
  const trainedToday = $derived(todaySessionDone || ($_workoutLogs as any[]).some((w) => w.date === today) || !!watchToday);

  const daysElapsedThisWeek = $derived(dayIdx === 0 ? 7 : dayIdx); // Mon=1..Sun=7

  // Steps: latest reading per day, averaged over days with data in the last 7.
  const stepsWeekAvg = $derived.by(() => {
    const cutoff = shiftYmd(-7, new Date(`${today}T12:00:00`));
    const week = [...$_steps].filter(([d]) => d >= cutoff).map(([, c]) => c);
    return week.length ? week.reduce((a, b) => a + b, 0) / week.length : null;
  });

  // Last night's sleep = the entry Health Connect files under today's WAKE day
  // (a night is attributed to the morning you get up). If the watch wasn't worn
  // last night there is simply NO entry for today — and we deliberately do NOT
  // fall back to an older night. Coaching "you slept 7h last night" off a
  // two-day-old reading was exactly the stale-data trap; a missing night should
  // read as missing, not as last night. Freshness is surfaced honestly instead.
  const lastSleep = $derived.by(() => {
    void $nowTick;
    return ($_biometrics as any[]).find((b) => b.sleep_hours != null && b.date === today) ?? null;
  });


  // What KIND of day is today? A gym session, an ACTIVE day (badminton/
  // cardio with no barbell session), or a true rest day. Badminton days have
  // session_key === null but are NOT rest — the old logic mislabelled them.
  const dayInfo = $derived.by(() => {
    const lbl = (todaySchedule?.label || '').toLowerCase();
    const note = (todaySchedule?.note || '').toLowerCase();
    if (todaySession) return { kind: 'gym' as const, label: todaySession.name };
    const hay = `${lbl} ${note}`;
    if (/badminton|cardio|agility|walk|run|swim|sport|tennis|cycl/.test(hay)) {
      const label = /badminton/.test(hay) ? 'Badminton' : (todaySchedule?.label || 'Active');
      return { kind: 'active' as const, label };
    }
    return { kind: 'rest' as const, label: 'Rest' };
  });

  // Movement snack rotates through the day — tick the hour so it refreshes
  // without a reload (the user asked for hourly-updating suggestions).
  let nowHour = $state(new Date().getHours());
  $effect(() => {
    const t = setInterval(() => { nowHour = new Date().getHours(); }, 10 * 60 * 1000);
    return () => clearInterval(t);
  });

  const GLASS_L = 0.25; // each logged "glass" = 250 ml

  // The moment the plans are matched against (see $lib/plans).
  // While a program says no games, a badminton night isn't one: no "after
  // badminton" plan, and the Today card says what the plan says instead.
  const bRule = $derived(badmintonRule(($_profile as any)?.program, today));
  const badmintonDay = $derived((dayInfo.label === 'Badminton' && bRule?.play !== false) || watchToday?.label === 'Badminton');
  const planCount = $derived(Object.keys(cleanPlans(($_profile as any)?.plans)).length);

  const focusItems = $derived(
    buildDailyFocus({
      goalKg: GOAL_KG,
      currentWeight: currentKg,
      rateKgPerWeek: $body.weight?.rateKgPerWeek ?? 0,
      pace: $body.pace,
      planKgPerWeek: $body.target.planKgPerWeek,
      weeksToGoal: $body.weeksToGoal,
      weighInsNeeded: $body.weight?.weighInsNeeded ?? null,
      stall: $stall,
      totalLostKg: $body.firstKg != null && currentKg != null ? +($body.firstKg - currentKg).toFixed(1) : null,
      calorieTarget: $body.target.target,
      todayKcal: coachTodayKcal,
      weekKcalSoFar: $body.week?.logged ?? 0,
      daysElapsedThisWeek,
      proteinTarget: $body.proteinTargetG,
      todayProtein: coachTodayProtein,
      sleepHours: lastSleep?.sleep_hours ?? null,
      sleepQuality: lastSleep?.sleep_quality ?? null,
      stepsToday: todaySteps,
      stepsWeekAvg,
      waterToday: todayWater * GLASS_L,
      waterTarget: waterGoalL,
      dayKind: dayInfo.kind,
      activityLabel: dayInfo.label,
      workoutDoneToday: todaySessionDone,
      strengthTrend: strengthRead,
      inProgram: programActive(($_profile as any)?.program, today),
      watchActivityToday: watchToday,
      hour: nowHour,
    })
  );</script>

<TodayPulse greeting={greeting} sub={`${dayName} · ${dateStr}`} {mornings} />

<!-- MORNING WEIGH-IN. The trend is only as good as the mornings behind it — a
     month of 13 weigh-ins left it a kilo wide either way — so the scale gets the
     top of the screen until today's reading is in, then shrinks to one line. -->
{#if todayWeighIn}
  <div class="mw-done">Weighed <b>{todayWeighIn.weight}</b> today{#if currentKg != null}{' · '}trend <b>{currentKg.toFixed(1)}</b> kg{/if}{#if $line && !$line.misdrawn}{' · '}ceiling <b class="mw-line z-{$line.zone}">{$line.kg.toFixed(1)}</b>{/if}</div>
{:else}
  <div class="card mw">
    <div class="mw-top">
      <label class="card-lbl" for="ql-weight">Morning weigh-in</label>
      {#if currentKg != null}<span class="mw-trend">trend <b>{currentKg.toFixed(1)}</b> kg{#if $line && !$line.misdrawn}{' · '}ceiling <b class="mw-line z-{$line.zone}">{$line.kg.toFixed(1)}</b>{/if}</span>{/if}
    </div>
    <div class="mw-row">
      <input id="ql-weight" type="number" inputmode="decimal" step="0.1" bind:value={weight}
        placeholder={currentKg != null ? currentKg.toFixed(1) : 'kg'}
        onkeydown={(e) => e.key === 'Enter' && saveEntry('weight')}>
      <button class="btn bp" onclick={() => saveEntry('weight')} disabled={saving || !weight}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
    {#if saveMsg}<div class="mw-err">{saveMsg}</div>{/if}
    <p class="mw-hint">{#if lastWeighLabel}Last reading {lastWeighLabel}.{' '}{/if}Same time, before food or drink. One morning is noise; the trend — the line through five weeks of mornings — is the number.</p>
  </div>
{/if}

<!-- A next stop held for three days: shown once, then the next one is chosen. -->
<MilestoneMoment />

<!-- The 1st to the 3rd: last month, told back. -->
<MonthLetter />

<!-- The line, when the trend is over it, and the plan whose moment it is.
     Nothing on an ordinary day. -->
<CommitmentAlerts moment={{ hour: nowHour, dow: dayIdx, badmintonDay, backPain: todayLog?.back_pain ?? null }} />

<!-- Sits directly under the Pulse and only on Sun/Mon/Tue, once per week — the
     one moment the app asks instead of reports. Renders nothing otherwise. -->
<WeekCheckIn />

<!-- Only while a program runs: the one-tap morning rating that paces it. -->
<BackRebuild compact />

<DailyFocus items={focusItems} />


<!-- TODAY: the day in one card, what's left to eat and what's on, each row
     going where you'd act on it. It replaced six cards (food stats, the gym
     session, the alarm list, water, manual steps and the goal's reasoning)
     that each said a little and together said too much. Water and the goal's
     reasoning live under Progress → Body & Goals; steps come from the watch. -->
<div class="card td">
  <div class="td-row" use:cardNav={`${base}/recipes`}>
    <span class="td-k">Food</span>
    <span class="td-v">
      {#if coachTodayKcal}<b>{Math.round(coachTodayKcal).toLocaleString()}</b>{#if todayShare}{' '}of {todayShare.toLocaleString()} kcal{:else}{' '}kcal{/if}{:else}Nothing logged yet{/if}
    </span>
    <span class="td-go" aria-hidden="true">›</span>
  </div>
  <div class="td-sub">
    {Math.round(coachTodayProtein ?? 0)} of {$body.proteinTargetG} g protein{#if todaySteps != null}{' · '}{todaySteps.toLocaleString()} steps{/if}
  </div>
  <div class="td-row" use:cardNav={`${base}/workouts`}>
    <span class="td-k">{dayInfo.kind === 'gym' ? 'Gym' : dayInfo.kind === 'active' ? dayInfo.label : 'Rest'}</span>
    <span class="td-v">
      {#if todaySession}{todaySession.name}{:else if dayInfo.label === 'Badminton' && bRule}{bRule.text[0].toUpperCase() + bRule.text.slice(1)}{:else if dayInfo.kind === 'active'}{todaySchedule?.time ? `at ${todaySchedule.time}` : 'today'}{:else}A walk counts{/if}{#if trainedToday}{' '}<span class="td-done">✓ done</span>{/if}
    </span>
    <span class="td-go" aria-hidden="true">›</span>
  </div>
</div>

<!-- What you've committed to: the next stop below you, the goal past it, the
     ceiling above you that you don't go back over, and what you'll do when the
     hard moments come. -->
<div class="cm-row">
  <button class="cm-chip" onclick={() => editing.set('next')}><span>Next stop</span><b class:cm-todo={!$body.next}>{$body.next ? `${$body.next.kg} kg${$body.next.reached ? ' ✓' : ''}` : 'Set'}</b></button>
  {#if editingGoal}
    <!-- svelte-ignore a11y_autofocus -->
    <input class="cm-goal-in" type="number" step="0.5" bind:value={goalInput} aria-label="Goal weight, kg"
      onkeydown={(e) => e.key === 'Enter' && saveGoal()} onblur={saveGoal} autofocus>
  {:else}
    <button class="cm-chip" onclick={() => { editingGoal = true; goalInput = GOAL_KG.toString(); }}><span>Goal</span><b>{GOAL_KG} kg</b></button>
  {/if}
  <button class="cm-chip" onclick={() => editing.set('line')}><span>Ceiling</span><b class:cm-todo={!$line || $line.misdrawn}>{$line && !$line.misdrawn ? `${$line.kg.toFixed(1)} kg` : 'Set'}</b></button>
  <button class="cm-chip" onclick={() => editing.set('plans')}><span>Plans</span><b class:cm-todo={!planCount}>{planCount || 'Make'}</b></button>
</div>
<Commitments />

<style>
  .mw{padding:13px 14px}
  .mw-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px}
  .mw-top .card-lbl{margin:0}
  .mw-trend{font-size:0.8125rem;color:var(--muted)}
  .mw-trend b{font-family:var(--font-display);font-size:1.125rem;color:var(--text)}
  .mw-row{display:flex;gap:8px}
  .mw-row input{flex:1;min-width:0;font-size:1.25rem;font-weight:700;text-align:center;font-variant-numeric:lining-nums tabular-nums}
  .mw-row .btn{flex-shrink:0;min-width:88px}
  .mw-hint{font-size:0.75rem;color:var(--muted);margin-top:7px;line-height:1.45}
  .mw-err,.mw-msg{font-size:0.75rem;margin-top:6px;color:var(--led-good)}
  .mw-err,.mw-msg.bad{color:var(--led-bad)}
  .mw-done{font-size:0.8125rem;color:var(--muted);margin:-4px 2px 14px}
  .mw-done b{font-family:var(--font-display);font-size:1.0625rem;color:var(--text)}
  .mw-line.z-over{color:var(--led-warn)}
  .mw-line.z-well-over{color:var(--led-bad)}
  .cm-row{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:2px 0 14px}
  .cm-chip{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0;cursor:pointer;font-family:inherit;color:inherit;
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md);padding:9px 11px;text-align:left;
    transition:transform .18s var(--ease),border-color .15s}
  .cm-chip:active{transform:scale(.97)}
  .cm-chip span{font-family:var(--font-label);font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  .cm-chip b{font-family:var(--font-display);font-size:1.25rem;font-weight:700;line-height:1;color:var(--text);white-space:nowrap}
  .cm-chip b.cm-todo{color:var(--muted);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2)}
  .cm-goal-in{text-align:center;min-width:0}
  .td{padding:6px 14px}
  .td-row{display:flex;align-items:baseline;gap:12px;padding:9px 0;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .td-row + .td-sub + .td-row{border-top:1px solid var(--border);margin-top:9px}
  .td-k{font-family:var(--font-label);font-size:0.8125rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);min-width:76px}
  .td-v{flex:1;min-width:0;font-size:0.9375rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .td-v b{font-family:var(--font-display);font-size:1.25rem;font-weight:700}
  .td-sub{font-size:0.75rem;color:var(--muted);margin:-6px 0 0 88px}
  .td-go{color:var(--muted);font-size:1.25rem;line-height:1}
  .td-done{color:var(--led-good);font-weight:700;font-size:0.8125rem}
</style>
