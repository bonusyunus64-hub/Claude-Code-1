import { readFileSync, statSync } from 'fs';
import { join } from 'path';

export interface Artist {
  name: string;
  rostrUrl: string;
  genres: string[];
  type: string;
  gender: string;
  spotifyFollowers: number;
  instagramFollowers: number;
  youtubeSubscribers: number;
  managementCompany: string;
  agencies: string;
  labels: string;
  publishers: string;
  managerNames: string[];
  managerEmails: string[];
  instagramHandle: string;
  avatarUrl: string;
}

interface RosterData {
  artists: Artist[];
  genres: string[];
  /** Stamped by scripts/parse-roster.mjs (and carried forward by strip-roster.mjs)
   *  as of the version of this file that added roster-freshness reporting to the
   *  Overview tab. Absent on roster.json snapshots written before that — see
   *  IndexedRoster.resolvedGeneratedAt for the fallback. */
  generatedAt?: string;
}

interface IndexedRoster extends RosterData {
  /** Lowercased genre -> ascending artist indices, built once so a genre filter
   *  is a lookup instead of a full scan over every artist on every request. */
  genreIndex: Map<string, number[]>;
  /** Normalised (trim + lowercase) managementCompany -> how many roster artists
   *  list that company, built once alongside genreIndex for the same reason —
   *  see buildCompanySizeIndex. Artists with no managementCompany listed (25 as
   *  of the 2026-08-08 roster) are never added to this index, so a lookup for
   *  '' correctly finds nothing rather than one bucket the size of "no company." */
  companySizeIndex: Map<string, number>;
  /** Lowercased manager email -> that address's roster "tier" (representative
   *  Spotify follower count + management-company size), built once alongside
   *  genreIndex/companySizeIndex — see buildEmailTierIndex and getEmailTiers. */
  tierIndex: Map<string, EmailTierInfo>;
  /** `generatedAt` if the file has it, else the file's own filesystem mtime as of
   *  the one time this module reads it. Resolved once here (not in a per-call
   *  getter) so a roster.json predating `generatedAt` doesn't cost a stat() on
   *  every request — see the module-level `cached` comment below. */
  resolvedGeneratedAt: string;
}

/** Same trim+lowercase normalisation as normalizeGenre, applied to
 *  managementCompany so "Red Light Management" and "red light management " (a
 *  trailing-space data slip) count as the same company instead of splitting
 *  into two buckets that each look small enough to pass a "<=N artists" filter. */
function normalizeCompany(company: string): string {
  return company.trim().toLowerCase();
}

/** Trim+lowercase normalisation for genre strings, used both when building
 *  genreIndex (buildGenreIndex) and when querying it (getArtistsByGenres) —
 *  so a stray leading/trailing space in a roster genre (e.g. "Pop ") doesn't
 *  index it under a key no normal query can ever match. */
function normalizeGenre(genre: string): string {
  return genre.trim().toLowerCase();
}

/**
 * Consumer/freemail email providers. This is the same six domains the
 * "163 artists have a manager on a consumer/freemail domain" figure in the
 * project brief was measured against (2026-08-08 roster) — kept as an exact,
 * explicit list rather than a heuristic (e.g. "no MX-like second word") so the
 * filter's behavior matches that measurement instead of silently drifting.
 */
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com',
]);

function hasFreemailManager(artist: Artist): boolean {
  return artist.managerEmails.some(email => {
    const domain = email.split('@')[1]?.trim().toLowerCase();
    return !!domain && FREEMAIL_DOMAINS.has(domain);
  });
}

let cached: IndexedRoster | null = null;

/**
 * Some roster records list the same manager email twice for one artist (a data
 * entry slip, not two distinct managers) — left as-is, that duplicate flows all
 * the way to a React list keyed by email and collides. Drop it here, once, at
 * load time, keeping managerNames in sync by index rather than filtering the
 * arrays independently.
 */
function dedupeManagerContacts(artist: Artist): Artist {
  const seen = new Set<string>();
  const managerEmails: string[] = [];
  const managerNames: string[] = [];
  artist.managerEmails.forEach((email, i) => {
    const key = email.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    managerEmails.push(email);
    managerNames.push(artist.managerNames[i] ?? '');
  });
  return managerEmails.length === artist.managerEmails.length ? artist : { ...artist, managerEmails, managerNames };
}

