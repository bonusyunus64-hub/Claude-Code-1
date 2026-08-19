import { readFileSync } from 'fs';
import { join } from 'path';

export interface RadioStation {
  name: string;
  region: string;
  genres: string[];
  emails: string[];
  /**
   * Subset of `emails` that are newsroom/news-desk addresses (news@, newsroom@,
   * a station's *.news@ variant, etc.) rather than a music-programming contact —
   * see the classification regex in filterRadioStations. Deliberately a sibling
   * field rather than changing `emails` to a richer shape: a station can have a
   * mix (see ABC RN, ABC 612 Brisbane, both of which keep a non-news address
   * alongside a news one), so the marker has to work per-address, not
   * per-station — but every existing reader of `emails: string[]` (the UI list
   * that renders each address, the sender that mails each one, the mx-check
   * validator, etc.) keeps working unchanged since `emails` itself never
   * changes shape or content. Omitted entirely on the ~121 stations with no
   * newsroom address, so most of the file has zero diff.
   */
  newsroomEmails?: string[];
  phone?: string;
}

interface RadioData {
  stations: RadioStation[];
}

let cached: RadioData | null = null;

export function getRadioData(): RadioData {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(join(process.cwd(), 'data', 'radio.json'), 'utf-8'));
  return cached!;
}

/**
 * @param excludeNewsroom When true, drops each station's newsroom-only addresses
 * (see RadioStation.newsroomEmails) from its `emails` before matching, and drops
 * the station entirely if that empties its address list — i.e. a station whose
 * *only* contact is a news desk disappears from the results, since there's no one
 * else there to pitch music to. Stations with a mix of news and non-news
 * addresses are kept, minus just the news ones. Default false: shipping this
 * toggle on by default would silently remove ~32 of 155 stations (nearly every
 * major Australian broadcaster — Triple J, SBS Radio, 3AW, every Nova/Triple M,
 * all ABC locals) from every existing saved filter and campaign, so it's opt-in.
 */
export function filterRadioStations(genres: string[], locations: string[], matchMode: 'any' | 'all' = 'any', excludeNewsroom = false): RadioStation[] {
  const { stations } = getRadioData();
  const lowerGenres = genres.map(g => g.toLowerCase());
  return stations
    .filter(s => {
      if (genres.length) {
        const check = matchMode === 'all'
          ? lowerGenres.every(g => s.genres.some(sg => sg.toLowerCase() === g))
          : s.genres.some(g => lowerGenres.includes(g.toLowerCase()));
        if (!check) return false;
      }
      if (locations.length) {
        const isIntl = locations.includes('International');
        const matchesRegion = locations.some(l => l !== 'International' && s.region === l);
        const matchesIntl = isIntl && s.region.startsWith('International');
        if (!matchesRegion && !matchesIntl) return false;
      }
      return true;
    })
    .map(s => {
      if (!excludeNewsroom || !s.newsroomEmails?.length) return s;
      const newsSet = new Set(s.newsroomEmails);
      return { ...s, emails: s.emails.filter(e => !newsSet.has(e)) };
    })
    .filter(s => s.emails.length > 0);
}

/**
 * How many of the stations matching `genres`/`locations`/`matchMode` have *only*
 * newsroom addresses, and would therefore disappear entirely if the "exclude
 * newsroom addresses" toggle were switched on for this same filter. Computed
 * independent of any excludeNewsroom value the caller already has, so the UI can
 * show the toggle's impact before the operator turns it on rather than after.
 */
export function countNewsroomExcludedStations(genres: string[], locations: string[], matchMode: 'any' | 'all' = 'any'): number {
  const withNewsroom = filterRadioStations(genres, locations, matchMode, false).length;
  const withoutNewsroom = filterRadioStations(genres, locations, matchMode, true).length;
  return withNewsroom - withoutNewsroom;
}

export function getAllRadioGenres(): string[] {
  const { stations } = getRadioData();
  const set = new Set<string>();
  stations.forEach(s => s.genres.forEach(g => set.add(g)));
  return Array.from(set).sort();
}

// The curated order the radio location picker has always shown domestic options
// in — National pinned first, then the states/territories alphabetically. Not
// derived by sorting: plain string sort puts "National" between "NSW" and "NT"
// (uppercase letters sort before lowercase in JS's default comparator, so
// "National"[1]='a' loses to "NSW"[1]='S'), which is exactly the scattered,
// unintentional-looking order this function exists to avoid. Any domestic
// region not in this list (future data) is appended alphabetically after it
// rather than dropped.
const DOMESTIC_REGION_ORDER = ['National', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

/**
 * All region filter options, domestic regions first (in DOMESTIC_REGION_ORDER),
 * then International options grouped at the end: the generic "International"
 * (which matches every international station, country-tagged or not — see
 * filterRadioStations' `startsWith('International')` check) followed by the
 * country-specific ones ("International (Euro)", "International (Netherlands)",
 * etc.) alphabetically. Only 38 of 116 international stations carry a country
 * suffix in `region`; the rest are plain "International" with no country
 * recorded, and stay reachable only via the generic option — no country is
 * invented for them.
 *
 * Previously this collapsed every "International*" region into one bucket,
 * which is why the generic option had to keep matching all of them: narrowing
 * it now to only plain-"International" stations would have silently shrunk
 * every saved filter that already selected "International" expecting the full
 * set.
 */
export function getAllRadioRegions(): string[] {
  const { stations } = getRadioData();
  const domestic = new Set<string>();
  const international = new Set<string>();
  stations.forEach(s => {
    if (s.region.startsWith('International')) {
      international.add(s.region);
    } else {
      domestic.add(s.region);
    }
  });
  const domesticSorted = [
    ...DOMESTIC_REGION_ORDER.filter(r => domestic.has(r)),
    ...Array.from(domestic).filter(r => !DOMESTIC_REGION_ORDER.includes(r)).sort(),
  ];
  const internationalSorted = Array.from(international).sort((a, b) => {
    if (a === 'International') return -1;
    if (b === 'International') return 1;
    return a.localeCompare(b);
  });
  return [...domesticSorted, ...internationalSorted];
}
