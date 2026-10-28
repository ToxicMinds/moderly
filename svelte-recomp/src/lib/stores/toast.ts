// The app's voice.
//
// Everything else here REACTS — cards recompute, orbs fill, auras breathe — but
// nothing ever SPEAKS to you the moment something happens. This is that: a small
// queue of short, spoken coaching lines that surface as a toast when a genuine
// event occurs (a new weight low, a lift PR, protein hit, going over budget).
//
// Two rules keep it from becoming noise:
//   1. Every message carries a `key`. The same event only ever speaks ONCE per
//      session — logging the same PR twice, or re-rendering a page, can't make
//      it nag. (Callers use a stable per-event key, e.g. `low-88.4`.)
//   2. It's opt-in per event at the call site, not a firehose over every state
//      change. The app talks when it has something worth saying.

import { writable } from 'svelte/store';
import { haptic, toneHaptic } from '$lib/haptics';

export type ToastTone = 'good' | 'ok' | 'warn' | 'bad';

export interface Toast {
  id: number;
  key: string;
  tone: ToastTone;
  icon: string;
  title: string;
  /** Optional second line — the "so do this" follow-through. */
  body?: string;
  /** Auto-dismiss after this many ms (0 = sticky until tapped). */
  ttl: number;
}

export const toasts = writable<Toast[]>([]);

let nextId = 1;
// Keys already spoken this session — the dedupe guard.
const spoken = new Set<string>();

export interface SpeakOpts {
  tone?: ToastTone;
  icon?: string;
  body?: string;
  ttl?: number;
  /** Say it again even if this key already fired this session. */
  force?: boolean;
}

/**
 * Queue a spoken line. Returns false (and does nothing) when this key has
 * already been said this session and `force` isn't set — so callers can fire
 * it unconditionally inside reactive code without causing repeats.
 */
export function speak(key: string, title: string, opts: SpeakOpts = {}): boolean {
  if (!opts.force && spoken.has(key)) return false;
  spoken.add(key);
  const toast: Toast = {
    id: nextId++,
    key,
    tone: opts.tone ?? 'ok',
    icon: opts.icon ?? '💬',
    title,
    body: opts.body,
    ttl: opts.ttl ?? 6000,
  };
  toasts.update((list) => {
    // Collapse a superseding message with the same key (e.g. a re-forced one).
    const filtered = list.filter((t) => t.key !== key);
    return [...filtered, toast].slice(-4); // never stack more than 4
  });
  // The app now touches you the instant it speaks — the buzz mirrors the tone
  // (a rising pattern for a win, a firm nudge for a warning), so voice, colour
  // and feel all land together.
  haptic(toneHaptic(toast.tone));
  return true;
}

export function dismissToast(id: number) {
  toasts.update((list) => list.filter((t) => t.id !== id));
}

/** Test/util: forget what's been said (used when signing out). */
export function resetSpoken() {
  spoken.clear();
  toasts.set([]);
}
