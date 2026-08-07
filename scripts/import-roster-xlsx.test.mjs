import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import XLSX from 'xlsx';
import {
  REQUIRED_COLUMNS,
  normalizeRostrUrl,
  normalizeEmails,
  expandXlsxPaths,
  parseXlsxFile,
  dedupeAcrossFiles,
  buildImport,
  computeLossSummary,
} from './import-roster-xlsx.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, 'import-roster-xlsx.mjs');

// Fixtures live in the OS temp dir, not the repo — cleaned up after every test.
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'import-roster-xlsx-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeXlsxFixture(dir, fileName, headers, rows) {
  const filePath = join(dir, fileName);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filePath);
  return filePath;
}

function writeJson(dir, fileName, data) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

// A full valid row, in REQUIRED_COLUMNS order.
function fullRow({
  name = 'Artist',
  url = 'https://www.rostr.cc/artists/artist-id',
  genre = 'Pop, Rock',
  type = 'Person',
  gender = 'FEMALE',
  sp = 1000,
  ig = 2000,
  yt = 3000,
  mgmtCo = 'Some Mgmt',
  agencies = 'WME',
  labels = 'RCA',
  publishers = 'Sony',
  managerNames = 'Manager One',
  managerEmails = 'manager@example.com',
  igHandle = 'artist',
  avatar = 'https://i.scdn.co/image/abc',
} = {}) {
  return [name, url, genre, type, gender, sp, ig, yt, mgmtCo, agencies, labels, publishers, managerNames, managerEmails, igHandle, avatar];
}

function mappedArtist(overrides = {}) {
  return {
    name: 'Artist',
    rostrUrl: 'https://www.rostr.cc/profile/artist',
    genres: [],
    type: 'Person',
    gender: '',
    spotifyFollowers: 0,
    instagramFollowers: 0,
    youtubeSubscribers: 0,
    managementCompany: '',
    agencies: '',
    labels: '',
    publishers: '',
    managerNames: [],
    managerEmails: [],
    instagramHandle: '',
    avatarUrl: '',
    ...overrides,
  };
}

const EMPTY_ROSTER = { artists: [], genres: [], generatedAt: '2026-01-01T00:00:00.000Z' };

describe('normalizeRostrUrl', () => {
  it('rewrites the dead /artists/ route to /profile/', () => {
    expect(normalizeRostrUrl('https://www.rostr.cc/artists/brunomars')).toBe('https://www.rostr.cc/profile/brunomars');
  });

  it('leaves an already-correct /profile/ url unchanged', () => {
    expect(normalizeRostrUrl('https://www.rostr.cc/profile/brunomars')).toBe('https://www.rostr.cc/profile/brunomars');
  });

  it('falls back to the trimmed input when no id can be extracted', () => {
    expect(normalizeRostrUrl('not a url')).toBe('not a url');
    expect(normalizeRostrUrl('  ')).toBe('');
    expect(normalizeRostrUrl('')).toBe('');
  });
});

describe('normalizeEmails', () => {
  it('trims, lowercases, requires @, and dedupes', () => {
    expect(normalizeEmails([' Foo@Example.com ', 'foo@example.com', 'bad-email', '', null, undefined]))
      .toEqual(['foo@example.com']);
  });

  it('handles a non-array input gracefully', () => {
    expect(normalizeEmails(undefined)).toEqual([]);
  });
});

