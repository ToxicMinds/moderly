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
  import { buildDailyFocus, goalSummary, waterTargetLitres } from '$lib/coach';
  import { body } from '$lib/stores/body';
  import { diagnoseStall } from '$lib/insights';
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
  let msgFor = $state<'weight' | 'steps'>('weight');

  // Every weight number on this screen is the trend's (stores/body): one
  // morning's reading swings a kilo either way and is never the headline.
  const currentKg = $derived($body.currentKg);
  const kgLost = $derived($body.firstKg != null && currentKg != null ? ($body.firstKg - currentKg).toFixed(1) : '--');
  const todayWeighIn = $derived(($_weights as any[]).find((w) => w.date === today) ?? null);



  // Weight and steps. These cards once took a bare kcal number too, written to
  // daily_logs.kcal — a second, item-less food log that the Food page never
  // saw and that competed with it in every calorie sum. Food has one way in now.
  async function saveEntry(what: 'weight' | 'steps') {
    msgFor = what;
    if (!uid) { saveMsg = 'Not signed in — please sign back in.'; return; }
    saving = true;
    saveMsg = '';
    try {
      if (what === 'weight' && weight) {
        const existing = await db.table('weights').where('[user_id+date]').equals([uid, today]).first();
        await upsertRecord('weights', {
          id: existing?.id || undefined,
          user_id: uid, date: today, weight: parseFloat(weight),
          created_at: new Date().toISOString(),
        });
        weight = '';
        haptic('success');
      }
      if (what === 'steps' && steps) {
        await upsertRecord('steps', {
          user_id: uid, date: today, count: parseInt(steps),
          created_at: new Date().toISOString(),
        });
        steps = '';
        saveMsg = 'Saved ✓';
        setTimeout(() => { saveMsg = ''; }, 3000);
      }
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
  const waterGoalL = $derived(waterTargetLitres(currentKg));

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

  // Per-day totals come from stores/body — the same map every screen reads,
  // with quick-logged kcal standing in for days that have no itemised food.
  const coachTodayKcal = $derived($body.intake.get(today)?.kcal ?? null);
  const coachTodayProtein = $derived($body.intake.get(today)?.protein ?? null);

  const weekMonday = $derived(mondayOf(new Date($nowTick)));
  const daysElapsedThisWeek = $derived(dayIdx === 0 ? 7 : dayIdx); // Mon=1..Sun=7
  const weekKcalSoFar = $derived.by(() => {
    let sum = 0;
    for (const [date, v] of $body.intake) if (date >= weekMonday && date <= today) sum += v.kcal;
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

  // Only when the trend has ruled the plan out: what the log says against what
  // this body burns, and where food most often goes missing (see insights).
  const stall = $derived(diagnoseStall({
    pace: $body.pace, intake: $body.intake, foods: $_foodLogs as any[],
    floorKcal: $body.floorKcal, today,
  }));

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
      currentWeight: currentKg,
      rateKgPerWeek: $body.weight?.rateKgPerWeek ?? 0,
      pace: $body.pace,
      planKgPerWeek: $body.target.planKgPerWeek,
      weeksToGoal: $body.weeksToGoal,
      weighInsNeeded: $body.weight?.weighInsNeeded ?? null,
      stall,
      totalLostKg: $body.firstKg != null && currentKg != null ? +($body.firstKg - currentKg).toFixed(1) : null,
      calorieTarget: $body.target.target,
      todayKcal: coachTodayKcal,
      weekKcalSoFar,
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
      watchActivityToday: watchToday,
      hour: nowHour,
    })
  );</script>

<TodayPulse greeting={greeting} sub={`${dayName} · ${dateStr}`}
  streak={streak.current} atRisk={streak.atRisk}
  kgLost={kgLost} kgNow={currentKg != null ? currentKg.toFixed(1) : '--'} weeks={$body.weeksToGoal ?? '—'} />

<!-- MORNING WEIGH-IN. The trend is only as good as the mornings behind it — a
     month of 13 weigh-ins left it a kilo wide either way — so the scale gets the
     top of the screen until today's reading is in, then shrinks to one line. -->
{#if todayWeighIn}
  <div class="mw-done">Weighed <b>{todayWeighIn.weight}</b> today{#if currentKg != null} · trend <b>{currentKg.toFixed(1)}</b> kg{/if}</div>
{:else}
  <div class="card mw">
    <div class="mw-top">
      <label class="card-lbl" for="ql-weight">Morning weigh-in</label>
      {#if currentKg != null}<span class="mw-trend">trend <b>{currentKg.toFixed(1)}</b> kg</span>{/if}
    </div>
    <div class="mw-row">
      <input id="ql-weight" type="number" inputmode="decimal" step="0.1" bind:value={weight}
        placeholder={currentKg != null ? currentKg.toFixed(1) : 'kg'}
        onkeydown={(e) => e.key === 'Enter' && saveEntry('weight')}>
      <button class="btn bp" onclick={() => saveEntry('weight')} disabled={saving || !weight}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
    {#if saveMsg && msgFor === 'weight'}<div class="mw-err">{saveMsg}</div>{/if}
    <p class="mw-hint">Same time, before food or drink. One morning is noise; the trend is the number.</p>
  </div>
{/if}

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
  <label class="card-lbl" for="ql-steps">Steps</label>
  <div class="mw-row">
    <input id="ql-steps" type="number" inputmode="numeric" bind:value={steps} placeholder={todaySteps != null ? String(todaySteps) : '9000'}
      onkeydown={(e) => e.key === 'Enter' && saveEntry('steps')}>
    <button class="btn bp" onclick={() => saveEntry('steps')} disabled={saving || !steps}>Save</button>
  </div>
  <p class="mw-hint">The watch fills this in on its own; type here only on a day it wasn't worn.</p>
  {#if saveMsg && msgFor === 'steps'}
    <div class="mw-msg" class:bad={!saveMsg.startsWith('Saved')}>{saveMsg}</div>
  {/if}
</div>

<style>
  .mw{padding:13px 14px}
  .mw-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px}
  .mw-top .card-lbl{margin:0}
  .mw-trend{font-size:0.8125rem;color:var(--muted)}
  .mw-trend b{font-family:var(--font-display);font-size:1.125rem;color:var(--text)}
  .mw-row{display:flex;gap:8px}
  .mw-row input{flex:1;min-width:0;font-size:1.25rem;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
  .mw-row .btn{flex-shrink:0;min-width:88px}
  .mw-hint{font-size:0.75rem;color:var(--muted);margin-top:7px;line-height:1.45}
  .mw-err,.mw-msg{font-size:0.75rem;margin-top:6px;color:var(--led-good)}
  .mw-err,.mw-msg.bad{color:var(--led-bad)}
  .mw-done{font-size:0.8125rem;color:var(--muted);margin:-4px 2px 14px}
  .mw-done b{font-family:var(--font-display);font-size:1.0625rem;color:var(--text)}
</style>
