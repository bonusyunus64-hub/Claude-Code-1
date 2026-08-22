// Pure logic for the "one manager, several matched artists" problem: today
// dedupeByRecipient (lib/recipients.ts) collapses a manager's several pitches
// down to the single highest-`rank` one and silently drops the rest. This
// module is the shared layer a later phase uses to build a DIFFERENT email for
// that manager instead — one that names several of the artists they rep,
// rather than picking a winner. This phase only adds the pure logic + its
// tests; nothing here is wired into a send route or the dashboard yet.
//
// Client-safety constraint (see lib/recipients.ts's header comment for the
// full story): app/dashboard/page.tsx is a client component and will import
// this module directly, so nothing here may import lib/roster.ts at runtime
// — that module calls `readFileSync`/`statSync` and pulling it in would break
// the client bundle, a failure only `next build` catches, not `tsc` or vitest.
//
// Structural type over `import type { Artist }`: either would be client-safe
// (types vanish at compile time either way), but a bare `import type` would
// still tie this module's public API to roster.ts's full Artist shape — a
// dozen fields (rostrUrl, labels, publishers, avatarUrl, ...) nothing here
// reads. Defining the narrow structural type below means roster.ts's Artist
// is assignable to it for free (TypeScript structural typing — no import,
// live or type-only, needed in either direction), and this module's contract
// stays exactly as wide as what it actually touches.
export interface ArtistFitInput {
  name: string;
  genres: string[];
  spotifyFollowers: number;
  managerNames: string[];
  managerEmails: string[];
}

/**
 * How many artists a multi-artist pitch names individually before the rest
 * collapse into a "+N others" count (see buildArtistNameVars' `otherCount`).
 * 3 is the user's explicit choice, not a computed heuristic. A later phase's
 * warning banner (managersOverNamingCap) flags any manager who reps MORE than
 * this many of a campaign's matched artists, so the user can see up front
 * that a given inbox's email will read as "...and N others" and narrow their
 * filters if that's not what they want.
 */
export const NAMED_ARTIST_CAP = 3;

/**
 * How many of `selectedGenres` this artist's own genres cover — the basis for
 * ranking which matched artist(s) a shared-manager email should lead with.
 * Case-insensitive and trimmed on both sides, each selected genre counting at
 * most once (an artist with a genre listed twice doesn't get double credit).
 *
 * Note for a later phase: lib/roster.ts's buildGenreIndex normalises a genre
 * with `.toLowerCase()` only — no `.trim()` — despite the comment directly
 * above it (on normalizeCompany) claiming genre indexing uses "the same
 * trim+lowercase normalisation." That comment appears to describe intent
 * rather than the actual code. This function trims (matching what the
 * codebase's genre normalisation is DOCUMENTED to do, and the more correct
 * behaviour generally), so a genre with stray whitespace in roster.json could
 * in principle score here in a way that disagrees with which artists
 * getArtistsByGenres actually returned for a given selection. Worth a fix in
 * roster.ts, but out of scope for this phase.
 */
export function genreFitScore(artist: Pick<ArtistFitInput, 'genres'>, selectedGenres: string[]): number {
  if (!selectedGenres.length) return 0;
  const artistGenres = new Set(artist.genres.map(g => g.trim().toLowerCase()));
  let score = 0;
  for (const genre of selectedGenres) {
    if (artistGenres.has(genre.trim().toLowerCase())) score++;
  }
  return score;
}

/**
 * Sorts matched artists by fit for a shared-manager pitch: highest
 * genreFitScore first, ties broken by spotifyFollowers descending, remaining
 * ties keeping original input order. Returns a NEW array — the input is never
 * mutated, since callers (a later phase's send route, and the dashboard
 * preview) still need the original unsorted list around.
 *
 * Two degenerate cases collapse this to today's pure follower ordering, and
 * both are covered in this module's tests:
 *  - `selectedGenres` empty (an "every genre" campaign) — genreFitScore is 0
 *    for every artist, so only the follower tiebreak has any effect.
 *  - the campaign used `matchMode: 'all'` (lib/roster.ts) — every artist
 *    getArtistsByGenres returned already covers every selected genre, so
 *    genreFitScore is identical (= selectedGenres.length) for all of them,
 *    same result.
 * That's the correct behaviour, not a bug to route around: it's exactly what
 * lib/demosSend.ts does today (`rank: artist.spotifyFollowers ?? 0`), and this
 * function has to reduce to it in the cases where "fit" carries no signal.
 *
 * Relies on Array.prototype.sort being a STABLE sort (spec-guaranteed since
 * ES2019, true in every engine Node/V8 and every real browser has shipped for
 * years) for "remaining ties keep original input order" — there is no
 * explicit index tiebreak in the comparator below on purpose.
 */
