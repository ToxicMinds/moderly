// ── HAPTICS ───────────────────────────────────────────────────────────────
// The app's sense of touch. It already SPEAKS (toasts) and GLOWS (verdict
// aura); this is the third channel — a short, physical buzz on the exact same
// moments that matter, so a PR or a new low is felt, not just seen.
//
// WHY A PLUGIN, NOT navigator.vibrate: this ships as an Android APK (a Capacitor
// shell). Inside that WebView, navigator.vibrate() silently does NOTHING unless
// the app declares the VIBRATE permission, and even then it's a single dumb
// on/off buzz. The native @capacitor/haptics plugin gives real, OS-grade
// feedback — light/medium/heavy impacts and success/warning/error notification
// patterns — the same taps you feel elsewhere on the phone. On the plain web
// (no Capacitor) we fall back to navigator.vibrate so the PWA still buzzes.
//
// Design rules that keep it premium instead of annoying:
//   1. A tiny, DISTINCT vocabulary that mirrors the verdict language — a light
//      tick for navigation, a rising pattern for success, a hard triple for a
//      celebration. Same colour = meaning mapping, now in the fingertips.
//   2. Fires only on genuine events, never on every state change.
//   3. User can switch it off (Settings), and it silences itself entirely
//      under prefers-reduced-motion. Absent hardware is a no-op.

export type Haptic =
  | 'tap'        // lightest — nav taps, minor selects
  | 'select'     // a hair firmer — a choice landed
  | 'impact'     // a single confident thud — gesture threshold crossed
  | 'success'    // rising two-beat — protein hit, target reached
  | 'warning'    // one firm nudge — over budget, at-risk
  | 'error'      // stutter — something went wrong
  | 'celebrate'; // triple crescendo — a PR, a new low

// Web-fallback patterns in milliseconds (single number = one buzz; array =
// buzz/pause/…). Only used when there's no native plugin (a browser PWA). Kept
// short so they read as texture, not as a phone ringing.
export const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 8,
  select: 12,
  impact: 26,
  success: [14, 38, 24],
  warning: [22, 60, 22],
  error: [30, 45, 30, 45, 30],
  celebrate: [12, 28, 18, 28, 36],
};

// Enabled by default — this is a phone-first app and the whole point is that it
// feels native. Persisted to localStorage so the choice survives reloads.
let enabled = true;

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem('haptics', v ? '1' : '0');
  } catch {
    /* storage disabled — keep the in-memory value */
  }
}

/** Read the saved preference once at boot. Safe to call before paint. */
export function initHaptics(): void {
  try {
    const s = localStorage.getItem('haptics');
    if (s !== null) enabled = s === '1';
  } catch {
    /* storage disabled — default stays on */
  }
}

function reducedMotion(): boolean {
  return (
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// — Native plugin wiring —
// Resolve ONCE, lazily, exactly like the Health Connect integration does, so
// nothing touches the Capacitor bridge during SSR/prerender. `plugin` stays
// null on the plain web, which routes us to the navigator.vibrate fallback.
let resolved = false;
let isNative = false;
let plugin: any = null;

async function ensureNative(): Promise<void> {
  if (resolved) return;
  resolved = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    isNative = !!Capacitor?.isNativePlatform?.();
    if (isNative) {
      plugin = await import('@capacitor/haptics');
    }
  } catch {
    isNative = false;
    plugin = null;
  }
}

function webVibrate(kind: Haptic): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some WebViews throw without a user gesture — ignore */
  }
}

/** Fire a named haptic. No-ops silently when disabled or reduced-motion. Uses
 *  the native plugin on device; falls back to navigator.vibrate on the web;
 *  a total no-op where neither exists (e.g. desktop). Fire-and-forget. */
export function haptic(kind: Haptic): void {
  if (!enabled) return;
  if (reducedMotion()) return;
  void (async () => {
    await ensureNative();
    if (isNative && plugin) {
      const { Haptics, ImpactStyle, NotificationType } = plugin;
      try {
        switch (kind) {
          case 'tap':
          case 'select':
            await Haptics.impact({ style: ImpactStyle.Light });
            break;
          case 'impact':
            await Haptics.impact({ style: ImpactStyle.Medium });
            break;
          case 'success':
            await Haptics.notification({ type: NotificationType.Success });
            break;
          case 'warning':
            await Haptics.notification({ type: NotificationType.Warning });
            break;
          case 'error':
            await Haptics.notification({ type: NotificationType.Error });
            break;
          case 'celebrate':
            // The biggest moment in the app — a success notification followed
            // by a heavy thump, so a PR lands as a real two-stage flourish.
            await Haptics.notification({ type: NotificationType.Success });
            setTimeout(() => {
              Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
            }, 130);
            break;
        }
        return;
      } catch {
        /* native call failed — fall through to the web path */
      }
    }
    webVibrate(kind);
  })();
}

/** Map a verdict/toast tone to the haptic that speaks the same meaning, so the
 *  buzz you feel always agrees with the colour you see. */
export function toneHaptic(tone: 'good' | 'ok' | 'warn' | 'bad'): Haptic {
  return tone === 'good' ? 'success'
    : tone === 'warn' ? 'warning'
    : tone === 'bad' ? 'error'
    : 'select';
}
