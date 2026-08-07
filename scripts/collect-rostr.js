/* ROSTR roster collector — paste into the browser console on www.rostr.cc while logged in.
 *
 * ===========================================================================
 *  HOW TO RUN A ROSTER REFRESH  (no AI agent needed — this is the whole job)
 * ===========================================================================
 *
 *  1. Open https://www.rostr.cc in Chrome and make sure you're logged in.
 *  2. Press F12, click the "Console" tab.
 *     (First time only: Chrome may make you type  allow pasting  and hit Enter
 *      before it will accept a paste. That's a Chrome safety prompt, harmless.)
 *  3. Open THIS file, select all, copy, paste into the console, press Enter.
 *  4. A panel appears top-right. Phase 1 takes ~2 minutes. Phase 2 takes a
 *     few hours. LEAVE THE TAB OPEN — other tabs and normal browsing are fine.
 *  5. Click "Download data" when it says Finished. (You can click it at ANY
 *     time — it snapshots whatever has been collected so far and doesn't
 *     interrupt the run. Do this if you need to stop early.)
 *  6. The file lands in your Downloads folder as rostr-raw-collection.json.
 *  7. In the repo, merge it into the app's roster:
 *
 *        node scripts/merge-roster.mjs ~/Downloads/rostr-raw-collection.json
 *
 *     It prints "artists lost: 0 / emails lost: 0". If either is NOT zero,
 *     something is wrong — don't commit, investigate first.
 *
 *  8. Commit and push:  git add -A && git commit -m "Refresh roster" && git push
 *
 *  IF IT STOPS EARLY: click Download to keep the data, then just paste the
 *  script again later. It resumes from where it left off (progress is saved in
 *  the browser), so nothing is redone and nothing is lost.
 *
 *  IF IT SAYS "Signed out": log back into ROSTR, paste the script again.
 *
 *  IF IT SAYS a bucket "hit the cap": some artists were missed because ROSTR
 *  won't return more than 2,000 per query and that slice couldn't be split
 *  further. The count is in the downloaded file under `saturatedBuckets`.
 *
 * ===========================================================================
 *
 * Runs entirely in the page, because ROSTR's session is an httpOnly cookie that
 * no external script can read. Nothing here needs credentials, an API key, or
 * any help from an AI agent — paste it, wait, click Download.
 *
 * Two phases:
 *   1. Artist list  — POST /v3/artist/filter, partitioned by Spotify-follower
 *                     range. Fast (~2 min).
 *   2. Manager info — GET /v1/artist/{id}/team/MANAGEMENT, one per artist.
 *                     Slow (hours). This is the phase that gets you throttled.
 *
 * Pacing rules, learned the hard way on 2026-08-07 when a run without them got
 * the account blocked (RS-4290) after ~13,000 requests:
 *
 *   - ROSTR signals overload with HTTP 529, NOT 429. Backoff logic that
 *     allowlists 429/503 sails straight through it. Retry on ANY 429 or 5xx.
 *   - Intervals are jittered. Perfectly even spacing is itself a signal.
 *   - The delay ratchets UP on every throttle and never fully resets, so a run
 *     that starts getting pushback gets progressively politer.
 *   - It gives up rather than grinding: MAX_STRIKES consecutive throttles stops
 *     the run. A run that has to be forced through is one that should stop.
 *
 * Progress is checkpointed to IndexedDB, so closing the tab or a crash costs
 * you nothing — re-paste and it resumes. Download works at ANY point, not just
 * at the end; it snapshots whatever has been collected so far without
 * interrupting the run. Nothing about the download is visible to ROSTR — it's
 * built from memory and written to disk with no network call involved.
 */
