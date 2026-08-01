import type { Artist, CustomContact } from '../../types';
import { CopyableName } from '../../components/CopyableName';
import { SpotifyLink } from '../../components/SpotifyLink';
import { PitchedBadge } from '../../components/PitchedBadge';
import { InstagramIcon } from './InstagramIcon';
import { OutsideSearchFallback } from './OutsideSearchFallback';

export interface RecipientsPreviewListProps {
  previewLoading: boolean;
  previewArtists: Artist[];
  visibleArtists: Artist[];
  excludedArtistNames: Set<string>;
  setExcludedArtistNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleArtistExclusion: (name: string) => void;
  recipientSearch: string;
  setRecipientSearch: (value: string) => void;
  sortOrder: 'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random';
  setSortOrder: (order: 'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random') => void;
  selectedGenres: string[];
  toggleGenreFromPreview: (genre: string) => void;
  outsideResults: Artist[];
  outsideResultsQuery: string;
  outsideSearchLoading: boolean;
  handleOutsideSearch: (query: string) => void;
  addOutsideArtistToContacts: (a: Artist) => void;
  customContacts: CustomContact[];
  pitchedEmailMap: Map<string, string[]>;
}

export function RecipientsPreviewList(props: RecipientsPreviewListProps) {
  const {
    previewLoading, previewArtists, visibleArtists, excludedArtistNames, setExcludedArtistNames, toggleArtistExclusion,
    recipientSearch, setRecipientSearch, sortOrder, setSortOrder, selectedGenres, toggleGenreFromPreview,
    outsideResults, outsideResultsQuery, outsideSearchLoading, handleOutsideSearch, addOutsideArtistToContacts,
    customContacts, pitchedEmailMap,
  } = props;

  return (
    <section className={`bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden transition-opacity ${previewLoading ? 'opacity-60' : ''}`}>
      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-300">Recipients Preview <span className="text-zinc-500 font-normal">· {previewLoading ? 'Updating…' : `${visibleArtists.length}${visibleArtists.length !== previewArtists.length ? ` of ${previewArtists.length}` : ''} artists`}</span></h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExcludedArtistNames(prev => {
              const next = new Set(prev);
              visibleArtists.forEach(a => next.add(a.name));
              return next;
            })}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition"
            title="Uncheck all artists currently shown">
            Deselect all
          </button>
          <button
            onClick={() => setExcludedArtistNames(prev => {
              const next = new Set(prev);
              visibleArtists.forEach(a => next.delete(a.name));
              return next;
            })}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition"
            title="Check all artists currently shown">
            Select all
          </button>
          <input type="text" value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)}
            placeholder="Search artist..."
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition w-36 sm:w-48" />
          <select value={sortOrder} onChange={e => setSortOrder(e.target.value as typeof sortOrder)}
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500">
            <option value="followers-desc">Followers: High → Low</option>
            <option value="followers-asc">Followers: Low → High</option>
            <option value="alpha-asc">A → Z</option>
            <option value="alpha-desc">Z → A</option>
            <option value="random">Random</option>
          </select>
        </div>
      </div>
      {visibleArtists.length === 0 && (
        <OutsideSearchFallback
          recipientSearch={recipientSearch}
          outsideResults={outsideResults}
          outsideResultsQuery={outsideResultsQuery}
          outsideSearchLoading={outsideSearchLoading}
          handleOutsideSearch={handleOutsideSearch}
          addOutsideArtistToContacts={addOutsideArtistToContacts}
          customContacts={customContacts}
          pitchedEmailMap={pitchedEmailMap}
        />
      )}
      <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
        {visibleArtists.map(a => {
          const pitchedTracks = a.managerEmails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
          const uniquePitched = [...new Set(pitchedTracks)];
          const isExcluded = excludedArtistNames.has(a.name);
          return (
            <div key={a.name} onClick={() => toggleArtistExclusion(a.name)}
              className={`cursor-pointer px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 transition hover:bg-zinc-800/40 ${isExcluded ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-3 min-w-0">
                <input type="checkbox" checked={!isExcluded} onChange={() => toggleArtistExclusion(a.name)}
                  onClick={e => e.stopPropagation()}
                  title={isExcluded ? 'Excluded from this send — click to include' : 'Click to exclude from this send'}
                  className="shrink-0 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-2 focus:ring-violet-500 focus:ring-offset-0 cursor-pointer accent-violet-600" />
                <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                  {a.avatarUrl ? (
                    // Deliberately a plain <img>, though next/image would work here — every
                    // roster avatar is an i.scdn.co URL, which next.config.ts already
                    // allowlists. These are decorative 40px thumbnails that Spotify's CDN
                    // already serves and caches for free, and the roster holds ~3000 distinct
                    // ones; routing them through the optimizer would spend this project's
                    // Vercel image quota to shave bytes off a thumbnail nobody waits on.
                    // Explicit width/height already prevent layout shift.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatarUrl} alt={a.name} width={40} height={40} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{a.name.charAt(0)}</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <CopyableName name={a.name} className="text-sm font-medium text-white" />
                    {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                    {a.instagramHandle && (
                      <a href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-pink-400 px-1.5 py-0.5 rounded font-medium transition">
                        <InstagramIcon className="w-3 h-3 fill-pink-400 shrink-0" />
                        {a.instagramHandle}
                      </a>
                    )}
                    {a.spotifyFollowers > 0 && (
                      <SpotifyLink name={a.name} followers={a.spotifyFollowers} />
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">{a.managementCompany || 'Independent'}</p>
                  {a.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {a.genres.map(g => {
                        const active = selectedGenres.includes(g);
                        return (
                          <button
                            key={g}
                            onClick={e => { e.stopPropagation(); toggleGenreFromPreview(g); }}
                            disabled={previewLoading}
                            title={active ? `Remove "${g}" from genre filters and refresh` : `Add "${g}" to genre filters and refresh`}
                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                              active
                                ? 'bg-violet-600/20 text-violet-300 border border-violet-600/30 hover:bg-violet-600/30 hover:border-violet-500'
                                : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-violet-500 hover:text-violet-300'
                            }`}
                          >
                            {g}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="pl-[52px] sm:pl-0 sm:text-right sm:shrink-0 space-y-0.5">
                {a.managerEmails.map((email, i) => (
                  <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">
                    {a.managerNames[i] ? `${a.managerNames[i]} — ` : ''}{email}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