describe('expandXlsxPaths', () => {
  it('passes through individual xlsx files', () => {
    const a = writeXlsxFixture(workDir, 'a.xlsx', REQUIRED_COLUMNS, [fullRow()]);
    const b = writeXlsxFixture(workDir, 'b.xlsx', REQUIRED_COLUMNS, [fullRow()]);
    expect(expandXlsxPaths([a, b]).sort()).toEqual([a, b].sort());
  });

  it('expands a directory to its *.xlsx files, non-recursively', () => {
    const batchesDir = join(workDir, 'batches');
    mkdirSync(batchesDir);
    const a = writeXlsxFixture(batchesDir, 'a.xlsx', REQUIRED_COLUMNS, [fullRow()]);
    const b = writeXlsxFixture(batchesDir, 'b.xlsx', REQUIRED_COLUMNS, [fullRow()]);
    // A non-xlsx file in the same directory must be ignored.
    writeJson(batchesDir, 'notes.json', { hello: 'world' });
    // A nested directory's xlsx file must NOT be picked up (non-recursive).
    const nestedDir = join(batchesDir, 'nested');
    mkdirSync(nestedDir);
    writeXlsxFixture(nestedDir, 'c.xlsx', REQUIRED_COLUMNS, [fullRow()]);

    const result = expandXlsxPaths([batchesDir]);
    expect(result.sort()).toEqual([a, b].sort());
  });

  it('throws clearly on a missing path', () => {
    expect(() => expandXlsxPaths([join(workDir, 'does-not-exist.xlsx')])).toThrow(/not found/i);
  });

  it('throws clearly on a non-xlsx file', () => {
    const notXlsx = writeJson(workDir, 'file.json', {});
    expect(() => expandXlsxPaths([notXlsx])).toThrow(/not an \.xlsx file/i);
  });
});

describe('parseXlsxFile', () => {
  it('throws a clear error when none of the expected columns are present', () => {
    const filePath = writeXlsxFixture(workDir, 'bad.xlsx', ['Foo', 'Bar'], [['a', 'b']]);
    expect(() => parseXlsxFile(filePath)).toThrow(/none of the expected/i);
  });

  it('throws a clear error when the "Artist Name" column has been renamed', () => {
    const headers = REQUIRED_COLUMNS.map(c => (c === 'Artist Name' ? 'Performer Name' : c));
    const filePath = writeXlsxFixture(workDir, 'renamed.xlsx', headers, [fullRow()]);
    expect(() => parseXlsxFile(filePath)).toThrow(/Artist Name/);
  });

  it('throws on a missing file', () => {
    expect(() => parseXlsxFile(join(workDir, 'nope.xlsx'))).toThrow(/not found/i);
  });

  it('parses a valid row, normalising the rostr URL and manager emails', () => {
    const filePath = writeXlsxFixture(workDir, 'good.xlsx', REQUIRED_COLUMNS, [
      fullRow({
        name: 'SZA',
        url: 'https://www.rostr.cc/artists/sza',
        managerEmails: 'Mgr@Example.com; mgr@example.com',
        genre: 'R&B, Pop',
      }),
    ]);

    const [artist] = parseXlsxFile(filePath);
    expect(artist.name).toBe('SZA');
    expect(artist.rostrUrl).toBe('https://www.rostr.cc/profile/sza');
    expect(artist.managerEmails).toEqual(['mgr@example.com']);
    expect(artist.genres).toEqual(['R&B', 'Pop']);
  });

  it('drops rows with a blank Artist Name', () => {
    const filePath = writeXlsxFixture(workDir, 'blank-name.xlsx', REQUIRED_COLUMNS, [
      fullRow({ name: '' }),
      fullRow({ name: 'Real Artist', url: 'https://www.rostr.cc/artists/real-artist' }),
    ]);
    const artists = parseXlsxFile(filePath);
    expect(artists.map(a => a.name)).toEqual(['Real Artist']);
  });
});

