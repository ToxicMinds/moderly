import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';

// persistSession + autoRefreshToken keep the login alive across app
// reopens and deploys (the token is stored in localStorage, which
// survives service-worker updates and page reloads) and silently refresh
// it before it expires — so a new deploy no longer means signing in again.
// The default storageKey is kept intentionally so existing stored sessions
// are still found (changing it would log everyone out once).
export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
