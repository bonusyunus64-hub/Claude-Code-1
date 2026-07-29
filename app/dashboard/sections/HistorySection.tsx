import type { Campaign } from '../types';
import { CopyableName } from '../components/CopyableName';
import { SpotifyLink } from '../components/SpotifyLink';

export interface HistorySectionProps {
  campaigns: Campaign[];
  filteredCampaigns: Campaign[];
  exportCampaignsCsv: (list?: Campaign[]) => void;
  clearCampaignHistory: () => void;

  historySearch: string;
  setHistorySearch: (value: string) => void;
  historyTypeFilter: 'all' | Campaign['type'];
  setHistoryTypeFilter: (value: 'all' | Campaign['type']) => void;
  historyDateFrom: string;
  setHistoryDateFrom: (value: string) => void;
  historyDateTo: string;
  setHistoryDateTo: (value: string) => void;

  demosSendoutGroups: Map<string, Campaign[]>;
  expandedCampaignId: string | null;
  setExpandedCampaignId: React.Dispatch<React.SetStateAction<string | null>>;

  checkingRepliesId: string | null;
  checkReplies: (c: Campaign) => void;
  replyCheckResult: { campaignId: string; newCount: number; totalCount: number } | null;
  replyCheckError: string;
  formatCheckedAt: (ts: number) => string;

  backfillingId: string | null;
  backfillRecipients: (c: Campaign) => void;
  backfillError: string;
}

