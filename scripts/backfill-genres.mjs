// Fills in `genres: []` on roster artists using the Spotify Web API, so the
// 41.6% of the roster (3,010 artists as of the 2026-08-08 snapshot) that
// ROSTR has no genre tag for can still be found through the Demos genre
// filter — see lib/roster.ts's getArtistsByGenres for the companion change
// (an empty genre selection now means "every artist," which is what makes
// those 3,010 reachable at all today; this script is what makes them
// reachable by genre specifically, the way every other artist already is).
//
// MERGE ONLY, NEVER REPLACE — same rule as scripts/merge-roster.mjs, applied
// at the field level instead of the artist level here:
//   - an artist with a non-empty `genres` array is never touched, full stop.
//     Spotify's tags are a different, potentially conflicting taxonomy from
//     whatever ROSTR/the artist's own listing already says, and this script
//     has no basis to prefer one over the other — it only fills gaps.
//   - managerEmails, managerNames, spotifyFollowers, managementCompany, and
//     every other field are read-only here. This script writes exactly one
//     field: `genres`, and only on artists that started with genres: [].
// See scripts/ROSTER_CONTEXT_CORRECTIONS.md for why that discipline matters:
// a prior pipeline change that blurred "enrich" and "replace" together
// silently dropped 1,745 contacts while reporting success.
//
// Matching a roster artist to a Spotify artist is genuinely risky — Spotify
// name search is fuzzy, and a wrong match writes wrong genres onto a real
// artist's record. Two independent checks must BOTH pass before a match is
// accepted:
//   1. exact, case-insensitive name match (not "top search hit" — a fuzzy
//      top hit is exactly the failure mode this guards against)
//   2. the matched artist's Spotify follower count falls within
//      FOLLOWER_TOLERANCE_RATIO (or FOLLOWER_TOLERANCE_FLOOR, whichever is
//      larger) of the roster's own spotifyFollowers for that artist — see
//      withinFollowerTolerance's comment for why a band rather than an exact
//      match. An artist with no roster follower count to check against is
//      skipped rather than trusted on name alone.
// Anything that doesn't clear both bars is skipped and counted by reason —
// see `stats.skipped` — rather than guessed at.
//
// Vocabulary: the roster uses 636 ROSTR-style genre strings ("Dance / Edm",
// "Hip Hop & Rap", "Metalcore"); Spotify returns lowercase, often hyphenated
// or prefixed tags ("edm", "lo-fi house", "pov: indie", "melodic
// metalcore"). This script maps INTO the existing vocabulary rather than
// growing it — see mapSpotifyGenre's comment for how, and why: 248 of the
// current 636 genres already have fewer than 5 artists tagged with them, so
// blindly adding every distinct Spotify tag as a new genre would make the
// genre picker worse, not better, for the one thing it's for (finding a
// meaningful group of artists to pitch). A Spotify tag that doesn't resolve
// into the existing vocabulary is left off that artist's genres and reported
// under `unmappedTags` instead of silently becoming genre #637.
//
// Dry-run by default. Nothing is written to disk without --write.
//
// Usage:
//   node scripts/backfill-genres.mjs [--roster data/roster.json] [--out data/roster.json] [--limit N] [--delay 350] [--write]
//
// Requires SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in the environment for
// a real (non-dry-run, or even dry-run — it still queries Spotify to compute
// what *would* change) run. See lib/spotify.ts, which already implements this
// exact client-credentials flow for the app's live Spotify badge lookup.
// Deliberately NOT imported from here: that file is TypeScript compiled by
// Next.js's build pipeline, and this is a plain Node ESM script with no
// ts-node/tsx in this project's devDependencies to run it standalone. The
// token fetch below is a structural mirror of lib/spotify.ts's
// getAccessToken (same endpoint, same Basic-auth client-credentials body,
// same expiry-aware in-memory cache) — if Spotify's token endpoint or this
// app's client-credentials handling ever changes, check both places.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A Spotify tag's follower count is allowed to differ from the roster's own
 * spotifyFollowers by this fraction (or FOLLOWER_TOLERANCE_FLOOR, whichever
 * is larger) and still count as the same artist. Not an exact match on
 * purpose: roster.json is a snapshot from whenever it was last refreshed
 * (see lib/roster.ts's getRosterGeneratedAt), and Spotify follower counts
 * drift continuously — a real artist can move 20-30% in either direction
 * over a few months of ordinary organic growth without that meaning the
 * match is wrong.
 */
export const FOLLOWER_TOLERANCE_RATIO = 0.35;
/**
 * Floor for the tolerance band above, so a small artist isn't held to an
 * unreasonably tight absolute margin — 35% of 5,000 followers is only 1,750,
 * tight enough that ordinary week-to-week movement could fail a genuinely
 * correct match. 25,000 is comfortably above typical short-term movement for
 * a small/mid artist while still being a small fraction of the roster's
 * median (593,950 as of the 2026-08-08 snapshot) — see the project brief's
 * measured facts.
 */
export const FOLLOWER_TOLERANCE_FLOOR = 25_000;

export function withinFollowerTolerance(spotifyFollowers, rosterFollowers) {
  const allowed = Math.max(FOLLOWER_TOLERANCE_FLOOR, rosterFollowers * FOLLOWER_TOLERANCE_RATIO);
  return Math.abs((spotifyFollowers ?? 0) - rosterFollowers) <= allowed;
}

export function isExactNameMatch(spotifyName, rosterName) {
  return String(spotifyName || '').trim().toLowerCase() === String(rosterName || '').trim().toLowerCase();
}

/**
 * Spotify tags Spotify's algorithmic "niche" genres with a "pov: " prefix
 * (e.g. "pov: indie", "pov: bedroom pop") that carries no genre information
 * of its own — stripped before matching rather than requiring an alias-table
 * entry for every "pov: X" variant of a tag that would otherwise match fine.
 * Hyphens are normalised to spaces for the same reason: ROSTR's vocabulary
 * never contains one ("K Pop", "Lo Fi House"), Spotify's often does
 * ("k-pop", "lo-fi house"), and the difference is purely typographic.
 */
export function normalizeSpotifyGenreTag(tag) {
  return String(tag || '')
    .trim()
    .toLowerCase()
    .replace(/^pov:\s*/, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Explicit aliases for Spotify tags that need real semantic mapping, not
 * just a casing/hyphen normalisation, to land on an existing ROSTR genre.
 * Deliberately short: every entry here coarsens a Spotify micro-genre down
 * to a broader ROSTR genre that already exists, rather than trying to guess
 * a mapping for every possible Spotify tag. Anything not covered by this
 * table AND not a direct (post-normalisation) match to the existing
 * vocabulary is reported as unmapped rather than added — see the module doc
 * comment above for why growing the vocabulary unboundedly makes the genre
 * picker worse.
 *
 * Keys must already be run through normalizeSpotifyGenreTag(); values must
 * be an EXACT existing entry in roster.genres (verified by
 * scripts/backfill-genres.test.mjs against a fixture, and implicitly by
 * mapSpotifyGenre only ever returning something it found in the roster's own
 * genre list at runtime — a typo'd alias target just fails to match and the
 * tag reports as unmapped rather than writing a genre string into
 * roster.json that no other artist has).
 */
export const SPOTIFY_GENRE_ALIASES = new Map([
  // A stylistic qualifier on a parent genre that already exists in the
  // roster's vocabulary — the example straight from the project brief.
  ['melodic metalcore', 'Metalcore'],
  // No "Pop Rap" bucket exists; "Rap" already does, and is the closer of the
  // roster's two rap-adjacent genres ("Rap" vs "Hip Hop & Rap") to what this
  // tag actually describes.
  ['pop rap', 'Rap'],
  ['conscious hip hop', 'Hip Hop'],
  // Matches the roster's existing "Rap Metal" compound tag rather than
  // introducing a new, narrower "Rap Metalcore" one for what would likely be
  // a single artist.
  ['rap metalcore', 'Rap Metal'],
]);

/**
 * Maps one Spotify genre tag to an existing ROSTR genre string, or null if
 * it doesn't resolve. Two paths, in order: the explicit alias table above,
 * then a direct case-insensitive (and hyphen/pov-prefix-normalised) match
 * against the roster's own genre list — which is how most tags resolve
 * without needing an alias-table entry at all (e.g. "hip hop" -> "Hip Hop",
 * "k-pop" -> "K Pop", "pov: indie" -> "Indie" all match this way).
 */
export function mapSpotifyGenre(tag, rosterGenreByLower) {
  const normalized = normalizeSpotifyGenreTag(tag);
  if (!normalized) return null;
  const aliased = SPOTIFY_GENRE_ALIASES.get(normalized);
  if (aliased && rosterGenreByLower.get(aliased.toLowerCase()) === aliased) return aliased;
  return rosterGenreByLower.get(normalized) ?? null;
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

export function uniqueEmailCount(artists) {
  return new Set(artists.flatMap(a => (a.managerEmails || []).map(e => String(e).trim().toLowerCase()))).size;
}

/**
 * The reusable, network-free core: takes a roster ({ artists, genres, ... })
 * and a `searchArtist(name)` function (Spotify's real /v1/search/artist
 * response shape: `{ artists: { items: [{ name, genres, followers: { total
 * } }] } }`), and returns a new artists array with `genres` filled in where a
 * strong match was found, plus stats.
 *
 * Injectable `searchArtist` is what lets scripts/backfill-genres.test.mjs
 * exercise the whole matching/mapping/skip-reason logic against a small
 * fixture without any real Spotify credentials or network access — see
 * searchArtistLive below for the production implementation this stands in
 * for.
 */
export async function backfillGenres(roster, { searchArtist, delayMs = 0, limit } = {}) {
  const rosterGenreByLower = new Map((roster.genres || []).map(g => [g.toLowerCase(), g]));

  const stats = {
    totalArtists: roster.artists.length,
    eligible: 0, // started with genres: []
    attempted: 0, // eligible AND under the --limit cap
    filled: 0,
    skipped: {
      overLimit: 0,
      noSpotifyMatch: 0, // Spotify returned no results at all
      nameMismatch: 0, // got results, but none is an exact (case-insensitive) name match
      noRosterFollowerCount: 0, // exact name match(es), but nothing to sanity-check the follower count against
      followerMismatch: 0, // exact name match(es), but none within tolerance
      ambiguousMatch: 0, // more than one exact name match within follower tolerance — can't safely pick one
      noMappableGenres: 0, // matched and verified, but every Spotify tag it returned was unmapped
    },
    /** Spotify tag (as returned, not normalised) -> how many times it showed up unmapped. */
    unmappedTags: new Map(),
  };

  const artists = [];
  for (const original of roster.artists) {
    const hasGenres = Array.isArray(original.genres) && original.genres.length > 0;
    if (!hasGenres) stats.eligible += 1;

    if (!hasGenres && (limit == null || stats.attempted < limit)) {
      stats.attempted += 1;
      const artist = { ...original };
      const filledGenres = await tryFillOne(artist, searchArtist, rosterGenreByLower, stats);
      await delay(delayMs);
      if (filledGenres) { artist.genres = filledGenres; stats.filled += 1; }
      artists.push(artist);
    } else {
      if (!hasGenres) stats.skipped.overLimit += 1;
      // Every other field passes through completely untouched — this is the
      // "never replace" half of the merge discipline: an artist this run
      // doesn't even attempt still comes out byte-identical.
      artists.push(original);
    }
  }

  return { artists, stats };
}

async function tryFillOne(artist, searchArtist, rosterGenreByLower, stats) {
  const response = await searchArtist(artist.name);
  const items = response?.artists?.items ?? [];

  if (items.length === 0) { stats.skipped.noSpotifyMatch += 1; return null; }

  const exactMatches = items.filter(item => isExactNameMatch(item.name, artist.name));
  if (exactMatches.length === 0) { stats.skipped.nameMismatch += 1; return null; }

  const rosterFollowers = artist.spotifyFollowers ?? 0;
  if (rosterFollowers <= 0) { stats.skipped.noRosterFollowerCount += 1; return null; }

  const verified = exactMatches.filter(item => withinFollowerTolerance(item.followers?.total ?? 0, rosterFollowers));
  if (verified.length === 0) { stats.skipped.followerMismatch += 1; return null; }
  if (verified.length > 1) { stats.skipped.ambiguousMatch += 1; return null; }

  const match = verified[0];
  const mapped = [];
  for (const tag of match.genres ?? []) {
    const genre = mapSpotifyGenre(tag, rosterGenreByLower);
    if (genre) { if (!mapped.includes(genre)) mapped.push(genre); }
    else { stats.unmappedTags.set(tag, (stats.unmappedTags.get(tag) ?? 0) + 1); }
  }

  if (mapped.length === 0) { stats.skipped.noMappableGenres += 1; return null; }
  return mapped.sort();
}

// --- Production Spotify client (not exercised by the unit tests — those
// inject a fake searchArtist instead). Mirrors lib/spotify.ts's
// getAccessToken; see the module doc comment for why this can't just import
// it. ---

let cachedToken = null;

async function getAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in the environment to run this script.');
  }
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status} ${res.statusText}`);

  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

async function searchArtistLive(name) {
  const token = await getAccessToken();
  // limit=10 (rather than lib/spotify.ts's limit=1 for the live badge lookup)
  // because this needs to find an EXACT name match if one exists at all, not
  // just accept whatever search ranks first — see the module doc comment on
  // why "top hit" isn't a strong enough match to write real data from.
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return { artists: { items: [] } };
  return res.json();
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
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : fallback; };

  const defaultRoster = join(__dirname, '..', 'data', 'roster.json');
  const rosterPath = resolve(flag('--roster', null), defaultRoster);
  const outPath = resolve(flag('--out', null), rosterPath);
  const limitArg = flag('--limit', null);
  const limit = limitArg != null ? Number(limitArg) : undefined;
  const delayMs = Number(flag('--delay', '350'));

  if (!existsSync(rosterPath)) { console.error(`Roster not found: ${rosterPath}`); process.exit(1); }

  let roster;
  try {
    roster = JSON.parse(readFileSync(rosterPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${rosterPath} as JSON: ${err.message}`);
    process.exit(1);
  }

  const before = { artists: roster.artists.length, emails: uniqueEmailCount(roster.artists) };
  console.log(`Loaded ${before.artists} artists (${before.emails} unique manager emails) from ${rosterPath}`);
  if (!write) console.log('DRY RUN — pass --write to save changes. Nothing will be written to disk.');

  const { artists, stats } = await backfillGenres(roster, { searchArtist: searchArtistLive, delayMs, limit });

  const after = { artists: artists.length, emails: uniqueEmailCount(artists) };
  const artistsLost = before.artists - after.artists;
  const emailsLost = before.emails - after.emails;

  console.log(`Artists before: ${before.artists}, after: ${after.artists}`);
  console.log(`Eligible (genres: [] at the start): ${stats.eligible}, attempted: ${stats.attempted}${limit != null ? ` (--limit ${limit})` : ''}`);
  console.log(`Genres filled: ${stats.filled}`);
  console.log(`Skipped — ${formatSkipped(stats.skipped)}`);
  if (stats.unmappedTags.size > 0) {
    console.log(`Unmapped Spotify tags (${stats.unmappedTags.size} distinct — not added to the roster's vocabulary):`);
    [...stats.unmappedTags.entries()].sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => console.log(`  "${tag}": ${count}`));
  } else {
    console.log('Unmapped Spotify tags: none');
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

  if (!write) {
    console.log(`Dry run complete — no file written. Re-run with --write to save these changes to ${outPath}.`);
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
