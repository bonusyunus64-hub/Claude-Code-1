import type { Artist, CustomContact } from '../../types';
import { CopyableName } from '../../components/CopyableName';
import { SpotifyLink } from '../../components/SpotifyLink';
import { PitchedBadge } from '../../components/PitchedBadge';
import { InstagramIcon } from './InstagramIcon';

export interface OutsideSearchFallbackProps {
  recipientSearch: string;
  outsideResults: Artist[];
  outsideResultsQuery: string;
  outsideSearchLoading: boolean;
  handleOutsideSearch: (query: string) => void;
  addOutsideArtistToContacts: (a: Artist) => void;
  customContacts: CustomContact[];
  pitchedEmailMap: Map<string, string[]>;
}

/** Shown in place of the recipients list when the current search box text matches
 *  nobody in the already-filtered set — offers a one-off search across the whole
 *  database (outside the genre/audience filters) so a specific artist can still be
 *  added as a one-off, without loosening the filters for the rest of the send. */
export function OutsideSearchFallback(props: OutsideSearchFallbackProps) {
  const {
    recipientSearch, outsideResults, outsideResultsQuery, outsideSearchLoading, handleOutsideSearch,
    addOutsideArtistToContacts, customContacts, pitchedEmailMap,
  } = props;

  return (
    <div className="px-4 md:px-6 py-4 space-y-3">
      <p className="text-sm text-zinc-500">No artists match &ldquo;{recipientSearch}&rdquo; in your current filters.</p>
      {outsideResultsQuery === recipientSearch.trim() && outsideResults.length > 0 ? (
        <div className="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800">
          {outsideResults.map(a => {
            const pitchedTracks = a.managerEmails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
            const uniquePitched = [...new Set(pitchedTracks)];
            const alreadyAdded = a.managerEmails.every(e => customContacts.some(c => c.managerEmail.toLowerCase() === e.toLowerCase()));
            return (
              <div key={a.name} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-zinc-700">
                    {a.avatarUrl ? (
                      // See the note on the same element in RecipientsPreviewList.tsx:
                      // decorative roster thumbnails, deliberately not routed through
                      // next/image.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.avatarUrl} alt={a.name} width={36} height={36} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{a.name.charAt(0)}</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <CopyableName name={a.name} className="text-sm font-medium text-white" />
                      {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                      {a.instagramHandle && (
                        <a href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center bg-zinc-800 hover:bg-zinc-700 text-pink-400 p-1 rounded transition">
                          <InstagramIcon className="w-3 h-3 fill-pink-400 shrink-0" />
                        </a>
                      )}
                      {a.spotifyFollowers > 0 && (
                        <SpotifyLink name={a.name} followers={a.spotifyFollowers} />
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{a.managementCompany || 'Independent'}</p>
                  </div>
                </div>
                <div className="pl-[46px] sm:pl-0 flex items-center gap-2.5 sm:shrink-0">
                  <div className="sm:text-right space-y-0.5 min-w-0">
                    {a.managerEmails.map((email, i) => (
                      <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">
                        {a.managerNames[i] ? `${a.managerNames[i]} — ` : ''}{email}
                      </p>
                    ))}
                  </div>
                  <button onClick={() => addOutsideArtistToContacts(a)} disabled={alreadyAdded}
                    className="shrink-0 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 px-2.5 py-1.5 font-medium text-white transition">
                    {alreadyAdded ? 'Added' : 'Add'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : outsideResultsQuery === recipientSearch.trim() ? (
        <p className="text-xs text-zinc-500">No matches found outside your filters either.</p>
      ) : (
        <button onClick={() => handleOutsideSearch(recipientSearch)} disabled={outsideSearchLoading || !recipientSearch.trim()}
          className="text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 px-3 py-1.5 font-medium text-zinc-300 transition">
          {outsideSearchLoading ? 'Searching...' : 'Show results outside your filters'}
        </button>
      )}
    </div>
  );
}
