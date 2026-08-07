// Imports one or more manually-exported rostr.cc xlsx batches into
// data/roster.json WITHOUT ever replacing it wholesale.
//
// Why this exists: scripts/parse-roster.mjs writes roster.json straight from
// a single xlsx file, which is fine for a single export but is destructive
// the moment a refresh needs more than one — rostr.cc caps a single export at
// ~2,000 rows (see scripts/ROSTER_CONTEXT_CORRECTIONS.md #3), so a full
// refresh is ~12 files, and running parse-roster.mjs on just one of them
// would overwrite roster.json with only that batch, silently deleting every
// contact not in it. See ROSTER_CONTEXT_CORRECTIONS.md's "Always merge; never
// replace" section for the incident that made this the rule.
//
// This script: parses every xlsx batch with the same column rules as
// parse-roster.mjs, concatenates and dedupes them against each other, then
// runs the exact same non-destructive merge scripts/merge-roster.mjs uses
// against the existing roster.json (via merge-roster.mjs's exported
// mergeMappedArtists — there is exactly one implementation of the merge
// rules, this script does not re-implement them).
//
// Usage:
//   node scripts/import-roster-xlsx.mjs <file1.xlsx> [file2.xlsx ...] [--existing data/roster.json] [--out data/roster.json] [--dry-run]
//
// A directory may be passed in place of one or more files — every *.xlsx
// file directly inside it (non-recursive) is imported.
import XLSX from 'xlsx';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'fs';
import { join, dirname, isAbsolute, extname } from 'path';
import { fileURLToPath } from 'url';
import { mapRow } from './parse-roster.mjs';
import { idFromRostrUrl, nameKey, mergeMappedArtists } from './merge-roster.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same 16 columns parse-roster.mjs reads — see the table in
// scripts/ROSTER_CONTEXT.md. Exported so tests can build a valid fixture
// header without duplicating the list by hand.
export const REQUIRED_COLUMNS = [
  'Artist Name',
  'ROSTR URL',
  'Genre',
  'Type',
  'Gender',
  'Spotify Followers',
  'Instagram Followers',
  'YouTube Subscribers',
  'Management Company',
  'Agencies',
  'Labels',
  'Publishers',
  'Manager Name(s)',
  'Manager Email(s)',
  'Instagram Handle',
  'Avatar URL',
];

function validateColumns(filePath, headerRow) {
  const headers = new Set(headerRow);
  const matched = REQUIRED_COLUMNS.filter(c => headers.has(c));

  // A renamed/replaced column set is the known failure mode: the sheet still
  // parses, every field just comes out empty and the script would otherwise
  // report success. Catch it before any row is mapped.
  if (matched.length === 0) {
    throw new Error(
      `${filePath}: none of the expected rostr.cc export columns were found in the header row ` +
      `(got: ${headerRow.length ? headerRow.join(', ') : '(empty)'}). ` +
      `Column headers may have been renamed in the export — check scripts/ROSTER_CONTEXT.md's column table.`
    );
  }
  if (!headers.has('Artist Name')) {
    throw new Error(
      `${filePath}: missing required "Artist Name" column (found: ${headerRow.join(', ')}). ` +
      `Every row would be silently dropped without it.`
    );
  }
}

/** Rewrites the dead `/artists/<id>` route rostr.cc's xlsx export uses to the
 *  working `/profile/<id>` route (ROSTER_CONTEXT_CORRECTIONS.md #2), and
 *  normalises the host the same way build-roster.mjs's buildRostrUrl() does.
 *  Reuses idFromRostrUrl so the same regex drives both this normalisation
 *  and cross-file/existing-roster identity matching. Falls back to the
 *  trimmed input when no id can be extracted at all. */
export function normalizeRostrUrl(url) {
  const id = idFromRostrUrl(url);
  if (id) return `https://www.rostr.cc/profile/${id}`;
  return String(url || '').trim();
}

/** Trim, lowercase, require '@', dedupe — applied on top of parse-roster.mjs's
 *  split/trim/'@'-filter so two casings of the same mailbox (or the same
 *  email appearing twice in one cell) collapse into one entry. */
