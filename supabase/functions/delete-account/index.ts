// The right to erasure (GDPR Art. 17): Settings → Delete my account.
//
// Deletes the caller's account, and with it every row they own (every table's
// user_id references auth.users ON DELETE CASCADE). Their photos are files, not
// rows, so they go first. Acts only on the user behind the token, never on an
// id in the body, and only when the body says "delete".
import { corsHeaders, json } from '../_shared/llm.ts';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUCKETS = ['progress-photos'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: req.headers.get('Authorization') ?? '', apikey: ANON } });
  const id = who.ok ? (await who.json())?.id : null;
  if (typeof id !== 'string') return json({ error: 'Sign in to delete your account.' }, 401);
  let body: any = null;
  try { body = await req.json(); } catch { /* checked below */ }
  if (body?.confirm !== 'delete') return json({ error: 'Type delete to confirm.' }, 400);

  const admin = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  for (const bucket of BUCKETS) {
    const list = await fetch(`${URL_}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: admin, body: JSON.stringify({ prefix: id, limit: 1000, offset: 0 }),
    });
    if (!list.ok) return json({ error: 'Could not reach your photos, so nothing was deleted. Try again.' }, 502);
    const paths = ((await list.json()) as Array<{ name: string }>).map((f) => `${id}/${f.name}`);
    if (paths.length) {
      const del = await fetch(`${URL_}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: admin, body: JSON.stringify({ prefixes: paths }) });
      if (!del.ok) return json({ error: 'Could not delete your photos, so the account was kept. Try again.' }, 502);
    }
  }
  const gone = await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin });
  if (!gone.ok) return json({ error: 'Your photos are deleted, but the account could not be. Try again.' }, 502);
  return json({ deleted: true });
});
