<script lang="ts">
  import { todayYmd } from '$lib/date';
  // Progress photo log with before/after slider comparison (Noom-style).
  // Photos are stored in Supabase Storage under a private, per-user
  // folder (progress-photos/{uid}/{date}-{angle}.jpg) with RLS scoping
  // read/write to the owning user only; metadata (date/angle) lives in
  // the progress_photos table so we can list/query without hitting
  // Storage's listing API. Photos are captured or picked via the
  // standard file input `capture` attribute (opens the camera directly
  // on mobile) -- no extra camera-permission UI needed beyond what the
  // browser already provides for <input type=file capture>.
  import { userId, isTrial } from '$lib/stores/user';
  import { saveAccountOpen } from '$lib/stores/notices';
  import { supabase } from '$lib/db/client';
  import { liveProfile } from '$lib/stores/live';
  import { fileToDownscaledDataUrl } from '$lib/image';
  import { analyzeBodyPhoto, saveAnalysis, analyzedStoragePaths, healBodyFatTracks } from '$lib/bodyPhoto';

  // When a photo is analysed, the parent (BodyGoals) re-loads its physique
  // snapshots so the "where you're winning / bettering or worse" card updates.
  let { onAnalyzed }: { onAnalyzed?: () => void } = $props();

  const _profile = liveProfile();
  const gender = $derived(($_profile as any)?.sex === 'female' ? 'female' : 'male');

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let photos = $state<Array<{ id: string; date: string; angle: string; url: string; storagePath: string }>>([]);
  let loading = $state(true);
  let loadError = $state('');
  let uploading = $state(false);
  let uploadMsg = $state('');
  let angle = $state<'front' | 'side' | 'back'>('front');

  // — Body-fat analysis wiring (unifies the two photo pipelines) —
  let analyzeOnUpload = $state(true);
  let bfMsg = $state('');
  let backfilling = $state(false);
  let backfillMsg = $state('');
  let backfillDone = $state(0);
  let backfillTotal = $state(0);

  // — Physique snapshots (bf% + per-region scores) shown right here, so photos
  //   and their body-fat analysis live in ONE place instead of two cards. —
  type Region = { key: string; label: string; score: number; note: string };
  type Snapshot = { id: string; date: string; bf_percent: number | null; regions: Region[]; summary: string | null; created_at: string };
  type DailySnap = { date: string; bf_percent: number | null; regions: Region[]; summary: string | null; reads: number };
  let snapshots = $state<Snapshot[]>([]);

  async function loadSnapshots() {
    if (!uid) return;
    try {
      const { data, error } = await supabase
        .from('physique_snapshots')
        .select('id, date, bf_percent, regions, summary, created_at')
        .eq('user_id', uid)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      snapshots = (data as Snapshot[]) || [];
    } catch (e) {
      console.error('Load snapshots failed:', e);
    }
  }
  $effect(() => { if (uid) loadSnapshots(); });

  // Aggregate every snapshot of a DAY (front + side + back) into ONE reading,
  // so the trend compares DIFFERENT DAYS instead of pitting a day's own front
  // against its side (which made a single day look like "24% -> 28%"). bf% and
  // each region score are averaged across that day's photos.
  const dailySnaps = $derived.by((): DailySnap[] => {
    const byDate = new Map<string, Snapshot[]>();
    for (const s of snapshots) (byDate.get(s.date) || byDate.set(s.date, []).get(s.date)!).push(s);
    const out: DailySnap[] = [];
    for (const [date, snaps] of byDate) {
      const bfVals = snaps.map((s) => Number(s.bf_percent)).filter((n) => !isNaN(n));
      const bf = bfVals.length ? Math.round((bfVals.reduce((a, b) => a + b, 0) / bfVals.length) * 10) / 10 : null;
      // Average region scores across the day's photos, keyed by region.
      const acc = new Map<string, { label: string; note: string; scores: number[] }>();
      for (const s of snaps) for (const r of s.regions || []) {
        const e = acc.get(r.key) || { label: r.label, note: r.note, scores: [] };
        e.scores.push(r.score); if (r.note) e.note = r.note;
        acc.set(r.key, e);
      }
      const regions: Region[] = [...acc.entries()].map(([key, e]) => ({
        key, label: e.label, note: e.note,
        score: Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length),
      }));
      const summary = snaps[snaps.length - 1]?.summary ?? null;
      out.push({ date, bf_percent: bf, regions, summary, reads: snaps.length });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });

  const latestSnap = $derived(dailySnaps.length > 0 ? dailySnaps[dailySnaps.length - 1] : null);
  const prevSnap = $derived(dailySnaps.length > 1 ? dailySnaps[dailySnaps.length - 2] : null);
  const bfTrend = $derived.by(() => {
    if (dailySnaps.length < 2) return null;
    const first = dailySnaps[0].bf_percent, last = latestSnap?.bf_percent ?? null;
    if (first == null || last == null) return null;
    return { first, last, delta: Math.round((last - first) * 10) / 10 };
  });
  const regionDeltas = $derived.by(() => {
    if (!latestSnap) return [] as Array<Region & { delta: number | null }>;
    const prevByKey = new Map((prevSnap?.regions || []).map((r) => [r.key, r.score]));
    return latestSnap.regions.map((r) => {
      const before = prevByKey.get(r.key);
      return { ...r, delta: before == null ? null : r.score - before };
    });
  });
  const mostImproved = $derived.by(() => {
    const withDelta = regionDeltas.filter((r) => r.delta != null && (r.delta as number) > 0);
    return withDelta.sort((a, b) => (b.delta as number) - (a.delta as number))[0] || null;
  });
  const needsFocus = $derived.by(() => {
    const regressed = regionDeltas.filter((r) => r.delta != null && (r.delta as number) < 0)
      .sort((a, b) => (a.delta as number) - (b.delta as number))[0];
    if (regressed) return regressed;
    return [...regionDeltas].sort((a, b) => a.score - b.score)[0] || null;
  });

  let compareA = $state<string | null>(null);
  let compareB = $state<string | null>(null);
  let sliderPct = $state(50);

  async function loadPhotos() {
    if (!uid) return;
    loading = true;
    loadError = '';
    const { data, error } = await supabase
      .from('progress_photos')
      .select('id, date, angle, storage_path')
      .eq('user_id', uid)
      .order('date', { ascending: true });
    if (error) { console.error('Load photos failed:', error); loadError = 'Could not load your photo list: ' + error.message; loading = false; return; }

    // Previously any createSignedUrl failure was silently swallowed here
    // (the destructured `error` was never even read) -- if generating a
    // signed URL failed for any reason (an expired/stale session after
    // the tab sat idle a long time is the most likely cause; signed URLs
    // also only last as long as their requested expiry), every photo
    // would just get url: '' and render as a blank, broken <img> with no
    // visible explanation at all -- which reads exactly like "my photos
    // vanished," even though the data was always safe in Storage the
    // whole time. Now the failure is captured, logged, and shown.
    let anyFailed = false;
    const withUrls = await Promise.all(
      (data || []).map(async (row) => {
        const { data: signed, error: signErr } = await supabase.storage
          .from('progress-photos')
          .createSignedUrl(row.storage_path, 60 * 60 * 24); // 24hr -- long enough that a signed URL won't silently expire mid-session
        if (signErr) { console.error('Signed URL failed for', row.storage_path, signErr); anyFailed = true; }
        return { id: row.id, date: row.date, angle: row.angle, url: signed?.signedUrl || '', storagePath: row.storage_path };
      })
    );
    if (anyFailed) loadError = 'Some photos failed to load a viewing link. Try tapping "Reload" below, or refresh the page.';
    photos = withUrls;
    loading = false;
    // Default comparison: oldest vs newest for the currently selected angle.
    const forAngle = photos.filter((p) => p.angle === angle);
    if (forAngle.length >= 2) {
      compareA = forAngle[0].id;
      compareB = forAngle[forAngle.length - 1].id;
    }
  }

  $effect(() => { if (uid) loadPhotos(); });

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !uid) return;
    uploading = true;
    uploadMsg = '';
    try {
      const today = todayYmd();
      const path = `${uid}/${today}-${angle}-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('progress-photos').upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from('progress_photos').insert({
        user_id: uid, date: today, angle, storage_path: path,
      });
      if (dbErr) throw dbErr;
      uploadMsg = 'Saved ✓';
      await loadPhotos();
      // Same photo now feeds BOTH pipelines: the slider AND body-fat/TDEE. Back
      // shots aren't useful for a body-fat read, so only front/side auto-run.
      if (analyzeOnUpload && (angle === 'front' || angle === 'side')) {
        await analyzeOne(file, today, path);
      }
    } catch (e: any) {
      uploadMsg = 'Upload failed: ' + (e?.message || String(e));
    } finally {
      uploading = false;
      input.value = '';
    }
  }

  // Analyse a single photo (given its File or a fetched Blob) and persist a
  // snapshot + body_fat track linked to its Storage path.
  async function analyzeOne(fileOrBlob: File | Blob, date: string, storagePath: string): Promise<boolean> {
    bfMsg = 'Estimating body fat…';
    try {
      const dataUrl = await fileToDownscaledDataUrl(fileOrBlob, { maxEdge: 1152, quality: 0.85 });
      if (!dataUrl) { bfMsg = 'Could not read the photo for analysis.'; return false; }
      const res = await analyzeBodyPhoto(dataUrl, gender);
      if (res.error) { bfMsg = 'Body-fat analysis: ' + res.error.slice(0, 140); return false; }
      if (typeof res.percent === 'number' && res.regions.length > 0) {
        const saved = await saveAnalysis({ uid, date, percent: res.percent, regions: res.regions, summary: res.summary, storagePath, source: 'progress' });
        if (!saved.ok) { bfMsg = 'Could not save analysis: ' + (saved.error || '').slice(0, 120); return false; }
        bfMsg = `Body fat ≈ ${res.estimate} — added to your physique history ✓`;
        await loadSnapshots();
        onAnalyzed?.();
        return true;
      }
      bfMsg = 'Couldn’t read a clear body-fat estimate from this photo.';
      return false;
    } catch (e: any) {
      bfMsg = 'Body-fat analysis failed: ' + (e?.message || String(e)).slice(0, 140);
      return false;
    }
  }

  // Retroactively analyse every front/side progress photo that has no snapshot
  // yet, so photos taken before this feature existed get their body-fat/TDEE
  // read and join the "bettering or worse" trend. Sequential + throttled to be
  // gentle on the model quota; dedupes on storage_path so it's safe to re-run.
  async function backfillAnalysis() {
    if (!uid || backfilling) return;
    backfilling = true;
    backfillMsg = '';
    backfillDone = 0;
    try {
      // Heal first: any snapshot from a previous run that saved without its
      // body_fat track (e.g. the uuid bug) gets its track written now, with no
      // extra AI calls.
      const healed = await healBodyFatTracks(uid);
      const already = await analyzedStoragePaths(uid);
      const pending = photos.filter((p) => (p.angle === 'front' || p.angle === 'side') && p.url && !already.has(p.storagePath));
      backfillTotal = pending.length;
      if (pending.length === 0) {
        await loadSnapshots();
        backfillMsg = healed > 0
          ? `Repaired ${healed} existing read${healed === 1 ? '' : 's'}; all eligible photos already analysed ✓`
          : 'All eligible photos are already analysed ✓';
        return;
      }
      let ok = 0;
      for (const p of pending) {
        backfillMsg = `Analysing ${backfillDone + 1} of ${pending.length} (${p.date})…`;
        try {
          const resp = await fetch(p.url);
          const blob = await resp.blob();
          const done = await analyzeOne(blob, p.date, p.storagePath);
          if (done) ok++;
        } catch (e) { console.error('Backfill item failed', p.storagePath, e); }
        backfillDone++;
        await new Promise((r) => setTimeout(r, 1200)); // throttle
      }
      backfillMsg = `Done — analysed ${ok} of ${pending.length} photo${pending.length === 1 ? '' : 's'}. See the physique breakdown below.`;
      await loadSnapshots();
      onAnalyzed?.();
    } catch (e: any) {
      backfillMsg = 'Backfill failed: ' + (e?.message || String(e)).slice(0, 140);
    } finally {
      backfilling = false;
    }
  }

  async function deletePhoto(id: string, storagePath: string) {
    try {
      await supabase.storage.from('progress-photos').remove([storagePath]);
      await supabase.from('progress_photos').delete().eq('id', id);
      await loadPhotos();
    } catch (e) { console.error('Delete photo failed:', e); }
  }

  const angleFiltered = $derived(photos.filter((p) => p.angle === angle));
  const photoA = $derived(photos.find((p) => p.id === compareA));
  const photoB = $derived(photos.find((p) => p.id === compareB));

  let sliderDragging = $state(false);
  let sliderBoxWidth = $state(0);
  function onSliderMove(e: PointerEvent, container: HTMLElement) {
    if (!sliderDragging) return;
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    sliderPct = Math.max(0, Math.min(100, pct));
  }
</script>

<div class="card">
  <div class="flex jb ac" style="margin-bottom:4px">
    <div class="card-lbl" style="margin-bottom:0">Progress Photos &amp; Body-Fat Analysis</div>
    <span class="reload-link" onclick={loadPhotos} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadPhotos(); } }}>↻ Reload</span>
  </div>

  {#if loadError}
    <div class="note-box warn" style="margin-bottom:10px">⚠️ {loadError}</div>
  {/if}

  <div class="angle-tabs">
    {#each ['front', 'side', 'back'] as a}
      <button class="tab" class:on={angle === a} onclick={() => angle = a as typeof angle}>{a}</button>
    {/each}
  </div>

  {#if $isTrial}
    <!-- Photos are kept only for saved accounts: a trial nobody uses is
         deleted after 30 days, and its files must not outlive it. -->
    <button class="btn bp bfl photo-add-btn" onclick={() => saveAccountOpen.set(true)}>Save your account to keep photos</button>
  {:else}
  <label class="btn bp bfl photo-add-btn">
    {uploading ? 'Uploading…' : `📸 Add ${angle} photo`}
    <input type="file" accept="image/*" capture="user" onchange={handleFile} disabled={uploading} style="display:none">
  </label>
  {/if}
  {#if uploadMsg}
    <div style="font-size:0.75rem;text-align:center;margin-top:6px;color:{uploadMsg.startsWith('Upload failed') ? 'var(--red)' : 'var(--green)'}">{uploadMsg}</div>
  {/if}

  <!-- The same photo now feeds body-fat/TDEE analysis, not just the slider. -->
  <label class="bf-toggle">
    <input type="checkbox" bind:checked={analyzeOnUpload} />
    <span>Also estimate body fat &amp; feed TDEE (front/side)</span>
  </label>
  {#if bfMsg}
    <div class="bf-msg">{bfMsg}</div>
  {/if}

  {#if photos.length > 0}
    <button class="btn bg_ bsm bf-backfill" onclick={backfillAnalysis} disabled={backfilling}>
      {backfilling ? `Analysing ${backfillDone}/${backfillTotal}…` : '🔬 Analyse past photos for body fat'}
    </button>
    {#if backfillMsg}
      <div class="bf-msg">{backfillMsg}</div>
    {/if}
  {/if}

  {#if loading}
    <div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:12px 0">Loading photos…</div>
  {:else if angleFiltered.length === 0}
    <div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:12px 0">No {angle} photos yet — add your first one above.</div>
  {:else if angleFiltered.length === 1}
    <div class="single-photo">
      {#if angleFiltered[0].url}
        <img src={angleFiltered[0].url} alt="Progress {angle}" />
      {:else}
        <div class="photo-broken">Couldn't load this photo — tap Reload above.</div>
      {/if}
      <div class="photo-date">{angleFiltered[0].date}</div>
    </div>
  {:else}
    <div class="compare-pickers">
      <select bind:value={compareA}>
        {#each angleFiltered as p}<option value={p.id}>{p.date}</option>{/each}
      </select>
      <span class="vs">vs</span>
      <select bind:value={compareB}>
        {#each angleFiltered as p}<option value={p.id}>{p.date}</option>{/each}
      </select>
    </div>
    {#if photoA && photoB}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="slider-box"
        bind:clientWidth={sliderBoxWidth}
        onpointerdown={() => sliderDragging = true}
        onpointerup={() => sliderDragging = false}
        onpointerleave={() => sliderDragging = false}
        onpointermove={(e) => onSliderMove(e, e.currentTarget)}
      >
        <img src={photoB.url} alt="After ({photoB.date})" class="slide-img" />
        <div class="slide-clip" style="width:{sliderPct}%">
          <img src={photoA.url} alt="Before ({photoA.date})" class="slide-img" style="width:{sliderBoxWidth}px" />
        </div>
        <div class="slide-handle" style="left:{sliderPct}%"></div>
        <div class="slide-label left">{photoA.date}</div>
        <div class="slide-label right">{photoB.date}</div>
      </div>
      <input type="range" min="0" max="100" bind:value={sliderPct} class="slide-range">
    {/if}
  {/if}

  {#if angleFiltered.length > 0}
    <div class="photo-thumbs">
      {#each angleFiltered as p}
        <div class="thumb-wrap">
          <img src={p.url} alt={p.date} class="thumb" />
          <span class="thumb-rm" onclick={() => deletePhoto(p.id, p.storagePath)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); deletePhoto(p.id, p.storagePath); } }}>✕</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Body-fat + physique breakdown, from these same photos (Gemini Vision). -->
  {#if latestSnap}
    <div class="phys-section">
      <div class="phys-head">
        <span class="phys-head-lbl">Body fat &amp; physique</span>
        {#if latestSnap.bf_percent != null}
          <span class="phys-bf">{latestSnap.bf_percent}%<em>as of {latestSnap.date}</em></span>
        {/if}
      </div>

      {#if regionDeltas.length > 0}
        <div class="phys-grid">
          {#each regionDeltas as r}
            <div class="phys-cell">
              <div class="phys-top">
                <span class="phys-lbl">{r.label}</span>
                {#if r.delta != null && r.delta !== 0}
                  <span class="phys-delta" class:up={r.delta > 0} class:down={r.delta < 0}>{r.delta > 0 ? '▲' : '▼'}{Math.abs(r.delta)}</span>
                {/if}
              </div>
              <div class="phys-bar"><div class="phys-fill" style="width:{r.score}%"></div></div>
              <div class="phys-note">{r.note}</div>
            </div>
          {/each}
        </div>
      {/if}

      {#if prevSnap}
        <div class="phys-cmp">
          {#if mostImproved}
            <div class="phys-cmp-row good">
              <span class="phys-cmp-tag">📈 Most improved</span>
              <span class="phys-cmp-val">{mostImproved.label}{#if mostImproved.delta != null} <em>+{mostImproved.delta}</em>{/if}</span>
            </div>
          {/if}
          {#if needsFocus}
            <div class="phys-cmp-row focus">
              <span class="phys-cmp-tag">🎯 Needs focus</span>
              <span class="phys-cmp-val">{needsFocus.label}{#if needsFocus.delta != null && needsFocus.delta < 0} <em>{needsFocus.delta}</em>{/if}</span>
            </div>
          {/if}
        </div>
        <div class="phys-cmp-meta">Compared with {prevSnap.date} → {latestSnap.date}</div>
      {/if}

      {#if latestSnap.summary}
        <div class="note-box" style="margin-top:10px">💬 {latestSnap.summary}</div>
      {/if}
      {#if snapshots.length >= 2 && bfTrend}
        <div class="phys-trend">
          <span class="phys-trend-lbl">Body-fat trend</span>
          <span class="phys-trend-val" class:down={bfTrend.delta < 0} class:up={bfTrend.delta > 0}>
            {bfTrend.first}% → {bfTrend.last}%
            <em>({bfTrend.delta > 0 ? '+' : ''}{bfTrend.delta}pts across {dailySnaps.length} check-ins)</em>
          </span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .angle-tabs{display:flex;gap:6px;margin-bottom:10px}
  .reload-link{font-size:0.75rem;font-weight:700;color:var(--amber);cursor:pointer}
  .angle-tabs .tab{text-transform:capitalize}
  .photo-add-btn{display:block;text-align:center;cursor:pointer}
  .single-photo{text-align:center;margin-top:10px}
  .photo-broken{font-size:0.75rem;color:#ff6b6b;background:var(--bg3);border-radius:10px;padding:24px 12px}
  .single-photo img{max-width:100%;border-radius:12px;max-height:320px;object-fit:contain}
  .photo-date{font-size:0.6875rem;color:var(--muted);margin-top:4px}
  .compare-pickers{display:flex;align-items:center;gap:8px;margin-top:10px}
  .compare-pickers select{flex:1}
  .vs{font-size:0.6875rem;color:var(--muted)}
  .slider-box{position:relative;margin-top:10px;border-radius:12px;overflow:hidden;aspect-ratio:3/4;max-height:400px;background:#000;touch-action:none}
  .slide-img{width:100%;height:100%;object-fit:cover;display:block}
  .slide-clip{position:absolute;top:0;left:0;height:100%;overflow:hidden}
  .slide-clip img{max-width:none;height:100%;object-fit:cover}
  .slide-handle{position:absolute;top:0;bottom:0;width:3px;background:#fff;transform:translateX(-50%);box-shadow:0 0 6px rgba(0,0,0,.5)}
  .slide-label{position:absolute;bottom:8px;font-size:0.6875rem;font-weight:700;color:#fff;background:rgba(0,0,0,.6);padding:3px 7px;border-radius:6px}
  .slide-label.left{left:8px}
  .slide-label.right{right:8px}
  .slide-range{margin-top:8px}
  .photo-thumbs{display:flex;gap:8px;overflow-x:auto;margin-top:10px;padding-bottom:4px}
  .thumb-wrap{position:relative;flex-shrink:0}
  .thumb{width:56px;height:56px;object-fit:cover;border-radius:8px}
  .thumb-rm{position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font-size:0.6875rem;display:flex;align-items:center;justify-content:center;cursor:pointer}
  .bf-toggle{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:0.75rem;color:var(--muted);cursor:pointer}
  .bf-toggle input{width:16px;height:16px}
  .bf-msg{font-size:0.75rem;text-align:center;margin-top:8px;color:var(--amber2);line-height:1.5}
  .bf-backfill{display:block;width:100%;text-align:center;cursor:pointer;margin-top:10px}
  .phys-section{margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
  .phys-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px}
  .phys-head-lbl{font-size:0.75rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .phys-bf{font-size:1.125rem;font-weight:800;color:var(--amber)}
  .phys-bf em{font-style:normal;font-weight:600;font-size:0.6875rem;color:var(--muted);margin-left:6px}
  .phys-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  .phys-cell{background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:11px;padding:9px 10px}
  .phys-top{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .phys-lbl{font-size:0.75rem;font-weight:700;color:var(--text)}
  .phys-delta{font-size:0.6875rem;font-weight:800}
  .phys-delta.up{color:var(--green)}
  .phys-delta.down{color:var(--red)}
  .phys-bar{height:6px;border-radius:4px;background:var(--bg3);overflow:hidden;margin:6px 0 5px}
  .phys-fill{height:100%;border-radius:4px;background:var(--grad-amber);transition:width .5s var(--ease)}
  .phys-note{font-size:0.6875rem;color:var(--muted);line-height:1.35}
  .phys-cmp{display:flex;flex-direction:column;gap:8px;margin-top:10px}
  .phys-cmp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:11px;border:1px solid var(--glass-brd)}
  .phys-cmp-row.good{background:color-mix(in srgb,var(--green) 12%,transparent)}
  .phys-cmp-row.focus{background:color-mix(in srgb,var(--amber) 12%,transparent)}
  .phys-cmp-tag{font-size:0.6875rem;font-weight:800;color:var(--muted)}
  .phys-cmp-val{font-size:0.875rem;font-weight:800;color:var(--text)}
  .phys-cmp-val em{font-style:normal;font-weight:700;font-size:0.75rem;color:var(--muted)}
  .phys-cmp-meta{font-size:0.6875rem;color:var(--muted);text-align:center;margin-top:8px}
  .phys-trend{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
  .phys-trend-lbl{font-size:0.6875rem;font-weight:700;color:var(--muted)}
  .phys-trend-val{font-size:0.8125rem;font-weight:800;color:var(--text)}
  .phys-trend-val.down{color:var(--green)}
  .phys-trend-val.up{color:var(--red)}
  .phys-trend-val em{font-style:normal;font-weight:600;font-size:0.6875rem;color:var(--muted)}
</style>
