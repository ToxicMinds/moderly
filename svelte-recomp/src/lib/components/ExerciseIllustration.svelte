<script lang="ts">
  // Hand-crafted, fully self-hosted animated illustrations for each exercise
  // movement pattern. No network fetch involved — this is inline SVG bundled
  // into the app's JS, so it's precached by the service worker and always
  // available offline, unlike the YouTube video embed (which needs a live
  // connection and can't legally/technically be cached).
  let { name = '' }: { name?: string } = $props();

  type Pattern =
    | 'squat' | 'lunge' | 'hinge' | 'plank' | 'deadbug' | 'twist'
    | 'curl' | 'pushdown' | 'fly' | 'press-overhead' | 'row' | 'pulldown' | 'press-incline';

  function detectPattern(n: string): Pattern {
    const s = n.toLowerCase();
    if (s.includes('lunge')) return 'lunge';
    if (s.includes('squat') || s.includes('leg press')) return 'squat';
    if (s.includes('deadlift')) return 'hinge';
    if (s.includes('plank')) return 'plank';
    if (s.includes('dead bug')) return 'deadbug';
    if (s.includes('twist') || s.includes('crunch')) return 'twist';
    if (s.includes('curl')) return 'curl';
    if (s.includes('pushdown')) return 'pushdown';
    if (s.includes('fly')) return 'fly';
    if (s.includes('shoulder press') || s.includes('overhead')) return 'press-overhead';
    if (s.includes('row')) return 'row';
    if (s.includes('pulldown')) return 'pulldown';
    if (s.includes('incline') && s.includes('press')) return 'press-incline';
    return 'squat';
  }

  const pattern = $derived(detectPattern(name));

  const labels: Record<Pattern, string> = {
    squat: 'Knee-dominant push', lunge: 'Split-stance push', hinge: 'Hip hinge',
    plank: 'Isometric hold', deadbug: 'Anti-extension core', twist: 'Rotational core',
    curl: 'Elbow flexion', pushdown: 'Elbow extension', fly: 'Horizontal arc',
    'press-overhead': 'Vertical push', row: 'Horizontal pull', pulldown: 'Vertical pull',
    'press-incline': 'Upper-body push',
  };
</script>

