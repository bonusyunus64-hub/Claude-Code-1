// Fills in `genres: []` on roster artists using the iTunes Search API, so the
// 41.6% of the roster (3,010 artists as of the 2026-08-08 snapshot) that
// ROSTR has no genre tag for can still be found through the Demos genre
// filter — see lib/roster.ts's getArtistsByGenres for the companion change
// (an empty genre selection now means "every artist," which is what makes
// those 3,010 reachable at all today; this script is what makes them
// reachable by genre specifically, the way every other artist already is).
//
// SPOTIFY IS DEAD AS A SOURCE FOR THIS — READ BEFORE REACHING FOR IT AGAIN.
// As of 2026-08-17 the Spotify Web API no longer returns `genres`,
// `followers`, or `popularity` on artist objects for client-credentials
// apps (the only auth flow available to a server-side batch script — no
// user is in the loop to authorize a user-token scope). Verified directly:
// a raw `GET /v1/artists/06HL4z0CvFAxyc27GXpf02` (Taylor Swift) returned
// HTTP 200 with a body containing only `external_urls`, `href`, `id`,
// `images`, `name`, `type`, `uri` — no genre/follower/popularity fields at
// all, not empty ones. This is why the previous version of this script
// (see git history if you need it) rejected 49 of its first 50 candidates
// at the follower-tolerance check: Spotify was sending no follower number,
// the code defaulted that to 0, and 0 is nowhere near any real roster
// artist's follower count. That wasn't a bug in the tolerance math; it was
// Spotify's API having quietly stopped returning the field the whole check
// depended on. Don't re-add a Spotify path here without re-verifying this
// first — if Spotify's API has changed again, fine, but confirm it with a
// raw request the way the above was confirmed, not by assuming the old
// integration still works.
//
// iTunes Search API replaces it: keyless, no signup, no auth headers.
//   GET https://itunes.apple.com/search?term=<urlencoded name>&entity=musicArtist&limit=25
// Returns `results[]` with `artistName`, `artistId`, `primaryGenreName`,
// `artistLinkUrl`. There is no follower count in this payload at all, so
// the old follower cross-check has no equivalent here — see "matching rule"
// below for what replaced it. There's also only ever ONE genre per artist
// (iTunes' `primaryGenreName`), a single coarse tag, where ROSTR's own
// vocabulary is rich and multi-valued — an artist backfilled from here will
// only ever carry one genre and will only surface under broad filter
// buckets. That's a known, deliberate limitation of this data source, not a
// bug; there's a separate plan for narrowing broad-genre artists later that
// this script's provenance log (see below) exists to support.
//
// MERGE ONLY, NEVER REPLACE — same rule as scripts/merge-roster.mjs, applied
// at the field level instead of the artist level here:
//   - an artist with a non-empty `genres` array is never touched, full stop.
//     iTunes' tag is a different, potentially conflicting taxonomy from
//     whatever ROSTR/the artist's own listing already says, and this script
//     has no basis to prefer one over the other — it only fills gaps.
//   - managerEmails, managerNames, spotifyFollowers, managementCompany, and
//     every other field are read-only here. This script writes exactly one
//     field: `genres`, and only on artists that started with genres: [].
// See scripts/ROSTER_CONTEXT_CORRECTIONS.md for why that discipline matters:
// a prior pipeline change that blurred "enrich" and "replace" together
// silently dropped 1,745 contacts while reporting success.
//
// Matching a roster artist to an iTunes artist is genuinely risky — iTunes
// name search is unranked/unfiltered by disambiguation, and a wrong match
// writes a wrong genre onto a real artist's record. A 60-artist sample
// spread across the genre-less set measured: 98% have an exact
// case-insensitive name match among iTunes results, but 37% of names return
// MORE THAN ONE distinct artist under that same exact name (11 different
// artists all named "Harpy", 12 named "SOFY", 10 named "ian"), and those
// collisions usually disagree with each other on genre. Naive "first exact
// match wins" would confidently write "Rock" onto Harpy having picked one
// artist out of eleven with that name. There is no follower count here to
// break the tie with (see above), so the rule instead leans on agreement:
//
//   1. filter iTunes results to exact, case-insensitive artistName matches
//      (not "top search hit" — a fuzzy top hit is exactly the failure mode
//      this guards against) that also carry a primaryGenreName
//   2. exactly one such match -> accept it (matchType "unique")
//   3. more than one, and they all report the SAME primaryGenreName ->
//      accept it (matchType "unanimous" — agreement across independent
//      collisions is itself evidence, the way it wasn't when only one
//      Spotify candidate needed sanity-checking against a follower count)
//   4. more than one, reporting DIFFERENT genres -> skip as ambiguousName,
//      can't safely pick one
// Measured on the same sample, this rule yields roughly 70% fill (~2,100 of
// 3,010) with zero known-wrong writes — lower coverage than a naive
// approach, on purpose: every skip here is a case the data genuinely can't
// resolve safely, logged and left for a human rather than guessed at.
//
// Vocabulary: the roster uses 636 ROSTR-style genre strings ("Dance / Edm",
// "Hip Hop & Rap", "Metalcore"); iTunes returns a single Title-Case tag per
// artist ("Alternative", "Hip-Hop/Rap", "Singer/Songwriter"). This script
// maps INTO the existing vocabulary rather than growing it — see
// mapItunesGenre's comment for how, and why: 248 of the current 636 genres
// already have fewer than 5 artists tagged with them, so blindly adding
// every distinct iTunes tag as a new genre would make the genre picker
// worse, not better, for the one thing it's for (finding a meaningful group
// of artists to pitch). An iTunes tag that doesn't resolve into the
// existing vocabulary is left off that artist's genres and reported under
// `unmappedGenres` instead of silently becoming genre #637.
//
// Dry-run by default. Nothing is written to disk without --write.
//
// PROVENANCE LOG: every run that would write (see the CLI section for the
// exact rule) also produces data/genre-backfill-log.json — one entry per
// filled artist (name, rostrUrl, the raw iTunes primaryGenreName, the
// mapped ROSTR genre it became, matchType/matchCount, and the iTunes
// artistId/artistLinkUrl so a human can go check the match) and one entry
// per skipped artist (name, rostrUrl, reason, and for ambiguousName the
// competing genres and how many artists shared the name) — overLimit skips
// are counted in stats but deliberately NOT logged per-artist, see the
// comment in backfillGenres for why. It deliberately carries NO manager
// emails or names — it must stay safe to commit, unlike data/*.xlsx or
// rostr-raw-collection.json (both gitignored specifically because they
// carry contact data).
//
// MERGES ACROSS RUNS, NEVER OVERWRITES. The real run plan is repeated
// `--write --limit 500` chunks rather than one long pass that loses
// everything if Apple throttles us near the end, so a fresh chunk's log
// would clobber every earlier chunk's provenance if this just did a plain
// writeFileSync each time. Instead every write reads whatever's already at
// --log (if anything), keys both `filled` and `skipped` by `rostrUrl`, and
// lets the current run's entry win on conflict — see mergeProvenanceLog's
// comment for the full contract, including how an artist moving from
// skipped in one run to filled in a later one is handled. `runs` is an
// appendable per-run history (timestamp, that run's stats, that run's
// unmapped-genre tally) rather than a single generatedAt/stats pair, so the
// shape of each chunk stays visible. A log file that exists but fails to
// parse or doesn't match the expected shape is treated as corrupt: the run
// refuses to write anything (log or roster) rather than risk silently
// discarding accumulated provenance — see loadExistingProvenanceLog.
//
// RESUMING SKIPS THE ARTISTS WE ALREADY KNOW WILL SKIP. Filling drops an
// artist out of the genre-less walk, but a skip does NOT — `genres` stays
// `[]`, so a skipped artist sits exactly where it was and is the very next
// thing the following chunk sees. Left alone, that means every chunk starts
// by re-spending API calls on the same skip backlog before it ever reaches
// a new artist, and that backlog only grows: see PERMANENT_SKIP_REASONS
// and stats.alreadySkipped below for the fix (load the provenance log,
// don't re-attempt an artist whose most recent logged skip reason is one
// that re-running the exact same lookup can't change).
//
// Usage:
//   node scripts/backfill-genres.mjs [--roster data/roster.json] [--out data/roster.json] [--log data/genre-backfill-log.json] [--limit N] [--delay 500] [--write] [--retry-skipped | --retry-reasons r1,r2,...]
//   --retry-skipped disables the provenance-log skip exclusion described
//   above, so every genre-less artist is a candidate again regardless of
//   what an earlier chunk logged for it. Use it deliberately (e.g. after
//   fixing something in the matching/alias logic that might resolve a
//   previously-ambiguous or previously-unmappable case differently) — not
//   as the default chunking mode, since that's exactly the re-spend this
//   flag exists to let you opt back into.
//
//   --retry-reasons <comma-separated PERMANENT_SKIP_REASONS>, e.g.
//   `--retry-reasons unmappableGenre` or
//   `--retry-reasons unmappableGenre,noNameMatch`, is the targeted version
//   of --retry-skipped: it re-attempts only artists whose most recently
//   logged skip reason is in the given list, leaving every other
//   permanently-skipped artist excluded exactly as the default resume
//   behaviour would. This exists because of a real cost asymmetry: a change
//   to ITUNES_GENRE_ALIASES (like the seven added 2026-08-19) can only ever
//   change the outcome for artists logged as unmappableGenre — 26 of them
//   as of that log — never for the other 881 permanently-skipped artists
//   logged as ambiguousName/noNameMatch/noGenreOnRecord, whose lookups an
//   alias-table change cannot affect at all. `--retry-skipped` would
//   re-look-up all 907 (~45 minutes at the default --delay); `--retry-reasons
//   unmappableGenre` re-attempts exactly the 26 that could possibly resolve
//   differently (~80 seconds). An unrecognised reason name fails the run
//   loudly (see validateRetryReasons) rather than silently matching nothing
//   — a silent no-op here would look identical to "the alias fix didn't
//   work" and send someone debugging in the wrong direction. Passing both
//   --retry-skipped and --retry-reasons together is a CLI error (see main
//   below): --retry-skipped already retries every reason, so combining them
//   is ambiguous rather than one meaningfully overriding the other.
//
// No API key or signup needed — iTunes Search is a public, keyless endpoint.
// Apple throttles aggressively against it in practice (roughly 20 calls/min
// documented, more tolerated in bursts), so failed requests are retried with
// a bounded exponential backoff (see fetchWithRetry) rather than immediately
// giving up, and an artist whose lookup ultimately fails anyway is skipped
// under its own reason (`lookupFailed`) rather than aborting the whole run —
// a full run is ~3,010 lookups, and losing that to one flaky request near
// the end would be exactly the kind of silent-failure this script's whole
// design is trying to avoid elsewhere.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function isExactNameMatch(itunesName, rosterName) {
  return String(itunesName || '').trim().toLowerCase() === String(rosterName || '').trim().toLowerCase();
}

