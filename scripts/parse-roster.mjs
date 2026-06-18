import XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const filePath = '/home/user/Claude-Code-1/data/roster_new.xlsx'; // updated spreadsheet with avatarUrl
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

const artists = rows
  .filter(row => row['Artist Name'] && String(row['Artist Name']).trim())
  .map(row => {
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
      name: String(row['Artist Name']).trim(),
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
  });

// Extract unique genres
const genreSet = new Set();
artists.forEach(a => a.genres.forEach(g => genreSet.add(g)));
const allGenres = Array.from(genreSet).sort();

const output = { artists, genres: allGenres };

const outDir = join(__dirname, '..', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'roster.json'), JSON.stringify(output, null, 2));

console.log(`Parsed ${artists.length} artists, ${allGenres.length} unique genres`);
console.log('Sample genres:', allGenres.slice(0, 20).join(', '));

const withEmails = artists.filter(a => a.managerEmails.length > 0);
console.log(`Artists with manager emails: ${withEmails.length}`);