export function normalizeEmails(emails) {
  const seen = new Set();
  const out = [];
  for (const raw of (Array.isArray(emails) ? emails : [])) {
    const norm = String(raw || '').trim().toLowerCase();
    if (!norm || !norm.includes('@') || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** Resolves a list of file/directory args to a flat list of xlsx file paths.
 *  A directory is expanded to the *.xlsx files directly inside it
 *  (non-recursive). Throws with a clear message on a missing path, a
 *  non-xlsx file, or a directory with no xlsx files in it. */
export function expandXlsxPaths(paths) {
  const out = [];
  for (const p of paths) {
    const resolved = isAbsolute(p) ? p : join(process.cwd(), p);
    if (!existsSync(resolved)) {
      throw new Error(`Path not found: ${resolved}`);
    }
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      const found = readdirSync(resolved)
        .filter(f => extname(f).toLowerCase() === '.xlsx')
        .map(f => join(resolved, f))
        .sort();
      if (found.length === 0) {
        throw new Error(`No .xlsx files found in directory: ${resolved}`);
      }
      out.push(...found);
    } else {
      if (extname(resolved).toLowerCase() !== '.xlsx') {
        throw new Error(`Not an .xlsx file: ${resolved}`);
      }
      out.push(resolved);
    }
  }
  return out;
}

/** Parses one xlsx batch into mapped, normalised artist records. Validates
 *  the column headers first so a renamed column fails loudly instead of
 *  silently emptying a field. */
export function parseXlsxFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let wb;
  try {
    wb = XLSX.readFile(filePath);
  } catch (err) {
    throw new Error(`Failed to read ${filePath} as xlsx: ${err.message}`);
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    throw new Error(`${filePath}: workbook has no sheets`);
  }

  const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0] || [])
    .map(h => String(h).trim());
  validateColumns(filePath, headerRow);

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows
    .filter(row => row['Artist Name'] && String(row['Artist Name']).trim())
    .map(row => {
      const artist = mapRow(row);
      artist.rostrUrl = normalizeRostrUrl(artist.rostrUrl);
      artist.managerEmails = normalizeEmails(artist.managerEmails);
      return artist;
    });
}

/** Identity used for both cross-file dedupe and comparing against the
 *  existing roster: the id parsed out of ROSTR URL, falling back to the
 *  lowercased/trimmed name — same rule merge-roster.mjs uses to match a new
 *  artist back to a prior one. */
function identityKey(artist) {
  const id = idFromRostrUrl(artist.rostrUrl);
  return id ? `id:${id}` : `name:${nameKey(artist.name)}`;
}

/** Concatenates and dedupes artist records parsed across multiple xlsx
 *  batches. First occurrence wins (same convention build-roster.mjs uses for
 *  duplicate rostrIds across collector buckets) — batches are expected to be
 *  disjoint filters, so a duplicate here means the same artist matched more
 *  than one filter, not that a later batch is more authoritative. */
export function dedupeAcrossFiles(artists) {
  const byKey = new Map();
  let duplicates = 0;
  for (const artist of artists) {
    const key = identityKey(artist);
    if (byKey.has(key)) {
      duplicates += 1;
      continue;
    }
    byKey.set(key, artist);
  }
  return { artists: [...byKey.values()], duplicates };
}

function uniqueEmailSet(artists) {
  const set = new Set();
  for (const a of (Array.isArray(artists) ? artists : [])) {
    for (const e of (Array.isArray(a.managerEmails) ? a.managerEmails : [])) {
      const norm = String(e || '').trim().toLowerCase();
      if (norm) set.add(norm);
    }
  }
  return set;
}

/** Runs the shared non-destructive merge (merge-roster.mjs's
 *  mergeMappedArtists) against already-deduped, already-mapped new artists,
 *  then applies the same "drop unreachable, compute genres" finishing steps
 *  merge-roster.mjs/build-roster.mjs/parse-roster.mjs all apply. */
export function buildImport(newArtists, existingRoster) {
  const existingArtists = Array.isArray(existingRoster?.artists) ? existingRoster.artists : [];
  const { merged, stats: mergeStats } = mergeMappedArtists(newArtists, existingArtists);

  const withEmails = merged.filter(a => a.managerEmails.length > 0);
  const dropped = merged.length - withEmails.length;

  const genreSet = new Set();
  withEmails.forEach(a => a.genres.forEach(g => genreSet.add(g)));
  const genres = Array.from(genreSet).sort();

  // Unlike build-roster.mjs/merge-roster.mjs, which prefer raw.collectedAt
  // because the browser collector stamps the actual query time, a manual
  // xlsx export carries no such timestamp at all — rostr.cc's export doesn't
  // include one. Per ROSTER_CONTEXT_CORRECTIONS.md #5, generatedAt must mean
  // "when the data was pulled from rostr.cc", never "when a script ran"; for
  // a manual export those two moments are effectively the same, since the
  // operator runs this script right after exporting the files. So `now` IS
  // the pull time here, not a fallback standing in for a missing one.
  const generatedAt = new Date().toISOString();

  return {
    output: { artists: withEmails, genres, generatedAt },
    stats: { ...mergeStats, dropped, kept: withEmails.length, genreCount: genres.length },
  };
}

/** Compares the existing roster against the freshly-built output and reports
 *  whether anything reachable was lost. The merge is designed to make this
 *  always zero — this function is the safety net that would catch it if a
 *  future change broke that guarantee. */