function buildGenreIndex(artists: Artist[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  artists.forEach((artist, i) => {
    artist.genres.forEach(genre => {
      const key = normalizeGenre(genre);
      const indices = index.get(key);
      if (indices) indices.push(i); else index.set(key, [i]);
    });
  });
  return index;
}

/**
 * How many roster artists each management company represents — the signal
 * behind the "management company size" reachability filter (see
 * getArtistsByGenres' maxCompanySize option). A company with one or two
 * artists on the whole roster is realistically a person or a tiny team, so a
 * cold pitch has a real chance of reaching someone who can act on it; a
 * company with hundreds of artists means the inbox is a filtered/triaged
 * mailbox at a major agency, which is a fundamentally different — and much
 * less replyable — kind of address.
 *
 * Deliberately skips artists with no managementCompany listed (25 as of the
 * 2026-08-08 roster): there's no company to count them against, and counting
 * them all into one '' bucket would make every one of them look like they
 * belong to a single company with 25 artists, which is not what's true.
 */
function buildCompanySizeIndex(artists: Artist[]): Map<string, number> {
  const index = new Map<string, number>();
  artists.forEach(artist => {
    const key = normalizeCompany(artist.managementCompany);
    if (!key) return;
    index.set(key, (index.get(key) ?? 0) + 1);
  });
  return index;
}

/**
 * A manager email's roster "tier" — the signal the Overview tab's "who
 * actually replies" segmentation (app/dashboard/utils.ts's computeAnalyticsStats)
 * joins a campaign's sent addresses against. See buildEmailTierIndex for how
 * the two numbers are derived, and getEmailTiers for the lookup itself.
 */
export interface EmailTierInfo {
  /** Representative Spotify follower count for this manager address — the
   *  MAX across every roster artist it represents (see buildEmailTierIndex). */
  maxSpotifyFollowers: number;
  /** Roster-wide size of this manager's management company (buildCompanySizeIndex),
   *  taken the same max-across-artists way. 0 is a sentinel for "no
   *  managementCompany was listed for any artist this address represents" —
   *  every genuine company size is >= 1, so a real lookup can never collide
   *  with it (see the inline comment in buildEmailTierIndex). */
  companySize: number;
  /** How many distinct roster artists list this exact manager email — purely
   *  informational (not used by any bucketing), explains why the two numbers
   *  above might read as "for more than one artist." */
  artistCount: number;
}

/**
 * Lowercased manager email -> EmailTierInfo, built once alongside genreIndex/
 * companySizeIndex for the same reason (a per-request scan over 7k+ artists
 * would be wasteful — this gets looked up once per unique address on every
 * campaign a "reply rate by who was contacted" analytics pass runs over).
 *
 * A manager email can represent more than one artist (one inbox, several
 * managerEmails entries pointing at it across different artist records). When
 * that happens, this index keeps the MAX Spotify follower count — and the MAX
 * company size, for the same reason — across every artist that address
 * represents, not the min or an average. The question this index exists to
 * answer is "is this a reachable inbox, or a triaged one at a major," and a
 * manager who reps one 20K-follower baby act alongside one 8M-follower
 * headliner is, for a cold pitch's purposes, the second kind of inbox — an
 * assistant screening it triages around whoever has the most on the line.
 * Taking the min or an average would misclassify that address as reachable
 * and understate exactly the "reply rate collapses as size goes up" signal
 * this index exists to help measure.
 */
function buildEmailTierIndex(artists: Artist[], companySizeIndex: Map<string, number>): Map<string, EmailTierInfo> {
  const index = new Map<string, EmailTierInfo>();
  artists.forEach(artist => {
    const companyKey = normalizeCompany(artist.managementCompany);
    // 0 = "no managementCompany listed on this artist record" — see
    // EmailTierInfo.companySize for why 0 is a safe sentinel here.
    const companySize = companyKey ? companySizeIndex.get(companyKey) ?? 0 : 0;
    const followers = artist.spotifyFollowers ?? 0;
    artist.managerEmails.forEach(rawEmail => {
      const email = rawEmail.trim().toLowerCase();
      if (!email) return;
      const existing = index.get(email);
      if (!existing) {
        index.set(email, { maxSpotifyFollowers: followers, companySize, artistCount: 1 });
        return;
      }
      existing.maxSpotifyFollowers = Math.max(existing.maxSpotifyFollowers, followers);
      existing.companySize = Math.max(existing.companySize, companySize);
      existing.artistCount += 1;
    });
  });
  return index;
}

function getIndexedRoster(): IndexedRoster {
  if (cached) return cached;
  const filePath = join(process.cwd(), 'data', 'roster.json');
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw) as RosterData;
  const artists = data.artists.map(dedupeManagerContacts);
  // Fallback for roster.json files written before generatedAt existed: the
  // file's mtime is a reasonable stand-in for "when the roster was last
  // regenerated," since both parse-roster.mjs and strip-roster.mjs rewrite the
  // file wholesale (via writeFileSync) rather than patching it in place.
  const resolvedGeneratedAt = data.generatedAt ?? statSync(filePath).mtime.toISOString();
  const companySizeIndex = buildCompanySizeIndex(artists);
  cached = {
    ...data, artists, genreIndex: buildGenreIndex(artists), companySizeIndex,
    tierIndex: buildEmailTierIndex(artists, companySizeIndex),
    resolvedGeneratedAt,
  };
  return cached;
}

