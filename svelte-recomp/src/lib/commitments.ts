// What the user has committed to — the goal, the line, the plans, and the
// reason behind them — and the one place each is saved. Today shows them as one
// row; the line alert and the plan strip open the same editors.
import { writable, get } from 'svelte/store';
import { upsertRecord } from '$lib/stores/sync';
import { userId } from '$lib/stores/user';
import { cleanPlans, type Plans } from '$lib/plans';

/** Which editor is open, wherever it was opened from. */
export const editing = writable<'line' | 'plans' | null>(null);

function uid(): string {
  const id = get(userId);
  if (!id) throw new Error('Not signed in — sign back in.');
  return id;
}

/** Draw (or redraw) the line from today; null removes it. */
export async function saveLine(kg: number | null, today: string): Promise<void> {
  await upsertRecord('user_settings', {
    user_id: uid(), line: kg != null && kg > 0 ? { kg: Math.round(kg * 10) / 10, set: today } : null,
    updated_at: new Date().toISOString(),
  });
}

export async function savePlans(plans: Plans): Promise<void> {
  await upsertRecord('user_settings', { user_id: uid(), plans: cleanPlans(plans), updated_at: new Date().toISOString() });
}

/** The user's reason, in their own words. Private; shown back at hard moments. */
export async function saveWhy(why: string): Promise<void> {
  await upsertRecord('user_settings', { user_id: uid(), why: why.trim().slice(0, 280) || null, updated_at: new Date().toISOString() });
}
