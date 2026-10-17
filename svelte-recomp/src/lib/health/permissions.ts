/**
 * Health Connect record types + their Android read-permission strings.
 *
 * Kept in a pure module (no Dexie/Capacitor imports) so the crash-critical
 * invariant is unit-testable: the native plugin's readRecords() runs in an
 * UNGUARDED coroutine, so calling it for a record type whose permission is not
 * granted throws a SecurityException that escapes the coroutine and
 * HARD-CRASHES the app (it never rejects the JS promise). We must therefore
 * only ever read the types the user actually granted — `grantedReadTypes`
 * computes exactly that from Health Connect's granted-permission list.
 *
 * Keep READ_PERMISSION in sync with android/app/src/main/AndroidManifest.xml.
 */
export type RecordType =
  | 'Steps'
  | 'SleepSession'
  | 'HeartRateSeries'
  | 'RestingHeartRate'
  | 'HeartRateVariabilityRmssd'
  | 'ExerciseSession'
  | 'ActiveCaloriesBurned'
  | 'TotalCaloriesBurned'
  | 'Distance';

export const READ_TYPES: RecordType[] = [
  'Steps',
  'SleepSession',
  'HeartRateSeries',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'ExerciseSession',
  'ActiveCaloriesBurned',
  'TotalCaloriesBurned',
  'Distance'
];

export const READ_PERMISSION: Record<RecordType, string> = {
  Steps: 'android.permission.health.READ_STEPS',
  SleepSession: 'android.permission.health.READ_SLEEP',
  HeartRateSeries: 'android.permission.health.READ_HEART_RATE',
  RestingHeartRate: 'android.permission.health.READ_RESTING_HEART_RATE',
  HeartRateVariabilityRmssd: 'android.permission.health.READ_HEART_RATE_VARIABILITY',
  ExerciseSession: 'android.permission.health.READ_EXERCISE',
  ActiveCaloriesBurned: 'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  TotalCaloriesBurned: 'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  Distance: 'android.permission.health.READ_DISTANCE'
};

/**
 * Fingerprint of the set of record types we ask for.
 *
 * THE BUG THIS FIXES: the auto-prompt used to be gated on a single global flag
 * ("we've asked once, never ask again"). Permissions were granted back when the
 * app only requested 5 types; when ExerciseSession / ActiveCaloriesBurned /
 * TotalCaloriesBurned / Distance were added later, that flag was already set, so
 * the new types were NEVER requested — and since we (correctly) refuse to read
 * ungranted types, watch workouts silently returned nothing forever.
 *
 * Keying the flag on the type set instead means adding a type produces a new key
 * and earns exactly one fresh prompt, while still never nagging for a set the
 * user has already answered.
 */
export function readTypesKey(types: RecordType[] = READ_TYPES, writes: WriteType[] = WRITE_TYPES): string {
  // Writes are folded into the same fingerprint for exactly the reason the read
  // set is: adding WRITE_EXERCISE to an app whose "already asked" flag was set
  // years ago would otherwise never earn a prompt, and write-back would silently
  // do nothing forever.
  const joined = [...types].sort().join(',') + '|w:' + [...writes].sort().join(',');
  // djb2 — short, stable, and dependency-free. Only needs to change when the
  // set changes; collision risk is irrelevant for a handful of values.
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = ((h << 5) + h + joined.charCodeAt(i)) | 0;
  return `hc-perms-asked-${(h >>> 0).toString(36)}`;
}

/**
 * What the app writes BACK to Health Connect.
 *
 * The watch has always been a one-way street: it fed the app steps, sleep and
 * heart rate, but a session logged by hand — or a weigh-in typed into this app —
 * existed nowhere else. Writing them back makes RecompOS a real citizen of the
 * user's health data rather than a silo that only takes.
 *
 * Deliberately narrow. Only the two things the user explicitly entered here and
 * that no other app is likely to have: a workout they logged, and a weight they
 * typed. Nothing derived, nothing estimated — writing a computed number into the
 * platform record would pollute every other app that reads it.
 */
/** Written but never read: Weight lives outside RecordType (the READ set). */
export type WriteType = 'ExerciseSession' | 'Weight';
export const WRITE_TYPES: WriteType[] = ['ExerciseSession', 'Weight'];

export const WRITE_PERMISSION: Record<WriteType, string> = {
  ExerciseSession: 'android.permission.health.WRITE_EXERCISE',
  Weight: 'android.permission.health.WRITE_WEIGHT',
};

/**
 * True only if this record type's WRITE permission is in the granted set.
 *
 * The same hard invariant as reads applies, and it is a crash and not a failure:
 * the native plugin's insertRecords() runs in an unguarded coroutine, so calling
 * it for a type whose permission was refused throws a SecurityException that
 * escapes the coroutine and takes the app down instead of rejecting the promise.
 * Never write a type this returns false for.
 */
export function canWrite(type: WriteType, granted: Set<string> | string[]): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  const perm = WRITE_PERMISSION[type];
  return !!perm && set.has(perm);
}

/** True only if this record type's read permission is in the granted set. */
export function canRead(type: RecordType, granted: Set<string> | string[]): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return set.has(READ_PERMISSION[type]);
}

/** The subset of READ_TYPES that are safe to read (permission granted). */
export function grantedReadTypes(granted: Set<string> | string[]): RecordType[] {
  const set = granted instanceof Set ? granted : new Set(granted);
  return READ_TYPES.filter((t) => set.has(READ_PERMISSION[t]));
}
