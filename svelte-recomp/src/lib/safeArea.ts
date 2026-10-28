/**
 * Safe-area floor for the Android shell.
 *
 * THE BUG: the top bar (and the Update button in it) rendered underneath the
 * status bar / camera cutout, where it could not be tapped.
 *
 * There were TWO independent causes, and fixing only one changed nothing:
 *
 *   1. `--st` was always 0px. `targetSdkVersion 36` means Android 15+ FORCES
 *      edge-to-edge, so the activity draws behind the status bar; Capacitor's
 *      `android.adjustMarginsForEdgeToEdge` defaults to `"disable"` and was
 *      never set, so the bridge adds no compensating margin; and Android's
 *      WebView does not populate `env(safe-area-inset-top)` the way iOS does.
 *
 *   2. The CSS that consumed it was invalid anyway. `#topbar` had
 *      `padding: calc(var(--st)+10px)` — CSS requires whitespace around `+`
 *      inside calc(), because `+10px` tokenizes as a signed number. The
 *      expression was therefore two juxtaposed values, the declaration was
 *      dropped at computed-value time, and padding fell back to 0. So even a
 *      correct `--st` was never read. See the calc() guard in selfcheck.js.
 *
 * THE FIX: floor the inset on Android only, via `max()` so a device that does
 * report a real inset still wins — this only rescues the 0px case, and stays
 * correct if a future WebView starts reporting insets properly.
 *
 * Deliberately NOT fixed with `adjustMarginsForEdgeToEdge: "auto"` in
 * capacitor.config.json: that is a native change requiring an APK rebuild, and
 * it would then double up with this padding. One or the other, not both — this
 * one ships over the air.
 */

// ponytail: Android status bars are 24dp, but cutout devices size them taller
// (~32-40dp). CSS px == dp in the WebView, so this is a real measurement, not a
// magic number. If a device still clips, this is the single knob to turn.
const STATUS_BAR_FLOOR_PX = 34;

// The gesture pill. Same root cause, smaller consequence — the bottom nav sits
// slightly under it rather than being swallowed by it.
const NAV_BAR_FLOOR_PX = 16;

/** What the fallback actually did, so Diagnostics can show it instead of us guessing. */
export type SafeAreaInfo = {
  platform: string;
  applied: boolean;
  /** What the WebView itself reported before any flooring (usually "0px" on Android). */
  reportedTop: string;
  /** The px value actually in effect on the top bar after flooring. */
  effectiveTop: number;
};

let lastInfo: SafeAreaInfo | null = null;
export function safeAreaInfo(): SafeAreaInfo | null {
  return lastInfo;
}

/** Read a computed CSS length off the root element, in px. */
function computedPx(prop: string): number {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function detectPlatform(): string {
  // The native bridge injects window.Capacitor as a global, so this resolves
  // synchronously and without depending on the dynamic import succeeding.
  const g = (globalThis as any).Capacitor;
  const p = g?.getPlatform?.();
  if (typeof p === 'string') return p;
  return 'web';
}

export async function applySafeAreaFallback(): Promise<void> {
  if (typeof document === 'undefined') return;

  let platform = detectPlatform();
  if (platform === 'web') {
    // Fall back to the module in case the global is not installed yet.
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor?.isNativePlatform?.()) platform = Capacitor.getPlatform?.() ?? 'web';
    } catch {
      /* plain web build — nothing to compensate for */
    }
  }

  // Measure what the WebView reports BEFORE flooring, so the diagnostic can
  // distinguish "Android reported nothing" from "we picked too small a floor".
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);width:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const reportedTop = `${Math.round(probe.getBoundingClientRect().height)}px`;
  probe.remove();

  // iOS reports insets correctly and a browser has no system bars to clear, so
  // both would only gain dead space from this.
  const applied = platform === 'android';
  if (applied) {
    const root = document.documentElement;
    root.style.setProperty('--st', `max(env(safe-area-inset-top, 0px), ${STATUS_BAR_FLOOR_PX}px)`);
    root.style.setProperty('--sb', `max(env(safe-area-inset-bottom, 0px), ${NAV_BAR_FLOOR_PX}px)`);
    root.dataset.safeAreaFloor = 'android';
  }

  lastInfo = { platform, applied, reportedTop, effectiveTop: computedPx('--st') };
}
