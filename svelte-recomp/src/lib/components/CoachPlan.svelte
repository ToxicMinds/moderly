<script lang="ts">
  // The coach plans the next days of the week (2026-10-31, the owner asked for
  // it): only for people who turned the coach on, since it asks Gemini. The
  // AI picks foods and grams from the table; src/lib/mealPlan.ts works out
  // every number and refuses a plan under the floor, over the day or short of
  // protein. Never a hard day to pay back an earlier one.
  import { body } from '$lib/stores/body';
  import { todayDate } from '$lib/stores/refresh';
  import { coachOn, coachNotes } from '$lib/stores/brain';
  import { liveFoodLogs } from '$lib/stores/live';
  import { supabase } from '$lib/db/client';
  import { CUT_FLOOR } from '$lib/tdee';
  import { shiftYmd } from '$lib/date';
  import { planFoods, usualFoods, planDayKcal, checkPlan, type CheckedPlan } from '$lib/mealPlan';

  const _logs = liveFoodLogs();
  const today = $derived($todayDate as string);
  const noon = (s: string) => new Date(`${s}T12:00:00`);
  const week = $derived($body.week);
  const target = $derived($body.target?.target ?? null);
  const floor = $derived(CUT_FLOOR[$body.profile?.gender === 'female' ? 'female' : 'male']);
  // Today counts only while nothing is logged for it yet.
  const startAt = $derived((($body.intake.get(today)?.kcal ?? 0) > 0) ? 1 : 0);
  const days = $derived(week ? Array.from({ length: Math.max(0, week.daysLeft - startAt) }, (_, i) => shiftYmd(i + startAt, noon(today))) : []);
  const left = $derived(week ? Math.round(week.budget - week.logged) : 0);
  const dayKcal = $derived(target && days.length ? planDayKcal({ share: left / days.length, dayTarget: target, floorKcal: floor }) : null);
  const overBy = $derived(dayKcal != null ? Math.max(0, Math.round(dayKcal * days.length - left)) : 0);

  let busy = $state(false);
  let err = $state('');
  let plan = $state<CheckedPlan | null>(null);

  async function ask() {
    if (!dayKcal) return;
    busy = true; err = ''; plan = null;
    const foods = planFoods(usualFoods(($_logs as any[]) ?? [], shiftYmd(-28, noon(today))));
    const facts: Record<string, unknown> = { days, dayKcal, floorKcal: floor, proteinTargetG: $body.proteinTargetG, foods, notes: $coachNotes ?? '' };
    for (let attempt = 0; attempt < 2 && !plan && !err; attempt++) {
      const { data, error } = await supabase.functions.invoke('coach', { body: { mode: 'plan', facts }, timeout: 55_000 });
      if (error || data?.error) { err = data?.error ?? 'Your coach couldn’t be reached. Try again in a minute.'; break; }
      const checked = checkPlan(data?.reply, { days, dayKcal, floorKcal: floor, proteinTargetG: $body.proteinTargetG, foods });
      if (checked.ok) plan = checked;
      else facts.problem = checked.why;
    }
    if (!plan && !err) err = 'Your coach couldn’t fit a plan inside your floor and protein this time. Try again in a minute.';
    busy = false;
  }

  const dayName = (s: string) => noon(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
</script>

{#if $coachOn && dayKcal && days.length}
  <div class="card cp">
    <div class="card-lbl">Your coach’s plan</div>
    <p class="cp-lead">
      {left > 0 ? `${left.toLocaleString()} kcal left this week` : 'This week’s budget is used'} for {days.length} day{days.length === 1 ? '' : 's'}.
      {#if overBy}At the floor of {floor.toLocaleString()} a day, that’s about {overBy.toLocaleString()} over the week, and that’s fine: a hard day to pay it back usually costs more.
      {:else}Each day aims at about {dayKcal.toLocaleString()}, with at least {$body.proteinTargetG} g protein.{/if}
    </p>
    {#if plan}
      {#each plan.days as d (d.date)}
        <div class="cp-day">
          <div class="cp-dh"><b>{dayName(d.date)}</b><span>{d.kcal.toLocaleString()} kcal · {d.protein} g protein</span></div>
          {#each d.meals as m}
            <div class="cp-meal">
              <span class="cp-t">{m.time}</span>
              <span class="cp-i">{m.items.map((x) => `${x.grams} g ${x.food}`).join(' · ')}</span>
              <span class="cp-n">{m.kcal} kcal · {m.protein} g</span>
            </div>
          {/each}
        </div>
      {/each}
      {#if plan.note}<p class="cp-note">{plan.note}</p>{/if}
      <p class="cp-fine">Your coach chose the foods; the app worked out every number from its food table. Weights are as bought (chicken raw), as you’d log them.</p>
    {/if}
    <button class="btn {plan ? 'bg_' : 'bp'} bfl cp-btn" disabled={busy} onclick={ask}>{busy ? 'Your coach is planning…' : plan ? 'Plan again' : 'Plan my next days'}</button>
    {#if err}<p class="cp-err">{err}</p>{/if}
  </div>
{/if}

<style>
  .cp-lead{font-size:0.875rem;line-height:1.5;color:var(--muted);margin:0 0 12px}
  .cp-day{padding:10px 0;border-top:1px solid var(--border)}
  .cp-dh{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px;font-size:0.9375rem}
  .cp-dh span{font-size:0.8125rem;color:var(--muted);font-variant-numeric:tabular-nums}
  .cp-meal{display:grid;grid-template-columns:3.2rem minmax(0,1fr);column-gap:8px;row-gap:1px;padding:4px 0;font-size:0.875rem}
  .cp-t{font-weight:700;color:var(--text);font-variant-numeric:tabular-nums}
  .cp-i{color:var(--text);min-width:0}
  .cp-n{grid-column:2;font-size:0.75rem;color:var(--muted);font-variant-numeric:tabular-nums}
  .cp-note{font-size:0.875rem;line-height:1.5;color:var(--text);margin:10px 0 4px}
  .cp-fine{font-size:0.75rem;color:var(--muted);margin:6px 0 12px}
  .cp-btn{margin-bottom:0}
  .cp-err{font-size:0.8125rem;color:var(--led-warn);margin:8px 0 0}
</style>
