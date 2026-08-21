// Breaks ambiguousName ties in scripts/backfill-genres.mjs by comparing
// DISCOGRAPHIES instead of genre tags. When several iTunes artists share our
// roster artist's exact name and disagree on genre, this asks a different
// question than "which genre wins a vote": which of these iTunes artists
// actually released the same music our artist did? A genuine match and an
// impostor look completely different once you compare release titles.
//
// PROTOTYPE RESULTS (2026-08-21, 8 of the hardest cases — 3+ competing
// candidates each) — measured, not re-derived: resolved 8/8. The correct
// artist shared 9-29 normalised release titles with our roster artist; every
// impostor shared 0-2. The separation is large enough to threshold on safely
// (see resolveByDiscography's acceptance rule below), but NOT so large that
// "any overlap wins" is safe — see the James Newman case in that comment.
// Notably "Tash" (28 candidates, 24 of them tagged Hip-Hop/Rap) resolved to
// Contemporary R&B: ranking by popularity, or taking iTunes' first result,
// would have been confidently wrong there. Discography is the only signal
// here that isn't a popularity contest.
//
// This module is the network-free matching core, same split as
// backfill-genres.mjs's tryFillOne/searchArtistLive: every fetch is injected
// via `deps` so scripts/discography-match.test.mjs never touches the
// network. Production wiring (Spotify auth, the iTunes throttle/backoff
// path) lives in backfill-genres.mjs, which builds the real `deps` and
// passes them down only when --discography is passed.
//
// API FACTS THIS MODULE IS BUILT AGAINST (measured 2026-08-21, don't
// re-verify without cause):
//   - Spotify's /search and .../albums endpoints now reject `limit` above 10
//     with HTTP 400 "Invalid limit" (they used to allow 50). This module
//     pages with limit=10, stopping early once a page returns fewer than 10
//     items.
//   - Spotify artist objects no longer carry `genres`/`followers`/
//     `popularity` for client-credentials apps (see backfill-genres.mjs's
//     module doc comment for the fuller story) but DO still carry `images`
//     — that's what makes the avatar-pin in step 1 below possible at all.
//   - iTunes `lookup` accepts comma-separated ids (`id=a,b,c`) and returns
//     every artist's albums in one response, each row carrying its own
//     `artistId` so results separate cleanly per candidate. Batching 6
//     candidate ids per call is what keeps a 28-candidate artist like "Tash"
//     to ~5 lookup calls instead of 28.
//   - iTunes `limit` caps at 200 (asking for more is silently treated as
//     200). A batch of 6 prolific artists measured 180 results back — close
//     enough to the cap that truncation is a real risk for a batch of
//     unusually prolific artists, hence the truncation guard in step 4.
//
// SPOTIFY CALL VOLUME (cut 2026-08-22, after a real run exhausted a
// client-credentials app's Spotify quota mid-walk and hung — see
// backfill-genres.mjs's Retry-After ceiling for the other half of that
// fix). The original version always fetched all 3 search pages and all 3
// album pages before doing anything with them: ~6 Spotify calls per
// ambiguous artist, ~5,000 across a full walk. Two changes bring that down
// to ~2-3 calls/artist:
//   - PINNING now checks after EVERY page whether it can pin (avatar first,
//     then name) and stops the moment it can — see pinOnSpotify. Our artist
//     is in their own first ten exact-name search results the overwhelming
//     majority of the time, so this is typically ONE call. The tradeoff:
//     avatar-priority is only guaranteed within pages actually fetched — if
//     page 1 contains a namesake (no avatar match) and the real avatar match
//     sits on page 2, this pins on the namesake via the weaker 'name' method
//     instead of fetching further to find the avatar match. Accepted
//     deliberately: 'name' pins are already held to a stricter acceptance
//     bar in step 5 specifically because they're weaker, and this is rare
//     enough not to be worth 2-3x the Spotify calls for every artist to
//     guard against.
//   - RELEASES are now capped at 2 pages (20 titles), not 3 (30). The
//     acceptance floor is an overlap of 2 (avatar pin) or 5 (name pin), and
//     the prototype measured real winners overlapping 9-29 titles out of a
//     possible 30 — 20 titles leaves ample headroom under either floor.
export function normalizeReleaseTitle(title) {
  let normalized = String(title || '').toLowerCase();
  // Strip parenthesised/bracketed segments as whole units first ("Album
  // (Deluxe Edition)" and "Album [Remastered]" should both collapse to
  // "album", not leave stray "deluxe edition"/"remastered" tokens behind
  // for the word-removal step below to half-clean).
  normalized = normalized.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  // Remove marketing/reissue/format words that vary between a title's
  // Spotify and iTunes listings without meaning a different release.
  normalized = normalized.replace(/\b(deluxe|remaster|remastered|edition|version|single|ep|live|explicit)\b/g, ' ');
  // Collapse everything else non-alphanumeric (punctuation, dashes,
  // apostrophes, leftover whitespace) to single spaces, then trim.
  normalized = normalized.replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized;
}

