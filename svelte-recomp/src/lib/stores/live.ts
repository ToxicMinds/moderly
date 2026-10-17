import { writable, get, derived, type Writable } from 'svelte/store';
import { liveQuery } from 'dexie';
import db from '$lib/db/dexie';
import { userId } from './user';
import { nowTick } from './refresh';
import { overlaySessions } from '$lib/program';
import { todayYmd } from '$lib/date';

let currentUid = '';

const alarmResults = writable<any[]>([]);
const weightResults = writable<any[]>([]);
const logResults = writable<Map<string, any>>(new Map());
const goalResult = writable<number | null>(null);
const goalReasonResult = writable<string | null>(null);
const scheduleResults = writable<any[]>([]);
const sessionResults = writable<Map<string, any>>(new Map());
const workoutLogResults = writable<any[]>([]);
const foodLogResults = writable<any[]>([]);
const mealPlanResults = writable<Map<string, any>>(new Map());
const biometricResults = writable<any[]>([]);
const checksResults = writable<any[]>([]);
const sessionsResults = writable<any[]>([]);
const stepResults = writable<any[]>([]);
const trackResults = writable<any[]>([]);
const activityResults = writable<any[]>([]);
const customRecipeResults = writable<any[]>([]);
const profileResult = writable<any | null>(null);
// Distinguishes "not loaded yet" from "loaded and genuinely empty" — without
// this the onboarding gate flashes on every launch before user_settings arrives.
const profileLoaded = writable(false);

userId.subscribe((uid) => {
  if (!uid || uid === currentUid) return;
  currentUid = uid;

  liveQuery(() => db.table('alarms').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => alarmResults.set(data),
    error: () => alarmResults.set([])
  });

  liveQuery(() => db.table('weights').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => weightResults.set(data),
    error: () => weightResults.set([])
  });

  liveQuery(() => db.table('daily_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.date, row);
      logResults.set(map);
    },
    error: () => logResults.set(new Map())
  });

  liveQuery(() => db.table('user_settings').where('user_id').equals(uid).first()).subscribe({
    next: (data) => {
      goalResult.set(data?.goal_kg ?? null);
      goalReasonResult.set(data?.goal_reason ?? null);
      profileResult.set(data ?? null);
      profileLoaded.set(true);
    },
    error: () => {
      goalResult.set(null);
      goalReasonResult.set(null);
      profileResult.set(null);
      profileLoaded.set(true);
    }
  });

  liveQuery(() => db.table('workout_schedule').where('user_id').equals(uid).sortBy('day_of_week')).subscribe({
    next: (data) => scheduleResults.set(data),
    error: () => scheduleResults.set([])
  });

  liveQuery(() => db.table('workout_sessions_custom').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.key, row);
      sessionResults.set(map);
    },
    error: () => sessionResults.set(new Map())
  });

  liveQuery(() => db.table('workout_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => workoutLogResults.set(data),
    error: () => workoutLogResults.set([])
  });

  liveQuery(() => db.table('food_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => foodLogResults.set(data),
    error: () => foodLogResults.set([])
  });

  // meal_plans previously used a manual db.table().get() call re-run from
  // a $effect keyed off $syncStatus === 'synced' -- but syncStatus can
  // already be 'synced' (from an earlier, faster table's initial sync)
  // by the time meal_plans' own initial fetch actually lands, so that
  // effect would never re-fire and the page would silently show stale/
  // empty data until a manual edit or full reload happened to re-trigger
  // it. liveQuery reacts directly to the IndexedDB write itself, so it
  // has no such race regardless of table fetch ordering/timing.
  liveQuery(() => db.table('meal_plans').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.week_start, row);
      mealPlanResults.set(map);
    },
    error: () => mealPlanResults.set(new Map())
  });

  liveQuery(() => db.table('biometrics').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => biometricResults.set(data),
    error: () => biometricResults.set([])
  });

  liveQuery(() => db.table('checks').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => checksResults.set(data),
    error: () => checksResults.set([])
  });

  liveQuery(() => db.table('sessions').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => sessionsResults.set(data),
    error: () => sessionsResults.set([])
  });

  liveQuery(() => db.table('steps').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => stepResults.set(data),
    error: () => stepResults.set([])
  });

  liveQuery(() => db.table('tracks').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => trackResults.set(data),
    error: () => trackResults.set([])
  });

  liveQuery(() => db.table('activity_sessions').where('user_id').equals(uid).sortBy('start')).subscribe({
    next: (data) => activityResults.set(data),
    error: () => activityResults.set([])
  });

  liveQuery(() => db.table('recipes_custom').where('user_id').equals(uid).sortBy('created_at')).subscribe({
    next: (data) => customRecipeResults.set(data),
    error: () => customRecipeResults.set([])
  });
});

export function liveAlarms() {
  return { subscribe: alarmResults.subscribe };
}

export function liveLog(date: string) {
  const store: Writable<any> = writable(null);
  const unsub = logResults.subscribe((map) => {
    store.set(map.get(date) || null);
  });
  return { subscribe: store.subscribe };
}

// All daily_logs rows as a flat array (every date). Used to build the intake
// series for adaptive-TDEE — quick-logged single-kcal days count too, not just
// itemised food_logs.
export function liveDailyLogs() {
  const store: Writable<any[]> = writable([]);
  const unsub = logResults.subscribe((map) => {
    store.set(Array.from(map.values()));
  });
  return { subscribe: store.subscribe };
}