describe('multi-file concatenation and cross-file dedupe', () => {
  it('concatenates artists across files and dedupes by identity (ROSTR URL id, first occurrence wins)', () => {
    const fileA = writeXlsxFixture(workDir, 'a.xlsx', REQUIRED_COLUMNS, [
      fullRow({ name: 'Artist A', url: 'https://www.rostr.cc/artists/artist-a', sp: 1000 }),
      fullRow({ name: 'Artist B', url: 'https://www.rostr.cc/artists/artist-b' }),
    ]);
    const fileB = writeXlsxFixture(workDir, 'b.xlsx', REQUIRED_COLUMNS, [
      // Same artist as file A (same id via the ROSTR URL, already-correct /profile/ form
      // this time) — simulates overlapping export filters. Different metadata should lose.
      fullRow({ name: 'Artist A', url: 'https://www.rostr.cc/profile/artist-a', sp: 9999 }),
      fullRow({ name: 'Artist C', url: 'https://www.rostr.cc/artists/artist-c' }),
    ]);

    const parsed = [...parseXlsxFile(fileA), ...parseXlsxFile(fileB)];
    expect(parsed).toHaveLength(4);

    const { artists, duplicates } = dedupeAcrossFiles(parsed);
    expect(duplicates).toBe(1);
    expect(artists.map(a => a.name).sort()).toEqual(['Artist A', 'Artist B', 'Artist C']);
    expect(artists.find(a => a.name === 'Artist A').spotifyFollowers).toBe(1000);
  });

  it('dedupes by lowercased/trimmed name when neither row has a usable ROSTR URL', () => {
    const parsed = [
      mappedArtist({ name: '  Same Artist ', rostrUrl: '' }),
      mappedArtist({ name: 'same artist', rostrUrl: '' }),
    ];
    const { artists, duplicates } = dedupeAcrossFiles(parsed);
    expect(artists).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe('buildImport (reuses merge-roster.mjs non-destructive merge)', () => {
  it('unions manager emails with the existing roster rather than replacing them', () => {
    const existing = {
      artists: [mappedArtist({
        name: 'Existing Artist',
        rostrUrl: 'https://www.rostr.cc/profile/existing-artist',
        managerNames: ['Old Manager'],
        managerEmails: ['old@example.com'],
      })],
      genres: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const newArtists = [mappedArtist({
      name: 'Existing Artist',
      rostrUrl: 'https://www.rostr.cc/profile/existing-artist',
      spotifyFollowers: 500,
      managementCompany: 'New Mgmt',
      managerNames: ['New Manager'],
      managerEmails: ['new@example.com'],
    })];

    const { output, stats } = buildImport(newArtists, existing);
    const merged = output.artists.find(a => a.name === 'Existing Artist');

    expect(merged.managerEmails.sort()).toEqual(['new@example.com', 'old@example.com']);
    expect(merged.managerNames.sort()).toEqual(['New Manager', 'Old Manager']);
    // Metadata comes from the new import, per merge-roster.mjs's rule.
    expect(merged.spotifyFollowers).toBe(500);
    expect(merged.managementCompany).toBe('New Mgmt');
    expect(stats.unionedEmails).toBe(1);
  });

  it('retains an existing reachable artist the import did not find', () => {
    const existing = {
      artists: [mappedArtist({
        name: 'Not In Import',
        rostrUrl: 'https://www.rostr.cc/profile/not-in-import',
        managerEmails: ['manager@example.com'],
      })],
      genres: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };

    const { output, stats } = buildImport([], existing);
    expect(output.artists.map(a => a.name)).toEqual(['Not In Import']);
    expect(stats.retained).toBe(1);
  });

  it('drops artists (new or carried) that end up with no manager email', () => {
    const { output, stats } = buildImport([mappedArtist({ name: 'No Email', managerEmails: [] })], EMPTY_ROSTER);
    expect(output.artists).toEqual([]);
    expect(stats.dropped).toBe(1);
  });

  it('stamps generatedAt as the current time (manual exports have no collectedAt to prefer)', () => {
    const before = Date.now();
    const { output } = buildImport([mappedArtist({ managerEmails: ['a@example.com'] })], EMPTY_ROSTER);
    const generatedAtMs = new Date(output.generatedAt).getTime();
    expect(generatedAtMs).toBeGreaterThanOrEqual(before);
    expect(generatedAtMs).toBeLessThanOrEqual(Date.now());
  });
});

describe('computeLossSummary', () => {
  it('reports zero loss when the merge output retains everything reachable', () => {
    const existing = [mappedArtist({ name: 'A', rostrUrl: 'https://www.rostr.cc/profile/a', managerEmails: ['a@example.com'] })];
    const summary = computeLossSummary(existing, existing);
    expect(summary.artistsLost).toBe(0);
    expect(summary.emailsLost).toBe(0);
  });

  it('detects lost artists and emails when the output is missing something the existing roster had', () => {
    const existing = [mappedArtist({ name: 'A', rostrUrl: 'https://www.rostr.cc/profile/a', managerEmails: ['a@example.com'] })];
    const summary = computeLossSummary(existing, []);
    expect(summary.artistsLost).toBe(1);
    expect(summary.emailsLost).toBe(1);
    expect(summary.lostArtists.map(a => a.name)).toEqual(['A']);
    expect(summary.lostEmails).toEqual(['a@example.com']);
  });

  it('does not count an existing artist with no email as "lost"', () => {
    const existing = [mappedArtist({ name: 'Unreachable', rostrUrl: 'https://www.rostr.cc/profile/unreachable', managerEmails: [] })];
    const summary = computeLossSummary(existing, []);
    expect(summary.artistsLost).toBe(0);
  });
});

describe('CLI', () => {
  it('--dry-run prints a summary and writes nothing', () => {
    const xlsxPath = writeXlsxFixture(workDir, 'batch.xlsx', REQUIRED_COLUMNS, [
      fullRow({ name: 'New Artist', url: 'https://www.rostr.cc/artists/new-artist' }),
    ]);
    const existingPath = writeJson(workDir, 'existing.json', EMPTY_ROSTER);
    const outPath = join(workDir, 'out.json');

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, xlsxPath, '--existing', existingPath, '--out', outPath, '--dry-run'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/DRY RUN/);
    expect(result.stdout).toMatch(/artists lost: 0/);
    expect(result.stdout).toMatch(/emails lost: 0/);
    expect(existsSync(outPath)).toBe(false);
  });

  it('without --dry-run writes the merged roster to --out', () => {
    const xlsxPath = writeXlsxFixture(workDir, 'batch.xlsx', REQUIRED_COLUMNS, [
      fullRow({ name: 'New Artist', url: 'https://www.rostr.cc/artists/new-artist' }),
    ]);
    const existingPath = writeJson(workDir, 'existing.json', EMPTY_ROSTER);
    const outPath = join(workDir, 'out.json');

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, xlsxPath, '--existing', existingPath, '--out', outPath],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(written.artists.map(a => a.name)).toEqual(['New Artist']);
    expect(written.artists[0].rostrUrl).toBe('https://www.rostr.cc/profile/new-artist');
  });

  it('exits non-zero with a clear message when a file has no expected columns', () => {
    const badXlsx = writeXlsxFixture(workDir, 'bad.xlsx', ['Foo', 'Bar'], [['a', 'b']]);
    const existingPath = writeJson(workDir, 'existing.json', EMPTY_ROSTER);
    const outPath = join(workDir, 'out.json');

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, badXlsx, '--existing', existingPath, '--out', outPath],
      { encoding: 'utf-8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/none of the expected/i);
    expect(existsSync(outPath)).toBe(false);
  });

  it('imports multiple files passed as a directory argument', () => {
    const batchesDir = join(workDir, 'batches');
    mkdirSync(batchesDir);
    writeXlsxFixture(batchesDir, 'a.xlsx', REQUIRED_COLUMNS, [
      fullRow({ name: 'Artist From A', url: 'https://www.rostr.cc/artists/artist-from-a' }),
    ]);
    writeXlsxFixture(batchesDir, 'b.xlsx', REQUIRED_COLUMNS, [
      fullRow({ name: 'Artist From B', url: 'https://www.rostr.cc/artists/artist-from-b' }),
    ]);
    const existingPath = writeJson(workDir, 'existing.json', EMPTY_ROSTER);
    const outPath = join(workDir, 'out.json');

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, batchesDir, '--existing', existingPath, '--out', outPath],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    const written = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(written.artists.map(a => a.name).sort()).toEqual(['Artist From A', 'Artist From B']);
  });
});