// Spotify's artist-search and artist-albums endpoints are both paged this
// same way (limit=10, stop early on a short page) — see the module doc
// comment's API facts. Shared so the two call sites in resolveByDiscography
// can't drift. `offsets` defaults to the search ceiling (3 pages, 30
// results) but pinOnSpotify below doesn't use this helper at all (it needs
// to check after every page, not just collect); the album step below calls
// this with a 2-page ceiling instead — see the module doc comment's "SPOTIFY
// CALL VOLUME" section for why the two ceilings differ.
async function collectPaginated(fetchPage, extractItems, offsets = [0, 10, 20]) {
  const collected = [];
  for (const offset of offsets) {
    // Deliberately sequential, not Promise.all: each page's need depends on
    // whether the previous page came back full.
    const page = await fetchPage(offset);
    const items = extractItems(page) ?? [];
    collected.push(...items);
    if (items.length < 10) break;
  }
  return collected;
}

/**
 * Pins our roster artist on Spotify, fetching search pages one at a time and
 * stopping the moment a page (combined with everything fetched so far) lets
 * us pin — avatar match first, then a case-insensitive exact name match. See
 * the module doc comment's "SPOTIFY CALL VOLUME" section for why this checks
 * per-page instead of collecting all 3 pages up front the way the album step
 * still does, and for the accepted tradeoff that comes with it.
 */
async function pinOnSpotify(artist, deps) {
  const itemsSoFar = [];
  for (const offset of [0, 10, 20]) {
    const page = await deps.spotifySearchArtist(artist.name, offset);
    const items = page?.artists?.items ?? [];
    itemsSoFar.push(...items);

    let pinned = null;
    let pinMethod = null;
    if (artist.avatarUrl) {
      pinned = itemsSoFar.find(item => (item.images ?? []).some(img => img.url === artist.avatarUrl)) ?? null;
      if (pinned) pinMethod = 'avatar';
    }
    if (!pinned) {
      pinned = itemsSoFar.find(item => String(item.name || '').trim().toLowerCase() === String(artist.name || '').trim().toLowerCase()) ?? null;
      if (pinned) pinMethod = 'name';
    }
    if (pinned) return { pinned, pinMethod };
    if (items.length < 10) break; // short page — no more results to fetch either way
  }
  return { pinned: null, pinMethod: null };
}

// iTunes silently caps `limit` at 200 and a batch of 6 prolific artists has
// been measured at 180 results — close enough that a batch of unusually
// prolific artists could legitimately hit the cap and get truncated.
const ITUNES_LOOKUP_BATCH_SIZE = 6;
const ITUNES_LOOKUP_TRUNCATION_THRESHOLD = 195;

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Fetches album titles for a batch of iTunes artistIds via one lookup call,
 * splitting recursively into halves whenever the response's `resultCount`
 * suggests it may have hit iTunes' 200-result cap (see
 * ITUNES_LOOKUP_TRUNCATION_THRESHOLD) — down to single-id batches, past
 * which there's nothing left to split. A clipped discography can only cause
 * a real match to be MISSED (fewer titles to overlap on), never a wrong
 * artist to be picked, but re-running as two halves is cheap insurance
 * against it, so it's worth doing rather than accepting the risk.
 * Returns a Map<String(artistId), string[]> (collectionName per album),
 * with every requested id present (possibly with an empty array) even if
 * iTunes returned nothing for it.
 */