export function rankArtistsForPitch<T extends ArtistFitInput>(artists: T[], selectedGenres: string[]): T[] {
  // Scores computed once up front rather than inside the comparator: the
  // comparator can run O(n log n) times over a 7k-artist roster, and
  // genreFitScore allocates a Set per call — recomputing it per comparison
  // would mean rebuilding that Set for the same artist repeatedly.
  const scored = artists.map(artist => ({ artist, score: genreFitScore(artist, selectedGenres) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.artist.spotifyFollowers ?? 0) - (a.artist.spotifyFollowers ?? 0);
  });
  return scored.map(s => s.artist);
}

export interface ManagerGroup<T extends ArtistFitInput = ArtistFitInput> {
  /** The address as it should actually be sent to — original casing/whitespace
   *  from whichever artist record contributed it first, not the lowercased key
   *  used internally to group. */
  email: string;
  /** Display name for the greeting, or '' when no artist behind this address
   *  supplied one. Left blank rather than defaulting to 'there' here — that
   *  substitution is the caller's job at render time (matches the existing
   *  `artist.managerNames[idx] || 'there'` pattern in lib/demosSend.ts), not
   *  baked into the shared data layer. */
  managerName: string;
  /** Every matched artist behind this address, in the order `artists` was
   *  passed in to groupArtistsByManagerEmail. */
  artists: T[];
}

/**
 * Groups matched artists by manager address, one entry per unique inbox.
 * Keyed on `email.trim().toLowerCase()` — deliberately BYTE-IDENTICAL to how
 * dedupeByRecipient (lib/recipients.ts) normalises an address, because the two
 * run over the same underlying data (a manager's inbox reached through several
 * different artist records) and any divergence here would split one inbox
 * that dedupeByRecipient treats as singular into two groups.
 *
 * An artist's managerNames[i] can be missing/blank even when managerEmails[i]
 * isn't (see lib/roster.ts's dedupeManagerContacts, which backfills a missing
 * name with ''), so the display name for an address is resolved as: the FIRST
 * non-blank name encountered while walking `artists` in the order given. Pass
 * this function rankArtistsForPitch's output (not a raw unsorted list) and
 * that "first encountered" is exactly "attached to the highest-ranked artist
 * for that address" — the preference the brief for this asks for. Once a
 * group has a non-blank name, a later (lower-ranked) artist's name for the
 * same address never overrides it; if no artist behind an address supplies
 * one at all, managerName stays '' rather than this function inventing a
 * default.
 *
 * Preserves first-seen insertion order of addresses.
 */
export function groupArtistsByManagerEmail<T extends ArtistFitInput>(artists: T[]): ManagerGroup<T>[] {
  const order: string[] = [];
  const groups = new Map<string, ManagerGroup<T>>();

  for (const artist of artists) {
    artist.managerEmails.forEach((rawEmail, i) => {
      const key = rawEmail.trim().toLowerCase();
      if (!key) return;
      const name = (artist.managerNames[i] ?? '').trim();

      let group = groups.get(key);
      if (!group) {
        group = { email: rawEmail, managerName: name, artists: [] };
        groups.set(key, group);
        order.push(key);
      } else if (!group.managerName && name) {
        group.managerName = name;
      }
      group.artists.push(artist);
    });
  }

  return order.map(key => groups.get(key)!);
}