export function liveWeights() {
  return { subscribe: weightResults.subscribe };
}

export function liveGoal() {
  return { subscribe: goalResult.subscribe };
}

// The "why" behind the current goal weight (see the Plan page's
// TDEE-backed "Set as my goal" flow) -- so the goal is never shown as
// just a bare, unexplained number anywhere it's displayed.
export function liveGoalReason() {
  return { subscribe: goalReasonResult.subscribe };
}

export function liveSchedule() {
  return { subscribe: scheduleResults.subscribe };
}

// The sessions every screen trains from: the user's own, with an active
// program's sessions laid over their gym days (see $lib/program). One place, so
// Today, Train, the nudges and recovery can never disagree about what today's
// session is — and the user's own plan returns untouched when the program ends.
const overlaidSessions = derived(
  [sessionResults, scheduleResults, profileResult, nowTick],
  ([sessions, schedule, profile]) => overlaySessions(sessions, schedule, profile?.program, todayYmd()),
);

export function liveWorkoutSessions() {
  return { subscribe: overlaidSessions.subscribe };
}

// All workout_logs rows for the current user (every date/exercise). Kept as
// a flat array so the UI can derive both "today's entry" and "most recent
// prior entry" (for progressive-overload prompts) per exercise without a
// separate query per exercise.
export function liveWorkoutLogs() {
  return { subscribe: workoutLogResults.subscribe };
}

// All food_logs rows for the current user (every date). Consumers filter
// by date client-side for daily totals.
export function liveFoodLogs() {
  return { subscribe: foodLogResults.subscribe };
}

// Meal plan for a specific week (keyed by week_start date string), reading
// live from IndexedDB so it never depends on syncStatus timing.
export function liveMealPlan(weekStart: string) {
  const store: Writable<Record<string, any>> = writable({});
  const unsub = mealPlanResults.subscribe((map) => {
    store.set(map.get(weekStart)?.plan ?? {});
  });
  return { subscribe: store.subscribe };
}

// Union of every date on which the user logged ANY activity (daily
// quick-log, weigh-in, food entry, or workout set) -- used to power the
// logging-streak counter on the Today page. Derived from the same
// liveQuery results already being tracked above, so no extra Dexie
// subscription is needed.
export function liveActivityDates() {
  const store: Writable<string[]> = writable([]);
  function updateDates() {
    const dates = new Set<string>();
    for (const row of get(logResults).values()) dates.add(row.date);
    for (const row of get(weightResults)) dates.add(row.date);
    for (const row of get(foodLogResults)) dates.add(row.date);
    for (const row of get(workoutLogResults)) dates.add(row.date);
    store.set([...dates]);
  }
  logResults.subscribe(updateDates);
  weightResults.subscribe(updateDates);
  foodLogResults.subscribe(updateDates);
  workoutLogResults.subscribe(updateDates);
  return { subscribe: store.subscribe };
}

// All biometrics rows (sleep/RHR/HRV) for the current user, used by the
// readiness score and training-load calculations.
export function liveBiometrics() {
  return { subscribe: biometricResults.subscribe };
}

// Checklist items for a specific date, read live from IndexedDB. Used by
// the Today page's evening checklist -- fixes the same stale-until-
// reload race as alarms/weights/meal_plans (a realtime push from
// another device updates IndexedDB correctly, but a manual
// "$syncStatus === 'synced'" reload effect can miss it entirely if
// syncStatus had already settled before the push arrived).
export function liveChecks(date: string) {
  const store: Writable<any[]> = writable([]);
  checksResults.subscribe((all) => {
    store.set(
      all
        .filter((r) => r.date === date)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    );
  });
  return { subscribe: store.subscribe };
}

// Workout-session "Mark Complete" history, read live from IndexedDB.
export function liveSessionCompletions() {
  const store: Writable<any[]> = writable([]);
  sessionsResults.subscribe((rows) => {
    store.set(
      [...rows]
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 10)
    );
  });
  return { subscribe: store.subscribe };
}

// All steps rows (every date) for the current user, sorted ascending by
// date. Steps are stored in their own `steps` table (not daily_logs), so
// reading them here fixes the Today page previously looking for a
// non-existent daily_logs.steps field.
export function liveSteps() {
  return { subscribe: stepResults.subscribe };
}

// All tracks rows (body measurements like body_fat) for the current user,
// sorted ascending by date. Powers the Body & Goals measurement history.
export function liveTracks() {
  return { subscribe: trackResults.subscribe };
}

// Watch-recorded exercise sessions (badminton, runs, strength) synced from
// Health Connect, sorted ascending by start time. Local-only cache.
export function liveActivitySessions() {
  return { subscribe: activityResults.subscribe };
}

// Recipes generated on demand for this user (see the generate-recipe edge
// function), oldest first. The Recipes page shows these alongside the built-in
// ones, newest at the top.
export function liveCustomRecipes() {
  return { subscribe: customRecipeResults.subscribe };
}

// The full user_settings row — height, birth year, sex, units, goal (see
// $lib/profile). Everything personal that used to be a hardcoded constant or
// unsaved form state.
export function liveProfile() {
  return { subscribe: profileResult.subscribe };
}

// True once user_settings has been read at least once, so the caller can tell
// "no profile yet" apart from "still loading".
export function liveProfileLoaded() {
  return { subscribe: profileLoaded.subscribe };
}
