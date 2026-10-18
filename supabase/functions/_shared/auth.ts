// Only a signed-in user may spend the AI providers' quota (and this project's
// function calls). verify_jwt alone isn't that: the public anon key is a valid
// JWT too, and it ships inside the web app, so anyone could call these from a
// script. Asking Supabase Auth for the user behind the token is: an anon key
// has no user, an expired or forged token is refused.
const AUTH_URL = `${Deno.env.get('SUPABASE_URL')}/auth/v1/user`;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** The signed-in user's id, or null. */
export async function signedIn(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const res = await fetch(AUTH_URL, { headers: { Authorization: auth, apikey: ANON }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const user = await res.json();
    return typeof user?.id === 'string' ? user.id : null;
  } catch {
    return null;
  }
}