export interface ArtistNameVars<T extends ArtistFitInput = ArtistFitInput> {
  /** The lead (first, i.e. highest-ranked) artist itself — not just its name —
   *  so a caller can still fill single-artist template vars ({{artistName}},
   *  {{managementCompany}}, {{pronoun}}, ...) from it without re-deriving "who
   *  leads this group" a second time. This is the one field here that is NOT
   *  a template-ready string; the caller reads whatever fields it needs off it. */
  leadArtist: T;
  /** "A", "A and B", or "A, B and C" — the first `cap` names as English prose,
   *  no Oxford comma. Ready to render straight into {{artistNames}}. */
  artistNames: string;
  /** Total number of artists behind this address, stringified — {{artistCount}}
   *  renders straight into copy, so this has to already be a string. */
  artistCount: string;
  /** artistCount minus however many names actually made it into artistNames —
   *  '0' (not '') when nothing was truncated. {{otherCount}} renders straight
   *  into copy the same way. */
  otherCount: string;
  /** Every artist's name, uncapped, same prose formatting as artistNames — for
   *  a caller/template that wants the unabridged list rather than the capped one. */
  allArtistNames: string;
  /**
   * The overflow-aware, copy-ready name list: `artistNames` when nothing was
   * truncated, or the capped names plus a trailing "and N other(s)" when there
   * was. This exists because `renderTemplate` (lib/emailTemplate.ts) is a dumb
   * `{{var}}` substitution with no conditionals — it can't itself say "and 4
   * others" only when there ARE 4 others and stay silent otherwise. That
   * branch has to be resolved here, in the data, once, rather than left to a
   * template that has no way to express it. See DEFAULT_MULTI_ARTIST_TEMPLATE
   * (app/dashboard/constants.ts) for the default copy this is built for.
   * Singular "1 other" / plural "N others" — an unconditional "others" is
   * exactly the kind of tell that makes a pitch read as machine-generated.
   */
  artistSummary: string;
}

// "A" / "A and B" / "A, B and C" / "A, B, C and D" — no Oxford comma, matching
// plain English cold-outreach prose rather than a technical list. The name
// before "and" is always just the last element; every other name is
// comma-joined ahead of it, regardless of how many there are.
function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// The overflow-aware sibling of formatNameList — see ArtistNameVars.artistSummary
// for why this exists at all. Below/at cap: identical to formatNameList(names)
// (nothing to summarize). Over cap: the named artists are comma-joined WITHOUT
// "and" between the last two (unlike formatNameList) because "and" is instead
// reserved for introducing the overflow count — "Nori, Cayo, Rence and 4
// others", not "Nori, Cayo and Rence and 4 others".
function formatNameSummary(names: string[], cap: number): string {
  if (names.length <= cap) return formatNameList(names);
  const named = names.slice(0, cap);
  const otherCount = names.length - cap;
  const otherWord = otherCount === 1 ? 'other' : 'others';
  return `${named.join(', ')} and ${otherCount} ${otherWord}`;
}

/**
 * Builds the template variables for a multi-artist email, given an
 * ALREADY-RANKED artist list (rankArtistsForPitch's output) for one manager
 * address — i.e. one ManagerGroup.artists. Assumes `rankedArtists` is
 * non-empty: groupArtistsByManagerEmail never produces a group with no
 * artists, so there's no empty-group case for a caller to hit in practice.
 */
export function buildArtistNameVars<T extends ArtistFitInput>(
  rankedArtists: T[],
  cap: number = NAMED_ARTIST_CAP
): ArtistNameVars<T> {
  const names = rankedArtists.map(a => a.name);
  const namedCount = Math.min(cap, names.length);
  return {
    leadArtist: rankedArtists[0],
    artistNames: formatNameList(names.slice(0, namedCount)),
    artistCount: String(rankedArtists.length),
    otherCount: String(rankedArtists.length - namedCount),
    allArtistNames: formatNameList(names),
    artistSummary: formatNameSummary(names, cap),
  };
}

/**
 * Which manager groups rep MORE than `cap` matched artists, sorted by artist
 * count descending — drives a later phase's warning banner ("3 managers rep
 * more than 3 of your matched artists"), so the user can narrow their filters
 * before sending rather than discover it after. Deliberately strictly
 * greater-than: a group holding EXACTLY `cap` artists names every one of them
 * in buildArtistNameVars (otherCount is '0'), so there's nothing truncated to
 * warn about.
 */
export function managersOverNamingCap<T extends ArtistFitInput>(
  groups: ManagerGroup<T>[],
  cap: number = NAMED_ARTIST_CAP
): ManagerGroup<T>[] {
  return groups
    .filter(g => g.artists.length > cap)
    .sort((a, b) => b.artists.length - a.artists.length);
}
