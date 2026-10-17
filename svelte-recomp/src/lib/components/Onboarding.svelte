<script lang="ts">
  // First-run setup.
  //
  // Everything asked here was previously either a hardcoded constant compiled
  // into the app or a form you had to refill on every visit. Five short steps,
  // each explaining WHY it's needed — a fitness app that demands your body
  // measurements without saying what it does with them has not earned them.
  //
  // Nothing is guessed silently: suggestions are shown as suggestions, and every
  // field can be changed later in Body & Goals.
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveProfile } from '$lib/stores/live';
  import db from '$lib/db/dexie';
  import { todayYmd } from '$lib/date';
  import {
    ageFrom, suggestGoalKg, suggestActivityLevel, proteinTargetG,
    lbToKg, kgToLb, ftInToCm, cmToFtIn, type Sex, type Units, type ActivityLevel
  } from '$lib/profile';
  import { calcTdee, projectGoalWithTdee, projectionSummary, ACTIVITY_LABELS } from '$lib/tdee';
  import { notify } from '$lib/stores/notices';
  import { supabase } from '$lib/db/client';
  import { PLAN_TEMPLATES, buildSchedule, describeSchedule } from '$lib/data/planTemplates';
  import { syncAutoAlarms } from '$lib/autoAlarms';
  import { WATCH_BRANDS, brandById } from '$lib/health/watches';
  import { setWatchBrand } from '$lib/health/healthConnect';
  import { DEFAULT_SESSIONS } from '$lib/data/workoutPlanDefaults';

  let { onDone }: { onDone: () => void } = $props();

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let step = $state(0);

  // Alarms. Training reminders come free from the schedule they just picked;
  // the weigh-in reminder is the highest-leverage alarm in the app, because
  // weigh-in density is what gates every verdict Progress can give.
  let wantTrainingAlarms = $state(true);
  let wantWeighIn = $state(true);
  let weighInTime = $state('07:00');
  let saving = $state(false);
  let error = $state('');

  // An EXISTING user can land here with a partial profile — height and sex were
  // never persisted before they became real columns, so anyone from before that
  // arrives missing them. They must not be treated as brand new: answers are
  // prefilled, their plan is never overwritten, and the copy says "finish"
  // rather than "welcome". Being dropped into first-run setup after logging in
  // reads as "my data is gone", which is exactly what it must never feel like.
  const _existing = liveProfile();
  const returning = $derived(!!$_existing && ($_existing.goal_kg != null || $_existing.onboarded_at != null));
  let prefilled = $state(false);

  // — Step 1: who —
  let displayName = $state('');
  let sex = $state<Sex | ''>('');
  let birthYear = $state('');
  let units = $state<Units>('metric');

  // — Step 2: body —
  let heightCm = $state('');
  let heightFt = $state('');
  let heightIn = $state('');
  let weightInput = $state('');

  // — Step 3: training —
  let sessionsPerWeek = $state(3);
  let activityLevel = $state<ActivityLevel>('moderate');
  let activityTouched = $state(false);
  // The weekly SHAPE. Previously every new user was seeded with one specific
  // person's week, badminton club and all.
  let templateId = $state('gym3');
  let sportName = $state('');
  let sportTime = $state('');
  // No pre-selected days. This used to default to [3, 5] — Wednesday and
  // Friday — which was one specific person's actual badminton nights. A
  // pre-filled default that happens to be someone's real answer is invisible to
  // them and silently wrong for everybody else, so it is left empty and the
  // step cannot be completed without a real choice.
  let sportDays = $state<number[]>([]);

  const DOW = [
    { n: 1, s: 'Mon' }, { n: 2, s: 'Tue' }, { n: 3, s: 'Wed' }, { n: 4, s: 'Thu' },
    { n: 5, s: 'Fri' }, { n: 6, s: 'Sat' }, { n: 0, s: 'Sun' }
  ];
  const selectedTemplate = $derived(PLAN_TEMPLATES.find((t) => t.id === templateId)!);

  function toggleSportDay(n: number) {
    sportDays = sportDays.includes(n) ? sportDays.filter((d) => d !== n) : [...sportDays, n];
  }

  const schedulePreview = $derived(
    buildSchedule({ templateId, sportName, sportDays, sportTime })
  );

  // — Step 4: watch —
  // Health Connect reads every brand the same way, but knowing WHICH brand lets
  // us trust the right data source and give setup steps that match their app.
  let watchBrand = $state('phone');
  const selectedWatch = $derived(brandById(watchBrand));

  // — Step 5: goal —
  let goalInput = $state('');

  $effect(() => {
    const p = $_existing;
    if (!p || prefilled) return;
    if (p.display_name) displayName = p.display_name;
    if (p.sex === 'male' || p.sex === 'female') sex = p.sex;
    if (p.birth_year) birthYear = String(p.birth_year);
    if (p.units === 'metric' || p.units === 'imperial') units = p.units;
    if (p.height_cm) {
      heightCm = String(p.height_cm);
      const { ft, inch } = cmToFtIn(Number(p.height_cm));
      heightFt = String(ft); heightIn = String(inch);
    }
    if (p.start_kg) weightInput = String(p.start_kg);
    if (p.goal_kg) goalInput = String(p.goal_kg);
    if (p.activity_level) { activityLevel = p.activity_level; activityTouched = true; }
    if (p.watch_brand) watchBrand = p.watch_brand;
    prefilled = true;
  });

  const currentYear = new Date().getFullYear();

  const heightInCm = $derived.by(() => {
    if (units === 'imperial') {
      const ft = parseFloat(heightFt), inch = parseFloat(heightIn) || 0;
      return ft > 0 ? Math.round(ftInToCm(ft, inch) * 10) / 10 : null;
    }
    const cm = parseFloat(heightCm);
    return cm > 0 ? cm : null;
  });

  const weightInKg = $derived.by(() => {
    const w = parseFloat(weightInput);
    if (!w || w <= 0) return null;
    return units === 'imperial' ? Math.round(lbToKg(w) * 100) / 100 : w;
  });

  const goalInKg = $derived.by(() => {
    const g = parseFloat(goalInput);
    if (!g || g <= 0) return null;
    return units === 'imperial' ? Math.round(lbToKg(g) * 100) / 100 : g;
  });

  const age = $derived(ageFrom(parseInt(birthYear, 10)));
  const suggestedGoal = $derived(suggestGoalKg(heightInCm));

  // Keep activity in step with the training question unless the user overrode it.
  $effect(() => {
    if (!activityTouched) activityLevel = suggestActivityLevel(sessionsPerWeek);
  });

  const canNext = $derived.by(() => {
    if (step === 0) return sex !== '' && age != null;
    if (step === 1) return heightInCm != null && weightInKg != null;
    if (step === 2) return !selectedTemplate?.usesSport || sportDays.length > 0;
    if (step === 3) return true;
    if (step === 4) return goalInKg != null;
    return true;
  });

  // Live preview of what the numbers actually buy them — the reason to fill
  // this in at all.
  const preview = $derived.by(() => {
    if (!heightInCm || !weightInKg || !age || !sex || !goalInKg) return null;
    const tdee = calcTdee({
      weightKg: weightInKg, heightCm: heightInCm, age, gender: sex, activityLevel
    });
    const proj = projectGoalWithTdee(tdee, weightInKg, goalInKg);
    return { tdee, proj, protein: proteinTargetG(goalInKg, weightInKg) };
  });

  async function finish() {
    if (!uid || !canNext) return;
    saving = true;
    error = '';
    try {
      const p = preview;
      // Keep an existing goal narrative when the goal itself hasn't changed — it
      // may carry a body-composition rationale this flow cannot reproduce.
      const goalUnchanged = $_existing?.goal_kg != null && Number($_existing.goal_kg) === goalInKg;
      const reason = goalUnchanged && $_existing?.goal_reason
        ? $_existing.goal_reason
        : p
          ? projectionSummary(p.proj, p.protein)
          : null;

      await upsertRecord('user_settings', {
        user_id: uid,
        display_name: displayName.trim() || null,
        sex,
        birth_year: parseInt(birthYear, 10),
        height_cm: heightInCm,
        activity_level: activityLevel,
        units,
        watch_brand: watchBrand,
        // Never move the original starting weight — it anchors "how far you've
        // come", and resetting it to today's weight erases the whole journey.
        start_kg: $_existing?.start_kg ?? weightInKg,
        goal_kg: goalInKg,
        goal_reason: reason,
        onboarded_at: $_existing?.onboarded_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // Mirror the brand locally so the very first sync already trusts the
      // right data source, before any profile round-trip completes.
      setWatchBrand(watchBrand);

      // Seed the first weigh-in ONLY if today has none — a returning user has a
      // weight history already and must not get a duplicate entry for today.
      if (weightInKg) {
        const existingToday = await db.table('weights')
          .where('[user_id+date]').equals([uid, todayYmd()]).count().catch(() => 0);
        if (!existingToday) {
          await upsertRecord('weights', {
            user_id: uid, date: todayYmd(), weight: weightInKg,
            created_at: new Date().toISOString()
          });
        }
      }

      // Seed the training week ONLY for a genuinely new user.
      //
      // This is the destructive case. workout_schedule upserts on
      // (user_id, day_of_week) and workout_sessions_custom on (user_id, key), so
      // seeding over an existing user overwrites every day of their schedule and
      // every exercise they had edited — silently replacing months of
      // customisation with a stock template.
      const existingDays = await db.table('workout_schedule')
        .where('user_id').equals(uid).count().catch(() => 0);
      const existingSessions = await db.table('workout_sessions_custom')
        .where('user_id').equals(uid).count().catch(() => 0);

      if (existingDays === 0 && existingSessions === 0) {
        const now = new Date().toISOString();
        for (const s of DEFAULT_SESSIONS) {
          await upsertRecord('workout_sessions_custom', { user_id: uid, ...s, updated_at: now });
        }
        for (const d of schedulePreview) {
          await upsertRecord('workout_schedule', { user_id: uid, ...d, updated_at: now });
        }
      }

      // Alarms. Never fatal — a failed reminder must not cost someone the
      // profile they just spent five screens entering, so this is caught
      // separately and reported rather than thrown.
      try {
        if (wantTrainingAlarms) {
          // syncAutoAlarms upserts on (user_id, auto_key), so re-running
          // onboarding updates the same rows instead of duplicating them.
          await syncAutoAlarms(uid, schedulePreview);
        }
        if (wantWeighIn) {
          // Same idea via a fixed auto_key: one weigh-in alarm per user, ever.
          // Without the key this would stack a new 07:00 alarm every time
          // onboarding was completed.
          const { error: alarmErr } = await supabase.from('alarms').upsert(
            {
              id: crypto.randomUUID(),
              user_id: uid,
              auto_key: 'auto-weigh-in',
              title: '⚖️ Morning weigh-in',
              message: 'Before food or drink — same conditions every day is what makes the numbers comparable.',
              time: weighInTime,
              days: [0, 1, 2, 3, 4, 5, 6],
              enabled: true,
            },
            { onConflict: 'user_id,auto_key' }
          );
          if (alarmErr) throw alarmErr;
        }
      } catch (e: any) {
        notify('Alarms', `Profile saved, but reminders could not be set: ${e?.message || e}`, { level: 'warn' });
      }

      onDone();
    } catch (e: any) {
      error = e?.message || String(e);
      notify('Setup', `Could not save your profile: ${error}`);
    } finally {
      saving = false;
    }
  }
</script>

<div class="ob">
  <div class="ob-progress">
    {#each [0, 1, 2, 3, 4, 5] as s}
      <div class="ob-dot" class:on={s <= step}></div>
    {/each}
  </div>

  {#if step === 0}
    {#if returning}
      <h2 class="ob-h">Welcome back — just finishing your profile</h2>
      <div class="ob-reassure">
        <strong>Nothing has been lost.</strong> Your weigh-ins, food log, workouts
        and training plan are all still here. Height and sex were never saved by
        older versions of the app, and the calorie maths needs them — so this asks
        once, keeps everything you already had, and won't touch your plan.
      </div>
    {:else}
      <h2 class="ob-h">Let's set up your plan</h2>
      <p class="ob-p">
        Five quick questions. They're what turn this from a logging app into one
        that can tell you whether you're losing fat or muscle.
      </p>
    {/if}

    <label class="flbl" for="ob-name">What should I call you? <span class="ob-opt">(optional)</span></label>
    <input id="ob-name" bind:value={displayName} placeholder="Your name" autocomplete="given-name">

    <label class="flbl" for="ob-sex">Sex</label>
    <div class="ob-hint">The calorie and body-fat formulas are different for men and women — this is used for the maths, nothing else.</div>
    <div class="tab-row" id="ob-sex">
      <button class="tab" class:on={sex === 'male'} onclick={() => sex = 'male'}>Male</button>
      <button class="tab" class:on={sex === 'female'} onclick={() => sex = 'female'}>Female</button>
    </div>

    <label class="flbl" for="ob-year">Year of birth</label>
    <div class="ob-hint">Metabolism falls with age, so your calorie target depends on it.</div>
    <input id="ob-year" type="number" inputmode="numeric" bind:value={birthYear}
      placeholder={String(currentYear - 30)} min="1900" max={currentYear - 13}>
    {#if birthYear && age == null}
      <div class="ob-err">That doesn't look like a valid year of birth.</div>
    {:else if age != null}
      <div class="ob-ok">You're {age}.</div>
    {/if}

    <label class="flbl" for="ob-units">Units</label>
    <div class="tab-row" id="ob-units">
      <button class="tab" class:on={units === 'metric'} onclick={() => units = 'metric'}>kg / cm</button>
      <button class="tab" class:on={units === 'imperial'} onclick={() => units = 'imperial'}>lb / ft</button>
    </div>

  {:else if step === 1}
    <h2 class="ob-h">Your body right now</h2>
    <p class="ob-p">The starting point everything is measured against. No judgement — this is just the first dot on the graph.</p>

    <label class="flbl" for="ob-height">Height</label>
    {#if units === 'imperial'}
      <div class="ob-row2">
        <input id="ob-height" type="number" inputmode="numeric" bind:value={heightFt} placeholder="ft">
        <input type="number" inputmode="numeric" bind:value={heightIn} placeholder="in">
      </div>
    {:else}
      <input id="ob-height" type="number" inputmode="decimal" bind:value={heightCm} placeholder="cm, e.g. 175">
    {/if}

    <label class="flbl" for="ob-weight">Current weight</label>
    <input id="ob-weight" type="number" inputmode="decimal" bind:value={weightInput}
      placeholder={units === 'imperial' ? 'lb' : 'kg'}>
    <div class="ob-hint">
      {returning
        ? 'Your existing weight history is kept — this only adds today if you haven\'t weighed in yet.'
        : "Logged as today's first weigh-in so your trend starts immediately."}
    </div>

  {:else if step === 2}
    <h2 class="ob-h">How do you train?</h2>
    <p class="ob-p">
      This builds your week. You can edit any day afterwards — nothing here is locked in.
    </p>

    <label class="flbl" for="ob-tpl">Your week</label>
    <div class="ob-tpls" id="ob-tpl">
      {#each PLAN_TEMPLATES as t}
        <button class="ob-tpl" class:on={templateId === t.id} onclick={() => templateId = t.id}>
          <div class="ob-tpl-n">{t.name}</div>
          <div class="ob-tpl-b">{t.blurb}</div>
        </button>
      {/each}
    </div>

    {#if selectedTemplate.usesSport}
      <label class="flbl" for="ob-sport">What sport?</label>
      <input id="ob-sport" bind:value={sportName} placeholder="e.g. Badminton, football, climbing">

      <label class="flbl" for="ob-sport-days">Which nights?</label>
      <div class="ob-days" id="ob-sport-days">
        {#each DOW as d}
          <button class="ob-day" class:on={sportDays.includes(d.n)} onclick={() => toggleSportDay(d.n)}>
            {d.s}
          </button>
        {/each}
      </div>

      <label class="flbl" for="ob-sport-time">Time <span class="ob-opt">(optional)</span></label>
      <input id="ob-sport-time" bind:value={sportTime} placeholder="e.g. 7:00–9:00 PM">
      <div class="ob-hint">
        Your gym days get placed away from these, so you never lift heavy the day
        before you play — or the day after, on legs that haven't recovered.
      </div>
    {/if}

    {#if returning}
      <div class="ob-reassure">
        You already have a training plan, so this won't change it — the Gym tab
        keeps exactly the schedule and exercises you've set up.
      </div>
    {:else}
      <div class="ob-sched">{describeSchedule(schedulePreview)}</div>
    {/if}

    <label class="flbl" for="ob-sessions">Roughly how active are you overall?</label>
    <div class="ob-hint">Only a starting estimate of your burn — the app learns your real maintenance from your own data within a few weeks and corrects itself.</div>
    <input id="ob-sessions" type="range" min="0" max="10" bind:value={sessionsPerWeek}
      oninput={() => activityTouched = false}>
    <div class="ob-sessions">{sessionsPerWeek} {sessionsPerWeek === 1 ? 'session' : 'sessions'} a week</div>

    <select id="ob-activity" bind:value={activityLevel} onchange={() => activityTouched = true}>
      {#each Object.entries(ACTIVITY_LABELS) as [key, label]}
        <option value={key}>{label}</option>
      {/each}
    </select>

  {:else if step === 3}
    <h2 class="ob-h">What do you wear?</h2>
    <p class="ob-p">
      Any watch that syncs to Android's Health Connect works — steps, sleep,
      heart rate and workouts all come through the same way. Telling us the brand
      lets the app trust the right source and show setup steps that match your app.
    </p>

    <div class="ob-watches">
      {#each WATCH_BRANDS as w}
        <button class="ob-watch" class:on={watchBrand === w.id} onclick={() => watchBrand = w.id}>
          <span class="ob-watch-e">{w.emoji}</span>
          <span class="ob-watch-n">{w.name}</span>
        </button>
      {/each}
    </div>

    {#if selectedWatch}
      <div class="ob-setup">
        <div class="ob-setup-h">Setting up {selectedWatch.companionApp}</div>
        <ol class="ob-setup-l">
          {#each selectedWatch.setup as stepText}<li>{stepText}</li>{/each}
        </ol>
        {#if selectedWatch.caveat}
          <div class="ob-setup-c">Worth knowing: {selectedWatch.caveat}</div>
        {/if}
      </div>
    {/if}

  {:else if step === 4}
    <h2 class="ob-h">What are you aiming for?</h2>
    <p class="ob-p">A target weight, so every calorie number has a purpose. You can change it whenever you like.</p>

    <label class="flbl" for="ob-goal">Goal weight</label>
    <input id="ob-goal" type="number" inputmode="decimal" bind:value={goalInput}
      placeholder={units === 'imperial' ? 'lb' : 'kg'}>
    {#if suggestedGoal && !goalInput}
      <button class="ob-suggest" onclick={() => goalInput = String(units === 'imperial' ? Math.round(suggestedGoal / 0.45359237) : suggestedGoal)}>
        Not sure? Use {units === 'imperial' ? `${Math.round(suggestedGoal / 0.45359237)} lb` : `${suggestedGoal} kg`} —
        the top of the healthy BMI range for your height. Tap to use it.
      </button>
      <div class="ob-hint">
        BMI ignores muscle entirely, so treat it as a starting marker rather than a
        verdict. Once you log body fat, the app targets composition instead.
      </div>
    {/if}

    {#if preview}
      <div class="ob-preview">
        <div class="ob-preview-h">Your plan</div>
        <div class="ob-pv"><span>Maintenance</span><strong>~{preview.tdee} kcal/day</strong></div>
        <div class="ob-pv"><span>Daily target</span><strong>{preview.proj.targetIntakeKcal} kcal</strong></div>
        <div class="ob-pv"><span>Protein</span><strong>{preview.protein} g/day</strong></div>
        {#if preview.proj.weeksToGoal > 0}
          <div class="ob-pv"><span>Estimated time</span><strong>~{preview.proj.weeksToGoal} weeks</strong></div>
        {/if}
        <div class="ob-preview-f">
          These start as formula estimates. The app replaces them with what your
          own results actually show.
        </div>
      </div>
    {/if}
  {:else}
    <h2 class="ob-h">When should we nudge you?</h2>
    <p class="ob-p">
      Two reminders, both optional. You can change or delete either one later on
      the Alarms tab — nothing here is permanent.
    </p>

    <button class="ob-alarm" class:on={wantWeighIn} onclick={() => wantWeighIn = !wantWeighIn}>
      <span class="ob-alarm-e">⚖️</span>
      <span class="f1">
        <span class="ob-alarm-n">Morning weigh-in</span>
        <span class="ob-alarm-s">
          The single most useful habit here. Weight bounces daily from water and
          food, so one reading says nothing — the app needs a run of them before
          it can honestly tell you whether you're losing fat or muscle.
        </span>
      </span>
      <span class="ob-alarm-x">{wantWeighIn ? '✓' : ''}</span>
    </button>

    {#if wantWeighIn}
      <label class="flbl" for="ob-weigh-time">Weigh-in time</label>
      <input id="ob-weigh-time" type="time" bind:value={weighInTime}>
      <div class="ob-hint">
        Best right after waking and before eating or drinking — same conditions
        every day is what makes the readings comparable.
      </div>
    {/if}

    <button class="ob-alarm" class:on={wantTrainingAlarms} onclick={() => wantTrainingAlarms = !wantTrainingAlarms}>
      <span class="ob-alarm-e">🏋️</span>
      <span class="f1">
        <span class="ob-alarm-n">Training reminders</span>
        <span class="ob-alarm-s">
          Built from the week you just chose — {describeSchedule(schedulePreview)}.
          Gym days alert 45 minutes ahead so there's time to eat and travel.
        </span>
      </span>
      <span class="ob-alarm-x">{wantTrainingAlarms ? '✓' : ''}</span>
    </button>
  {/if}

  {#if error}<div class="ob-err">{error}</div>{/if}

  <div class="ob-nav">
    {#if step > 0}
      <button class="btn bg_ bfl" onclick={() => step--}>Back</button>
    {/if}
    {#if step < 5}
      <button class="btn bp bfl" disabled={!canNext} onclick={() => step++}>Continue</button>
    {:else}
      <button class="btn bp bfl" disabled={!canNext || saving} onclick={finish}>
        {saving ? 'Saving…' : returning ? 'Save and continue' : 'Start'}
      </button>
    {/if}
  </div>
</div>

<style>
  .ob{padding:24px 20px 40px;max-width:460px;margin:0 auto}
  .ob-progress{display:flex;gap:6px;margin-bottom:24px}
  .ob-dot{flex:1;height:3px;border-radius:2px;background:var(--bg3);transition:background .3s var(--ease)}
  .ob-dot.on{background:var(--amber)}
  .ob-h{font-size:1.375rem;font-weight:800;color:var(--text);margin:0 0 8px;line-height:1.25}
  .ob-p{font-size:0.8125rem;color:var(--muted);line-height:1.55;margin:0 0 20px}
  .ob-hint{font-size:0.6875rem;color:var(--muted);line-height:1.45;margin:-2px 0 6px}
  .ob-opt{color:var(--muted);font-weight:400}
  .ob-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .ob-err{font-size:0.75rem;color:var(--red);margin-top:6px;line-height:1.4}
  .ob-ok{font-size:0.75rem;color:var(--green,#2ecc71);margin-top:6px}
  .ob-sessions{font-size:0.8125rem;font-weight:700;color:var(--amber);text-align:center;margin:4px 0 12px}
  .ob-tpls{display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
  .ob-tpl{text-align:left;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:11px 12px;cursor:pointer;font-family:inherit;transition:border-color .2s var(--ease)}
  .ob-tpl.on{border-color:var(--amber)}
  .ob-tpl-n{font-size:0.8438rem;font-weight:700;color:var(--text);margin-bottom:3px}
  .ob-tpl.on .ob-tpl-n{color:var(--amber)}
  .ob-tpl-b{font-size:0.6875rem;color:var(--muted);line-height:1.45}
  .ob-days{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px}
  .ob-day{flex:1;min-width:40px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 2px;color:var(--muted);font-size:0.6875rem;font-weight:700;cursor:pointer;font-family:inherit}
  .ob-day.on{border-color:var(--amber);color:var(--amber)}
  .ob-watches{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px}
  .ob-watch{display:flex;align-items:center;gap:7px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 9px;cursor:pointer;font-family:inherit;text-align:left}
  .ob-watch.on{border-color:var(--amber)}
  .ob-watch-e{font-size:0.9375rem;flex-shrink:0}
  .ob-watch-n{font-size:0.7188rem;font-weight:600;color:var(--text);line-height:1.3}
  .ob-watch.on .ob-watch-n{color:var(--amber)}
  .ob-setup{background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:12px}
  .ob-setup-h{font-size:0.6875rem;font-weight:800;color:var(--muted);letter-spacing:.3px;margin-bottom:8px}
  .ob-setup-l{margin:0;padding-left:18px;font-size:0.7188rem;color:var(--text);line-height:1.55}
  .ob-setup-l li{margin-bottom:5px}
  .ob-setup-c{font-size:0.6875rem;color:var(--muted);line-height:1.45;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
  .ob-sched{margin:12px 0;padding:9px 11px;background:var(--bg3);border-radius:10px;font-size:0.7188rem;color:var(--amber);font-weight:600;text-align:center}
  .ob-suggest{display:block;width:100%;text-align:left;margin-top:8px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--amber);font-size:0.75rem;line-height:1.45;cursor:pointer;font-family:inherit}
  .ob-preview{margin-top:18px;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:14px}
  .ob-preview-h{font-size:0.6875rem;font-weight:800;color:var(--muted);letter-spacing:.4px;margin-bottom:8px}
  .ob-pv{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:0.8125rem;color:var(--muted)}
  .ob-pv strong{color:var(--amber);font-size:0.875rem}
  .ob-preview-f{font-size:0.6875rem;color:var(--muted);line-height:1.45;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
  .ob-reassure{background:var(--bg3);border-left:3px solid var(--green,#2ecc71);border-radius:8px;padding:11px 12px;font-size:0.75rem;color:var(--text);line-height:1.55;margin-bottom:18px}
  .ob-nav{display:flex;gap:8px;margin-top:24px}
</style>