export function getRoster(): RosterData {
  return getIndexedRoster();
}

/** ISO timestamp for when the current roster.json snapshot was generated — see
 *  IndexedRoster.resolvedGeneratedAt for how it's derived. Cached alongside the
 *  rest of the indexed roster, so this is a free read after the first call. */
export function getRosterGeneratedAt(): string {
  return getIndexedRoster().resolvedGeneratedAt;
}

export function getTopGenres(limit = 20): string[] {
  const { artists } = getRoster();
  // Keyed by normalizeGenre(g) so "Pop" and "Pop " (a trailing-space data
  // slip) count into one bucket instead of splitting into two that could
  // each fall out of the top-N on their own. The display value is the
  // trimmed raw (not lowercased) form of whichever spelling was seen first —
  // unambiguous today, since data/roster.json has 636 distinct genre strings
  // and zero trim+lowercase collisions (measured 2026-09-02) — so the returned
  // strings stay title-cased like "Pop", not "pop".
  const counts = new Map<string, { display: string; count: number }>();
  artists.forEach(a => a.genres.forEach(g => {
    const key = normalizeGenre(g);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { display: g.trim(), count: 1 });
  }));
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .slice(0, limit)
    .map(({ display }) => display);
}

/** Candidate artist indices for the selected genres, in ascending (original roster) order. */
function candidateIndices(genreIndex: Map<string, number[]>, lowerGenres: string[], matchMode: 'any' | 'all'): number[] {
  if (matchMode === 'all') {
    const lists = lowerGenres.map(g => genreIndex.get(g) ?? []);
    if (lists.some(list => list.length === 0)) return [];
    let common = new Set(lists[0]);
    for (let i = 1; i < lists.length; i++) {
      const next = lists[i];
      const nextSet = new Set(next);
      common = new Set([...common].filter(idx => nextSet.has(idx)));
      if (common.size === 0) break;
    }
    return Array.from(common).sort((a, b) => a - b);
  }
  const union = new Set<number>();
  lowerGenres.forEach(g => (genreIndex.get(g) ?? []).forEach(idx => union.add(idx)));
  return Array.from(union).sort((a, b) => a - b);
}

export interface ArtistFilterOptions {
  /** Empty/omitted = no genre constraint at all (matches every artist, subject
   *  to the other filters below) — see the comment inside getArtistsByGenres
   *  for why that's a deliberate choice rather than "match nothing," and
   *  lib/demosSend.ts / app/api/preview/route.ts for how callers guard an
   *  unfiltered send before it can go out by accident. */
  genres?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  gender?: string;
  artistType?: string;
  minInstagram?: number;
  maxInstagram?: number;
  matchMode?: 'any' | 'all';
  /** Only artists whose managementCompany represents at most this many artists
   *  on the whole roster (see buildCompanySizeIndex). 0/omitted = off. An
   *  artist with no managementCompany listed can never satisfy this — there's
   *  no company size to check — so it's excluded whenever this is active. */
  maxCompanySize?: number;
  /** Only artists with at least one manager email on a consumer/freemail
   *  domain (gmail/yahoo/hotmail/outlook/icloud/protonmail — see
   *  FREEMAIL_DOMAINS). Default false = off. */
  freemailOnly?: boolean;
}

