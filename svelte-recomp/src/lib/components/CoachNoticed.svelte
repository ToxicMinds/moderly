<script lang="ts">
  // The coach brain's one "noticed" line for today (stores/brain): a pattern
  // from the last two weeks with its evidence and one small thing to try.
  // Only when the coach is on and wrote one; "Got it" hides it for the day.
  import { brainToday } from '$lib/stores/brain';
  import { body } from '$lib/stores/body';

  const KEY = 'recompos.noticedSeen';
  let seen = $state((() => { try { return localStorage.getItem(KEY); } catch { return null; } })());
  const r = $derived($brainToday);
  const show = $derived(!!r?.noticed_title && !!r?.noticed_body && seen !== $body.today);

  function gotIt() {
    seen = $body.today;
    try { localStorage.setItem(KEY, $body.today); } catch { /* hidden for this visit */ }
  }
</script>

{#if show && r}
  <section class="card cn" aria-label="What the coach noticed">
    <div class="card-lbl">Noticed</div>
    <div class="cn-title">{r.noticed_title}</div>
    <p class="cn-body">{r.noticed_body}</p>
    <button class="btn bg_ bsm" onclick={gotIt}>Got it</button>
  </section>
{/if}

<style>
  .cn-title { font-weight: 700; color: var(--text); margin-top: 4px; }
  .cn-body { font-size: 0.875rem; color: var(--text); line-height: 1.45; margin: 6px 0 10px; }
</style>
