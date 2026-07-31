// One-off cleanup for the roster data already on disk: drops artists with no
// manager email (they can never be contacted, so keeping them just bloats every
// cold start's JSON.parse and every genre-filter scan) and recomputes the genre
// list from the artists that remain, so the dropdown never offers a genre with
// zero reachable artists behind it.
//
// This is separate from parse-roster.mjs (which rebuilds from the source
// spreadsheet) because that spreadsheet isn't available in every environment —
// this script only needs the roster.json that's already checked in.
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rosterPath = join(__dirname, '..', 'data', 'roster.json');

const { artists, generatedAt } = JSON.parse(readFileSync(rosterPath, 'utf-8'));

const withEmails = artists.filter(a => Array.isArray(a.managerEmails) && a.managerEmails.length > 0);

const genreSet = new Set();
withEmails.forEach(a => a.genres.forEach(g => genreSet.add(g)));
const genres = Array.from(genreSet).sort();

// Carry generatedAt through unchanged (when present): this script only trims
// records already pulled from the source spreadsheet, it doesn't re-source them,
// so the roster's actual freshness — when it was pulled from ROSTR — shouldn't
// change just because this cleanup ran. Older roster.json files with no
// generatedAt yet simply stay without one; lib/roster.ts falls back to the
// file's mtime in that case.
writeFileSync(rosterPath, JSON.stringify({ artists: withEmails, genres, ...(generatedAt ? { generatedAt } : {}) }, null, 2));

console.log(`Kept ${withEmails.length} of ${artists.length} artists (dropped ${artists.length - withEmails.length} with no manager email).`);
console.log(`Genres: ${genres.length}`);