async function fetchAlbumsForIds(ids, deps) {
  if (ids.length === 0) return new Map();

  const json = await deps.itunesLookupAlbums(ids);
  const resultCount = typeof json?.resultCount === 'number' ? json.resultCount : (json?.results?.length ?? 0);

  if (resultCount >= ITUNES_LOOKUP_TRUNCATION_THRESHOLD && ids.length > 1) {
    const mid = Math.ceil(ids.length / 2);
    const left = await fetchAlbumsForIds(ids.slice(0, mid), deps);
    const right = await fetchAlbumsForIds(ids.slice(mid), deps);
    for (const [id, titles] of right) left.set(id, titles);
    return left;
  }

  const idSet = new Set(ids.map(String));
  const byArtistId = new Map(ids.map(id => [String(id), []]));
  for (const item of json?.results ?? []) {
    // Only `collection` rows are albums/singles; `lookup` with entity=album
    // also echoes back the artist rows themselves under other wrapperTypes.
    if (item.wrapperType !== 'collection') continue;
    const artistIdStr = String(item.artistId);
    // "Keep only ids we asked for" — defensive against iTunes ever
    // returning a collection under an artistId outside this batch.
    if (!idSet.has(artistIdStr)) continue;
    byArtistId.get(artistIdStr).push(item.collectionName);
  }
  return byArtistId;
}

async function fetchAlbumsBatched(ids, deps) {
  const result = new Map();
  for (const batch of chunk(ids, ITUNES_LOOKUP_BATCH_SIZE)) {
    // Sequential on purpose: every iTunes call must go through the shared
    // throttle/backoff path (see backfill-genres.mjs), and running batches
    // concurrently would defeat that.
    const batchResult = await fetchAlbumsForIds(batch, deps);
    for (const [id, titles] of batchResult) result.set(id, titles);
  }
  return result;
}

function normalizedTitleSet(rawTitles) {
  const set = new Set();
  for (const title of rawTitles) {
    const normalized = normalizeReleaseTitle(title);
    if (normalized) set.add(normalized); // discard empties
  }
  return set;
}

function overlapCount(a, b) {
  let count = 0;
  for (const title of a) if (b.has(title)) count += 1;
  return count;
}

