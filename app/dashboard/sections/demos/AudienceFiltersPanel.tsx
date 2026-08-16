import { REACHABILITY_MAX_COMPANY_SIZE } from '../../hooks/useDemosFlow';

const FOLLOWER_STEPS = [
  { label: 'Any', value: 0 },
  { label: '100K', value: 100_000 },
  { label: '250K', value: 250_000 },
  { label: '500K', value: 500_000 },
  { label: '1M', value: 1_000_000 },
  { label: '2M', value: 2_000_000 },
  { label: '3M', value: 3_000_000 },
  { label: '5M', value: 5_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '50M', value: 50_000_000 },
];

const GENDER_OPTIONS = [
  { label: 'Any', value: '' },
  { label: 'Male', value: 'MALE' },
  { label: 'Female', value: 'FEMALE' },
];

const ARTIST_TYPE_OPTIONS = [
  { label: 'Any', value: '' },
  { label: 'Solo', value: 'Person' },
  { label: 'Group', value: 'Group' },
];

export interface AudienceFiltersPanelProps {
  minAudience: number;
  setMinAudience: (value: number) => void;
  maxAudience: number;
  setMaxAudience: (value: number) => void;
  showInstagram: boolean;
  setShowInstagram: (updater: (prev: boolean) => boolean) => void;
  minInstagram: number;
  setMinInstagram: (value: number) => void;
  maxInstagram: number;
  setMaxInstagram: (value: number) => void;
  gender: string;
  setGender: (value: string) => void;
  artistType: string;
  setArtistType: (value: string) => void;
  resetFilters: () => void;
  /**
   * Task A — "is this a small, personally-reachable operation" collapsed into
   * one plain-English toggle rather than the two raw knobs it's built from
   * (management-company size and freemail-domain manager email — see
   * lib/roster.ts's getArtistsByGenres). A solo operator doesn't have a
   * principled answer to "what management-company-size cutoff do I want,"
   * but does have one to "do I want to skip the majors" — so that's the only
   * decision exposed here; the underlying threshold lives in
   * useDemosFlow.ts's REACHABILITY_MAX_COMPANY_SIZE.
   */
  reachableOnly: boolean;
  setReachableOnly: (updater: (prev: boolean) => boolean) => void;
  /**
   * Task B — opts an empty genre selection into "every artist in the roster"
   * instead of "no artists," which is what it means once no genre chips are
   * selected above (see GenreSelector.tsx). Off by default and only shown as
   * relevant when nothing's selected up there: this is the one control that
   * can turn a send into thousands of recipients, so it stays a deliberate,
   * separate action rather than something that happens automatically when
   * the genre box is empty (see useDemosFlow.ts's handleSend for the
   * confirm() this also gates, and lib/demosSend.ts for the matching
   * server-side requirement).
   */
  matchAllGenres: boolean;
  setMatchAllGenres: (updater: (prev: boolean) => boolean) => void;
  /** Read-only, just to decide whether the "search every genre" toggle's
   *  copy should say it's currently in effect or currently a no-op. */
  selectedGenres: string[];
  /** Live "how many does this match right now" figure, debounced in
   *  useDemosFlow.ts — null until there's something to estimate (no genres
   *  selected and matchAllGenres is off), separate from the real Preview
   *  button/list below. */
  audienceEstimate: { artists: number; inboxes: number } | null;
  audienceEstimateLoading: boolean;
}

function ToggleSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} className={`relative w-9 h-5 rounded-full transition cursor-pointer ${on ? 'bg-violet-600' : 'bg-zinc-700'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </div>
  );
}

export function AudienceFiltersPanel(props: AudienceFiltersPanelProps) {
  const {
    minAudience, setMinAudience, maxAudience, setMaxAudience, showInstagram, setShowInstagram,
    minInstagram, setMinInstagram, maxInstagram, setMaxInstagram, gender, setGender, artistType, setArtistType,
    resetFilters, reachableOnly, setReachableOnly, matchAllGenres, setMatchAllGenres, selectedGenres,
    audienceEstimate, audienceEstimateLoading,
  } = props;

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-5">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Filters</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">Min Spotify followers</p>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOWER_STEPS.map(opt => (
              <button key={`min-sp-${opt.value}`} onClick={() => { setMinAudience(opt.value); resetFilters(); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">Max Spotify followers</p>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOWER_STEPS.map(opt => (
              <button key={`max-sp-${opt.value}`} onClick={() => { setMaxAudience(opt.value); resetFilters(); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="md:col-span-2 space-y-3">
          <button onClick={() => setShowInstagram(p => !p)}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition">
            <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 fill-none stroke-current stroke-2 transition-transform ${showInstagram ? 'rotate-180' : ''}`} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            Instagram followers
            {(minInstagram > 0 || maxInstagram > 0) && !showInstagram && (
              <span className="text-violet-400">
                {minInstagram > 0 && maxInstagram > 0
                  ? `${minInstagram >= 1_000_000 ? `${(minInstagram/1_000_000).toFixed(1)}M` : `${Math.round(minInstagram/1_000)}K`} – ${maxInstagram >= 1_000_000 ? `${(maxInstagram/1_000_000).toFixed(1)}M` : `${Math.round(maxInstagram/1_000)}K`}`
                  : minInstagram > 0
                  ? `min ${minInstagram >= 1_000_000 ? `${(minInstagram/1_000_000).toFixed(1)}M` : `${Math.round(minInstagram/1_000)}K`}`
                  : `max ${maxInstagram >= 1_000_000 ? `${(maxInstagram/1_000_000).toFixed(1)}M` : `${Math.round(maxInstagram/1_000)}K`}`}
              </span>
            )}
          </button>
          {showInstagram && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-400">Min</p>
                <div className="flex flex-wrap gap-1.5">
                  {FOLLOWER_STEPS.map(opt => (
                    <button key={`min-ig-${opt.value}`} onClick={() => { setMinInstagram(opt.value); resetFilters(); }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-400">Max</p>
                <div className="flex flex-wrap gap-1.5">
                  {FOLLOWER_STEPS.map(opt => (
                    <button key={`max-ig-${opt.value}`} onClick={() => { setMaxInstagram(opt.value); resetFilters(); }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">Artist gender</p>
          <div className="flex flex-wrap gap-1.5">
            {GENDER_OPTIONS.map(opt => (
              <button key={`gender-${opt.value}`} onClick={() => { setGender(opt.value); resetFilters(); }}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${gender === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">Artist type</p>
          <div className="flex flex-wrap gap-1.5">
            {ARTIST_TYPE_OPTIONS.map(opt => (
              <button key={`type-${opt.value}`} onClick={() => { setArtistType(opt.value); resetFilters(); }}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${artistType === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Reachability: none of the filters above predict whether a manager actually
          replies — genre/followers/gender describe the artist, not how buried their
          manager's inbox is. Company size and freemail-domain do predict that, so
          they get their own section rather than blending into "Filters" above. */}
      <div className="border-t border-zinc-800 pt-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <ToggleSwitch on={reachableOnly} onClick={() => { setReachableOnly(p => !p); resetFilters(); }} />
            <span>
              <span className="block text-sm font-medium text-zinc-200">Independent contacts only</span>
              <span className="block text-xs text-zinc-500 mt-0.5 max-w-md">
                Skip artists represented by a large agency. Only include a manager who
                represents {REACHABILITY_MAX_COMPANY_SIZE} or fewer artists on the whole roster, or
                who uses a personal email address (Gmail, Yahoo, etc.) instead of a company one —
                both are signs a pitch reaches an actual person instead of a filtered mailbox.
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-start justify-between gap-4">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <ToggleSwitch on={matchAllGenres} onClick={() => { setMatchAllGenres(p => !p); resetFilters(); }} />
            <span>
              <span className="block text-sm font-medium text-zinc-200">Search every genre</span>
              <span className="block text-xs text-zinc-500 mt-0.5 max-w-md">
                {selectedGenres.length > 0
                  ? `Not in effect while genres are selected above — clear your genre selection to use this instead.`
                  : `About 4 in 10 roster artists have no genre listed at all, so with nothing selected above,
                     the genre filter normally matches nobody. Turning this on searches the whole roster
                     instead, including those untagged artists — combine it with "Independent contacts only"
                     above so it doesn't just mean "everyone."`}
              </span>
            </span>
          </label>
        </div>

        <div className="text-xs text-zinc-500 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-2">
          {audienceEstimateLoading ? (
            'Counting matching artists…'
          ) : audienceEstimate ? (
            <>Current filters match <span className="text-zinc-200 font-medium">{audienceEstimate.artists}</span> artist{audienceEstimate.artists === 1 ? '' : 's'}, <span className="text-zinc-200 font-medium">{audienceEstimate.inboxes}</span> manager inbox{audienceEstimate.inboxes === 1 ? '' : 'es'}.</>
          ) : (
            'Select a genre above (or turn on "Search every genre") to see how many artists match.'
          )}
        </div>
      </div>
    </section>
  );
}
