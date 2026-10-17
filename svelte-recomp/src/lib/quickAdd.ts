// FOOD LOGGING, MADE CHEAP.
//
// Food logging is this app's dominant interaction by an order of magnitude — the
// one daily user logs 5-8 entries every single day, ~2,500 a year. Every one of
// them used to cost: open the form, type a name, wait on an OpenFoodFacts round
// trip (in a gym basement, maybe), then fill four macro fields. Seconds there
// compound into whether someone is still logging in week three.
//
// Almost none of that typing is necessary, because people eat the same things.
// This module derives three shortcuts from the food_logs the user ALREADY has:
//
//   frequentFoods()  — the handful you log constantly, one tap to log again
//   groupIntoMeals() — entries logged together become a re-loggable "meal"
//   repeatDay()      — everything you ate yesterday that you haven't logged today
//
// Deliberately NO saved-meals table. A meal is just the foods you logged within
// a few minutes of each other, so it can be derived — which means no migration,
// no RLS policy, no new row in the sync TABLES list, and nothing new that could
// leak between accounts (see the data-isolation audit).

import { cleanName, foodKey, historyFoods } from './food.ts';

/** A food_logs row, loosely typed — this module is pure and takes plain rows. */
export interface FoodRow {
  id?: string;
  name?: string | null;
  date?: string | null;
  kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  created_at?: string | null;
  grams?: number | null;
  source?: string | null;
  barcode?: string | null;
}

export interface QuickFood {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Portion in grams when it was recorded. */
  grams?: number | null;
  /** How many times this name has ever been logged — drives the ranking. */
  count: number;
  /** Most recent date it was logged, so "recent" can beat "frequent" on ties. */
  lastDate: string;
}

const num = (n: unknown): number => {
  const x = typeof n === 'string' ? parseFloat(n) : n;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
};

/**
 * Foods ranked by how much you actually use them, carrying the macros from the
 * MOST RECENT time you logged each — so a portion you corrected last week is the
 * one that comes back, not the first guess you ever made.
 *
 * Ranking is count first, recency second. A food eaten 40 times but not for a
 * month still beats one eaten twice yesterday: the chips are for the staples.
 *
 * Grouping is by cleaned name (see food.ts): legacy rows carried their source in
 * the name — "Plain white rice (cooked) (AI estimate, high confidence)" — and
 * the old rule skipped anything named "(AI estimate". That kept this user's two
 * most-logged foods (rice x48, whey x37) out of quick add entirely. A ONE-OFF AI
 * guess is still not a staple; a repeated one is.
 */
export function frequentFoods(logs: FoodRow[], limit = 8): QuickFood[] {
  return historyFoods(logs)
    .filter((c) => !(c.ai && (c.count ?? 1) < 2))
    .slice(0, Math.max(0, limit))
    .map((c) => ({
      name: c.name,
      kcal: c.portion?.kcal ?? 0, protein_g: c.portion?.protein_g ?? 0,
      carbs_g: c.portion?.carbs_g ?? 0, fat_g: c.portion?.fat_g ?? 0,
      grams: c.portion?.grams ?? null,
      count: c.count ?? 1, lastDate: c.lastDate ?? '',
    }));
}

export interface Meal {
  /** Stable within a day — used as a keyed-each key and a "already added" marker. */
  key: string;
  /** "Breakfast", "Lunch", "Dinner", "Snack" — from the clock, not from a field. */
  label: string;
  /** ISO timestamp of the first item, or '' when the rows carry no created_at. */
  at: string;
  items: QuickFood[];
  kcal: number;
  protein_g: number;
}

/** Entries logged more than this far apart are separate meals, not one sitting. */
const MEAL_GAP_MS = 45 * 60 * 1000;

function mealLabel(hour: number): string {
  if (hour < 11) return 'Breakfast';
  if (hour < 15) return 'Lunch';
  if (hour < 21) return 'Dinner';
  return 'Snack';
}

/**
 * Cluster one day's entries into meals by when they were logged. Rows without a
 * created_at (hand-entered on a device with no clock context, or restored from
 * an old export) all collapse into a single unlabelled group rather than being
 * dropped — losing food from a re-log would be worse than an imprecise label.
 */
export function groupIntoMeals(logs: FoodRow[], dayYmd: string): Meal[] {
  const day = logs
    .filter((f) => f.date === dayYmd && f.name?.trim())
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  if (day.length === 0) return [];

  const clusters: FoodRow[][] = [];
  let current: FoodRow[] = [];
  let prevMs: number | null = null;

  for (const f of day) {
    const ms = f.created_at ? Date.parse(f.created_at) : NaN;
    const valid = Number.isFinite(ms);
    if (current.length > 0 && valid && prevMs != null && ms - prevMs > MEAL_GAP_MS) {
      clusters.push(current);
      current = [];
    }
    current.push(f);
    if (valid) prevMs = ms;
  }
  if (current.length > 0) clusters.push(current);

  return clusters.map((rows, i) => {
    const at = rows.find((r) => r.created_at)?.created_at || '';
    const hour = at ? new Date(at).getHours() : NaN;
    const items: QuickFood[] = rows.map((r) => ({
      name: cleanName(r.name || ''), grams: num(r.grams) || null,
      kcal: num(r.kcal), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
      count: 1, lastDate: r.date || dayYmd,
    }));
    return {
      key: `${dayYmd}#${i}`,
      label: Number.isFinite(hour) ? mealLabel(hour) : 'Meal',
      at,
      items,
      kcal: Math.round(items.reduce((s, x) => s + x.kcal, 0)),
      protein_g: Math.round(items.reduce((s, x) => s + x.protein_g, 0)),
    };
  });
}

/**
 * Everything eaten on `fromYmd` that has NOT already been logged on `toYmd`, so
 * "repeat yesterday" is safe to tap twice — the second tap adds nothing rather
 * than silently doubling the day's calories. Matching is by name: the same food
 * logged twice yesterday and once today still has one serving left to add.
 */
export function repeatDay(logs: FoodRow[], fromYmd: string, toYmd: string): QuickFood[] {
  const remaining = new Map<string, number>();
  for (const f of logs) {
    if (f.date !== toYmd) continue;
    const n = f.name?.trim() ? foodKey(f.name) : '';
    if (n) remaining.set(n, (remaining.get(n) ?? 0) + 1);
  }

  const out: QuickFood[] = [];
  for (const f of logs.filter((x) => x.date === fromYmd).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))) {
    if (!f.name?.trim()) continue;
    const key = foodKey(f.name);
    const already = remaining.get(key) ?? 0;
    if (already > 0) { remaining.set(key, already - 1); continue; }
    out.push({
      name: cleanName(f.name), kcal: num(f.kcal), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g),
      fat_g: num(f.fat_g), grams: num(f.grams) || null, count: 1, lastDate: f.date || fromYmd,
    });
  }
  return out;
}