/**
 * iTunes genre tags are clean Title Case ("Alternative", "R&B/Soul") but
 * occasionally use a hyphen where ROSTR's vocabulary uses a space ("K-Pop"
 * vs "K Pop", "Afro-Pop" vs "Afro Pop") — normalised away here so those
 * resolve as a direct match without needing an alias-table entry for every
 * such spelling variant. Slashes and ampersands are left alone: they're
 * meaningful separators in both taxonomies ("R&B/Soul" and "Hip Hop & Rap"
 * are each single roster genres, not lists), so stripping them would create
 * false matches rather than resolve real ones.
 */
export function normalizeItunesGenreTag(tag) {
  return String(tag || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Explicit aliases for iTunes genre tags that need real semantic mapping,
 * not just the casing/hyphen normalisation above, to land on an existing
 * ROSTR genre. Deliberately short — see the module doc comment for why
 * growing the vocabulary unboundedly makes the genre picker worse.
 *
 * Keys must already be run through normalizeItunesGenreTag(); values must
 * be an EXACT existing entry in roster.genres (verified against the real
 * roster.json vocabulary, and asserted by
 * scripts/backfill-genres.test.mjs — a typo'd alias target just fails to
 * match and the tag reports as unmapped rather than writing a genre string
 * into roster.json that no other artist has).
 *
 * "Afro-Pop" is deliberately NOT in this table even though it looks like a
 * plausible candidate: the roster vocabulary already contains a literal
 * "Afro Pop" entry, so normalizeItunesGenreTag's hyphen-to-space step alone
 * resolves "Afro-Pop" -> "afro pop" -> "Afro Pop" with no alias needed. (The
 * roster separately also has "Afropop", a distinct, no-space entry that
 * this does NOT and should not match — normalisation only touches
 * hyphens/whitespace, never removes spaces, so the two stay distinct.)
 */
export const ITUNES_GENRE_ALIASES = new Map([
  // No "Hip-Hop/Rap" entry exists in the roster vocabulary; "Hip Hop & Rap"
  // is the existing genre that means the same thing.
  ['hip hop/rap', 'Hip Hop & Rap'],
  // No standalone "Dance" entry exists; "Dance / Edm" is the roster's
  // umbrella genre for it.
  ['dance', 'Dance / Edm'],
  // The roster has "Singer Songwriter" (no slash) and, separately, a
  // narrower "Pop Singer Songwriter" — iTunes' plain "Singer/Songwriter"
  // tag carries no pop-specific signal, so it maps to the broader of the
  // two rather than guessing a subgenre iTunes never actually claimed.
  ['singer/songwriter', 'Singer Songwriter'],
  // The following seven were user-decided mappings for tags found among the
  // 26 artists that had previously skipped as unmappableGenre (2026-08-19).
  // Each target was verified to exist verbatim in the real roster.json
  // genres array before being added here.
  //
  // "Alternative Folk" has no standalone entry; "Folk" is the closest
  // existing genre and the "alternative" qualifier isn't worth a new tag
  // for 4 artists.
  ['alternative folk', 'Folk'],
  // "Pop Latino" is iTunes' tag for Latin-market pop; the roster's own
  // "Latin Pop" is the same genre under ROSTR's naming convention.
  ['pop latino', 'Latin Pop'],
  // "Contemporary Jazz" -> the roster's plain "Jazz"; not worth a
  // sub-genre split for 1 artist.
  ['contemporary jazz', 'Jazz'],
  // "Contemporary Country" -> the roster's plain "Country"; same reasoning.
  ['contemporary country', 'Country'],
  // "Alternative Rap" -> "Alternative Hip Hop", the roster's existing genre
  // for the same idea under its own naming convention.
  ['alternative rap', 'Alternative Hip Hop'],
  // "Adult Contemporary" -> "Pop": the closest broad existing bucket; the
  // roster has no dedicated adult-contemporary genre.
  ['adult contemporary', 'Pop'],
  // "African" -> "Afrobeat" — NOT "Afrobeats". Both "Afrobeat" and
  // "Afrobeats" are separate, real entries in the roster vocabulary (the
  // former the older Fela Kuti-lineage genre, the latter the contemporary
  // West African pop sound); this alias intentionally targets "Afrobeat"
  // exactly, per the user's explicit call, not the more commonly-searched
  // "Afrobeats".
  ['african', 'Afrobeat'],
]);

/**
 * Deliberately absent from ITUNES_GENRE_ALIASES above, even though they're
 * the remaining tags among the same 26 previously-unmappableGenre artists
 * not covered by the seven aliases just added. A future reader auditing
 * "why isn't X mapped yet" should find the reasoning here instead of
 * re-deriving it or "helpfully" adding an alias that shouldn't exist:
 *
 *   - "Worldwide" (9 artists) and "Self-Development" (1 artist): strong
 *     evidence of a WRONG iTunes match rather than a genre gap — iTunes
 *     likely returned a podcast, audiobook, or unrelated catalog entry that
 *     happens to share the roster artist's name, not an honest genre tag
 *     for a musician. Aliasing these would launder a bad match into a
 *     confident-looking genre write.
 *   - "Instrumental" (2 artists) and "Easy Listening" (1 artist): real
 *     genre tags, but the roster vocabulary has no honest equivalent for
 *     either — every existing genre is either a specific style these don't
 *     belong to, or would require inventing a new roster genre, which this
 *     script deliberately does not do (see the module doc comment on
 *     vocabulary growth).
 */

/**
 * Maps one iTunes genre tag to an existing ROSTR genre string, or null if
 * it doesn't resolve. Two paths, in order: a direct case-insensitive (and
 * hyphen-normalised) match against the roster's own genre list — which is
 * how most tags resolve without needing an alias at all (e.g. "Alternative"
 * -> "Alternative", "K-Pop" -> "K Pop", "Afro-Pop" -> "Afro Pop", "R&B/Soul"
 * -> "R&B/Soul" all match this way) — then the explicit alias table above
 * for the handful that need real semantic mapping instead of a spelling fix.
 */
export function mapItunesGenre(tag, rosterGenreByLower) {
  const normalized = normalizeItunesGenreTag(tag);
  if (!normalized) return null;
  const direct = rosterGenreByLower.get(normalized);
  if (direct) return direct;
  const aliased = ITUNES_GENRE_ALIASES.get(normalized);
  if (aliased && rosterGenreByLower.get(aliased.toLowerCase()) === aliased) return aliased;
  return null;
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Skip reasons that are permanent: re-running the identical iTunes lookup
 * for the identical artist name can't produce a different exact-match set,
 * so an artist logged under one of these has nothing to gain from being
 * re-attempted by a later chunk. All four are conclusions about the DATA
 * (no exact name match at all; matches exist but none carry a genre;
 * matches exist and disagree on genre; the matched genre doesn't map into
 * the roster vocabulary) rather than about this one request's luck.
 *
 * `lookupFailed` is deliberately excluded — it means Apple throttled the
 * request or it errored transport-side, which says nothing about the
 * artist and can easily go the other way on retry. `overLimit` is also
 * excluded (redundantly — it's never written to the per-artist log at all,
 * see the comment in backfillGenres) so it's included here in neither name
 * nor spirit, and this set is asserted against by name in
 * scripts/backfill-genres.test.mjs.
 */
export const PERMANENT_SKIP_REASONS = new Set(['noNameMatch', 'noGenreOnRecord', 'ambiguousName', 'unmappableGenre']);

/**
 * Builds the set of rostrUrls a resumed run should not re-attempt: every
 * artist whose most recent provenance-log entry is a skip under one of
 * PERMANENT_SKIP_REASONS. `existingLog.skipped` already holds at most one
 * entry per rostrUrl — mergeProvenanceLog's whole contract is collapsing
 * every run's entries down to "the latest one wins" — so there's no
 * separate "most recent" lookup to do here beyond reading that array.
 *
 * An artist that's already in `existingLog.filled` needs no handling here:
 * it has a genre on record, so the ordinary `hasGenres` check in
 * backfillGenres already leaves it alone. If the roster and the log
 * disagree — the log says filled but the roster's copy of that artist
 * still has `genres: []` (a mismatched --roster/--log pairing, most
 * likely) — that artist simply isn't in this set, so it falls through to
 * being attempted again, same as any other genre-less artist. That's a
 * safe default in either direction: it costs one extra lookup, not a wrong
 * write, and it's why this function only ever looks at `skipped`.
 *
 * `retryReasons`, when given (a Set of PERMANENT_SKIP_REASONS values), is
 * the --retry-reasons escape hatch: an artist whose logged reason is IN
 * that set is left out of the exclusion (so it gets re-attempted this run),
 * while every other permanently-skipped artist stays excluded exactly as
 * before. This is what lets a targeted alias-table fix (e.g. Part 1's seven
 * new aliases, which can only change the outcome for artists logged as
 * unmappableGenre) re-attempt just the ~26 artists that fix could possibly
 * affect, instead of --retry-skipped's blanket re-attempt of everything
 * (907 artists as of the 2026-08-19 log — roughly 45 minutes at the default
 * --delay, versus ~80 seconds for the 26).
 */
function previouslySkippedUrls(existingLog, retryReasons) {
  const urls = new Set();
  for (const entry of existingLog?.skipped ?? []) {
    if (!PERMANENT_SKIP_REASONS.has(entry.reason)) continue;
    if (retryReasons && retryReasons.has(entry.reason)) continue;
    urls.add(entry.rostrUrl);
  }
  return urls;
}

/**
 * Validates and normalises the comma-separated value passed to
 * --retry-reasons (e.g. "unmappableGenre" or "unmappableGenre,noNameMatch")
 * into a Set of skip reasons. Only PERMANENT_SKIP_REASONS are ever valid
 * here — those are the only reasons previouslySkippedUrls excludes an
 * artist for in the first place, so anything else (a typo, or a real but
 * inapplicable reason like `lookupFailed`, which is never excluded to begin
 * with, or `overLimit`, which is never logged per-artist at all) would
 * silently match zero artists rather than doing what was asked. Throwing
 * here, with the valid options listed, is deliberate: a silent no-op would
 * produce a dry run that "ran" but attempted nothing, which looks identical
 * to "the alias/matching fix didn't help" and sends someone debugging in
 * exactly the wrong direction.
 */
export function validateRetryReasons(raw) {
  const valid = [...PERMANENT_SKIP_REASONS].sort();
  const reasons = String(raw ?? '').split(',').map(r => r.trim()).filter(Boolean);
  if (reasons.length === 0) {
    throw new Error(`--retry-reasons requires at least one reason. Valid reasons are: ${valid.join(', ')}`);
  }
  const invalid = reasons.filter(r => !PERMANENT_SKIP_REASONS.has(r));
  if (invalid.length > 0) {
    throw new Error(
      `--retry-reasons: unrecognised reason(s) ${invalid.map(r => `"${r}"`).join(', ')}. ` +
      `Valid reasons are: ${valid.join(', ')}.`
    );
  }
  return new Set(reasons);
}

export function uniqueEmailCount(artists) {
  return new Set(artists.flatMap(a => (a.managerEmails || []).map(e => String(e).trim().toLowerCase()))).size;
}

/**
 * The reusable, network-free core: takes a roster ({ artists, genres, ... })
 * and a `searchArtist(name)` function (iTunes's real /search response
 * shape: `{ results: [{ artistName, artistId, primaryGenreName,
 * artistLinkUrl }] }`), and returns a new artists array with `genres` filled
 * in where a safe match was found, plus stats and a provenance log.
 *
 * Injectable `searchArtist` is what lets scripts/backfill-genres.test.mjs
 * exercise the whole matching/mapping/skip-reason logic against a small
 * fixture without any real network access — see searchArtistLive below for
 * the production implementation this stands in for.
 */
export async function backfillGenres(roster, { searchArtist, delayMs = 0, limit, existingLog = null, retrySkipped = false, retryReasons = null } = {}) {
  const rosterGenreByLower = new Map((roster.genres || []).map(g => [g.toLowerCase(), g]));
  // retrySkipped (--retry-skipped) is the broader "retry everything" mode
  // and takes precedence structurally — but main() below actually rejects
  // passing both flags together rather than relying on this precedence, so
  // a caller never has to think about which one "wins": see the CLI section
  // for why an explicit error beats silent precedence here.
  const skipExclusions = retrySkipped ? new Set() : previouslySkippedUrls(existingLog, retryReasons);

  const stats = {
    totalArtists: roster.artists.length,
    eligible: 0, // started with genres: []
    attempted: 0, // eligible, not already permanently skipped, AND under the --limit cap
    filled: 0,
    // Eligible artists deferred because a PRIOR run already logged them
    // under a PERMANENT_SKIP_REASONS reason (see previouslySkippedUrls).
    // Deliberately NOT part of `stats.skipped`: those counters describe
    // outcomes of a lookup THIS run actually made, and an alreadySkipped
    // artist has no lookup this run to have an outcome — counting it as
    // e.g. overLimit would misreport "waiting for a later chunk" (true of
    // overLimit) as this artist's actual status (permanently resolved,
    // not waiting on anything). --retry-skipped forces this to 0.
    alreadySkipped: 0,
    skipped: {
      overLimit: 0,
      noNameMatch: 0, // no exact (case-insensitive) name match among the results at all
      noGenreOnRecord: 0, // exact match(es) exist, but none carry a primaryGenreName
      ambiguousName: 0, // more than one exact, genre-bearing match, and they disagree on genre
      unmappableGenre: 0, // matched safely, but the iTunes genre doesn't resolve into the roster vocabulary
      lookupFailed: 0, // the iTunes request itself failed even after retries
    },
    /** iTunes genre (as returned, not normalised) -> how many times it showed up unmapped. */
    unmappedGenres: new Map(),
  };

  const log = { filled: [], skipped: [] };

  const artists = [];
  for (const original of roster.artists) {
    const hasGenres = Array.isArray(original.genres) && original.genres.length > 0;
    if (!hasGenres) stats.eligible += 1;

    const alreadyPermanentlySkipped = !hasGenres && skipExclusions.has(original.rostrUrl);
    if (alreadyPermanentlySkipped) {
      // Deliberately does NOT consume the --limit budget and does NOT call
      // searchArtist: the whole point is that a `--limit 500` chunk reaches
      // 500 artists this run has never seen a verdict on, not 500 minus
      // however many of this chunk's slots go to re-confirming the same
      // permanent skip a previous chunk already logged. Nothing is
      // re-logged either — the existing log entry from the earlier run
      // already says everything there is to say about this artist, and
      // mergeProvenanceLog leaves an entry alone unless THIS run's log
      // contains a replacement for its rostrUrl.
      stats.alreadySkipped += 1;
      artists.push(original);
      continue;
    }

    if (!hasGenres && (limit == null || stats.attempted < limit)) {
      stats.attempted += 1;
      const artist = { ...original };
      const filledGenre = await tryFillOne(artist, searchArtist, rosterGenreByLower, stats, log);
      await delay(delayMs);
      if (filledGenre) { artist.genres = [filledGenre]; stats.filled += 1; }
      artists.push(artist);
    } else {
      // overLimit is counted (stats.skipped.overLimit) but deliberately NOT
      // logged per-artist: in the chunked-run plan (repeated `--write
      // --limit 500` passes walking the roster), the vast majority of
      // eligible artists are overLimit on any given chunk, and logging one
      // entry each would make overLimit noise dominate the file — a 50-
      // artist dry run against the full roster produced a 296KB log that
      // was almost entirely overLimit entries. The count alone is enough;
      // which specific artists are still waiting just falls out of "not yet
      // in filled or skipped" once the roster finishes its walk.
      if (!hasGenres) stats.skipped.overLimit += 1;
      // Every other field passes through completely untouched — this is the
      // "never replace" half of the merge discipline: an artist this run
      // doesn't even attempt still comes out byte-identical.
      artists.push(original);
    }
  }

  return { artists, stats, log };
}

async function tryFillOne(artist, searchArtist, rosterGenreByLower, stats, log) {
  const skip = reason => { stats.skipped[reason] += 1; log.skipped.push({ name: artist.name, rostrUrl: artist.rostrUrl, reason }); return null; };

  let response;
  try {
    response = await searchArtist(artist.name);
  } catch (err) {
    stats.skipped.lookupFailed += 1;
    log.skipped.push({ name: artist.name, rostrUrl: artist.rostrUrl, reason: 'lookupFailed', error: String(err?.message ?? err) });
    return null;
  }

  const results = response?.results ?? [];
  const exactMatches = results.filter(item => isExactNameMatch(item.artistName, artist.name));
  if (exactMatches.length === 0) return skip('noNameMatch');

  const genredMatches = exactMatches.filter(item => item.primaryGenreName);
  if (genredMatches.length === 0) return skip('noGenreOnRecord');

  let candidate;
  let matchType;
  if (genredMatches.length === 1) {
    candidate = genredMatches[0];
    matchType = 'unique';
  } else {
    const distinctGenres = [...new Set(genredMatches.map(m => m.primaryGenreName))];
    if (distinctGenres.length > 1) {
      stats.skipped.ambiguousName += 1;
      log.skipped.push({
        name: artist.name,
        rostrUrl: artist.rostrUrl,
        reason: 'ambiguousName',
        competingGenres: distinctGenres,
        matchCount: exactMatches.length,
      });
      return null;
    }
    candidate = genredMatches[0];
    matchType = 'unanimous';
  }

  const mapped = mapItunesGenre(candidate.primaryGenreName, rosterGenreByLower);
  if (!mapped) {
    stats.unmappedGenres.set(candidate.primaryGenreName, (stats.unmappedGenres.get(candidate.primaryGenreName) ?? 0) + 1);
    return skip('unmappableGenre');
  }

  log.filled.push({
    name: artist.name,
    rostrUrl: artist.rostrUrl,
    primaryGenreName: candidate.primaryGenreName,
    mappedGenre: mapped,
    matchType,
    matchCount: genredMatches.length,
    artistId: candidate.artistId,
    artistLinkUrl: candidate.artistLinkUrl,
  });

  return mapped;
}

// --- Production iTunes client (not exercised by the unit tests — those
// inject a fake searchArtist instead). ---

const ITUNES_MAX_RETRIES = 4;
const ITUNES_BASE_BACKOFF_MS = 1000;
const ITUNES_MAX_BACKOFF_MS = 30_000;

function backoffDelayMs(attempt) {
  const exponential = ITUNES_BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.random() * ITUNES_BASE_BACKOFF_MS;
  return Math.min(exponential + jitter, ITUNES_MAX_BACKOFF_MS);
}

/**
 * Fetches `url`, retrying with a bounded exponential backoff on 403/429
 * (Apple's rate-limit responses) and on transport-level failures (fetch
 * throwing — DNS hiccup, connection reset, etc.), since both are typically
 * transient over a ~3,010-request run. Any other non-OK HTTP status is
 * treated as non-retryable and thrown immediately. If every retry is
 * exhausted, throws — the caller (searchArtistLive, and above it
 * tryFillOne) is responsible for turning that into a `lookupFailed` skip
 * for just that one artist rather than aborting the whole run.
 */
async function fetchWithRetry(url) {
  let lastErr;
  for (let attempt = 0; attempt <= ITUNES_MAX_RETRIES; attempt += 1) {
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      lastErr = err;
      if (attempt < ITUNES_MAX_RETRIES) { await delay(backoffDelayMs(attempt)); continue; }
      throw lastErr;
    }
    if (res.ok) return res;
    if ((res.status === 429 || res.status === 403) && attempt < ITUNES_MAX_RETRIES) {
      await delay(backoffDelayMs(attempt));
      continue;
    }
    throw new Error(`iTunes search failed: ${res.status} ${res.statusText}`);
  }
  throw lastErr ?? new Error('iTunes search failed: retries exhausted');
}

async function searchArtistLive(name) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=25`;
  const res = await fetchWithRetry(url);
  return res.json();
}

// --- Provenance log merge ---
//
// The real run plan is repeated `node scripts/backfill-genres.mjs --write
// --limit 500` passes walking the roster in ~5-minute chunks rather than one
// ~25-minute pass that loses everything if Apple throttles us near the end.
// A FILLED artist stops being eligible (non-empty `genres`), so those
// naturally drop out of every later chunk's walk on their own. A SKIPPED
// artist does NOT — `genres` stays `[]`, so it sits right where it was and
// would otherwise be re-attempted, at full API cost, by every subsequent
// chunk. That's what PERMANENT_SKIP_REASONS and stats.alreadySkipped (in
// backfillGenres above) exist to fix: this log is also what makes chunking
// work at all, by giving each new chunk a record of which genre-less
// artists it can skip re-asking about. That means the log has to accumulate
// across runs instead of being overwritten each time, or the user would end
// up with only the last chunk's ~500 entries instead of the full picture —
// which defeats the log's whole purpose as a durable record for both
// resuming chunks and the later broad-genre-narrowing work.

/**
 * Reads and validates an existing provenance log at `logPath`, or returns
 * null if no file is there yet (the normal first-run case). Throws — never
 * silently discards — if the file exists but is unparseable or doesn't match
 * the expected shape, so a corrupt log fails the run the same way the
 * artist/email-count guard does, rather than quietly losing accumulated
 * provenance to JSON.parse swallowing the problem.
 */
export function loadExistingProvenanceLog(logPath) {
  if (!existsSync(logPath)) return null;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(logPath, 'utf-8'));
  } catch (err) {
    throw new Error(`existing provenance log at ${logPath} is not valid JSON (${err.message})`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.filled) || !Array.isArray(parsed.skipped) || !Array.isArray(parsed.runs)) {
    throw new Error(`existing provenance log at ${logPath} doesn't match the expected shape (needs filled/skipped/runs arrays)`);
  }
  return parsed;
}