(async () => {
  'use strict';

  const API = 'https://api.rostr.cc';
  const FLOOR = 100000;          // Spotify followers. Below this the data thins out
  const CEIL = 300000000;        // and spMetric stops working as a partition key.
  const PAGE_SIZE = 250;         // server max; it errors above this
  const HARD_CAP = 2000;         // max records ANY single query will return
  const BASE_DELAY = 450;        // ms between manager lookups, before jitter
  const MAX_DELAY = 8000;
  const MAX_STRIKES = 8;         // consecutive throttles before giving up
  const SAVE_EVERY = 200;

  if (window.__rostrCollector) { console.warn('Collector already running.'); return; }
  window.__rostrCollector = true;

  const S = { artists: new Map(), managers: new Map(), failed: new Set(),
    phase: 'starting', leaves: [], saturated: [], throttles: 0, strikes: 0,
    delay: BASE_DELAY, stopped: false, done: false, listComplete: false };
  window.__S = S;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jitter = ms => Math.round(ms * (0.7 + Math.random() * 0.6));

  // ---------------------------------------------------------------- storage
  const DB = 'rostr-collect';
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  async function put(key, val) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (_e) { /* storage full or blocked — the run still works, just can't resume */ }
  }
  async function get(key) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readonly');
        const q = tx.objectStore('kv').get(key);
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
    } catch (_e) { return undefined; }
  }
  // `artists` is ~15MB serialized, so it is written ONCE when phase 1 finishes
  // rather than on every checkpoint. Writing it on all ~105 phase-2 checkpoints
  // meant re-serializing 15MB each time, which stalls the run and risks the
  // storage quota. Phase 2 only ever changes `managers`/`failed`.
  const saveAll = () => Promise.all([
    put('artists', [...S.artists]), put('managers', [...S.managers]),
    put('failed', [...S.failed]), put('listComplete', S.listComplete),
  ]);
  const saveProgress = () => Promise.all([
    put('managers', [...S.managers]), put('failed', [...S.failed]),
  ]);

  // ------------------------------------------------------------------- http
  // Retries on ANY 429/5xx. The 529-specific bug was treating an unlisted code
  // as a permanent failure and moving on at full speed.
  async function req(url, opts, attempt = 0) {
    if (S.stopped) throw new Error('stopped');
    let r;
    try {
      r = await fetch(url, opts);
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(jitter(1500 * (attempt + 1)));
      return req(url, opts, attempt + 1);
    }
    if (r.status === 429 || r.status >= 500) {
      S.throttles++; S.strikes++;
      S.delay = Math.min(Math.round(S.delay * 1.6), MAX_DELAY);   // ratchet, never resets fully
      if (S.strikes >= MAX_STRIKES) {
        S.stopped = true;
        ui(`<b style="color:#f66">STOPPED — ROSTR is throttling (HTTP ${r.status}).</b><br>`
         + `Click Download to keep what's collected, then try again later.`);
        throw new Error('throttled');
      }
      if (attempt >= 6) throw new Error('giving up on ' + url);
      await sleep(jitter(4000 * (attempt + 1)));
      return req(url, opts, attempt + 1);
    }
    S.strikes = 0;
    // Decay the delay back toward baseline slowly, so one bad patch doesn't
    // permanently halve throughput but recovery isn't instant either.
    if (S.delay > BASE_DELAY) S.delay = Math.max(BASE_DELAY, Math.round(S.delay * 0.97));
    return r;
  }

  async function filter(lo, hi, page) {
    const r = await req(`${API}/v3/artist/filter`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // filterIsDirty is MANDATORY — without it the filter is silently ignored
        // and you get unfiltered results back with no error.
        artistQueryFilters: { spMetric: { selected: [lo, hi], filterIsDirty: true } },
        artistResults: { page, pageSize: PAGE_SIZE, sortField: 'spMetric', sortDir: 'descend' },
      }),
    });
    // A dropped session mid-run is very likely across a multi-hour job, and
    // without this check the 401 body parses fine, `total` is undefined, and
    // the run dies later on `probe.data` with a confusing TypeError.
    if (r.status === 401 || r.status === 403) {
      S.stopped = true;
      ui('<b style="color:#f66">Signed out.</b><br>Log back into ROSTR, then paste the '
       + 'script again — it resumes from where it stopped.');
      throw new Error('unauthenticated');
    }
    const j = await r.json().catch(() => null);
    if (!j || typeof j.total !== 'number' || !Array.isArray(j.data)) {
      throw new Error(`unexpected filter response (HTTP ${r.status})`);
    }
    return j;
  }

  // -------------------------------------------------------------------- ui
  let panel, statusEl;
  function ui(html) { if (statusEl) statusEl.innerHTML = html; }
  function buildUi() {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#111;'
      + 'color:#eee;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;padding:12px 14px;'
      + 'border:1px solid #444;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.55);min-width:265px';
    panel.innerHTML = '<div id="__rs">starting…</div>'
      + '<button id="__rd" style="margin-top:10px;width:100%;padding:8px;background:#28d17c;color:#000;'
      + 'border:0;border-radius:5px;font:700 12px ui-monospace,monospace;cursor:pointer">Download data</button>'
      + '<button id="__rx" style="margin-top:6px;width:100%;padding:6px;background:#2a2a2a;color:#ddd;'
      + 'border:1px solid #555;border-radius:5px;font:12px ui-monospace,monospace;cursor:pointer">Stop</button>';
    document.body.appendChild(panel);
    statusEl = panel.querySelector('#__rs');
    panel.querySelector('#__rd').onclick = download;
    panel.querySelector('#__rx').onclick = () => {
      S.stopped = true;
      ui('<b>Stopped by you.</b><br>Download still works.');
    };
  }

  function download() {
    const artists = [];
    for (const [id, d] of S.artists) {
      const people = S.managers.get(id);
      artists.push({
        rostrId: id, entity: d.entity, avatar: d.avatar, genre: d.genre, type: d.type,
        gender: d.gender, spMetric: d.spMetric, igMetric: d.igMetric, ytMetric: d.ytMetric,
        fbMetric: d.fbMetric, igUrl: d.igUrl, spUrl: d.spUrl,
        management: (d.management || []).map(m => ({ name: m.name, rostrId: m.rostrId })),
        agencies: (d.agencies || []).map(m => ({ name: m.name })),
        labels: (d.labels || []).map(m => ({ name: m.name })),
        publishers: (d.publishers || []).map(m => ({ name: m.name })),
        managers: people || [],
        managersResolved: !!people && !S.failed.has(id),
      });
    }
    const payload = {
      collectedAt: new Date().toISOString(),
      complete: S.done,
      stats: {
        artists: artists.length,
        resolved: artists.filter(a => a.managersResolved).length,
        pending: artists.filter(a => !a.managersResolved).length,
        saturatedBuckets: S.saturated.length,
      },
      // Non-empty means some artists were silently dropped: a bucket still held
      // >= 2000 records at max recursion depth and the API won't return more.
      saturatedBuckets: S.saturated,
      artists,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    a.download = 'rostr-raw-collection.json';
    document.body.appendChild(a); a.click(); a.remove();
  }

  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '0%';
  function render() {
    if (S.stopped || S.done) return;
    const total = S.artists.size;
    const resolved = S.managers.size;
    const withEmail = [...S.managers.values()].filter(v => v.some(p => p.email)).length;
    if (S.phase === 'list') {
      ui(`<b>Phase 1/2 — artist list</b><br>${total} artists found<br>`
       + `${S.leaves.length} brackets done`);
    } else {
      ui(`<b>Phase 2/2 — manager emails</b><br>`
       + `${resolved.toLocaleString()} / ${total.toLocaleString()} (${pct(resolved, total)})<br>`
       + `${withEmail.toLocaleString()} with an email<br>`
       + `<span style="color:${S.throttles ? '#fc6' : '#8c8'}">`
       + `${S.throttles ? `slowed down (${S.throttles} throttles, ${S.delay}ms)` : 'running normally'}</span>`);
    }
  }

  // ------------------------------------------------------- phase 1: the list
  // `total` is CLAMPED to 2000, so it cannot distinguish "exactly 2000" from
  // "20,000". Any bucket reporting the cap gets split and recursed; only a
  // bucket reporting strictly under it is trustworthy and safe to page through.
  async function collectRange(lo, hi, depth) {
    if (S.stopped) return;
    const probe = await filter(lo, hi, 1);
    const total = probe.total;
    if (total === 0) return;

    if (total >= HARD_CAP && depth < 26 && lo < hi) {
      const mid = Math.floor(lo + (hi - lo) / 2);
      await collectRange(lo, mid, depth + 1);
      await collectRange(mid + 1, hi, depth + 1);
      return;
    }
    if (total >= HARD_CAP) S.saturated.push([lo, hi, total]);   // couldn't split further

    for (const d of probe.data) if (!S.artists.has(d.rostrId)) S.artists.set(d.rostrId, d);
    const pages = Math.ceil(total / PAGE_SIZE);
    for (let p = 2; p <= pages; p++) {
      if (S.stopped) return;
      await sleep(jitter(250));
      const j = await filter(lo, hi, p);
      for (const d of j.data) if (!S.artists.has(d.rostrId)) S.artists.set(d.rostrId, d);
      render();
    }
    S.leaves.push([lo, hi, total]);
    render();
    await saveAll();
  }

  // --------------------------------------------------- phase 2: the managers
  async function collectManagers(id) {
    const r = await req(`${API}/v1/artist/${encodeURIComponent(id)}/team/MANAGEMENT`,
      { credentials: 'include' });
    // 404 is a real answer: this artist has no management entry. Anything else
    // non-OK is a failure and must NOT be recorded as "no managers", or the
    // artist is silently written off as unreachable and never retried.
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`team lookup HTTP ${r.status}`);
    const j = await r.json();
    const out = [];
    for (const group of Object.values(j)) {
      for (const t of (group.team || [])) {
        for (const p of (t.people || [])) {
          out.push({ name: p.name, email: p.email || null, role: p.role, companyName: p.companyName });
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------- main
  buildUi();

  const [savedArtists, savedManagers, savedFailed, savedComplete] =
    await Promise.all([get('artists'), get('managers'), get('failed'), get('listComplete')]);
  if (savedArtists && savedArtists.length) {
    S.artists = new Map(savedArtists);
    S.managers = new Map(savedManagers || []);
    S.failed = new Set(savedFailed || []);
    S.listComplete = !!savedComplete;
    console.log(`[rostr] resumed: ${S.artists.size} artists, ${S.managers.size} already looked up`);
  }

  try {
    if (!S.listComplete) {
      S.phase = 'list'; render();
      await collectRange(FLOOR, CEIL, 0);
      if (S.stopped) throw new Error('stopped');   // don't mark a partial list complete
      S.listComplete = true;
      await saveAll();
    }

    S.phase = 'managers'; render();
    const todo = [...S.artists.keys()].filter(id => !S.managers.has(id) || S.failed.has(id));
    let n = 0;
    for (const id of todo) {
      if (S.stopped) break;
      // Contained per artist. Without this, one lookup exhausting its retries
      // throws all the way out of the loop and ends the entire run — losing
      // hours of remaining work over a single bad record.
      try {
        const people = await collectManagers(id);
        S.managers.set(id, people);
        S.failed.delete(id);   // only on success, so a retry-worthy failure stays queued
      } catch (_e) {
        if (S.stopped) break;  // throttled/stopped/signed-out: leave the rest untouched
        S.failed.add(id);
        S.managers.delete(id); // don't let a failure masquerade as "no managers"
      }
      if (++n % SAVE_EVERY === 0) await saveProgress();
      if (n % 10 === 0) render();
      await sleep(jitter(S.delay));
    }
    await saveProgress();

    if (!S.stopped) {
      S.done = true;
      const withEmail = [...S.managers.values()].filter(v => v.some(p => p.email)).length;
      ui(`<b style="color:#28d17c">Finished.</b><br>${S.artists.size.toLocaleString()} artists<br>`
       + `${withEmail.toLocaleString()} with a manager email<br>`
       + (S.saturated.length ? `<span style="color:#fc6">${S.saturated.length} bucket(s) hit the cap — some artists missed</span><br>` : '')
       + `<b>Click Download.</b>`);
    }
  } catch (e) {
    if (String(e.message) !== 'throttled' && String(e.message) !== 'stopped') {
      ui(`<b style="color:#f66">Error:</b> ${e.message}<br>Download still works.`);
    }
    console.error('[rostr]', e);
  } finally {
    window.__rostrCollector = false;
  }
})();
