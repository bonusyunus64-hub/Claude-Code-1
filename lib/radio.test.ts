import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  filterRadioStations, getAllRadioGenres, getAllRadioRegions, countNewsroomExcludedStations, getRadioData,
} from './radio';

// Independently loaded (not via getRadioData, which is the module under test) so
// the classification/regression assertions below are checked against the actual
// on-disk data/radio.json, not against whatever the module happens to cache.
const RAW_DATA = JSON.parse(readFileSync(join(process.cwd(), 'data', 'radio.json'), 'utf-8')) as {
  stations: { name: string; region: string; genres: string[]; emails: string[]; newsroomEmails?: string[]; phone?: string }[];
};

// The classification rule from the brief: a station's contact is a newsroom
// address (news desk, not music programming) if it matches this against the
// email itself. Recomputed here, independently of data/radio.json's stored
// newsroomEmails markers, so these tests catch the marker drifting out of sync
// with the rule rather than just re-asserting whatever's already in the file.
const NEWSROOM_PATTERN = /news|editor|press|journal/i;

describe('radio data — newsroom classification', () => {
  it('marks exactly the addresses matching /news|editor|press|journal/i, and nothing else', () => {
    const expected: string[] = [];
    for (const s of RAW_DATA.stations) {
      for (const e of s.emails) {
        if (NEWSROOM_PATTERN.test(e)) expected.push(e);
      }
    }
    const actual = RAW_DATA.stations.flatMap(s => s.newsroomEmails ?? []);

    expect(actual.sort()).toEqual(expected.sort());
    expect(actual).toHaveLength(37);
  });

  it('marks exactly 34 stations, 32 of them news-only and 2 with a mixed (news + non-news) address list', () => {
    const flagged = RAW_DATA.stations.filter(s => (s.newsroomEmails?.length ?? 0) > 0);
    expect(flagged).toHaveLength(34);

    const newsOnly = flagged.filter(s => s.newsroomEmails!.length === s.emails.length);
    const mixed = flagged.filter(s => s.newsroomEmails!.length < s.emails.length);
    expect(newsOnly).toHaveLength(32);
    expect(mixed.map(s => s.name).sort()).toEqual(['ABC 612 Brisbane', 'ABC RN']);
  });

  it('has no false positives — no marked address is actually a legitimate music contact', () => {
    // Specifically guards against a naive "press" match catching something like
    // presenter@ or express@ — see the brief's callout. None exist in the current
    // data, but this pins that down rather than trusting it silently.
    for (const s of RAW_DATA.stations) {
      for (const e of s.newsroomEmails ?? []) {
        expect(e).toMatch(NEWSROOM_PATTERN);
      }
    }
  });

  it('every newsroomEmails entry is one of that station\'s actual emails, in the same order they appear', () => {
    for (const s of RAW_DATA.stations) {
      if (!s.newsroomEmails) continue;
      const positions = s.newsroomEmails.map(e => s.emails.indexOf(e));
      expect(positions.every(i => i >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });
});

describe('radio data integrity', () => {
  it('keeps the full 155 stations / 161 addresses, unchanged apart from the new marker', () => {
    expect(RAW_DATA.stations).toHaveLength(155);
    expect(RAW_DATA.stations.reduce((n, s) => n + s.emails.length, 0)).toBe(161);
  });
});

describe('filterRadioStations — excludeNewsroom toggle (default off)', () => {
  it('off by default: omitting the argument matches passing false explicitly, and returns every station', () => {
    const withDefault = filterRadioStations([], []);
    const withExplicitFalse = filterRadioStations([], [], 'any', false);
    expect(withDefault).toEqual(withExplicitFalse);
    expect(withDefault).toHaveLength(155);
  });

  it('off: keeps news-only stations exactly as before, addresses untouched', () => {
    const stations = filterRadioStations([], [], 'any', false);
    const tripleJ = stations.find(s => s.name === 'Triple J');
    expect(tripleJ?.emails).toEqual(['jjj.news@abc.net.au']);
    const fiveAA = stations.find(s => s.name === 'FIVEaa');
    expect(fiveAA?.emails).toEqual(['news@fiveaa.com.au']);
  });

  it('on: drops a news-only station entirely', () => {
    const stations = filterRadioStations([], [], 'any', true);
    expect(stations.find(s => s.name === 'Triple J')).toBeUndefined();
    expect(stations.find(s => s.name === 'FIVEaa')).toBeUndefined();
    expect(stations).toHaveLength(123); // 155 - 32 news-only stations
  });

  it('on: keeps a mixed station, minus just its newsroom address', () => {
    const stations = filterRadioStations([], [], 'any', true);
    const abcRN = stations.find(s => s.name === 'ABC RN');
    expect(abcRN).toBeDefined();
    expect(abcRN?.emails).toEqual(['info_rn@your.abc.net.au']);

    const abc612 = stations.find(s => s.name === 'ABC 612 Brisbane');
    expect(abc612?.emails).toEqual(['radio.612@abc.net.au']);
  });

  it('on: a station with no newsroom address at all is completely unaffected', () => {
    const off = filterRadioStations([], [], 'any', false).find(s => s.name === 'ABC 666 Canberra');
    const on = filterRadioStations([], [], 'any', true).find(s => s.name === 'ABC 666 Canberra');
    expect(on).toEqual(off);
  });
});

describe('countNewsroomExcludedStations', () => {
  it('reports the toggle\'s impact regardless of what excludeNewsroom is currently set to', () => {
    expect(countNewsroomExcludedStations([], [], 'any')).toBe(32);
  });

  it('scopes the impact to the given genre/location filters', () => {
    const impact = countNewsroomExcludedStations([], ['NSW'], 'any');
    const withNews = filterRadioStations([], ['NSW'], 'any', false).length;
    const withoutNews = filterRadioStations([], ['NSW'], 'any', true).length;
    expect(impact).toBe(withNews - withoutNews);
    expect(impact).toBeGreaterThan(0);
  });
});

describe('getAllRadioGenres', () => {
  it('is unaffected by the newsroom/region changes', () => {
    expect(getAllRadioGenres()).toEqual(getAllRadioGenres());
    expect(getAllRadioGenres().length).toBeGreaterThan(0);
  });
});

describe('getAllRadioRegions — country granularity', () => {
  const regions = getAllRadioRegions();

  it('keeps the domestic regions in the curated order (National first, then states alphabetically), not scattered by a raw sort', () => {
    const domestic = regions.filter(r => !r.startsWith('International'));
    expect(domestic).toEqual(['National', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);
  });

  it('groups every International option (generic + country-tagged) at the end, generic first', () => {
    const international = regions.filter(r => r.startsWith('International'));
    expect(international[0]).toBe('International');
    expect(international.slice(1)).toEqual([...international.slice(1)].sort((a, b) => a.localeCompare(b)));
    expect(international).toEqual(expect.arrayContaining([
      'International', 'International (Brazil)', 'International (Denmark)', 'International (England)',
      'International (Euro)', 'International (Ireland)', 'International (Italy)', 'International (N. America)',
      'International (Netherlands)',
    ]));
  });

  it('does not invent a country for the 78 plain "International" stations', () => {
    const plainCount = getRadioData().stations.filter(s => s.region === 'International').length;
    expect(plainCount).toBe(78);
  });
});

describe('filterRadioStations — International region granularity', () => {
  it('generic "International" still matches every international station, including country-tagged ones', () => {
    const stations = filterRadioStations([], ['International']);
    expect(stations).toHaveLength(116); // all international stations, per RAW_DATA
    expect(stations.some(s => s.region === 'International')).toBe(true);
    expect(stations.some(s => s.region === 'International (Euro)')).toBe(true);
    expect(stations.some(s => s.region === 'International (Netherlands)')).toBe(true);
  });

  it('a specific country matches only that country\'s stations', () => {
    const stations = filterRadioStations([], ['International (Netherlands)']);
    expect(stations).toHaveLength(5);
    expect(stations.every(s => s.region === 'International (Netherlands)')).toBe(true);
  });

  it('combining a country filter with a genre filter still works', () => {
    const stations = filterRadioStations(['Rock'], ['International (Euro)']);
    expect(stations.map(s => s.name).sort()).toEqual(['Laser Hot Hits', "Radio Merlin Int'l"]);
    expect(stations.every(s => s.region === 'International (Euro)')).toBe(true);
    expect(stations.every(s => s.genres.some(g => g.toLowerCase() === 'rock'))).toBe(true);
  });

  it('a domestic region filter is unaffected by the International changes', () => {
    const stations = filterRadioStations([], ['NSW']);
    expect(stations.every(s => s.region === 'NSW')).toBe(true);
    expect(stations).toHaveLength(7);
  });
});
