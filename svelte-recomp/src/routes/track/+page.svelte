<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';

  // Track was folded into Today → "Body & Goals" (Phase 2 tab merge).
  onMount(() => goto(base + '/', { replaceState: true }));
</script>

<div style="padding:40px;text-align:center;color:var(--muted)">Moved to Progress → Body &amp; Goals…</div>
