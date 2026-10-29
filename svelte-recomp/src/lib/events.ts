// Where new people give up, counted in Moderly's own database, no trackers:
// one row per person, event and day, through note_event (migration
// 20261029100000_app_events), which ignores any name not on its list.
// owner_metrics turns them into the Numbers page. Never throws, never waits:
// counting must not slow the screen it counts.
import { supabase } from '$lib/db/client';

/** Keep equal to the list in note_event (selfcheck holds them together). */
export const APP_EVENTS = ['open', 'setup_1', 'setup_2', 'setup_3', 'setup_done'] as const;
export type AppEvent = (typeof APP_EVENTS)[number];

const sent = new Set<string>();

export function noteEvent(event: AppEvent): void {
  const key = `${event}:${new Date().toISOString().slice(0, 10)}`;
  if (sent.has(key)) return;
  sent.add(key);
  void supabase.rpc('note_event', { p_event: event }).then(({ error }) => {
    if (error) console.warn('[events] not counted:', error.message);
  });
}
