// The user profile — what turns this from one person's app into anyone's.
//
// The app was built around hardcoded constants in config.ts: a goal and a
// start weight derived from one person's body. Worse,
// BodyGoals collected height, age and sex as LOCAL COMPONENT STATE — you had to
// retype them every single visit, and nothing else in the app could ever see
// them. So the TDEE engine, which needs all three, could not run unless you were
// currently sitting on that one screen filling the form in again.
//
// Everything personal now lives in one record, entered once. Age is stored as a
// BIRTH YEAR rather than a number of years, because an age silently becomes
// wrong and a birth year never does.

export type Sex = 'male' | 'female';
export type Units = 'metric' | 'imperial';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export interface Profile {
  user_id: string;
  display_name?: string | null;
  height_cm?: number | null;
  birth_year?: number | null;
  /** Used only for the BMR equation and body-fat formulas, both of which are sex-specific. */
  sex?: Sex | null;
  activity_level?: ActivityLevel | null;
  units?: Units | null;
  /** Weight at the very start, for the "how far you've come" bar. */
  start_kg?: number | null;
  goal_kg?: number | null;
  goal_reason?: string | null;
  updated_at?: string;
}

/** Current age in whole years, or null when birth year is unknown/implausible. */
export function ageFrom(birthYear: number | null | undefined, now: Date = new Date()): number | null {
  if (!birthYear) return null;
  const age = now.getFullYear() - birthYear;
  // Reject nonsense rather than feeding a negative age into Mifflin-St Jeor.
  return age >= 13 && age <= 100 ? age : null;
}

/**
 * A profile is "complete" only when it has everything the calorie engine needs.
 * Anything less and TDEE cannot be computed, so onboarding must ask.
 */
export function isComplete(p: Partial<Profile> | null | undefined): boolean {
  if (!p) return false;
  return (
    !!p.height_cm && p.height_cm >= 100 && p.height_cm <= 250 &&
    ageFrom(p.birth_year) != null &&
    (p.sex === 'male' || p.sex === 'female') &&
    !!p.goal_kg && p.goal_kg > 0
  );
}

/** Which fields are still missing, for a specific prompt instead of a vague one. */
export function missingFields(p: Partial<Profile> | null | undefined): string[] {
  const out: string[] = [];
  if (!p?.height_cm) out.push('height');
  if (ageFrom(p?.birth_year) == null) out.push('year of birth');
  if (p?.sex !== 'male' && p?.sex !== 'female') out.push('sex');
  if (!p?.goal_kg) out.push('goal weight');
  return out;
}

// — Unit conversion. Stored values are ALWAYS metric; units are a display
// preference only. Mixing storage units is how weight histories get corrupted.
export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}
export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}
export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / CM_PER_INCH;
  const ft = Math.floor(totalIn / 12);
  return { ft, inch: Math.round(totalIn - ft * 12) };
}
export function ftInToCm(ft: number, inch: number): number {
  return (ft * 12 + inch) * CM_PER_INCH;
}

/** Format a weight for display in the user's chosen units. */
export function formatWeight(kg: number | null | undefined, units: Units = 'metric'): string {
  if (kg == null) return '—';
  return units === 'imperial' ? `${kgToLb(kg).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
}

/**
 * A sane starting goal weight when the user has no target in mind: BMI 24.9,
 * the top of the "healthy" band.
 *
 * Offered as a SUGGESTION only, never silently applied. BMI ignores body
 * composition entirely — a muscular lifter can sit above it at a perfectly good
 * body fat — which is exactly why the old hardcoded GOAL_KG = 90 needed the
 * long apologetic comment explaining why it wasn't really right.
 */
export function suggestGoalKg(heightCm: number | null | undefined): number | null {
  if (!heightCm || heightCm < 100) return null;
  const m = heightCm / 100;
  return Math.round(24.9 * m * m);
}

/**
 * Protein target in grams: ~1.8 g per kg of GOAL bodyweight.
 *
 * Scaling to goal rather than current weight matters for anyone carrying
 * significant fat mass — fat tissue doesn't need feeding, so scaling to total
 * weight overshoots badly. 1.8 g/kg of target weight converges with the
 * g/kg-lean-mass approach (Helms 2014) and sits mid-range of the 1.6–2.4 g/kg
 * deficit guideline (Morton 2018; ISSN 2017).
 */
export function proteinTargetG(goalKg: number | null | undefined, currentKg?: number | null): number {
  const basis = goalKg && goalKg > 0 ? goalKg : currentKg || 0;
  return Math.round(basis * 1.8);
}

/**
 * Sensible default activity level from how much the person says they train.
 * Only a starting point — adaptive TDEE overrides it from real data within a
 * few weeks, which is the honest answer for everyone.
 */
export function suggestActivityLevel(sessionsPerWeek: number): ActivityLevel {
  if (sessionsPerWeek <= 0) return 'sedentary';
  if (sessionsPerWeek <= 2) return 'light';
  if (sessionsPerWeek <= 5) return 'moderate';
  if (sessionsPerWeek <= 7) return 'active';
  return 'very_active';
}
