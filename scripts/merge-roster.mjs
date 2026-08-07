// Merges a freshly-collected roster against the roster.json already on disk.
//
// Why this exists as a separate step: a collection run resolves manager emails
// for only some of the artists it finds, so building roster.json from the new
// data alone would drop every contact the previous roster had and the new run
// didn't happen to re-resolve. On the 2026-08-07 run that would have taken the
// roster from 2,983 reachable artists down to 1,238 — a silent loss of 1,745
// contacts, with the script reporting success either way.
//
// So: metadata (follower counts, genres, management company, profile URL) is
// always taken from the NEW collection, because that's the half that goes
// stale. Manager names/emails are taken from the new collection when it
// resolved them, and otherwise carried forward from the existing roster.
//
// Usage:
//   node scripts/merge-roster.mjs <raw-collection.json> [--existing data/roster.json] [--out data/roster.json]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { mapArtist } from './build-roster.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Pulls the artist id out of any of the profile URL shapes that have been
 *  written into roster.json over time — `/artists/<id>` (the old, broken
 *  plural form), `/artist/<id>`, and `/profile/<id>`. */
export function idFromRostrUrl(url) {
  const match = String(url || '').match(/\/(?:artists|artist|profile)\/([^/?#]+)/);
  return match ? match[1] : null;
}

const nameKey = name => String(name || '').toLowerCase().trim();

/**
 * @param raw      parsed raw collection ({ collectedAt, artists })
 * @param existing parsed existing roster.json ({ artists, genres, generatedAt })
 */
export function mergeRoster(raw, existing) {
  const existingArtists = Array.isArray(existing?.artists) ? existing.artists : [];

  // Two indexes because roster.json's URLs are unreliable: on the June 2026
  // roster only 1,621 of 2,983 artists had a URL at all, so id-matching alone
  // would fail to carry forward the other 1,362's emails. Name is the fallback.
  const byId = new Map();
  const byName = new Map();
  for (const a of existingArtists) {
    const id = idFromRostrUrl(a.rostrUrl);
    if (id) byId.set(id, a);
    byName.set(nameKey(a.name), a);
  }

  const rawArtists = Array.isArray(raw?.artists) ? raw.artists : [];
  const seen = new Set();
  const merged = [];
  const stats = { collected: rawArtists.length, duplicates: 0, freshEmails: 0, carriedEmails: 0, unionedEmails: 0, brandNew: 0, retained: 0 };
  const matchedPrior = new Set();

  for (const rawArtist of rawArtists) {
    const id = rawArtist?.rostrId;
    if (id) {
      if (seen.has(id)) { stats.duplicates += 1; continue; }
      seen.add(id);
    }

    const artist = mapArtist(rawArtist);
    const prior = (id && byId.get(id)) || byName.get(nameKey(artist.name)) || null;
    if (!prior) stats.brandNew += 1;
    else matchedPrior.add(prior);

    if (artist.managerEmails.length > 0) stats.freshEmails += 1;

    // Union rather than "fresh wins". A fresh lookup returning fewer managers
    // than the previous roster had doesn't prove the missing ones are gone —
    // on the 2026-08-07 run this rule was the difference between keeping and
    // silently dropping 14 working addresses (e.g. Oliver Tree, where the new
    // lookup returned one of the two managers the old roster had).
    //
    // The asymmetry is deliberate: a stale address self-corrects, because a
    // bounce puts it on the Do Not Contact list (lib/refreshReplies.ts). A
    // contact deleted here is just gone, and nothing downstream notices.
    if (prior && Array.isArray(prior.managerEmails) && prior.managerEmails.length > 0) {
      const before = artist.managerEmails.length;
      // Lowercased on both sides so a casing difference between the old
      // roster and the API doesn't read as two distinct mailboxes.
      const emails = new Set(artist.managerEmails.map(e => e.toLowerCase()));
      for (const e of prior.managerEmails) {
        const norm = String(e || '').trim().toLowerCase();
        if (norm && norm.includes('@')) emails.add(norm);
      }
      artist.managerEmails = [...emails];

      const names = new Set(artist.managerNames);
      for (const n of (Array.isArray(prior.managerNames) ? prior.managerNames : [])) {
        const norm = String(n || '').trim();
        if (norm) names.add(norm);
      }
      artist.managerNames = [...names];

      if (before === 0) stats.carriedEmails += 1;
      else if (artist.managerEmails.length > before) stats.unionedEmails += 1;
    }

    merged.push(artist);
  }

  // An artist the previous roster could reach but this collection didn't find
  // at all is kept as-is rather than dropped. A collection run can miss someone
  // for reasons that say nothing about whether they're still pitchable — the
  // 2026-08-07 run missed one artist (SALOME) who appears to have been renamed
  // or delisted on ROSTR. Dropping a working contact because a scrape didn't
  // see them is a worse failure than carrying a possibly-stale record.
  for (const prior of existingArtists) {
    if (matchedPrior.has(prior)) continue;
    if (!Array.isArray(prior.managerEmails) || prior.managerEmails.length === 0) continue;
    merged.push(prior);
    stats.retained += 1;
  }

  // Same rule as parse-roster.mjs/build-roster.mjs: an artist with no manager
  // email can never be pitched, so it isn't worth carrying into roster.json.
  const withEmails = merged.filter(a => a.managerEmails.length > 0);
  stats.dropped = merged.length - withEmails.length;
  stats.kept = withEmails.length;

  const genreSet = new Set();
  withEmails.forEach(a => a.genres.forEach(g => genreSet.add(g)));
  const genres = Array.from(genreSet).sort();

  const generatedAt = typeof raw?.collectedAt === 'string' && raw.collectedAt
    ? raw.collectedAt
    : new Date().toISOString();

  return { output: { artists: withEmails, genres, generatedAt }, stats: { ...stats, genreCount: genres.length } };
}

function resolve(value, fallback) {
  if (!value) return fallback;
  return isAbsolute(value) ? value : join(process.cwd(), value);
}

function main() {
  const argv = process.argv.slice(2);
  const inputPath = argv[0];
  if (!inputPath) {
    console.error('Usage: node scripts/merge-roster.mjs <raw-collection.json> [--existing data/roster.json] [--out data/roster.json]');
    process.exit(1);
  }
  const defaultRoster = join(__dirname, '..', 'data', 'roster.json');
  const existingIdx = argv.indexOf('--existing');
  const outIdx = argv.indexOf('--out');
  const existingPath = resolve(existingIdx !== -1 ? argv[existingIdx + 1] : null, defaultRoster);
  const outPath = resolve(outIdx !== -1 ? argv[outIdx + 1] : null, defaultRoster);

  for (const [label, p] of [['Raw collection', inputPath], ['Existing roster', existingPath]]) {
    if (!existsSync(p)) { console.error(`${label} not found: ${p}`); process.exit(1); }
  }

  let raw, existing;
  try {
    raw = JSON.parse(readFileSync(inputPath, 'utf-8'));
    existing = JSON.parse(readFileSync(existingPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse input as JSON: ${err.message}`);
    process.exit(1);
  }

  const { output, stats } = mergeRoster(raw, existing);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`Collected ${stats.collected} artists (${stats.duplicates} duplicate, ${stats.brandNew} not in the previous roster)`);
  console.log(`Emails: ${stats.freshEmails} freshly resolved, ${stats.carriedEmails} carried forward, ${stats.unionedEmails} artists gained an address from the union`);
  console.log(`Retained ${stats.retained} reachable artists the collection didn't find`);
  console.log(`Kept ${stats.kept}, dropped ${stats.dropped} with no reachable manager email, ${stats.genreCount} unique genres`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) main();