export function getArtistsByGenres(options: ArtistFilterOptions = {}): Artist[] {
  const {
    genres = [], minFollowers = 0, maxFollowers = 0, gender = '', artistType = '',
    minInstagram = 0, maxInstagram = 0, matchMode = 'any', maxCompanySize = 0, freemailOnly = false,
  } = options;
  const { artists, genreIndex, companySizeIndex } = getIndexedRoster();

  // An empty genre selection used to mean "match nothing" — but 3,010 artists
  // (41.6% of the roster) have genres: [] entirely (a gap in the rostr.cc data,
  // not a parsing bug — see scripts/ROSTER_CONTEXT.md), and 1,261 manager
  // inboxes are reachable ONLY through one of those genre-less artists. So an
  // empty selection now means "no genre constraint," not "no results" — every
  // artist is a candidate, and the other filters below still apply normally.
  // This inverts the old empty-state meaning, which is exactly why every
  // caller that can reach here with an empty selection (lib/demosSend.ts,
  // app/api/preview/route.ts) requires its own explicit opt-in before it will
  // actually pass an empty array through, rather than defaulting to it.
  const indices = genres.length
    ? candidateIndices(genreIndex, genres.map(normalizeGenre), matchMode)
    : artists.map((_, i) => i);

  const result: Artist[] = [];
  for (const idx of indices) {
    const a = artists[idx];
    if (!a.managerEmails.length) continue;
    const spotify = a.spotifyFollowers ?? 0;
    if (minFollowers > 0 && spotify < minFollowers) continue;
    if (maxFollowers > 0 && spotify > maxFollowers) continue;
    if (gender && a.gender !== gender) continue;
    if (artistType && a.type !== artistType) continue;
    const instagram = a.instagramFollowers ?? 0;
    if (minInstagram > 0 && instagram < minInstagram) continue;
    if (maxInstagram > 0 && instagram > maxInstagram) continue;

    // Company size and freemail-domain are ORed with each other (when both are
    // active) rather than ANDed like every other pair of filters here. They're
    // two independent signals for the same underlying question — "is this a
    // small, personally-reachable operation?" — and ANDing them would only
    // match an artist whose company is simultaneously small AND whose manager
    // also happens to use a personal email address, a needlessly narrow
    // combination nobody asking for "reachable contacts" actually means.
    // Each still ANDs normally with genre/followers/gender/etc. above.
    if (maxCompanySize > 0 || freemailOnly) {
      // No managementCompany listed -> Infinity, so it can never read as "small"
      // (see buildCompanySizeIndex for why those 25 artists aren't indexed at all).
      const companyKey = normalizeCompany(a.managementCompany);
      const companySize = companyKey ? companySizeIndex.get(companyKey) ?? 0 : Infinity;
      const smallCompany = maxCompanySize > 0 && companySize <= maxCompanySize;
      const freemail = freemailOnly && hasFreemailManager(a);
      const wantsEither = maxCompanySize > 0 && freemailOnly;
      const passesReachability = wantsEither ? (smallCompany || freemail) : (maxCompanySize > 0 ? smallCompany : freemail);
      if (!passesReachability) continue;
    }

    result.push(a);
  }
  return result;
}

/**
 * Looks up the roster tier for a list of manager email addresses (case/
 * whitespace-insensitive), for the "reply rate by who was contacted" join in
 * app/dashboard/utils.ts's computeAnalyticsStats. Deliberately retroactive
 * and analysis-time only: it reads whatever the roster currently says about
 * each address, not what it said when a given campaign was actually sent
 * (see the design note on that function for why that trade — a small amount
 * of drift against the roster's periodic refreshes — is worth it: it means
 * every campaign ever sent gets an answer today, not just ones sent after
 * this existed).
 *
 * An address with no roster entry (a hand-added custom contact, a manager who
 * left the roster since) maps to `null`, not to a zero-follower tier or to
 * being silently absent from the returned Map — the caller (and, from there,
 * the UI) has to be able to tell "unknown" apart from "known and tiny."
 */
export function getEmailTiers(emails: string[]): Map<string, EmailTierInfo | null> {
  const { tierIndex } = getIndexedRoster();
  const result = new Map<string, EmailTierInfo | null>();
  emails.forEach(rawEmail => {
    const email = rawEmail.trim().toLowerCase();
    if (result.has(email)) return;
    result.set(email, tierIndex.get(email) ?? null);
  });
  return result;
}

export function searchArtistsByName(query: string, limit = 20): Artist[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { artists } = getRoster();
  return artists.filter(a => a.managerEmails.length > 0 && a.name.toLowerCase().includes(q)).slice(0, limit);
}
