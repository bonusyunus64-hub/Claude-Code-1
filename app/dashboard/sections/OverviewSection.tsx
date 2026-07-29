import type { AnalyticsStats } from '../types';

export function OverviewSection({ analyticsStats }: { analyticsStats: AnalyticsStats }) {
  return (
    <div className="space-y-5 pb-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Overview</h2>
        <p className="text-xs text-zinc-500">All-time stats derived from your campaign history on this device.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <p className="text-2xl font-bold text-white">{analyticsStats.totalEmailsSent}</p>
          <p className="text-xs text-zinc-500 mt-1">Emails sent</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <p className="text-2xl font-bold text-white">{analyticsStats.totalCampaigns}</p>
          <p className="text-xs text-zinc-500 mt-1">Campaigns</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <p className="text-2xl font-bold text-violet-400">{analyticsStats.demosEmailsSent}</p>
          <p className="text-xs text-zinc-500 mt-1">Via Song Demos ({analyticsStats.demosCampaignCount})</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <p className="text-2xl font-bold text-sky-400">{analyticsStats.radioEmailsSent}</p>
          <p className="text-xs text-zinc-500 mt-1">Via Track Promotion ({analyticsStats.radioCampaignCount})</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <p className="text-2xl font-bold text-emerald-400">{analyticsStats.playlistEmailsSent}</p>
          <p className="text-xs text-zinc-500 mt-1">Via Playlist Curators ({analyticsStats.playlistCampaignCount})</p>
        </div>
      </div>

      {analyticsStats.totalCampaigns === 0 ? (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm font-semibold text-zinc-300">No activity yet</p>
          <p className="text-xs text-zinc-500">Send your first campaign to see stats here.</p>
        </section>
      ) : (
        <>
          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Sends, last 14 days</h3>
            <div className="flex items-end gap-1.5 h-24">
              {analyticsStats.last14Days.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 group relative">
                  <div
                    className={`w-full rounded-t transition-colors ${d.count > 0 ? 'bg-violet-600 group-hover:bg-violet-500' : 'bg-zinc-800'}`}
                    style={{ height: `${Math.max(2, (d.count / analyticsStats.maxDayCount) * 100)}%` }}
                    title={`${new Date(d.date).toLocaleDateString()}: ${d.count} sent`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>{new Date(analyticsStats.last14Days[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span>{new Date(analyticsStats.last14Days[13].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
          </section>

          <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-2">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Top pitched tracks</h3>
            {analyticsStats.topTracks.map(([title, count]) => (
              <div key={title} className="flex items-center justify-between text-sm">
                <span className="text-zinc-300 truncate">{title}</span>
                <span className="text-zinc-500 font-mono text-xs shrink-0 ml-3">{count} recipient{count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </section>

          {analyticsStats.lastCampaignDate && (
            <p className="text-xs text-zinc-600">Last campaign: {new Date(analyticsStats.lastCampaignDate).toLocaleString()}</p>
          )}
        </>
      )}
    </div>
  );
}