/**
 * Merges one run's filled/skipped entries into an existing provenance log
 * (or starts a fresh one if `existingLog` is null), keyed by `rostrUrl`.
 *
 * - The current run wins on conflict: if an artist appears in this run's
 *   filled or skipped list, whatever entry it had from a previous run is
 *   replaced, never duplicated.
 * - An artist can legitimately move between collections across runs (e.g.
 *   skipped as `ambiguousName` in an earlier chunk, then filled once a
 *   later run — or a rerun after an alias-table fix — resolves it cleanly).
 *   A stale entry for that artist must not survive in the other collection;
 *   keying everything through one `rostrUrl -> {type, entry}` map guarantees
 *   that structurally rather than by remembering to clean up both arrays.
 * - `runs` is an appendable per-run history (timestamp, that run's stats,
 *   that run's unmapped-genre tally) rather than a single generatedAt/stats
 *   pair, so the user can see the shape of each chunk later.
 */
export function mergeProvenanceLog(existingLog, runMeta, runLog) {
  const byUrl = new Map();
  for (const entry of existingLog?.filled ?? []) byUrl.set(entry.rostrUrl, { type: 'filled', entry });
  for (const entry of existingLog?.skipped ?? []) byUrl.set(entry.rostrUrl, { type: 'skipped', entry });
  for (const entry of runLog.filled) byUrl.set(entry.rostrUrl, { type: 'filled', entry });
  for (const entry of runLog.skipped) byUrl.set(entry.rostrUrl, { type: 'skipped', entry });

  const filled = [];
  const skipped = [];
  for (const { type, entry } of byUrl.values()) {
    (type === 'filled' ? filled : skipped).push(entry);
  }

  return {
    source: 'itunes',
    runs: [...(existingLog?.runs ?? []), runMeta],
    filled,
    skipped,
  };
}

