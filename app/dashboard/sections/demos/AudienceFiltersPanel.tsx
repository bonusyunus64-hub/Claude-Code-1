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
}

export function AudienceFiltersPanel(props: AudienceFiltersPanelProps) {
  const {
    minAudience, setMinAudience, maxAudience, setMaxAudience, showInstagram, setShowInstagram,
    minInstagram, setMinInstagram, maxInstagram, setMaxInstagram, gender, setGender, artistType, setArtistType,
    resetFilters,
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
    </section>
  );
}
