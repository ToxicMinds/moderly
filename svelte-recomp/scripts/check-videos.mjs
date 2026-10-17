#!/usr/bin/env node
/**
 * Verify every YouTube id in the app still plays, and still plays IN AN IFRAME.
 *
 * WHY THIS EXISTS: 11 of the 12 exercise videos shipped in the Quick Builder
 * had been deleted or made private, so nearly every "Watch full video" button
 * opened a dead player. Nothing caught it. A dead id fails INSIDE the iframe —
 * the network request succeeds and YouTube renders "Video unavailable" in its
 * own frame — so VideoEmbed's `onerror` never fires and the fallback never
 * shows. There is no runtime signal to detect this; it has to be checked here.
 *
 * Two things are asserted per id, because they fail independently:
 *   1. status = OK        — the video exists and is public.
 *   2. playableInEmbed    — the owner allows third-party embedding. A video can
 *                           be perfectly fine on youtube.com and still refuse
 *                           to play in our modal.
 *
 * Network-dependent, so it is NOT part of `npm run selfcheck` (which must stay
 * offline and deterministic). Run it before shipping a change to any video id:
 *
 *     npm run check:videos
 *
 * Exits non-zero listing every broken id. Yes, it scrapes the watch page —
 * the oEmbed endpoint reports existence but says nothing about embeddability,
 * and the Data API needs a key we don't want to ship or store.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const CONCURRENCY = 4;

/** Every `vid: 'x'` / `"vid": "x"` / `v: 'x'` literal, mapped to where it lives. */
async function collectIds(dir, out = new Map()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectIds(full, out);
      continue;
    }
    if (!['.ts', '.svelte', '.js'].includes(extname(entry.name))) continue;
    const src = await readFile(full, 'utf8');
    // YouTube ids are exactly 11 chars of [A-Za-z0-9_-]. Anchoring on that
    // length keeps this from matching unrelated short `v:` properties.
    for (const m of src.matchAll(/["']?\b(?:vid|v)["']?\s*:\s*['"]([A-Za-z0-9_-]{11})['"]/g)) {
      const rel = full.slice(ROOT.length);
      if (!out.has(m[1])) out.set(m[1], new Set());
      out.get(m[1]).add(rel);
    }
  }
  return out;
}

async function probe(id) {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  const html = await res.text();
  const status = html.match(/"status":"([A-Z_]+)"/)?.[1] ?? 'UNKNOWN';
  const embeddable = html.match(/"playableInEmbed":(true|false)/)?.[1];
  const title = html.match(/<meta name="title" content="([^"]*)"/)?.[1] ?? '';
  if (status !== 'OK') return { ok: false, why: `unavailable (${status})`, title };
  // A missing field is treated as a failure rather than a pass: if YouTube ever
  // changes the markup, this check must go loud, not silently green.
  if (embeddable !== 'true') return { ok: false, why: `embedding disabled (${embeddable ?? 'no field'})`, title };
  return { ok: true, title };
}

const ids = await collectIds(ROOT);

// Data modules that build exercises with a helper (positional args, no `vid:`
// literal for the regex to see) are walked structurally instead.
const DATA_MODULES = ['lib/data/backRebuild.ts'];
for (const rel of DATA_MODULES) {
  const mod = await import(new URL('../src/' + rel, import.meta.url).href);
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.vid === 'string' && /^[A-Za-z0-9_-]{11}$/.test(o.vid)) {
      if (!ids.has(o.vid)) ids.set(o.vid, new Set());
      ids.get(o.vid).add(rel);
    }
    Object.values(o).forEach(walk);
  })(mod);
}
if (!ids.size) {
  console.error('No video ids found — the extraction regex is probably broken.');
  process.exit(1);
}
console.log(`Checking ${ids.size} YouTube ids…\n`);

const entries = [...ids.entries()];
const broken = [];
for (let i = 0; i < entries.length; i += CONCURRENCY) {
  await Promise.all(
    entries.slice(i, i + CONCURRENCY).map(async ([id, files]) => {
      let r;
      try {
        r = await probe(id);
      } catch (e) {
        r = { ok: false, why: `network error: ${e.message}` };
      }
      if (r.ok) {
        console.log(`  ok    ${id}  ${r.title.slice(0, 58)}`);
      } else {
        console.log(`  DEAD  ${id}  ${r.why}`);
        broken.push({ id, why: r.why, files: [...files] });
      }
    })
  );
}

if (broken.length) {
  console.error(`\n${broken.length} of ${ids.size} video(s) will not play in the app:\n`);
  for (const b of broken) console.error(`  ${b.id}  — ${b.why}\n      in ${b.files.join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${ids.size} videos play, and play embedded.`);
