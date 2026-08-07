// Builds data/roster.json from a raw collection JSON file produced by the
// browser collector against the ROSTR API (see the collector's own output for
// the exact input shape). This replaces scripts/parse-roster.mjs's xlsx
// source with a live-pulled one, but keeps the same output schema, the same
// "drop unreachable artists" rule, and the same genre-scoping rule so
// lib/roster.ts doesn't need to change at all.
//
// Usage: node scripts/build-roster.mjs <path-to-raw-collection.json> [--out data/roster.json]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Pure transform helpers — exported so scripts/build-roster.test.mjs can
// exercise them directly without touching the filesystem.
// ---------------------------------------------------------------------------

/** Pulls the `<id>` out of a `/profile/<id>` path, whether that path arrived
 *  relative (`/profile/sza`) or absolute (`https://api.rostr.cc/profile/sza`,
 *  `https://www.rostr.cc/profile/sza`) — the host never matters, only the
 *  trailing path segment does. */
function extractProfileId(profileUrl) {
  if (!profileUrl || typeof profileUrl !== 'string') return '';
  try {
    const path = profileUrl.includes('://') ? new URL(profileUrl).pathname : profileUrl;
    const match = path.match(/\/profile\/([^/?#]+)/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

/** Canonical `https://www.rostr.cc/profile/<id>` URL for an artist, built
 *  from the artist's own `rostrId` when present (the normal case — it's the
 *  id the collector bucketed the artist under) and falling back to whatever
 *  id can be pulled out of `entity.profileUrl` otherwise. Either way the
 *  output always uses the same host, regardless of what host (if any) the
 *  source URL pointed at — that's the "normalise" ROSTR does inconsistently
 *  across relative / www / api-hosted profileUrl values. */
export function buildRostrUrl(artist) {
  const id = String(artist?.rostrId || '').trim() || extractProfileId(artist?.entity?.profileUrl);
  return id ? `https://www.rostr.cc/profile/${id}` : '';
}

/** Instagram handle from a profile URL like `https://www.instagram.com/sza/`
 *  or `https://www.instagram.com/sza/?hl=en` -> `sza`. A leading `@` is
 *  stripped too, in case a handle ever arrives in `@handle` form instead of a
 *  full URL. Unparseable or missing input yields `''`, never throws. */
export function extractInstagramHandle(igUrl) {
  if (!igUrl || typeof igUrl !== 'string') return '';
  try {
    const url = new URL(igUrl);
    const segment = url.pathname.split('/').filter(Boolean)[0] || '';
    return segment.replace(/^@/, '');
  } catch {
    return '';
  }
}

function dedupe(values) {
  return Array.from(new Set(values));
}

function toNumber(value) {
  return Number(value) || 0;
}

/** `[{ name }]` -> `'name1, name2'`. agencies/labels/publishers are strings
 *  in the existing roster.json schema (see parse-roster.mjs), not arrays —
 *  this keeps build-roster.mjs's output byte-for-byte compatible. */
function joinNames(list) {
  if (!Array.isArray(list)) return '';
  return list
    .map(entry => String(entry?.name ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** Maps one raw collector artist record to the roster.json artist shape.
 *  Key order matches parse-roster.mjs's object literal exactly, since
 *  JSON.stringify preserves insertion order and downstream diffs (and any
 *  human skimming roster.json) rely on that consistency. */
export function mapArtist(raw) {
  const managers = Array.isArray(raw?.managers) ? raw.managers : [];

  const managerNames = dedupe(
    managers.map(m => String(m?.name ?? '').trim()).filter(Boolean)
  );

  // Lowercased before the @ check and the dedupe so two casings of the same
  // mailbox (a data entry slip, same as the one lib/roster.ts's
  // dedupeManagerContacts guards against for parse-roster.mjs's output)
  // collapse into one entry here instead of leaking into roster.json.
  const managerEmails = dedupe(
    managers
      .map(m => String(m?.email ?? '').trim().toLowerCase())
      .filter(email => email && email.includes('@'))
  );

  const genres = Array.isArray(raw?.genre)
    ? raw.genre.map(g => String(g ?? '').trim()).filter(Boolean)
    : [];

  return {
    name: String(raw?.entity?.name ?? '').trim(),
    rostrUrl: buildRostrUrl(raw),
    genres,
    type: String(raw?.type ?? '').trim(),
    gender: String(raw?.gender ?? '').trim(),
    spotifyFollowers: toNumber(raw?.spMetric),
    instagramFollowers: toNumber(raw?.igMetric),
    youtubeSubscribers: toNumber(raw?.ytMetric),
    managementCompany: String(raw?.management?.[0]?.name ?? '').trim(),
    agencies: joinNames(raw?.agencies),
    labels: joinNames(raw?.labels),
    publishers: joinNames(raw?.publishers),
    managerNames,
    managerEmails,
    instagramHandle: extractInstagramHandle(raw?.igUrl),
    avatarUrl: String(raw?.avatar?.imageUrl ?? '').trim(),
  };
}

/**
 * Transforms a parsed raw collection object (`{ collectedAt, artists }`, see
 * scripts/build-roster.test.mjs for fixtures) into the roster.json output
 * shape. Kept separate from the CLI/file-I/O in main() below so it's unit
 * testable without touching the filesystem.
 */
export function buildRoster(raw) {
  const rawArtists = Array.isArray(raw?.artists) ? raw.artists : [];

  // The collector queries ROSTR bucket-by-bucket (e.g. one pass per genre),
  // so an artist that qualifies for more than one bucket shows up more than
  // once in the raw file. Keep the first occurrence per rostrId — same
  // "first wins" behaviour a spreadsheet row list would have given
  // parse-roster.mjs, which never had to think about this because an xlsx
  // export only ever lists an artist once.
  const seenIds = new Set();
  const dedupedRaw = [];
  let duplicateCount = 0;
  rawArtists.forEach((artist, i) => {
    // An artist with no rostrId at all can't be matched against anything
    // else, so treat it as always-unique rather than collapsing every
    // id-less record into a single slot.
    const id = artist?.rostrId || `__no-id-${i}`;
    if (seenIds.has(id)) {
      duplicateCount += 1;
      return;
    }
    seenIds.add(id);
    dedupedRaw.push(artist);
  });

  const artists = dedupedRaw.map(mapArtist);

  // Artists with no manager email can never be pitched to, so they're dropped
  // here rather than carried into roster.json just to be filtered out on
  // every request — same rule and same reasoning as parse-roster.mjs.
  const withEmails = artists.filter(a => a.managerEmails.length > 0);
  const droppedCount = artists.length - withEmails.length;

  // Genres computed from the kept artists only, so the genre dropdown never
  // offers a genre with zero actually-reachable artists behind it.
  const genreSet = new Set();
  withEmails.forEach(a => a.genres.forEach(g => genreSet.add(g)));
  const genres = Array.from(genreSet).sort();

  // Reflects when the data was actually pulled from ROSTR, not when this
  // script happened to run — see the generatedAt comment in strip-roster.mjs
  // for why conflating the two is a bug, not a simplification.
  const generatedAt = typeof raw?.collectedAt === 'string' && raw.collectedAt
    ? raw.collectedAt
    : new Date().toISOString();

  return {
    output: { artists: withEmails, genres, generatedAt },
    stats: {
      rawCount: rawArtists.length,
      duplicateCount,
      parsedCount: artists.length,
      keptCount: withEmails.length,
      droppedCount,
      genreCount: genres.length,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  if (argv.length === 0) return null;

  const inputPath = argv[0];
  let outPath = join(__dirname, '..', 'data', 'roster.json');

  const outIndex = argv.indexOf('--out');
  if (outIndex !== -1) {
    const value = argv[outIndex + 1];
    if (!value) return null;
    outPath = isAbsolute(value) ? value : join(process.cwd(), value);
  }

  return { inputPath, outPath };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('Usage: node scripts/build-roster.mjs <path-to-raw-collection.json> [--out data/roster.json]');
    process.exit(1);
  }

  if (!existsSync(args.inputPath)) {
    console.error(`Raw collection file not found: ${args.inputPath}`);
    console.error('Usage: node scripts/build-roster.mjs <path-to-raw-collection.json> [--out data/roster.json]');
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(args.inputPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${args.inputPath} as JSON: ${err.message}`);
    process.exit(1);
  }

  const { output, stats } = buildRoster(raw);

  mkdirSync(dirname(args.outPath), { recursive: true });
  writeFileSync(args.outPath, JSON.stringify(output, null, 2));

  if (stats.duplicateCount > 0) {
    console.log(`Deduped ${stats.duplicateCount} duplicate artist${stats.duplicateCount === 1 ? '' : 's'} (repeat rostrId across buckets), ${stats.parsedCount} unique.`);
  }
  console.log(`Parsed ${stats.parsedCount} artists (${stats.keptCount} with a manager email — kept, ${stats.droppedCount} dropped), ${stats.genreCount} unique genres`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main();
}
