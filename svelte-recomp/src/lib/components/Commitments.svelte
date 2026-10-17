<script lang="ts">
  // The two editors for what the user commits to: the line, and the plans.
  // Mounted once on Today; opened from the commitments row, the line alert or
  // the plan strip (all through `editing`).
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { editing, saveLine, savePlans, saveWhy } from '$lib/commitments';
  import { CUES, cleanPlans, type Plans } from '$lib/plans';
  import { suggestLine } from '$lib/line';
  import { line, body } from '$lib/stores/body';
  import { liveProfile } from '$lib/stores/live';
  import { todayDate } from '$lib/stores/refresh';
  import { haptic } from '$lib/haptics';

  const _profile = liveProfile();
  const plans = $derived(cleanPlans(($_profile as any)?.plans));
  const drawn = $derived(!!($_profile as any)?.line);

  let lineKg = $state('');
  let linePlan = $state('');
  let draft = $state<Plans>({});
  let whyDraft = $state('');
  let saving = $state(false);
  let error = $state('');

  // Fill the editor once, when it opens — never while the user is typing, even
  // if a sync lands underneath.
  $effect(() => {
    const open = $editing;
    untrack(() => {
      error = '';
      if (open === 'line') {
        const trend = $body.currentKg;
        lineKg = $line ? $line.kg.toFixed(1) : trend != null ? suggestLine(trend).toFixed(1) : '';
        linePlan = plans.line ?? '';
      } else if (open === 'plans') {
        draft = { ...plans };
        whyDraft = (($_profile as any)?.why ?? '').trim();
      }
    });
  });

  const close = () => editing.set(null);

  async function run(fn: () => Promise<void>) {
    if (saving) return;
    saving = true;
    error = '';
    try {
      await fn();
      haptic('success');
      close();
    } catch (e: any) {
      error = 'Could not save — ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }

  const keepLine = () => run(async () => {
    const kg = parseFloat(lineKg);
    if (!(kg > 30 && kg < 400)) throw new Error('that isn’t a weight');
    await saveLine(kg, $todayDate);
    await savePlans({ ...plans, line: linePlan });
  });
  const removeLine = () => run(() => saveLine(null, $todayDate));
  const keepPlans = () => run(async () => {
    await savePlans(draft);
    if (whyDraft.trim() !== ((($_profile as any)?.why ?? '').trim())) await saveWhy(whyDraft);
  });
</script>

<Modal open={$editing === 'line'} onclose={close}>
  <div class="cm-h">Your line</div>
  <p class="cm-lede">
    The weight your trend doesn't cross again. Draw it a kilo above where you are. Each time a lower
    trend holds for a week, the line follows you down to a kilo above it, and it never goes back up on its own.
  </p>
  <p class="cm-why">
    It's the system from the trial that taught people to keep weight off (STOP Regain): weigh most mornings,
    and decide now what you'll do the day the trend crosses the line.
  </p>
  <label class="cm-lbl" for="cm-line-kg">Line, kg</label>
  <input id="cm-line-kg" type="number" inputmode="decimal" step="0.1" bind:value={lineKg}>
  {#if $body.currentKg != null}<div class="cm-hint">Your trend today: {$body.currentKg.toFixed(1)} kg{#if $line?.heldLowKg != null}{' · '}lowest held trend {$line.heldLowKg.toFixed(1)} kg{/if}</div>{/if}
  <label class="cm-lbl" for="cm-line-plan">If my trend crosses it, I'll…</label>
  <textarea id="cm-line-plan" rows="2" bind:value={linePlan} placeholder={CUES[0].suggestion}></textarea>
  {#if !linePlan}<button type="button" class="cm-use" onclick={() => (linePlan = CUES[0].suggestion)}>Use this one</button>{/if}
  <button class="btn bp bfl cm-go" onclick={keepLine} disabled={saving}>{saving ? 'Saving…' : drawn ? 'Save my line' : 'Draw my line'}</button>
  {#if drawn}<button class="btn bg_ bfl cm-go" onclick={removeLine} disabled={saving}>Remove the line</button>{/if}
  {#if error}<div class="cm-err">{error}</div>{/if}
</Modal>

<Modal open={$editing === 'plans'} onclose={close}>
  <div class="cm-h">Your plans</div>
  <p class="cm-lede">
    Decide now, so Friday-night you doesn't have to. One plan for each moment that tends to go wrong; it
    shows on Today when that moment comes round. Plans made like this, ahead of time and this specific,
    make people clearly more likely to follow through: a medium-to-large effect across 94 studies.
  </p>
  <label class="cm-lbl" for="pl-why">Why you're doing this</label>
  <textarea id="pl-why" rows="2" bind:value={whyDraft} placeholder="In your own words. Nobody else sees it."></textarea>
  <div class="cm-hint">It comes back when a plan is tested: over your line, and in the Sunday check-in.</div>
  {#each CUES as c (c.cue)}
    <div class="pl-row">
      <label class="cm-lbl" for="pl-{c.cue}">{c.when}</label>
      <textarea id="pl-{c.cue}" rows="2" bind:value={draft[c.cue]} placeholder={c.suggestion}></textarea>
      {#if !draft[c.cue]}<button type="button" class="cm-use" onclick={() => (draft[c.cue] = c.suggestion)}>Use this one</button>{/if}
    </div>
  {/each}
  <button class="btn bp bfl cm-go" onclick={keepPlans} disabled={saving}>{saving ? 'Saving…' : 'Save my plans'}</button>
  {#if error}<div class="cm-err">{error}</div>{/if}
</Modal>

<style>
  .cm-h{font-family:var(--font-display);font-size:1.5rem;font-weight:800;text-transform:uppercase;color:var(--text);margin-bottom:8px;letter-spacing:.01em}
  .cm-lede{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 8px}
  .cm-why{font-size:0.8125rem;line-height:1.5;color:var(--muted);margin:0 0 14px}
  .cm-lbl{display:block;font-family:var(--font-display);font-size:0.875rem;font-weight:800;text-transform:uppercase;
    letter-spacing:.12em;color:var(--muted);margin:12px 0 6px}
  .cm-hint{font-size:0.75rem;color:var(--muted);margin-top:6px}
  .cm-use{background:none;border:none;padding:6px 0 0;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--text);
    text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2);cursor:pointer}
  .cm-go{margin-top:14px}
  .cm-go + .cm-go{margin-top:8px}
  .cm-err{font-size:0.8125rem;color:var(--led-bad);text-align:center;margin-top:8px}
  .pl-row textarea{resize:vertical}
</style>
