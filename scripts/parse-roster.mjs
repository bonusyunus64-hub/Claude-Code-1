import XLSX from 'xlsx';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Maps one row of a rostr.cc xlsx export (as returned by
 *  `XLSX.utils.sheet_to_json`) to the roster.json artist shape. Exported so
 *  scripts/import-roster-xlsx.mjs can parse multi-batch exports with exactly
 *  the same column names and splitting rules instead of duplicating them. */
export function mapRow(row) {
  const managerEmailsRaw = String(row['Manager Email(s)'] || '');
  const managerNamesRaw = String(row['Manager Name(s)'] || '');
  const genreRaw = String(row['Genre'] || '');

  const emails = managerEmailsRaw
    .split(';')
    .map(e => e.trim())
    .filter(e => e && e.includes('@'));

  const names = managerNamesRaw
    .split(';')
    .map(n => n.trim())
    .filter(Boolean);

  const genres = genreRaw
    .split(',')
    .map(g => g.trim())
    .filter(Boolean);

  return {
    name: String(row['Artist Name'] || '').trim(),
    rostrUrl: String(row['ROSTR URL'] || '').trim(),
    genres,
    type: String(row['Type'] || '').trim(),
    gender: String(row['Gender'] || '').trim(),
    spotifyFollowers: Number(row['Spotify Followers']) || 0,
    instagramFollowers: Number(row['Instagram Followers']) || 0,
    youtubeSubscribers: Number(row['YouTube Subscribers']) || 0,
    managementCompany: String(row['Management Company'] || '').trim(),
    agencies: String(row['Agencies'] || '').trim(),
    labels: String(row['Labels'] || '').trim(),
    publishers: String(row['Publishers'] || '').trim(),
    managerNames: names,
    managerEmails: emails,
    instagramHandle: String(row['Instagram Handle'] || '').trim(),
    avatarUrl: String(row['Avatar URL'] || '').trim(),
  };
}

function main() {
  // Pass the spreadsheet path as an argument: `node scripts/parse-roster.mjs path/to/roster.xlsx`.
  // Defaults to data/roster_new.xlsx (repo-relative) so a spreadsheet dropped there
  // "just works" without typing the path.
  const filePath = process.argv[2] || join(__dirname, '..', 'data', 'roster_new.xlsx');
  if (!existsSync(filePath)) {
    console.error(`Roster spreadsheet not found: ${filePath}`);
    console.error('Usage: node scripts/parse-roster.mjs <path-to-spreadsheet.xlsx>');
    process.exit(1);
  }
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const artists = rows
    .filter(row => row['Artist Name'] && String(row['Artist Name']).trim())
    .map(mapRow);

  // Artists with no manager email can never be pitched to, so they're dropped here
  // rather than carried into roster.json just to be filtered out on every request —
  // that both shrinks the file the app parses on every cold start and keeps the
  // genre list free of genres with zero actually-reachable artists behind them.
  const withEmails = artists.filter(a => a.managerEmails.length > 0);

  const genreSet = new Set();
  withEmails.forEach(a => a.genres.forEach(g => genreSet.add(g)));
  const allGenres = Array.from(genreSet).sort();

  // Stamped so lib/roster.ts (and the "Artist roster... updated <date>" note on the
  // Overview tab) can report exactly when this snapshot was pulled from the source
  // spreadsheet, instead of falling back to the roster.json file's mtime.
  const output = { artists: withEmails, genres: allGenres, generatedAt: new Date().toISOString() };

  const outDir = join(__dirname, '..', 'data');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'roster.json'), JSON.stringify(output, null, 2));

  console.log(`Parsed ${artists.length} artists (${withEmails.length} with a manager email — kept), ${allGenres.length} unique genres`);
  console.log('Sample genres:', allGenres.slice(0, 20).join(', '));
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) main();
