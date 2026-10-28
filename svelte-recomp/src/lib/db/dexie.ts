import Dexie from 'dexie';

export interface Alarm {
  id: string; user_id: string; title: string; message: string;
  time: string; days: number[]; enabled: boolean;
  created_at: string;
}

export interface DailyLog {
  user_id: string; date: string; kcal?: number;
  water_glasses?: number; evening_checks?: Record<string, boolean>;
}

export interface Weight {
  id: number; user_id: string; date: string; weight: number;
  created_at: string;
}

export interface Step {
  id: number; user_id: string; date: string; count: number;
  created_at: string;
}

export interface Session {
  id: number; user_id: string; date: string; type: string;
  created_at: string;
}

export interface CheckItem {
  id: string; date: string; user_id: string;
  text: string; done: boolean;
}

export interface TrackEntry {
  id: string; date: string; user_id: string;
  name: string; value: number; unit: string;
}

export interface MealPlan {
  user_id: string; week_start: string;
  plan: Record<string, any>; created_at: string;
}

export interface UserSettings {
  user_id: string; goal_kg: number; updated_at: string;
}

export interface WorkoutSet { reps: number | null; weight_kg: number | null; }

export interface WorkoutLog {
  user_id: string; date: string; exercise_name: string;
  session_key: string | null; sets: WorkoutSet[]; updated_at: string;
}

export interface FoodLog {
  id: string; user_id: string; date: string; name: string;
  kcal: number; protein_g: number; carbs_g: number; fat_g: number; created_at: string;
}

export interface Biometric {
  user_id: string; date: string; sleep_hours?: number; sleep_quality?: number;
  resting_hr?: number; hrv?: number; updated_at: string;
}

/**
 * A generated/saved recipe. Column names differ slightly from the static
 * Recipe type in $lib/data/recipes because `desc` is a reserved SQL word —
 * the Recipes page normalises both into one shape for rendering.
 */
export interface CustomRecipe {
  id: string; user_id: string;
  name: string; e: string; t: number;
  k: number; p: number; c: number; f: number; batch: number;
  descr: string;
  ing: Array<{ n: string; a: string; cat: string; pr?: number }>;
  prep: string[]; steps: string[]; instant_pot: string[];
  kid: boolean; coach_note: string; request: string;
  created_at: string;
}

export interface ActivitySessionRow {
  id: string; user_id: string; date: string;
  exercise_type: number; label: string; emoji: string; kind: string;
  start: string; end: string; duration_min: number;
  active_kcal: number | null; distance_m: number | null; avg_hr: number | null;
  source: string; updated_at: string;
}

const db = new Dexie('recompos');

db.version(1).stores({
  alarms: 'id, user_id, enabled',
  daily_logs: '&[user_id+date], user_id, date',
  weights: '++id, user_id, date',
  steps: '++id, user_id, date',
  sessions: '++id, user_id, date',
  checks: '&[id+user_id], id, date, user_id',
  tracks: '&[id+user_id], id, date, name, user_id',
  meal_plans: '&[user_id+week_start], user_id, week_start',
});

// v2: add compound [user_id+date] index to weights/steps so we can look up
// "does today's entry already exist" locally (offline-first) instead of
// round-tripping to Supabase before every save.
db.version(2).stores({
  weights: '++id, user_id, date, [user_id+date]',
  steps: '++id, user_id, date, [user_id+date]',
});

// v3: add user_settings table so per-user values like goal weight are
// editable in the UI and sync across devices instead of being a hardcoded
// constant.
db.version(3).stores({
  user_settings: '&user_id',
});

// v4: add editable, per-user workout schedule + sessions tables so the
// gym plan (which days map to which session, and the exercises within
// each session) is editable in the UI and synced across devices instead
// of being a hardcoded constant in workouts.ts.
db.version(4).stores({
  workout_schedule: '&[user_id+day_of_week], user_id, day_of_week',
  workout_sessions_custom: '&[user_id+key], user_id, key',
});

// v5: workout_logs records the actual weight/reps performed per set for
// each exercise on a given day, so the plan can be more than a static
// checklist — this powers "last time you did X kg" progressive-overload
// prompts, session history, and total volume/tonnage tracking.
db.version(5).stores({
  workout_logs: '&[user_id+date+exercise_name], user_id, date, exercise_name, [user_id+exercise_name]',
});

// v6: food_logs tracks individual food entries (name + macros) per day,
// replacing the single hardcoded kcal-only quick-log with real
// protein/carbs/fat tracking -- essential for a recomp-focused app.
db.version(6).stores({
  food_logs: '&id, user_id, date, [user_id+date]',
});

// v7: biometrics stores manual sleep/resting-HR/HRV entries per day,
// used to compute a daily readiness score and training-load balance
// (see readiness.ts) without requiring any wearable hardware.
db.version(7).stores({
  biometrics: '&[user_id+date], user_id, date',
});

// v8: activity_sessions caches watch-recorded workouts (badminton, runs,
// strength sessions) read from Health Connect's ExerciseSession records. It's
// a local-only, native-derived cache (re-derived on every watch sync), so it
// deliberately has no Supabase counterpart — it powers the "today's activity"
// coaching confirmation and the recent-activity feed.
db.version(8).stores({
  activity_sessions: '&id, user_id, date, [user_id+date]',
});

// v9: recipes_custom holds recipes generated on demand (see the generate-recipe
// edge function) instead of only the 19 hardcoded ones compiled into the bundle.
// Synced like other owned rows, so a recipe you liked survives a reinstall.
db.version(9).stores({
  recipes_custom: '&id, user_id, created_at, [user_id+created_at]',
});

export default db;

export async function initDB() {
  await db.open();
}
