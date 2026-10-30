<script lang="ts">
  // The coin, spinning on its edge: what the app shows while a tab takes a
  // moment. The boot screen in src/app.html draws the same one before any of
  // this code has arrived, and its keyframes live there, global, so the two
  // are one coin (selfcheck holds the drawings equal).
  let { size = 56 }: { size?: number } = $props();
</script>

<svg class="cspin" viewBox="0 0 72 76" width={size} height={Math.round((size * 76) / 72)} aria-hidden="true"><g class="cs-edge"><rect x="31.5" y="9" width="9" height="58" rx="4.5" fill="currentColor" opacity=".6"/><path d="M31.5 13.0h9M31.5 16.3h9M31.5 19.6h9M31.5 22.9h9M31.5 26.2h9M31.5 29.5h9M31.5 32.8h9M31.5 36.1h9M31.5 39.4h9M31.5 42.7h9M31.5 46.0h9M31.5 49.3h9M31.5 52.6h9M31.5 55.9h9M31.5 59.2h9M31.5 62.5h9" stroke="#000" stroke-opacity=".32" stroke-width="1.35"/></g><g class="cs-face"><ellipse cx="36" cy="38" rx="26" ry="29" fill="currentColor"/><ellipse cx="36" cy="38" rx="21.8" ry="24.8" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="2.1"/><ellipse class="cs-tails" cx="36" cy="38" rx="26" ry="29"/></g><ellipse class="cs-floor" cx="36" cy="70.5" rx="17" ry="2.2" fill="currentColor"/></svg>
