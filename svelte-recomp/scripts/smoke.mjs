// After a deploy: every address serves this commit, the pages people land on
// load, and the edge functions answer. Exits 1 on any failure, and
// scripts/ship.sh rolls back. Usage: node scripts/smoke.mjs <commit>
import { readFileSync } from 'node:fs';

const sha = process.argv[2];
if (!sha) throw new Error('usage: node scripts/smoke.mjs <commit>');
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const fn = `${env.PUBLIC_SUPABASE_URL}/functions/v1`;
const HOSTS = ['https://svelte-recomp.vercel.app', 'https://slimchance.app', 'https://slimchance.vercel.app', 'https://moderly.vercel.app'];
const fails = [];
const get = async (url, init = {}) => {
  const r = await fetch(url, { redirect: 'manual', ...init, headers: { 'cache-control': 'no-cache', ...init.headers } });
  return { status: r.status, type: r.headers.get('content-type') ?? '', location: r.headers.get('location') ?? '', body: await r.text() };
};
const expect = (ok, what) => { if (!ok) fails.push(what); };

// Every address on this commit; the edge may need a moment to move over.
for (const h of HOSTS) {
  let v = '';
  for (let i = 0; i < 12 && v !== sha; i++) {
    if (i) await new Promise((r) => setTimeout(r, 5000));
    try { v = JSON.parse((await get(`${h}/_app/version.json?t=${Date.now()}`)).body).version; } catch { v = ''; }
  }
  expect(v === sha, `${h} serves ${v || 'nothing'}, not ${sha}`);
}

const site = HOSTS[0];
for (const [path, marker] of [['/', 'id="boot"'], ['/about/', '<title>Slim Chance'], ['/privacy.html', 'Slim Chance'],
  ['/guides/why-the-scale-went-up/', 'Slim Chance'], ['/guides/consistent-beats-accurate/', 'Slim Chance']]) {
  const r = await get(site + path);
  expect(r.status === 200 && r.body.includes(marker), `${path}: ${r.status}${r.body.includes(marker) ? '' : `, no ${marker}`}`);
}
const www = await get('https://www.slimchance.app/');
expect(www.status === 308 && www.location.startsWith('https://slimchance.app'), `www: ${www.status} to ${www.location || 'nowhere'}`);

const ics = await get(`${fn}/reminder-ics?t=07:30`);
expect(ics.status === 200 && ics.type.startsWith('text/calendar') && ics.body.startsWith('BEGIN:VCALENDAR'), `reminder-ics: ${ics.status} ${ics.type}`);
const coach = await get(`${fn}/coach`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
expect(coach.status === 401, `coach without a login: ${coach.status}, not 401`);

if (fails.length) {
  console.error(`smoke: ${fails.length} failed\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log(`smoke: ${HOSTS.length} addresses on ${sha}, pages and functions answer.`);
