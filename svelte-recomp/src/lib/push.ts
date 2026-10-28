const VAPID_PUBLIC_KEY = 'BDl0k_5i0K812VUVDdB8_KRD8bSdRVwgrlpax0ZSJbdwS1HTtj76gcOvefZuDDqatqLaQ-8hDLXwa5kVRPouGHM';

function b64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

export async function subscribeWebPush(uid: string): Promise<boolean> {
  console.log('[Push] subscribeWebPush called for uid:', uid);
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
    console.log('[Push] PushManager or serviceWorker not supported, aborting');
    return false;
  }
  try {
    console.log('[Push] waiting for serviceWorker.ready...');
    const reg = await navigator.serviceWorker.ready;
    console.log('[Push] SW ready, scope:', reg.scope);
    let sub = await reg.pushManager.getSubscription();
    console.log('[Push] existing subscription:', sub ? sub.endpoint : null);
    if (!sub) {
      console.log('[Push] Notification.permission:', typeof Notification !== 'undefined' ? Notification.permission : 'n/a');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY),
      });
      console.log('[Push] new subscription created:', sub.endpoint);
    }
    const { supabase } = await import('$lib/db/client');
    const { error } = await supabase.from('push_subscriptions').upsert(
      { user_id: uid, subscription: sub.toJSON(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) { console.error('[Push] upsert to push_subscriptions failed:', error); return false; }
    console.log('[Push] subscription saved successfully');
    return true;
  } catch (e) {
    console.warn('[Push] subscription failed:', e);
    return false;
  }
}