<div class="ex-illust">
  <svg viewBox="0 0 120 100" class="fig fig-{pattern}">
    {#if pattern === 'plank'}
      <circle class="head" cx="18" cy="58" r="8"/>
      <line class="torso" x1="26" y1="60" x2="86" y2="60"/>
      <line class="arm" x1="40" y1="60" x2="40" y2="78"/>
      <line class="arm" x1="60" y1="60" x2="60" y2="78"/>
      <line class="leg" x1="86" y1="60" x2="104" y2="60"/>
      <line class="leg" x1="104" y1="60" x2="112" y2="70"/>
    {:else if pattern === 'deadbug'}
      <circle class="head" cx="60" cy="26" r="8"/>
      <line class="torso" x1="60" y1="34" x2="60" y2="62"/>
      <line class="arm arm-a" x1="60" y1="40" x2="42" y2="26"/>
      <line class="arm arm-b" x1="60" y1="40" x2="78" y2="40"/>
      <line class="leg leg-a" x1="60" y1="62" x2="42" y2="80"/>
      <line class="leg leg-b" x1="60" y1="62" x2="78" y2="62"/>
      <line class="floor" x1="10" y1="86" x2="110" y2="86"/>
    {:else if pattern === 'twist'}
      <circle class="head" cx="60" cy="24" r="8"/>
      <g class="torso-rot" style="transform-origin:60px 55px">
        <line class="torso" x1="60" y1="32" x2="60" y2="62"/>
        <line class="arm" x1="60" y1="40" x2="38" y2="46"/>
        <line class="arm" x1="60" y1="40" x2="82" y2="46"/>
      </g>
      <line class="leg" x1="60" y1="62" x2="46" y2="86"/>
      <line class="leg" x1="60" y1="62" x2="74" y2="86"/>
      <line class="floor" x1="20" y1="86" x2="100" y2="86"/>
    {:else if pattern === 'hinge'}
      <g class="hinge-rot" style="transform-origin:60px 58px">
        <circle class="head" cx="60" cy="22" r="8"/>
        <line class="torso" x1="60" y1="30" x2="60" y2="58"/>
        <line class="arm" x1="60" y1="36" x2="46" y2="70"/>
        <line class="arm" x1="60" y1="36" x2="46" y2="70"/>
      </g>
      <line class="leg" x1="60" y1="58" x2="52" y2="86"/>
      <line class="leg" x1="60" y1="58" x2="68" y2="86"/>
      <line class="floor" x1="20" y1="86" x2="100" y2="86"/>
    {:else if pattern === 'lunge'}
      <circle class="head" cx="55" cy="22" r="8"/>
      <line class="torso" x1="55" y1="30" x2="58" y2="58"/>
      <line class="arm" x1="56" y1="38" x2="42" y2="50"/>
      <line class="arm" x1="56" y1="38" x2="70" y2="50"/>
      <line class="leg leg-front" x1="58" y1="58" x2="76" y2="86"/>
      <line class="leg leg-back" x1="58" y1="58" x2="38" y2="86"/>
      <line class="floor" x1="20" y1="86" x2="100" y2="86"/>
    {:else if pattern === 'squat'}
      <g class="squat-move">
        <circle class="head" cx="60" cy="20" r="8"/>
        <line class="torso" x1="60" y1="28" x2="60" y2="54"/>
        <line class="arm" x1="60" y1="34" x2="40" y2="42"/>
        <line class="arm" x1="60" y1="34" x2="80" y2="42"/>
        <line class="leg" x1="60" y1="54" x2="46" y2="86"/>
        <line class="leg" x1="60" y1="54" x2="74" y2="86"/>
      </g>
      <line class="floor" x1="20" y1="86" x2="100" y2="86"/>
    {:else}
      <!-- Shared "standing, arm-focused" template used by curl / pushdown / fly /
           overhead press / row / pulldown / incline press — only the arm
           animation differs (set via the fig-{pattern} class above). -->
      <circle class="head" cx="60" cy="20" r="8"/>
      <line class="torso" x1="60" y1="28" x2="60" y2="62"/>
      <line class="leg" x1="60" y1="62" x2="50" y2="86"/>
      <line class="leg" x1="60" y1="62" x2="70" y2="86"/>
      <line class="arm-l" x1="60" y1="34" x2="42" y2="52"/>
      <line class="arm-r" x1="60" y1="34" x2="78" y2="52"/>
      <line class="floor" x1="20" y1="86" x2="100" y2="86"/>
    {/if}
  </svg>
  <span class="ex-illust-lbl">{labels[pattern]}</span>
</div>

<style>
  .ex-illust{background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:6px 6px 8px;display:flex;flex-direction:column;align-items:center;gap:2px;width:96px;flex-shrink:0}
  .fig{width:100%;height:auto;overflow:visible}
  .ex-illust-lbl{font-size:0.6875rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px}

  .head{fill:none;stroke:var(--amber);stroke-width:3}
  .torso,.leg,.arm,.arm-l,.arm-r,.arm-a,.arm-b,.leg-a,.leg-b,.leg-front,.leg-back{stroke:var(--text);stroke-width:3.5;stroke-linecap:round;fill:none}
  .floor{stroke:var(--border2);stroke-width:2;stroke-dasharray:2 4}

  /* Squat: whole upper-body group bobs down and torso/limbs compress */
  .squat-move{animation:squatMove 1.8s ease-in-out infinite}
  @keyframes squatMove{
    0%,100%{transform:translateY(0)}
    50%{transform:translateY(14px)}
  }

  /* Lunge: front/back leg swap emphasis via vertical bob + slight leg angle shift */
  .fig-lunge .leg-front{animation:lungeFront 1.8s ease-in-out infinite}
  .fig-lunge .leg-back{animation:lungeBack 1.8s ease-in-out infinite}
  @keyframes lungeFront{0%,100%{transform:translateY(0)}50%{transform:translateY(6px) rotate(-4deg)}}
  @keyframes lungeBack{0%,100%{transform:translateY(0)}50%{transform:translateY(6px) rotate(4deg)}}

  /* Hip hinge: rotate the upper body group forward/back around the hips */
  .hinge-rot{animation:hingeRot 2s ease-in-out infinite}
  @keyframes hingeRot{0%,100%{transform:rotate(0deg)}50%{transform:rotate(38deg)}}

  /* Plank: near-static isometric hold, just a subtle breathing wobble */
  .fig-plank{animation:breathe 2.6s ease-in-out infinite}
  @keyframes breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}

  /* Dead bug: opposite arm + leg extend together, alternating */
  .fig-deadbug .arm-a{animation:dbArm 2.4s ease-in-out infinite}
  .fig-deadbug .leg-a{animation:dbLeg 2.4s ease-in-out infinite}
  @keyframes dbArm{0%,100%{transform:translate(0,0)}50%{transform:translate(10px,-6px)}}
  @keyframes dbLeg{0%,100%{transform:translate(0,0)}50%{transform:translate(-10px,-4px)}}

  /* Twist: rotate the torso group left/right around the hips */
  .torso-rot{animation:twistRot 1.6s ease-in-out infinite}
  @keyframes twistRot{0%,100%{transform:rotate(-22deg)}50%{transform:rotate(22deg)}}

  /* Bicep curl: forearm/hand swings up toward the shoulder */
  .fig-curl .arm-l,.fig-curl .arm-r{animation:curlMove 1.6s ease-in-out infinite}
  @keyframes curlMove{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-70deg)}}
  .fig-curl .arm-l{transform-origin:60px 34px}
  .fig-curl .arm-r{transform-origin:60px 34px;animation-delay:.1s}

  /* Tricep pushdown: forearm extends straight down from a bent elbow */
  .fig-pushdown .arm-l,.fig-pushdown .arm-r{animation:pushdownMove 1.5s ease-in-out infinite}
  @keyframes pushdownMove{0%,100%{transform:rotate(35deg)}50%{transform:rotate(0deg)}}
  .fig-pushdown .arm-l{transform-origin:60px 34px}
  .fig-pushdown .arm-r{transform-origin:60px 34px}

  /* Cable fly: arms arc inward together in front of the chest */
  .fig-fly .arm-l{animation:flyL 1.8s ease-in-out infinite}
  .fig-fly .arm-r{animation:flyR 1.8s ease-in-out infinite}
  @keyframes flyL{0%,100%{transform:rotate(0deg)}50%{transform:rotate(45deg)}}
  @keyframes flyR{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-45deg)}}
  .fig-fly .arm-l{transform-origin:60px 34px}
  .fig-fly .arm-r{transform-origin:60px 34px}

  /* Overhead press: both arms swing straight up overhead */
  .fig-press-overhead .arm-l,.fig-press-overhead .arm-r{animation:pressUp 1.7s ease-in-out infinite}
  @keyframes pressUp{0%,100%{transform:rotate(0deg)}50%{transform:rotate(150deg)}}
  .fig-press-overhead .arm-l{transform-origin:60px 34px}
  .fig-press-overhead .arm-r{transform-origin:60px 34px;animation-direction:reverse}

  /* Row: elbows drive back, hands pull toward the ribs */
  .fig-row .arm-l,.fig-row .arm-r{animation:rowMove 1.5s ease-in-out infinite}
  @keyframes rowMove{0%,100%{transform:translateX(0)}50%{transform:translateX(-16px)}}

  /* Lat pulldown: arms pull down and out from overhead */
  .fig-pulldown .arm-l,.fig-pulldown .arm-r{animation:pulldownMove 1.8s ease-in-out infinite}
  @keyframes pulldownMove{0%,100%{transform:rotate(0deg)}50%{transform:rotate(60deg)}}
  .fig-pulldown .arm-l{transform-origin:60px 34px}
  .fig-pulldown .arm-r{transform-origin:60px 34px;animation-direction:reverse}

  /* Incline press: arms press up and slightly forward */
  .fig-press-incline .arm-l,.fig-press-incline .arm-r{animation:inclineMove 1.6s ease-in-out infinite}
  @keyframes inclineMove{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
</style>
