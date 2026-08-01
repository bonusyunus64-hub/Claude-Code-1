export interface GenreSelectorProps {
  demosMatchMode: 'any' | 'all';
  setDemosMatchMode: (mode: 'any' | 'all') => void;
  selectedGenres: string[];
  setSelectedGenres: (genres: string[]) => void;
  toggleGenre: (genre: string) => void;
  genreSearch: string;
  setGenreSearch: (value: string) => void;
  showGenreDropdown: boolean;
  setShowGenreDropdown: (show: boolean) => void;
  topGenres: string[];
  filteredGenres: string[];
  setPreviewDone: (done: boolean) => void;
  setSendResult: (result: { sent: number; failed: number; total: number } | null) => void;
}

export function GenreSelector(props: GenreSelectorProps) {
  const {
    demosMatchMode, setDemosMatchMode, selectedGenres, setSelectedGenres, toggleGenre, genreSearch, setGenreSearch,
    showGenreDropdown, setShowGenreDropdown, topGenres, filteredGenres, setPreviewDone, setSendResult,
  } = props;

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Select Genres</h2>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">Match:</span>
          {(['any', 'all'] as const).map(mode => (
            <button key={mode} onClick={() => { setDemosMatchMode(mode); setPreviewDone(false); setSendResult(null); }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${demosMatchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
              {mode === 'any' ? 'Any genre' : 'All genres'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-zinc-500">
        {demosMatchMode === 'any' ? 'Artists tagged with at least one of the selected genres.' : 'Artists tagged with every selected genre.'}
      </p>
      {selectedGenres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedGenres.map(g => (
            <button key={g} onClick={() => toggleGenre(g)}
              className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
              {g}<span className="text-violet-200">×</span>
            </button>
          ))}
          <button onClick={() => { setSelectedGenres([]); setPreviewDone(false); setSendResult(null); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
        </div>
      )}
      <div className="relative">
        <input type="text" value={genreSearch} onChange={e => setGenreSearch(e.target.value)}
          onFocus={() => setShowGenreDropdown(true)}
          onBlur={() => setTimeout(() => setShowGenreDropdown(false), 150)}
          placeholder="Search genres (e.g. Pop, R&B, Hip Hop...)"
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
        {showGenreDropdown && genreSearch.trim() === '' && topGenres.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
            <p className="px-4 pt-2 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Most popular genres</p>
            {topGenres.filter(g => !selectedGenres.includes(g)).map(g => (
              <button key={g} onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }}
                className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
            ))}
          </div>
        )}
        {showGenreDropdown && genreSearch.trim() !== '' && filteredGenres.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
            {filteredGenres.map(g => (
              <button key={g} onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }}
                className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
