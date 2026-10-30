// Watch / wearable brand registry.
//
// THE KEY INSIGHT: on Android, Health Connect is the universal layer. Every
// brand's companion app (Samsung Health, Garmin Connect, OHealth, Fitbit…)
// mirrors the watch's data into the same store, and this app reads that store.
// So integration is ALREADY brand-agnostic — nothing per-brand is needed to read
// the data itself.
//
// What genuinely does differ, and what this file exists for:
//
//   1. THE PACKAGE NAME. De-duplication has to know which source is the watch
//      and which is the phone (see dedupe.ts). The old detection was a regex
//      that listed OnePlus, Garmin, Fitbit and others but NOT Samsung — so a
//      Galaxy Watch user fell through to "whichever source logged more", which
//      can silently pick the phone's step counter over the watch.
//   2. THE SETUP. Every companion app hides the Health Connect switch somewhere
//      different, and several ship with it OFF by default. "It's not working"
//      is nearly always this, and the fix is a brand-specific instruction.
//   3. WHAT EACH BRAND ACTUALLY WRITES. Some export sleep stages, some only
//      total sleep; some never export HRV. Promising a signal the hardware
//      won't provide is worse than saying so up front.
//
// Menu paths drift between app versions, so the steps are written as guidance
// rather than exact taps.

export interface WatchBrand {
  id: string;
  /** What the user calls the device. */
  name: string;
  /** The phone app that mirrors it into Health Connect. */
  companionApp: string;
  /** Package names that app writes under. Lowercased substring matches. */
  packages: string[];
  /** Brand-specific setup, in order. */
  setup: string[];
  /** An honest limitation, shown up front rather than discovered later. */
  caveat?: string;
  emoji: string;
}

export const WATCH_BRANDS: WatchBrand[] = [
  {
    id: 'oneplus',
    name: 'OnePlus / OPPO Watch',
    companionApp: 'OHealth',
    packages: ['com.oneplus.health', 'com.heytap.health', 'com.oplus.health'],
    emoji: '⌚',
    setup: [
      'Open OHealth and make sure your watch has synced recently — it uploads on its own schedule, not instantly.',
      'In OHealth: Profile → Settings → Health Connect (sometimes under "Data sharing"), and turn it on.',
      'Allow every data type offered — steps, sleep, heart rate, workouts and calories.',
      'Back in Slim Chance, pull down to refresh.'
    ],
    caveat: 'OHealth batches its uploads, so a workout can take a while to appear. Open OHealth first if something is missing.'
  },
  {
    id: 'samsung',
    name: 'Samsung Galaxy Watch',
    companionApp: 'Samsung Health',
    packages: ['com.samsung.android.shealth', 'com.samsung.health', 'com.samsung.android.wear'],
    emoji: '⌚',
    setup: [
      'Open Samsung Health on your phone (not the watch).',
      'Settings → Health Connect, and turn the connection on.',
      'Tap "App permissions" / "Manage data" and allow steps, sleep, heart rate, exercise and calories. Samsung asks per data type and defaults several to OFF.',
      'Back in Slim Chance, pull down to refresh.'
    ],
    caveat: 'Samsung Health only shares data recorded AFTER you enable Health Connect — history before that stays inside Samsung Health.'
  },
  {
    id: 'garmin',
    name: 'Garmin',
    companionApp: 'Garmin Connect',
    packages: ['com.garmin.android'],
    emoji: '⌚',
    setup: [
      'Open Garmin Connect and let it sync with your watch.',
      'More → Settings → Health Connect (or "Connected apps"), and enable it.',
      'Allow steps, sleep, heart rate, exercise and calories.',
      'Back in Slim Chance, pull down to refresh.'
    ],
    caveat: 'Garmin exports Body Battery and stress as its own metrics that Health Connect has no slot for, so those stay in Garmin Connect.'
  },
  {
    id: 'fitbit',
    name: 'Fitbit / Google Pixel Watch',
    companionApp: 'Fitbit',
    packages: ['com.fitbit'],
    emoji: '⌚',
    setup: [
      'Open the Fitbit app and let it sync.',
      'You (profile icon) → Fitbit Settings → Health Connect, and turn it on.',
      'Allow steps, sleep, heart rate, exercise and calories.',
      'Back in Slim Chance, pull down to refresh.'
    ],
    caveat: 'Fitbit keeps detailed sleep stages and HRV behind Premium; without it, Health Connect may only receive total sleep.'
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi / Amazfit / Zepp',
    companionApp: 'Mi Fitness or Zepp',
    packages: ['com.xiaomi.wearable', 'com.mi.health', 'com.huami', 'com.zepp'],
    emoji: '⌚',
    setup: [
      'Open Mi Fitness (or Zepp) and let the watch sync.',
      'Profile → Settings → Health Connect, and enable it.',
      'Allow steps, sleep, heart rate, exercise and calories.',
      'Back in Slim Chance, pull down to refresh.'
    ]
  },
  {
    id: 'huawei',
    name: 'Huawei Watch',
    companionApp: 'Huawei Health',
    packages: ['com.huawei.health'],
    emoji: '⌚',
    setup: [
      'Open Huawei Health and let the watch sync.',
      'Me → Privacy / Data sharing → Health Connect, and enable it.',
      'Allow steps, sleep, heart rate, exercise and calories.',
      'Back in Slim Chance, pull down to refresh.'
    ],
    caveat: 'On phones without Google services, Huawei Health may not offer Health Connect at all — you can still log manually.'
  },
  {
    id: 'whoop',
    name: 'WHOOP',
    companionApp: 'WHOOP',
    packages: ['com.whoop'],
    emoji: '⌚',
    setup: [
      'Open WHOOP and let the strap sync.',
      'Menu → App Settings → Integrations → Health Connect, and enable it.',
      'Allow sleep, heart rate and workouts.',
      'Back in Slim Chance, pull down to refresh.'
    ],
    caveat: 'WHOOP has no step counter, so steps will come from your phone instead — that is expected, not a fault.'
  },
  {
    id: 'polar',
    name: 'Polar',
    companionApp: 'Polar Flow',
    packages: ['fi.polar'],
    emoji: '⌚',
    setup: [
      'Open Polar Flow and sync your device.',
      'Settings → Connect / Health Connect, and enable it.',
      'Allow steps, sleep, heart rate and exercise.',
      'Back in Slim Chance, pull down to refresh.'
    ]
  },
  {
    id: 'withings',
    name: 'Withings',
    companionApp: 'Withings Health Mate',
    packages: ['com.withings'],
    emoji: '⌚',
    setup: [
      'Open Health Mate and let your device sync.',
      'Profile → Settings → Health Connect, and enable it.',
      'Allow steps, sleep, heart rate and weight.',
      'Back in Slim Chance, pull down to refresh.'
    ]
  },
  {
    id: 'phone',
    name: 'No watch — just my phone',
    companionApp: 'Google Fit or your phone',
    packages: ['com.google.android.apps.fitness', 'com.google.android.gms', 'com.google.android.apps.healthdata'],
    emoji: '📱',
    setup: [
      'Your phone already counts steps on its own — nothing to set up.',
      'Pull down to refresh in Slim Chance and steps should appear.',
      'Sleep and heart rate need a wearable, so log those by hand on the Today screen.'
    ],
    caveat: 'A phone in your pocket undercounts steps versus a wrist device, and cannot measure sleep or heart rate at all.'
  },
  {
    id: 'other',
    name: 'Something else',
    companionApp: 'your watch app',
    packages: [],
    emoji: '⌚',
    setup: [
      'Open your watch\'s companion app on your phone.',
      'Look for "Health Connect" in its settings — most brands support it — and turn it on.',
      'Allow steps, sleep, heart rate, exercise and calories.',
      'Back in Slim Chance, pull down to refresh. Whatever it writes, this app will read.'
    ],
    caveat: 'Any brand that writes to Health Connect works. If yours does not offer it, everything can still be logged by hand.'
  }
];

