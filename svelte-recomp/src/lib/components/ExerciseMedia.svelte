<script lang="ts">
  // Real, offline-cacheable exercise demo photos (public-domain images from
  // the free-exercise-db dataset, Unlicense — safe for any use). Two frames
  // per exercise (start/end position) live under /static/exercises/ and are
  // automatically precached by the service worker (they're plain static
  // files, picked up via SvelteKit's `files` list), so they show correctly
  // with zero network connection. We crossfade between the two frames so it
  // reads as "in motion" rather than a single flat photo. Falls back to the
  // old hand-drawn SVG illustration for any exercise we don't have a real
  // photo match for yet.
  import ExerciseIllustration from './ExerciseIllustration.svelte';

  let { name = '' }: { name?: string } = $props();

  const PHOTO_MAP: Record<string, string> = {
    'goblet squat': 'goblet-squat',
    'leg press': 'leg-press',
    'incline dumbbell press': 'incline-db-press',
    'cable chest fly': 'cable-fly',
    'tricep rope pushdown': 'tricep-pushdown',
    'plank hold': 'plank',
    'romanian deadlift': 'rdl',
    'lat pulldown': 'lat-pulldown',
    'seated cable row': 'seated-row',
    'dumbbell shoulder press': 'db-shoulder-press',
    'dumbbell bicep curl': 'db-curl',
    'dead bug': 'dead-bug',
    'walking lunges': 'walking-lunge',
    'bicycle crunch': 'bicycle-crunch',
    'russian twist': 'russian-twist',
  };

  function slugFor(n: string): string | null {
    const s = n.toLowerCase();
    for (const key in PHOTO_MAP) {
      if (s.includes(key)) return PHOTO_MAP[key];
    }
    return null;
  }

  const slug = $derived(slugFor(name));
</script>

{#if slug}
  <div class="ex-photo">
    <img src="/exercises/{slug}/0.jpg" alt="{name} — start position" class="frame f0" loading="lazy" />
    <img src="/exercises/{slug}/1.jpg" alt="{name} — end position" class="frame f1" loading="lazy" />
  </div>
{:else}
  <ExerciseIllustration {name} />
{/if}

<style>
  .ex-photo{position:relative;width:96px;height:96px;flex-shrink:0;border-radius:12px;overflow:hidden;border:1px solid var(--border);background:var(--bg3)}
  .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:crossfade 3.2s ease-in-out infinite}
  .f0{animation-delay:0s}
  .f1{animation-delay:-1.6s}
  @keyframes crossfade{
    0%,40%{opacity:1}
    50%,90%{opacity:0}
    100%{opacity:1}
  }
</style>
