<script lang="ts">
  // Would people pay for Plus? Asked once, past the first week (the first odds
  // are in), with the price, before any payment exists: the answer is counted
  // (plus_yes / plus_no, src/lib/events.ts) and the card says plainly that
  // Plus isn't on sale yet. The 15 Dec verdict reads these beside activation.
  import { noteEvent } from '$lib/events';
  import { body } from '$lib/stores/body';

  const KEY = 'recompos.plusAnswer';
  let answer = $state<string | null>(null);
  try { answer = localStorage.getItem(KEY); } catch { /* no storage: ask */ }
  let said = $state('');
  const ready = $derived($body.weight?.trendKg != null);

  function reply(yes: boolean) {
    noteEvent(yes ? 'plus_yes' : 'plus_no');
    try { localStorage.setItem(KEY, yes ? 'yes' : 'no'); } catch { /* counted anyway */ }
    said = yes
      ? 'Thank you. Plus isn’t on sale yet; when it is, you’ll see it here first.'
      : 'Thank you for saying. The everyday app stays free either way.';
  }
</script>

{#if ready && (!answer || said)}
  <div class="card pd">
    <div class="card-lbl">Slim Chance Plus · coming</div>
    {#if said}
      <p class="pd-t">{said}</p>
    {:else}
      <p class="pd-t">Forecasts and milestone dates, the GLP-1 companion, a postpartum plan and the AI coach, for €4.99 a month or €39 a year. The everyday app stays free.</p>
      <p class="pd-q">Would you pay for it?</p>
      <div class="pd-b">
        <button class="btn bp bsm" onclick={() => reply(true)}>Yes, I’d pay</button>
        <button class="btn bg_ bsm" onclick={() => reply(false)}>Not for me</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .pd{margin-top:14px}
  .pd-t{font-size:0.875rem;line-height:1.55;color:var(--text);margin:0}
  .pd-q{font-size:0.9375rem;font-weight:700;color:var(--text);margin:12px 0 10px}
  .pd-b{display:flex;gap:8px;flex-wrap:wrap}
</style>
