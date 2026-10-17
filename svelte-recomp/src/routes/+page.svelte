<script lang="ts">
  import { liveAlarms, liveWeights, liveGoal, liveActivityDates, liveGoalReason, liveSchedule, liveWorkoutSessions, liveSessionCompletions, liveSteps, liveFoodLogs, liveBiometrics, liveWorkoutLogs, liveActivitySessions, liveDailyLogs } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import db from '$lib/db/dexie';
  import { liveProfile } from '$lib/stores/live';
  import { DEFAULT_SESSIONS } from '$lib/data/workoutPlanDefaults';
  import { buildSchedule } from '$lib/data/planTemplates';

  // Neutral fallback only — the real week comes from the user's own schedule.
  const FALLBACK_SCHEDULE = buildSchedule({ templateId: 'gym3' });
  import { base } from '$app/paths';
  import { cardNav } from '$lib/actions/cardNav';
  import { computeStreak, isStreakMilestone, streakBlurb } from '$lib/streaks';
  import { speak } from '$lib/stores/toast';
  import { haptic } from '$lib/haptics';
  import { buildDailyFocus, parseCalorieTarget, goalSummary, waterTargetLitres, weightTrend } from '$lib/coach';
  import { adaptiveTdee, targetIntakeForLoss } from '$lib/adaptiveTdee';
  import { strengthTrend } from '$lib/strength';
  import { primaryActivity } from '$lib/health/exercise';
  import DailyFocus from '$lib/components/DailyFocus.svelte';
  import TodayPulse from '$lib/components/TodayPulse.svelte';
  import WeekCheckIn from '$lib/components/WeekCheckIn.svelte';
  import BackRebuild from '$lib/components/BackRebuild.svelte';
  import { todayYmd, shiftYmd, mondayOf } from '$lib/date';
  import { nowTick } from '$lib/stores/refresh';

  const dayIdx = $derived(new Date($nowTick).getDay());
  const today = $derived.by(() => { void $nowTick; return todayYmd(); });
  const dayName = $derived(new Date($nowTick).toLocaleDateString('en-US', { weekday: 'long' }));
  const dateStr = $derived(new Date($nowTick).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  const greeting = $derived.by(() => {
    const h = new Date($nowTick).getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  });

  const _alarms = liveAlarms();
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
  let markingSessionDone = $state(false);
  async function markTodaySessionComplete() {
    if (!uid || !todaySchedule?.session_key || todaySessionDone) return;
    markingSessionDone = true;
    try {
      await upsertRecord('sessions', {
        user_id: uid, date: today, type: todaySchedule.session_key,
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Mark complete failed:', e);
    } finally { markingSessionDone = false; }
  }

  // Streak: consecutive days with ANY logged activity (weigh-in, food,
  // workout, or the quick-log card), with a 1-day "shield" so a single
  // missed day doesn't wipe out weeks of consistency (Noom/Lose It-style
  // adherence mechanic -- loss aversion is a genuinely effective nudge).
  const _activityDates = liveActivityDates();
  const streak = $derived(computeStreak($_activityDates, today, 1));

  // Celebrate a streak milestone the moment it's earned — but only on a genuine
  // +1 daily increment while the app is open, never on the initial data-load
  // jump (which arrives as one big leap, not a step). So a milestone fires the
  // instant your logging tips it over, and stays silent every other launch.
  let prevStreak = -1;
  $effect(() => {
    const c = streak.current;
    if (prevStreak === -1) { prevStreak = c; return; } // baseline, no fanfare
    if (c === prevStreak + 1 && isStreakMilestone(c)) {
      speak(`streak-${c}`, `${c}-day streak! 🔥`, {
        tone: 'good', icon: '🔥', ttl: 8000, body: streakBlurb(c),
      });
      haptic('celebrate');
    }
    prevStreak = c;
  });

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
  let steps = $state('');
  let saving = $state(false);
  let saveMsg = $state('');

  const firstWeight = $derived.by(() => {
    const w = $_weights;
    return w.length > 0 ? w[0].weight : null;
  });
  const recentWeight = $derived.by(() => {
    const w = $_weights;
    return w.length > 0 ? w[w.length - 1].weight : null;
  });
  const kgLost = $derived(firstWeight && recentWeight ? (firstWeight - recentWeight).toFixed(1) : '--');


  function weeklyLoss(): number {
    const w = $_weights;
    if (w.length < 2) return 0;
    const last7 = w.filter((r: any) => {
      const daysAgo = (Date.now() - new Date(r.created_at || r.date).getTime()) / 86400000;
      return daysAgo <= 14;
    });
    if (last7.length < 2) return 0;
    const oldest = last7[0].weight;
    const newest = last7[last7.length - 1].weight;
    const diff = oldest - newest;
    const days = last7.length > 1 ? (new Date(last7[last7.length - 1].date).getTime() - new Date(last7[0].date).getTime()) / 86400000 : 1;
    return days > 0 ? (diff / days) * 7 : 0;
  }

  const weeksToGoal = $derived.by(() => {
    if (!recentWeight || recentWeight <= GOAL_KG) return 0;
    const wl = weeklyLoss();
    if (wl <= 0) return '--';
    return Math.ceil((recentWeight - GOAL_KG) / wl);
  });

  // Weight and steps only. This card also took a bare kcal number, written to
  // daily_logs.kcal — a second, item-less food log that the Food page never
  // saw and that competed with it in every calorie sum. Food has one way in now.
  async function quickLog() {
    if (!uid) { saveMsg = 'Not signed in — please sign back in.'; return; }
    if (!weight && !steps) { saveMsg = 'Enter a weight or steps first.'; return; }
    saving = true;
    saveMsg = '';
    try {
      if (weight) {
        const existing = await db.table('weights').where('[user_id+date]').equals([uid, today]).first();
        await upsertRecord('weights', {
          id: existing?.id || undefined,
          user_id: uid, date: today, weight: parseFloat(weight),
          created_at: new Date().toISOString(),
        });
      }
      if (steps) {
        await upsertRecord('steps', {
          user_id: uid, date: today, count: parseInt(steps),
          created_at: new Date().toISOString(),
        });
      }
      weight = ''; steps = '';
      saveMsg = 'Saved ✓';
      setTimeout(() => { saveMsg = ''; }, 3000);
    } catch (e: any) {
      console.error('Log failed:', e);
      saveMsg = 'Save failed: ' + (e?.message || e?.error_description || String(e)).slice(0, 150);
    } finally {
      saving = false;
    }
  }

  const _steps = liveSteps();
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
  const todaySteps = $derived.by(() => {
    const t = [...$_steps].filter((s: any) => s.date === today);
    if (t.length === 0) return null;
    const latest = t.sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''))[t.length - 1];
    return latest?.count ?? null;
  });
  const todayWater = $derived(todayLog?.water_glasses ?? 0);
  const waterGoalL = $derived(waterTargetLitres(recentWeight));

  // Water logging surfaced on Today (was buried under Body & Goals). Each
  // tap = one 250 ml glass; stored as water_glasses, shown/targeted in L.
  async function addWater() {
    if (!uid) return;
    const next = Math.min(todayWater + 1, 20);
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next }); }
    catch (e) { console.error('Water save failed:', e); }
  }
  async function removeWater() {
    if (!uid || todayWater <= 0) return;
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: todayWater - 1 }); }
    catch (e) { console.error('Water save failed:', e); }
  }

  // — Daily Focus coaching layer —
  // Derive prioritised, actionable guidance from every signal the app
  // collects (calories, protein, sleep, steps, water, weight trend, training —
  // including watch/Health-Connect data) framed toward the goal weight.
  const _foodLogs = liveFoodLogs();
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

  // Per-day calorie + protein totals from the detailed food log (the same
  // source the Nutrition page trusts). Falls back to the quick-logged single
  // kcal number on daily_logs for days with no itemised food.
  const foodByDate = $derived.by(() => {
    const m = new Map<string, { kcal: number; protein: number }>();
    for (const f of $_foodLogs) {
      const cur = m.get(f.date) ?? { kcal: 0, protein: 0 };
      cur.kcal += f.kcal || 0;
      cur.protein += f.protein_g || 0;
      m.set(f.date, cur);
    }
    return m;
  });

  const coachTodayKcal = $derived.by(() => {
    const fromFood = foodByDate.get(today)?.kcal ?? 0;
    if (fromFood > 0) return fromFood;
    return todayLog?.kcal ?? null;
  });
  const coachTodayProtein = $derived(foodByDate.get(today)?.protein ?? null);

  const weekMonday = $derived(mondayOf(new Date($nowTick)));
  const daysElapsedThisWeek = $derived(dayIdx === 0 ? 7 : dayIdx); // Mon=1..Sun=7
  const weekKcalSoFar = $derived.by(() => {
    let sum = 0;
    for (const [date, v] of foodByDate) {
      if (date >= weekMonday && date <= today) sum += v.kcal;
    }
    // include today's quick-logged kcal if no itemised food covers it
    if ((foodByDate.get(today)?.kcal ?? 0) === 0 && todayLog?.kcal) sum += todayLog.kcal;
    return sum;
  });

  // Steps: latest reading per day, averaged over days with data in the last 7.
  const stepsWeekAvg = $derived.by(() => {
    const cutoff = shiftYmd(-7);
    const byDate = new Map<string, { count: number; at: string }>();
    for (const s of $_steps as any[]) {
      if (s.date < cutoff) continue;
      const prev = byDate.get(s.date);
      if (!prev || (s.created_at || '') >= prev.at) byDate.set(s.date, { count: s.count, at: s.created_at || '' });
    }
    if (byDate.size === 0) return null;
    let sum = 0;
    for (const v of byDate.values()) sum += v.count;
    return sum / byDate.size;
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

  // Robust weight trend (regression over ~28d) — kills daily water-weight
  // noise that made point-to-point deltas read as "dropping too fast".
  const wTrend = $derived(
    weightTrend(($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight })), GOAL_KG)
  );

  // Adaptive (LEARNED) TDEE — the user's real maintenance backed out from their
  // own intake vs weight trend, so the calorie target self-corrects from real
  // results instead of trusting the Mifflin-St Jeor formula forever. Intake
  // per day = itemised food_logs total, falling back to the quick-logged
  // daily_logs kcal for days with no itemised food (a fuller, less-biased set).
  const learnedTdee = $derived.by(() => {
    const intakeByDate = new Map<string, number>();
    for (const [date, v] of foodByDate) {
      if (v.kcal > 0) intakeByDate.set(date, v.kcal);
    }
    for (const l of $_dailyLogs as any[]) {
      if (!intakeByDate.has(l.date) && (l.kcal || 0) > 0) intakeByDate.set(l.date, l.kcal);
    }
    const intake = Array.from(intakeByDate, ([date, kcal]) => ({ date, kcal }));
    const weights = ($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight }));
    return adaptiveTdee({ intake, weights, asOf: today });
  });

  // Package for the coach: only surface a claim when there's enough data, and
  // pair it with an intake recommendation for a sustainable ~0.7 kg/wk loss.
  const coachTdee = $derived.by(() => {
    const t = learnedTdee;
    if (t.tdee == null || t.confidence === 'insufficient') return null;
    return {
      tdee: t.tdee,
      confidence: t.confidence,
      recommendedIntake: targetIntakeForLoss(t.tdee, 0.7),
      loggedDays: t.loggedDays,
    };
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

  const focusItems = $derived(
    buildDailyFocus({
      goalKg: GOAL_KG,
      currentWeight: recentWeight,
      weeklyLossRate: wTrend.rateKgPerWeek,
      plateau: wTrend.plateau,
      plateauWeeks: wTrend.plateauWeeks,
      trendSpanDays: wTrend.spanDays,
      totalLostKg: firstWeight != null && recentWeight != null ? +(firstWeight - recentWeight).toFixed(1) : null,
      weeksToGoal,
      calorieTarget: parseCalorieTarget($_goalReason),
      todayKcal: coachTodayKcal,
      weekKcalSoFar,
      daysElapsedThisWeek,
      proteinTarget: Math.round(GOAL_KG * 1.8),
      todayProtein: coachTodayProtein,
      sleepHours: lastSleep?.sleep_hours ?? null,
      sleepQuality: lastSleep?.sleep_quality ?? null,
      stepsToday: todaySteps,
      stepsWeekAvg,
      waterToday: todayWater * GLASS_L,
      waterTarget: waterTargetLitres(recentWeight),
      dayKind: dayInfo.kind,
      activityLabel: dayInfo.label,
      workoutDoneToday: todaySessionDone,
      strengthTrend: strengthRead,
      adaptiveTdee: coachTdee,
      watchActivityToday: watchToday,
      hour: nowHour,
    })
  );</script>

<TodayPulse greeting={greeting} sub={`${dayName} · ${dateStr}`}
  streak={streak.current} atRisk={streak.atRisk}
  kgLost={kgLost} kgNow={recentWeight ?? '--'} weeks={weeksToGoal} />

<!-- Sits directly under the Pulse and only on Sun/Mon/Tue, once per week — the
     one moment the app asks instead of reports. Renders nothing otherwise. -->
<WeekCheckIn />

<!-- Only while a program runs: the one-tap morning rating that paces it. -->
<BackRebuild compact />

<DailyFocus items={focusItems} />

<div class="flex ac jb" style="gap:10px;margin:2px 2px 14px">
  <span style="font-size:0.8rem;color:var(--muted);font-weight:700">🎯 Goal weight</span>
  {#if editingGoal}
    <!-- svelte-ignore a11y_autofocus -->
    <input type="number" step="0.5" bind:value={goalInput}
      onkeydown={(e) => e.key === 'Enter' && saveGoal()} onblur={saveGoal}
      style="width:96px;text-align:center" autofocus>
  {:else}
    <button class="btn bg_ bsm" onclick={() => { editingGoal = true; goalInput = GOAL_KG.toString(); }}>{GOAL_KG} kg ✎</button>
  {/if}
</div>

{#if $_goalReason}
  <div class="note-box">💡 {goalSummary($_goalReason)}</div>
{:else}
  <div class="note-box warn">⚠️ No math behind this goal yet — set a real one in <strong>Progress → Body &amp; Goals</strong>.</div>
{/if}

<div class="card">
  <div class="flex jb ac" style="margin-bottom:8px">
    <div class="card-lbl" style="margin-bottom:0">Water</div>
    <div style="font-size:0.8125rem;font-weight:700;color:var(--blue)">{(todayWater * 0.25).toFixed(2)} <span style="opacity:.6;font-weight:400">/ {waterGoalL.toFixed(1)} L</span></div>
  </div>
  <div class="flex gap2 ac">
    <button class="btn bg_ bsm" onclick={removeWater} disabled={todayWater <= 0} aria-label="Remove a glass" style="min-width:44px">−</button>
    <div class="f1" style="height:10px;background:var(--bg3);border-radius:6px;overflow:hidden">
      <div style="height:100%;width:{Math.min(100, (todayWater * 0.25 / waterGoalL) * 100)}%;background:var(--blue);border-radius:6px;transition:width .2s"></div>
    </div>
    <button class="btn bp bsm" onclick={addWater} aria-label="Add a 250 ml glass" style="min-width:44px">+</button>
  </div>
  <div style="font-size:0.6875rem;color:var(--muted);margin-top:6px;text-align:center">
    {#if todayWater * 0.25 >= waterGoalL}✓ Hydration goal met{:else}Tap + for each 250 ml glass{/if}
  </div>
</div>

<div class="card" use:cardNav={`${base}/recipes`}>
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">Today's Stats</div>
      <span class="card-link">{coachTodayKcal ? 'Food →' : 'Log food →'}</span>
    </div>
    <div class="flex gap2" style="font-size:0.8125rem;margin-top:10px">
      <div class="f1" style="background:var(--bg3);border-radius:8px;padding:8px;text-align:center">
        <div style="font-weight:700;color:var(--amber);font-size:1.125rem">{Math.round(coachTodayKcal ?? 0)}</div>
        <div style="font-size:0.6875rem;color:var(--muted)">kcal eaten</div>
      </div>
      {#if todaySteps !== null}
        <div class="f1" style="background:var(--bg3);border-radius:8px;padding:8px;text-align:center">
          <div style="font-weight:700;color:var(--green);font-size:1.125rem">{todaySteps.toLocaleString()}</div>
          <div style="font-size:0.6875rem;color:var(--muted)">steps</div>
        </div>
      {/if}
      <div class="f1" style="background:var(--bg3);border-radius:8px;padding:8px;text-align:center">
        <div style="font-weight:700;color:var(--blue);font-size:1.125rem">{(todayWater * 0.25).toFixed(1)}<span style="font-size:0.6875rem">L</span></div>
        <div style="font-size:0.6875rem;color:var(--muted)">water</div>
      </div>
    </div>
  </div>


<div class="card" use:cardNav={`${base}/workouts`}>
  <div class="flex jb ac">
    <div class="card-lbl" style="margin-bottom:0">Today's Gym Session</div>
    <span class="card-link">Gym →</span>
  </div>
  {#if todaySession}
    <div class="gi" style="padding:5px 0">
      <div class="gn"><strong>{todaySession.name}</strong></div>
      <div style="color:var(--amber);font-weight:600">{todaySession.duration}</div>
    </div>
    <div style="font-size:0.75rem;color:var(--muted);margin:-2px 0 8px 0">{todaySession.focus}</div>
    {#if todaySessionDone}
      <div style="font-size:0.75rem;color:var(--green);font-weight:600">✓ Marked complete for today</div>
    {:else}
      <button class="btn bg_ bsm" onclick={markTodaySessionComplete} disabled={markingSessionDone}>{markingSessionDone ? 'Saving…' : 'Mark Complete ✓'}</button>
    {/if}
  {:else}
    <div style="color:var(--muted);font-size:0.8125rem">{todaySchedule?.note || 'No session scheduled for today'}</div>
  {/if}
</div>

<div class="card" use:cardNav={`${base}/alarms`}>
  <div class="flex jb ac">
    <div class="card-lbl" style="margin-bottom:0">Today's Schedule</div>
    <span class="card-link">Alarms →</span>
  </div>
  {#each $_alarms as alarm}
    {#if alarm.enabled && alarm.days?.includes(dayIdx)}
      <div class="gi" style="padding:5px 0">
        <div class="gn"><strong>{alarm.title}</strong></div>
        <div style="color:var(--amber);font-weight:600">{alarm.time}</div>
      </div>
      {#if alarm.message}
        <div style="font-size:0.75rem;color:var(--muted);margin:-2px 0 4px 0">{alarm.message}</div>
      {/if}
    {/if}
  {/each}
  {#if $_alarms.length === 0}
    <div style="color:var(--muted);font-size:0.8125rem">No alarms for today</div>
  {/if}
</div>

<div class="card">
  <div class="card-lbl">Weigh-in &amp; steps</div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="ql-weight">Weight (kg)</label>
      <input id="ql-weight" type="number" step="0.1" bind:value={weight} placeholder={recentWeight?.toString() || '116.0'} style="text-align:center">
    </div>
    <div class="f1">
      <label class="flbl" for="ql-steps">Steps</label>
      <input id="ql-steps" type="number" bind:value={steps} placeholder="9000" style="text-align:center">
    </div>
  </div>
  <button class="btn bp bfl" onclick={quickLog} disabled={saving}>{saving ? 'Saving…' : 'Save Today ✓'}</button>
  {#if saveMsg}
    <div style="font-size:0.75rem;text-align:center;margin-top:6px;color:{saveMsg.startsWith('Saved') ? 'var(--green)' : 'var(--red)'}">{saveMsg}</div>
  {/if}
</div>


