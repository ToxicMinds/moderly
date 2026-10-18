import { writable } from 'svelte/store';
import { supabase } from '$lib/db/client';
import type { User } from '@supabase/supabase-js';

export const user = writable<User | null>(null);
export const userId = writable<string>('');
export const authReady = writable(false);

let initPromise: Promise<void> | null = null;

// Real email/password accounts (not anonymous) so the SAME account/user_id
// can be used across multiple devices (iPhone + Android) and their data
// stays in sync via Supabase, instead of each device getting its own
// disposable local identity.
export async function initAuth() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      user.set(session.user);
      userId.set(session.user.id);
    }

    supabase.auth.onAuthStateChange((_event, s) => {
      user.set(s?.user ?? null);
      userId.set(s?.user?.id ?? '');
    });

    authReady.set(true);
  })();

  return initPromise;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** The version of the privacy page a consent was given to (static/privacy.html). */
export const PRIVACY_VERSION = '2026-10-18';

/** Creating an account needs explicit consent to keeping health data (GDPR
 *  Art. 9); it's recorded on the account itself, so it can be shown later. */
export async function signUp(email: string, password: string, consent: boolean) {
  if (!consent) throw new Error('Tick the box to agree, or Moderly can’t keep your data.');
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { consent: { health: true, privacy: PRIVACY_VERSION, at: new Date().toISOString() } } },
  });
  if (error) throw error;
}

/** Settings → Delete my account. The server deletes the account and all of it
 *  (supabase/functions/delete-account); then nothing of it stays on this
 *  device: its notifications are disarmed, the offline copy and the local
 *  settings are wiped, and the app starts clean. */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'delete' } });
  if (error || !data?.deleted) {
    let msg = data?.error as string | undefined;
    try { msg ??= (await (error as any)?.context?.json())?.error; } catch { /* no body */ }
    throw new Error(msg || 'Could not delete the account. Nothing was lost; try again.');
  }
  const { scheduleNativeAlarms, scheduleNudges, disarmMoments } = await import('$lib/nativeAlarms');
  await Promise.allSettled([scheduleNativeAlarms([]), scheduleNudges([]), disarmMoments()]);
  const { default: db } = await import('$lib/db/dexie');
  db.close();
  await db.delete().catch(() => {});
  try { localStorage.clear(); } catch { /* storage disabled */ }
  await supabase.auth.signOut().catch(() => {});
  location.replace('/');
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getUserId(): Promise<string> {
  const uid = await new Promise<string>((resolve) => {
    const unsub = userId.subscribe((v) => {
      if (v) { unsub(); resolve(v); }
    });
  });
  return uid;
}