// --- CLI ---

function resolve(value, fallback) {
  if (!value) return fallback;
  return isAbsolute(value) ? value : join(process.cwd(), value);
}

function formatSkipped(skipped) {
  return Object.entries(skipped).map(([reason, count]) => `${reason}: ${count}`).join(', ');
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const retrySkipped = argv.includes('--retry-skipped');
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : fallback; };
  const retryReasonsArg = flag('--retry-reasons', null);

  // --retry-skipped and --retry-reasons together is a CLI error rather than
  // one silently winning over the other: --retry-skipped already means
  // "retry every permanent skip reason", so --retry-reasons alongside it
  // can't narrow anything — it would either be redundant or misleadingly
  // suggest a narrower retry is happening when it isn't. Rejecting the
  // combination outright means a reader of a run's command line never has
  // to guess which flag took precedence.
  if (retrySkipped && retryReasonsArg != null) {
    console.error('--retry-skipped and --retry-reasons are mutually exclusive: --retry-skipped already retries every permanent skip reason, so combining it with --retry-reasons is ambiguous. Pass only one.');
    process.exit(1);
  }

  let retryReasons = null;
  if (retryReasonsArg != null) {
    try {
      retryReasons = validateRetryReasons(retryReasonsArg);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const defaultRoster = join(__dirname, '..', 'data', 'roster.json');
  const defaultLog = join(__dirname, '..', 'data', 'genre-backfill-log.json');
  const rosterPath = resolve(flag('--roster', null), defaultRoster);
  const outPath = resolve(flag('--out', null), rosterPath);
  const logPath = resolve(flag('--log', null), defaultLog);
  const explicitLog = argv.includes('--log');
  const limitArg = flag('--limit', null);
  const limit = limitArg != null ? Number(limitArg) : undefined;
  const delayMs = Number(flag('--delay', '500'));

  if (!existsSync(rosterPath)) { console.error(`Roster not found: ${rosterPath}`); process.exit(1); }

  let roster;
  try {
    roster = JSON.parse(readFileSync(rosterPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${rosterPath} as JSON: ${err.message}`);
    process.exit(1);
  }

  // Loaded unconditionally, and BEFORE the run rather than only at write
  // time: resuming (skipping artists a previous chunk already logged under
  // a permanent reason, see PERMANENT_SKIP_REASONS) depends on this log and
  // has to be correct on a dry run too, not just on a --write run — a dry
  // run is exactly how you'd sanity-check the resume behaviour before
  // trusting it to a --write chunk. A corrupt log is refused here, before
  // any lookups happen, for the same reason the existing guard refuses to
  // WRITE over one: this script must never silently discard or silently
  // misinterpret accumulated provenance. (This is unrelated to whether the
  // log ends up written to disk this run — that's still gated below by
  // `write || explicitLog`.)
  let existingLog;
  try {
    existingLog = loadExistingProvenanceLog(logPath);
  } catch (err) {
    console.error(`Refusing to run: ${err.message}. Fix or remove the file before re-running.`);
    process.exit(1);
  }

  const before = { artists: roster.artists.length, emails: uniqueEmailCount(roster.artists) };
  console.log(`Loaded ${before.artists} artists (${before.emails} unique manager emails) from ${rosterPath}`);
  if (!write) console.log('DRY RUN — pass --write to save changes. Nothing will be written to disk.');
  if (retrySkipped) console.log('--retry-skipped passed — ignoring the provenance log; every genre-less artist is a candidate again.');
  if (retryReasons) console.log(`--retry-reasons ${[...retryReasons].join(',')} passed — only artists most recently skipped under [${[...retryReasons].join(', ')}] are candidates again; every other previously-skipped artist stays excluded.`);

  const { artists, stats, log } = await backfillGenres(roster, { searchArtist: searchArtistLive, delayMs, limit, existingLog, retrySkipped, retryReasons });

  const after = { artists: artists.length, emails: uniqueEmailCount(artists) };
  const artistsLost = before.artists - after.artists;
  const emailsLost = before.emails - after.emails;

  console.log(`Artists before: ${before.artists}, after: ${after.artists}`);
  console.log(`Eligible (genres: [] at the start): ${stats.eligible}, attempted: ${stats.attempted}${limit != null ? ` (--limit ${limit})` : ''}`);
  console.log(`Already skipped in an earlier run, not re-attempted (see PERMANENT_SKIP_REASONS): ${stats.alreadySkipped}${retrySkipped ? ' [should be 0 — --retry-skipped was passed]' : ''}`);
  console.log(`Genres filled: ${stats.filled}`);
  console.log(`Skipped — ${formatSkipped(stats.skipped)}`);
  if (stats.unmappedGenres.size > 0) {
    console.log(`Unmapped iTunes genres (${stats.unmappedGenres.size} distinct — not added to the roster's vocabulary):`);
    [...stats.unmappedGenres.entries()].sort((a, b) => b[1] - a[1]).forEach(([genre, count]) => console.log(`  "${genre}": ${count}`));
  } else {
    console.log('Unmapped iTunes genres: none');
  }
  console.log(`artists lost: ${artistsLost} / emails lost: ${emailsLost}`);

  if (artistsLost !== 0 || emailsLost !== 0) {
    // Structurally this should be unreachable — backfillGenres only ever sets
    // `genres` on a copy of an existing artist record — but asserted anyway,
    // the same defense-in-depth merge-roster.mjs's README section asks for:
    // "if either number isn't zero, don't commit." Here that becomes "don't
    // even write the file."
    console.error('Refusing to write: artist or email count changed, which this script must never do.');
    process.exit(1);
  }

  // Log-write rule: on a real --write run, always write the provenance log
  // (default path alongside roster.json unless --log overrides it). On a
  // dry run, only write it if --log was passed explicitly — otherwise the
  // "dry run writes nothing" guarantee this whole script is built around
  // would have a silent exception.
  const shouldWriteLog = write || explicitLog;
  if (shouldWriteLog) {
    // existingLog was already loaded above (before the run, so the resume
    // exclusion could use it) — reused here rather than re-read, which also
    // avoids merging against a file that could in principle have changed on
    // disk between the two reads.
    const runMeta = {
      generatedAt: new Date().toISOString(),
      source: 'itunes',
      stats: {
        totalArtists: stats.totalArtists,
        eligible: stats.eligible,
        attempted: stats.attempted,
        alreadySkipped: stats.alreadySkipped,
        filled: stats.filled,
        skipped: stats.skipped,
      },
      unmappedGenres: Object.fromEntries(stats.unmappedGenres),
    };
    const mergedLog = mergeProvenanceLog(existingLog, runMeta, log);
    // Compact on purpose — no pretty-printing indent. At ~2,100 accumulated
    // entries a 4-space-indented file would be needlessly large in the repo
    // for a machine-readable log nobody hand-edits.
    writeFileSync(logPath, JSON.stringify(mergedLog));
    console.log(`Wrote provenance log: ${logPath} (${mergedLog.filled.length} filled, ${mergedLog.skipped.length} skipped across ${mergedLog.runs.length} run(s))`);
  }

  if (!write) {
    console.log(`Dry run complete — no roster file written. Re-run with --write to save these changes to ${outPath}.`);
    return;
  }

  const genreSet = new Set(roster.genres || []);
  artists.forEach(a => (a.genres || []).forEach(g => genreSet.add(g)));
  const output = { ...roster, artists, genres: Array.from(genreSet).sort() };
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) main();