export function computeLossSummary(existingArtists, outputArtists) {
  const existing = Array.isArray(existingArtists) ? existingArtists : [];
  const reachableExisting = existing.filter(a => Array.isArray(a.managerEmails) && a.managerEmails.length > 0);

  const outputKeys = new Set(outputArtists.map(identityKey));
  const lostArtists = reachableExisting.filter(a => !outputKeys.has(identityKey(a)));

  const beforeEmails = uniqueEmailSet(existing);
  const afterEmails = uniqueEmailSet(outputArtists);
  const lostEmails = [...beforeEmails].filter(e => !afterEmails.has(e));

  return {
    beforeArtistCount: existing.length,
    afterArtistCount: outputArtists.length,
    beforeEmailCount: beforeEmails.size,
    afterEmailCount: afterEmails.size,
    artistsLost: lostArtists.length,
    lostArtists,
    emailsLost: lostEmails.length,
    lostEmails,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function resolve(value, fallback) {
  if (!value) return fallback;
  return isAbsolute(value) ? value : join(process.cwd(), value);
}

function parseArgs(argv) {
  const flags = { existing: null, out: null, dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--existing') { flags.existing = argv[++i]; }
    else if (a === '--out') { flags.out = argv[++i]; }
    else if (a === '--dry-run') { flags.dryRun = true; }
    else positional.push(a);
  }
  return { positional, ...flags };
}

const USAGE = 'Usage: node scripts/import-roster-xlsx.mjs <file1.xlsx> [file2.xlsx ...] [--existing data/roster.json] [--out data/roster.json] [--dry-run]';

function main() {
  const { positional, existing: existingArg, out: outArg, dryRun } = parseArgs(process.argv.slice(2));
  if (positional.length === 0) {
    console.error(USAGE);
    process.exit(1);
  }

  const defaultRoster = join(__dirname, '..', 'data', 'roster.json');
  const existingPath = resolve(existingArg, defaultRoster);
  const outPath = resolve(outArg, defaultRoster);

  if (!existsSync(existingPath)) {
    console.error(`Existing roster not found: ${existingPath}`);
    process.exit(1);
  }

  let xlsxFiles;
  try {
    xlsxFiles = expandXlsxPaths(positional);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let existingRoster;
  try {
    existingRoster = JSON.parse(readFileSync(existingPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${existingPath} as JSON: ${err.message}`);
    process.exit(1);
  }

  console.log(`Importing ${xlsxFiles.length} file(s):`);
  const parsedRows = [];
  for (const file of xlsxFiles) {
    try {
      const parsed = parseXlsxFile(file);
      console.log(`  ${file}: ${parsed.length} artist rows`);
      parsedRows.push(...parsed);
    } catch (err) {
      console.error(`Failed to parse ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  const { artists: dedupedNew, duplicates: crossFileDuplicates } = dedupeAcrossFiles(parsedRows);
  console.log(`Parsed ${parsedRows.length} artist rows total (${crossFileDuplicates} duplicate across batches, ${dedupedNew.length} unique)`);

  const { output, stats } = buildImport(dedupedNew, existingRoster);
  const loss = computeLossSummary(existingRoster.artists, output.artists);

  console.log(`New/matched: ${stats.brandNew} brand new artists, ${stats.freshEmails} rows with an email in this import`);
  console.log(`Emails: ${stats.carriedEmails} carried forward from the existing roster, ${stats.unionedEmails} artists gained an address from the union`);
  console.log(`Retained ${stats.retained} existing reachable artists this import didn't find`);
  console.log(`Dropped ${stats.dropped} with no reachable manager email, ${stats.genreCount} unique genres`);
  console.log('---');
  console.log(`Artists: ${loss.beforeArtistCount} -> ${loss.afterArtistCount} (added: ${loss.afterArtistCount - loss.beforeArtistCount})`);
  console.log(`Unique manager emails: ${loss.beforeEmailCount} -> ${loss.afterEmailCount} (added: ${loss.afterEmailCount - loss.beforeEmailCount})`);
  console.log(`artists lost: ${loss.artistsLost}`);
  console.log(`emails lost: ${loss.emailsLost}`);

  if (loss.artistsLost > 0 || loss.emailsLost > 0) {
    console.warn('');
    console.warn(`WARNING: this import would be DESTRUCTIVE (artists lost: ${loss.artistsLost}, emails lost: ${loss.emailsLost}).`);
    console.warn('The merge is designed to be incapable of losing reachable data — this indicates a bug, not expected behaviour.');
    if (loss.lostArtists.length) {
      const sample = loss.lostArtists.slice(0, 10).map(a => a.name).join(', ');
      console.warn(`  Artists that would be lost (${loss.lostArtists.length}): ${sample}${loss.lostArtists.length > 10 ? ', ...' : ''}`);
    }
    if (loss.lostEmails.length) {
      const sample = loss.lostEmails.slice(0, 10).join(', ');
      console.warn(`  Emails that would be lost (${loss.lostEmails.length}): ${sample}${loss.lostEmails.length > 10 ? ', ...' : ''}`);
    }
    console.warn('');
  }

  if (dryRun) {
    console.log(`DRY RUN: would write ${output.artists.length} artists to ${outPath}. Nothing was written.`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) main();