/**
 * Resolves an ambiguousName tie by comparing our roster artist's real
 * Spotify discography against each surviving iTunes candidate's
 * discography, instead of trying to pick a genre by vote.
 *
 * `artist` is the roster record (`name`, `avatarUrl` are what matter here).
 * `candidates` are tryFillOne's surviving mapped candidates after the
 * non-music and unmappable-genre filters — each `{ item, mapped }`, where
 * `item` is the raw iTunes search result and `mapped` its resolved roster
 * genre. `deps` supplies every fetcher (see the bottom of this comment) so
 * this function never touches the network directly.
 *
 * Five steps:
 *
 *   1. PIN our artist on Spotify (see pinOnSpotify). The roster's avatarUrl
 *      came FROM Spotify originally, so a search result whose images[]
 *      contains that exact URL is proof of identity (`pinMethod: 'avatar'`)
 *      — no name collision is possible against a URL. Failing that, fall
 *      back to a case-insensitive exact name match (`pinMethod: 'name'`) —
 *      weaker, because a Spotify NAMESAKE's discography could coherently
 *      overlap with the wrong iTunes candidate, which is why step 5 holds a
 *      'name' pin to a higher bar than an 'avatar' pin. Neither found ->
 *      return unresolved, reason 'spotifyArtistNotFound'.
 *   2. COLLECT our artist's Spotify release titles (up to 20 — see the
 *      module doc comment's "SPOTIFY CALL VOLUME" section for why 2 pages,
 *      not 3). None found -> unresolved, reason 'noSpotifyReleases'.
 *   3. NORMALISE every title on both sides the same way (see
 *      normalizeReleaseTitle) and compare as Sets, so "Album (Deluxe
 *      Edition)" on one platform matches "Album" on the other.
 *   4. COLLECT each candidate's iTunes release titles via batched lookup
 *      (see fetchAlbumsBatched).
 *   5. SCORE each candidate as the size of the intersection with our
 *      artist's title set, sort descending, and accept the top scorer only
 *      if it clears BOTH an absolute floor and a margin over the runner-up:
 *        - avatar pin: overlap >= 2 AND overlap >= 3x the runner-up's
 *        - name pin:   overlap >= 5 AND overlap >= 3x the runner-up's
 *      (a runner-up of 0 trivially satisfies the ratio half). The margin
 *      is NOT optional, even though it rejects some real matches: in the
 *      prototype, a James Newman audiobook genuinely shared a release
 *      titled "Therapy" with the musician, so "any overlap beats zero"
 *      would have been unsafe. Otherwise -> unresolved, reason
 *      'discographyInconclusive'.
 *
 * Always returns a `scoreboard` (per scored candidate: artistId, raw
 * primaryGenreName, mapped roster genre, release count, overlap) once
 * candidates were actually scored (steps 4-5 reached), so a resolved OR
 * discographyInconclusive outcome is fully auditable from the log alone —
 * empty (never scored) for 'spotifyArtistNotFound'/'noSpotifyReleases'.
 *
 * `deps`:
 *   - spotifySearchArtist(name, offset) -> Spotify's raw /search response
 *     shape ({ artists: { items: [...] } })
 *   - spotifyArtistAlbums(spotifyArtistId, offset) -> Spotify's raw
 *     .../albums response shape ({ items: [...] })
 *   - itunesLookupAlbums(ids: string[]) -> iTunes's raw /lookup response
 *     shape ({ resultCount, results: [...] })
 */
export async function resolveByDiscography(artist, candidates, deps) {
  // Step 1: pin our artist on Spotify.
  const { pinned, pinMethod } = await pinOnSpotify(artist, deps);
  if (!pinned) {
    return { resolved: false, reason: 'spotifyArtistNotFound', scoreboard: [] };
  }

  // Step 2: collect our releases — capped at 2 pages (20 titles), not 3.
  const albumItems = await collectPaginated(
    offset => deps.spotifyArtistAlbums(pinned.id, offset),
    page => page?.items,
    [0, 10]
  );
  const ourTitles = normalizedTitleSet(albumItems.map(a => a.name)); // step 3: normalise
  if (ourTitles.size === 0) {
    return { resolved: false, reason: 'noSpotifyReleases', pinMethod, spotifyArtistId: pinned.id, scoreboard: [] };
  }

  // Step 4: collect candidate releases via batched iTunes lookup.
  const releasesByArtistId = await fetchAlbumsBatched(candidates.map(c => String(c.item.artistId)), deps);

  // Step 5: score and decide.
  const scoreboard = candidates
    .map(({ item, mapped }) => {
      const releases = releasesByArtistId.get(String(item.artistId)) ?? [];
      const overlap = overlapCount(normalizedTitleSet(releases), ourTitles);
      return { artistId: item.artistId, rawGenre: item.primaryGenreName, mappedGenre: mapped, releaseCount: releases.length, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);

  const top = scoreboard[0];
  const runnerUpOverlap = scoreboard[1]?.overlap ?? 0;
  const floor = pinMethod === 'avatar' ? 2 : 5;
  const clearsFloor = top.overlap >= floor;
  const clearsMargin = top.overlap >= 3 * runnerUpOverlap; // runner-up of 0 trivially passes

  if (!clearsFloor || !clearsMargin) {
    return { resolved: false, reason: 'discographyInconclusive', pinMethod, spotifyArtistId: pinned.id, ourReleaseCount: ourTitles.size, scoreboard };
  }

  const winner = candidates.find(c => String(c.item.artistId) === String(top.artistId));
  return { resolved: true, winner, pinMethod, spotifyArtistId: pinned.id, ourReleaseCount: ourTitles.size, scoreboard };
}
