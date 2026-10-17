<script lang="ts">
  // Readiness folded off the Today page and onto the top bar — a glanceable
  // score you can open on demand from ANY page, instead of a tall always-on
  // card eating the one screen of space that matters. Tap to open the full
  // recovery sheet (sleep/HR inputs, watch sync + diagnostics).
  import Modal from '$lib/components/Modal.svelte';
  import ReadinessCard from '$lib/components/ReadinessCard.svelte';
  import { liveBiometrics } from '$lib/stores/live';
  import { computeReadiness } from '$lib/readiness';
  import { todayYmd } from '$lib/date';
  import { nowTick } from '$lib/stores/refresh';

  let open = $state(false);
  const _bio = liveBiometrics();
  const today = $derived.by(() => { void $nowTick; return todayYmd(); });
  const readiness = $derived.by(() => {
    const todayEntry = ($_bio as any[]).find((b) => b.date === today);
    const history = ($_bio as any[]).filter((b) => b.date < today).slice(-14);
    return computeReadiness(todayEntry, history);
  });
  const band = $derived(readiness?.label ?? null);
</script>

<button
  class="rb-btn"
  class:great={band==='Great'} class:good={band==='Good'} class:fair={band==='Fair'} class:low={band==='Low'}
  onclick={() => (open = true)}
  title="Readiness & recovery"
  aria-label="Readiness and recovery"
>
  {#if readiness}<span class="rb-score">{readiness.score}</span>{:else}♡{/if}
</button>

<Modal {open} onclose={() => (open = false)}>
  <div class="rb-h">Readiness &amp; recovery</div>
  <ReadinessCard bare />
</Modal>

<style>
  .rb-btn{position:relative;width:36px;height:36px;flex-shrink:0;border-radius:var(--r-sm);border:1px solid var(--border2);background:var(--bg2);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;transition:all .2s var(--ease)}
  .rb-btn:active{transform:scale(.9)}
  .rb-score{font-size:0.8125rem;font-weight:800;font-variant-numeric:tabular-nums}
  .rb-btn.great{color:#34d399;border-color:rgba(52,211,153,.5)}
  .rb-btn.good{color:#60a5fa;border-color:rgba(96,165,250,.5)}
  .rb-btn.fair{color:#ffd166;border-color:rgba(255,209,102,.5)}
  .rb-btn.low{color:#fb7185;border-color:rgba(251,113,133,.5)}
  .rb-h{font-size:1.125rem;font-weight:800;color:var(--text);margin-bottom:12px;letter-spacing:-.3px}
</style>