export function HistorySection(props: HistorySectionProps) {
  const {
    campaigns, filteredCampaigns, exportCampaignsCsv, clearCampaignHistory,
    historySearch, setHistorySearch, historyTypeFilter, setHistoryTypeFilter,
    historyDateFrom, setHistoryDateFrom, historyDateTo, setHistoryDateTo,
    demosSendoutGroups, expandedCampaignId, setExpandedCampaignId,
    checkingRepliesId, checkReplies, replyCheckResult, replyCheckError, formatCheckedAt,
    backfillingId, backfillRecipients, backfillError,
  } = props;

  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Campaign History</h2>
          <p className="text-xs text-zinc-500">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} logged on this device.</p>
        </div>
        {campaigns.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => exportCampaignsCsv(filteredCampaigns)}
              className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition">
              Export CSV
            </button>
            <button onClick={() => { if (confirm('Clear all campaign history? This cannot be undone.')) clearCampaignHistory(); }}
              className="rounded-lg bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-red-400 transition">
              Clear History
            </button>
          </div>
        )}
      </div>

      {campaigns.length > 0 && (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
          <input
            type="text"
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
            placeholder="Search by track title..."
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {(['all', 'demos', 'radio', 'playlists'] as const).map(t => (
                <button key={t} onClick={() => setHistoryTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${historyTypeFilter === t ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                  {t === 'all' ? 'All' : t === 'demos' ? 'Demos' : t === 'radio' ? 'Radio' : 'Playlists'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="date" value={historyDateFrom} onChange={e => setHistoryDateFrom(e.target.value)}
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <span>to</span>
              <input type="date" value={historyDateTo} onChange={e => setHistoryDateTo(e.target.value)}
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
            {(historySearch || historyTypeFilter !== 'all' || historyDateFrom || historyDateTo) && (
              <button onClick={() => { setHistorySearch(''); setHistoryTypeFilter('all'); setHistoryDateFrom(''); setHistoryDateTo(''); }}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition underline">
                Clear filters
              </button>
            )}
          </div>
        </section>
      )}

      {campaigns.length === 0 ? (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm font-semibold text-zinc-300">No campaigns yet</p>
          <p className="text-xs text-zinc-500">Sent pitches will show up here.</p>
        </section>
      ) : filteredCampaigns.length === 0 ? (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm font-semibold text-zinc-300">No campaigns match your filters</p>
          <button onClick={() => { setHistorySearch(''); setHistoryTypeFilter('all'); setHistoryDateFrom(''); setHistoryDateTo(''); }}
            className="text-xs text-violet-400 hover:text-violet-300 transition underline">
            Clear filters
          </button>
        </section>
      ) : (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {filteredCampaigns.slice().sort((a, b) => b.date.localeCompare(a.date)).map(c => {
            const sendoutGroup = c.type === 'demos' ? demosSendoutGroups.get(c.trackTitle.trim().toLowerCase()) : undefined;
            return (
            <div key={c.id} id={`campaign-${c.id}`}>
              <div className="w-full flex items-center gap-2 px-4 md:px-6 py-3.5 hover:bg-zinc-800/50 transition">
              <button
                onClick={() => setExpandedCampaignId(p => p === c.id ? null : c.id)}
                className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${c.type === 'demos' ? 'bg-violet-600/20 text-violet-400 border border-violet-600/30' : c.type === 'radio' ? 'bg-sky-600/20 text-sky-400 border border-sky-600/30' : 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'}`}>
                    {c.type === 'demos' ? 'Demos' : c.type === 'radio' ? 'Radio' : 'Playlists'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{c.trackTitle}</p>
                    <p className="text-xs text-zinc-500">
                      {new Date(c.date).toLocaleString()} · {c.emails.length} recipient{c.emails.length !== 1 ? 's' : ''}
                      {(c.responded?.length ?? 0) > 0 && <> · {c.responded!.length} responded</>}
                    </p>
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className={`w-4 h-4 shrink-0 text-zinc-500 transition-transform ${expandedCampaignId === c.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {sendoutGroup && (
                <select
                  value={c.id}
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    const id = e.target.value;
                    setExpandedCampaignId(id);
                    document.getElementById(`campaign-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  title="Switch between sendouts of this song"
                  className="shrink-0 text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {sendoutGroup.map((s, i) => (
                    <option key={s.id} value={s.id}>Sendout {i + 1}</option>
                  ))}
                </select>
              )}
              </div>
              {expandedCampaignId === c.id && (
                <div className="px-4 md:px-6 pb-4 -mt-1 space-y-3">
                  {c.accountId && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => checkReplies(c)}
                        disabled={checkingRepliesId === c.id}
                        className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition disabled:opacity-40"
                      >
                        {checkingRepliesId === c.id ? 'Checking inbox…' : 'Check for replies'}
                      </button>
                      {checkingRepliesId === c.id && <span className="text-xs text-zinc-500">This can take a few seconds per recipient.</span>}
                      {checkingRepliesId !== c.id && replyCheckResult?.campaignId === c.id && (
                        <span className="text-xs text-emerald-400 font-medium">
                          {replyCheckResult.newCount > 0
                            ? `✓ Checked — ${replyCheckResult.newCount} new repl${replyCheckResult.newCount === 1 ? 'y' : 'ies'} (${replyCheckResult.totalCount} total)`
                            : '✓ Checked — no new replies'}
                        </span>
                      )}
                      {checkingRepliesId !== c.id && replyCheckResult?.campaignId !== c.id && c.lastChecked && (
                        <span className="text-xs text-zinc-500">
                          Last checked {formatCheckedAt(c.lastChecked)} · {c.responded?.length ?? 0} replied
                        </span>
                      )}
                    </div>
                  )}
                  {replyCheckError && checkingRepliesId === null && (
                    <p className="text-xs text-red-400">{replyCheckError}</p>
                  )}
                  {(c.recipients?.length ?? 0) > 0 ? (
                    <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 overflow-hidden">
                      {c.recipients!.map(r => {
                        const responded = c.responded?.includes(r.email);
                        return (
                          <div key={r.email} className={`px-3 md:px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 ${responded ? 'bg-emerald-900/10' : ''}`}>
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                                {r.avatarUrl ? (
                                  <img src={r.avatarUrl} alt={r.artistName} width={40} height={40} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{(r.artistName || r.email).charAt(0).toUpperCase()}</div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <CopyableName name={r.artistName || r.email} className="text-sm font-medium text-white" />
                                  {responded && (
                                    <span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-600/30">Replied</span>
                                  )}
                                  {r.instagramHandle && (
                                    <a href={`https://instagram.com/${r.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-pink-400 px-1.5 py-0.5 rounded font-medium transition">
                                      <svg viewBox="0 0 24 24" className="w-3 h-3 fill-pink-400 shrink-0"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.012-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.058 1.645-.07 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.98-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.198-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                                      {r.instagramHandle}
                                    </a>
                                  )}
                                  {r.spotifyFollowers > 0 && (
                                    <SpotifyLink name={r.artistName} followers={r.spotifyFollowers} />
                                  )}
                                </div>
                                {r.genres.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {r.genres.map(g => (
                                      <span key={g} className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">{g}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="pl-[52px] sm:pl-0 sm:text-right sm:shrink-0">
                              <p className="text-xs text-violet-400 break-all sm:break-normal">
                                {r.managerName ? `${r.managerName} — ` : ''}{r.email}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {c.type === 'demos' && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => backfillRecipients(c)}
                            disabled={backfillingId === c.id}
                            className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition disabled:opacity-40"
                          >
                            {backfillingId === c.id ? 'Loading artist details…' : 'Show artists sent to'}
                          </button>
                          {backfillError && backfillingId === null && (
                            <span className="text-xs text-red-400">{backfillError}</span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {c.emails.map(email => {
                          const responded = c.responded?.includes(email);
                          return (
                            <span
                              key={email}
                              className={`text-xs px-2 py-1 rounded font-mono border ${responded ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' : 'bg-zinc-800 text-zinc-300 border-transparent'}`}
                            >
                              {email}{responded && ' ✓'}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