export function brandById(id: string | null | undefined): WatchBrand | null {
  if (!id) return null;
  return WATCH_BRANDS.find((b) => b.id === id) ?? null;
}

/** True when this data-origin package belongs to the given brand. */
export function isBrandPackage(brand: WatchBrand, pkg: string): boolean {
  const p = (pkg || '').toLowerCase();
  return brand.packages.some((bp) => p.includes(bp.toLowerCase()));
}

/**
 * Identify the brand behind a data-origin package name, so a user who never
 * told us what they wear still gets correct de-duplication.
 */
export function brandForPackage(pkg: string): WatchBrand | null {
  return WATCH_BRANDS.find((b) => b.packages.length > 0 && isBrandPackage(b, pkg)) ?? null;
}

/**
 * Choose which data source to trust, given every source seen and (optionally)
 * the brand the user told us they wear.
 *
 * The declared brand wins whenever it is actually present — the user knows what
 * is on their wrist better than any heuristic. Otherwise fall back to the first
 * source belonging to a real WEARABLE brand, since a wrist device measures
 * movement far better than a phone in a pocket. Returns null when only
 * phone-ish sources exist, which correctly leaves the "most data wins" rule in
 * charge for a phone-only user.
 */
export function preferredSource(origins: string[], declaredBrandId?: string | null): string | null {
  const declared = brandById(declaredBrandId);
  if (declared) {
    const hit = origins.find((o) => isBrandPackage(declared, o));
    if (hit) return hit;
  }
  // Any wearable brand beats the phone. 'phone' and 'other' are excluded:
  // 'phone' IS the fallback, and 'other' has no packages to match.
  for (const o of origins) {
    const b = brandForPackage(o);
    if (b && b.id !== 'phone') return o;
  }
  return null;
}

/**
 * What to tell someone whose watch is granted but sending nothing. This is the
 * single most common support question for any Health Connect app, and the
 * answer is almost always "the switch inside your watch's own app is off".
 */
export function setupHelp(brandId: string | null | undefined): { title: string; steps: string[]; caveat?: string } {
  const b = brandById(brandId) ?? WATCH_BRANDS.find((x) => x.id === 'other')!;
  return {
    title: `Getting data from ${b.name} (${b.companionApp})`,
    steps: b.setup,
    caveat: b.caveat
  };
}

/**
 * Friendly name for a data-origin package, for UI that has to explain WHY a
 * number changed ("2 sources found, using your watch"). Falls back to the raw
 * package name rather than hiding an unknown source.
 */
export function sourceLabel(pkg: string): string {
  const b = brandForPackage(pkg);
  if (b) return b.id === 'phone' ? `${b.companionApp} (phone)` : `${b.name} (watch)`;
  if (/healthdata/i.test(pkg)) return 'Health Connect';
  return pkg;
}
